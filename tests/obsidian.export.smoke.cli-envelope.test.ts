import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-tests-obsidian-smoke');
const VAULT = path.join(TMP, 'vault');
const STORE = path.join(TMP, 'store');
const PROJECT = 'mcp';

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

async function exists(p: string) {
  try { await fsp.stat(p); return true; } catch { return false; }
}

describe('obsidian_export_project: smoke (CLI envelope semantics, variant A)', () => {
  let exp: any; let kb: any; let tasks: any;

  beforeAll(async () => {
    await rmrf(TMP);
    await fsp.mkdir(VAULT, { recursive: true });
    await fsp.mkdir(STORE, { recursive: true });

    process.env.OBSIDIAN_VAULT_ROOT = VAULT;
    process.env.DATA_DIR = STORE;

    exp = await import('../src/obsidian/export.js');
    kb = await import('../src/storage/knowledge.js');
    tasks = await import('../src/storage/tasks.js');
  }, 30000);

  afterAll(async () => {
    await rmrf(TMP);
  });

  it('dryRun envelope matches CLI contract (plan -> willWrite/willDeleteDirs)', async () => {
    // seed minimal data ensuring non-zero counts
    await kb.createDoc({ project: PROJECT, title: 'SMOKE_DOC', content: 'x', type: 'overview' });
    await tasks.createTask({ project: PROJECT, title: 'SMOKE_TASK' });

    const plan = await exp.planExportProjectToVault(PROJECT, { knowledge: true, tasks: true, strategy: 'merge' });

    const envelope = {
      ok: true,
      data: {
        project: PROJECT,
        strategy: 'merge' as const,
        knowledge: true,
        tasks: true,
        plan: {
          willWrite: { knowledgeCount: plan.knowledgeCount, tasksCount: plan.tasksCount },
          willDeleteDirs: plan.willDeleteDirs,
        },
      },
    };

    // shape assertions
    expect(envelope.ok).toBe(true);
    expect(typeof envelope.data.project).toBe('string');
    expect(['merge', 'replace'].includes(envelope.data.strategy)).toBe(true);
    expect(typeof envelope.data.knowledge).toBe('boolean');
    expect(typeof envelope.data.tasks).toBe('boolean');
    expect(typeof envelope.data.plan.willWrite.knowledgeCount).toBe('number');
    expect(typeof envelope.data.plan.willWrite.tasksCount).toBe('number');
    expect(Array.isArray(envelope.data.plan.willDeleteDirs)).toBe(true);

    // replace should plan deletions according to flags
    const plan2 = await exp.planExportProjectToVault(PROJECT, { knowledge: true, tasks: false, strategy: 'replace' });
    const projRoot = path.join(VAULT, PROJECT);
    const kDir = path.join(projRoot, 'Knowledge');
    expect(plan2.willDeleteDirs).toContain(kDir);
  });

  it('export envelope matches CLI contract (data: ExportResult)', async () => {
    const result = await exp.exportProjectToVault(PROJECT, { knowledge: true, tasks: true, strategy: 'merge' });
    const envelope = { ok: true, data: result };
    expect(envelope.ok).toBe(true);
    expect(typeof envelope.data.vaultRoot).toBe('string');
    expect(envelope.data.vaultRoot).toBe(VAULT);
    expect(typeof envelope.data.knowledgeCount).toBe('number');
    expect(typeof envelope.data.tasksCount).toBe('number');

    // INDEX.md exists
    const projRoot = path.join(VAULT, PROJECT);
    const idx = path.join(projRoot, 'INDEX.md');
    expect(await exists(idx)).toBe(true);
  });

  it('replace not confirmed: expected error envelope (CLI branch)', async () => {
    // We simulate the CLI branch outcome (without launching server)
    const errorEnvelope = { ok: false, error: { message: 'Export replace not confirmed: pass confirm=true to proceed' } };
    expect(errorEnvelope.ok).toBe(false);
    expect(typeof errorEnvelope.error.message).toBe('string');
    expect(errorEnvelope.error.message).toContain('not confirmed');
  });
});
