/**
 * Live test for the V-05 board contract: a project with task types, tasks of
 * several types and the server-side `type` filter that one-type mode uses.
 *
 * Gated on MCP_LIVE_URL (skipped by default):
 *   MCP_LIVE_URL=http://localhost:3481/mcp MCP_LIVE_JWT_SECRET=... \
 *   npx vitest run lib/board-lanes.live.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';
import type { ToolCallError } from './api-client';

const LIVE = process.env.MCP_LIVE_URL;
const JWT_SECRET = process.env.MCP_LIVE_JWT_SECRET;
const maybe = LIVE ? describe : describe.skip;

function mintJwt(secret: string, sub = 'lanes-live', roles: string[] = ['admin']): string {
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const body = b64({ sub, iat: now, exp: now + 600, roles });
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

const STATUSES = [
  { id: 'backlog', label: 'Backlog', category: 'todo' as const, color: 'st-todo', order: 0 },
  { id: 'doing', label: 'In progress', category: 'in_progress' as const, color: 'st-doing', order: 1 },
  { id: 'review', label: 'In review', category: 'in_progress' as const, color: 'st-review', order: 2 },
  { id: 'done', label: 'Done', category: 'done' as const, color: 'st-done', order: 3 },
];

const TYPES = [
  { id: 'task', label: 'Task', color: 'ty-task', icon: 'task' },
  { id: 'bug', label: 'Bug', color: 'ty-bug', icon: 'bug' },
  { id: 'feature', label: 'Feature', color: 'ty-feature', icon: 'feature' },
];

maybe('V-05 lanes against a live MCP server', () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_MCP_API_URL = LIVE;
    if (JWT_SECRET) process.env.NEXT_PUBLIC_MCP_TOKEN = mintJwt(JWT_SECRET);
  });

  it('stores project types, filters tasks by type and splits them into lanes', async () => {
    const { api } = await import('./api-client');
    const { buildLanes, taskTypeId } = await import('./board-lanes');
    const project = `lanes-live-${Date.now()}`;

    await api.projects.create(project);
    try {
      await api.projects.statuses.set(project, STATUSES, {
        closeStatus: 'done',
        initialStatuses: STATUSES.map((status) => status.id),
      });
      await api.projects.transitions.set(project, {
        backlog: ['doing'],
        doing: ['review', 'backlog'],
        review: ['done', 'doing'],
        done: ['backlog'],
      });
      await api.projects.types.set(project, TYPES);

      const types = await api.projects.types.get(project);
      expect(types.types.map((type) => type.id)).toEqual(['task', 'bug', 'feature']);

      const bugA = await api.tasks.create({ project, title: 'Bug A', type: 'bug', status: 'backlog' });
      const bugB = await api.tasks.create({ project, title: 'Bug B', type: 'bug', status: 'doing' });
      await api.tasks.create({ project, title: 'Feature A', type: 'feature', status: 'backlog' });
      await api.tasks.create({ project, title: 'Feature B', type: 'feature', status: 'review' });
      const plain = await api.tasks.create({ project, title: 'Plain task', status: 'backlog' });

      expect(taskTypeId(plain)).toBe('task');

      const all = await api.tasks.list(project);
      expect(all).toHaveLength(5);
      const bugs = await api.tasks.list(project, 'bug');
      expect(bugs.map((task) => task.id).sort()).toEqual([bugA.id, bugB.id].sort());
      expect(bugs.every((task) => task.type === 'bug')).toBe(true);

      const lanes = buildLanes(types.types, all);
      expect(lanes.map((lane) => [lane.id, lane.tasks.length])).toEqual([
        ['task', 1],
        ['bug', 2],
        ['feature', 2],
      ]);
      const onlyBug = buildLanes(types.types, bugs, { selected: ['bug'] });
      expect(onlyBug).toHaveLength(1);
      expect(onlyBug[0].tasks.map((task) => task.id).sort()).toEqual([bugA.id, bugB.id].sort());

      let rejection: ToolCallError | null = null;
      try {
        await api.tasks.create({ project, title: 'Ghost', type: 'ghost' });
      } catch (error) {
        rejection = error as ToolCallError;
      }
      expect(rejection?.code).toBe('TYPE_NOT_ALLOWED');
    } finally {
      await api.projects.remove(project, true);
    }
  }, 60_000);
});
