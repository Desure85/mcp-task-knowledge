import { z } from "zod";
import type { ServerContext } from './context.js';
import type { Task } from '../types.js';
import { resolveProject } from '../config.js';
import { ok } from '../utils/respond.js';

/**
 * DX-13: `briefing` — one-call session-start context.
 *
 * Assembles current project, open tasks by priority, recent knowledge docs,
 * and blockers (status=blocked + DAG-unmet dependencies) from the same
 * storage functions that tasks_list / knowledge_list / dashboard_* use.
 * Read-only, single-pass, no heavy computation.
 */
export function registerBriefingTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    'briefing',
    {
      title: 'Session Briefing',
      description:
        'Get session-start context in one call: current project, open tasks ' +
        'sorted by priority, recently updated knowledge docs, and blockers ' +
        '(blocked tasks + tasks with unmet dependencies). Use instead of ' +
        'separate tasks_list + knowledge_list + dashboard_stats calls.',
      inputSchema: {
        project: z.string().optional().describe('Project key; defaults to current project'),
        maxTasks: z.number().int().min(1).max(50).default(10).optional()
          .describe('Max open tasks to return (1-50, default 10)'),
        maxDocs: z.number().int().min(1).max(50).default(5).optional()
          .describe('Max recent docs to return (1-50, default 5)'),
      },
    },
    async ({ project, maxTasks = 10, maxDocs = 5 }) => {
      const prj = resolveProject(project);
      const { listTasks, isTaskBlocked } = await import('../storage/tasks.js');
      const { listDocs } = await import('../storage/knowledge.js');

      const [tasks, docs] = await Promise.all([
        listTasks({ project: prj, includeArchived: false, includeTrashed: false }),
        listDocs({ project: prj, includeArchived: false, includeTrashed: false }),
      ]);

      const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
      const OPEN_STATUSES = new Set(['pending', 'in_progress', 'blocked']);

      const open = tasks.filter((t) => OPEN_STATUSES.has(t.status));
      const byId = new Map<string, Task>(tasks.map((t) => [t.id, t]));

      // Sort: priority (high→low), then most recently updated first.
      const openTasks = [...open]
        .sort((a, b) => {
          const pa = PRIORITY_RANK[a.priority] ?? 3;
          const pb = PRIORITY_RANK[b.priority] ?? 3;
          if (pa !== pb) return pa - pb;
          return (b.updatedAt || '').localeCompare(a.updatedAt || '');
        })
        .slice(0, maxTasks)
        .map((t) => ({
          id: t.id,
          title: t.title,
          priority: t.priority,
          status: t.status,
          ...(t.tags?.length ? { tags: t.tags } : {}),
          updatedAt: t.updatedAt,
        }));

      const recentDocs = [...docs]
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
        .slice(0, maxDocs)
        .map((d) => ({
          id: d.id,
          title: d.title,
          ...(d.tags?.length ? { tags: d.tags } : {}),
          updatedAt: d.updatedAt,
        }));

      // Blockers: explicit status=blocked OR DAG-blocked (unmet dependsOn).
      const blockers: Array<{
        type: 'task';
        id: string;
        title: string;
        reason: string;
        blockingDeps?: string[];
      }> = [];

      for (const t of open) {
        const { blocked, blockingDeps } = isTaskBlocked(t, byId);
        if (t.status === 'blocked') {
          blockers.push({
            type: 'task',
            id: t.id,
            title: t.title,
            reason: blocked
              ? `status=blocked; unmet deps: ${blockingDeps.map((d) => d.id).join(', ')}`
              : 'status=blocked',
            ...(blockingDeps.length ? { blockingDeps: blockingDeps.map((d) => d.id) } : {}),
          });
        } else if (blocked) {
          blockers.push({
            type: 'task',
            id: t.id,
            title: t.title,
            reason: `unmet dependencies: ${blockingDeps.map((d) => `${d.id} (${d.status})`).join(', ')}`,
            blockingDeps: blockingDeps.map((d) => d.id),
          });
        }
      }

      const inProgress = open.filter((t) => t.status === 'in_progress').length;
      const summary =
        `${open.length} open task${open.length === 1 ? '' : 's'}` +
        ` (${inProgress} in progress, ${blockers.length} blocked), ` +
        `${docs.length} knowledge doc${docs.length === 1 ? '' : 's'}, ` +
        `project "${prj}"`;

      return ok({
        project: prj,
        openTasks,
        recentDocs,
        blockers,
        counts: {
          openTasks: open.length,
          inProgress,
          blocked: blockers.length,
          docs: docs.length,
        },
        summary,
      });
    }
  );
}
