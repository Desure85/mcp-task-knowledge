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
    const first = await call('tools_list', { limit: 200 });
    expect(first.ok).toBe(true);
    // `tools_list` wraps the registry page: data.items + data.pagination.
    const total = first.data.pagination.total as number;
    expect(total).toBeGreaterThanOrEqual(128);
    expect(first.data.data.length).toBe(Math.min(total, 200));
    const seen = new Set(first.data.data.map((t: { name: string }) => t.name));
    if (total > 200) {
      const second = await call('tools_list', { limit: 200, offset: 200 });
      expect(second.ok).toBe(true);
      expect(second.data.data.length).toBe(total - 200);
      for (const t of second.data.data as Array<{ name: string }>) seen.add(t.name);
      expect(second.data.pagination.hasMore).toBe(false);
    } else {
      expect(first.data.pagination.hasMore).toBe(false);
    }
    expect(seen.size).toBe(total);
  });
});

describe('AC-03b: tasks_dag filters, truncation and cursor', () => {
  // 240 tasks: 60 of them form a dependency chain and carry the `perf` tag, 180 are plain.
  const DAG_PROJECT = `${PROJECT}-dag`;
  const chain: string[] = [];
  const tagged: string[] = [];

  beforeAll(async () => {
    const taggedItems = Array.from({ length: 60 }, (_, index) => ({ title: `perf node ${index}`, tags: ['perf'] }));
    const first = await call('tasks_bulk_create', { project: DAG_PROJECT, items: taggedItems });
    expect(first.ok).toBe(true);
    tagged.push(...first.data.created.map((task: any) => task.id as string));

    for (const size of [100, 80]) {
      const plain = Array.from({ length: size }, (_, index) => ({ title: `plain node ${size}-${index}` }));
      const created = await call('tasks_bulk_create', { project: DAG_PROJECT, items: plain });
      expect(created.ok).toBe(true);
    }

    // Chain only through the tagged nodes, so the tag filter produces a self-contained graph.
    for (let index = 1; index < tagged.length; index++) {
      const deps = await call('tasks_set_deps', {
        project: DAG_PROJECT,
        id: tagged[index],
        dependsOn: [tagged[index - 1]],
        markBlocked: false,
      });
      expect(deps.ok).toBe(true);
      chain.push(tagged[index]);
    }
  }, 120_000);

  it('pages the topological order and keeps edges inside the page', async () => {
    const dag = await call('tasks_dag', { project: DAG_PROJECT, limit: 50 });
    expect(dag.ok).toBe(true);
    expect(dag.data.totalTasks).toBe(240);
    expect(dag.data.returnedNodes).toBe(50);
    expect(dag.data.tagged).toBeUndefined();
    expect(dag.data.truncated).toBe(true);
    expect(typeof dag.data.nextCursor).toBe('string');

    const pageIds = new Set(dag.data.topologicalOrder.map((node: any) => node.id));
    expect(pageIds.size).toBe(50);
    for (const edge of dag.data.edges as Array<{ from: string; to: string }>) {
      expect(pageIds.has(edge.from)).toBe(true);
      expect(pageIds.has(edge.to)).toBe(true);
    }
    for (const node of dag.data.criticalPath as Array<{ id: string }>) {
      expect(pageIds.has(node.id)).toBe(true);
    }
  });

  it('follows the cursor to the next page without overlaps', async () => {
    const first = await call('tasks_dag', { project: DAG_PROJECT, limit: 50 });
    const second = await call('tasks_dag', { project: DAG_PROJECT, limit: 50, cursor: first.data.nextCursor });
    expect(second.ok).toBe(true);
    const firstIds = new Set(first.data.topologicalOrder.map((node: any) => node.id));
    for (const node of second.data.topologicalOrder as Array<{ id: string }>) {
      expect(firstIds.has(node.id)).toBe(false);
    }
    expect(second.data.returnedNodes).toBe(50);
  });

  it('filters by tag and by dependency participation', async () => {
    const tagged = await call('tasks_dag', { project: DAG_PROJECT, tag: 'perf' });
    expect(tagged.data.totalTasks).toBe(60);
    expect(tagged.data.returnedNodes).toBe(60);
    // 59 chain edges, all inside the filtered set.
    expect(tagged.data.edges).toHaveLength(59);
    expect(tagged.data.truncated).toBe(false);

    const withDeps = await call('tasks_dag', { project: DAG_PROJECT, onlyWithDeps: true });
    expect(withDeps.data.totalTasks).toBe(60);
    // The chain root has no dependencies of its own, so only 59 nodes carry dependsOn.\r\n    expect(withDeps.data.tasksWithDeps).toBe(59);
  });

  it('keeps the filtered response under 8 KB with maxBytes', async () => {
    const res = await client.callTool({
      name: 'tasks_dag',
      arguments: { project: DAG_PROJECT, tag: 'perf', maxBytes: 8192 },
    });
    const text = ((res?.content as any)?.[0]?.text as string) ?? '';
    const dag = JSON.parse(text);
    expect(dag.ok).toBe(true);
    expect(dag.data.truncated).toBe(true);
    expect(typeof dag.data.nextCursor).toBe('string');
    // Measured on the payload a client actually receives (pretty-printed text).
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(8192);
  });

  it('returns the whole filtered graph when no byte budget is requested', async () => {
    const dag = await call('tasks_dag', { project: DAG_PROJECT, tag: 'perf' });
    expect(dag.data.returnedNodes).toBe(60);
    expect(dag.data.nextCursor).toBeNull();
  });

  it('projects node fields', async () => {
    const dag = await call('tasks_dag', { project: DAG_PROJECT, tag: 'perf', limit: 5, fields: ['id'] });
    expect(dag.data.topologicalOrder).toHaveLength(5);
    for (const node of dag.data.topologicalOrder as Array<Record<string, unknown>>) {
      expect(Object.keys(node)).toEqual(['id']);
    }
  });
});

