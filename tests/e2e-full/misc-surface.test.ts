/**
 * tests/e2e-full/misc-surface.test.ts — Q-014 slice 20: misc tool surface e2e.
 *
 * session_info degraded shape on stdio, embeddings status/try_init,
 * tool_help, graph_export_mermaid, graph_visualize, cluster nodes/assign
 * degraded shapes, dashboard_trends, tools_run single-call form, and
 * relay share_brief/broadcast_rule when RELAY_ENABLED=1.
 */

import { describe, it, expect } from 'vitest';
import { spawnServer } from './harness.js';

describe('Q-014 slice 20: session/cluster degraded shapes on stdio', () => {
  it('session_info, cluster_nodes, cluster_assign answer without managers', async () => {
    const srv = await spawnServer('misc-degraded');
    try {
      const info = await srv.callTool('session_info', { sessionId: 'q014-sess' });
      expect(info.isError).toBe(false);
      expect(info.env.ok).toBe(true);
      expect(info.env.data.available).toBe(false);

      const nodes = await srv.callTool('cluster_nodes', {});
      expect(nodes.env.ok).toBe(true);
      expect(nodes.env.data.available).toBe(false);
      expect(nodes.env.data.nodes).toEqual([]);

      const assign = await srv.callTool('cluster_assign', { sessionId: 'q014-sess' });
      expect(assign.isError).toBe(true);
      expect(assign.env.ok).toBe(false);
    } finally {
      await srv.close();
    }
  }, 60000);
});

describe('Q-014 slice 20: embeddings + introspection helpers', () => {
  it('embeddings_status reflects none mode; try_init reports; tool_help describes', async () => {
    const srv = await spawnServer('misc-emb');
    try {
      const status = await srv.callTool('embeddings_status', {});
      expect(status.env.ok).toBe(true);
      expect(status.env.data.mode).toBe('none');

      const init = await srv.callTool('embeddings_try_init', {});
      expect(init.isError).toBe(false);
      expect(init.env.ok).toBe(true);
      expect(init.env.data.mode).toBe('none');

      const help = await srv.callTool('tool_help', { name: 'tasks_create' });
      expect(help.env.ok).toBe(true);
      expect(JSON.stringify(help.env.data)).toContain('tasks_create');

      const helpMissing = await srv.callTool('tool_help', { name: 'no_such_tool_q014' });
      expect(helpMissing.env.ok).not.toBe(true);
    } finally {
      await srv.close();
    }
  }, 60000);
});

describe('Q-014 slice 20: graph exports', () => {
  it('graph_export_mermaid renders task+doc nodes; graph_visualize needs a seed', async () => {
    const srv = await spawnServer('misc-graph');
    try {
      await srv.callTool('tasks_create', { project: 'mcp', title: 'Q014 graph task' });
      await srv.callTool('knowledge_bulk_create', {
        project: 'mcp',
        items: [{ title: 'Q014 graph doc', content: 'graph body' }],
      });

      const mmd = await srv.callTool('graph_export_mermaid', { project: 'mcp' });
      expect(mmd.env.ok).toBe(true);
      expect(mmd.env.data.mermaid).toContain('graph TD');
      expect(mmd.env.data.mermaid).toContain('Q014 graph task');
      expect(mmd.env.data.mermaid).toContain('Q014 graph doc');

      const noSeed = await srv.callTool('graph_visualize', {});
      expect(noSeed.isError).toBe(true);
      expect(noSeed.env.ok).toBe(false);

      const viz = await srv.callTool('graph_visualize', { query: 'anything', limit: 10 });
      expect(viz.isError).toBe(false);
      expect(viz.env.ok).toBe(true);
      expect(viz.env.data.html).toContain('<');

      const badNode = await srv.callTool('graph_visualize', { nodeId: 'no-such-node-q014' });
      expect(badNode.isError).toBe(true);
      expect(badNode.env.ok).toBe(false);
    } finally {
      await srv.close();
    }
  }, 60000);
});

describe('Q-014 slice 20: trends + tools_run + relay share/broadcast', () => {
  it('dashboard_trends answers; tools_run single-call; relay ops with no peers', async () => {
    const srv = await spawnServer('misc-relay', { RELAY_ENABLED: '1' });
    try {
      await srv.callTool('tasks_create', { project: 'mcp', title: 'Q014 trends task' });

      const trends = await srv.callTool('dashboard_trends', { project: 'mcp', days: 7 });
      expect(trends.isError).toBe(false);
      expect(trends.env.ok).toBe(true);

      const run = await srv.callTool('tools_run', { name: 'tasks_list', params: { project: 'mcp' } });
      expect(run.isError).toBe(false);
      expect(run.env.ok).toBe(true);
      expect(JSON.stringify(run.env.data)).toContain('Q014 trends task');

      // Relay enabled: share_brief sends to zero connected peers, still ok.
      const share = await srv.callTool('share_brief', { payload: { q014: 'brief' } });
      expect(share.isError).toBe(false);
      expect(share.env.ok).toBe(true);

      // broadcast_rule for a missing rule is a structured error.
      const bcast = await srv.callTool('broadcast_rule', { ruleId: 'no-such-rule-q014' });
      expect(bcast.isError).toBe(true);
      expect(bcast.env.ok).toBe(false);
    } finally {
      await srv.close();
    }
  }, 120000);
});
