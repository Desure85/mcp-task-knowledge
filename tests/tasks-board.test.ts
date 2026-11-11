import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type E2EServer } from './e2e-full/harness.js';

let srv: E2EServer;

function projectName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function create(project: string, title: string, extra: Record<string, unknown> = {}) {
  const res = await srv.callTool('tasks_create', { project, title, ...extra });
  expect(res.env.ok).toBe(true);
  return res.env.data.id as string;
}

describe('tasks_list groupByStatus (SC-04)', () => {
  beforeAll(async () => {
    srv = await spawnServer('tasks-board');
  });

  afterAll(async () => {
    await srv?.close();
  });

  it('returns bounded newest tasks per status with exact totals and offsets', async () => {
    const project = projectName('sc04');
    expect((await srv.callTool('project_create', { id: project })).env.ok).toBe(true);
    expect((await srv.callTool('project_statuses_set', {
      project,
      statuses: [
        { id: 'pending', label: 'Pending', category: 'todo', color: 'st-todo', order: 0 },
        { id: 'in_progress', label: 'In progress', category: 'in_progress', color: 'st-doing', order: 1 },
        { id: 'done', label: 'Done', category: 'done', color: 'st-done', order: 2 },
      ],
      closeStatus: 'done',
      initialStatuses: ['pending'],
    })).env.ok).toBe(true);
    for (let i = 1; i <= 3; i++) {
      await create(project, `pending-${i}`, { priority: i === 3 ? 'high' : 'medium' });
    }
    const doing = await create(project, 'doing-1', { type: 'bug' });
    expect((await srv.callTool('tasks_update', { project, id: doing, status: 'in_progress' })).env.ok).toBe(true);

    const first = await srv.callTool('tasks_list', { project, limit: 2, groupByStatus: true });
    expect(first.env.ok).toBe(true);
    const pending = first.env.data.columns.find((column: { status: string }) => column.status === 'pending');
    expect(pending.total).toBe(3);
    expect(pending.items).toHaveLength(2);
    expect(pending.nextOffset).toBe(2);
    expect(first.env.data.total).toBe(4);
    expect(first.env.data.typeCounts).toMatchObject({ task: 3, bug: 1 });

    const second = await srv.callTool('tasks_list', {
      project,
      limit: 2,
      groupByStatus: true,
      offsets: { pending: 2 },
    });
    const rest = second.env.data.columns.find((column: { status: string }) => column.status === 'pending');
    expect(rest.items).toHaveLength(1);
    expect(rest.nextOffset).toBeNull();

    const high = await srv.callTool('tasks_list', { project, limit: 10, groupByStatus: true, priority: 'high' });
    expect(high.env.data.total).toBe(1);
    const highPending = high.env.data.columns.find((column: { status: string }) => column.status === 'pending');
    expect(highPending.total).toBe(1);
    expect(highPending.items[0].title).toBe('pending-3');
  });
});