describe('AC-03c: fields and compact on write tools', () => {
  it('tasks_create with fields: ["id"] fits in 120 bytes', async () => {
    const res = await client.callTool({
      name: 'tasks_create',
      arguments: { project: PROJECT, title: 'projection task', fields: ['id'] },
    });
    const text = ((res?.content as any)?.[0]?.text as string) ?? '';
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(120);
    const env = JSON.parse(text);
    expect(env.ok).toBe(true);
    expect(Object.keys(env.data)).toEqual(['id']);
    expect(typeof env.data.id).toBe('string');
  });

  it('compact: true returns the minimal task record', async () => {
    const created = await call('tasks_create', {
      project: PROJECT,
      title: 'compact task',
      description: 'long description that must not be returned',
      compact: true,
    });
    expect(created.ok).toBe(true);
    expect(Object.keys(created.data)).toEqual(['id', 'title', 'status', 'priority', 'updatedAt']);
  });

  it('keeps the full record when no projection is requested', async () => {
    const created = await call('tasks_create', {
      project: PROJECT,
      title: 'full task',
      description: 'kept',
    });
    expect(created.ok).toBe(true);
    expect(created.data.description).toBe('kept');
    expect(typeof created.data.createdAt).toBe('string');
    expect(created.data.tags).toEqual([]);
  });

  it('projects tasks_update and tasks_set_deps responses', async () => {
    const created = await call('tasks_create', { project: PROJECT, title: 'projected update' });
    const updated = await call('tasks_update', {
      project: PROJECT,
      id: created.data.id,
      title: 'projected update v2',
      fields: ['id', 'title'],
    });
    expect(Object.keys(updated.data)).toEqual(['id', 'title']);

    const blocker = await call('tasks_create', { project: PROJECT, title: 'projection blocker' });
    const deps = await call('tasks_set_deps', {
      project: PROJECT,
      id: created.data.id,
      dependsOn: [blocker.data.id],
      markBlocked: false,
      compact: true,
    });
    expect(deps.ok).toBe(true);
    expect(Object.keys(deps.data.task)).toEqual(['id', 'title', 'status', 'priority', 'updatedAt']);
  });

  it('projects knowledge_bulk_create results', async () => {
    const created = await call('knowledge_bulk_create', {
      project: PROJECT,
      items: [{ title: 'projected doc', content: 'body' }],
      fields: ['id'],
    });
    expect(created.ok).toBe(true);
    expect(Object.keys(created.data.created[0])).toEqual(['id']);
  });
});
