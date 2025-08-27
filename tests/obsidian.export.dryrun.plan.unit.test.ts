import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-tests-obsidian-dryrun');
const VAULT = path.join(TMP, 'vault');
const STORE = path.join(TMP, 'store');
const PROJECT = 'mcp';

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

describe('obsidian export: dryRun plan counts and willDeleteDirs', () => {
  let plan: any; let kb: any; let tasks: any;

  beforeAll(async () => {
    await rmrf(TMP);
    await fsp.mkdir(VAULT, { recursive: true });
    await fsp.mkdir(STORE, { recursive: true });

    process.env.OBSIDIAN_VAULT_ROOT = VAULT;
    process.env.DATA_DIR = STORE;

    ({ planExportProjectToVault: plan } = await import('../src/obsidian/export.js'));
    kb = await import('../src/storage/knowledge.js');
    tasks = await import('../src/storage/tasks.js');

    // Seed knowledge: parent + child(x) + otherTag(y) + archived(x)
    const kp = await kb.createDoc({ project: PROJECT, title: 'K-Parent', content: 'p', tags: ['a'], type: 'overview' });
    await kb.createDoc({ project: PROJECT, title: 'K-Child-X', content: 'c', tags: ['x'], type: 'component', parentId: kp.id });
    await kb.createDoc({ project: PROJECT, title: 'K-Other-Y', content: 'y', tags: ['y'], type: 'api' });
    const ka = await kb.createDoc({ project: PROJECT, title: 'K-Arch-X', content: 'ax', tags: ['x'], type: 'overview' });
    await kb.archiveDoc(PROJECT, ka.id);

    // Seed tasks: parent + child(x) + otherTag(y) + archived(x)
    const tp = await tasks.createTask({ project: PROJECT, title: 'T-Parent' });
    await tasks.createTask({ project: PROJECT, title: 'T-Child-X', parentId: tp.id, priority: 'high', tags: ['x'] });
    await tasks.updateTask(PROJECT, tp.id, { status: 'pending' });
    const tChildX = await tasks.listTasks({ project: PROJECT });
    // Ensure child has target status/priority for selection later
    const c = tChildX.find(t => t.title === 'T-Child-X');
    if (c) await tasks.updateTask(PROJECT, c.id, { status: 'in_progress', priority: 'high', tags: ['x'] });
    const ty = await tasks.createTask({ project: PROJECT, title: 'T-Other-Y', parentId: tp.id, priority: 'high', tags: ['y'] });
    await tasks.updateTask(PROJECT, ty.id, { status: 'in_progress', priority: 'high', tags: ['y'] });
    const ta = await tasks.createTask({ project: PROJECT, title: 'T-Arch-X', parentId: tp.id, priority: 'high', tags: ['x'] });
    await tasks.updateTask(PROJECT, ta.id, { status: 'in_progress', priority: 'high', tags: ['x'] });
    await tasks.archiveTask(PROJECT, ta.id);
  }, 30000);

  afterAll(async () => {
    await rmrf(TMP);
  });

  it('keepOrphans=false: counts include selected nodes + ancestors (closure)', async () => {
    const res = await plan(PROJECT, {
      knowledge: true,
      tasks: true,
      includeTags: ['x'],
      includeStatus: ['in_progress'],
      includePriority: ['high'],
      keepOrphans: false,
      strategy: 'replace',
    });
    // Knowledge: selected = K-Child-X; closure adds K-Parent => 2
    expect(res.knowledgeCount).toBe(2);
    // Tasks: selected = T-Child-X; closure adds T-Parent => 2
    expect(res.tasksCount).toBe(2);

    const projRoot = path.join(VAULT, PROJECT);
    const kDir = path.join(projRoot, 'Knowledge');
    const tDir = path.join(projRoot, 'Tasks');
    expect(res.willDeleteDirs).toEqual(expect.arrayContaining([kDir, tDir]));
  }, 30000);

  it('keepOrphans=true: counts equal to all non-archived after basic filters (ignore includeTags/status/priority)', async () => {
    const res = await plan(PROJECT, {
      knowledge: true,
      tasks: true,
      includeTags: ['x'],
      includeStatus: ['in_progress'],
      includePriority: ['high'],
      keepOrphans: true,
      strategy: 'merge',
    });
    // Knowledge non-archived: K-Parent, K-Child-X, K-Other-Y => 3
    expect(res.knowledgeCount).toBe(3);
    // Tasks non-archived: T-Parent, T-Child-X, T-Other-Y => 3
    expect(res.tasksCount).toBe(3);
    // No deletes in merge strategy
    expect(res.willDeleteDirs).toEqual([]);
  }, 30000);
});
