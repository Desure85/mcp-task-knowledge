/**
 * Live integration test for UI-35: project statuses, transitions and types
 * against a real MCP HTTP server.
 *
 * Gated on MCP_LIVE_URL like `api-client.live.test.ts`, so `npm test` stays
 * hermetic. The check is end-to-end on purpose — the screen's whole point is a
 * contract the browser cannot fake: five statuses, an explicit transition
 * graph, three types, and the two refusals (STATUS_IN_USE / TRANSITIONS_
 * UNREACHABLE_DONE) followed by a successful move.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';

const LIVE = process.env.MCP_LIVE_URL;
const JWT_SECRET = process.env.MCP_LIVE_JWT_SECRET;
const maybe = LIVE ? describe : describe.skip;

function mintJwt(secret: string, sub = 'ui35-live', roles: string[] = ['admin']): string {
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const body = b64({ sub, iat: now, exp: now + 900, roles });
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

maybe('project settings against a live MCP server', () => {
  let api: typeof import('./api-client').api;

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_MCP_API_URL = LIVE;
    if (JWT_SECRET) process.env.NEXT_PUBLIC_MCP_TOKEN = mintJwt(JWT_SECRET);
    ({ api } = await import('./api-client'));
  });

  it('saves five statuses, a graph and three types, and moves tasks before deleting', async () => {
    const project = `ui35${Date.now().toString(36)}`;
    await api.projects.create(project, 'UI-35 live check');

    const statuses = [
      { id: 'backlog', label: 'Backlog', category: 'todo' as const, color: 'st-todo', order: 0 },
      { id: 'ready', label: 'Ready', category: 'todo' as const, color: 'st-todo', order: 1 },
      { id: 'doing', label: 'Doing', category: 'in_progress' as const, color: 'st-doing', order: 2 },
      { id: 'done', label: 'Done', category: 'done' as const, color: 'st-done', order: 3 },
      { id: 'shipped', label: 'Shipped', category: 'done' as const, color: 'st-archive', order: 4 },
    ];

    const saved = await api.projects.statuses.set(project, statuses, {
      closeStatus: 'shipped',
      initialStatuses: ['backlog', 'ready'],
    });
    expect(saved.statuses.map((status) => status.id)).toEqual(['backlog', 'ready', 'doing', 'done', 'shipped']);
    expect(saved.closeStatus).toBe('shipped');
    expect(saved.defaults).toBe(false);

    const reread = await api.projects.statuses.get(project);
    expect(reread.statuses).toHaveLength(5);
    expect(reread.initialStatuses).toEqual(['backlog', 'ready']);

    const task = await api.tasks.create({ title: 'UI-35 live task', project, status: 'ready', type: 'bug' });
    expect(task.status).toBe('ready');

    const graph = {
      backlog: ['ready', 'done'],
      ready: ['doing'],
      doing: ['done'],
      done: ['shipped'],
      shipped: [],
    };
    await api.projects.transitions.set(project, graph);
    const transitions = await api.projects.transitions.get(project);
    expect(transitions.unrestricted).toBe(false);
    expect(transitions.transitions).toEqual(graph);

    await expect(
      api.projects.transitions.set(project, {
        backlog: [],
        ready: [],
        doing: [],
        done: [],
        shipped: [],
      }),
    ).rejects.toMatchObject({ code: 'TRANSITIONS_UNREACHABLE_DONE' });

    await api.projects.types.set(project, [
      { id: 'task', label: 'Task', color: 'ty-task', icon: 'task' },
      { id: 'bug', label: 'Bug', color: 'ty-bug', icon: 'bug' },
      { id: 'feature', label: 'Feature', color: 'ty-feature', icon: 'feature' },
    ]);
    expect((await api.projects.types.get(project)).types).toHaveLength(3);

    const withoutReady = statuses.filter((status) => status.id !== 'ready');
    await expect(
      api.projects.statuses.set(project, withoutReady, { closeStatus: 'shipped', initialStatuses: ['backlog'] }),
    ).rejects.toMatchObject({ code: 'STATUS_IN_USE' });

    // A removed status that still appears in the saved graph is rejected even
    // after the tasks are moved: the UI blocks this save and points at the
    // Transitions tab instead of sending a doomed request.
    await expect(
      api.projects.statuses.set(project, withoutReady, {
        closeStatus: 'shipped',
        initialStatuses: ['backlog'],
        moves: { ready: 'backlog' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITIONS' });

    await api.projects.transitions.set(project, {
      backlog: ['doing'],
      doing: ['done'],
      done: ['shipped'],
      shipped: [],
    });

    const moved = await api.projects.statuses.set(project, withoutReady, {
      closeStatus: 'shipped',
      initialStatuses: ['backlog'],
      moves: { ready: 'backlog' },
    });
    expect(moved.moved?.[0]).toMatchObject({ from: 'ready', to: 'backlog', count: 1 });
    expect((await api.tasks.get(project, task.id)).status).toBe('backlog');

    await expect(
      api.projects.types.set(project, [
        { id: 'task', label: 'Task', color: 'ty-task', icon: 'task' },
        { id: 'feature', label: 'Feature', color: 'ty-feature', icon: 'feature' },
      ]),
    ).rejects.toMatchObject({ code: 'TYPE_IN_USE' });

    const movedType = await api.projects.types.set(
      project,
      [
        { id: 'task', label: 'Task', color: 'ty-task', icon: 'task' },
        { id: 'feature', label: 'Feature', color: 'ty-feature', icon: 'feature' },
      ],
      { moves: { bug: 'task' } },
    );
    expect(movedType.moved?.[0]).toMatchObject({ from: 'bug', to: 'task', count: 1 });
    expect((await api.tasks.get(project, task.id)).type).toBe('task');

    await api.projects.remove(project, true);
  }, 60_000);
});
