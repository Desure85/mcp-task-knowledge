import { z } from "zod/v3";
import type { ServerContext } from './context.js';
import { resolveProject } from '../config.js';
import { ok, err } from '../utils/respond.js';
import { defaultStatusId, isDone, loadProjectWorkflow, statusCategory } from '../workflow.js';

export function registerDependencyTools(ctx: ServerContext): void {
  const { server } = ctx;

  // tasks_set_deps — set dependencies for a task
  server.registerTool(
    'tasks_set_deps',
    {
      title: 'Set Task Dependencies',
      description:
        'Set or replace dependency list for a task. Validates no cycles. ' +
        'Returns task, statusChanged, blockedByDeps and blockingDeps. Tasks in the todo ' +
        'category with unmet dependencies are marked "blocked" unless markBlocked is false.',
      inputSchema: {
        project: z.string().optional(),
        id: z.string().describe('Task ID'),
        dependsOn: z.array(z.string()).optional().describe('Array of task IDs this task depends on'),
        markBlocked: z
          .boolean()
          .optional()
          .describe('Automatically switch a todo-category task to "blocked" when dependencies are unmet (default true)'),
      },
    },
    async ({ project, id, dependsOn, markBlocked }) => {
      const prj = resolveProject(project);
      const { listTasks, updateTask, isTaskBlocked } = await import('../storage/tasks.js');

      const workflow = await loadProjectWorkflow(prj);
      const allTasks = await listTasks({ project: prj, includeArchived: true, includeTrashed: true });
      const existing = allTasks.find(t => t.id === id);
      if (!existing) {
        return err(`Task not found: ${prj}/${id}`);
      }

      const updated = await updateTask(prj, id, { dependsOn: dependsOn || [] } as any);
      if (!updated) {
        return err(`Failed to update task: ${prj}/${id}`);
      }

      const byId = new Map(allTasks.map(t => [t.id, t] as const));
      byId.set(updated.id, updated);
      const { blocked, blockingDeps } = isTaskBlocked(updated, byId, (status) => isDone(workflow, status));

      // AC-02: one vocabulary. `status` used to mean three different things across three
      // branches (saved status, the word "blocked", the word "unblocked"); it now always
      // carries the saved status, and the facts live in `statusChanged`/`blockedByDeps`.
      const depsPayload = (task: typeof updated, statusChanged: boolean) => ({
        task,
        statusChanged,
        blockedByDeps: blocked,
        blockingDeps: blockingDeps.map(d => ({ id: d.id, title: d.title, status: d.status })),
      });

      if (blocked && markBlocked !== false && statusCategory(workflow, updated.status) === 'todo') {
        const blockedTask = await updateTask(prj, id, { status: 'blocked' as any } as any);
        return ok(depsPayload(blockedTask ?? updated, true));
      }

      if (!blocked && updated.status === 'blocked') {
        const unblockedTask = await updateTask(prj, id, { status: defaultStatusId(workflow) } as any);
        return ok({
          ...depsPayload(unblockedTask ?? updated, true),
          message: 'All dependencies met, task unblocked',
        });
      }

      return ok(depsPayload(updated, false));
    }
  );

  // tasks_get_deps — get dependencies for a task
  server.registerTool(
    'tasks_get_deps',
    {
      title: 'Get Task Dependencies',
      description: 'Get the dependency graph for a specific task: what it depends on and what depends on it.',
      inputSchema: {
        project: z.string().optional(),
        id: z.string().describe('Task ID'),
      },
    },
    async ({ project, id }) => {
      const prj = resolveProject(project);
      const { listTasks, getTask, getBlockingTasks, getBlockedByTask, isTaskBlocked } = await import('../storage/tasks.js');

      const task = await getTask(prj, id);
      if (!task) {
        return err(`Task not found: ${prj}/${id}`);
      }

      const workflow = await loadProjectWorkflow(prj);
      const allTasks = await listTasks({ project: prj, includeArchived: true, includeTrashed: true });
      const byId = new Map(allTasks.map(t => [t.id, t] as const));

      const blocking = getBlockingTasks(task, byId);
      const blocked = getBlockedByTask(id, byId);
      const { blocked: isBlocked, blockingDeps } = isTaskBlocked(task, byId, (status) => isDone(workflow, status));

      return ok({
        task: { id: task.id, title: task.title, status: task.status },
        dependsOn: blocking.map(t => ({ id: t.id, title: t.title, status: t.status })),
        dependedBy: blocked.map(t => ({ id: t.id, title: t.title, status: t.status })),
        isBlocked,
        unmetDependencies: blockingDeps.map(d => ({ id: d.id, title: d.title, status: d.status })),
      });
    }
  );

  // tasks_dag — get full dependency graph for a project
  server.registerTool(
    'tasks_dag',
    {
      title: 'Get Project Dependency Graph',
      description: 'Get the full dependency DAG for a project: topological sort, critical path, and edge list.',
      inputSchema: {
        project: z.string().optional(),
        includeArchived: z.boolean().default(false).optional(),
      },
    },
    async ({ project, includeArchived }) => {
      const prj = resolveProject(project);
      const { listTasks, topologicalSort, getCriticalPath, buildDAG } = await import('../storage/tasks.js');

      const tasks = await listTasks({ project: prj, includeArchived });
      const workflow = await loadProjectWorkflow(prj);
      const sorted = topologicalSort(tasks);
      const criticalPath = getCriticalPath(tasks);
      const dag = buildDAG(tasks);

      const byId = new Map(tasks.map(t => [t.id, t] as const));
      let blockedCount = 0;
      for (const t of tasks) {
        const deps = (t.dependsOn || []).map(depId => byId.get(depId)).filter(Boolean);
        const unmet = deps.filter((d: any) => !isDone(workflow, d.status));
        if (unmet.length > 0) blockedCount++;
      }

      return ok({
        project: prj,
        totalTasks: tasks.length,
        tasksWithDeps: tasks.filter(t => (t.dependsOn || []).length > 0).length,
        blockedCount,
        topologicalOrder: sorted.map(t => ({ id: t.id, title: t.title, status: t.status })),
        criticalPath: criticalPath.map(t => ({ id: t.id, title: t.title, status: t.status })),
        edges: dag.edges.map(e => ({ from: e.from, to: e.to })),
      });
    }
  );
}
