import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-tests-obsidian-e2e');
const VAULT = path.join(TMP, 'vault');
const STORE = path.join(TMP, 'store');
const PROJECT = 'mcp';

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

async function exists(p: string) {
  try { await fsp.stat(p); return true; } catch { return false; }
}

describe('obsidian export E2E: plan vs actual + replace strategy', () => {
  let exp: any; let kb: any; let tasks: any;

  beforeAll(async () => {
    await rmrf(TMP);
    await fsp.mkdir(VAULT, { recursive: true });
    await fsp.mkdir(STORE, { recursive: true });

    // Set env before dynamic imports (modules read env during load)
    process.env.OBSIDIAN_VAULT_ROOT = VAULT;
    process.env.DATA_DIR = STORE;

    exp = await import('../src/obsidian/export.js');
    kb = await import('../src/storage/knowledge.js');
    tasks = await import('../src/storage/tasks.js');
  }, 30000);

  afterAll(async () => {
    await rmrf(TMP);
  });

  it('plan matches export; replace clears target dirs', async () => {
    // Seed knowledge: parent -> child(tag x), archived other(tag x)
    const kParent = await kb.createDoc({ project: PROJECT, title: 'E2E_K_PARENT', content: 'parent', tags: [], type: 'overview' });
    await kb.createDoc({ project: PROJECT, title: 'E2E_K_CHILD', content: 'child', tags: ['x'], parentId: kParent.id, type: 'component' });
    const kArch = await kb.createDoc({ project: PROJECT, title: 'E2E_K_ARCH', content: 'archived', tags: ['x'], type: 'overview' });
    await kb.archiveDoc(PROJECT, kArch.id);

    // Seed tasks: parent -> child(tag x), archived other(tag x)
    const tParent = await tasks.createTask({ project: PROJECT, title: 'E2E_T_PARENT', priority: 'low', tags: [] });
    await tasks.createTask({ project: PROJECT, title: 'E2E_T_CHILD', parentId: tParent.id, tags: ['x'], priority: 'medium' });
    const tArch = await tasks.createTask({ project: PROJECT, title: 'E2E_T_ARCH', tags: ['x'], priority: 'high' });
    await tasks.archiveTask(PROJECT, tArch.id);

    const opts = {
      knowledge: true,
      tasks: true,
      includeTags: ['x'],
      includeArchived: true,
      keepOrphans: false,
      strategy: 'merge' as const,
    };

    const plan = await exp.planExportProjectToVault(PROJECT, opts);
    expect(plan.vaultRoot).toBe(VAULT);
    expect(plan.knowledge).toBe(true);
    expect(plan.tasks).toBe(true);

    const er = await exp.exportProjectToVault(PROJECT, opts);
    expect(er.vaultRoot).toBe(VAULT);
    // Counts should match plan
    expect(er.knowledgeCount).toBe(plan.knowledgeCount);
    expect(er.tasksCount).toBe(plan.tasksCount);
    // And should be non-zero for this setup
    expect(er.knowledgeCount).toBeGreaterThan(0);
    expect(er.tasksCount).toBeGreaterThan(0);

    const projRoot = path.join(VAULT, PROJECT);
    const kDir = path.join(projRoot, 'Knowledge');
    const tDir = path.join(projRoot, 'Tasks');
    expect(await exists(projRoot)).toBe(true);
    expect(await exists(kDir)).toBe(true);
    expect(await exists(tDir)).toBe(true);

    // Pre-create garbage in Knowledge and ensure replace removes it when exporting only knowledge
    const garbageDir = path.join(kDir, 'ZZ_GARBAGE');
    await fsp.mkdir(garbageDir, { recursive: true });
    await fsp.writeFile(path.join(garbageDir, 'waste.txt'), 'trash');
    expect(await exists(garbageDir)).toBe(true);

    const replaceOpts = { ...opts, strategy: 'replace' as const, tasks: false, knowledge: true };
    const plan2 = await exp.planExportProjectToVault(PROJECT, replaceOpts);
    expect(plan2.willDeleteDirs).toContain(kDir);

    const er2 = await exp.exportProjectToVault(PROJECT, replaceOpts);
    expect(er2.vaultRoot).toBe(VAULT);
    // Garbage must be gone
    expect(await exists(garbageDir)).toBe(false);
  }, 30000);
});
