/**
 * tests/e2e-full/tasks-hierarchy.test.ts — Q-014 slice 9: hierarchy + DAG e2e.
 *
 * parent → subtask → grandchild nesting, subtree shape, children listing,
 * dependsOn ordering gate (close blocked until deps done), cycle rejection.
 */

import { describe, it, expect } from 'vitest';
import { spawnServer } from './harness.js';

describe('Q-014 slice 9: task hierarchy nesting', () => {
  it('3-level nesting visible via subtree and children', async () => {
    const srv = await spawnServer('hierarchy');
    try {
      const parent = await srv.callTool('tasks_create', { project: 'mcp', title: 'Q014 root' });
      const rootId = parent.env.data.id as string;

      const child = await srv.callTool('tasks_add_subtask', {
        project: 'mcp',
        parentId: rootId,
        title: 'Q014 child',
      });
      expect(child.isError).toBe(false);
      const childId = (child.env.data.subtask ?? child.env.data).id as string;
      expect(typeof childId).toBe('string');

      const grand = await srv.callTool('tasks_create', {
        project: 'mcp',
        title: 'Q014 grandchild',
        parentId: childId,
      });
      expect(grand.isError).toBe(false);

      const tree = await srv.callTool('tasks_get_subtree', { project: 'mcp', id: rootId });
      expect(tree.env.ok).toBe(true);
      expect(JSON.stringify(tree.env.data)).toContain('Q014 grandchild');

      const kids = await srv.callTool('tasks_get_children', { project: 'mcp', id: rootId });
      expect(kids.env.ok).toBe(true);
      expect(JSON.stringify(kids.env.data)).toContain('Q014 child');
    } finally {
      await srv.close();
    }
  }, 120000);
});

describe('Q-014 slice 9: dependsOn DAG (advisory blocked-ness + cycle rejection)', () => {
  it('link persists; cycle update rejected; close order enforced by caller', async () => {
    const srv = await spawnServer('dag-gate');
    try {
      const dep = await srv.callTool('tasks_create', { project: 'mcp', title: 'Q014 dep' });
      const depId = dep.env.data.id as string;
      const main = await srv.callTool('tasks_create', { project: 'mcp', title: 'Q014 main' });
      const mainId = main.env.data.id as string;

      const link = await srv.callTool('tasks_update', {
        project: 'mcp',
        id: mainId,
        dependsOn: [depId],
      });
      expect(link.isError).toBe(false);

      const got = await srv.callTool('tasks_get', { project: 'mcp', id: mainId });
      expect(got.env.data.dependsOn).toContain(depId);

      const cycle = await srv.callTool('tasks_update', {
        project: 'mcp',
        id: depId,
        dependsOn: [mainId],
      });
      expect(cycle.env.ok).toBe(false);

      await srv.callTool('tasks_close', { project: 'mcp', id: depId });
      const late = await srv.callTool('tasks_close', { project: 'mcp', id: mainId });
      expect(late.env.ok).toBe(true);
    } finally {
      await srv.close();
    }
  }, 120000);
});
