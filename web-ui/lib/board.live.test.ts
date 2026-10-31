/**
 * Live test for the V-04 board contract: a project with nine statuses and a
 * transition graph, one allowed move and one server-rejected move.
 *
 * Gated on MCP_LIVE_URL (skipped by default, like api-client.live.test.ts):
 *   MCP_LIVE_URL=http://localhost:3481/mcp MCP_LIVE_JWT_SECRET=... \
 *   npx vitest run lib/board.live.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';
import type { ToolCallError } from './api-client';

const LIVE = process.env.MCP_LIVE_URL;
const JWT_SECRET = process.env.MCP_LIVE_JWT_SECRET;
const maybe = LIVE ? describe : describe.skip;

function mintJwt(secret: string, sub = 'board-live', roles: string[] = ['admin']): string {
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const body = b64({ sub, iat: now, exp: now + 600, roles });
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

const STATUSES = [
  { id: 'backlog', label: 'Backlog', category: 'todo' as const, color: 'st-todo', order: 0 },
  { id: 'triage', label: 'Triage', category: 'todo' as const, color: 'st-todo', order: 1 },
  { id: 'ready', label: 'Ready', category: 'todo' as const, color: 'st-todo', order: 2 },
  { id: 'doing', label: 'In progress', category: 'in_progress' as const, color: 'st-doing', order: 3 },
  { id: 'review', label: 'In review', category: 'in_progress' as const, color: 'st-review', order: 4 },
  { id: 'qa', label: 'QA', category: 'in_progress' as const, color: 'st-review', order: 5 },
  { id: 'blocked', label: 'Blocked', category: 'in_progress' as const, color: 'st-blocked', order: 6 },
  { id: 'done', label: 'Done', category: 'done' as const, color: 'st-done', order: 7 },
  { id: 'archive', label: 'Archive', category: 'done' as const, color: 'st-archive', order: 8 },
];

const TRANSITIONS: Record<string, string[]> = {
  backlog: ['triage', 'ready'],
  triage: ['ready', 'blocked'],
  ready: ['doing', 'blocked'],
  doing: ['review', 'blocked'],
  review: ['qa', 'doing', 'blocked'],
  qa: ['done', 'review', 'blocked'],
  blocked: ['triage', 'ready', 'doing'],
  done: ['archive', 'ready'],
  archive: ['ready'],
};

maybe('V-04 board against a live MCP server', () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_MCP_API_URL = LIVE;
    if (JWT_SECRET) process.env.NEXT_PUBLIC_MCP_TOKEN = mintJwt(JWT_SECRET);
  });

  it('serves project statuses, allows a valid move and rejects a forbidden one with the allowed list', async () => {
    const { api } = await import('./api-client');
    const { allowedTargets } = await import('./board');
    const project = `board-live-${Date.now()}`;

    await api.projects.create(project);
    try {
      await api.projects.statuses.set(project, STATUSES, {
        closeStatus: 'done',
        initialStatuses: STATUSES.map((status) => status.id),
      });
      await api.projects.transitions.set(project, TRANSITIONS);

      const statuses = await api.projects.statuses.get(project);
      expect(statuses.statuses.map((status) => status.id)).toEqual(STATUSES.map((status) => status.id));
      const transitions = await api.projects.transitions.get(project);
      expect(transitions.transitions).toEqual(TRANSITIONS);
      expect(transitions.unrestricted).toBe(false);

      const task = await api.tasks.create({ project, title: 'Live board card', status: 'backlog' });
      const moved = await api.tasks.update(project, task.id, { status: 'triage' });
      expect(moved.status).toBe('triage');

      let rejection: ToolCallError | null = null;
      try {
        await api.tasks.update(project, task.id, { status: 'done' });
      } catch (error) {
        rejection = error as ToolCallError;
      }

      expect(rejection?.code).toBe('TRANSITION_NOT_ALLOWED');
      const details = rejection?.details as { from?: string; to?: string; allowed?: string[] } | undefined;
      expect(details?.from).toBe('triage');
      expect(details?.to).toBe('done');
      expect(details?.allowed).toEqual(['ready', 'blocked']);
      expect(rejection?.hint).toContain('ready');

      // The UI derives the same target list from the graph it loaded.
      expect(allowedTargets(transitions.transitions, 'triage', statuses.statuses)).toEqual(['ready', 'blocked']);

      const unchanged = await api.tasks.get(project, task.id);
      expect(unchanged.status).toBe('triage');
    } finally {
      await api.projects.remove(project, true);
    }
  }, 60_000);
});
