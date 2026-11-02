/**
 * tests/e2e-full/pagination-contract.test.ts — SC-01 contract over a REAL server.
 *
 * Каждый list/search-инструмент обязан возвращать одинаковые метаданные рядом с `data`
 * (total/count/hasMore/nextCursor/truncated/limit), принимать limit/cursor/fields/countOnly,
 * не терять и не дублировать записи при обходе страниц и отдавать стабильный код
 * INVALID_CURSOR на испорченный курсор.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type E2EServer } from './harness.js';

let srv: E2EServer;
const project = 'pagination-contract';

const META_KEYS = ['total', 'count', 'hasMore', 'nextCursor', 'truncated', 'limit'];

function expectMeta(env: any, limit: number) {
  for (const key of META_KEYS) expect(env).toHaveProperty(key);
  expect(env.limit).toBe(limit);
  expect(typeof env.total).toBe('number');
  expect(typeof env.hasMore).toBe('boolean');
  expect(env.nextCursor === null || typeof env.nextCursor === 'string').toBe(true);
}

beforeAll(async () => {
  srv = await spawnServer('pagination-contract');
  for (let i = 0; i < 12; i++) {
    const res = await srv.callTool('tasks_create', {
      project,
      title: `Contract task ${i}`,
      tags: i % 3 === 0 ? ['triple'] : ['plain'],
      priority: i % 2 === 0 ? 'high' : 'low',
    });
    expect(res.isError).toBe(false);
    await new Promise((r) => setTimeout(r, 3));
  }
  for (let i = 0; i < 6; i++) {
    const res = await srv.callTool('knowledge_import_single', {
      project,
      markdown: `---\ntitle: Contract doc ${i}\ntype: ${i % 2 === 0 ? 'adr' : 'note'}\ntags:\n  - contract\n---\n\nbody ${i}\n`,
      title: `Contract doc ${i}`,
    });
    expect(res.isError).toBe(false);
    await new Promise((r) => setTimeout(r, 3));
  }
}, 60_000);

afterAll(async () => {
  await srv?.close();
});

describe('tasks_list', () => {
  it('applies the default limit and returns pagination metadata', async () => {
    const { env } = await srv.callTool('tasks_list', { project });
    expect(Array.isArray(env.data)).toBe(true);
    expect(env.data.length).toBeLessThanOrEqual(50);
    expectMeta(env, 50);
  });

  it('walks all pages exactly once with limit=5', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let guard = 0;
    do {
      const { env } = await srv.callTool('tasks_list', { project, limit: 5, ...(cursor ? { cursor } : {}) });
      expectMeta(env, 5);
      seen.push(...env.data.map((t: any) => t.id));
      cursor = env.hasMore ? env.nextCursor : undefined;
      expect(++guard).toBeLessThan(10);
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(12);
  });

  it('projects fields and honours countOnly', async () => {
    const { env } = await srv.callTool('tasks_list', { project, limit: 3, fields: ['id', 'title'] });
    expect(Object.keys(env.data[0]).sort()).toEqual(['id', 'title']);

    const counted = await srv.callTool('tasks_list', { project, countOnly: true });
    expect(counted.env.data).toHaveLength(0);
    expect(counted.env.total).toBe(12);
    expect(counted.env.hasMore).toBe(false);
  });

  it('filters on the server side (status, tag, priority)', async () => {
    const byTag = await srv.callTool('tasks_list', { project, tag: 'triple', limit: 50 });
    expect(byTag.env.total).toBe(4);
    expect(byTag.env.totalExact).toBe(true);

    const byPriority = await srv.callTool('tasks_list', { project, priority: 'high', limit: 50 });
    expect(byPriority.env.total).toBe(6);
  });

  it('returns an empty page with zeroed metadata when nothing matches', async () => {
    const { env } = await srv.callTool('tasks_list', { project, tag: 'definitely-no-such-tag', limit: 5 });
    expect(env.data).toEqual([]);
    expect(env.total).toBe(0);
    expect(env.totalExact).toBe(true);
    expect(env.count).toBe(0);
    expect(env.hasMore).toBe(false);
    expect(env.nextCursor).toBeNull();
    expect(env.truncated).toBe(false);
  });

  it('rejects an invalid cursor with a stable code', async () => {
    const res = await srv.callTool('tasks_list', { project, cursor: 'garbage' });
    expect(res.isError).toBe(true);
    expect(res.env.ok).toBe(false);
    expect(res.env.error.code).toBe('INVALID_CURSOR');
  });

  it('caps the payload with maxBytes', async () => {
    const { env } = await srv.callTool('tasks_list', { project, limit: 50, maxBytes: 700 });
    expect(env.truncated).toBe(true);
    expect(env.data.length).toBeLessThan(12);
    expect(env.hasMore).toBe(true);
    expect(env.nextCursor).toBeTruthy();
    expect(Buffer.byteLength(JSON.stringify(env.data))).toBeLessThanOrEqual(700);
  });
});

describe('tasks_tree / tasks_get_children', () => {
  it('paginates tree roots and keeps children with their root', async () => {
    const parent = await srv.callTool('tasks_create', { project, title: 'Parent' });
    const parentId = parent.env.data.id;
    await srv.callTool('tasks_create', { project, title: 'Child', parentId });

    const tree = await srv.callTool('tasks_tree', { project, limit: 3 });
    expectMeta(tree.env, 3);
    expect(tree.env.data.length).toBeLessThanOrEqual(3);

    const children = await srv.callTool('tasks_get_children', { project, id: parentId, limit: 10 });
    expectMeta(children.env, 10);
    expect(children.env.data.children).toHaveLength(1);
  });
});

describe('knowledge_list / knowledge_tree', () => {
  it('paginates docs and filters by type', async () => {
    const first = await srv.callTool('knowledge_list', { project, limit: 4 });
    expectMeta(first.env, 4);
    expect(first.env.data.length).toBe(4);
    expect(first.env.hasMore).toBe(true);

    const second = await srv.callTool('knowledge_list', { project, limit: 4, cursor: first.env.nextCursor });
    const firstIds = new Set(first.env.data.map((d: any) => d.id));
    for (const doc of second.env.data) expect(firstIds.has(doc.id)).toBe(false);

    const adr = await srv.callTool('knowledge_list', { project, type: 'adr', limit: 50 });
    expect(adr.env.total).toBe(3);

    const tree = await srv.callTool('knowledge_tree', { project, limit: 2 });
    expectMeta(tree.env, 2);
    expect(tree.env.data.length).toBeLessThanOrEqual(2);
  });
});

describe('search_tasks / search_knowledge', () => {
  it('paginates ranked results with a query-scoped cursor', async () => {
    const first = await srv.callTool('search_tasks', { project, query: 'contract task', limit: 3 });
    expectMeta(first.env, 3);
    expect(Array.isArray(first.env.data)).toBe(true);

    if (first.env.hasMore) {
      const second = await srv.callTool('search_tasks', {
        project,
        query: 'contract task',
        limit: 3,
        cursor: first.env.nextCursor,
      });
      const firstIds = new Set(first.env.data.map((r: any) => r.id));
      for (const row of second.env.data) expect(firstIds.has(row.id)).toBe(false);

      // A cursor from one query must not be accepted by another query.
      const foreign = await srv.callTool('search_tasks', {
        project,
        query: 'completely different words',
        limit: 3,
        cursor: first.env.nextCursor,
      });
      expect(foreign.isError).toBe(true);
      expect(foreign.env.error.code).toBe('INVALID_CURSOR');
    }
  });

  it('paginates knowledge search and keeps the snippet behaviour', async () => {
    const res = await srv.callTool('search_knowledge', { project, query: 'contract doc', limit: 2 });
    expectMeta(res.env, 2);
    for (const row of res.env.data) {
      expect(row.item.content).toBeUndefined();
      expect(typeof row.item.snippet).toBe('string');
    }
  });
});

describe('prompts_list / memory_facts_list', () => {
  it('returns pagination metadata while keeping the legacy data shape', async () => {
    const prompts = await srv.callTool('prompts_list', { limit: 2 });
    expectMeta(prompts.env, 2);
    expect(Array.isArray(prompts.env.data.items)).toBe(true);

    const facts = await srv.callTool('memory_facts_list', { project, limit: 2 });
    expectMeta(facts.env, 2);
    expect(Array.isArray(facts.env.data.facts)).toBe(true);
    expect(typeof facts.env.data.count).toBe('number');
  });
});
