import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type E2EServer } from './e2e-full/harness.js';

let srv: E2EServer;

function projectName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function createProject(id: string) {
  const res = await srv.callTool('project_create', { id, description: 'V-01 test' });
  expect(res.env.ok).toBe(true);
}

async function createTask(project: string, title: string, status?: string) {
  return srv.callTool('tasks_create', {
    project,
    title,
    ...(status ? { status } : {}),
  });
}

describe('project statuses (V-01)', () => {
  beforeAll(async () => {
    srv = await spawnServer('project-statuses');
  });

  afterAll(async () => {
    await srv?.close();
  });

  it('keeps the default four-status compatibility contract', async () => {
    const project = projectName('v01-default');
    await createProject(project);

    const res = await srv.callTool('project_statuses_get', { project });
    expect(res.env.ok).toBe(true);
    expect(res.env.data.statuses.map((s: any) => [s.id, s.category])).toEqual([
      ['pending', 'todo'],
      ['in_progress', 'in_progress'],
      ['completed', 'done'],
      ['closed', 'done'],
    ]);
    expect(res.env.data.closeStatus).toBe('closed');
    expect(res.env.data.initialStatuses).toEqual(['pending']);
    expect(res.env.data.defaults).toBe(true);

    const created = await createTask(project, 'default-compatible');
    expect(created.env.ok).toBe(true);
    expect(created.env.data.status).toBe('pending');
    const updated = await srv.callTool('tasks_update', { project, id: created.env.data.id, status: 'completed' });
    expect(updated.env.ok).toBe(true);
    expect(updated.env.data.status).toBe('completed');
  });

  it('accepts a custom set, validates initial statuses and counts dashboard by category', async () => {
    const project = projectName('v01-custom');
    await createProject(project);

    const statuses = [
      { id: 'todo', label: 'Todo', category: 'todo', color: 'st-todo', order: 0 },
      { id: 'doing', label: 'Doing', category: 'in_progress', color: 'st-doing', order: 1 },
      { id: 'done', label: 'Done', category: 'done', color: 'st-done', order: 2 },
      { id: 'dropped', label: 'Dropped', category: 'done', color: 'st-archive', order: 3 },
    ];
    const set = await srv.callTool('project_statuses_set', {
      project,
      statuses,
      closeStatus: 'done',
      initialStatuses: ['todo'],
    });
    expect(set.env.ok).toBe(true);
    expect(set.env.data.statuses.map((s: any) => s.id)).toEqual(['todo', 'doing', 'done', 'dropped']);

    const invalidInitial = await createTask(project, 'starts in doing', 'doing');
    expect(invalidInitial.isError).toBe(true);
    expect(invalidInitial.env.error.code).toBe('INITIAL_STATUS_NOT_ALLOWED');

    const created = await createTask(project, 'custom task', 'todo');
    expect(created.env.ok).toBe(true);
    const moved = await srv.callTool('tasks_update', { project, id: created.env.data.id, status: 'doing' });
    expect(moved.env.ok).toBe(true);
    const done = await srv.callTool('tasks_update', { project, id: created.env.data.id, status: 'done' });
    expect(done.env.ok).toBe(true);

    const filtered = await srv.callTool('tasks_list', { project, status: 'done' });
    expect(filtered.env.ok).toBe(true);
    expect(filtered.env.data.map((t: any) => t.id)).toContain(created.env.data.id);

    const dashboard = await srv.callTool('dashboard_stats', { project });
    expect(dashboard.env.ok).toBe(true);
    expect(dashboard.env.data.tasks.byCategory.done).toBe(1);
    expect(dashboard.env.data.tasks.completed).toBe(1);
    expect(dashboard.env.data.tasks.completionRate).toBe('100%');
  });

  it('rejects removing a status in use and supports moveTo', async () => {
    const project = projectName('v01-in-use');
    await createProject(project);
    const statuses = [
      { id: 'todo', label: 'Todo', category: 'todo', color: 'st-todo', order: 0 },
      { id: 'doing', label: 'Doing', category: 'in_progress', color: 'st-doing', order: 1 },
      { id: 'done', label: 'Done', category: 'done', color: 'st-done', order: 2 },
    ];
    expect((await srv.callTool('project_statuses_set', { project, statuses })).env.ok).toBe(true);
    const task = await createTask(project, 'occupies doing', 'todo');
    await srv.callTool('tasks_update', { project, id: task.env.data.id, status: 'doing' });

    const blocked = await srv.callTool('project_statuses_set', {
      project,
      statuses: statuses.filter((s) => s.id !== 'doing'),
    });
    expect(blocked.isError).toBe(true);
    expect(blocked.env.error.code).toBe('STATUS_IN_USE');
    expect(blocked.env.error.taskIds).toContain(task.env.data.id);
    expect(blocked.env.error.details.taskIds).toContain(task.env.data.id);

    const moved = await srv.callTool('project_statuses_set', {
      project,
      statuses: statuses.filter((s) => s.id !== 'doing'),
      moveTo: 'todo',
    });
    expect(moved.env.ok).toBe(true);
    expect(moved.env.data.moved).toEqual([{ from: 'doing', to: 'todo', count: 1 }]);
    const after = await srv.callTool('tasks_get', { project, id: task.env.data.id });
    expect(after.env.data.status).toBe('todo');
  });

  it('reports invalid status ids and missing mandatory categories', async () => {
    const project = projectName('v01-invalid');
    await createProject(project);
    const task = await createTask(project, 'bad status');
    expect(task.env.ok).toBe(true);

    const bad = await srv.callTool('tasks_update', { project, id: task.env.data.id, status: 'nope' });
    expect(bad.isError).toBe(true);
    expect(bad.env.error.code).toBe('STATUS_NOT_ALLOWED');
    expect(bad.env.error.details.allowed).toContain('pending');

    const duplicate = await srv.callTool('project_statuses_set', {
      project,
      statuses: [
        { id: 'x', label: 'X', category: 'todo', order: 0 },
        { id: 'x', label: 'X2', category: 'done', order: 1 },
      ],
    });
    expect(duplicate.isError).toBe(true);
    expect(duplicate.env.error.code).toBe('INVALID_STATUSES');

    const noDone = await srv.callTool('project_statuses_set', {
      project,
      statuses: [{ id: 'x', label: 'X', category: 'todo', order: 0 }],
    });
    expect(noDone.isError).toBe(true);
    expect(noDone.env.error.code).toBe('INVALID_STATUSES');
  });

  it('uses the project close status', async () => {
    const project = projectName('v01-close');
    await createProject(project);
    const statuses = [
      { id: 'backlog', label: 'Backlog', category: 'todo', order: 0 },
      { id: 'working', label: 'Working', category: 'in_progress', order: 1 },
      { id: 'finished', label: 'Finished', category: 'done', order: 2 },
    ];
    await srv.callTool('project_statuses_set', {
      project,
      statuses,
      closeStatus: 'finished',
      initialStatuses: ['backlog'],
    });
    const task = await createTask(project, 'close target', 'backlog');
    const closed = await srv.callTool('tasks_close', { project, id: task.env.data.id });
    expect(closed.env.ok).toBe(true);
    expect(closed.env.data.closed.status).toBe('finished');
  });
});
