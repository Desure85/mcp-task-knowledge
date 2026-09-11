/**
 * tests/e2e-full/projects.test.ts — Q-014 slice 15: project lifecycle e2e.
 *
 * project_create → list/info/update → set_current → tasks land in current
 * project → purge (dryRun then confirm) → delete (force gate + real) —
 * all through a real hermetic server.
 */

import { describe, it, expect } from 'vitest';
import { spawnServer } from './harness.js';

describe('Q-014 slice 15: project lifecycle', () => {
  it('create → list → info → update → set_current → purge → delete', async () => {
    const srv = await spawnServer('projects');
    const proj = `q014p${Date.now().toString(36)}`;
    try {
      const created = await srv.callTool('project_create', { id: proj, description: 'q014 e2e project' });
      expect(created.isError).toBe(false);
      expect(created.env.ok).toBe(true);
      expect(created.env.data.project).toBe(proj);

      const listed = await srv.callTool('project_list', {});
      expect(listed.env.ok).toBe(true);
      expect(JSON.stringify(listed.env.data)).toContain(proj);

      const info = await srv.callTool('project_info', { project: proj });
      expect(info.env.ok).toBe(true);

      const upd = await srv.callTool('project_update', { project: proj, description: 'q014 updated' });
      expect(upd.env.ok).toBe(true);

      const setCur = await srv.callTool('project_set_current', { project: proj });
      expect(setCur.env.ok).toBe(true);
      expect(setCur.env.data.scope).toBe('global');
      const cur = await srv.callTool('project_get_current', {});
      expect(cur.env.ok).toBe(true);
      expect(cur.env.data.project).toBe(proj);
      expect(cur.env.data.scope).toBe('global');

      // PH-004: schema defaults removed — omitting `project` now resolves to
      // the current project (here: proj, set above via project_set_current).
      const t = await srv.callTool('tasks_create', { title: 'Q014 proj task' });
      expect(t.env.ok).toBe(true);
      const inProj = await srv.callTool('tasks_list', { project: proj });
      expect(JSON.stringify(inProj.env.data)).toContain('Q014 proj task');
      // tasks_list without project resolves to current too — same view.
      const inCurrent = await srv.callTool('tasks_list', {});
      expect(JSON.stringify(inCurrent.env.data)).toContain('Q014 proj task');
      // ...and the task does NOT leak into the default project.
      const inDefault = await srv.callTool('tasks_list', { project: 'mcp' });
      expect(JSON.stringify(inDefault.env.data)).not.toContain('Q014 proj task');

      // Purge dryRun enumerates but deletes nothing.
      const dry = await srv.callTool('project_purge', { project: proj, dryRun: true });
      expect(dry.isError).toBe(false);
      expect(dry.env.ok).toBe(true);
      const stillThere = await srv.callTool('tasks_list', { project: proj });
      expect(JSON.stringify(stillThere.env.data)).toContain('Q014 proj task');

      // PH-005: purge without confirm is refused via error envelope —
      // { ok:false } + isError, not a raw MCP protocol error.
      const refused = await srv.callTool('project_purge', { project: proj });
      expect(refused.isError).toBe(true);
      expect(refused.env.ok).toBe(false);
      expect(refused.env.error?.message ?? '').toContain('not confirmed');
      const afterRefused = await srv.callTool('tasks_list', { project: proj });
      expect(JSON.stringify(afterRefused.env.data)).toContain('Q014 proj task');

      // Real purge empties the project but keeps it.
      const purge = await srv.callTool('project_purge', { project: proj, confirm: true });
      expect(purge.isError).toBe(false);
      expect(purge.env.ok).toBe(true);
      const afterPurge = await srv.callTool('tasks_list', { project: proj });
      expect(JSON.stringify(afterPurge.env.data)).not.toContain('Q014 proj task');

      // Now-empty project deletes without force.
      const del = await srv.callTool('project_delete', { project: proj });
      expect(del.env.ok).toBe(true);

      const listAfter = await srv.callTool('project_list', {});
      expect(JSON.stringify(listAfter.env.data)).not.toContain(`"${proj}"`);
    } finally {
      await srv.close();
    }
  }, 120000);

  it('delete with data requires force; current project switches to default', async () => {
    const srv = await spawnServer('projects-force');
    const proj = `q014f${Date.now().toString(36)}`;
    try {
      await srv.callTool('project_create', { id: proj });
      await srv.callTool('tasks_create', { project: proj, title: 'Q014 keep me' });
      await srv.callTool('project_set_current', { project: proj });

      const noForce = await srv.callTool('project_delete', { project: proj });
      expect(noForce.isError).toBe(true);
      expect(noForce.env.ok).toBe(false);

      const force = await srv.callTool('project_delete', { project: proj, force: true });
      expect(force.env.ok).toBe(true);
      // Deleted project was current → server switched back to default.
      const cur = await srv.callTool('project_get_current', {});
      expect(cur.env.data.project).not.toBe(proj);
    } finally {
      await srv.close();
    }
  }, 120000);

  it('validation: malformed id rejected; delete is idempotent on missing project', async () => {
    const srv = await spawnServer('projects-err');
    try {
      const bad = await srv.callTool('project_create', { id: 'BAD ID!' });
      expect(bad.isError).toBe(true);
      expect(bad.env.ok).toBe(false);

      // fs.rm(force) makes delete idempotent — a missing project is ok:true.
      const del = await srv.callTool('project_delete', { project: 'no-such-q014' });
      expect(del.isError).toBe(false);
      expect(del.env.ok).toBe(true);

      // ...but the default project can never be deleted.
      const delDefault = await srv.callTool('project_delete', { project: 'mcp', force: true });
      expect(delDefault.isError).toBe(true);
      expect(delDefault.env.ok).toBe(false);
    } finally {
      await srv.close();
    }
  }, 60000);
});
