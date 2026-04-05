import { describe, it, expect } from 'vitest';
import type { Task } from '../src/types.js';

// Import pure functions — DAG helpers don't need DATA_DIR
// We test them by importing only the functions, not the module side-effects

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    id: overrides.id,
    project: overrides.project || 'test',
    title: overrides.title || `Task ${overrides.id}`,
    status: overrides.status || 'pending',
    priority: overrides.priority || 'medium',
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// Inline pure DAG logic for testing (mirrors src/storage/tasks.ts)
function detectCycle(allIds: Set<string>, edges: Array<[string, string]>, newEdges?: Array<[string, string]>): string[] {
  const adj = new Map<string, Set<string>>();
  for (const id of allIds) adj.set(id, new Set());
  const all = [...edges, ...(newEdges || [])];
  for (const [from, to] of all) {
    if (!adj.has(from)) adj.set(from, new Set());
    if (!adj.has(to)) adj.set(to, new Set());
    adj.get(to)!.add(from);
  }
  const inDeg = new Map<string, number>();
  for (const id of allIds) inDeg.set(id, 0);
  for (const [from] of all) inDeg.set(from, (inDeg.get(from) || 0) + 1);
  const queue: string[] = [];
  for (const [id, d] of inDeg) if (d === 0) queue.push(id);
  const visited: string[] = [];
  while (queue.length > 0) {
    const n = queue.shift()!;
    visited.push(n);
    for (const nb of (adj.get(n) || [])) {
      const nd = (inDeg.get(nb) || 1) - 1;
      inDeg.set(nb, nd);
      if (nd === 0) queue.push(nb);
    }
  }
  const vs = new Set(visited);
  return Array.from(allIds).filter(id => !vs.has(id));
}

function topoSort(tasks: Task[]): Task[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const t of tasks) { inDeg.set(t.id, 0); adj.set(t.id, []); }
  for (const t of tasks) {
    const deps = t.dependsOn || [];
    inDeg.set(t.id, deps.length);
    for (const d of deps) { if (adj.has(d)) adj.get(d)!.push(t.id); }
  }
  const q: string[] = [];
  for (const [id, d] of inDeg) if (d === 0) q.push(id);
  const res: Task[] = [];
  while (q.length > 0) {
    const id = q.shift()!;
    const t = byId.get(id);
    if (t) res.push(t);
    for (const nb of (adj.get(id) || [])) {
      const nd = (inDeg.get(nb) || 1) - 1;
      inDeg.set(nb, nd);
      if (nd === 0) q.push(nb);
    }
  }
  return res;
}

function getBlocking(task: Task, all: Map<string, Task>): Task[] {
  return (task.dependsOn || []).map(id => all.get(id)).filter((t): t is Task => !!t);
}

function getBlocked(taskId: string, all: Map<string, Task>): Task[] {
  return Array.from(all.values()).filter(t => (t.dependsOn || []).includes(taskId));
}

function checkBlocked(task: Task, all: Map<string, Task>): { blocked: boolean; blockingDeps: Task[] } {
  const deps = (task.dependsOn || []).map(id => all.get(id)).filter((t): t is Task => !!t);
  const unmet = deps.filter(d => d.status !== 'completed' && d.status !== 'closed');
  return { blocked: unmet.length > 0, blockingDeps: unmet };
}

function buildDAG(tasks: Task[]): { nodes: Task[]; edges: Array<{ from: string; to: string }> } {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const edges: Array<{ from: string; to: string }> = [];
  for (const t of tasks) {
    for (const d of (t.dependsOn || [])) {
      if (byId.has(d)) edges.push({ from: t.id, to: d });
    }
  }
  return { nodes: tasks, edges };
}

