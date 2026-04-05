import { z } from "zod";
import type { ServerContext } from './context.js';
import type { Task } from '../types.js';
import { DEFAULT_PROJECT, resolveProject } from '../config.js';
import { ok } from '../utils/respond.js';

export function registerDashboardTools(ctx: ServerContext): void {
  const { server } = ctx;

  // ── dashboard_stats ─────────────────────────────────────
  // Overview: counts, distributions, averages
  server.registerTool(
    'dashboard_stats',
    {
      title: 'Dashboard Statistics',
      description: 'Get project statistics: task counts by status/priority, knowledge counts, tag distribution, averages. Supports date range filtering.',
      inputSchema: {
        project: z.string().optional(),
        since: z.string().optional().describe('ISO date to filter tasks/knowledge updated since (e.g. 2026-04-01)'),
        until: z.string().optional().describe('ISO date to filter tasks/knowledge updated until (e.g. 2026-04-30)'),
      },
    },
    async ({ project, since, until }) => {
      const prj = resolveProject(project);
      const { listTasks } = await import('../storage/tasks.js');
      const { listDocs } = await import('../storage/knowledge.js');

      const [tasks, docs] = await Promise.all([
        listTasks({ project: prj, includeArchived: true, includeTrashed: true }),
        listDocs({ project: prj, includeArchived: true, includeTrashed: true }),
      ]);

      // Date filter
      const filteredTasks = filterByDateRange(tasks, since, until);
      const filteredDocs = filterByDateRange(docs, since, until);

      // Task counts by status
      const byStatus: Record<string, number> = {};
      const byPriority: Record<string, number> = {};
      const byTag: Record<string, number> = {};
      const byType: Record<string, number> = {};

      let totalDeps = 0;
      let tasksWithDeps = 0;
      let tasksWithSubtasks = 0;
      let maxDepth = 0;
      const daysOpen: number[] = [];

      for (const t of filteredTasks) {
        if (t.archived || t.trashed) continue;

        // By status
        byStatus[t.status] = (byStatus[t.status] || 0) + 1;

        // By priority
        byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;

        // By tag
        for (const tag of (t.tags || [])) {
          byTag[tag] = (byTag[tag] || 0) + 1;
        }

        // Dependency stats
        const depCount = (t.dependsOn || []).length;
        if (depCount > 0) {
          totalDeps += depCount;
          tasksWithDeps++;
        }

        // Subtask indicator (has parentId)
        if (t.parentId) {
          // Not counting as "has subtasks" — need to check reverse
        }

        // Days open (for non-completed/closed)
        if (t.status !== 'completed' && t.status !== 'closed') {
          const days = (Date.now() - new Date(t.createdAt).getTime()) / (1000 * 60 * 60 * 24);
          daysOpen.push(Math.round(days * 10) / 10);
        }
      }

      // Count parent tasks that have children (subtasks)
      const parentIds = new Set(filteredTasks.filter(t => t.parentId).map(t => t.parentId));
      tasksWithSubtasks = parentIds.size;

      // Knowledge by type
      for (const d of filteredDocs) {
        if (d.archived || d.trashed) continue;
        const type = (d as any).type || 'general';
        byType[type] = (byType[type] || 0) + 1;
      }

      // Active tasks (not completed, not closed, not archived, not trashed)
      const activeTasks = filteredTasks.filter(t =>
        !t.archived && !t.trashed && t.status !== 'completed' && t.status !== 'closed'
      );
      const completedTasks = filteredTasks.filter(t =>
        !t.archived && !t.trashed && t.status === 'completed'
      );

      // Average days open
      const avgDaysOpen = daysOpen.length > 0
        ? Math.round((daysOpen.reduce((a, b) => a + b, 0) / daysOpen.length) * 10) / 10
        : 0;

      // Completion rate
      const totalActive = activeTasks.length + completedTasks.length;
      const completionRate = totalActive > 0
        ? Math.round((completedTasks.length / totalActive) * 1000) / 10
        : 0;

      // Top tags (sorted by count, top 10)
      const topTags = Object.entries(byTag)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([tag, count]) => ({ tag, count }));

      return ok({
        project: prj,
        period: { since: since || null, until: until || null },
        tasks: {
          total: filteredTasks.filter(t => !t.archived && !t.trashed).length,
          byStatus,
          byPriority,
          active: activeTasks.length,
          completed: completedTasks.length,
          blocked: (byStatus['blocked'] || 0),
          completionRate: `${completionRate}%`,
          avgDaysOpen,
          withDependencies: tasksWithDeps,
          withSubtasks: tasksWithSubtasks,
          totalDependencies: totalDeps,
        },
        knowledge: {
          total: filteredDocs.filter(d => !d.archived && !d.trashed).length,
          byType,
        },
        tags: {
          unique: Object.keys(byTag).length,
          top: topTags,
        },
      });
    }
  );

  // ── dashboard_activity ──────────────────────────────────
  // Recent changes, sorted by updatedAt
  server.registerTool(
    'dashboard_activity',
    {
      title: 'Dashboard Activity Feed',
      description: 'Get a chronological activity feed of recent task and knowledge changes. Useful for dashboards and status updates.',
      inputSchema: {
        project: z.string().optional(),
        limit: z.number().default(20).optional().describe('Max items to return (1-100)'),
        type: z.enum(['all', 'tasks', 'knowledge']).default('all').optional(),
      },
    },
    async ({ project, limit = 20, type = 'all' }) => {
      const prj = resolveProject(project);
      const { listTasks } = await import('../storage/tasks.js');
      const { listDocs } = await import('../storage/knowledge.js');

      const cappedLimit = Math.min(Math.max(limit, 1), 100);

      const fetchTasks = type !== 'knowledge';
      const fetchDocs = type !== 'tasks';

      const [tasks, docs] = await Promise.all([
        fetchTasks ? listTasks({ project: prj, includeArchived: false, includeTrashed: false }) : [],
        fetchDocs ? listDocs({ project: prj, includeArchived: false, includeTrashed: false }) : [],
      ]);

      // Merge into activity items
      const items: Array<{
        id: string;
        type: 'task' | 'knowledge';
        title: string;
        action: string;
        status?: string;
        priority?: string;
        updatedAt: string;
        createdAt: string;
      }> = [];

      for (const t of tasks) {
        let action = 'updated';
        if (t.status === 'completed') action = 'completed';
        else if (t.status === 'closed') action = 'closed';
        else if (t.status === 'in_progress') action = 'in_progress';
        else if (t.status === 'blocked') action = 'blocked';

        items.push({
          id: t.id,
          type: 'task',
          title: t.title,
          action,
          status: t.status,
          priority: t.priority,
          updatedAt: t.updatedAt,
          createdAt: t.createdAt,
        });
      }

      for (const d of docs) {
        items.push({
          id: d.id,
          type: 'knowledge',
          title: d.title,
          action: 'updated',
          updatedAt: d.updatedAt,
          createdAt: d.createdAt,
        });
      }

      // Sort by updatedAt desc
      items.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

      return ok({
        project: prj,
        total: items.length,
        items: items.slice(0, cappedLimit),
      });
    }
  );

  // ── dashboard_trends ────────────────────────────────────
  // Time-series: tasks created/completed per day/week
  server.registerTool(
    'dashboard_trends',
    {
      title: 'Dashboard Trends',
      description: 'Get task creation and completion trends over time. Returns daily or weekly buckets for burndown/burnup charts.',
      inputSchema: {
        project: z.string().optional(),
        granularity: z.enum(['day', 'week']).default('day').optional().describe('Bucket size'),
        days: z.number().default(30).optional().describe('Number of days to look back (1-365)'),
      },
    },
    async ({ project, granularity = 'day', days = 30 }) => {
      const prj = resolveProject(project);
      const { listTasks } = await import('../storage/tasks.js');

      const cappedDays = Math.min(Math.max(days, 1), 365);
      const since = new Date();
      since.setDate(since.getDate() - cappedDays);
      since.setHours(0, 0, 0, 0);

      const allTasks = await listTasks({ project: prj, includeArchived: true, includeTrashed: true });

      // Build time buckets
      const buckets: Record<string, { created: number; completed: number; closed: number }> = {};

      for (const t of allTasks) {
        const created = new Date(t.createdAt);
        const updated = new Date(t.updatedAt);

        // Created
        if (created >= since) {
          const key = bucketKey(created, granularity);
          if (!buckets[key]) buckets[key] = { created: 0, completed: 0, closed: 0 };
          buckets[key].created++;
        }

        // Completed — look at updatedAt when status is completed
        if ((t.status === 'completed' || t.status === 'closed') && updated >= since) {
          const key = bucketKey(updated, granularity);
          if (!buckets[key]) buckets[key] = { created: 0, completed: 0, closed: 0 };
          if (t.status === 'completed') buckets[key].completed++;
          else buckets[key].closed++;
        }
      }

      // Fill gaps and sort
      const sortedKeys = generateBuckets(since, new Date(), granularity);
      const series = sortedKeys.map(date => ({
        date,
        ...buckets[date] || { created: 0, completed: 0, closed: 0 },
      }));

      // Cumulative totals
      let cumCreated = 0;
      let cumCompleted = 0;
      const cumulative = series.map(b => {
        cumCreated += b.created;
        cumCompleted += b.completed;
        return {
          date: b.date,
          totalCreated: cumCreated,
          totalCompleted: cumCompleted,
          open: cumCreated - cumCompleted,
        };
      });

      return ok({
        project: prj,
        granularity,
        period: { since: since.toISOString().split('T')[0], days: cappedDays },
        daily: series,
        cumulative,
        summary: {
          totalCreated: cumCreated,
          totalCompleted: cumCompleted,
          totalClosed: series.reduce((a, b) => a + (b.closed || 0), 0),
          netOpen: cumCreated - cumCompleted,
        },
      });
    }
  );

  // ── dashboard_project_summary ───────────────────────────
  // Multi-project overview
  server.registerTool(
    'dashboard_project_summary',
    {
      title: 'Dashboard Project Summary',
      description: 'Get a summary across all projects: task counts, knowledge counts, and top metrics per project.',
      inputSchema: {},
    },
    async () => {
      const { listTasks } = await import('../storage/tasks.js');
      const { listDocs } = await import('../storage/knowledge.js');

      // Get all tasks and docs across all projects
      const [tasks, docs] = await Promise.all([
        listTasks({ includeArchived: false, includeTrashed: false }) as Promise<Task[]>,
        listDocs({ includeArchived: false, includeTrashed: false }) as Promise<Array<{ project: string }>>,
      ]);

      // Collect unique project names
      const projectSet = new Set<string>();
      for (const t of tasks) projectSet.add(t.project || 'default');
      for (const d of docs) projectSet.add(d.project || 'default');
      const projectStats: Record<string, {
        tasks: number;
        knowledge: number;
        completed: number;
        inProgress: number;
        blocked: number;
        pending: number;
      }> = {};

      // Initialize all discovered projects
      for (const p of projectSet) {
        projectStats[p] = { tasks: 0, knowledge: 0, completed: 0, inProgress: 0, blocked: 0, pending: 0 };
      }

      for (const t of tasks) {
        const p = t.project || 'default';
        if (!projectStats[p]) {
          projectStats[p] = { tasks: 0, knowledge: 0, completed: 0, inProgress: 0, blocked: 0, pending: 0 };
        }
        projectStats[p].tasks++;
        if (t.status === 'completed') projectStats[p].completed++;
        else if (t.status === 'in_progress') projectStats[p].inProgress++;
        else if (t.status === 'blocked') projectStats[p].blocked++;
        else if (t.status === 'pending') projectStats[p].pending++;
      }

      for (const d of docs) {
        const p = d.project || 'default';
        if (!projectStats[p]) {
          projectStats[p] = { tasks: 0, knowledge: 0, completed: 0, inProgress: 0, blocked: 0, pending: 0 };
        }
        projectStats[p].knowledge++;
      }

      // Build sorted array
      const summary = Object.entries(projectStats)
        .map(([project, stats]) => ({
          project,
          ...stats,
          completionRate: stats.tasks > 0
            ? Math.round((stats.completed / stats.tasks) * 1000) / 10
            : 0,
        }))
        .sort((a, b) => b.tasks - a.tasks);

      return ok({
        totalProjects: summary.length,
        projects: summary,
        totals: {
          tasks: tasks.length,
          knowledge: docs.length,
          completed: tasks.filter(t => t.status === 'completed').length,
          inProgress: tasks.filter(t => t.status === 'in_progress').length,
        },
      });
    }
  );
}

