import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TASKS_DIR, KNOWLEDGE_DIR, DATA_DIR } from '../config.js';
import { ensureDir, pathExists, readJson, resolveUnder, withFileLock, writeJson } from '../fs.js';
import { listDataFiles, resolveDataFile, writeDataPath } from './sharding.js';
import type { Task, TaskClaim, Priority, Status, TaskTreeNode } from '../types.js';
import {
  assertStatusAllowed,
  assertTypeAllowed,
  loadProjectTypes,
  resolveTaskType,
  assertTransition,
  closeStatusId,
  defaultStatusId,
  isDone,
  loadProjectWorkflow,
  WorkflowError,
  type ProjectWorkflow,
} from '../workflow.js';
import { nextTaskVersion } from './optimistic.js';
import type { Dirent } from 'node:fs';
import { promises as fs } from 'node:fs';
import { childLogger } from '../core/logger.js';
import { enqueueHistory } from '../history/service.js';
import { mapLimit } from '../utils/concurrency.js';
import { blankToUndefined } from '../utils/strings.js';
import { decodeKeyCursor } from '../utils/pagination.js';
import {
  buildTaskRow,
  ensureProjectIndexed,
  getActiveMetadataIndex,
  indexTaskDelete,
  indexTaskWrite,
  noteFilePageRead,
  noteIndexPageRead,
  resolveProjectIndexDirs,
} from './metadata-index.js';
import { noteTaskRemoved, noteTaskWritten } from '../search/fts-indexer.js';
import {
  DEFAULT_CLAIM_TTL_SEC,
  MAX_CLAIM_TTL_SEC,
  MAX_TASK_DEPTH,
  MIN_CLAIM_TTL_SEC,
} from './contracts.js';

const log = childLogger('storage:tasks');

export async function tasksProjectDir(project: string) {
  const dir = resolveUnder(TASKS_DIR, project);
  await ensureDir(dir);
  return dir;
}

// Soft-delete helpers
export async function archiveTask(project: string, id: string): Promise<Task | null> {
  return updateTask(project, id, { archived: true, archivedAt: new Date().toISOString() } as any);
}

export async function trashTask(project: string, id: string): Promise<Task | null> {
  return updateTask(project, id, { trashed: true, trashedAt: new Date().toISOString() } as any);
}

export async function restoreTask(project: string, id: string): Promise<Task | null> {
  return updateTask(project, id, { archived: false, trashed: false } as any);
}

export async function deleteTaskPermanent(project: string, id: string): Promise<boolean> {
  const p = await resolveDataFile(resolveUnder(TASKS_DIR, project), id, '.json');
  if (!p || !(await pathExists(p))) {
    indexTaskDelete(id);
    noteTaskRemoved(project, id);
    return false;
  }
  await fs.unlink(p);
  indexTaskDelete(id);
  noteTaskRemoved(project, id);
  return true;
}

export async function createTask(input: {
  project: string;
  title: string;
  description?: string;
  priority?: Priority;
  status?: Status;
  type?: string;
  tags?: string[];
  links?: string[];
  parentId?: string;
}): Promise<Task> {
  // Validate parent exists and depth limit
  if (input.parentId) {
    const parent = await getTask(input.project, input.parentId);
    if (!parent) {
      throw new Error(`Parent task not found: ${input.project}/${input.parentId}`);
    }
    await validateParentDepth(input.project, '__new__', input.parentId);
  }

  return withFileLock(`workflow:${input.project}`, async () => {
    const workflow = await loadProjectWorkflow(input.project);
    const status = input.status ?? defaultStatusId(workflow);
    assertStatusAllowed(workflow, status);
    const projectTypes = await loadProjectTypes(input.project);
    const type = resolveTaskType(projectTypes.types, input.type);

    const id = randomUUID();
    const now = new Date().toISOString();
    const task: Task = {
      id,
      project: input.project,
      title: input.title,
      description: input.description,
      status,
      type,
      priority: input.priority || 'medium',
      tags: input.tags || [],
      links: input.links || [],
      version: 1,
      fieldVersions: {},
      createdAt: now,
      updatedAt: now,
      parentId: blankToUndefined(input.parentId),
      archived: false,
      trashed: false,
    };
    const dir = await tasksProjectDir(input.project);
    const filePath = await writeDataPath(dir, id, '.json');
    await ensureDir(path.dirname(filePath));
    await writeJson(filePath, task);
    await indexTaskWrite(input.project, task, filePath);
    noteTaskWritten(task);
    return task;
  });
}

function taskFilePath(project: string, id: string): string {
  return resolveUnder(TASKS_DIR, project, `${id}.json`);
}

async function readTaskRaw(project: string, id: string): Promise<Task | null> {
  const p = await resolveDataFile(resolveUnder(TASKS_DIR, project), id, '.json');
  if (!p) return null;
  return readJson<Task>(p);
}

