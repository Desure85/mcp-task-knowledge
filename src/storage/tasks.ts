import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TASKS_DIR } from '../config.js';
import { ensureDir, pathExists, readJson, resolveUnder, withFileLock, writeJson } from '../fs.js';
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
  type ProjectWorkflow,
} from '../workflow.js';
import type { Dirent } from 'node:fs';
import { promises as fs } from 'node:fs';
import { childLogger } from '../core/logger.js';

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
  const p = resolveUnder(TASKS_DIR, project, `${id}.json`);
  if (!(await pathExists(p))) return false;
  await fs.unlink(p);
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
      createdAt: now,
      updatedAt: now,
      parentId: input.parentId,
      archived: false,
      trashed: false,
    };
    const filePath = path.join(await tasksProjectDir(input.project), `${id}.json`);
    await writeJson(filePath, task);
    return task;
  });
}

function taskFilePath(project: string, id: string): string {
  return resolveUnder(TASKS_DIR, project, `${id}.json`);
}

async function readTaskRaw(project: string, id: string): Promise<Task | null> {
  const p = taskFilePath(project, id);
  if (!(await pathExists(p))) return null;
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
    const files = await (await import('node:fs/promises')).readdir(dir);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const t = withoutExpiredClaim(await readJson<Task>(path.join(dir, f)));
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

export const DEFAULT_CLAIM_TTL_SEC = 1800;
export const MIN_CLAIM_TTL_SEC = 30;
export const MAX_CLAIM_TTL_SEC = 86_400;

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
  await writeJson(taskFilePath(project, id), updated);
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

/** Remove expired claims from disk. Returns `<project>/<id>` for each cleaned task. */
export async function pruneExpiredClaims(project?: string): Promise<string[]> {
  const projects = project ? [project] : await listAllProjects();
  const pruned: string[] = [];

  for (const prj of projects) {
    const dir = resolveUnder(TASKS_DIR, prj);
    if (!(await pathExists(dir))) continue;
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const id = f.slice(0, -'.json'.length);
      let probe: Task;
      try {
        probe = await readJson<Task>(path.join(dir, f));
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

export async function updateTask(project: string, id: string, patch: Partial<Omit<Task, 'id' | 'project' | 'createdAt'>>): Promise<Task | null> {
  return withFileLock(`workflow:${project}`, async () => {
    const workflow = await loadProjectWorkflow(project);
    return withFileLock(`task:${project}/${id}`, () => updateTaskUnlocked(project, id, patch, workflow));
  });
}

async function updateTaskUnlocked(
  project: string,
  id: string,
  patch: Partial<Omit<Task, 'id' | 'project' | 'createdAt'>>,
  workflow?: ProjectWorkflow,
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
    // Normalize null -> undefined (detach to root)
    let parentId = (normalizedPatch as any).parentId as string | undefined | null;
    if (parentId === null) parentId = undefined;
    if (parentId) {
      const parent = byId.get(parentId);
      if (!parent) {
        throw new Error(`Parent not found: ${project}/${parentId}`);
      }
      // Cycle check: walk up from target parent to root
      let p = parent.parentId as string | undefined;
      while (p) {
        if (p === id) {
          throw new Error(`Cycle detected: cannot move ${id} under ${parentId}`);
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
        throw new Error(`Dependency cycle detected involving tasks: ${cycleNodes.join(', ')}`);
      }
    }
    normalizedPatch.dependsOn = newDeps;
  }

  const updated: Task = {
    ...existing,
    ...normalizedPatch,
    id: existing.id,
    project: existing.project,
    type: (normalizedPatch as any).type ?? existing.type ?? 'task',
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  const p = resolveUnder(TASKS_DIR, project, `${id}.json`);
  await writeJson(p, updated);
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
      await writeJson(taskFilePath(project, id), moved);
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
      await writeJson(taskFilePath(project, id), moved);
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
export const MAX_TASK_DEPTH = 10;

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
