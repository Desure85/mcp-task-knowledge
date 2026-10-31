import { z } from "zod";
import type { ServerContext } from './context.js';
import { resolveProject } from '../config.js';
import {
  createTask,
  listTasks,
  listTasksTree,
  getTask,
  getTaskSubtree,
  getDirectChildren,
  updateTask,
  closeTaskWithCascade,
  claimTask,
  renewTaskClaim,
  releaseTaskClaim,
  DEFAULT_CLAIM_TTL_SEC,
  MIN_CLAIM_TTL_SEC,
  MAX_CLAIM_TTL_SEC,
  MAX_TASK_DEPTH,
  type ClaimActor,
} from '../storage/tasks.js';
import { ok, err, errWith } from '../utils/respond.js';
import { resolveExtraSessionId, type GateExtra } from '../core/auth-gate.js';
import { WorkflowError, assertStatusAllowed, assertTypeAllowed, loadProjectTypes, loadProjectWorkflow } from '../workflow.js';
import { currentSessionId } from '../core/request-context.js';

/** Resolve the claiming identity: SDK session > ALS request scope > local. */
function resolveClaimActor(
  ctx: ServerContext,
  args: { client?: string; ttlSec?: number },
  extra?: GateExtra,
): ClaimActor {
  const sessionId = resolveExtraSessionId(extra) ?? currentSessionId() ?? 'local';
  const meta = ctx.sessionManager?.get(sessionId)?.metadata ?? {};
  const userId = typeof meta.userId === 'string' ? meta.userId : undefined;
  const metaClient = typeof meta.client === 'string' ? meta.client : undefined;
  const client = args.client ?? metaClient;
  return {
    sessionId,
    ...(userId ? { userId } : {}),
    ...(client ? { client } : {}),
    ttlSec: args.ttlSec,
  };
}

