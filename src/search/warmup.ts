import { promises as fsp } from 'node:fs';
import { getCurrentProject, loadConfig, KNOWLEDGE_DIR } from '../config.js';
import { listDocs, readDoc } from '../storage/knowledge.js';
import { onKnowledgeChanged } from '../storage/knowledge-events.js';
import { buildTextForDoc, type VectorSearchAdapter } from './index.js';
import type { KnowledgeDoc } from '../types.js';
import { childLogger } from '../core/logger.js';

const log = childLogger('warmup');

/** Anything that can hand out the vector adapter — ServerContext satisfies this. */
export interface WarmupHost {
  ensureVectorAdapter(): Promise<VectorSearchAdapter<unknown> | undefined>;
}

export type WarmupState = 'idle' | 'running' | 'done' | 'error' | 'disabled';

export interface WarmupStatus {
  project: string;
  state: WarmupState;
  indexed: number;
  total: number;
  elapsedMs: number;
  budgetMs: number;
  startedAt?: string;
  finishedAt?: string;
  reason?: string;
  error?: string;
}

interface WarmupDeps {
  listDocs(filter?: { project?: string }): Promise<Array<{ id: string }>>;
  readDoc(project: string, id: string): Promise<{ id: string; title: string; content: string; tags?: string[] } | null>;
  buildText(doc: { id: string; title: string; content: string; tags?: string[] }): string;
  now(): number;
  nowIso(): string;
}

const defaultDeps: WarmupDeps = {
  listDocs,
  readDoc,
  buildText: (doc) => buildTextForDoc(doc as KnowledgeDoc),
  now: () => Date.now(),
  nowIso: () => new Date().toISOString(),
};

const DEFAULT_BUDGET_MS = 180_000;
const DEFAULT_DEBOUNCE_MS = 250;
const STARTUP_DELAY_MS = 0;
const LEGACY_BATCH = 32;

let host: WarmupHost | undefined;
let deps: WarmupDeps = defaultDeps;
let unsubscribe: (() => void) | undefined;
let started = false;
let defaultBudgetMs = DEFAULT_BUDGET_MS;

const statuses = new Map<string, WarmupStatus>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Map<string, Promise<void>>();
const dirty = new Set<string>();

