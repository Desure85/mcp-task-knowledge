import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnServer, type E2EServer } from './e2e-full/harness.js';

let srv: E2EServer;

function projectName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function createProject(id: string) {
  const res = await srv.callTool('project_create', { id, description: 'V-03 task type test' });
  expect(res.env.ok).toBe(true);
}

async function createTask(project: string, title: string, type?: string) {
  return srv.callTool('tasks_create', { project, title, ...(type ? { type } : {}) });
}

describe('task type (V-03)', () => {
  beforeAll(async () => {
    srv = await spawnServer('task-type');
  });

  afterAll(async () => {
    await srv?.close();
  });

  it('uses task, bug and feature by default, accepts a type and filters lists', async () => {
    const project = projectName('v03-default');
    await createProject(project);

    const defaults = await srv.callTool('project_types_get', { project });
    expect(defaults.env.ok).toBe(true);
    expect(defaults.env.data.types.map((t: any) => t.id)).toEqual(['task', 'bug', 'feature']);
    expect(defaults.env.data.defaults).toBe(true);

    const plain = await createTask(project, 'plain');
    expect(plain.env.ok).toBe(true);
    expect(plain.env.data.type).toBe('task');

    const bug = await createTask(project, 'bug task', 'bug');
    expect(bug.env.ok).toBe(true);
    expect(bug.env.data.type).toBe('bug');

    const filtered = await srv.callTool('tasks_list', { project, type: 'bug' });
    expect(filtered.env.data.map((t: any) => t.id)).toEqual([bug.env.data.id]);

    const invalid = await srv.callTool('tasks_list', { project, type: 'nope' });
    expect(invalid.isError).toBe(true);
    expect(invalid.env.error.code).toBe('TYPE_NOT_ALLOWED');
    expect(invalid.env.error.allowed).toEqual(['task', 'bug', 'feature']);

    const invalidCreate = await createTask(project, 'bad', 'nope');
    expect(invalidCreate.isError).toBe(true);
    expect(invalidCreate.env.error.code).toBe('TYPE_NOT_ALLOWED');

    const tree = await srv.callTool('tasks_tree', { project, type: 'bug' });
    expect(tree.env.data.map((t: any) => t.id)).toEqual([bug.env.data.id]);

    const search = await srv.callTool('search_tasks', { project, query: 'bug', type: 'bug' });
    expect(search.env.data.every((r: any) => (r.item.type ?? 'task') === 'bug')).toBe(true);
    const badSearch = await srv.callTool('search_tasks', { project, query: 'bug', type: 'nope' });
    expect(badSearch.isError).toBe(true);
    expect(badSearch.env.error.code).toBe('TYPE_NOT_ALLOWED');
  });

  it('treats a legacy task without a type as task without migration', async () => {
    const project = projectName('v03-legacy');
    await createProject(project);
    const id = `legacy-${Date.now()}`;
    const file = path.join(srv.store, 'tasks', project, `${id}.json`);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify({
      id,
      project,
      title: 'legacy task',
      status: 'pending',
      priority: 'medium',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, null, 2));

    const listed = await srv.callTool('tasks_list', { project, type: 'task' });
    expect(listed.env.ok).toBe(true);
    expect(listed.env.data.find((t: any) => t.id === id)?.type).toBe('task');
    const got = await srv.callTool('tasks_get', { project, id });
    expect(got.env.data.type).toBe('task');
  });

  it('requires a move target before removing a used type', async () => {
    const project = projectName('v03-custom');
    await createProject(project);

    const set = await srv.callTool('project_types_set', {
      project,
      types: [
        { id: 'task', label: 'Task', color: 'ty-task', icon: 'task' },
        { id: 'bug', label: 'Bug', color: 'ty-bug', icon: 'bug' },
        { id: 'chore', label: 'Chore', color: 'ty-task', icon: 'tool' },
      ],
    });
    expect(set.env.ok).toBe(true);
    expect(set.env.data.types.map((t: any) => t.id)).toEqual(['task', 'bug', 'chore']);

    const chore = await createTask(project, 'chore task', 'chore');
    expect(chore.env.ok).toBe(true);

    const blocked = await srv.callTool('project_types_set', {
      project,
      types: [
        { id: 'task', label: 'Task', color: 'ty-task' },
        { id: 'bug', label: 'Bug', color: 'ty-bug' },
      ],
    });
    expect(blocked.isError).toBe(true);
    expect(blocked.env.error.code).toBe('TYPE_IN_USE');
    expect(blocked.env.error.taskIds).toContain(chore.env.data.id);

    const moved = await srv.callTool('project_types_set', {
      project,
      types: [
        { id: 'task', label: 'Task', color: 'ty-task' },
        { id: 'bug', label: 'Bug', color: 'ty-bug' },
      ],
      moveTo: 'task',
    });
    expect(moved.env.ok).toBe(true);
    expect(moved.env.data.moved[0]).toMatchObject({ from: 'chore', to: 'task', count: 1 });
    const after = await srv.callTool('tasks_get', { project, id: chore.env.data.id });
    expect(after.env.data.type).toBe('task');
  });

  it('supports bulk create/update and reports type distribution', async () => {
    const project = projectName('v03-bulk');
    await createProject(project);
    const bulk = await srv.callTool('tasks_bulk_create', {
      project,
      items: [
        { title: 'bulk task', type: 'task' },
        { title: 'bulk bug', type: 'bug' },
        { title: 'bulk feature', type: 'feature' },
      ],
    });
    expect(bulk.env.ok).toBe(true);
    expect(bulk.env.data.created.map((t: any) => t.type)).toEqual(['task', 'bug', 'feature']);

    const first = bulk.env.data.created[0];
    const upd = await srv.callTool('tasks_bulk_update', {
      project,
      items: [{ id: first.id, type: 'bug' }],
    });
    expect(upd.env.ok).toBe(true);
    expect(upd.env.data.results[0].type).toBe('bug');

    const brief = await srv.callTool('briefing', { project, maxTasks: 20 });
    expect(brief.env.data.counts.byType).toEqual({ bug: 2, feature: 1 });
    expect(brief.env.data.openTasks.find((t: any) => t.id === first.id)?.type).toBe('bug');

    const stats = await srv.callTool('dashboard_stats', { project });
    expect(stats.env.data.tasks.byType).toEqual({ bug: 2, feature: 1 });
  });

  it('keeps a concurrently edited type set consistent with bulk creation', async () => {
    const project = projectName('v03-race');
    await createProject(project);
    const initial = await srv.callTool('project_types_set', {
      project,
      types: [
        { id: 'task', label: 'Task', color: 'ty-task' },
        { id: 'legacy', label: 'Legacy', color: 'ty-task' },
      ],
    });
    expect(initial.env.ok).toBe(true);

    const creates = srv.callTool('tasks_bulk_create', {
      project,
      items: Array.from({ length: 20 }, (_, i) => ({ title: `race-${i}`, type: 'legacy' })),
    });
    const set = srv.callTool('project_types_set', {
      project,
      types: [{ id: 'task', label: 'Task', color: 'ty-task' }],
      moveTo: 'task',
    });
    const [created, changed] = await Promise.all([creates, set]);
    expect(changed.env.ok).toBe(true);

    const listed = await srv.callTool('tasks_list', { project });
    expect(listed.env.ok).toBe(true);
    expect(listed.env.data.every((t: any) => (t.type ?? 'task') === 'task')).toBe(true);
    if (created.env.ok) {
      expect(created.env.data.created.every((t: any) => (t.type ?? 'task') === 'task')).toBe(true);
    } else {
      expect(created.env.error.code).toBe('TYPE_NOT_ALLOWED');
    }
  });
});
