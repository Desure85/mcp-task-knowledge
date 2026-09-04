/**
 * tests/e2e-full/server-lifecycle.test.ts — Q-014 slice 1: server lifecycle.
 *
 * - tools/list exposes the registry over a real transport
 * - unknown tool fails with a clean error envelope (no crash)
 * - two servers are isolated (no shared state via tmp DATA_DIR)
 */

import { describe, it, expect } from 'vitest';
import { spawnServer } from './harness.js';

describe('Q-014 slice 1: server lifecycle (hermetic stdio)', () => {
  it('tools/list exposes registered tools', async () => {
    const srv = await spawnServer('lifecycle-list');
    try {
      const res = await srv.client.listTools();
      const names = res.tools.map((t) => t.name);
      expect(names).toContain('tasks_create');
      expect(names).toContain('knowledge_list');
      expect(names).toContain('knowledge_bulk_create');
      expect(names).toContain('memory_extract');
      expect(names.length).toBeGreaterThan(90);
    } finally {
      await srv.close();
    }
  }, 60000);

  it('unknown tool rejects with -32602, server stays alive', async () => {
    const srv = await spawnServer('lifecycle-error');
    try {
      const err = await srv.callTool('no_such_tool_xyz', {}).then(
        () => null,
        (e) => e,
      );
      expect(err).not.toBeNull();
      expect(String(err)).toContain('32602');
      const ok = await srv.callTool('tasks_list', { project: 'mcp' });
      expect(ok.isError).toBe(false);
      expect(ok.env.ok).toBe(true);
    } finally {
      await srv.close();
    }
  }, 60000);

  it('two servers do not share task state', async () => {
    const a = await spawnServer('lifecycle-iso-a');
    const b = await spawnServer('lifecycle-iso-b');
    try {
      await a.callTool('tasks_create', { project: 'mcp', title: 'only in A' });
      const listB = await b.callTool('tasks_list', { project: 'mcp' });
      expect(listB.isError).toBe(false);
      const titles = (listB.env.data?.tasks ?? listB.env.data ?? []).map((t: any) => t.title ?? t);
      expect(titles).not.toContain('only in A');
    } finally {
      await a.close();
      await b.close();
    }
  }, 120000);
});
