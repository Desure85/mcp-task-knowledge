import { getCriticalPath } from '../storage/tasks.js';
import type { Task } from '../types.js';

export interface TaskGraphMetrics {
  /** Longest dependency chain in the project includes this task. */
  onCriticalPath: boolean;
  /** How many tasks transitively depend on this one (direct + indirect). */
  dependentsCount: number;
}

/**
 * Compute the two per-task graph metrics without changing the stored task.
 * `getCriticalPath` already owns the "longest chain" definition; the dependent
 * count is a reverse BFS over `dependsOn` edges (A depends on B means A is a
 * dependent of B).
 */
export function computeGraphMetrics(tasks: Task[]): Map<string, TaskGraphMetrics> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const reverse = new Map<string, string[]>();
  for (const task of tasks) {
    for (const dependency of task.dependsOn ?? []) {
      if (!byId.has(dependency)) continue;
      const list = reverse.get(dependency) ?? [];
      list.push(task.id);
      reverse.set(dependency, list);
    }
  }

  const critical = new Set(getCriticalPath(tasks).map((task) => task.id));
  const metrics = new Map<string, TaskGraphMetrics>();
  for (const task of tasks) {
    const seen = new Set<string>();
    const queue = [...(reverse.get(task.id) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(...(reverse.get(id) ?? []));
    }
    metrics.set(task.id, {
      onCriticalPath: critical.has(task.id),
      dependentsCount: seen.size,
    });
  }
  return metrics;
}

export function withGraphMetrics<T extends { id: string }>(
  items: T[],
  metrics: Map<string, TaskGraphMetrics>,
): Array<T & Partial<TaskGraphMetrics>> {
  return items.map((item) => {
    const value = metrics.get(item.id);
    return value ? { ...item, ...value } : item;
  });
}