/** Whether a lease is still valid. Expired claims never block a claimer. */
export function isClaimActive(claim: TaskClaim | undefined, nowMs: number = Date.now()): boolean {
  if (!claim) return false;
  const expiresAt = Date.parse(claim.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > nowMs;
}

/** Hide (but do not persist) an expired claim on the read path. */
function withoutExpiredClaim(task: Task, nowMs: number = Date.now()): Task {
  if (task.claim && !isClaimActive(task.claim, nowMs)) {
    const { claim: _expired, ...rest } = task;
    return rest;
  }
  return task;
}

/** Каталог задач проекта с учётом legacy-раскладки (плоский TASKS_DIR). */
async function resolveTasksDir(project: string): Promise<string | null> {
  const modern = resolveUnder(TASKS_DIR, project);
  if (await pathExists(modern)) return modern;
  if (await pathExists(TASKS_DIR)) return TASKS_DIR;
  return null;
}

interface TaskFileEntry {
  id: string;
  file: string;
  /** mtime пишется тем же вызовом, что и updatedAt (`writeJson`), поэтому годится как ключ страницы. */
  mtimeMs: number;
}

/** Файлы задач, отсортированные по (mtime desc, id asc) — без чтения содержимого. */
export async function listTaskEntries(project: string): Promise<TaskFileEntry[]> {
  const dir = await resolveTasksDir(project);
  if (!dir) return [];
  const files = await listDataFiles(dir, '.json', { legacyFlat: dir === TASKS_DIR });
  const entries = await mapLimit(files, 256, async ({ id, file }) => {
    const st = await fs.stat(file);
    return { id, file, mtimeMs: st.mtimeMs };
  });
  entries.sort((a, b) => (b.mtimeMs - a.mtimeMs) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return entries;
}

export interface TaskPageOptions {
  limit: number;
  cursor?: string | null;
  status?: string;
  tag?: string;
  priority?: string;
  parentId?: string;
  /** V-03: тип задачи; старые задачи без типа считаются 'task'. */
  type?: string;
  /** ISO-дата: только задачи с updatedAt >= значения (лексикографически, ISO сортируем). */
  updatedSince?: string;
  includeArchived?: boolean;
  includeTrashed?: boolean;
  countOnly?: boolean;
}

export interface TaskPage {
  items: Task[];
  /** Ключ страницы для каждого item (mtime как строка) — из него строится nextCursor. */
  keys: string[];
  total: number;
  /** `false` — total по файлам проекта (архив/корзина включены), содержимое не читалось. */
  totalExact: boolean;
  hasMore: boolean;
}

/** V-03: старые задачи без `type` трактуются как 'task' и на постраничном пути. */
function withDefaultType(t: Task): Task {
  if (t.type === undefined) t.type = 'task';
  return t;
}

function taskPasses(t: Task, opts: TaskPageOptions): boolean {
  if (!opts.includeTrashed && (t as any).trashed) return false;
  if (!opts.includeArchived && (t as any).archived) return false;
  if (opts.status && t.status !== opts.status) return false;
  if (opts.tag && !(t.tags || []).includes(opts.tag)) return false;
  if (opts.priority && t.priority !== opts.priority) return false;
  if (opts.parentId && t.parentId !== opts.parentId) return false;
  if (opts.type && (t.type ?? 'task') !== opts.type) return false;
  if (opts.updatedSince && (t.updatedAt || '') < opts.updatedSince) return false;
  return true;
}

/**
 * Индекс первого элемента строго после курсора (mtime desc, id asc).
 *
 * `id` — id из payload (`pageFromStorage` кодирует `idOf(item)`), поэтому функцию
 * можно применять и к отфильтрованному списку, а не только к файлам каталога.
 */
function startIndexAfterCursor(
  entries: Array<{ id: string; mtimeMs: number }>,
  cursor?: string | null,
): number {
  if (!cursor) return 0;
  const decoded = decodeKeyCursor(cursor);
  const key = Number(decoded.k);
  const index = entries.findIndex((e) => e.mtimeMs < key || (e.mtimeMs === key && e.id > decoded.id));
  return index < 0 ? entries.length : index;
}

/**
 * Страница задач без чтения всего каталога (SC-01).
 *
 * Быстрый путь (нет содержательных фильтров): `readdir` + `stat` дают порядок по mtime,
 * затем читаются только файлы, попавшие в страницу (плюс редкие архивные). `total` в этом
 * режиме — число файлов проекта (`totalExact: false`), потому что архив/корзина лежат
 * внутри файлов. Любой содержательный фильтр или `countOnly` требует полного чтения —
 * это и есть аргумент за индекс из SC-02.
 */
/**
 * SC-02c: index-backed page. Returns `null` when the project is not proven
 * complete (or the index is off / errors) — the caller then keeps the file path.
 * Only the rows of the requested page are read from disk; their mtime is
 * compared with the row and a mismatch re-upserts the row (self-heal).
 */
async function tryIndexedTasksPage(project: string, opts: TaskPageOptions): Promise<TaskPage | null> {
  const index = getActiveMetadataIndex();
  if (!index) return null;

  const cursor = opts.cursor ? decodeKeyCursor(opts.cursor) : null;
  const after = cursor ? { mtimeMs: Number(cursor.k), id: cursor.id } : undefined;
  if (after && !Number.isFinite(after.mtimeMs)) return null;

  try {
    if (!index.isProjectComplete(project)) {
      const dirs = await resolveProjectIndexDirs(project, { tasksDir: TASKS_DIR, knowledgeDir: KNOWLEDGE_DIR });
      ensureProjectIndexed(project, dirs);
      return null;
    }

    const result = index.listTasks({
      project,
      limit: opts.countOnly ? undefined : opts.limit,
      status: opts.status,
      type: opts.type,
      priority: opts.priority,
      parentId: opts.parentId,
      tag: opts.tag,
      updatedSince: opts.updatedSince,
      excludeArchived: !opts.includeArchived,
      excludeTrashed: !opts.includeTrashed,
      after,
      countOnly: opts.countOnly,
    });

    if (opts.countOnly) {
      return { items: [], keys: [], total: result.total, totalExact: true, hasMore: false };
    }

    const items: Task[] = [];
    const keys: string[] = [];
    let healedOut = 0;

    for (const row of result.items) {
      const file = path.resolve(index.dataDir, row.relPath);
      try {
        const [raw, st] = await Promise.all([readJson<Task>(file), fs.stat(file)]);
        const task = withDefaultType(withoutExpiredClaim(raw));
        if (st.mtimeMs !== row.mtimeMs) {
          index.upsertTask(buildTaskRow(project, task, st.mtimeMs, row.relPath));
          if (!taskPasses(task, opts)) {
            healedOut++;
            continue;
          }
          items.push(task);
          keys.push(String(st.mtimeMs));
          continue;
        }
        items.push(task);
        keys.push(String(row.mtimeMs));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        index.deleteTask(row.id);
        healedOut++;
      }
    }

    if (healedOut > 0) index.recountProject(project);

    return {
      items,
      keys,
      total: Math.max(0, result.total - healedOut),
      totalExact: true,
      hasMore: result.hasMore,
    };
  } catch (err) {
    log.warn({ err, project }, 'metadata index page read failed — falling back to the file path');
    return null;
  }
}

export async function listTasksPage(project: string, opts: TaskPageOptions): Promise<TaskPage> {
  const indexed = await tryIndexedTasksPage(project, opts);
  if (indexed) {
    noteIndexPageRead();
    return indexed;
  }
  noteFilePageRead();

  const entries = await listTaskEntries(project);
  const hasContentFilter = Boolean(
    opts.status || opts.tag || opts.priority || opts.parentId || opts.updatedSince || opts.type,
  );
  const entriesStart = startIndexAfterCursor(entries, opts.cursor);

  if (opts.countOnly || hasContentFilter) {
    const all = await mapLimit(entries, 32, (e) => readJson<Task>(e.file));
    const matched: Array<{ task: Task; id: string; mtimeMs: number }> = [];
    for (let i = 0; i < all.length; i++) {
      const task = withDefaultType(withoutExpiredClaim(all[i]));
      if (taskPasses(task, opts)) matched.push({ task, id: task.id, mtimeMs: entries[i].mtimeMs });
    }
    if (opts.countOnly) {
      return { items: [], keys: [], total: matched.length, totalExact: true, hasMore: false };
    }
    const start = hasContentFilter ? startIndexAfterCursor(matched, opts.cursor) : entriesStart;
    const sliced = matched.slice(start, start + opts.limit);
    return {
      items: sliced.map((m) => m.task),
      keys: sliced.map((m) => String(m.mtimeMs)),
      total: matched.length,
      totalExact: true,
      hasMore: start + sliced.length < matched.length,
    };
  }

  // Read one extra matching item so `hasMore` is exact instead of "maybe".
  const collected: Task[] = [];
  const collectedKeys: string[] = [];
  let index = entriesStart;
  const chunkSize = Math.max(32, opts.limit * 2);
  while (collected.length <= opts.limit && index < entries.length) {
    const chunk = entries.slice(index, index + chunkSize);
    const loaded = await mapLimit(chunk, 32, (e) => readJson<Task>(e.file));
    for (let i = 0; i < loaded.length; i++) {
      const task = withDefaultType(withoutExpiredClaim(loaded[i]));
      if (!taskPasses(task, opts)) continue;
      collected.push(task);
      collectedKeys.push(String(chunk[i].mtimeMs));
      if (collected.length > opts.limit) break;
    }
    index += chunk.length;
  }
  const hasMore = collected.length > opts.limit;
  return {
    items: collected.slice(0, opts.limit),
    keys: collectedKeys.slice(0, opts.limit),
    total: entries.length,
    totalExact: false,
    hasMore,
  };
}

export async function listTasks(filter?: {
  project?: string;
  status?: Status;
  type?: string;
  tag?: string;
  includeArchived?: boolean;
  includeTrashed?: boolean;
}): Promise<Task[]> {
  const projects = filter?.project ? [filter.project] : await listAllProjects();
  const results: Task[] = [];
  for (const project of projects) {
    // Prefer modern layout: TASKS_DIR/<project>/
    let dir = resolveUnder(TASKS_DIR, project);
    if (!(await pathExists(dir))) {
      // Legacy flat layout fallback: TASKS_DIR/* without per-project subdir
      if (await pathExists(TASKS_DIR)) {
        dir = TASKS_DIR;
      } else {
        continue;
      }
    }
    const files = await listDataFiles(dir, '.json', { legacyFlat: dir === TASKS_DIR });
    // Parallel reads: sequential `await` in a loop was the dominant cost at scale
    // (100k tasks = 4.3 s warm, docs/benchmarks/scale-2026-10.md §3.1). mapLimit keeps
    // descriptor usage bounded and preserves the original "first error wins" semantics.
    const loaded = await mapLimit(files, 32, ({ file }) => readJson<Task>(file));
    for (const raw of loaded) {
      const t = withoutExpiredClaim(raw);
      t.type = t.type ?? 'task';
      // skip trashed by default unless explicitly included
      if (!filter?.includeTrashed && (t as any).trashed) continue;
      // skip archived by default unless explicitly included
      if (!filter?.includeArchived && (t as any).archived) continue;
      if (filter?.status && t.status !== filter.status) continue;
      if (filter?.type && (t.type ?? 'task') !== filter.type) continue;
      if (filter?.tag && !(t.tags || []).includes(filter.tag)) continue;
      results.push(t);
    }
  }
  // Sort by updatedAt desc (guarding undefined)
  results.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return results;
}

export async function listTasksTree(filter?: {
  project?: string;
  status?: Status;
  type?: string;
  tag?: string;
  includeArchived?: boolean;
}): Promise<TaskTreeNode[]> {
  const items = await listTasks(filter);
  // Build id -> node map
  const map = new Map<string, TaskTreeNode>();
  for (const t of items) {
    map.set(t.id, { ...t, children: [] });
  }
  const roots: TaskTreeNode[] = [];
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      const parent = map.get(node.parentId)!;
      // Ensure parent-child only within same project
      if (parent.project === node.project) {
        parent.children.push(node);
        continue;
      }
    }
    roots.push(node);
  }
  // Sort helper by updatedAt desc
  const sortRec = (n: TaskTreeNode) => {
    n.children.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    n.children.forEach(sortRec);
  };
  roots.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  roots.forEach(sortRec);
  return roots;
}