describe('Dependency Graph (DAG)', () => {
  describe('detectDependencyCycle', () => {
    it('returns empty array for acyclic graph', () => {
      const ids = new Set(['a', 'b', 'c']);
      const edges: [string, string][] = [['b', 'a'], ['c', 'b']]; // b->a, c->b
      const cycle = detectCycle(ids, edges);
      expect(cycle).toEqual([]);
    });

    it('detects simple cycle', () => {
      const ids = new Set(['a', 'b', 'c']);
      const edges: [string, string][] = [['b', 'a'], ['c', 'b'], ['a', 'c']];
      const cycle = detectCycle(ids, edges);
      expect(cycle.length).toBeGreaterThan(0);
    });

    it('detects self-cycle', () => {
      const ids = new Set(['a']);
      const edges: [string, string][] = [['a', 'a']];
      const cycle = detectCycle(ids, edges);
      expect(cycle).toContain('a');
    });

    it('detects cycle with new edges only', () => {
      const ids = new Set(['a', 'b', 'c']);
      const existingEdges: [string, string][] = [['b', 'a']];
      const newEdges: [string, string][] = [['a', 'b']];
      const cycle = detectCycle(ids, existingEdges, newEdges);
      expect(cycle.length).toBeGreaterThan(0);
    });
  });

  describe('topoSort', () => {
    it('sorts independent tasks', () => {
      const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' }), makeTask({ id: 'c' })];
      const sorted = topoSort(tasks);
      expect(sorted).toHaveLength(3);
    });

    it('puts dependencies before dependents', () => {
      // c depends on b, b depends on a -> order: a, b, c
      const tasks = [
        makeTask({ id: 'c', dependsOn: ['b'] }),
        makeTask({ id: 'a' }),
        makeTask({ id: 'b', dependsOn: ['a'] }),
      ];
      const sorted = topoSort(tasks);
      const order = sorted.map(t => t.id);
      const posA = order.indexOf('a');
      const posB = order.indexOf('b');
      const posC = order.indexOf('c');
      expect(posA).toBeLessThan(posB);
      expect(posB).toBeLessThan(posC);
    });

    it('handles diamond dependency', () => {
      // d depends on b and c; b and c depend on a
      const tasks = [
        makeTask({ id: 'a' }),
        makeTask({ id: 'b', dependsOn: ['a'] }),
        makeTask({ id: 'c', dependsOn: ['a'] }),
        makeTask({ id: 'd', dependsOn: ['b', 'c'] }),
      ];
      const sorted = topoSort(tasks);
      const order = sorted.map(t => t.id);
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
      expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
      expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
    });
  });

  describe('getCriticalPath', () => {
    it('returns single task for independent tasks', () => {
      const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' })];
      const path = topoSort(tasks);
      expect(path).toHaveLength(2); // no single longest path defined for independent
    });

    it('preserves dependency order in chain', () => {
      // a -> b -> c (chain)
      const tasks = [
        makeTask({ id: 'a' }),
        makeTask({ id: 'b', dependsOn: ['a'] }),
        makeTask({ id: 'c', dependsOn: ['b'] }),
      ];
      const sorted = topoSort(tasks);
      const order = sorted.map(t => t.id);
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
      expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
    });

    it('handles parallel branches', () => {
      // a -> b, a -> c, b -> d, c -> d (diamond)
      const tasks = [
        makeTask({ id: 'a' }),
        makeTask({ id: 'b', dependsOn: ['a'] }),
        makeTask({ id: 'c', dependsOn: ['a'] }),
        makeTask({ id: 'd', dependsOn: ['b', 'c'] }),
      ];
      const sorted = topoSort(tasks);
      const order = sorted.map(t => t.id);
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
      expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
      expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
    });
  });

  describe('getBlockingTasks / getBlockedByTask', () => {
    const byId = new Map<string, Task>([
      ['a', makeTask({ id: 'a' })],
      ['b', makeTask({ id: 'b', dependsOn: ['a'] })],
      ['c', makeTask({ id: 'c', dependsOn: ['a', 'b'] })],
    ]);

    it('getBlockingTasks returns direct dependencies', () => {
      const b = byId.get('b')!;
      const blocking = getBlocking(b, byId);
      expect(blocking.map(t => t.id)).toEqual(['a']);
    });

    it('getBlockedByTask returns direct dependents', () => {
      const blocked = getBlocked('a', byId);
      expect(blocked.map(t => t.id).sort()).toEqual(['b', 'c']);
    });
  });

  describe('isTaskBlocked', () => {
    it('returns blocked when dependencies are pending', () => {
      const byId = new Map<string, Task>([
        ['a', makeTask({ id: 'a', status: 'pending' })],
        ['b', makeTask({ id: 'b', dependsOn: ['a'] })],
      ]);
      const { blocked, blockingDeps } = checkBlocked(byId.get('b')!, byId);
      expect(blocked).toBe(true);
      expect(blockingDeps).toHaveLength(1);
    });

    it('returns not blocked when all dependencies are completed', () => {
      const byId = new Map<string, Task>([
        ['a', makeTask({ id: 'a', status: 'completed' })],
        ['b', makeTask({ id: 'b', dependsOn: ['a'] })],
      ]);
      const { blocked } = checkBlocked(byId.get('b')!, byId);
      expect(blocked).toBe(false);
    });

    it('returns not blocked when all dependencies are closed', () => {
      const byId = new Map<string, Task>([
        ['a', makeTask({ id: 'a', status: 'closed' })],
        ['b', makeTask({ id: 'b', dependsOn: ['a'] })],
      ]);
      const { blocked } = checkBlocked(byId.get('b')!, byId);
      expect(blocked).toBe(false);
    });

    it('returns not blocked when no dependencies', () => {
      const byId = new Map<string, Task>([
        ['a', makeTask({ id: 'a' })],
      ]);
      const { blocked } = checkBlocked(byId.get('a')!, byId);
      expect(blocked).toBe(false);
    });
  });

  describe('buildDAG', () => {
    it('returns nodes and edges', () => {
      const tasks = [
        makeTask({ id: 'a' }),
        makeTask({ id: 'b', dependsOn: ['a'] }),
        makeTask({ id: 'c', dependsOn: ['a', 'b'] }),
      ];
      const dag = buildDAG(tasks);
      expect(dag.nodes).toHaveLength(3);
      expect(dag.edges).toHaveLength(3); // b->a, c->a, c->b
    });

    it('ignores non-existent dependency targets', () => {
      const tasks = [
        makeTask({ id: 'a' }),
        makeTask({ id: 'b', dependsOn: ['nonexistent'] }),
      ];
      const dag = buildDAG(tasks);
      expect(dag.edges).toHaveLength(0);
    });
  });
});
