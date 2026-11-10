/**
 * Z-10 — agent target registry for prompts and skills.
 *
 * The registry lives in project metadata (`.project.json`) like task types do. Built-in targets are
 * always present; custom targets are added by name. A target that is still used by a prompt cannot
 * be removed without `moveTo`/`moves`, and a move rewrites the prompt metadata in place so a later
 * `prompts_list target=…` sees the new value.
 */

import fs from 'node:fs/promises';
import type { PromptStore } from './storage/contracts.js';
import { readProjectMetadata, updateProjectMeta } from './projects.js';

export const BUILTIN_AGENT_TARGETS = ['universal', 'claude', 'opencode'] as const;
export const DEFAULT_AGENT_TARGET = 'universal';
const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export class AgentTargetError extends Error {
  constructor(
    readonly code: 'INVALID_TARGET' | 'BUILTIN_TARGET_IMMUTABLE' | 'AGENT_TARGET_IN_USE',
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AgentTargetError';
  }

  toPayload(): { code: string; message: string; details?: Record<string, unknown> } {
    return { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }
}

/** Missing or blank target is universal (the migration rule). */
export function normalizeAgentTarget(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_AGENT_TARGET;
  const target = value.trim().toLowerCase();
  return target.length > 0 ? target : DEFAULT_AGENT_TARGET;
}

function normalizeTargetId(value: string): string {
  const id = value.trim().toLowerCase();
  if (!AGENT_ID_RE.test(id)) {
    throw new AgentTargetError('INVALID_TARGET', `invalid agent target: ${value}`);
  }
  return id;
}

export interface AgentTargetView {
  project: string;
  agents: Array<{ id: string; builtin: boolean }>;
  defaults: boolean;
}

export async function getProjectAgents(project: string): Promise<AgentTargetView> {
  const meta = await readProjectMetadata(project);
  const stored = Array.isArray(meta?.agents) ? meta.agents : null;
  const ids = stored ?? [...BUILTIN_AGENT_TARGETS];
  const normalized = Array.from(new Set(ids.map((id) => normalizeAgentTarget(id))));
  for (const builtin of BUILTIN_AGENT_TARGETS) {
    if (!normalized.includes(builtin)) normalized.push(builtin);
  }
  return {
    project,
    agents: normalized.map((id) => ({ id, builtin: (BUILTIN_AGENT_TARGETS as readonly string[]).includes(id) })),
    defaults: stored === null,
  };
}

export interface AgentTargetSetInput {
  agents: string[];
  moveTo?: string;
  moves?: Record<string, string>;
}

interface PromptTargetUsage {
  id: string;
  path: string;
  target: string;
}

async function usedPromptTargets(project: string, store: PromptStore): Promise<PromptTargetUsage[]> {
  const sources = await store.list(project);
  const seen = new Set<string>();
  const usage: PromptTargetUsage[] = [];
  for (const source of sources) {
    if (seen.has(source.id)) continue;
    seen.add(source.id);
    const record = await store.get(project, source.id);
    if (!record) continue;
    const metadata = (record.data?.metadata ?? {}) as Record<string, unknown>;
    usage.push({ id: source.id, path: record.path, target: normalizeAgentTarget(metadata.target) });
  }
  return usage;
}

async function rewritePromptTarget(file: string, target: string): Promise<void> {
  const raw = await fs.readFile(file, 'utf8');
  const data = JSON.parse(raw) as Record<string, any>;
  data.metadata = { ...(data.metadata ?? {}), target };
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function setProjectAgents(
  project: string,
  input: AgentTargetSetInput,
  store: PromptStore,
): Promise<AgentTargetView & { moved: Array<{ id: string; from: string; to: string }> }> {
  const requested = input.agents.map(normalizeTargetId);
  if (requested.length === 0) throw new AgentTargetError('INVALID_TARGET', 'agents must not be empty');
  const next = Array.from(new Set([...BUILTIN_AGENT_TARGETS, ...requested]));
  const nextSet = new Set(next);
  const current = await getProjectAgents(project);
  const removed = current.agents.map((agent) => agent.id).filter((id) => !nextSet.has(id));
  const usage = await usedPromptTargets(project, store);
  const moved: Array<{ id: string; from: string; to: string }> = [];

  for (const from of removed) {
    const affected = usage.filter((item) => item.target === from);
    if (affected.length === 0) continue;
    const target = input.moves?.[from] ?? input.moveTo;
    if (!target) {
      throw new AgentTargetError(
        'AGENT_TARGET_IN_USE',
        `agent target '${from}' is used by ${affected.length} prompt(s); pass moveTo or moves`,
        { target: from, promptIds: affected.slice(0, 20).map((item) => item.id), total: affected.length },
      );
    }
    const to = normalizeTargetId(target);
    if (!nextSet.has(to)) {
      throw new AgentTargetError('INVALID_TARGET', `move target '${to}' is not in the new agent list`);
    }
    for (const item of affected) {
      await rewritePromptTarget(item.path, to);
      moved.push({ id: item.id, from, to });
    }
  }

  await updateProjectMeta(project, { agents: next });
  return { ...(await getProjectAgents(project)), moved };
}
