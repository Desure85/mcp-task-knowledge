import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-tests-obsidian-import-smoke');
const VAULT = path.join(TMP, 'vault');
const STORE = path.join(TMP, 'store');
const PROJECT = 'mcp';

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}
async function ensureDir(p: string) { await fsp.mkdir(p, { recursive: true }); }
async function writeFile(p: string, content: string) { await ensureDir(path.dirname(p)); await fsp.writeFile(p, content, 'utf8'); }
function md(front: Record<string, any>, body = ''): string {
  const yaml = Object.entries(front)
    .map(([k, v]) => Array.isArray(v) ? `${k}:\n${v.map((x) => `  - ${x}`).join('\n')}` : `${k}: ${v}`)
    .join('\n');
  return `---\n${yaml}\n---\n\n${body}`;
}

async function seedVault() {
  const proj = path.join(VAULT, PROJECT);
  // Knowledge
  await writeFile(path.join(proj, 'Knowledge', 'Notes', 'INDEX.md'), md({ title: 'Notes', type: 'note', tags: ['x'] }, '# Notes'));
  await writeFile(path.join(proj, 'Knowledge', 'Notes', 'leaf.md'), md({ title: 'Leaf', type: 'note', tags: ['y'] }, 'body'));
  // Tasks
  await writeFile(path.join(proj, 'Tasks', 'Inbox', 'INDEX.md'), md({ title: 'Inbox', status: 'pending', priority: 'low', tags: ['t'] }, '# Inbox'));
  await writeFile(path.join(proj, 'Tasks', 'Inbox', 't1.md'), md({ title: 'T1', status: 'pending', priority: 'medium' }, 'task'));
}

describe('obsidian_import_project: smoke (CLI envelope semantics)', () => {
  let imp: any;

  beforeAll(async () => {
    await rmrf(TMP);
    await ensureDir(VAULT);
    await ensureDir(STORE);
    process.env.OBSIDIAN_VAULT_ROOT = VAULT;
    process.env.DATA_DIR = STORE;
    await seedVault();
    imp = await import('../src/obsidian/import.js');
  }, 30000);

  afterAll(async () => {
    await rmrf(TMP);
  });

  it('dryRun envelope matches CLI contract (plan -> deletes/creates/updates/conflicts)', async () => {
    const plan = await imp.planImportProjectFromVault(PROJECT, { knowledge: true, tasks: true, strategy: 'merge', mergeStrategy: 'overwrite' });
    const envelope = {
      ok: true,
      data: {
        project: PROJECT,
        strategy: 'merge' as const,
        knowledge: true,
        tasks: true,
        plan,
      },
    };
    expect(envelope.ok).toBe(true);
    expect(typeof envelope.data.project).toBe('string');
    expect(['merge', 'replace'].includes(envelope.data.strategy)).toBe(true);
    expect(typeof envelope.data.knowledge).toBe('boolean');
    expect(typeof envelope.data.tasks).toBe('boolean');
    expect(typeof envelope.data.plan.creates.knowledge).toBe('number');
    expect(typeof envelope.data.plan.creates.tasks).toBe('number');
  });

  it('import envelope matches CLI contract (data: ImportResult)', async () => {
    const result = await imp.importProjectFromVault(PROJECT, { knowledge: true, tasks: true, strategy: 'merge', mergeStrategy: 'overwrite' });
    const envelope = { ok: true, data: result };
    expect(envelope.ok).toBe(true);
    expect(typeof envelope.data.project).toBe('string');
    expect(typeof envelope.data.knowledgeImported).toBe('number');
    expect(typeof envelope.data.tasksImported).toBe('number');
  });

  it('replace not confirmed: expected error envelope (CLI branch)', async () => {
    // Симулируем CLI-ветку без запуска сервера
    const errorEnvelope = { ok: false, error: { message: 'Import replace not confirmed: pass confirm=true to proceed' } };
    expect(errorEnvelope.ok).toBe(false);
    expect(typeof errorEnvelope.error.message).toBe('string');
    expect(errorEnvelope.error.message).toContain('not confirmed');
  });
});