export function registerTasksTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    "tasks_list",
    {
      title: "List Tasks",
      description: "List tasks with optional filters. Includes the active claim/lease holder when a task is claimed.",
      inputSchema: {
        project: z.string().optional(),
        status: z.string().min(1).optional(),
        type: z.string().min(1).optional(),
        tag: z.string().optional(),
        includeArchived: z.boolean().default(false).optional(),
      },
    },
    async ({ project, status, type, tag, includeArchived }) => {
      const prj = resolveProject(project);
      try {
        if (status) assertStatusAllowed(await loadProjectWorkflow(prj), status);
        if (type) assertTypeAllowed((await loadProjectTypes(prj)).types, type);
        const items = await listTasks({ project: prj, status, type, tag, includeArchived });
        return ok(items);
      } catch (e) {
        if (e instanceof WorkflowError) return errWith(e.toPayload());
        throw e;
      }
    }
  );

  ctx.server.registerTool(
    "tasks_tree",
    {
      title: "List Tasks Tree",
      description: "List tasks as a hierarchical tree (by parentId)",
      inputSchema: {
        project: z.string().optional(),
        status: z.string().min(1).optional(),
        type: z.string().min(1).optional(),
        tag: z.string().optional(),
        includeArchived: z.boolean().default(false).optional(),
      },
    },
    async ({ project, status, type, tag, includeArchived }) => {
      const prj = resolveProject(project);
      try {
        if (status) assertStatusAllowed(await loadProjectWorkflow(prj), status);
        if (type) assertTypeAllowed((await loadProjectTypes(prj)).types, type);
        const items = await listTasksTree({ project: prj, status, type, tag, includeArchived });
        return ok(items);
      } catch (e) {
        if (e instanceof WorkflowError) return errWith(e.toPayload());
        throw e;
      }
    }
  );

  ctx.server.registerTool(
    "tasks_get",
    {
      title: "Get Task",
      description: "Get task by id. Includes the active claim/lease holder when the task is claimed.",
      inputSchema: { project: z.string().optional(), id: z.string().min(1) },
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
        project: z.string().optional(),
        title: z.string().min(1),
        description: z.string().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        status: z.string().min(1).optional(),
        type: z.string().min(1).optional(),
        tags: z.array(z.string()).optional(),
        links: z.array(z.string()).optional(),
        parentId: z.string().optional(),
        dependsOn: z.array(z.string()).optional().describe("Dependency task IDs (DAG edges, cycle-protected)"),
      },
    },
    async ({ project, title, description, priority, status, type, tags, links, parentId }) => {
      const prj = resolveProject(project);
      try {
        const workflow = await loadProjectWorkflow(prj);
        if (status) assertStatusAllowed(workflow, status, { initial: true });
        const task = await createTask({
          project: prj,
          title,
          description,
          priority,
          status,
          type,
          tags,
          links,
          parentId,
        });
        return ok(task);
      } catch (e: any) {
        if (e instanceof WorkflowError) return errWith(e.toPayload());
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
        project: z.string().optional(),
        id: z.string().min(1),
        title: z.string().optional(),
        description: z.string().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        status: z.string().min(1).optional(),
        type: z.string().min(1).optional(),
        tags: z.array(z.string()).optional(),
        links: z.array(z.string()).optional(),
        parentId: z.string().nullable().optional(),
        dependsOn: z.array(z.string()).optional().describe("Dependency task IDs (DAG edges, cycle-protected)"),
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
        if (e instanceof WorkflowError) return errWith(e.toPayload());
        return err(`Failed to update task: ${e?.message || String(e)}`);
      }
    }
  );

  ctx.server.registerTool(
    "tasks_claim",
    {
      title: "Claim Task",
      description:
        "Take a lease on a task so a second agent does not start the same work. " +
        "The holder is visible to others (bySessionId/byUserId/client/expiresAt). " +
        "Re-claiming your own task renews the lease; a foreign active claim is rejected with code TASK_CLAIMED. " +
        "Expired claims never block. Renewals do not change the task content revision (updatedAt/version).",
      inputSchema: {
        project: z.string().optional(),
        id: z.string().min(1),
        ttlSec: z.number().int().min(MIN_CLAIM_TTL_SEC).max(MAX_CLAIM_TTL_SEC)
          .default(DEFAULT_CLAIM_TTL_SEC).optional()
          .describe(`Lease length in seconds (${MIN_CLAIM_TTL_SEC}-${MAX_CLAIM_TTL_SEC}, default ${DEFAULT_CLAIM_TTL_SEC})`),
        client: z.string().optional().describe('Client label for the holder (e.g. "claude-code", "opencode")'),
      },
    },
    async ({ project, id, ttlSec, client }, extra?: GateExtra) => {
      const prj = resolveProject(project);
      try {
        const result = await claimTask(prj, id, resolveClaimActor(ctx, { ttlSec, client }, extra));
        if (result.status === 'not_found') {
          return err(`Task not found: ${project}/${id}`);
        }
        if (result.status === 'claimed_by_other') {
          return errWith({
            code: 'TASK_CLAIMED',
            message: 'task is already claimed by another session',
            hint: 'wait until expiresAt, ask the holder to release it, or call tasks_renew if you are the holder',
            details: { holder: result.claim, expiresAt: result.claim.expiresAt },
          });
        }
        return ok({ taskId: id, status: result.status, claim: result.claim, renewed: result.status === 'renewed' });
      } catch (e: any) {
        return err(`Failed to claim task: ${e?.message || String(e)}`);
      }
    }
  );

  ctx.server.registerTool(
    "tasks_renew",
    {
      title: "Renew Task Claim",
      description:
        "Extend your lease on a claimed task (heartbeat). Only the current holder may renew. " +
        "Renewals do not change updatedAt/version, so they never invalidate another client's optimistic lock. " +
        "Returns TASK_NOT_CLAIMED when the lease is absent or has expired, TASK_CLAIMED when held by someone else.",
      inputSchema: {
        project: z.string().optional(),
        id: z.string().min(1),
        ttlSec: z.number().int().min(MIN_CLAIM_TTL_SEC).max(MAX_CLAIM_TTL_SEC)
          .default(DEFAULT_CLAIM_TTL_SEC).optional()
          .describe(`New lease length in seconds (${MIN_CLAIM_TTL_SEC}-${MAX_CLAIM_TTL_SEC}, default ${DEFAULT_CLAIM_TTL_SEC})`),
      },
    },
    async ({ project, id, ttlSec }, extra?: GateExtra) => {
      const prj = resolveProject(project);
      try {
        const result = await renewTaskClaim(prj, id, resolveClaimActor(ctx, { ttlSec }, extra));
        if (result.status === 'not_found') {
          return err(`Task not found: ${project}/${id}`);
        }
        if (result.status === 'not_claimed') {
          return errWith({
            code: 'TASK_NOT_CLAIMED',
            message: 'no active claim on this task',
            hint: 'call tasks_claim first (your lease may have expired)',
          });
        }
        if (result.status === 'claimed_by_other') {
          return errWith({
            code: 'TASK_CLAIMED',
            message: 'task is claimed by another session',
            hint: 'only the current holder can renew; wait until expiresAt or claim after it expires',
            details: { holder: result.claim, expiresAt: result.claim.expiresAt },
          });
        }
        return ok({ taskId: id, status: result.status, claim: result.claim, renewed: true });
      } catch (e: any) {
        return err(`Failed to renew claim: ${e?.message || String(e)}`);
      }
    }
  );

  ctx.server.registerTool(
    "tasks_release",
    {
      title: "Release Task Claim",
      description:
        "Release your lease so another agent can pick the task up. Only the holder may release before expiry; " +
        "an expired claim is cleaned up by anyone. Releasing a free task is idempotent (released:false, alreadyFree:true).",
      inputSchema: {
        project: z.string().optional(),
        id: z.string().min(1),
      },
    },
    async ({ project, id }, extra?: GateExtra) => {
      const prj = resolveProject(project);
      try {
        const result = await releaseTaskClaim(prj, id, resolveClaimActor(ctx, {}, extra));
        if (result.status === 'not_found') {
          return err(`Task not found: ${project}/${id}`);
        }
        if (result.status === 'claimed_by_other') {
          return errWith({
            code: 'TASK_CLAIMED',
            message: 'task is claimed by another session',
            hint: 'only the holder can release before expiresAt; wait for expiry or ask them to release',
            details: { holder: result.claim, expiresAt: result.claim.expiresAt },
          });
        }
        if (result.status === 'not_claimed') {
          return ok({ taskId: id, released: false, alreadyFree: true });
        }
        return ok({ taskId: id, released: true });
      } catch (e: any) {
        return err(`Failed to release claim: ${e?.message || String(e)}`);
      }
    }
  );

  ctx.server.registerTool(
    "tasks_add_subtask",
    {
      title: "Add Subtask",
      description: `Create a subtask under a parent task. Shorthand for tasks_create with parentId. Maximum nesting depth is ${MAX_TASK_DEPTH} levels.`,
      inputSchema: {
        project: z.string().optional(),
        parentId: z.string().min(1).describe("The parent task ID to attach this subtask to"),
        title: z.string().min(1),
        description: z.string().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        type: z.string().min(1).optional(),
        tags: z.array(z.string()).optional(),
        links: z.array(z.string()).optional(),
      },
    },
    async ({ project, parentId, title, description, priority, type, tags, links }) => {
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
          type,
          tags,
          links,
          parentId,
        });
        return ok({ parent: { id: parent.id, title: parent.title }, subtask: task });
      } catch (e: any) {
        if (e instanceof WorkflowError) return errWith(e.toPayload());
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
        project: z.string().optional(),
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
        project: z.string().optional(),
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
      description: "Close a task by moving it to the project's close status. Optionally cascade the close to all descendants (subtasks, sub-subtasks, etc.).",
      inputSchema: {
        project: z.string().optional(),
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
        if (e instanceof WorkflowError) return errWith(e.toPayload());
        return err(`Failed to close task: ${e?.message || String(e)}`);
      }
    }
  );
}
