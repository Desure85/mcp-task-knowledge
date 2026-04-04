import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { TASKS_DIR } from '../config.js';
import { ensureDir, pathExists, readJson, writeJson } from '../fs.js';
import type { Task, Priority, Status, TaskTreeNode } from '../types.js';
import type { Dirent } from 'node:fs';
import { promises as fs } from 'node:fs';

export async function tasksProjectDir(project: string) {
  const dir = path.join(TASKS_DIR, project);
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
  const p = path.join(TASKS_DIR, project, `${id}.json`);
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

  const id = uuidv4();
  const now = new Date().toISOString();
  const task: Task = {
    id,
    project: input.project,
    title: input.title,
    description: input.description,
    status: input.status || 'pending',
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
}

export async function listTasks(filter?: {
  project?: string;
  status?: Status;
  tag?: string;
  includeArchived?: boolean;
  includeTrashed?: boolean;
}): Promise<Task[]> {
  const projects = filter?.project ? [filter.project] : await listAllProjects();
  const results: Task[] = [];
  for (const project of projects) {
    // Prefer modern layout: TASKS_DIR/<project>/
    let dir = path.join(TASKS_DIR, project);
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
      const t = await readJson<Task>(path.join(dir, f));
      // skip trashed by default unless explicitly included
      if (!filter?.includeTrashed && (t as any).trashed) continue;
      // skip archived by default unless explicitly included
      if (!filter?.includeArchived && (t as any).archived) continue;
      if (filter?.status && t.status !== filter.status) continue;
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
  const p = path.join(TASKS_DIR, project, `${id}.json`);
  if (!(await pathExists(p))) return null;
  return readJson<Task>(p);
}

// Backwards-compatible alias expected by some tests
export async function readTask(project: string, id: string): Promise<Task | null> {
  return getTask(project, id);
}

export async function updateTask(project: string, id: string, patch: Partial<Omit<Task, 'id' | 'project' | 'createdAt'>>): Promise<Task | null> {
  const existing = await getTask(project, id);
  if (!existing) return null;

  // If parentId is being modified, validate new parent existence and protect against cycles
  const hasParentPatch = Object.prototype.hasOwnProperty.call(patch as any, 'parentId');
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

  const updated: Task = {
    ...existing,
    ...normalizedPatch,
    id: existing.id,
    project: existing.project,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  const p = path.join(TASKS_DIR, project, `${id}.json`);
  await writeJson(p, updated);
  return updated;
}

export async function closeTask(project: string, id: string): Promise<Task | null> {
  return updateTask(project, id, { status: 'closed' as Status });
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
