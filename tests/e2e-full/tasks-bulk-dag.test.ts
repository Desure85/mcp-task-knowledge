/**
 * tests/e2e-full/tasks-bulk-dag.test.ts — Q-014 slice 16:
 * tasks bulk lifecycle + dependency DAG e2e.
 *
 * bulk_update/archive/trash/restore/delete_permanent through a real server,
 * plus tasks_set_deps → tasks_get_deps → tasks_dag edge + blockedCount.
 */

import { describe, it, expect } from 'vitest';
import { spawnServer } from './harness.js';

describe('Q-014 slice 16: tasks bulk lifecycle', () => {
  it('bulk_update → archive → trash → restore → delete_permanent', async () => {
    const srv = await spawnServer('tasks-bulk-life');
    try {
      const bulk = await srv.callTool('tasks_bulk_create', {
        project: 'mcp',
        items: [{ title: 'Q014 bulk-life A' }, { title: 'Q014 bulk-life B' }],
      });
      expect(bulk.env.ok).toBe(true);
      const ids = (bulk.env.data.created ?? bulk.env.data ?? []).map(
        (t: unknown) => (t as { id?: string }).id ?? t,
      );
      expect(ids.length).toBe(2);

      const upd = await srv.callTool('tasks_bulk_update', {
        project: 'mcp',
        items: [{ id: ids[0], title: 'Q014 bulk-life A renamed', priority: 'high' }],
      });
      expect(upd.isError).toBe(false);
      expect(upd.env.ok).toBe(true);
      const renamed = await srv.callTool('tasks_get', { project: 'mcp', id: ids[0] });
      expect(renamed.env.data.title).toBe('Q014 bulk-life A renamed');
      expect(renamed.env.data.priority).toBe('high');

      const archived = await srv.callTool('tasks_bulk_archive', { project: 'mcp', ids: [ids[0]] });
      expect(archived.env.ok).toBe(true);
      const visible = await srv.callTool('tasks_list', { project: 'mcp' });
      expect(JSON.stringify(visible.env.data)).not.toContain('Q014 bulk-life A renamed');
      const withArchived = await srv.callTool('tasks_list', { project: 'mcp', includeArchived: true });
      expect(JSON.stringify(withArchived.env.data)).toContain('Q014 bulk-life A renamed');

      const trashed = await srv.callTool('tasks_bulk_trash', { project: 'mcp', ids: [ids[1]] });
      expect(trashed.env.ok).toBe(true);
      const afterTrash = await srv.callTool('tasks_list', { project: 'mcp', includeArchived: true });
      expect(JSON.stringify(afterTrash.env.data)).not.toContain('Q014 bulk-life B');

      const restored = await srv.callTool('tasks_bulk_restore', { project: 'mcp', ids: [ids[1]] });
      expect(restored.env.ok).toBe(true);
      const afterRestore = await srv.callTool('tasks_list', { project: 'mcp' });
      expect(JSON.stringify(afterRestore.env.data)).toContain('Q014 bulk-life B');

      // Permanent delete: dryRun reports, confirm deletes.
      const dry = await srv.callTool('tasks_bulk_delete_permanent', { project: 'mcp', ids: [ids[0]], dryRun: true });
      expect(dry.env.ok).toBe(true);
      const gone = await srv.callTool('tasks_bulk_delete_permanent', { project: 'mcp', ids: [ids[0]], confirm: true });
      expect(gone.env.ok).toBe(true);
      const getDeleted = await srv.callTool('tasks_get', { project: 'mcp', id: ids[0] });
      expect(getDeleted.env.ok).not.toBe(true);
    } finally {
      await srv.close();
    }
  }, 120000);
});

describe('Q-014 slice 16: tasks dependency DAG', () => {
  it('set_deps → get_deps → dag reports edge and blockedCount', async () => {
    const srv = await spawnServer('tasks-dag');
    try {
      const a = await srv.callTool('tasks_create', { project: 'mcp', title: 'Q014 dag blocker' });
      const b = await srv.callTool('tasks_create', { project: 'mcp', title: 'Q014 dag blocked' });
      const idA = a.env.data.id as string;
      const idB = b.env.data.id as string;

      const setDeps = await srv.callTool('tasks_set_deps', { project: 'mcp', id: idB, dependsOn: [idA] });
      expect(setDeps.isError).toBe(false);
      expect(setDeps.env.ok).toBe(true);

      const deps = await srv.callTool('tasks_get_deps', { project: 'mcp', id: idB });
      expect(deps.env.ok).toBe(true);
      expect(JSON.stringify(deps.env.data)).toContain(idA);

      const dag = await srv.callTool('tasks_dag', { project: 'mcp' });
      expect(dag.env.ok).toBe(true);
      expect(dag.env.data.totalTasks).toBe(2);
      expect(dag.env.data.tasksWithDeps).toBe(1);
      expect(dag.env.data.blockedCount).toBe(1);
      const edges = JSON.stringify(dag.env.data.edges);
      expect(edges).toContain(idA);
      expect(edges).toContain(idB);

      // Closing the blocker unblocks the dependent.
      await srv.callTool('tasks_close', { project: 'mcp', id: idA });
      const dagAfter = await srv.callTool('tasks_dag', { project: 'mcp' });
      expect(dagAfter.env.data.blockedCount).toBe(0);
    } finally {
      await srv.close();
    }
  }, 120000);
});