export async function getTask(project: string, id: string): Promise<Task | null> {
  const task = await readTaskRaw(project, id);
  if (!task) return null;
  return { ...withoutExpiredClaim(task), type: task.type ?? 'task' };
}

// Backwards-compatible alias expected by some tests
export async function readTask(project: string, id: string): Promise<Task | null> {
  return getTask(project, id);
}

// ─── Claim / lease (U-01) ───────────────────────────────────────────
//
// Lease state lives on the task record but is deliberately outside the
// content revision: claim/renew/release never touch `updatedAt` (nor the
// future MU-02 `version`). Otherwise every heartbeat would invalidate other
// clients' optimistic-lock tokens and produce false CONFLICTs.

// Y-02e2: the bounds are defined in the contract (registrators build schemas from them) and
// re-exported here so existing callers keep working.
export { DEFAULT_CLAIM_TTL_SEC, MIN_CLAIM_TTL_SEC, MAX_CLAIM_TTL_SEC, MAX_TASK_DEPTH };

export interface ClaimActor {
  /** MCP session id of the caller. */
  sessionId: string;
  userId?: string;
  client?: string;
  ttlSec?: number;
}

export type ClaimTaskResult =
  | { status: 'claimed' | 'renewed'; task: Task; claim: TaskClaim }
  | { status: 'claimed_by_other'; claim: TaskClaim }
  | { status: 'not_found' };

