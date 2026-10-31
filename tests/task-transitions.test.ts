import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type E2EServer } from './e2e-full/harness.js';

let srv: E2EServer;

function projectName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

const STATUSES = [
  { id: 'todo', label: 'Todo', category: 'todo', color: 'st-todo', order: 0 },
  { id: 'doing', label: 'Doing', category: 'in_progress', color: 'st-doing', order: 1 },
  { id: 'done', label: 'Done', category: 'done', color: 'st-done', order: 2 },
];

async function setupProject(transitions?: Record<string, string[]> | null) {
  const project = projectName('v02');
  expect((await srv.callTool('project_create', { id: project })).env.ok).toBe(true);
  expect((await srv.callTool('project_statuses_set', {
    project,
    statuses: STATUSES,
    closeStatus: 'done',
    initialStatuses: ['todo'],
  })).env.ok).toBe(true);
  if (transitions !== undefined) {
    const res = await srv.callTool('project_transitions_set', { project, transitions });
    expect(res.env.ok).toBe(true);
  }
  return project;
}

async function create(project: string, title: string) {
  const res = await srv.callTool('tasks_create', { project, title, status: 'todo' });
  expect(res.env.ok).toBe(true);
  return res.env.data.id as string;
}

describe('project transitions (V-02)', () => {
  beforeAll(async () => {
    srv = await spawnServer('task-transitions');
  });

  afterAll(async () => {
    await srv?.close();
  });

  it('defaults to any transition', async () => {
    const project = projectName('v02-default');
    expect((await srv.callTool('project_create', { id: project })).env.ok).toBe(true);
    const created = await srv.callTool('tasks_create', { project, title: 'free move', status: 'pending' });
    expect(created.env.ok).toBe(true);
    const res = await srv.callTool('tasks_update', { project, id: created.env.data.id, status: 'completed' });
    expect(res.env.ok).toBe(true);
    expect(res.env.data.status).toBe('completed');
  });

  it('allows a configured transition and rejects a forbidden one with context', async () => {
    const project = await setupProject({
      todo: ['doing'],
      doing: ['done'],
      done: [],
    });
    const task = await create(project, 'ordered');

    const forbidden = await srv.callTool('tasks_update', { project, id: task, status: 'done' });
    expect(forbidden.isError).toBe(true);
    expect(forbidden.env.error.code).toBe('TRANSITION_NOT_ALLOWED');
    expect(forbidden.env.error).toMatchObject({ from: 'todo', to: 'done', allowed: ['doing'] });
    expect(forbidden.env.error.details).toMatchObject({ from: 'todo', to: 'done', allowed: ['doing'] });

    const allowed = await srv.callTool('tasks_update', { project, id: task, status: 'doing' });
    expect(allowed.env.ok).toBe(true);
    const next = await srv.callTool('tasks_update', { project, id: task, status: 'done' });
    expect(next.env.ok).toBe(true);
  });

  it('applies bulk updates per task and reports forbidden items', async () => {
    const project = await setupProject({
      todo: ['doing'],
      doing: ['done'],
      done: [],
    });
    const a = await create(project, 'bulk-a');
    const b = await create(project, 'bulk-b');

    const res = await srv.callTool('tasks_bulk_update', {
      project,
      items: [
        { id: a, status: 'doing' },
        { id: b, status: 'done' },
      ],
    });
    expect(res.env.ok).toBe(true);
    expect(res.env.data.count).toBe(1);
    expect(res.env.data.results[0].id).toBe(a);
    expect(res.env.data.failed).toHaveLength(1);
    expect(res.env.data.failed[0]).toMatchObject({
      id: b,
      error: { code: 'TRANSITION_NOT_ALLOWED', details: { from: 'todo', to: 'done' } },
    });
  });

  it('rejects a forbidden bulk close and keeps allowed items', async () => {
    const project = await setupProject({
      todo: ['doing'],
      doing: ['done'],
      done: [],
    });
    const task = await create(project, 'cannot close directly');
    const res = await srv.callTool('tasks_bulk_close', { project, ids: [task] });
    expect(res.env.ok).toBe(true);
    expect(res.env.data.count).toBe(0);
    expect(res.env.data.failed[0].error.code).toBe('TRANSITION_NOT_ALLOWED');
  });

  it('validates references and reachability of done statuses', async () => {
    const project = await setupProject();
    const unknown = await srv.callTool('project_transitions_set', {
      project,
      transitions: { todo: ['missing'] },
    });
    expect(unknown.isError).toBe(true);
    expect(unknown.env.error.code).toBe('INVALID_TRANSITIONS');

    const unreachable = await srv.callTool('project_transitions_set', {
      project,
      transitions: { todo: [], doing: [], done: [] },
    });
    expect(unreachable.isError).toBe(true);
    expect(unreachable.env.error.code).toBe('TRANSITIONS_UNREACHABLE_DONE');

    const reset = await srv.callTool('project_transitions_set', { project, transitions: null });
    expect(reset.env.ok).toBe(true);
    expect(reset.env.data.unrestricted).toBe(true);
  });
});
