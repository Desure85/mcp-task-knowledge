import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type E2EServer } from './e2e-full/harness.js';

let srv: E2EServer;

function projectName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function create(project: string, title: string): Promise<string> {
  const res = await srv.callTool('tasks_create', { project, title });
  expect(res.env.ok).toBe(true);
  return res.env.data.id as string;
}

async function listMetrics(project: string) {
  const res = await srv.callTool('tasks_list', { project, includeGraphMetrics: true, limit: 500 });
  expect(res.env.ok).toBe(true);
  return new Map<string, { onCriticalPath: boolean; dependentsCount: number }>(
    (res.env.data as Array<{ id: string; onCriticalPath: boolean; dependentsCount: number }>).map((task) => [
      task.id,
      { onCriticalPath: task.onCriticalPath, dependentsCount: task.dependentsCount },
    ]),
  );
}

describe('tasks graph metrics (UI-39)', () => {
  beforeAll(async () => {
    srv = await spawnServer('task-critical-path');
  });

  afterAll(async () => {
    await srv?.close();
  });

  it('counts transitive dependents and marks the longest chain', async () => {
    const project = projectName('ui39');
    expect((await srv.callTool('project_create', { id: project })).env.ok).toBe(true);
    const a = await create(project, 'A');
    const b = await create(project, 'B');
    const c = await create(project, 'C');

    for (const [id, dependsOn] of [
      [b, [a]],
      [c, [b]],
    ] as const) {
      const res = await srv.callTool('tasks_set_deps', { project, id, dependsOn, markBlocked: false });
      expect(res.env.ok).toBe(true);
    }

    let metrics = await listMetrics(project);
    expect(metrics.get(a)?.dependentsCount).toBe(2);
    expect(metrics.get(b)?.dependentsCount).toBe(1);
    expect(metrics.get(c)?.dependentsCount).toBe(0);
    expect(metrics.get(a)?.onCriticalPath).toBe(true);
    expect(metrics.get(b)?.onCriticalPath).toBe(true);
    expect(metrics.get(c)?.onCriticalPath).toBe(true);

    const getA = await srv.callTool('tasks_get', { project, id: a, includeGraphMetrics: true });
    expect(getA.env.ok).toBe(true);
    expect(getA.env.data).toMatchObject({ dependentsCount: 2, onCriticalPath: true });
    const getWithout = await srv.callTool('tasks_get', { project, id: a });
    expect(getWithout.env.data.dependentsCount).toBeUndefined();

    // Break A→B: A no longer has dependents, and the longest chain is B→C.
    expect((await srv.callTool('tasks_set_deps', { project, id: b, dependsOn: [], markBlocked: false })).env.ok).toBe(true);
    metrics = await listMetrics(project);
    expect(metrics.get(a)?.dependentsCount).toBe(0);
    expect(metrics.get(b)?.dependentsCount).toBe(1);
    expect(metrics.get(c)?.dependentsCount).toBe(0);
    expect(metrics.get(a)?.onCriticalPath).toBe(false);
    expect(metrics.get(b)?.onCriticalPath).toBe(true);
    expect(metrics.get(c)?.onCriticalPath).toBe(true);
  });
});
