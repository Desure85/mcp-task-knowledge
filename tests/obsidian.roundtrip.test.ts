import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-tests-obsidian-roundtrip');
const VAULT = path.join(TMP, 'vault');
const STORE = path.join(TMP, 'store');
const PROJECT = 'mcp';

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

async function exists(p: string) {
  try { await fsp.stat(p); return true; } catch { return false; }
}

describe('obsidian: export -> import roundtrip (src modules)', () => {
  let exp: any; let imp: any; let tasks: any; let kb: any;

  beforeAll(async () => {
    await rmrf(TMP);
    await fsp.mkdir(VAULT, { recursive: true });
    await fsp.mkdir(STORE, { recursive: true });

    // Set env before dynamic imports (src reads env during loadConfig/use)
    process.env.OBSIDIAN_VAULT_ROOT = VAULT;
    process.env.DATA_DIR = STORE;

    exp = await import('../src/obsidian/export.js');
    imp = await import('../src/obsidian/import.js');
    tasks = await import('../src/storage/tasks.js');
    kb = await import('../src/storage/knowledge.js');
  }, 30000);

  afterAll(async () => {
    await rmrf(TMP);
  });

  it('exports seeded data and imports back with non-empty counts', async () => {
    // Seed: doc + parent/child tasks
    await kb.createDoc({
      project: PROJECT,
      title: 'RT_DOC',
      content: '# Hello\n\nSeed doc for test',
      type: 'overview',
    });
    const p = await tasks.createTask({ project: PROJECT, title: 'RT_PARENT' });
    await tasks.createTask({ project: PROJECT, title: 'RT_CHILD', parentId: p.id });

    // Export replace
    const er = await exp.exportProjectToVault(PROJECT, { strategy: 'replace' });
    expect(er).toBeTruthy();
    expect(er.vaultRoot).toBe(VAULT);

    const projRoot = path.join(VAULT, PROJECT);
    const kDir = path.join(projRoot, 'Knowledge');
    const tDir = path.join(projRoot, 'Tasks');
    const idx = path.join(projRoot, 'INDEX.md');
    expect(await exists(projRoot)).toBe(true);
    expect(await exists(kDir)).toBe(true);
    expect(await exists(tDir)).toBe(true);
    expect(await exists(idx)).toBe(true);

    // Import replace
    const ir = await imp.importProjectFromVault(PROJECT, { strategy: 'replace' });
    expect(ir).toBeTruthy();
    expect(ir.vaultRoot).toBe(VAULT);

    // List storage
    const docs = await kb.listDocs({ project: PROJECT });
    const list = await tasks.listTasks({ project: PROJECT });
    expect(Array.isArray(docs) && docs.length > 0).toBe(true);
    expect(Array.isArray(list) && list.length > 0).toBe(true);

    // Check that Tasks folder is not empty at FS level
    expect((await fsp.readdir(tDir)).length > 0).toBe(true);
  });
});
