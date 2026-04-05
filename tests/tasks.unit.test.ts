import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';

// TMP envs must be set before dynamic imports
const TMP_DIR = path.join(process.cwd(), '.tmp-tests-tasks-unit');
process.env.DATA_DIR = TMP_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_DIR, 'vault');
process.env.EMBEDDINGS_MODE = 'none';

import type * as TasksNS from '../src/storage/tasks.js';
let tasks: typeof TasksNS;

function uniqProj(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

beforeAll(async () => {
  await rmrf(TMP_DIR);
  await fsp.mkdir(TMP_DIR, { recursive: true });
  await fsp.mkdir(process.env.OBSIDIAN_VAULT_ROOT!, { recursive: true });
  tasks = await import('../src/storage/tasks.js');
});

afterAll(async () => {
  await rmrf(TMP_DIR);
});

// ---------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------
describe('tasks: createTask', () => {
  it('creates task with all fields', async () => {
    const prj = uniqProj('create');
    const t = await tasks.createTask({
      project: prj,
      title: 'Full Task',
      description: 'A detailed description',
      priority: 'high',
      status: 'in_progress',
      tags: ['backend', 'urgent'],
      links: ['https://example.com'],
    });
    expect(t.id).toBeTruthy();
    expect(t.title).toBe('Full Task');
    expect(t.description).toBe('A detailed description');
    expect(t.priority).toBe('high');
    expect(t.status).toBe('in_progress');
    expect(t.tags).toEqual(['backend', 'urgent']);
    expect(t.links).toEqual(['https://example.com']);
    expect(t.project).toBe(prj);
    expect(t.createdAt).toBeTruthy();
    expect(t.updatedAt).toBeTruthy();
    expect(t.archived).toBe(false);
    expect(t.trashed).toBe(false);
  });

  it('creates task with minimal fields (defaults)', async () => {
    const prj = uniqProj('create-min');
    const t = await tasks.createTask({ project: prj, title: 'Minimal' });
    expect(t.priority).toBe('medium');
    expect(t.status).toBe('pending');
    expect(t.tags).toEqual([]);
    expect(t.links).toEqual([]);
    expect(t.description).toBeUndefined();
  });

  it('assigns unique IDs', async () => {
    const prj = uniqProj('create-ids');
    const t1 = await tasks.createTask({ project: prj, title: 'T1' });
    const t2 = await tasks.createTask({ project: prj, title: 'T2' });
    expect(t1.id).not.toBe(t2.id);
  });

  it('throws when parentId does not exist', async () => {
    const prj = uniqProj('create-bad-parent');
    await expect(
      tasks.createTask({ project: prj, title: 'Orphan', parentId: 'non-existent-id' })
    ).rejects.toThrow(/Parent task not found/);
  });
});

// ---------------------------------------------------------------------------
// getTask
// ---------------------------------------------------------------------------
describe('tasks: getTask', () => {
  it('returns task by id', async () => {
    const prj = uniqProj('get');
    const created = await tasks.createTask({ project: prj, title: 'Get Me' });
    const found = await tasks.getTask(prj, created.id);
    expect(found).toBeTruthy();
    expect(found!.id).toBe(created.id);
    expect(found!.title).toBe('Get Me');
  });

  it('returns null for non-existent id', async () => {
    const prj = uniqProj('get-missing');
    const found = await tasks.getTask(prj, 'non-existent');
    expect(found).toBeNull();
  });

  it('readTask is alias for getTask', async () => {
    const prj = uniqProj('readtask');
    const created = await tasks.createTask({ project: prj, title: 'Alias' });
    const viaRead = await tasks.readTask(prj, created.id);
    expect(viaRead!.id).toBe(created.id);
  });
});

// ---------------------------------------------------------------------------
// updateTask
// ---------------------------------------------------------------------------
describe('tasks: updateTask', () => {
  it('updates title and description', async () => {
    const prj = uniqProj('update');
    const t = await tasks.createTask({ project: prj, title: 'Old Title' });
    const updated = await tasks.updateTask(prj, t.id, { title: 'New Title', description: 'New desc' });
    expect(updated!.title).toBe('New Title');
    expect(updated!.description).toBe('New desc');
    // updatedAt changed
    expect(updated!.updatedAt).not.toBe(t.updatedAt);
    // id, project, createdAt preserved
    expect(updated!.id).toBe(t.id);
    expect(updated!.project).toBe(t.project);
    expect(updated!.createdAt).toBe(t.createdAt);
  });

  it('updates priority and status', async () => {
    const prj = uniqProj('update-priority');
    const t = await tasks.createTask({ project: prj, title: 'T' });
    const updated = await tasks.updateTask(prj, t.id, { priority: 'low', status: 'completed' });
    expect(updated!.priority).toBe('low');
    expect(updated!.status).toBe('completed');
  });

  it('updates tags (replaces, not merges)', async () => {
    const prj = uniqProj('update-tags');
    const t = await tasks.createTask({ project: prj, title: 'T', tags: ['a', 'b'] });
    const updated = await tasks.updateTask(prj, t.id, { tags: ['c'] });
    expect(updated!.tags).toEqual(['c']);
  });

  it('returns null for non-existent task', async () => {
    const prj = uniqProj('update-missing');
    const result = await tasks.updateTask(prj, 'non-existent', { title: 'X' });
    expect(result).toBeNull();
  });

  it('cannot modify id, project, or createdAt', async () => {
    const prj = uniqProj('update-immutable');
    const t = await tasks.createTask({ project: prj, title: 'Immutable' });
    const updated = await tasks.updateTask(prj, t.id, {
      id: 'hacked' as any,
      project: 'other' as any,
      createdAt: '2020-01-01' as any,
      title: 'Still Immutable',
    } as any);
    expect(updated!.id).toBe(t.id);
    expect(updated!.project).toBe(t.project);
    expect(updated!.createdAt).toBe(t.createdAt);
    expect(updated!.title).toBe('Still Immutable');
  });
});

// ---------------------------------------------------------------------------
// closeTask / closeTaskWithCascade
// ---------------------------------------------------------------------------
describe('tasks: closeTask', () => {
  it('sets status to closed', async () => {
    const prj = uniqProj('close');
    const t = await tasks.createTask({ project: prj, title: 'Close Me' });
    const closed = await tasks.closeTask(prj, t.id);
    expect(closed!.status).toBe('closed');
  });

  it('closeTaskAndUnblock unblocks dependent tasks', async () => {
    const prj = uniqProj('close-unblock');
    const blocker = await tasks.createTask({ project: prj, title: 'Blocker' });
    const dependent = await tasks.createTask({ project: prj, title: 'Dependent' });
    // Set dependent to blocked status
    await tasks.updateTask(prj, dependent.id, { status: 'blocked', dependsOn: [blocker.id] } as any);

    // Close blocker → should unblock dependent
    const result = await tasks.closeTaskAndUnblock(prj, blocker.id);
    expect(result.closed!.status).toBe('closed');
    expect(result.unblocked.length).toBe(1);
    expect(result.unblocked[0].id).toBe(dependent.id);
    expect(result.unblocked[0].status).toBe('pending');
  });

  it('closeTaskWithCascade closes all descendants', async () => {
    const prj = uniqProj('close-cascade');
    const root = await tasks.createTask({ project: prj, title: 'Root' });
    const child1 = await tasks.createTask({ project: prj, title: 'Child1', parentId: root.id });
    const child2 = await tasks.createTask({ project: prj, title: 'Child2', parentId: root.id });
    const grandchild = await tasks.createTask({ project: prj, title: 'Grandchild', parentId: child1.id });

    const result = await tasks.closeTaskWithCascade(prj, root.id, true);
    expect(result.root!.status).toBe('closed');
    expect(result.cascaded.length).toBe(3);
    const closedIds = new Set(result.cascaded.map(t => t.id));
    expect(closedIds.has(child1.id)).toBe(true);
    expect(closedIds.has(child2.id)).toBe(true);
    expect(closedIds.has(grandchild.id)).toBe(true);
  });

  it('closeTaskWithCascade with cascade=false only closes root', async () => {
    const prj = uniqProj('close-nocascade');
    const root = await tasks.createTask({ project: prj, title: 'Root' });
    await tasks.createTask({ project: prj, title: 'Child', parentId: root.id });

    const result = await tasks.closeTaskWithCascade(prj, root.id, false);
    expect(result.root!.status).toBe('closed');
    expect(result.cascaded.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// archiveTask / trashTask / restoreTask / deleteTaskPermanent
// ---------------------------------------------------------------------------
describe('tasks: lifecycle (archive/trash/restore/delete)', () => {
  it('archive sets archived=true', async () => {
    const prj = uniqProj('archive');
    const t = await tasks.createTask({ project: prj, title: 'Archive Me' });
    const archived = await tasks.archiveTask(prj, t.id);
    expect(archived!.archived).toBe(true);
    // archived task not in default list
    const list = await tasks.listTasks({ project: prj });
    expect(list.find(x => x.id === t.id)).toBeUndefined();
  });

  it('trash sets trashed=true', async () => {
    const prj = uniqProj('trash');
    const t = await tasks.createTask({ project: prj, title: 'Trash Me' });
    const trashed = await tasks.trashTask(prj, t.id);
    expect(trashed!.trashed).toBe(true);
  });

  it('restore clears archived and trashed', async () => {
    const prj = uniqProj('restore');
    const t = await tasks.createTask({ project: prj, title: 'Restore Me' });
    await tasks.archiveTask(prj, t.id);
    const restored = await tasks.restoreTask(prj, t.id);
    expect(restored!.archived).toBe(false);
    expect(restored!.trashed).toBe(false);
  });

  it('deleteTaskPermanent removes the file', async () => {
    const prj = uniqProj('delete-perm');
    const t = await tasks.createTask({ project: prj, title: 'Delete Me' });
    const ok = await tasks.deleteTaskPermanent(prj, t.id);
    expect(ok).toBe(true);
    const found = await tasks.getTask(prj, t.id);
    expect(found).toBeNull();
  });

  it('deleteTaskPermanent returns false for missing', async () => {
    const prj = uniqProj('delete-missing');
    const ok = await tasks.deleteTaskPermanent(prj, 'non-existent');
    expect(ok).toBe(false);
  });

  it('lifecycle ops return null for missing task', async () => {
    const prj = uniqProj('lifecycle-missing');
    expect(await tasks.archiveTask(prj, 'nope')).toBeNull();
    expect(await tasks.trashTask(prj, 'nope')).toBeNull();
    expect(await tasks.restoreTask(prj, 'nope')).toBeNull();
    expect(await tasks.closeTask(prj, 'nope')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listTasks — filters
// ---------------------------------------------------------------------------
describe('tasks: listTasks filtering', () => {
  it('filters by status', async () => {
    const prj = uniqProj('filter-status');
    await tasks.createTask({ project: prj, title: 'P', status: 'pending' });
    await tasks.createTask({ project: prj, title: 'IP', status: 'in_progress' });
    await tasks.createTask({ project: prj, title: 'C', status: 'completed' });

    const pending = await tasks.listTasks({ project: prj, status: 'pending' });
    expect(pending.length).toBe(1);
    expect(pending[0].title).toBe('P');

    const ip = await tasks.listTasks({ project: prj, status: 'in_progress' });
    expect(ip.length).toBe(1);
  });

  it('filters by tag', async () => {
    const prj = uniqProj('filter-tag');
    await tasks.createTask({ project: prj, title: 'A', tags: ['api'] });
    await tasks.createTask({ project: prj, title: 'B', tags: ['ui'] });
    await tasks.createTask({ project: prj, title: 'C', tags: ['api', 'urgent'] });

    const api = await tasks.listTasks({ project: prj, tag: 'api' });
    expect(api.length).toBe(2);
    const urgent = await tasks.listTasks({ project: prj, tag: 'urgent' });
    expect(urgent.length).toBe(1);
  });

  it('filters by project (cross-project isolation)', async () => {
    const prjA = uniqProj('proj-a');
    const prjB = uniqProj('proj-b');
    await tasks.createTask({ project: prjA, title: 'In A' });
    await tasks.createTask({ project: prjB, title: 'In B' });

    const listA = await tasks.listTasks({ project: prjA });
    const listB = await tasks.listTasks({ project: prjB });
    expect(listA.length).toBe(1);
    expect(listB.length).toBe(1);
    expect(listA[0].title).toBe('In A');
    expect(listB[0].title).toBe('In B');
  });

  it('default: excludes archived and trashed', async () => {
    const prj = uniqProj('filter-default');
    const t1 = await tasks.createTask({ project: prj, title: 'Normal' });
    const t2 = await tasks.createTask({ project: prj, title: 'Archived' });
    const t3 = await tasks.createTask({ project: prj, title: 'Trashed' });
    await tasks.archiveTask(prj, t2.id);
    await tasks.trashTask(prj, t3.id);

    const list = await tasks.listTasks({ project: prj });
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(t1.id);
  });

  it('includeTrashed shows trashed but not archived', async () => {
    const prj = uniqProj('filter-trashed');
    const t1 = await tasks.createTask({ project: prj, title: 'Normal' });
    const t2 = await tasks.createTask({ project: prj, title: 'Trashed' });
    const t3 = await tasks.createTask({ project: prj, title: 'Archived' });
    await tasks.trashTask(prj, t2.id);
    await tasks.archiveTask(prj, t3.id);

    const list = await tasks.listTasks({ project: prj, includeTrashed: true });
    const ids = list.map(t => t.id);
    expect(ids).toContain(t1.id);
    expect(ids).toContain(t2.id);
    expect(ids).not.toContain(t3.id);
  });

  it('results sorted by updatedAt desc', async () => {
    const prj = uniqProj('filter-sort');
    const t1 = await tasks.createTask({ project: prj, title: 'First' });
    // Small delay to ensure different timestamps
    await new Promise(r => setTimeout(r, 5));
    const t2 = await tasks.createTask({ project: prj, title: 'Second' });

    const list = await tasks.listTasks({ project: prj });
    expect(list[0].id).toBe(t2.id); // newer first
    expect(list[1].id).toBe(t1.id);
  });
});

// ---------------------------------------------------------------------------
// listTasksTree
// ---------------------------------------------------------------------------
describe('tasks: listTasksTree', () => {
  it('builds tree from flat tasks', async () => {
    const prj = uniqProj('tree-basic');
    const root = await tasks.createTask({ project: prj, title: 'Root' });
    const child1 = await tasks.createTask({ project: prj, title: 'Child1', parentId: root.id });
    const child2 = await tasks.createTask({ project: prj, title: 'Child2', parentId: root.id });

    const tree = await tasks.listTasksTree({ project: prj });
    expect(tree.length).toBe(1);
    expect(tree[0].id).toBe(root.id);
    expect(tree[0].children.length).toBe(2);
    const childIds = tree[0].children.map(c => c.id);
    expect(childIds).toContain(child1.id);
    expect(childIds).toContain(child2.id);
  });

  it('multiple roots when no parentId', async () => {
    const prj = uniqProj('tree-multi-root');
    const r1 = await tasks.createTask({ project: prj, title: 'Root1' });
    const r2 = await tasks.createTask({ project: prj, title: 'Root2' });

    const tree = await tasks.listTasksTree({ project: prj });
    expect(tree.length).toBe(2);
  });

  it('detached parentId (null) treated as root', async () => {
    const prj = uniqProj('tree-detach');
    const root = await tasks.createTask({ project: prj, title: 'Root' });
    const child = await tasks.createTask({ project: prj, title: 'Child', parentId: root.id });

    // Detach child
    await tasks.updateTask(prj, child.id, { parentId: null as any });

    const tree = await tasks.listTasksTree({ project: prj });
    expect(tree.length).toBe(2);
    const rootIds = tree.map(n => n.id);
    expect(rootIds).toContain(root.id);
    expect(rootIds).toContain(child.id);
  });
});

// ---------------------------------------------------------------------------
// getTaskSubtree / getDirectChildren / getTaskDepth
// ---------------------------------------------------------------------------
describe('tasks: subtree helpers', () => {
  it('getTaskSubtree returns root + all descendants', async () => {
    const prj = uniqProj('subtree');
    const root = await tasks.createTask({ project: prj, title: 'Root' });
    const c1 = await tasks.createTask({ project: prj, title: 'C1', parentId: root.id });
    const c2 = await tasks.createTask({ project: prj, title: 'C2', parentId: root.id });
    const gc = await tasks.createTask({ project: prj, title: 'GC', parentId: c1.id });

    const subtree = await tasks.getTaskSubtree(prj, root.id);
    expect(subtree).toBeTruthy();
    expect(subtree!.id).toBe(root.id);
    expect(subtree!.children.length).toBe(2);
    // c1 has child gc
    const c1Node = subtree!.children.find(c => c.id === c1.id)!;
    expect(c1Node.children.length).toBe(1);
    expect(c1Node.children[0].id).toBe(gc.id);
  });

  it('getTaskSubtree returns null for missing root', async () => {
    const prj = uniqProj('subtree-missing');
    const result = await tasks.getTaskSubtree(prj, 'non-existent');
    expect(result).toBeNull();
  });

  it('getDirectChildren returns one level only', async () => {
    const prj = uniqProj('direct-children');
    const root = await tasks.createTask({ project: prj, title: 'Root' });
    const c1 = await tasks.createTask({ project: prj, title: 'C1', parentId: root.id });
    await tasks.createTask({ project: prj, title: 'GC', parentId: c1.id });

    const children = await tasks.getDirectChildren(prj, root.id);
    expect(children.length).toBe(1);
    expect(children[0].id).toBe(c1.id);
  });

  it('getTaskDepth returns 0 for root', async () => {
    const prj = uniqProj('depth-root');
    const root = await tasks.createTask({ project: prj, title: 'Root' });
    expect(await tasks.getTaskDepth(prj, root.id)).toBe(0);
  });

  it('getTaskDepth returns correct depth for nested tasks', async () => {
    const prj = uniqProj('depth-nested');
    const root = await tasks.createTask({ project: prj, title: 'L0' });
    const c1 = await tasks.createTask({ project: prj, title: 'L1', parentId: root.id });
    const c2 = await tasks.createTask({ project: prj, title: 'L2', parentId: c1.id });

    expect(await tasks.getTaskDepth(prj, root.id)).toBe(0);
    expect(await tasks.getTaskDepth(prj, c1.id)).toBe(1);
    expect(await tasks.getTaskDepth(prj, c2.id)).toBe(2);
  });

  it('getTaskDepth returns -1 for missing task', async () => {
    const prj = uniqProj('depth-missing');
    expect(await tasks.getTaskDepth(prj, 'non-existent')).toBe(-1);
  });

  it('validateParentDepth rejects nesting at MAX_TASK_DEPTH', async () => {
    const prj = uniqProj('depth-validate');
    // Create a chain of MAX_TASK_DEPTH - 1 tasks (depth 0..MAX-2)
    let parentId: string | undefined;
    const MAX = tasks.MAX_TASK_DEPTH;
    for (let i = 0; i < MAX - 1; i++) {
      const t = await tasks.createTask({
        project: prj,
        title: `L${i}`,
        parentId,
      });
      parentId = t.id;
    }
    // parentId is now at depth MAX-2; adding child would be at depth MAX-1 which is < MAX
    // So it should succeed. Now try one more (depth MAX-1 + 1 = MAX, which equals MAX → rejected)
    const almostDeep = await tasks.createTask({ project: prj, title: 'AlmostDeep', parentId });
    // Now almostDeep is at depth MAX-1. One more child = depth MAX → should be rejected
    await expect(
      tasks.createTask({ project: prj, title: 'TooDeep', parentId: almostDeep.id })
    ).rejects.toThrow(/Maximum task depth/);
  });
});

// ---------------------------------------------------------------------------
// Dependency graph pure functions
// ---------------------------------------------------------------------------
describe('tasks: detectDependencyCycle', () => {
  it('returns empty for no cycle', () => {
    const ids = new Set(['a', 'b', 'c']);
    const edges: [string, string][] = [['b', 'a'], ['c', 'a']]; // b depends on a, c depends on a
    const result = tasks.detectDependencyCycle(ids, edges);
    expect(result).toEqual([]);
  });

  it('detects simple cycle', () => {
    const ids = new Set(['a', 'b']);
    const edges: [string, string][] = [['a', 'b'], ['b', 'a']];
    const result = tasks.detectDependencyCycle(ids, edges);
    expect(result.length).toBeGreaterThan(0);
  });

  it('detects longer cycle (a→b→c→a)', () => {
    const ids = new Set(['a', 'b', 'c']);
    const edges: [string, string][] = [['a', 'b'], ['b', 'c'], ['c', 'a']];
    const result = tasks.detectDependencyCycle(ids, edges);
    expect(result.length).toBeGreaterThan(0);
  });

  it('no cycle with single edge', () => {
    const ids = new Set(['a', 'b']);
    const edges: [string, string][] = [['a', 'b']];
    expect(tasks.detectDependencyCycle(ids, edges)).toEqual([]);
  });

  it('no cycle with empty edges', () => {
    const ids = new Set(['a', 'b', 'c']);
    expect(tasks.detectDependencyCycle(ids, [])).toEqual([]);
  });

  it('detects cycle in new edges while existing edges are acyclic', () => {
    const ids = new Set(['a', 'b', 'c']);
    const edges: [string, string][] = [['a', 'b']]; // existing: a depends on b
    const newEdges: [string, string][] = [['b', 'a']]; // adding: b depends on a → cycle
    const result = tasks.detectDependencyCycle(ids, edges, newEdges);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('tasks: topologicalSort', () => {
  it('sorts independent tasks (any order)', () => {
    const input = [
      makeTask('a', []), makeTask('b', []), makeTask('c', []),
    ];
    const sorted = tasks.topologicalSort(input);
    expect(sorted.length).toBe(3);
    expect(new Set(sorted.map(t => t.id))).toEqual(new Set(['a', 'b', 'c']));
  });

  it('dependencies come before dependents', () => {
    const input = [
      makeTask('a', ['b']),
      makeTask('b', []),
    ];
    const sorted = tasks.topologicalSort(input);
    const idxA = sorted.findIndex(t => t.id === 'a');
    const idxB = sorted.findIndex(t => t.id === 'b');
    expect(idxB).toBeLessThan(idxA); // b before a
  });

  it('handles chain: a→b→c', () => {
    const input = [
      makeTask('a', ['b']),
      makeTask('b', ['c']),
      makeTask('c', []),
    ];
    const sorted = tasks.topologicalSort(input);
    const ids = sorted.map(t => t.id);
    expect(ids.indexOf('c')).toBeLessThan(ids.indexOf('b'));
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('a'));
  });

  it('handles diamond dependency', () => {
    const input = [
      makeTask('a', ['b', 'c']),
      makeTask('b', ['d']),
      makeTask('c', ['d']),
      makeTask('d', []),
    ];
    const sorted = tasks.topologicalSort(input);
    const ids = sorted.map(t => t.id);
    expect(ids.indexOf('d')).toBeLessThan(ids.indexOf('b'));
    expect(ids.indexOf('d')).toBeLessThan(ids.indexOf('c'));
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('a'));
    expect(ids.indexOf('c')).toBeLessThan(ids.indexOf('a'));
  });
});

describe('tasks: getCriticalPath', () => {
  it('returns longest path through DAG', () => {
    const input = [
      makeTask('a', []),
      makeTask('b', ['a']),
      makeTask('c', ['a']),
      makeTask('d', ['b', 'c']), // d depends on both → longer path
    ];
    const path = tasks.getCriticalPath(input);
    expect(path.length).toBeGreaterThan(0);
    // d should be in the path (longest chain: a→b→d or a→c→d)
    const ids = path.map(t => t.id);
    expect(ids).toContain('d');
  });

  it('single task returns itself', () => {
    const input = [makeTask('a', [])];
    const path = tasks.getCriticalPath(input);
    expect(path.length).toBe(1);
    expect(path[0].id).toBe('a');
  });
});

describe('tasks: getBlockingTasks / getBlockedByTask / isTaskBlocked', () => {
  it('getBlockingTasks returns direct dependencies', () => {
    const all = new Map([
      ['a', makeTask('a', ['b', 'c'])],
      ['b', makeTask('b', [])],
      ['c', makeTask('c', [])],
    ]);
    const blocking = tasks.getBlockingTasks(all.get('a')!, all);
    expect(blocking.length).toBe(2);
    expect(blocking.map(t => t.id).sort()).toEqual(['b', 'c']);
  });

  it('getBlockedByTask returns dependents', () => {
    const all = new Map([
      ['a', makeTask('a', [])],
      ['b', makeTask('b', ['a'])],
      ['c', makeTask('c', ['a'])],
    ]);
    const blocked = tasks.getBlockedByTask('a', all);
    expect(blocked.length).toBe(2);
    expect(blocked.map(t => t.id).sort()).toEqual(['b', 'c']);
  });

  it('isTaskBlocked: all deps completed → not blocked', () => {
    const all = new Map([
      ['a', makeTask('a', ['b'])],
      ['b', makeTask('b', [], 'completed')],
    ]);
    const result = tasks.isTaskBlocked(all.get('a')!, all);
    expect(result.blocked).toBe(false);
    expect(result.blockingDeps).toEqual([]);
  });

  it('isTaskBlocked: unmet deps → blocked', () => {
    const all = new Map([
      ['a', makeTask('a', ['b', 'c'])],
      ['b', makeTask('b', [], 'completed')],
      ['c', makeTask('c', [], 'in_progress')],
    ]);
    const result = tasks.isTaskBlocked(all.get('a')!, all);
    expect(result.blocked).toBe(true);
    expect(result.blockingDeps.length).toBe(1);
    expect(result.blockingDeps[0].id).toBe('c');
  });
});

describe('tasks: buildDAG', () => {
  it('returns nodes and edges for visualization', () => {
    const input = [
      makeTask('a', []),
      makeTask('b', ['a']),
      makeTask('c', ['a']),
    ];
    const dag = tasks.buildDAG(input);
    expect(dag.nodes.length).toBe(3);
    expect(dag.edges.length).toBe(2);
    const edgePairs = dag.edges.map(e => [e.from, e.to].sort());
    expect(edgePairs).toContainEqual(['a', 'b']);
    expect(edgePairs).toContainEqual(['a', 'c']);
  });
});

describe('tasks: updateTask with dependsOn', () => {
  it('sets dependsOn on a task', async () => {
    const prj = uniqProj('deps-set');
    const t1 = await tasks.createTask({ project: prj, title: 'T1' });
    const t2 = await tasks.createTask({ project: prj, title: 'T2' });
    const updated = await tasks.updateTask(prj, t2.id, { dependsOn: [t1.id] } as any);
    expect(updated!.dependsOn).toEqual([t1.id]);
  });

  it('clears dependsOn by setting empty array', async () => {
    const prj = uniqProj('deps-clear');
    const t1 = await tasks.createTask({ project: prj, title: 'T1' });
    const t2 = await tasks.createTask({ project: prj, title: 'T2' });
    await tasks.updateTask(prj, t2.id, { dependsOn: [t1.id] } as any);
    const cleared = await tasks.updateTask(prj, t2.id, { dependsOn: [] } as any);
    expect(cleared!.dependsOn).toEqual([]);
  });

  it('throws on self-dependency', async () => {
    const prj = uniqProj('deps-self');
    const t = await tasks.createTask({ project: prj, title: 'Self' });
    await expect(
      tasks.updateTask(prj, t.id, { dependsOn: [t.id] } as any)
    ).rejects.toThrow(/cannot depend on itself/);
  });

  it('throws on non-existent dependency', async () => {
    const prj = uniqProj('deps-missing');
    const t = await tasks.createTask({ project: prj, title: 'T' });
    await expect(
      tasks.updateTask(prj, t.id, { dependsOn: ['non-existent'] } as any)
    ).rejects.toThrow(/Dependency task not found/);
  });

  it('throws on cycle: A→B→A', async () => {
    const prj = uniqProj('deps-cycle');
    const a = await tasks.createTask({ project: prj, title: 'A' });
    const b = await tasks.createTask({ project: prj, title: 'B' });
    await tasks.updateTask(prj, a.id, { dependsOn: [b.id] } as any);
    await expect(
      tasks.updateTask(prj, b.id, { dependsOn: [a.id] } as any)
    ).rejects.toThrow(/Dependency cycle/);
  });
});

describe('tasks: updateTask with parentId', () => {
  it('sets parentId (move under another task)', async () => {
    const prj = uniqProj('parent-set');
    const root = await tasks.createTask({ project: prj, title: 'Root' });
    const child = await tasks.createTask({ project: prj, title: 'Child' });
    const updated = await tasks.updateTask(prj, child.id, { parentId: root.id });
    expect(updated!.parentId).toBe(root.id);
  });

  it('null parentId detaches to root', async () => {
    const prj = uniqProj('parent-detach');
    const root = await tasks.createTask({ project: prj, title: 'Root' });
    const child = await tasks.createTask({ project: prj, title: 'Child', parentId: root.id });
    const detached = await tasks.updateTask(prj, child.id, { parentId: null as any });
    expect(detached!.parentId).toBeUndefined();
  });

  it('throws on non-existent parent', async () => {
    const prj = uniqProj('parent-missing');
    const t = await tasks.createTask({ project: prj, title: 'T' });
    await expect(
      tasks.updateTask(prj, t.id, { parentId: 'non-existent' })
    ).rejects.toThrow(/Parent not found/);
  });

  it('throws on cycle: parent under own child', async () => {
    const prj = uniqProj('parent-cycle');
    const a = await tasks.createTask({ project: prj, title: 'A' });
    const b = await tasks.createTask({ project: prj, title: 'B', parentId: a.id });
    await expect(
      tasks.updateTask(prj, a.id, { parentId: b.id })
    ).rejects.toThrow(/Cycle detected/);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeTask(id: string, dependsOn: string[], status: string = 'pending'): any {
  return {
    id,
    project: 'test',
    title: `Task ${id}`,
    status: status as any,
    priority: 'medium' as any,
    dependsOn,
    archived: false,
    trashed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: [],
    links: [],
  };
}
