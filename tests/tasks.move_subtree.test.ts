import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

// Ensure DATA_DIR set before dynamic import of storage
const TMP_DIR = path.join(process.cwd(), '.tmp-tests-move-subtree');
process.env.DATA_DIR = TMP_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_DIR, 'vault');

import type * as StorageNS from '../src/storage/tasks.js';
let storage!: typeof StorageNS;

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

beforeAll(async () => {
  await rmrf(TMP_DIR);
  await fsp.mkdir(TMP_DIR, { recursive: true });
  await fsp.mkdir(process.env.OBSIDIAN_VAULT_ROOT!, { recursive: true });
  storage = await import('../src/storage/tasks.js');
});

afterAll(async () => {
  await rmrf(TMP_DIR);
});

describe('tasks: reparent/move_subtree with cycle protection', () => {
  it('reparents node under another and preserves children', async () => {
    const project = 'mcp';
    // Tree: A(root) -> B(child), C(child of B)
    const A = await storage.createTask({ project, title: 'A' });
    const B = await storage.createTask({ project, title: 'B', parentId: A.id });
    const C = await storage.createTask({ project, title: 'C', parentId: B.id });

    // Reparent B under null (promote to root)
    const updatedB = await storage.updateTask(project, B.id, { parentId: null } as any);
    expect(updatedB).toBeTruthy();
    expect(updatedB!.parentId).toBeUndefined();

    // C must still have parentId = B.id
    const afterC = await storage.getTask(project, C.id);
    expect(afterC!.parentId).toBe(B.id);

    // Now move_subtree: move B (with C) under A again
    const movedB = await storage.updateTask(project, B.id, { parentId: A.id } as any);
    expect(movedB).toBeTruthy();
    expect(movedB!.parentId).toBe(A.id);
    const afterC2 = await storage.getTask(project, C.id);
    expect(afterC2!.parentId).toBe(B.id);

    // Validate tree structure reflects the change
    const tree = await storage.listTasksTree({ project });
    const rootA = tree.find(n => n.id === A.id)!;
    const childIds = new Set(rootA.children.map(c => c.id));
    expect(childIds.has(B.id)).toBe(true);
  });

  it('prevents cycles when moving under descendant', async () => {
    const project = 'mcp';
    const R = await storage.createTask({ project, title: 'R' });
    const X = await storage.createTask({ project, title: 'X', parentId: R.id });
    const Y = await storage.createTask({ project, title: 'Y', parentId: X.id });

    // Attempt to move R under Y should fail (cycle)
    await expect(storage.updateTask(project, R.id, { parentId: Y.id } as any)).rejects.toThrow(/Cycle detected/);
    await expect(storage.updateTask(project, R.id, { parentId: Y.id } as any)).rejects.toThrow(/Cycle detected/);

    // Structure unchanged
    const r = await storage.getTask(project, R.id);
    expect(r!.parentId).toBeUndefined();
  });

  it('fails when new parent does not exist', async () => {
    const project = 'mcp';
    const T = await storage.createTask({ project, title: 'T' });
    await expect(storage.updateTask(project, T.id, { parentId: 'no-such-id' } as any)).rejects.toThrow(/Parent not found/);
  });
});
