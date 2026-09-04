/**
 * tests/e2e-full/dashboard-session-cluster.test.ts — Q-014 slice 6:
 * dashboard + session + cluster + catalog surface e2e.
 *
 * Dashboard stats/activity reflect created tasks; session/cluster tools on
 * stdio return availability-only shapes (no managers in single-node mode);
 * service catalog upsert → query → delete roundtrip.
 */

import { describe, it, expect } from 'vitest';
import { spawnServer } from './harness.js';

describe('Q-014 slice 6: dashboard reflects task activity', () => {
  it('stats + activity + project_summary see a created task', async () => {
    const srv = await spawnServer('dash-activity');
    try {
      await srv.callTool('tasks_create', { project: 'mcp', title: 'Q014 dashboard task' });

      const stats = await srv.callTool('dashboard_stats', { project: 'mcp' });
      expect(stats.isError).toBe(false);
      expect(stats.env.ok).toBe(true);
      expect(stats.env.data.tasks.total).toBe(1);
      expect(stats.env.data.tasks.byStatus.pending).toBe(1);

      const activity = await srv.callTool('dashboard_activity', { project: 'mcp' });
      expect(activity.env.ok).toBe(true);
      expect(JSON.stringify(activity.env.data)).toContain('Q014 dashboard task');

      const summary = await srv.callTool('dashboard_project_summary', {});
      expect(summary.env.ok).toBe(true);
      expect(JSON.stringify(summary.env.data)).toContain('mcp');
    } finally {
      await srv.close();
    }
  }, 120000);
});

describe('Q-014 slice 6: session/cluster availability shapes on stdio', () => {
  it('session_list and cluster_status answer without managers', async () => {
    const srv = await spawnServer('sess-cluster');
    try {
      const sessions = await srv.callTool('session_list', {});
      expect(sessions.isError).toBe(false);
      expect(sessions.env.ok).toBe(true);

      const cluster = await srv.callTool('cluster_status', {});
      expect(cluster.isError).toBe(false);
      expect(cluster.env.ok).toBe(true);
    } finally {
      await srv.close();
    }
  }, 60000);
});

describe('Q-014 slice 6: service catalog roundtrip', () => {
  it('upsert → query → delete', async () => {
    const srv = await spawnServer('catalog', { CATALOG_ENABLED: 'true', CATALOG_WRITE_ENABLED: 'true' });
    try {
      const name = `q014-svc-${Date.now().toString(36)}`;
      const up = await srv.callTool('service_catalog_upsert', {
        items: [{ id: name, name, component: 'q014' }],
      });
      expect(up.isError).toBe(false);
      expect(up.env.ok).toBe(true);

      const q = await srv.callTool('service_catalog_query', { search: name });
      expect(q.env.ok).toBe(true);
      expect(JSON.stringify(q.env.data)).toContain(name);

      const del = await srv.callTool('service_catalog_delete', { ids: [name] });
      expect(del.isError).toBe(false);

      const health = await srv.callTool('service_catalog_health', {});
      expect(health.env.ok).toBe(true);
    } finally {
      await srv.close();
    }
  }, 120000);
});
