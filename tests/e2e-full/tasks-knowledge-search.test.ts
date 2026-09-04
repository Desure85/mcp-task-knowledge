/**
 * tests/e2e-full/tasks-knowledge-search.test.ts — Q-014 slice 2: core lifecycles.
 *
 * Tasks CRUD (create → get → update → close), knowledge bulk-create → list/get,
 * and search roundtrip (indexed doc found by a rare term) — all through a real
 * hermetic server. Complements Q-004 (which covers projects/bulk/errors).
 */

import { describe, it, expect } from 'vitest';
import { spawnServer } from './harness.js';

describe('Q-014 slice 2: tasks lifecycle', () => {
  it('create → get → update → close → get reflects closed state', async () => {
    const srv = await spawnServer('crud-tasks');
    try {
      const created = await srv.callTool('tasks_create', {
        project: 'mcp',
        title: 'Q014 slice2 task',
        priority: 'high',
        tags: ['q014'],
      });
      expect(created.isError).toBe(false);
      expect(created.env.ok).toBe(true);
      const id = created.env.data.id as string;
      expect(typeof id).toBe('string');

      const got = await srv.callTool('tasks_get', { project: 'mcp', id });
      expect(got.env.ok).toBe(true);
      expect(got.env.data.title).toBe('Q014 slice2 task');

      const updated = await srv.callTool('tasks_update', { project: 'mcp', id, priority: 'low' });
      expect(updated.env.ok).toBe(true);
      expect(updated.env.data.priority).toBe('low');

      const closed = await srv.callTool('tasks_close', { project: 'mcp', id });
      expect(closed.env.ok).toBe(true);

      const after = await srv.callTool('tasks_get', { project: 'mcp', id });
      expect(after.env.ok).toBe(true);
      expect(after.env.data.status).toBe('closed');
    } finally {
      await srv.close();
    }
  }, 60000);
});

describe('Q-014 slice 2: knowledge + search roundtrip', () => {
  it('bulk-create → list → get → search finds the doc by rare term', async () => {
    const srv = await spawnServer('crud-knowledge');
    try {
      const rare = `quokkae2e${Date.now().toString(36)}`;
      const bulk = await srv.callTool('knowledge_bulk_create', {
        project: 'mcp',
        items: [{ title: 'Q014 search doc', content: `Doc about ${rare} marsupials and indexing.`, tags: ['q014'] }],
      });
      expect(bulk.isError).toBe(false);
      expect(bulk.env.ok).toBe(true);
      const docId = bulk.env.data.created[0].id as string;

      const listed = await srv.callTool('knowledge_list', { project: 'mcp', tag: 'q014' });
      expect(listed.env.ok).toBe(true);
      const listedItems = Array.isArray(listed.env.data) ? listed.env.data : listed.env.data?.items ?? [];
      expect(listedItems.length).toBeGreaterThanOrEqual(1);

      const got = await srv.callTool('knowledge_get', { project: 'mcp', id: docId });
      expect(got.env.ok).toBe(true);
      expect(got.env.data.title).toBe('Q014 search doc');

      const found = await srv.callTool('search_knowledge', { query: rare, project: 'mcp' });
      expect(found.isError).toBe(false);
      const results = found.env.data?.results ?? found.env.data ?? [];
      expect(JSON.stringify(results)).toContain('Q014 search doc');

      const foundTasks = await srv.callTool('search_tasks', { query: 'Q014 slice2 nonexistent-xyz', project: 'mcp' });
      expect(foundTasks.isError).toBe(false);
    } finally {
      await srv.close();
    }
  }, 120000);
});
