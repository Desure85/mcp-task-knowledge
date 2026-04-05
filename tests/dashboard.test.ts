import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';

// TMP envs must be set before dynamic imports
const TMP_DIR = path.join(process.cwd(), '.tmp-tests-dashboard');
process.env.DATA_DIR = TMP_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_DIR, 'vault');
process.env.EMBEDDINGS_MODE = 'none';

let tasks: typeof import('../src/storage/tasks.js');
let knowledge: typeof import('../src/storage/knowledge.js');

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

// Generate unique project per test to avoid cross-contamination
function uniqProj(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

beforeAll(async () => {
  await rmrf(TMP_DIR);
  await fsp.mkdir(TMP_DIR, { recursive: true });
  await fsp.mkdir(process.env.OBSIDIAN_VAULT_ROOT!, { recursive: true });
  tasks = await import('../src/storage/tasks.js');
  knowledge = await import('../src/storage/knowledge.js');
});

afterAll(async () => {
  await rmrf(TMP_DIR);
});

describe('dashboard_stats logic', () => {
  it('groups tasks by status and priority', async () => {
    const prj = uniqProj('stats');
    for (let i = 0; i < 5; i++) {
      await tasks.createTask({ project: prj, title: `Hi ${i}`, priority: 'high', tags: ['backend'] });
    }
    for (let i = 0; i < 3; i++) {
      await tasks.createTask({ project: prj, title: `Lo ${i}`, priority: 'low', tags: ['frontend'] });
    }

    const all = await tasks.listTasks({ project: prj });
    const byPriority: Record<string, number> = {};
    const byTag: Record<string, number> = {};
    for (const t of all) {
      byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
      for (const tag of (t.tags || [])) byTag[tag] = (byTag[tag] || 0) + 1;
    }

    expect(all.length).toBe(8);
    expect(byPriority.high).toBe(5);
    expect(byPriority.low).toBe(3);
    expect(Object.keys(byTag)).toContain('backend');
    expect(Object.keys(byTag)).toContain('frontend');
  });

  it('computes completion rate (closed counts)', async () => {
    const prj = uniqProj('rate');
    const t = await tasks.createTask({ project: prj, title: 'To close', priority: 'medium' });
    for (let i = 0; i < 3; i++) {
      await tasks.createTask({ project: prj, title: `T${i}`, priority: 'medium' });
    }

    if (t) await tasks.closeTask(prj, t.id);

    const all = await tasks.listTasks({ project: prj });
    // closeTask sets status to 'closed', not 'completed'
    const closed = all.filter(t => t.status === 'closed').length;
    const active = all.filter(t => t.status !== 'completed' && t.status !== 'closed').length;
    expect(all.length).toBe(4);
    expect(closed).toBe(1);
    expect(active).toBe(3);
  });

  it('counts tasks with dependencies', async () => {
    const prj = uniqProj('deps');
    const parent = await tasks.createTask({ project: prj, title: 'Parent', priority: 'high' });
    const child = await tasks.createTask({ project: prj, title: 'Child', priority: 'medium' });

    if (child && parent) {
      await tasks.updateTask(prj, child.id, { dependsOn: [parent.id] } as any);
    }

    const all = await tasks.listTasks({ project: prj });
    const withDeps = all.filter(t => (t.dependsOn || []).length > 0);
    expect(withDeps.length).toBe(1);
    expect(withDeps[0].id).toBe(child?.id);
  });

  it('counts knowledge by type', async () => {
    const prj = uniqProj('ktypes');
    await knowledge.createDoc({ project: prj, title: 'API', content: 'api docs', type: 'api' });
    await knowledge.createDoc({ project: prj, title: 'Comp', content: 'component', type: 'component' });
    await knowledge.createDoc({ project: prj, title: 'Comp2', content: 'component 2', type: 'component' });

    const docs = await knowledge.listDocs({ project: prj });
    const byType: Record<string, number> = {};
    for (const d of docs) {
      const type = (d as any).type || 'general';
      byType[type] = (byType[type] || 0) + 1;
    }

    expect(byType.api).toBe(1);
    expect(byType.component).toBe(2);
  });
});

describe('dashboard_activity logic', () => {
  it('returns items sorted by updatedAt desc', async () => {
    const prj = uniqProj('activity');
    for (let i = 0; i < 5; i++) {
      await tasks.createTask({ project: prj, title: `Task ${i}`, priority: 'medium' });
    }

    const all = await tasks.listTasks({ project: prj });
    expect(all.length).toBe(5);

    const dates = all.map(t => t.updatedAt);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1] >= dates[i]).toBe(true);
    }
  });

  it('determines action from task status after close', async () => {
    const prj = uniqProj('action');
    const t = await tasks.createTask({ project: prj, title: 'Test', priority: 'medium' });
    expect(t?.status).toBe('pending');

    if (t) {
      await tasks.closeTask(prj, t.id);
      const closed = await tasks.getTask(prj, t.id);
      // closeTask sets status to 'closed'
      expect(closed?.status).toBe('closed');
    }
  });
});

describe('dashboard_trends logic', () => {
  it('counts tasks created within time window', async () => {
    const prj = uniqProj('trends');
    for (let i = 0; i < 5; i++) {
      await tasks.createTask({ project: prj, title: `T${i}`, priority: 'medium' });
    }

    const all = await tasks.listTasks({ project: prj });
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const recent = all.filter(t => new Date(t.createdAt) >= weekAgo);
    expect(recent.length).toBe(5);
  });

  it('computes cumulative totals', async () => {
    const prj = uniqProj('cumul');
    const t = await tasks.createTask({ project: prj, title: 'T1', priority: 'medium' });
    if (t) await tasks.closeTask(prj, t.id);
    for (let i = 0; i < 3; i++) {
      await tasks.createTask({ project: prj, title: `T${i + 2}`, priority: 'medium' });
    }

    const all = await tasks.listTasks({ project: prj, includeArchived: true });
    const closed = all.filter(t => t.status === 'closed').length;
    expect(closed).toBe(1);
    expect(all.length).toBe(4);
  });
});

describe('dashboard_project_summary logic', () => {
  it('groups tasks by project', async () => {
    const prjA = uniqProj('sum-a');
    const prjB = uniqProj('sum-b');
    for (let i = 0; i < 5; i++) {
      await tasks.createTask({ project: prjA, title: `A${i}`, priority: 'medium' });
    }
    for (let i = 0; i < 3; i++) {
      await tasks.createTask({ project: prjB, title: `B${i}`, priority: 'medium' });
    }

    const allTasks = await tasks.listTasks({ includeArchived: false });
    const stats: Record<string, number> = {};
    for (const t of allTasks) {
      const p = t.project;
      if (p === prjA || p === prjB) {
        stats[p] = (stats[p] || 0) + 1;
      }
    }

    expect(stats[prjA]).toBe(5);
    expect(stats[prjB]).toBe(3);
  });
});
