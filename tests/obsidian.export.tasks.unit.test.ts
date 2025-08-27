import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-tests-obsidian-tasks-structure');
const VAULT = path.join(TMP, 'vault');
const STORE = path.join(TMP, 'store');
const PROJECT = 'mcp';

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

async function exists(p: string) {
  try { await fsp.stat(p); return true; } catch { return false; }
}

const sanitize = (s: string) => s.replace(/[\/\\:*?"<>|]/g, '_').trim() || 'untitled';

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

describe('obsidian export: tasks filters and structure (status/priority/tags/dates/closure + sanitize)', () => {
  let exp: any; let tasks: any;

  beforeAll(async () => {
    await rmrf(TMP);
    await fsp.mkdir(VAULT, { recursive: true });
    await fsp.mkdir(STORE, { recursive: true });

    process.env.OBSIDIAN_VAULT_ROOT = VAULT;
    process.env.DATA_DIR = STORE;

    exp = await import('../src/obsidian/export.js');
    tasks = await import('../src/storage/tasks.js');
  }, 30000);

  afterAll(async () => {
    await rmrf(TMP);
  });

  it('applies includeStatus/includePriority/includeTags & updatedFrom; writes structure with structuralOnly for ancestors', async () => {
    // Parent task (to test sanitize and structural closure)
    const parentTitle = 'T:/\\:*?"<>|';
    const tParent = await tasks.createTask({ project: PROJECT, title: parentTitle, description: 'parent desc' });

    // Old child that should be excluded by updatedFrom
    const tOld = await tasks.createTask({ project: PROJECT, title: 'old x', description: 'old desc', parentId: tParent.id, priority: 'high', tags: ['x'] });
    await tasks.updateTask(PROJECT, tOld.id, { status: 'in_progress', priority: 'high', tags: ['x'] });

    // Ensure cutoff is strictly after tOld.updatedAt
    await sleep(20);
    const cutoff = new Date().toISOString();

    // New child that should be included
    const tNew = await tasks.createTask({ project: PROJECT, title: 'new x', description: 'new desc', parentId: tParent.id, priority: 'high', tags: ['x'] });
    await tasks.updateTask(PROJECT, tNew.id, { status: 'in_progress', priority: 'high', tags: ['x'] });

    // Child with different tag (excluded by includeTags)
    const tOtherTag = await tasks.createTask({ project: PROJECT, title: 'tag y', description: 'y desc', parentId: tParent.id, priority: 'high', tags: ['y'] });
    await tasks.updateTask(PROJECT, tOtherTag.id, { status: 'in_progress', priority: 'high', tags: ['y'] });

    // Archived child with tag x should be excluded by default (includeArchived not set)
    const tArch = await tasks.createTask({ project: PROJECT, title: 'archived x', description: 'arch desc', parentId: tParent.id, priority: 'high', tags: ['x'] });
    await tasks.updateTask(PROJECT, tArch.id, { status: 'in_progress', priority: 'high', tags: ['x'] });
    await tasks.archiveTask(PROJECT, tArch.id);

    const opts = {
      knowledge: false,
      tasks: true,
      includeStatus: ['in_progress' as const],
      includePriority: ['high' as const],
      includeTags: ['x'],
      updatedFrom: cutoff,
      keepOrphans: false,
      strategy: 'replace' as const,
    };

    const er = await exp.exportProjectToVault(PROJECT, opts);
    expect(er.vaultRoot).toBe(VAULT);
    expect(er.tasksCount).toBeGreaterThan(0);

    const projRoot = path.join(VAULT, PROJECT);
    const tDir = path.join(projRoot, 'Tasks');

    const parentDir = path.join(tDir, sanitize(parentTitle));
    const parentIndex = path.join(parentDir, 'INDEX.md');

    // Parent folder with INDEX.md must exist (structural ancestor)
    expect(await exists(parentDir)).toBe(true);
    expect(await exists(parentIndex)).toBe(true);

    // New child included: single file within parent's folder
    const newChildFile = path.join(parentDir, `${sanitize('new x')}.md`);
    expect(await exists(newChildFile)).toBe(true);

    // Old child excluded by date filter
    const oldChildFile = path.join(parentDir, `${sanitize('old x')}.md`);
    const oldChildIdx = path.join(parentDir, 'old x', 'INDEX.md');
    expect(await exists(oldChildFile)).toBe(false);
    expect(await exists(oldChildIdx)).toBe(false);

    // Tag y excluded by includeTags
    const yFile = path.join(parentDir, `${sanitize('tag y')}.md`);
    const yIdx = path.join(parentDir, 'tag y', 'INDEX.md');
    expect(await exists(yFile)).toBe(false);
    expect(await exists(yIdx)).toBe(false);

    // Archived excluded by default
    const archFile = path.join(parentDir, `${sanitize('archived x')}.md`);
    const archIdx = path.join(parentDir, 'archived x', 'INDEX.md');
    expect(await exists(archFile)).toBe(false);
    expect(await exists(archIdx)).toBe(false);

    // Validate frontmatter/body
    const pBody = await fsp.readFile(parentIndex, 'utf8');
    const nBody = await fsp.readFile(newChildFile, 'utf8');

    // Parent should be structuralOnly (ancestor only)
    expect(pBody).toContain('structuralOnly: true');
    expect(pBody).toContain(`# ${parentTitle.replace(/[\n\r]/g, '')}`);

    // Child is selected leaf => no structuralOnly key, contains header and description
    expect(nBody).not.toContain('structuralOnly:');
    expect(nBody).toContain('# new x');
    expect(nBody).toContain('new desc');
  }, 30000);
});