export type RenewTaskResult =
  | { status: 'renewed'; task: Task; claim: TaskClaim }
  | { status: 'not_claimed' }
  | { status: 'claimed_by_other'; claim: TaskClaim }
  | { status: 'not_found' };

export type ReleaseTaskResult =
  | { status: 'released'; task: Task }
  | { status: 'not_claimed'; task: Task }
  | { status: 'claimed_by_other'; claim: TaskClaim }
  | { status: 'not_found' };

function claimTtlMs(ttlSec?: number): number {
  const raw = typeof ttlSec === 'number' && Number.isFinite(ttlSec) ? Math.trunc(ttlSec) : DEFAULT_CLAIM_TTL_SEC;
  const clamped = Math.min(MAX_CLAIM_TTL_SEC, Math.max(MIN_CLAIM_TTL_SEC, raw));
  return clamped * 1000;
}

function buildClaim(task: Task, actor: ClaimActor, nowMs: number): TaskClaim {
  const ttlMs = claimTtlMs(actor.ttlSec);
  const existing = task.claim;
  const claimedAt = existing && isClaimActive(existing, nowMs) ? existing.claimedAt : new Date(nowMs).toISOString();
  return {
    bySessionId: actor.sessionId,
    ...(actor.userId ? { byUserId: actor.userId } : {}),
    ...(actor.client ? { client: actor.client } : {}),
    claimedAt,
    heartbeatAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
  };
}

async function persistClaim(project: string, id: string, task: Task, claim: TaskClaim | undefined): Promise<Task> {
  const updated: Task = { ...task, claim };
  if (!claim) delete (updated as { claim?: TaskClaim }).claim;
  const p = taskFilePath(project, id);
  await writeJson(p, updated);
  await indexTaskWrite(project, updated, p);
  void enqueueHistory([p]).catch(() => undefined);
  return updated;
}

/** Claim a task or extend the lease of its current holder. */
export async function claimTask(project: string, id: string, actor: ClaimActor): Promise<ClaimTaskResult> {
  const lockKey = `task:${project}/${id}`;
  return withFileLock(lockKey, async () => {
    const task = await readTaskRaw(project, id);
    if (!task) return { status: 'not_found' };

    const nowMs = Date.now();
    if (task.claim && isClaimActive(task.claim, nowMs)) {
      if (task.claim.bySessionId !== actor.sessionId) {
        return { status: 'claimed_by_other', claim: task.claim };
      }
      const claim = buildClaim(task, actor, nowMs);
      const updated = await persistClaim(project, id, task, claim);
      return { status: 'renewed', task: updated, claim };
    }

    const claim = buildClaim(task, actor, nowMs);
    const updated = await persistClaim(project, id, task, claim);
    return { status: 'claimed', task: updated, claim };
  });
}

/** Extend an existing lease. Does not bump updatedAt/version. */
export async function renewTaskClaim(project: string, id: string, actor: ClaimActor): Promise<RenewTaskResult> {
  const lockKey = `task:${project}/${id}`;
  return withFileLock(lockKey, async () => {
    const task = await readTaskRaw(project, id);
    if (!task) return { status: 'not_found' };

    const nowMs = Date.now();
    if (!task.claim || !isClaimActive(task.claim, nowMs)) {
      return { status: 'not_claimed' };
    }
    if (task.claim.bySessionId !== actor.sessionId) {
      return { status: 'claimed_by_other', claim: task.claim };
    }

    const claim = buildClaim(task, actor, nowMs);
    const updated = await persistClaim(project, id, task, claim);
    return { status: 'renewed', task: updated, claim };
  });
}

