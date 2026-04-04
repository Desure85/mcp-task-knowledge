import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import os from 'node:os';

// TMP envs must be set before dynamic imports
const TMP_DIR = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-hierarchy-'));
process.env.DATA_DIR = TMP_DIR;
process.env.CURRENT_PROJECT = 'test-hierarchy';

// Dynamic imports after env
import type * as TasksNS from '../src/storage/tasks.js';
let tasks: typeof TasksNS;

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

beforeAll(async () => {
  await rmrf(TMP_DIR);
  await fsp.mkdir(TMP_DIR, { recursive: true });
  tasks = await import('../src/storage/tasks.js');
});

afterAll(async () => {
  await rmrf(TMP_DIR);
});

let testCounter = 0;
/** Get a unique project name per test to avoid data pollution */
function up(): string {
  testCounter++;
  return `th-${testCounter}`;
}

describe('Task Hierarchy (MR-002)', () => {
  // --- createTask with parentId ---

  describe('createTask with parentId', () => {
    it('should create a root task (no parentId)', async () => {
      const prj = up();
      const task = await tasks.createTask({ project: prj, title: 'Root' });
      expect(task.title).toBe('Root');
      expect(task.parentId).toBeUndefined();
    });

    it('should create a subtask with parentId', async () => {
      const prj = up();
      const parent = await tasks.createTask({ project: prj, title: 'Parent' });
      const child = await tasks.createTask({ project: prj, title: 'Child', parentId: parent.id });
      expect(child.parentId).toBe(parent.id);
    });

    it('should reject creation with non-existent parentId', async () => {
      const prj = up();
      await expect(
        tasks.createTask({ project: prj, title: 'Orphan', parentId: 'nonexistent-id' })
      ).rejects.toThrow('Parent task not found');
    });
  });

  // --- Depth validation ---

  describe('depth validation', () => {
    it('should compute depth 0 for root tasks', async () => {
      const prj = up();
      const root = await tasks.createTask({ project: prj, title: 'Root' });
      expect(await tasks.getTaskDepth(prj, root.id)).toBe(0);
    });

    it('should compute correct depth for nested tasks', async () => {
      const prj = up();
      const root = await tasks.createTask({ project: prj, title: 'L0' });
      const l1 = await tasks.createTask({ project: prj, title: 'L1', parentId: root.id });
      const l2 = await tasks.createTask({ project: prj, title: 'L2', parentId: l1.id });
      expect(await tasks.getTaskDepth(prj, root.id)).toBe(0);
      expect(await tasks.getTaskDepth(prj, l1.id)).toBe(1);
      expect(await tasks.getTaskDepth(prj, l2.id)).toBe(2);
    });

    it('should return -1 for non-existent task', async () => {
      const prj = up();
      expect(await tasks.getTaskDepth(prj, 'nonexistent')).toBe(-1);
    });

    it('should enforce MAX_TASK_DEPTH', async () => {
      const prj = up();
      let parentId: string | undefined;
      for (let i = 0; i < tasks.MAX_TASK_DEPTH - 1; i++) {
        const task = await tasks.createTask({ project: prj, title: `L${i}`, parentId });
        parentId = task.id;
      }
      const lastDepth = await tasks.getTaskDepth(prj, parentId!);
      expect(lastDepth).toBe(tasks.MAX_TASK_DEPTH - 2);

      // Adding one more should work (depth = MAX_TASK_DEPTH - 1)
      const ok = await tasks.createTask({ project: prj, title: `L${tasks.MAX_TASK_DEPTH - 1}`, parentId });
      expect(await tasks.getTaskDepth(prj, ok.id)).toBe(tasks.MAX_TASK_DEPTH - 1);

      // Adding one more should FAIL (depth would be MAX_TASK_DEPTH)
      await expect(
        tasks.createTask({ project: prj, title: 'TooDeep', parentId: ok.id })
      ).rejects.toThrow('Maximum task depth');
    });
  });

  // --- updateTask parentId (move) ---

  describe('updateTask parentId (move subtree)', () => {
    it('should move a root task under another task', async () => {
      const prj = up();
      const parent = await tasks.createTask({ project: prj, title: 'Parent' });
      const child = await tasks.createTask({ project: prj, title: 'Child' });
      const moved = await tasks.updateTask(prj, child.id, { parentId: parent.id });
      expect(moved!.parentId).toBe(parent.id);
    });

    it('should detach a child from parent (null = root)', async () => {
      const prj = up();
      const parent = await tasks.createTask({ project: prj, title: 'Parent' });
      const child = await tasks.createTask({ project: prj, title: 'Child', parentId: parent.id });
      const detached = await tasks.updateTask(prj, child.id, { parentId: null as any });
      expect(detached!.parentId).toBeUndefined();
    });

    it('should prevent cycles when moving', async () => {
      const prj = up();
      const root = await tasks.createTask({ project: prj, title: 'Root' });
      const child = await tasks.createTask({ project: prj, title: 'Child', parentId: root.id });
      await expect(
        tasks.updateTask(prj, root.id, { parentId: child.id })
      ).rejects.toThrow('Cycle detected');
    });

    it('should enforce depth limit when moving', async () => {
      const prj = up();
      // Build a chain of MAX_TASK_DEPTH tasks (depth 0..MAX-1)
      let parentId: string | undefined;
      for (let i = 0; i < tasks.MAX_TASK_DEPTH; i++) {
        const task = await tasks.createTask({ project: prj, title: `L${i}`, parentId });
        parentId = task.id;
      }
      // parentId is now at depth MAX_TASK_DEPTH - 1
      // Moving any task under it would exceed the limit
      const orphan = await tasks.createTask({ project: prj, title: 'Orphan' });
      await expect(
        tasks.updateTask(prj, orphan.id, { parentId })
      ).rejects.toThrow('Maximum task depth');
    });

    it('should reject move to non-existent parent', async () => {
      const prj = up();
      const task = await tasks.createTask({ project: prj, title: 'Task' });
      await expect(
        tasks.updateTask(prj, task.id, { parentId: 'nonexistent' })
      ).rejects.toThrow('Parent not found');
    });
  });

  // --- listTasksTree ---

  describe('listTasksTree', () => {
    it('should build correct tree structure', async () => {
      const prj = up();
      const root = await tasks.createTask({ project: prj, title: 'Root' });
      const child1 = await tasks.createTask({ project: prj, title: 'C1', parentId: root.id });
      const child2 = await tasks.createTask({ project: prj, title: 'C2', parentId: root.id });
      const grandchild = await tasks.createTask({ project: prj, title: 'GC1', parentId: child1.id });

      const tree = await tasks.listTasksTree({ project: prj });
      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe(root.id);
      expect(tree[0].children).toHaveLength(2);
      const c1Node = tree[0].children.find((c: any) => c.id === child1.id)!;
      expect(c1Node.children).toHaveLength(1);
      expect(c1Node.children[0].id).toBe(grandchild.id);
    });

    it('should filter by status in tree', async () => {
      const prj = up();
      const root = await tasks.createTask({ project: prj, title: 'Root' });
      await tasks.createTask({ project: prj, title: 'Pending child', parentId: root.id, status: 'pending' });
      await tasks.createTask({ project: prj, title: 'Closed child', parentId: root.id, status: 'closed' });

      const tree = await tasks.listTasksTree({ project: prj, status: 'pending' });
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].title).toBe('Pending child');
    });
  });

  // --- getTaskSubtree ---

  describe('getTaskSubtree', () => {
    it('should return subtree for a specific root task', async () => {
      const prj = up();
      const root1 = await tasks.createTask({ project: prj, title: 'Root1' });
      const root2 = await tasks.createTask({ project: prj, title: 'Root2' });
      const c1 = await tasks.createTask({ project: prj, title: 'R1-C1', parentId: root1.id });
      const c2 = await tasks.createTask({ project: prj, title: 'R1-C2', parentId: root1.id });
      await tasks.createTask({ project: prj, title: 'R2-C1', parentId: root2.id });

      const subtree = await tasks.getTaskSubtree(prj, root1.id);
      expect(subtree).not.toBeNull();
      expect(subtree!.id).toBe(root1.id);
      expect(subtree!.children).toHaveLength(2);
      expect(subtree!.children.map((c: any) => c.id)).toContain(c1.id);
      expect(subtree!.children.map((c: any) => c.id)).toContain(c2.id);
    });

    it('should return null for non-existent task', async () => {
      const prj = up();
      expect(await tasks.getTaskSubtree(prj, 'nonexistent')).toBeNull();
    });

    it('should build multi-level subtree', async () => {
      const prj = up();
      const root = await tasks.createTask({ project: prj, title: 'Root' });
      const l1 = await tasks.createTask({ project: prj, title: 'L1', parentId: root.id });
      const l2 = await tasks.createTask({ project: prj, title: 'L2', parentId: l1.id });

      const subtree = await tasks.getTaskSubtree(prj, root.id);
      expect(subtree!.children[0].children[0].id).toBe(l2.id);
    });
  });

  // --- getDirectChildren ---

  describe('getDirectChildren', () => {
    it('should return only direct children (one level)', async () => {
      const prj = up();
      const root = await tasks.createTask({ project: prj, title: 'Root' });
      const child = await tasks.createTask({ project: prj, title: 'Child', parentId: root.id });
      await tasks.createTask({ project: prj, title: 'Grandchild', parentId: child.id });

      const children = await tasks.getDirectChildren(prj, root.id);
      expect(children).toHaveLength(1);
      expect(children[0].id).toBe(child.id);
    });

    it('should return empty array for leaf task', async () => {
      const prj = up();
      const leaf = await tasks.createTask({ project: prj, title: 'Leaf' });
      expect(await tasks.getDirectChildren(prj, leaf.id)).toHaveLength(0);
    });
  });

  // --- closeTaskWithCascade ---

  describe('closeTaskWithCascade', () => {
    it('should close a single task without cascade', async () => {
      const prj = up();
      const task = await tasks.createTask({ project: prj, title: 'Task' });
      const result = await tasks.closeTaskWithCascade(prj, task.id, false);
      expect(result.root).not.toBeNull();
      expect(result.root!.status).toBe('closed');
      expect(result.cascaded).toHaveLength(0);
    });

    it('should cascade close to all descendants', async () => {
      const prj = up();
      const root = await tasks.createTask({ project: prj, title: 'Root' });
      const c1 = await tasks.createTask({ project: prj, title: 'C1', parentId: root.id });
      const c2 = await tasks.createTask({ project: prj, title: 'C2', parentId: root.id });
      const gc = await tasks.createTask({ project: prj, title: 'GC', parentId: c1.id });

      const result = await tasks.closeTaskWithCascade(prj, root.id, true);
      expect(result.root!.status).toBe('closed');
      expect(result.cascaded).toHaveLength(3);
      expect(result.cascaded.map((t: any) => t.id)).toContain(c1.id);
      expect(result.cascaded.map((t: any) => t.id)).toContain(c2.id);
      expect(result.cascaded.map((t: any) => t.id)).toContain(gc.id);
      expect(result.cascaded.every((t: any) => t.status === 'closed')).toBe(true);
    });

    it('should return null root for non-existent task', async () => {
      const prj = up();
      const result = await tasks.closeTaskWithCascade(prj, 'nonexistent', false);
      expect(result.root).toBeNull();
      expect(result.cascaded).toHaveLength(0);
    });
  });
});
