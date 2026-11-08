/**
 * AC-03 (part a) — response economy: honest `meta.ms`, batch lookup by id/code, and a
 * `tools_list` limit that can cover the whole surface.
 *
 * The remaining AC-03 parts (`tasks_dag` filters and `fields`/`compact` on write tools) land
 * in AC-03b/AC-03c and extend this file.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServerContext } from '../src/register/setup.js';
import { defaultRegistration } from '../src/core/app-container.js';
import type { ServerContext } from '../src/register/context.js';

const PROJECT = `ac03a-${Date.now().toString(36)}`;

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
  client = new Client({ name: 'ac03a', version: '0.0.0' });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client?.close();
});

describe('AC-03a: meta.ms on every envelope', () => {
  it('reports a non-negative duration on success', async () => {
    const created = await call('tasks_create', { project: PROJECT, title: 'meta success' });
    expect(created.ok).toBe(true);
    expect(typeof created.meta?.ms).toBe('number');
    expect(created.meta.ms).toBeGreaterThanOrEqual(0);
  });

  it('reports a non-negative duration on error', async () => {
    const missing = await call('tasks_get', { project: PROJECT, id: '00000000-0000-0000-0000-000000000000' });
    expect(missing.ok).toBe(false);
    expect(typeof missing.meta?.ms).toBe('number');
    expect(missing.meta.ms).toBeGreaterThanOrEqual(0);
  });
});

describe('AC-03a: tasks_list batch lookup', () => {
  it('returns exactly the requested ids', async () => {
    const first = await call('tasks_create', { project: PROJECT, title: 'lookup one' });
    const second = await call('tasks_create', { project: PROJECT, title: 'lookup two' });
    await call('tasks_create', { project: PROJECT, title: 'lookup three' });

    const listed = await call('tasks_list', {
      project: PROJECT,
      ids: [first.data.id, second.data.id],
    });
    expect(listed.ok).toBe(true);
    expect(listed.total).toBe(2);
    expect(listed.totalExact).toBe(true);
    expect(listed.data.map((task: any) => task.id).sort()).toEqual([first.data.id, second.data.id].sort());
  });

  it('finds tasks by backlog code recorded as a tag', async () => {
    const created = await call('tasks_create', {
      project: PROJECT,
      title: 'tagged by code',
      tags: ['AC-01', 'backlog-sync'],
    });
    expect(created.ok).toBe(true);

    const found = await call('tasks_list', { project: PROJECT, codes: ['ac-01'] });
    expect(found.ok).toBe(true);
    expect(found.data.map((task: any) => task.id)).toContain(created.data.id);
    // Case-insensitive match, and an unknown code matches nothing.
    const none = await call('tasks_list', { project: PROJECT, codes: ['ZZ-99'] });
    expect(none.data).toEqual([]);
  });
});

describe('AC-03a: tools_list can page the whole surface', () => {
  it('accepts limit 200 and returns every registered tool', async () => {
    const listed = await call('tools_list', { limit: 200 });
    expect(listed.ok).toBe(true);
    // `tools_list` wraps the registry page: data.items + data.pagination.
    const total = listed.data.pagination.total as number;
    expect(total).toBeGreaterThanOrEqual(128);
    expect(listed.data.data.length).toBe(total);
    expect(listed.data.pagination.hasMore).toBe(false);
  });
});