/** Release a lease. Only the holder may release before expiry; expired claims are cleaned. */
export async function releaseTaskClaim(project: string, id: string, actor: ClaimActor): Promise<ReleaseTaskResult> {
  const lockKey = `task:${project}/${id}`;
  return withFileLock(lockKey, async () => {
    const task = await readTaskRaw(project, id);
    if (!task) return { status: 'not_found' };

    if (!task.claim) return { status: 'not_claimed', task };

    const nowMs = Date.now();
    if (isClaimActive(task.claim, nowMs) && task.claim.bySessionId !== actor.sessionId) {
      return { status: 'claimed_by_other', claim: task.claim };
    }

    const updated = await persistClaim(project, id, task, undefined);
    return { status: 'released', task: updated };
  });
}

/**
 * SC-06: archive (never delete) closed tasks whose updatedAt is older than the
 * cutoff. Used by the env-gated maintenance sweep; no task status is changed.
 */
export async function archiveStaleClosedTasks(project: string, maxAgeDays: number): Promise<string[]> {
  if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) throw new Error('maxAgeDays must be >= 0');
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  const archived: string[] = [];
  for (const entry of await listTaskEntries(project)) {
    let task: Task;
    try {
      task = await readJson<Task>(entry.file);
    } catch {
      continue;
    }
    if ((task as any).archived || (task as any).trashed) continue;
    const doneStatus = ['done', 'completed', 'closed'].includes(String(task.status).toLowerCase());
    if (!doneStatus) continue;
    const updated = Date.parse(task.updatedAt);
    if (!Number.isFinite(updated) || updated >= cutoff) continue;
    (task as any).archived = true;
    (task as any).archivedAt = new Date().toISOString();
    await writeJson(entry.file, task);
    archived.push(task.id);
  }
  return archived;
}

/**
 * SC-06: collapse shards only when a project is small again (or forced). This
 * is a maintenance primitive, not a timer; callers decide when to run it.
 */
export async function compactTaskStorage(project: string, opts: { force?: boolean; threshold?: number } = {}) {
  const { compactShards } = await import('./sharding.js');
  return compactShards(await tasksProjectDir(project), '.json', opts);
}

/** Remove expired claims from disk. Returns `<project>/<id>` for each cleaned task. */
export async function pruneExpiredClaims(project?: string): Promise<string[]> {
  const projects = project ? [project] : await listAllProjects();
  const pruned: string[] = [];

  for (const prj of projects) {
    const dir = resolveUnder(TASKS_DIR, prj);
    if (!(await pathExists(dir))) continue;
    let files: { id: string; file: string }[];
    try {
      files = await listDataFiles(dir, '.json');
    } catch {
      continue;
    }
    for (const { id, file } of files) {
      let probe: Task;
      try {
        probe = await readJson<Task>(file);
      } catch {
        continue;
      }
      if (!probe.claim || isClaimActive(probe.claim)) continue;

      const removed = await withFileLock(`task:${prj}/${id}`, async () => {
        const fresh = await readTaskRaw(prj, id);
        if (!fresh?.claim || isClaimActive(fresh.claim)) return false;
        await persistClaim(prj, id, fresh, undefined);
        return true;
      });
      if (removed) pruned.push(`${prj}/${id}`);
    }
  }

  return pruned;
}

let claimSweepTimer: ReturnType<typeof setInterval> | undefined;

/**
 * Start the background claim sweeper (SessionManager.prune pattern).
 * `TASK_CLAIM_SWEEP_MS=0` disables it. Idempotent; timer is unref'd so it
 * never keeps the process alive.
 */
export function startClaimSweeper(intervalMs: number = Number(process.env.TASK_CLAIM_SWEEP_MS ?? 60_000)): boolean {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return false;
  if (claimSweepTimer) return true;
  claimSweepTimer = setInterval(() => {
    pruneExpiredClaims().catch((err) => log.error({ err }, 'claim sweep error'));
  }, intervalMs);
  claimSweepTimer.unref?.();
  log.info({ intervalMs }, 'task claim sweeper started');
  return true;
}

export function stopClaimSweeper(): void {
  if (claimSweepTimer) {
    clearInterval(claimSweepTimer);
    claimSweepTimer = undefined;
  }
}

export async function updateTask(
  project: string,
  id: string,
  patch: Partial<Omit<Task, 'id' | 'project' | 'createdAt'>>,
  expectedVersion?: number,
): Promise<Task | null> {
  return withFileLock(`workflow:${project}`, async () => {
    const workflow = await loadProjectWorkflow(project);
    return withFileLock(`task:${project}/${id}`, () => updateTaskUnlocked(project, id, patch, workflow, expectedVersion));
  });
}