// ── Helpers ───────────────────────────────────────────────

function filterByDateRange<T extends { updatedAt: string }>(
  items: T[],
  since?: string,
  until?: string
): T[] {
  let filtered = items;
  if (since) {
    const sinceDate = new Date(since);
    filtered = filtered.filter(t => new Date(t.updatedAt) >= sinceDate);
  }
  if (until) {
    const untilDate = new Date(until);
    untilDate.setHours(23, 59, 59, 999);
    filtered = filtered.filter(t => new Date(t.updatedAt) <= untilDate);
  }
  return filtered;
}

function bucketKey(date: Date, granularity: 'day' | 'week'): string {
  const d = new Date(date);
  if (granularity === 'week') {
    // ISO week: Monday as first day
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    return monday.toISOString().split('T')[0];
  }
  return d.toISOString().split('T')[0];
}

function generateBuckets(from: Date, to: Date, granularity: 'day' | 'week'): string[] {
  const keys: string[] = [];
  const current = new Date(from);
  current.setHours(0, 0, 0, 0);

  while (current <= to) {
    keys.push(bucketKey(new Date(current), granularity));
    if (granularity === 'day') {
      current.setDate(current.getDate() + 1);
    } else {
      current.setDate(current.getDate() + 7);
    }
  }

  return keys;
}
