/**
 * tests/e2e-full/tools-meta.test.ts — Q-014 slice 13: meta-tools e2e.
 *
 * tools_list contents, tool_schema shape, tools_batch parallel fan-out,
 * tools_register echo → tools_run → tools_unregister lifecycle.
 */

import { describe, it, expect } from 'vitest';
import { spawnServer } from './harness.js';

describe('Q-014 slice 13: introspection (list + schema)', () => {
  it('tools_list enumerates registry; tool_schema describes tasks_create', async () => {
    const srv = await spawnServer('tools-meta');
    try {
      const list = await srv.callTool('tools_list', { search: 'tasks_create' });
      expect(list.env.ok).toBe(true);
      const names = JSON.stringify(list.env.data);
      expect(names).toContain('tasks_create');
      expect(names).toContain('dependsOn');

      const schema = await srv.callTool('tool_schema', { name: 'tasks_create' });
      expect(schema.env.ok).toBe(true);
      expect(JSON.stringify(schema.env.data)).toContain('title');
    } finally {
      await srv.close();
    }
  }, 60000);
});

describe('Q-014 slice 13: parallel batch fan-out', () => {
  it('tools_batch runs independent reads together', async () => {
    const srv = await spawnServer('tools-batch');
    try {
      await srv.callTool('tasks_create', { project: 'mcp', title: 'Q014 batch task' });
      const batch = await srv.callTool('tools_batch', {
        items: [
          { name: 'tasks_list', params: { project: 'mcp' } },
          { name: 'knowledge_list', params: { project: 'mcp' } },
          { name: 'dashboard_stats', params: { project: 'mcp' } },
        ],
      });
      expect(batch.isError).toBe(false);
      expect(batch.env.ok).toBe(true);
      expect(JSON.stringify(batch.env.data)).toContain('Q014 batch task');
    } finally {
      await srv.close();
    }
  }, 60000);
});

describe('Q-014 slice 13: hot registration lifecycle', () => {
  it('register echo → run → unregister', async () => {
    const srv = await spawnServer('tools-hotreg');
    try {
      const toolName = `q014_echo_${Date.now().toString(36)}`.replace(/[^a-z0-9_]/g, '_');
      const reg = await srv.callTool('tools_register', {
        name: toolName,
        title: 'Q014 echo',
        handlerKind: 'echo',
      });
      expect(reg.isError).toBe(false);
      expect(reg.env.ok).toBe(true);

      const run = await srv.callTool('tools_run', {
        name: toolName,
        params: { hello: 'world' },
      });
      expect(run.isError).toBe(false);

      const unreg = await srv.callTool('tools_unregister', { name: toolName });
      expect(unreg.isError).toBe(false);
      expect(unreg.env.ok).toBe(true);
    } finally {
      await srv.close();
    }
  }, 60000);
});