async function updateTaskUnlocked(
  project: string,
  id: string,
  patch: Partial<Omit<Task, 'id' | 'project' | 'createdAt'>>,
  workflow?: ProjectWorkflow,
  expectedVersion?: number,
): Promise<Task | null> {
  const existing = await getTask(project, id);
  if (!existing) return null;

  if (patch.status !== undefined) {
    const nextStatus = String(patch.status);
    const effectiveWorkflow = workflow ?? await loadProjectWorkflow(project);
    assertStatusAllowed(effectiveWorkflow, nextStatus);
    if (existing.status !== nextStatus) assertTransition(effectiveWorkflow, existing.status, nextStatus);
  }
  if (patch.type !== undefined) {
    const projectTypes = await loadProjectTypes(project);
    assertTypeAllowed(projectTypes.types, String(patch.type));
  }

  // If parentId is being modified, validate new parent existence and protect against cycles
  const hasParentPatch = Object.prototype.hasOwnProperty.call(patch as any, 'parentId');
  // If dependsOn is being modified, validate no cycles
  const hasDepsPatch = Object.prototype.hasOwnProperty.call(patch as any, 'dependsOn');
  let normalizedPatch: any = { ...patch };
  if (hasParentPatch) {
    const items = await listTasks({ project, includeArchived: true });
    const byId = new Map(items.map((t) => [t.id, t] as const));
    // Normalize null -> undefined (detach to root); AC-01: '' means the same thing.
    let parentId = (normalizedPatch as any).parentId as string | undefined | null;
    if (parentId === null || blankToUndefined(parentId) === undefined) parentId = undefined;
    if (parentId) {
      const parent = byId.get(parentId);
      if (!parent) {
        throw new Error(`Parent not found: ${project}/${parentId}`);
      }
      // Cycle check: walk up from target parent to root
      let p = parent.parentId as string | undefined;
      while (p) {
        if (p === id) {
          throw new WorkflowError('DEPENDENCY_CYCLE', `Cycle detected: cannot move ${id} under ${parentId}`);
        }
        p = byId.get(p)?.parentId;
      }
    }
    normalizedPatch.parentId = parentId as any;
    // Validate depth limit
    if (parentId) {
      await validateParentDepth(project, id, parentId);
    }
  }

  if (hasDepsPatch) {
    const newDeps = (normalizedPatch as any).dependsOn as string[] | undefined;
    if (Array.isArray(newDeps) && newDeps.length > 0) {
      const items = await listTasks({ project, includeArchived: true, includeTrashed: true });
      const byId = new Map(items.map((t) => [t.id, t] as const));

      // Validate all dependency targets exist
      for (const depId of newDeps) {
        if (!byId.has(depId)) {
          throw new Error(`Dependency task not found: ${project}/${depId}`);
        }
        if (depId === id) {
          throw new Error(`Task cannot depend on itself: ${id}`);
        }
      }

      // Validate no cycles in the new dependency graph
      const allIds = new Set(byId.keys());
      const existingEdges: Array<[string, string]> = [];
      for (const t of items) {
        if (t.id === id) continue; // skip current task (we're replacing its deps)
        for (const depId of (t.dependsOn || [])) {
          if (byId.has(depId)) existingEdges.push([t.id, depId]);
        }
      }
      const newEdges: Array<[string, string]> = newDeps
        .filter(depId => byId.has(depId))
        .map(depId => [id, depId]);

      const cycleNodes = detectDependencyCycle(allIds, existingEdges, newEdges);
      if (cycleNodes.length > 0) {
        throw new WorkflowError('DEPENDENCY_CYCLE', `Dependency cycle detected involving tasks: ${cycleNodes.join(', ')}`, 'Remove one of the edges in the cycle', { taskIds: cycleNodes });
      }
    }
    normalizedPatch.dependsOn = newDeps;
  }

  const versionState = nextTaskVersion(existing, normalizedPatch as Record<string, unknown>, expectedVersion);
  const updated: Task = {
    ...existing,
    ...normalizedPatch,
    id: existing.id,
    project: existing.project,
    type: normalizedPatch.type ?? existing.type ?? 'task',
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
    version: versionState.version,
    fieldVersions: versionState.fieldVersions,
  };
  const p = (await resolveDataFile(resolveUnder(TASKS_DIR, project), id, '.json')) ?? resolveUnder(TASKS_DIR, project, `${id}.json`);
  await ensureDir(path.dirname(p));
  await writeJson(p, updated);
  await indexTaskWrite(project, updated, p);
  void enqueueHistory([p]).catch(() => undefined);
  noteTaskWritten(updated);
  return updated;
}

export async function closeTask(project: string, id: string): Promise<Task | null> {
  return withFileLock(`workflow:${project}`, async () => {
    const workflow = await loadProjectWorkflow(project);
    return withFileLock(`task:${project}/${id}`, () =>
      updateTaskUnlocked(project, id, { status: closeStatusId(workflow) }, workflow));
  });
}

/**
 * Move tasks to a status while the caller already holds the project workflow
 * lock. Used by project_statuses_set for an atomic rename/removal.
 */
/**
 * Move tasks to a type while the caller holds the project workflow lock.
 * Used by project_types_set when a used type is removed.
 */
export async function moveTasksToType(project: string, ids: string[], type: string): Promise<Task[]> {
  const updated: Task[] = [];
  for (const id of ids) {
    const next = await withFileLock(`task:${project}/${id}`, async () => {
      const task = await readTaskRaw(project, id);
      if (!task) return null;
      if ((task.type ?? 'task') === type) return task;
      const moved: Task = { ...task, type, updatedAt: new Date().toISOString() };
      const file = taskFilePath(project, id);
      await writeJson(file, moved);
      await indexTaskWrite(project, moved, file);
      noteTaskWritten(moved);
      return moved;
    });
    if (next) updated.push(next);
  }
  return updated;
}

export async function moveTasksToStatus(project: string, ids: string[], status: string): Promise<Task[]> {
  const updated: Task[] = [];
  for (const id of ids) {
    const next = await withFileLock(`task:${project}/${id}`, async () => {
      const task = await readTaskRaw(project, id);
      if (!task) return null;
      if (task.status === status) return { ...task, type: task.type ?? 'task' };
      const moved: Task = { ...task, type: task.type ?? 'task', status, updatedAt: new Date().toISOString() };
      const file = taskFilePath(project, id);
      await writeJson(file, moved);
      await indexTaskWrite(project, moved, file);
      noteTaskWritten(moved);
      return moved;
    });
    if (next) updated.push(next);
  }
  return updated;
}

