import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerContext } from '../src/register/context.js';
import type { Task } from '../src/types.js';
import { registerTaskCommandTools } from '../src/register/task-tools';
import {
  buildWorkItem,
  filterToIds,
  hasPredicate,
  parseTaskCommand,
  TaskCommandError,
  totalMinutes,
} from '../src/commands/task-command.js';

const update = vi.fn(async (_p: string, id: string, patch: Record<string, unknown>) => ({ id, ...patch }));

interface ToolResult { content: Array<{ text: string }> }
interface CommandBody {
  ok: boolean;
  error?: { code?: string };
  data: {
    dryRun: boolean;
    planned: Array<{ id: string }>;
    applied: Array<{ id: string }>;
    totalMinutes?: number;
  };
}
type Handler = (args: Record<string, unknown>, extra?: { sessionId?: string }) => Promise<ToolResult>;
const handlers: Record<string, Handler> = {};
const tasks = [
  { id: 't1', project: 'p', title: 'one', status: 'pending', priority: 'high', assignee: 'u1', tags: ['x'] },
  { id: 't2', project: 'p', title: 'two', status: 'completed', priority: 'low', assignee: 'u2', tags: [] },
  { id: 't3', project: 'p', title: 'three', status: 'in_progress', priority: 'medium', assignee: 'u1', tags: [] },
];
const ctx = {
  server: { registerTool: (name: string, _def: unknown, handler: Handler) => { handlers[name] = handler; } },
  storage: {
    tasks: {
      list: async () => tasks.map((t) => ({ ...t })),
      get: async (_p: string, id: string) => tasks.find((t) => t.id === id) ?? null,
      update,
    },
  },
  sessionManager: { get: (sid: string) => sid === 'auth-session' ? { metadata: { userId: 'u1' } } : undefined },
} as unknown as ServerContext;

function body(result: ToolResult): CommandBody {
  return JSON.parse(result.content[0].text) as CommandBody;
}

describe('TK-05 command grammar and pure helpers', () => {
  it('parses only the two supported forms', () => {
    expect(parseTaskCommand('State Done')).toEqual({ forMe: false, statusToken: 'Done' });
    expect(parseTaskCommand('for me State Done')).toEqual({ forMe: true, statusToken: 'Done' });
    expect(() => parseTaskCommand('assign me State Done')).toThrow(TaskCommandError);
    expect(() => parseTaskCommand('State')).toThrow(/unsupported/);
  });

  it('filters by ids/tag/assignee and requires a predicate', () => {
    expect(filterToIds(tasks as unknown as Task[], { ids: ['t1'] }).map((t) => t.id)).toEqual(['t1']);
    expect(filterToIds(tasks as unknown as Task[], { tag: 'x' }).map((t) => t.id)).toEqual(['t1']);
    expect(filterToIds(tasks as unknown as Task[], { assignee: 'u1' }).map((t) => t.id)).toEqual(['t1', 't3']);
    expect(hasPredicate({})).toBe(false);
    expect(hasPredicate({ ids: [] })).toBe(false);
    expect(hasPredicate({ status: 'pending' })).toBe(true);
  });

  it('builds work items and sums minutes', () => {
    const item = buildWorkItem({ id: 'w1', durationMin: 30, userId: 'u1', now: '2026-11-13T00:00:00Z' });
    expect(item).toMatchObject({ id: 'w1', durationMin: 30, userId: 'u1', startedAt: '2026-11-13T00:00:00Z' });
    expect(totalMinutes([item, { ...item, id: 'w2', durationMin: 15 }])).toBe(45);
  });
});

describe('TK-05 handlers', () => {
  beforeEach(() => {
    update.mockClear();
    if (!handlers['tasks_command']) {
      registerTaskCommandTools(ctx);
    }
  });

  it('previews by default and refuses apply without confirm', async () => {
    const preview = body(await handlers['tasks_command']!({ command: 'State Completed', filter: { assignee: 'u1' } }, {}));
    expect(preview.ok).toBe(true);
    expect(preview.data.dryRun).toBe(true);
    expect(preview.data.planned).toHaveLength(2);
    expect(update).not.toHaveBeenCalled();

    const refused = body(await handlers['tasks_command']!(
      { command: 'State Completed', filter: { assignee: 'u1' }, dryRun: false },
      {},
    ));
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe('COMMAND_CONFIRM_REQUIRED');
  });

  it('applies with confirm and reports per-task failures', async () => {
    const res = body(await handlers['tasks_command']!(
      { command: 'State Completed', filter: { assignee: 'u1' }, dryRun: false, confirm: true },
      {},
    ));
    expect(res.ok).toBe(true);
    expect(res.data.applied.map((x) => x.id)).toEqual(['t1', 't3']);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('requires identity for "for me" and accepts an auth session', async () => {
    const noUser = body(await handlers['tasks_command']!({ command: 'for me State Completed' }, {}));
    expect(noUser.ok).toBe(false);
    expect(noUser.error?.code).toBe('COMMAND_IDENTITY_REQUIRED');

    const withUser = body(await handlers['tasks_command']!(
      { command: 'for me State In progress' },
      { sessionId: 'auth-session' },
    ));
    expect(withUser.ok).toBe(true);
    expect(withUser.data.planned.map((x) => x.id)).toEqual(['t1', 't3']);
  });

  it('appends work items and lists the total', async () => {
    const added = body(await handlers['tasks_worklog_add']!({ id: 't1', project: 'p', durationMin: 45, description: 'review' }, {}));
    expect(added.ok).toBe(true);
    expect(added.data.totalMinutes).toBe(45);
    expect(update.mock.calls[0]?.[0]).toBe('p');
    expect(update.mock.calls[0]?.[2]).toEqual({ workItems: [expect.objectContaining({ durationMin: 45 })] });

    const listed = body(await handlers['tasks_worklog_list']!({ id: 't2', project: 'p' }, {}));
    expect(listed.ok).toBe(true);
    expect(listed.data.totalMinutes).toBe(0);
  });
});
