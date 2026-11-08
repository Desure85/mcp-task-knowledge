/**
 * AC-02 — honest counters and one meaning for the word "blocked".
 *
 * Three defects were confirmed on `master` f6a748f (see `BACKLOG.md` AC-02):
 *
 *   1. `tasks_list({ countOnly: true })` returned `count: 0` next to `total: 4`, because both
 *      finalisers wrote a hard zero — the counter contradicted the only number it should show;
 *   2. `search_tasks` reported the size of its ranking pool as `total` with `totalExact: true`
 *      (`Math.max(limit ?? 50, 50)` candidates), so 60 matches looked like exactly 50;
 *   3. `tasks_set_deps` used the top-level `status` for three different things across three
 *      branches: the saved status, the word `blocked`, the word `unblocked`.
 *
 * The test runs the real server context over an in-memory transport.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServerContext } from '../src/register/setup.js';
import { defaultRegistration } from '../src/core/app-container.js';
import type { ServerContext } from '../src/register/context.js';

const PROJECT = `ac02-${Date.now().toString(36)}`;

let ctx: ServerContext;
let client: Client;

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await client.callTool({ name, arguments: args });
  return JSON.parse(((res?.content as any)?.[0]?.text as string) ?? '{}');
}

beforeAll(async () => {
  ctx = await createServerContext();
  await defaultRegistration(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await ctx.server.connect(serverTransport);
  client = new Client({ name: 'ac02', version: '0.0.0' });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client?.close();
});

describe('AC-02: countOnly reports the number of matches', () => {
  it('returns count === total instead of a hard zero', async () => {
    for (const title of ['counter one', 'counter two', 'counter three']) {
      const created = await call('tasks_create', { project: PROJECT, title });
      expect(created.ok).toBe(true);
    }

    const counted = await call('tasks_list', { project: PROJECT, countOnly: true });
    expect(counted.ok).toBe(true);
    expect(counted.data).toEqual([]);
    expect(counted.total).toBeGreaterThanOrEqual(3);
    expect(counted.count).toBe(counted.total);
  });
});

describe('AC-02: search_tasks does not pass the pool size off as the match count', () => {
  it('marks a capped ranking as not exact and names the candidates', async () => {
    const items = Array.from({ length: 60 }, (_, index) => ({ title: `zebrafish specimen ${index}` }));
    const created = await call('tasks_bulk_create', { project: PROJECT, items });
    expect(created.ok).toBe(true);

    const found = await call('search_tasks', { project: PROJECT, query: 'zebrafish', limit: 50 });
    expect(found.ok).toBe(true);
    const matches = found.total as number;
    const candidates = found.candidates as number | undefined;

    // Either the real number of matches, or an explicit "this is a lower bound" with the
    // candidate count — never `total: 50, totalExact: true` for 60 matches.
    if (found.totalExact === true) {
      expect(matches).toBe(60);
    } else {
      expect(matches).toBe(50);
      expect(candidates).toBe(50);
    }
  });
});

describe('AC-02: tasks_set_deps has one vocabulary', () => {
  async function createTask(title: string, extra: Record<string, unknown> = {}) {
    const created = await call('tasks_create', { project: PROJECT, title, ...extra });
    expect(created.ok).toBe(true);
    return created.data as { id: string; status: string };
  }

  it('reports blockedByDeps and leaves an in_progress task status alone', async () => {
    const blocker = await createTask('blocker for in_progress');
    const target = await createTask('in progress target');
    expect(blocker.id).toBeTruthy();

    const updated = await call('tasks_update', { project: PROJECT, id: target.id, status: 'in_progress' });
    expect(updated.ok).toBe(true);

    const result = await call('tasks_set_deps', {
      project: PROJECT,
      id: target.id,
      dependsOn: [blocker.id],
    });
    expect(result.ok).toBe(true);
    expect(result.data.blockedByDeps).toBe(true);
    expect(result.data.statusChanged).toBe(false);
    expect(result.data.task.status).toBe('in_progress');
    expect(result.data.status).toBeUndefined();
    expect(result.data.blocked).toBeUndefined();
  });

  it('marks a todo-category task blocked and says the status changed', async () => {
    const blocker = await createTask('blocker for todo');
    const target = await createTask('todo target');

    const result = await call('tasks_set_deps', {
      project: PROJECT,
      id: target.id,
      dependsOn: [blocker.id],
    });
    expect(result.ok).toBe(true);
    expect(result.data.blockedByDeps).toBe(true);
    expect(result.data.statusChanged).toBe(true);
    expect(result.data.task.status).toBe('blocked');
    expect(JSON.stringify(result.data)).not.toContain('"status":"unblocked"');
  });

  it('honours markBlocked: false and keeps the status', async () => {
    const blocker = await createTask('blocker for opt-out');
    const target = await createTask('opt-out target');

    const result = await call('tasks_set_deps', {
      project: PROJECT,
      id: target.id,
      dependsOn: [blocker.id],
      markBlocked: false,
    });
    expect(result.ok).toBe(true);
    expect(result.data.statusChanged).toBe(false);
    expect(result.data.blockedByDeps).toBe(true);
    expect(result.data.task.status).toBe('pending');
  });
});