function budgetFromEnv(): number {
  const raw = Number(process.env.EMBEDDINGS_WARMUP_BUDGET_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_BUDGET_MS;
}

function setStatus(project: string, patch: Partial<WarmupStatus>): WarmupStatus {
  const current = statuses.get(project) ?? { project, state: 'idle', indexed: 0, total: 0, elapsedMs: 0, budgetMs: defaultBudgetMs };
  const next = { ...current, ...patch, project };
  statuses.set(project, next);
  return next;
}

async function resolveProjects(): Promise<string[]> {
  if ((process.env.EMBEDDINGS_WARMUP_PROJECTS ?? '').toLowerCase() === 'all') {
    try {
      const entries = await fsp.readdir(KNOWLEDGE_DIR, { withFileTypes: true });
      const projects = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
      if (projects.length > 0) return projects;
    } catch {
      // No knowledge dir yet — the current project is still worth indexing once it exists.
    }
  }
  return [getCurrentProject()];
}

async function runProject(project: string): Promise<void> {
  if (!host) return;
  const startedAt = deps.nowIso();
  setStatus(project, { state: 'running', indexed: 0, elapsedMs: 0, startedAt, finishedAt: undefined, error: undefined, reason: undefined });

  try {
    const adapter = await host.ensureVectorAdapter();
    if (!adapter) {
      setStatus(project, { state: 'disabled', reason: 'vector adapter unavailable' });
      return;
    }

    const metas = await deps.listDocs({ project });
    const items: Array<{ id: string; text: string }> = [];
    for (const meta of metas) {
      const doc = await deps.readDoc(project, meta.id);
      if (doc) items.push({ id: doc.id, text: deps.buildText(doc) });
    }
    setStatus(project, { total: items.length });

    if (typeof adapter.warmup === 'function') {
      const result = await adapter.warmup(items, { budgetMs: defaultBudgetMs });
      setStatus(project, {
        indexed: result.encoded + result.cached,
        elapsedMs: result.elapsedMs,
        reason: result.budgetExceeded ? 'budget exceeded' : undefined,
      });
    } else {
      const start = deps.now();
      let indexed = 0;
      let budgetExceeded = false;
      for (let i = 0; i < items.length; i += LEGACY_BATCH) {
        if (defaultBudgetMs > 0 && deps.now() - start > defaultBudgetMs) {
          budgetExceeded = true;
          break;
        }
        const slice = items.slice(i, i + LEGACY_BATCH).map((it) => ({ ...it, item: it }));
        await adapter.search('index warmup', slice, { limit: 1 });
        indexed += slice.length;
      }
      setStatus(project, { indexed, elapsedMs: deps.now() - start, reason: budgetExceeded ? 'budget exceeded' : undefined });
    }

    const st = statuses.get(project);
    setStatus(project, { state: 'done', finishedAt: deps.nowIso() });
    log.info({ project, docs: st?.total ?? items.length, indexed: st?.indexed ?? 0, ms: st?.elapsedMs ?? 0 }, 'warmup done');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    setStatus(project, { state: 'error', error: message, finishedAt: deps.nowIso() });
    log.warn({ project, err: message }, 'warmup failed');
  }
}

function schedule(project: string, delayMs: number): void {
  if (!host) return;
  if (running.has(project)) {
    dirty.add(project);
    return;
  }
  const existing = timers.get(project);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    timers.delete(project);
    const task = runProject(project).finally(() => {
      running.delete(project);
      if (dirty.delete(project)) schedule(project, DEFAULT_DEBOUNCE_MS);
    });
    running.set(project, task);
  }, Math.max(0, delayMs));
  timer.unref?.();
  timers.set(project, timer);
}

/** Re-index a project in the background. Coalesces bursts (bulk imports, debounce). */
export function scheduleProjectIndex(project: string, opts?: { delayMs?: number }): void {
  if (!started) return;
  schedule(project, opts?.delayMs ?? DEFAULT_DEBOUNCE_MS);
}

/** Current warmup state per project — surfaced by `embeddings_status`. */
export function getWarmupStatus(): WarmupStatus[] {
  return Array.from(statuses.values()).sort((a, b) => a.project.localeCompare(b.project));
}

/**
 * Start background indexing. Must be called once the tool surface is registered;
 * returns immediately, the work happens on the next ticks.
 */
export async function startWarmup(
  warmupHost: WarmupHost,
  opts?: { projects?: string[]; budgetMs?: number; delayMs?: number; deps?: Partial<WarmupDeps> },
): Promise<void> {
  if (started) return;
  started = true;
  host = warmupHost;
  deps = { ...defaultDeps, ...(opts?.deps ?? {}) };
  defaultBudgetMs = opts?.budgetMs ?? budgetFromEnv();

  const projects = opts?.projects ?? (await resolveProjects());

  if (process.env.EMBEDDINGS_WARMUP === '0') {
    for (const project of projects) setStatus(project, { state: 'disabled', reason: 'EMBEDDINGS_WARMUP=0' });
    return;
  }
  if (loadConfig().embeddings.mode === 'none') {
    for (const project of projects) setStatus(project, { state: 'disabled', reason: 'EMBEDDINGS_MODE=none' });
    return;
  }

  unsubscribe = onKnowledgeChanged((project) => scheduleProjectIndex(project));
  const delay = opts?.delayMs ?? STARTUP_DELAY_MS;
  for (const project of projects) schedule(project, delay);
}

/** Test helper — detach the host, drop timers/statuses and the change subscription. */
export function resetWarmupForTests(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  running.clear();
  dirty.clear();
  statuses.clear();
  unsubscribe?.();
  unsubscribe = undefined;
  host = undefined;
  started = false;
  deps = defaultDeps;
  defaultBudgetMs = DEFAULT_BUDGET_MS;
}
