import { z } from "zod";
import type { ServerContext } from './context.js';
import { DEFAULT_PROJECT, resolveProject } from '../config.js';
import { createTask, listTasks, listTasksTree, getTask, getTaskSubtree, getDirectChildren, updateTask, closeTaskWithCascade, MAX_TASK_DEPTH } from '../storage/tasks.js';
import { ok, err } from '../utils/respond.js';

export function registerTasksTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    "tasks_list",
    {
      title: "List Tasks",
      description: "List tasks with optional filters",
      inputSchema: {
        project: z.string().optional(),
        status: z.enum(["pending", "in_progress", "completed", "closed"]).optional(),
        tag: z.string().optional(),
        includeArchived: z.boolean().default(false).optional(),
      },
    },
    async ({ project, status, tag, includeArchived }) => {
      const prj = resolveProject(project);
      const items = await listTasks({ project: prj, status, tag, includeArchived });
      return ok(items);
    }
  );

  ctx.server.registerTool(
    "tasks_tree",
    {
      title: "List Tasks Tree",
      description: "List tasks as a hierarchical tree (by parentId)",
      inputSchema: {
        project: z.string().optional(),
        status: z.enum(["pending", "in_progress", "completed", "closed"]).optional(),
        tag: z.string().optional(),
        includeArchived: z.boolean().default(false).optional(),
      },
    },
    async ({ project, status, tag, includeArchived }) => {
      const prj = resolveProject(project);
      const items = await listTasksTree({ project: prj, status, tag, includeArchived });
      return ok(items);
    }
  );

  ctx.server.registerTool(
    "tasks_get",
    {
      title: "Get Task",
      description: "Get task by id",
      inputSchema: { project: z.string().default(DEFAULT_PROJECT), id: z.string().min(1) },
    },
    async ({ project, id }) => {
      const prj = resolveProject(project);
      const t = await getTask(prj, id);
      if (!t) {
        return err(`Task not found: ${project}/${id}`);
      }
      return ok(t);
    }
  );

  ctx.server.registerTool(
    "tasks_create",
    {
      title: "Create Task",
      description: `Create a single task. Optionally set parentId to create a subtask. Maximum nesting depth is ${MAX_TASK_DEPTH} levels.`,
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        title: z.string().min(1),
        description: z.string().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        status: z.enum(["pending", "in_progress", "completed", "closed"]).optional(),
        tags: z.array(z.string()).optional(),
        links: z.array(z.string()).optional(),
        parentId: z.string().optional(),
      },
    },
    async ({ project, title, description, priority, status, tags, links, parentId }) => {
      const prj = resolveProject(project);
      try {
        const task = await createTask({
          project: prj,
          title,
          description,
          priority,
          status,
          tags,
          links,
          parentId,
        });
        return ok(task);
      } catch (e: any) {
        return err(`Failed to create task: ${e?.message || String(e)}`);
      }
    }
  );

  ctx.server.registerTool(
    "tasks_update",
    {
      title: "Update Task",
      description: "Update a single task by id. Can change any field except id, project, createdAt. Setting parentId moves the task in the hierarchy (cycle and depth protected). Set parentId to null to detach from parent (make root).",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        id: z.string().min(1),
        title: z.string().optional(),
        description: z.string().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        status: z.enum(["pending", "in_progress", "completed", "closed"]).optional(),
        tags: z.array(z.string()).optional(),
        links: z.array(z.string()).optional(),
        parentId: z.string().nullable().optional(),
      },
    },
    async ({ project, id, ...patch }) => {
      const prj = resolveProject(project);
      try {
        const task = await updateTask(prj, id, patch as any);
        if (!task) {
          return err(`Task not found: ${project}/${id}`);
        }
        return ok(task);
      } catch (e: any) {
        return err(`Failed to update task: ${e?.message || String(e)}`);
      }
    }
  );

  ctx.server.registerTool(
    "tasks_add_subtask",
    {
      title: "Add Subtask",
      description: `Create a subtask under a parent task. Shorthand for tasks_create with parentId. Maximum nesting depth is ${MAX_TASK_DEPTH} levels.`,
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        parentId: z.string().min(1).describe("The parent task ID to attach this subtask to"),
        title: z.string().min(1),
        description: z.string().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        tags: z.array(z.string()).optional(),
        links: z.array(z.string()).optional(),
      },
    },
    async ({ project, parentId, title, description, priority, tags, links }) => {
      const prj = resolveProject(project);
      try {
        const parent = await getTask(prj, parentId);
        if (!parent) {
          return err(`Parent task not found: ${project}/${parentId}`);
        }
        const task = await createTask({
          project: prj,
          title,
          description,
          priority,
          tags,
          links,
          parentId,
        });
        return ok({ parent: { id: parent.id, title: parent.title }, subtask: task });
      } catch (e: any) {
        return err(`Failed to add subtask: ${e?.message || String(e)}`);
      }
    }
  );

  ctx.server.registerTool(
    "tasks_get_subtree",
    {
      title: "Get Task Subtree",
      description: "Get a specific task and all its descendants as a hierarchical tree. Useful for inspecting a branch of the task hierarchy.",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        id: z.string().min(1).describe("Root task ID of the subtree"),
        maxDepth: z.number().int().min(1).max(10).optional().describe("Limit depth of the subtree (default: unlimited, max: 10)"),
      },
    },
    async ({ project, id, maxDepth }) => {
      const prj = resolveProject(project);
      const subtree = await getTaskSubtree(prj, id);
      if (!subtree) {
        return err(`Task not found: ${project}/${id}`);
      }

      if (maxDepth !== undefined && maxDepth > 0) {
        const truncate = (node: any, depth: number): any => {
          if (depth >= maxDepth) {
            const totalChildren = (node as any).children?.length || 0;
            return { ...node, children: [], _truncatedChildren: totalChildren };
          }
          if ((node as any).children?.length) {
            return {
              ...node,
              children: (node as any).children.map((c: any) => truncate(c, depth + 1)),
            };
          }
          return node;
        };
        const truncated = truncate(subtree, 0);
        const countNodes = (n: any): number =>
          1 + ((n as any).children?.reduce((s: number, c: any) => s + countNodes(c), 0) || 0);
        return ok({ ...truncated, _totalNodes: countNodes(subtree) });
      }

      return ok(subtree);
    }
  );

  ctx.server.registerTool(
    "tasks_get_children",
    {
      title: "Get Task Children",
      description: "Get direct children of a task (one level deep, not recursive).",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        id: z.string().min(1).describe("Parent task ID"),
      },
    },
    async ({ project, id }) => {
      const prj = resolveProject(project);
      const parent = await getTask(prj, id);
      if (!parent) {
        return err(`Task not found: ${project}/${id}`);
      }
      const children = await getDirectChildren(prj, id);
      return ok({ parent: { id: parent.id, title: parent.title }, children });
    }
  );

  ctx.server.registerTool(
    "tasks_close",
    {
      title: "Close Task",
      description: "Close a task by setting its status to 'closed'. Optionally cascade the close to all descendants (subtasks, sub-subtasks, etc.).",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        id: z.string().min(1),
        cascade: z.boolean().default(false).optional().describe("If true, also close all descendant tasks"),
      },
    },
    async ({ project, id, cascade }) => {
      const prj = resolveProject(project);
      try {
        const result = await closeTaskWithCascade(prj, id, cascade || false);
        if (!result.root) {
          return err(`Task not found: ${project}/${id}`);
        }
        return ok({
          closed: result.root,
          cascadeCount: result.cascaded.length,
          cascaded: result.cascaded.length > 0 ? result.cascaded : undefined,
        });
      } catch (e: any) {
        return err(`Failed to close task: ${e?.message || String(e)}`);
      }
    }
  );
}