/**
 * Close a task and automatically unblock dependent tasks whose all
 * dependencies are now completed/closed. Returns the closed task plus
 * the list of tasks that were unblocked.
 */
export async function closeTaskAndUnblock(project: string, id: string): Promise<{
  closed: Task | null;
  unblocked: Task[];
}> {
  const closed = await closeTask(project, id);
  if (!closed) return { closed: null, unblocked: [] };

  // Find tasks that depend on the just-closed task
  const allTasks = await listTasks({ project, includeArchived: true, includeTrashed: true });
  const byId = new Map(allTasks.map(t => [t.id, t] as const));
  const dependents = getBlockedByTask(id, byId);

  const workflow = await loadProjectWorkflow(project);
  const unblocked: Task[] = [];
  for (const dep of dependents) {
    if (isDone(workflow, dep.status)) continue;
    const { blocked } = isTaskBlocked(dep, byId, (status) => isDone(workflow, status));
    if (!blocked && dep.status === 'blocked') {
      const updated = await updateTask(project, dep.id, { status: defaultStatusId(workflow) });
      if (updated) unblocked.push(updated);
    }
  }

  return { closed, unblocked };
}

// --- Hierarchy helpers ---

/** Maximum allowed nesting depth for task trees */

/**
 * Compute the depth of a task in the hierarchy (root = 0).
 * Returns -1 if the task does not exist.
 */
export async function getTaskDepth(project: string, id: string): Promise<number> {
  const tasks = await listTasks({ project, includeArchived: true, includeTrashed: true });
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  let depth = 0;
  let current = byId.get(id);
  if (!current) return -1;
  while (current?.parentId && byId.has(current.parentId)) {
    depth++;
    current = byId.get(current.parentId)!;
  }
  return depth;
}

/**
 * Validate that setting `parentId` on a task would not exceed MAX_TASK_DEPTH.
 * Throws if the resulting depth would be too deep.
 */
export async function validateParentDepth(
  project: string,
  taskId: string,
  newParentId: string | undefined
): Promise<void> {
  if (!newParentId) return;
  const parentDepth = await getTaskDepth(project, newParentId);
  if (parentDepth < 0) {
    throw new Error(`Parent task not found: ${project}/${newParentId}`);
  }
  if (parentDepth + 1 >= MAX_TASK_DEPTH) {
    throw new Error(
      `Maximum task depth (${MAX_TASK_DEPTH}) exceeded. ` +
      `Parent is at depth ${parentDepth}, child would be at depth ${parentDepth + 1}.`
    );
  }
}

/**
 * Get a specific task and all its descendants as a tree.
 * Returns null if the root task is not found.
 */
export async function getTaskSubtree(project: string, rootId: string): Promise<TaskTreeNode | null> {
  const tasks = await listTasks({ project, includeArchived: true, includeTrashed: true });
  const byId = new Map<string, Task>();
  for (const t of tasks) {
    byId.set(t.id, t);
  }
  const root = byId.get(rootId);
  if (!root) return null;

  // Recursively collect all descendants
  const allDescendants: Task[] = [];
  const collect = (parentId: string) => {
    const children = tasks.filter((t) => t.parentId === parentId);
    for (const child of children) {
      allDescendants.push(child);
      collect(child.id);
    }
  };
  collect(rootId);

  // Build tree from root + all descendants
  const allNodes = [root, ...allDescendants];
  const treeNodeMap = new Map<string, TaskTreeNode>();
  for (const t of allNodes) {
    treeNodeMap.set(t.id, { ...t, children: [] });
  }
  let rootNode = treeNodeMap.get(rootId)!;
  for (const node of treeNodeMap.values()) {
    if (node.id === rootId) continue;
    if (node.parentId && treeNodeMap.has(node.parentId)) {
      treeNodeMap.get(node.parentId)!.children.push(node);
    }
  }

  // Sort children recursively
  const sortRec = (n: TaskTreeNode) => {
    n.children.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    n.children.forEach(sortRec);
  };
  sortRec(rootNode);

  return rootNode;
}

/**
 * Get all direct children of a task (one level only).
 * Returns empty array if the task is not found.
 */
export async function getDirectChildren(project: string, parentId: string): Promise<Task[]> {
  const tasks = await listTasks({ project, includeArchived: true, includeTrashed: true });
  return tasks.filter((t) => t.parentId === parentId);
}

/**
 * Close a task and optionally cascade the close to all descendants.
 * Returns an array of all closed tasks (root + descendants if cascaded).
 */
export async function closeTaskWithCascade(
  project: string,
  id: string,
  cascade: boolean = false
): Promise<{ root: Task | null; cascaded: Task[] }> {
  const root = await closeTask(project, id);
  if (!root) return { root: null, cascaded: [] };
  if (!cascade) return { root, cascaded: [] };

  // Collect all descendants
  const children = await getDirectChildren(project, id);
  const cascaded: Task[] = [];
  const queue = [...children];
  while (queue.length > 0) {
    const child = queue.shift()!;
    const closed = await closeTask(project, child.id);
    if (closed) cascaded.push(closed);
    const grandchildren = await getDirectChildren(project, child.id);
    queue.push(...grandchildren);
  }

  return { root, cascaded };
}

async function listAllProjects(): Promise<string[]> {
  const fs = await import('node:fs/promises');
  try {
    const entries = (await fs.readdir(TASKS_DIR, { withFileTypes: true })) as Dirent[];
    const projects: string[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      projects.push(e.name);
    }
    return projects;
  } catch {
    return [];
  }
}

