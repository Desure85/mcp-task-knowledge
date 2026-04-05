import { z } from "zod";
import type { ServerContext } from './context.js';
import { DEFAULT_PROJECT, resolveProject } from '../config.js';
import { createTask, updateTask, archiveTask, trashTask, restoreTask, deleteTaskPermanent, closeTask, listTasks, listTasksTree, getTask, getTaskSubtree, getDirectChildren, closeTaskWithCascade, MAX_TASK_DEPTH } from '../storage/tasks.js';
import { createDoc, listDocs, readDoc, updateDoc, archiveDoc, trashDoc, restoreDoc, deleteDocPermanent } from '../storage/knowledge.js';
import { ok, err } from '../utils/respond.js';

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export function registerBulkTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    "tasks_bulk_update",
    {
      title: "Bulk Update Tasks",
      description: "Update fields of many tasks at once",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        items: z
          .array(
            z.object({
              id: z.string().min(1),
              title: z.string().optional(),
              description: z.string().optional(),
              priority: z.enum(["low", "medium", "high"]).optional(),
              tags: z.array(z.string()).optional(),
              links: z.array(z.string()).optional(),
              parentId: z.string().nullable().optional(),
              status: z.enum(["pending", "in_progress", "completed", "closed"]).optional(),
            })
          )
          .min(1)
          .max(100),
      },
    },
    async ({ project, items }) => {
      const prj = resolveProject(project);
      const results: any[] = [];
      for (const it of items) {
        const { id, ...patch } = it as any;
        const t = await updateTask(prj, id, patch as any);
        if (t) results.push(t);
      }
      return ok({ count: results.length, results });
    }
  );

  ctx.server.registerTool(
    "knowledge_bulk_update",
    {
      title: "Bulk Update Knowledge Docs",
      description: "Update fields of many knowledge docs at once",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        items: z
          .array(
            z.object({
              id: z.string().min(1),
              title: z.string().optional(),
              content: z.string().optional(),
              tags: z.array(z.string()).optional(),
              source: z.string().optional(),
              parentId: z.string().nullable().optional(),
              type: z.string().optional(),
            })
          )
          .min(1)
          .max(100),
      },
    },
    async ({ project, items }) => {
      const prj = resolveProject(project);
      const results: any[] = [];
      for (const it of items) {
        const { id, ...patch } = it as any;
        const d = await updateDoc(prj, id, patch as any);
        if (d) results.push(d);
      }
      return ok({ count: results.length, results });
    }
  );

  ctx.server.registerTool(
    "tasks_bulk_create",
    {
      title: "Bulk Create Tasks",
      description: "Create many tasks at once (optionally hierarchical via parentId)",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        items: z
          .array(
            z.object({
              title: z.string().min(1),
              description: z.string().optional(),
              priority: z.enum(["low", "medium", "high"]).optional(),
              tags: z.array(z.string()).optional(),
              links: z.array(z.string()).optional(),
              parentId: z.string().optional(),
            })
          )
          .min(1)
          .max(100),
      },
    },
    async ({ project, items }) => {
      const prj = resolveProject(project);
      const created = [] as any[];
      for (const it of items) {
        const t = await createTask({ project: prj, ...it });
        created.push(t);
      }
      const envelope = { ok: true, data: { count: created.length, created } };
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    }
  );

  ctx.server.registerTool(
    "tasks_bulk_archive",
    {
      title: "Bulk Archive Tasks",
      description: "Archive many tasks",
      inputSchema: { project: z.string().default(DEFAULT_PROJECT), ids: z.array(z.string().min(1)).min(1).max(200) },
    },
    async ({ project, ids }) => {
      const prj = resolveProject(project);
      const results = [] as any[];
      for (const id of ids) {
        const t = await archiveTask(prj, id);
        if (t) results.push(t);
      }
      return ok({ count: results.length, results });
    }
  );

  ctx.server.registerTool(
    "tasks_bulk_trash",
    {
      title: "Bulk Trash Tasks",
      description: "Move many tasks to trash",
      inputSchema: { project: z.string().default(DEFAULT_PROJECT), ids: z.array(z.string().min(1)).min(1).max(200) },
    },
    async ({ project, ids }) => {
      const prj = resolveProject(project);
      const results = [] as any[];
      for (const id of ids) {
        const t = await trashTask(prj, id);
        if (t) results.push(t);
      }
      return ok({ count: results.length, results });
    }
  );

  ctx.server.registerTool(
    "tasks_bulk_restore",
    {
      title: "Bulk Restore Tasks",
      description: "Restore many tasks from archive/trash",
      inputSchema: { project: z.string().default(DEFAULT_PROJECT), ids: z.array(z.string().min(1)).min(1).max(200) },
    },
    async ({ project, ids }) => {
      const prj = resolveProject(project);
      const results = [] as any[];
      for (const id of ids) {
        const t = await restoreTask(prj, id);
        if (t) results.push(t);
      }
      return ok({ count: results.length, results });
    }
  );

  ctx.server.registerTool(
    "tasks_bulk_close",
    {
      title: "Bulk Close Tasks",
      description: "Mark many tasks as closed",
      inputSchema: { project: z.string().default(DEFAULT_PROJECT), ids: z.array(z.string().min(1)).min(1).max(200) },
    },
    async ({ project, ids }) => {
      const prj = resolveProject(project);
      const results = [] as any[];
      for (const id of ids) {
        const t = await closeTask(prj, id);
        if (t) results.push(t);
      }
      return ok({ count: results.length, results });
    }
  );

  ctx.server.registerTool(
    "tasks_bulk_delete_permanent",
    {
      title: "Bulk Delete Tasks Permanently",
      description: "Permanently delete many tasks (use with caution)",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        ids: z.array(z.string().min(1)).min(1).max(200),
        confirm: z.boolean().optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ project, ids, confirm, dryRun }) => {
      const prj = resolveProject(project);
      if (dryRun) {
        const results = [] as any[];
        for (const id of ids) {
          try {
            const t = await getTask(prj, id);
            if (t) {
              results.push({ ok: true, data: t });
            } else {
              results.push({ ok: false, error: { message: `Task not found: ${project}/${id}` } });
            }
          } catch (e: any) {
            results.push({ ok: false, error: { message: String(e?.message || e) } });
          }
        }
        return ok({ count: results.length, results, dryRun: true });
      }

      if (confirm !== true) {
        return err('Bulk task delete not confirmed: pass confirm=true to proceed');
      }

      const results = [] as any[];
      for (const id of ids) {
        const t = await deleteTaskPermanent(prj, id);
        if (t) results.push(t);
      }
      return ok({ count: results.length, results });
    }
  );

  ctx.server.registerTool(
    "knowledge_bulk_create",
    {
      title: "Bulk Create Knowledge Docs",
      description: "Create many knowledge docs at once (optionally hierarchical via parentId)",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        items: z
          .array(
            z.object({
              title: z.string().min(1),
              content: z.string(),
              tags: z.array(z.string()).optional(),
              source: z.string().optional(),
              parentId: z.string().optional(),
              type: z.string().optional(),
            })
          )
          .min(1)
          .max(100),
      },
    },
    async ({ project, items }) => {
      const prj = resolveProject(project);
      const created: any[] = [];
      for (const it of items) {
        const d = await createDoc({ project: prj, ...it });
        created.push(d);
      }
      return ok({ count: created.length, created });
    }
  );

  ctx.server.registerTool(
    "knowledge_bulk_archive",
    {
      title: "Bulk Archive Knowledge Docs",
      description: "Archive many knowledge docs",
      inputSchema: { project: z.string().default(DEFAULT_PROJECT), ids: z.array(z.string().min(1)).min(1).max(200) },
    },
    async ({ project, ids }) => {
      const prj = resolveProject(project);
      const results = [] as any[];
      for (const id of ids) {
        const d = await archiveDoc(prj, id);
        if (d) results.push(d);
      }
      return ok({ count: results.length, results });
    }
  );

  ctx.server.registerTool(
    "knowledge_bulk_trash",
    {
      title: "Bulk Trash Knowledge Docs",
      description: "Move many knowledge docs to trash",
      inputSchema: { project: z.string().default(DEFAULT_PROJECT), ids: z.array(z.string().min(1)).min(1).max(200) },
    },
    async ({ project, ids }) => {
      const prj = resolveProject(project);
      const results = [] as any[];
      for (const id of ids) {
        const d = await trashDoc(prj, id);
        if (d) results.push(d);
      }
      return ok({ count: results.length, results });
    }
  );

  ctx.server.registerTool(
    "knowledge_bulk_restore",
    {
      title: "Bulk Restore Knowledge Docs",
      description: "Restore many knowledge docs from archive/trash",
      inputSchema: { project: z.string().default(DEFAULT_PROJECT), ids: z.array(z.string().min(1)).min(1).max(200) },
    },
    async ({ project, ids }) => {
      const prj = resolveProject(project);
      const results = [] as any[];
      for (const id of ids) {
        const d = await restoreDoc(prj, id);
        if (d) results.push(d);
      }
      return ok({ count: results.length, results });
    }
  );

  ctx.server.registerTool(
    "knowledge_bulk_delete_permanent",
    {
      title: "Bulk Delete Knowledge Docs Permanently",
      description: "Permanently delete many knowledge docs (use with caution)",
      inputSchema: { project: z.string().default(DEFAULT_PROJECT), ids: z.array(z.string().min(1)).min(1).max(200) },
    },
    async ({ project, ids }) => {
      const prj = resolveProject(project);
      const results = [] as any[];
      for (const id of ids) {
        const d = await deleteDocPermanent(prj, id);
        if (d) results.push(d);
      }
      return ok({ count: results.length, results });
    }
  );

  ctx.server.registerTool(
    "project_purge",
    {
      title: "Project Purge (Destructive)",
      description: "Enumerate and permanently delete ALL tasks and/or knowledge in the project. Requires confirm=true unless dryRun.",
      inputSchema: {
        project: z.string().optional(),
        scope: z.enum(['both','tasks','knowledge']).optional(),
        dryRun: z.boolean().optional(),
        confirm: z.boolean().optional(),
        includeArchived: z.boolean().optional(),
        tasksStatus: z.union([z.string(), z.array(z.string())]).optional(),
        tasksTags: z.union([z.string(), z.array(z.string())]).optional(),
        tasksParentId: z.string().optional(),
        tasksIncludeDescendants: z.boolean().optional(),
        knowledgeTags: z.union([z.string(), z.array(z.string())]).optional(),
        knowledgeTypes: z.union([z.string(), z.array(z.string())]).optional(),
        knowledgeParentId: z.string().optional(),
        knowledgeIncludeDescendants: z.boolean().optional(),
      },
    },
    async (params: any) => {
      const prj = resolveProject(params?.project);
      const scope = params?.scope || 'both';
      const doTasks = scope === 'both' || scope === 'tasks';
      const doKnowledge = scope === 'both' || scope === 'knowledge';
      const dryRun = !!params?.dryRun;
      const confirm = !!params?.confirm;
      const includeArchived = params?.includeArchived ?? true;

      const tasks = doTasks ? await listTasks({ project: prj, includeArchived, includeTrashed: true }) : [];
      const docs = doKnowledge ? await listDocs({ project: prj, includeArchived, includeTrashed: true }) : [];

      const toArr = (v: any): string[] | undefined => v == null ? undefined : (Array.isArray(v) ? v : [v]).filter(x => typeof x === 'string' && x.trim().length > 0);

      const fTasksStatus = toArr(params?.tasksStatus);
      const fTasksTags = toArr(params?.tasksTags);
      const fTasksParent = (params?.tasksParentId as string | undefined)?.trim();
      const fTasksInclDesc = params?.tasksIncludeDescendants === true;

      const fKTags = toArr(params?.knowledgeTags);
      const fKTypes = toArr(params?.knowledgeTypes);
      const fKParent = (params?.knowledgeParentId as string | undefined)?.trim();
      const fKInclDesc = params?.knowledgeIncludeDescendants === true;

      let filteredTasks = tasks;
      if (fTasksStatus?.length) {
        filteredTasks = filteredTasks.filter((t: any) => fTasksStatus.includes(t.status));
      }
      if (fTasksTags?.length) {
        filteredTasks = filteredTasks.filter((t: any) =>
          t.tags?.some((tag: any) => fTasksTags.includes(tag))
        );
      }
      if (fTasksParent) {
        if (fTasksInclDesc) {
          const descendants = new Set<string>();
          const collectDescendants = (parentId: string) => {
            const children = tasks.filter((t: any) => t.parentId === parentId);
            for (const child of children) {
              descendants.add(child.id);
              collectDescendants(child.id);
            }
          };
          collectDescendants(fTasksParent);
          filteredTasks = filteredTasks.filter((t: any) => 
            t.id === fTasksParent || descendants.has(t.id)
          );
        } else {
          filteredTasks = filteredTasks.filter((t: any) => t.parentId === fTasksParent);
        }
      }
      if (!includeArchived) {
        filteredTasks = filteredTasks.filter((t: any) => !t.archived);
      }

      let filteredDocs = docs;
      if (fKTags?.length) {
        filteredDocs = filteredDocs.filter((d: any) =>
          d.tags?.some((tag: any) => fKTags.includes(tag))
        );
      }
      if (fKTypes?.length) {
        filteredDocs = filteredDocs.filter((d: any) => fKTypes.includes(d.type));
      }
      if (fKParent) {
        if (fKInclDesc) {
          const descendants = new Set<string>();
          const collectDescendants = (parentId: string) => {
            const children = docs.filter((d: any) => d.parentId === parentId);
            for (const child of children) {
              descendants.add(child.id);
              collectDescendants(child.id);
            }
          };
          collectDescendants(fKParent);
          filteredDocs = filteredDocs.filter((d: any) => 
            d.id === fKParent || descendants.has(d.id)
          );
        } else {
          filteredDocs = filteredDocs.filter((d: any) => d.parentId === fKParent);
        }
      }
      if (!includeArchived) {
        filteredDocs = filteredDocs.filter((d: any) => !d.archived);
      }

      const taskIds: string[] = filteredTasks.map((t: any) => t.id);
      const knowledgeIds: string[] = filteredDocs.map((d: any) => d.id);

      if (dryRun) {
        return ok({
          project: prj,
          scope,
          dryRun: true,
          doTasks,
          doKnowledge,
          counts: { tasks: taskIds.length, knowledge: knowledgeIds.length }
        });
      }

      if (confirm !== true) {
        throw new Error('Refusing to proceed: Project purge not confirmed');
      }

      if (doTasks && taskIds.length) {
        for (const batch of chunkArray(taskIds, 100)) {
          for (const id of batch) {
            await deleteTaskPermanent(prj, id);
          }
        }
      }
      if (doKnowledge && knowledgeIds.length) {
        for (const batch of chunkArray(knowledgeIds, 100)) {
          for (const id of batch) {
            await deleteDocPermanent(prj, id);
          }
        }
      }

      return ok({
        project: prj,
        scope,
        dryRun: false,
        doTasks,
        doKnowledge,
        counts: { tasks: taskIds.length, knowledge: knowledgeIds.length }
      });
    }
  );
}
