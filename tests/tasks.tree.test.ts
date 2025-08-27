import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

// We must set DATA_DIR before importing storage module (it reads env at import time)
const TMP_DIR = path.join(process.cwd(), '.tmp-tests-tasks-tree');
process.env.DATA_DIR = TMP_DIR;

// Note: OBSIDIAN_VAULT_ROOT is only required when calling loadConfig(),
// storage module doesn't call it. Still, set a dummy value for safety.
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_DIR, 'vault');

// Dynamic import after env is set
import type * as StorageNS from '../src/storage/tasks.js';
let storage!: typeof StorageNS;

async function rmrf(p: string) {
  try {
    await fsp.rm(p, { recursive: true, force: true });
  } catch {}
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

describe('tasks: includeArchived filtering and tree building', () => {
  it('filters archived by default and includes when includeArchived=true; tree respects filtering', async () => {
    const project = 'mcp';

    // Create root A
    const A = await storage.createTask({ project, title: 'A root' });
    // Create child C under A (not archived)
    const C = await storage.createTask({ project, title: 'C child', parentId: A.id });
    // Create child B under A, then archive
    const B = await storage.createTask({ project, title: 'B child-arch', parentId: A.id });
    await storage.archiveTask(project, B.id);
    // Create root D and archive
    const D = await storage.createTask({ project, title: 'D root-arch' });
    await storage.archiveTask(project, D.id);
    // Create trashed E (should always be filtered out)
    const E = await storage.createTask({ project, title: 'E trashed', parentId: A.id });
    await storage.trashTask(project, E.id);

    // Plain list, default: archived excluded, trashed excluded
    const listDefault = await storage.listTasks({ project });
    const idsDefault = new Set(listDefault.map(t => t.id));
    expect(idsDefault.has(A.id)).toBe(true);
    expect(idsDefault.has(C.id)).toBe(true);
    expect(idsDefault.has(B.id)).toBe(false);
    expect(idsDefault.has(D.id)).toBe(false);
    expect(idsDefault.has(E.id)).toBe(false);

    // Plain list with includeArchived
    const listWithArch = await storage.listTasks({ project, includeArchived: true });
    const idsWithArch = new Set(listWithArch.map(t => t.id));
    expect(idsWithArch.has(A.id)).toBe(true);
    expect(idsWithArch.has(C.id)).toBe(true);
    expect(idsWithArch.has(B.id)).toBe(true);
    expect(idsWithArch.has(D.id)).toBe(true);
    expect(idsWithArch.has(E.id)).toBe(false); // trashed still excluded

    // Tree default: B excluded under A, only C remains; D not present
    const treeDefault = await storage.listTasksTree({ project });
    // Find A
    const rootA = treeDefault.find(n => n.id === A.id)!;
    expect(rootA).toBeTruthy();
    const childIdsDefault = new Set(rootA.children.map(c => c.id));
    expect(childIdsDefault.has(C.id)).toBe(true);
    expect(childIdsDefault.has(B.id)).toBe(false);
    // D should not be among roots
    expect(treeDefault.some(n => n.id === D.id)).toBe(false);

    // Tree with includeArchived: A has both C and B; D appears as root
    const treeWithArch = await storage.listTasksTree({ project, includeArchived: true });
    const rootA2 = treeWithArch.find(n => n.id === A.id)!;
    expect(rootA2).toBeTruthy();
    const childIdsWithArch = new Set(rootA2.children.map(c => c.id));
    expect(childIdsWithArch.has(C.id)).toBe(true);
    expect(childIdsWithArch.has(B.id)).toBe(true);
    // D root present
    expect(treeWithArch.some(n => n.id === D.id)).toBe(true);
  });
});
