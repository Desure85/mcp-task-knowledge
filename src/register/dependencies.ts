import { z } from "zod/v3";
import type { ServerContext } from './context.js';
import { resolveProject } from '../config.js';
import { ok, err, errWith } from '../utils/respond.js';
import { defaultStatusId, isDone, loadProjectWorkflow, statusCategory } from '../workflow.js';
import { PaginationError, paginateRanked, pickFields, scopeOf } from '../utils/pagination.js';
import { pageArgsSchema, toPageRequest } from './page-args.js';

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
      description:
        'Get the dependency DAG for a project: topological sort, critical path and edge list. ' +
        'Supports tag and onlyWithDeps filters, a page over the topological order (default limit 200), ' +
        'field projection and a cursor; `truncated`/`nextCursor` describe what is missing, and ' +
        'edges/criticalPath only contain the nodes on the returned page.',
      inputSchema: {
        project: z.string().optional(),
        includeArchived: z.boolean().default(false).optional(),
        tag: z.string().min(1).optional().describe('Only nodes carrying this tag'),
        onlyWithDeps: z
          .boolean()
          .optional()
          .describe('Only tasks that have dependencies or are depended on by another task'),
        ...pageArgsSchema,
      },
    },
    async ({ project, includeArchived, tag, onlyWithDeps, ...pageArgs }) => {
      const prj = resolveProject(project);
      const { listTasks, topologicalSort, getCriticalPath, buildDAG } = await import('../storage/tasks.js');
      const request = toPageRequest(pageArgs);

      try {
        const all = await listTasks({ project: prj, includeArchived });
        const workflow = await loadProjectWorkflow(prj);

        // AC-03b: the graph is computed over the whole project (topological order and the
        // critical path are meaningless on a slice), but the response is a page of it.
        const inGraph = new Set<string>();
        for (const task of all) {
          for (const depId of task.dependsOn ?? []) {
            inGraph.add(task.id);
            inGraph.add(depId);
          }
        }

        let visible = all;
        if (tag) visible = visible.filter((task) => (task.tags ?? []).includes(tag));
        if (onlyWithDeps === true) visible = visible.filter((task) => inGraph.has(task.id));

        const sorted = topologicalSort(visible);
        const criticalPath = getCriticalPath(visible);
        const dag = buildDAG(visible);

        const requestWithDefault = { ...request, limit: request.limit ?? 200 };
        const scope = scopeOf(prj, 'dag', tag, onlyWithDeps === true ? 'deps' : 'all');
        const nodes = sorted.map((task) => ({ id: task.id, title: task.title, status: task.status }));

        const byId = new Map(all.map((task) => [task.id, task] as const));
        let blockedCount = 0;
        for (const task of visible) {
          const deps = (task.dependsOn ?? []).map((depId) => byId.get(depId)).filter(Boolean);
          const unmet = deps.filter((dep) => !isDone(workflow, dep!.status));
          if (unmet.length > 0) blockedCount++;
        }
        const tasksWithDeps = visible.filter((task) => (task.dependsOn ?? []).length > 0).length;

        // AC-03b: the response is a page of the graph and the whole envelope is capped at 8 KB by
        // default (`maxBytes` can raise it). Edges and the critical path only carry nodes of the
        // page, so shrinking the page shrinks them too; the loop measures the overhead and
        // re-paginates until the payload fits (or a single node is all that is left).
        const budget = request.maxBytes ?? Number.MAX_SAFE_INTEGER;
        const buildData = (paged: ReturnType<typeof paginateRanked>) => {
          const page = paged.items as Array<{ id: string }>;
          const pageIds = new Set(page.map((node) => node.id));
          const edges = dag.edges
            .filter((edge) => pageIds.has(edge.from) && pageIds.has(edge.to))
            .map((edge) => ({ from: edge.from, to: edge.to }));
          const criticalShown = criticalPath.filter((task) => pageIds.has(task.id));
          const projectedCritical = criticalShown.map((task) =>
            pickFields({ id: task.id, title: task.title, status: task.status }, request.fields),
          );
          const data = {
            project: prj,
            totalTasks: visible.length,
            tasksWithDeps,
            blockedCount,
            topologicalOrder: page,
            criticalPath: projectedCritical,
            criticalPathTruncated: criticalShown.length !== criticalPath.length,
            edges,
            returnedNodes: page.length,
            truncated: paged.meta.truncated || paged.meta.hasMore,
            nextCursor: paged.meta.nextCursor,
            limit: paged.meta.limit,
          };
          return { data, pageCount: page.length };
        };

        let attempt = { ...requestWithDefault, maxBytes: budget };
        let built = buildData(paginateRanked(nodes, attempt, scope));
        for (let round = 0; round < 4; round++) {
          const size = Buffer.byteLength(JSON.stringify(built.data, null, 2), 'utf8');
          if (size <= budget || built.pageCount <= 1) break;
          const nodesBytes = Buffer.byteLength(JSON.stringify(built.data.topologicalOrder, null, 2), 'utf8');
          const overhead = Math.max(256, size - nodesBytes);
          const nodeBudget = Math.max(1024, budget - overhead);
          if (nodeBudget >= (attempt.maxBytes ?? budget)) break;
          attempt = { ...attempt, maxBytes: nodeBudget };
          built = buildData(paginateRanked(nodes, attempt, scope));
        }

        return ok(built.data);
      } catch (e) {
        if (e instanceof PaginationError) return errWith({ message: e.message, code: e.code, hint: e.hint });
        throw e;
      }
    }
  );
}