// --- Dependency Graph (DAG) helpers ---

/**
 * Validate that adding dependency edges would not create a cycle.
 * `edges` is an array of [fromId, toId] meaning fromId depends on toId.
 * Throws if a cycle is detected.
 */
export function detectDependencyCycle(
  allIds: Set<string>,
  edges: Array<[string, string]>,
  newEdges?: Array<[string, string]>
): string[] {
  // Build adjacency list: dependency -> dependents (who depends on this)
  const adj = new Map<string, Set<string>>();
  for (const id of allIds) adj.set(id, new Set());
  const allEdges = [...edges, ...(newEdges || [])];
  for (const [from, to] of allEdges) {
    if (!adj.has(from)) adj.set(from, new Set());
    if (!adj.has(to)) adj.set(to, new Set());
    adj.get(to)!.add(from); // to -> from (from depends on to)
  }

  // Kahn's algorithm: count in-degrees
  const inDegree = new Map<string, number>();
  for (const id of allIds) inDegree.set(id, 0);
  for (const [from] of allEdges) {
    inDegree.set(from, (inDegree.get(from) || 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const visited: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    visited.push(node);
    for (const neighbor of (adj.get(node) || [])) {
      const newDeg = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  // If not all nodes visited, there's a cycle
  const visitedSet = new Set(visited);
  return Array.from(allIds).filter(id => !visitedSet.has(id));
}

/**
 * Topological sort of tasks based on dependsOn relationships.
 * Returns tasks in execution order (dependencies first).
 */
export function topologicalSort(tasks: Task[]): Task[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>(); // dep -> [dependents]

  for (const t of tasks) {
    inDegree.set(t.id, 0);
    adj.set(t.id, []);
  }

  for (const t of tasks) {
    const deps = t.dependsOn || [];
    inDegree.set(t.id, deps.length);
    for (const depId of deps) {
      if (adj.has(depId)) {
        adj.get(depId)!.push(t.id);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: Task[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const task = byId.get(id);
    if (task) sorted.push(task);
    for (const dependent of (adj.get(id) || [])) {
      const newDeg = (inDegree.get(dependent) || 1) - 1;
      inDegree.set(dependent, newDeg);
      if (newDeg === 0) queue.push(dependent);
    }
  }

  return sorted;
}

/**
 * Get critical path through the dependency graph.
 * Returns the longest path of tasks from roots to leaves (by updatedAt chain).
 */
export function getCriticalPath(tasks: Task[]): Task[] {
  const sorted = topologicalSort(tasks);
  const byId = new Map(tasks.map(t => [t.id, t]));
  const earliestEnd = new Map<string, number>();

  for (const t of sorted) {
    const deps = (t.dependsOn || []).filter(id => byId.has(id));
    const maxDepEnd = deps.length > 0
      ? Math.max(...deps.map(id => earliestEnd.get(id) || 0))
      : 0;
    // Use updatedAt timestamp as a proxy for duration
    const start = maxDepEnd;
    const end = start + 1; // each task has unit weight
    earliestEnd.set(t.id, end);
  }

  // Find the task with the maximum earliestEnd
  let maxEnd = 0;
  let lastId = '';
  for (const [id, end] of earliestEnd) {
    if (end > maxEnd) { maxEnd = end; lastId = id; }
  }

  // Trace back from lastId
  const path: Task[] = [];
  let current = lastId;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const task = byId.get(current);
    if (!task) break;
    path.unshift(task);
    // Find which dependency leads to this task's earliestEnd
    const deps = (task.dependsOn || []).filter(id => byId.has(id));
    if (deps.length === 0) break;
    let bestDep = '';
    let bestEnd = -1;
    for (const depId of deps) {
      const depEnd = earliestEnd.get(depId) || 0;
      if (depEnd > bestEnd) { bestEnd = depEnd; bestDep = depId; }
    }
    current = bestDep;
  }

  return path;
}

/**
 * Get tasks that are blocking a given task (its direct dependencies).
 */
export function getBlockingTasks(task: Task, allTasks: Map<string, Task>): Task[] {
  return (task.dependsOn || [])
    .map(id => allTasks.get(id))
    .filter((t): t is Task => !!t);
}

/**
 * Get tasks that are blocked by a given task (its dependents).
 */
export function getBlockedByTask(taskId: string, allTasks: Map<string, Task>): Task[] {
  return Array.from(allTasks.values())
    .filter(t => (t.dependsOn || []).includes(taskId));
}

/**
 * Check if a task is blocked (has unmet dependencies).
 * A task is blocked if it has dependsOn entries and any of them
 * are not completed/closed.
 */
export function isTaskBlocked(
  task: Task,
  allTasks: Map<string, Task>,
  isDoneStatus: (status: string) => boolean = (status) => status === 'completed' || status === 'closed',
): { blocked: boolean; blockingDeps: Task[] } {
  const deps = (task.dependsOn || []).map(id => allTasks.get(id)).filter((t): t is Task => !!t);
  const unmet = deps.filter(d => !isDoneStatus(d.status));
  return { blocked: unmet.length > 0, blockingDeps: unmet };
}

/**
 * Build a full DAG representation for a project.
 * Returns nodes and edges for visualization.
 */
export function buildDAG(tasks: Task[]): { nodes: Task[]; edges: Array<{ from: string; to: string }> } {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const edges: Array<{ from: string; to: string }> = [];
  for (const t of tasks) {
    for (const depId of (t.dependsOn || [])) {
      if (byId.has(depId)) {
        edges.push({ from: t.id, to: depId }); // t depends on depId
      }
    }
  }
  return { nodes: tasks, edges };
}
