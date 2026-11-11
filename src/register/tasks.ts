import { z } from "zod/v3";
import type { ServerContext } from './context.js';
import { storageProfile } from '../core/storage-context.js';
import { resolveProject } from '../config.js';
import { computeGraphMetrics, withGraphMetrics } from '../core/graph-metrics.js';
import {
  DEFAULT_CLAIM_TTL_SEC,
  MAX_TASK_DEPTH,
  MAX_CLAIM_TTL_SEC,
  MIN_CLAIM_TTL_SEC,
  type ClaimActor,
} from '../storage/contracts.js';
import { ok, okWith, err, errWith } from '../utils/respond.js';
import { PaginationError, paginateKeyed } from '../utils/pagination.js';
import { pageArgsSchema, pageFromStorage, toPageRequest } from './page-args.js';
import { projectTask, writeResponseArgs } from './write-response.js';
import { resolveExtraSessionId, type GateExtra } from '../core/auth-gate.js';
import { WorkflowError, assertStatusAllowed, assertTypeAllowed, loadProjectTypes, loadProjectWorkflow } from '../workflow.js';
import { currentSessionId } from '../core/request-context.js';
import { readProjectMetadata } from '../projects.js';

/**
 * Y-02e2: storage comes from the context. A context without a profile is a wiring bug — say so
 * instead of silently falling back to a module import (which would defeat the whole point).
 */
function taskStore(ctx: ServerContext) {
  return storageProfile(ctx).tasks;
}

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

const taskEvidenceSchema = z
  .object({
    commitSha: z.string().regex(/^[0-9a-f]{7,40}$/).optional(),
    ciUrl: z.string().url().refine((url) => url.startsWith('https://'), 'ciUrl must use https').optional(),
    checkOutput: z.string().max(4096).optional(),
    note: z.string().max(4096).optional(),
  })
  .refine((value) => Boolean(value.commitSha || value.ciUrl || value.checkOutput), {
    message: 'pass commitSha, ciUrl or checkOutput',
  });

export function registerTasksTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    "tasks_list",
    {
      title: "List Tasks",
      description:
        "List tasks with optional filters, cursor pagination and field selection. " +
        "Returns `data` (array) plus total/count/hasMore/nextCursor/truncated/limit. " +
        "Includes the active claim/lease holder when a task is claimed.",
      inputSchema: {
        project: z.string().optional(),
        status: z.string().min(1).optional(),
        type: z.string().min(1).optional(),
        tag: z.string().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        parentId: z.string().min(1).optional().describe("Only direct children of this task"),
        updatedSince: z.string().min(1).optional().describe("ISO date; only tasks updated at or after it"),
        ids: z.array(z.string().min(1)).max(500).optional().describe("Return exactly these task ids (batch lookup)"),
        codes: z
          .array(z.string().min(1))
          .max(500)
          .optional()
          .describe("Backlog codes recorded as task tags (case-insensitive), e.g. [\"AC-01\"]"),
        includeArchived: z.boolean().default(false).optional(),
        includeGraphMetrics: z.boolean().optional().describe('Add onCriticalPath and transitive dependentsCount to each returned task'),
        groupByStatus: z.boolean().optional().describe('Return per-status columns with exact totals (board payload)'),
        offsets: z.record(z.string(), z.number().int().min(0)).optional().describe('Per-status offsets for groupByStatus'),
        ...pageArgsSchema,
      },
    },
    async ({ project, status, type, tag, priority, parentId, updatedSince, includeArchived, ids, codes, includeGraphMetrics, groupByStatus, offsets, ...pageArgs }) => {
      const prj = resolveProject(project);
      try {
        if (status) assertStatusAllowed(await loadProjectWorkflow(prj), status);
        if (type) assertTypeAllowed((await loadProjectTypes(prj)).types, type);
        if (groupByStatus) {
          const all = await taskStore(ctx).list({ project: prj, includeArchived });
          const filtered = all.filter(
            (task) =>
              !task.trashed &&
              (!priority || task.priority === priority) &&
              (!tag || (task.tags ?? []).includes(tag)) &&
              (!type || (task.type ?? "task") === type),
          );
          const groups = new Map<string, typeof filtered>();
          for (const task of filtered) {
            const list = groups.get(task.status) ?? [];
            list.push(task);
            groups.set(task.status, list);
          }
          const typeCounts: Record<string, number> = {};
          for (const task of filtered) {
            const id = task.type ?? "task";
            typeCounts[id] = (typeCounts[id] ?? 0) + 1;
          }
          const ci = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
          const pageSize = Math.min(Math.max(pageArgs.limit ?? 25, 1), 100);
          const columns = [...groups.entries()].map(([statusId, items]) => {
            const sorted = [...items].sort((a, b) => ci(b.updatedAt, a.updatedAt) || ci(a.id, b.id));
            const offset = Math.max(0, offsets?.[statusId] ?? 0);
            const end = Math.min(sorted.length, offset + pageSize);
            return {
              status: statusId,
              total: sorted.length,
              items: sorted.slice(offset, end),
              nextOffset: end < sorted.length ? end : null,
            };
          });
          return ok({ total: filtered.length, typeCounts, columns });
        }
        const request = toPageRequest(pageArgs);
        if (ids !== undefined || codes !== undefined) {
          // AC-03: batch lookup by id (O(k) reads) or by backlog code. A code is matched
          // case-insensitively against the task's tags — that is where the tracker keeps
          // backlog ids (`AC-01`, `SC-02`), the Task model has no separate `code` field.
          const wantedIds = new Set(ids ?? []);
          const wantedCodes = new Set((codes ?? []).map((code) => code.toLowerCase()));
          const picked = new Map<string, NonNullable<Awaited<ReturnType<ReturnType<typeof taskStore>['get']>>>>();
          for (const id of wantedIds) {
            const task = await taskStore(ctx).get(prj, id);
            if (task) picked.set(task.id, task);
          }
          if (wantedCodes.size > 0) {
            for (const task of await taskStore(ctx).list({ project: prj, includeArchived })) {
              if (picked.has(task.id)) continue;
              if ((task.tags ?? []).some((value) => wantedCodes.has(value.toLowerCase()))) picked.set(task.id, task);
            }
          }
          const matched = [...picked.values()]
            .filter((task) => (includeArchived === true || !task.archived) && !task.trashed)
            .sort((a, b) => (a.updatedAt === b.updatedAt ? (a.id < b.id ? -1 : 1) : a.updatedAt < b.updatedAt ? 1 : -1));
          const pickedPage = paginateKeyed(matched, request, (task) => task.updatedAt, (task) => task.id);
          if (!includeGraphMetrics) return okWith(pickedPage.items, pickedPage.meta);
          const all = await taskStore(ctx).list({ project: prj, includeArchived });
          return okWith(withGraphMetrics(pickedPage.items, computeGraphMetrics(all)), pickedPage.meta);
        }
        const page = await taskStore(ctx).page(prj, {
          limit: request.limit ?? 50,
          cursor: request.cursor,
          status,
          type,
          tag,
          priority,
          parentId,
          updatedSince,
          includeArchived,
          countOnly: request.countOnly,
        });
        const result = pageFromStorage(page, request, (t) => t.id);
        if (!includeGraphMetrics) return okWith(result.items, result.meta);
        const all = await taskStore(ctx).list({ project: prj, includeArchived });
        return okWith(withGraphMetrics(result.items, computeGraphMetrics(all)), result.meta);
      } catch (e) {
        if (e instanceof PaginationError) return errWith({ message: e.message, code: e.code, hint: e.hint });
        if (e instanceof WorkflowError) return errWith(e.toPayload());
        throw e;
      }
    }
  );

  ctx.server.registerTool(
    "tasks_tree",
    {
      title: "List Tasks Tree",
      description:
        "List tasks as a hierarchical tree (by parentId). Pagination applies to ROOT nodes " +
        "(children of a returned root are always included).",
      inputSchema: {
        project: z.string().optional(),
        status: z.string().min(1).optional(),
        type: z.string().min(1).optional(),
        tag: z.string().optional(),
        includeArchived: z.boolean().default(false).optional(),
        ...pageArgsSchema,
      },
    },
    async ({ project, status, type, tag, includeArchived, ...pageArgs }) => {
      const prj = resolveProject(project);
      try {
        if (status) assertStatusAllowed(await loadProjectWorkflow(prj), status);
        if (type) assertTypeAllowed((await loadProjectTypes(prj)).types, type);
        const request = toPageRequest(pageArgs);
        const roots = await taskStore(ctx).tree({ project: prj, status, type, tag, includeArchived });
        const result = paginateKeyed(roots, request, (n) => n.updatedAt || '', (n) => n.id);
        return okWith(result.items, result.meta);
      } catch (e) {
        if (e instanceof PaginationError) return errWith({ message: e.message, code: e.code, hint: e.hint });
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
      inputSchema: {
        project: z.string().optional(),
        id: z.string().min(1),
        includeGraphMetrics: z.boolean().optional().describe('Add onCriticalPath and transitive dependentsCount'),
      },
    },
    async ({ project, id, includeGraphMetrics }) => {
      const prj = resolveProject(project);
      const t = await taskStore(ctx).get(prj, id);
      if (!t) {
        return err(`Task not found: ${project}/${id}`);
      }
      if (!includeGraphMetrics) return ok(t);
      const all = await taskStore(ctx).list({ project: prj, includeArchived: true });
      return ok(withGraphMetrics([t], computeGraphMetrics(all))[0]);
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
        ...writeResponseArgs,
      },
    },
    async ({ project, title, description, priority, status, type, tags, links, parentId, fields, compact }) => {
      const prj = resolveProject(project);
      try {
        const workflow = await loadProjectWorkflow(prj);
        if (status) assertStatusAllowed(workflow, status, { initial: true });
        const task = await taskStore(ctx).create({
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
        return ok(projectTask(task, { fields, compact }));
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
        ...writeResponseArgs,
      },
    },
    async ({ project, id, fields, compact, ...patch }) => {
      const prj = resolveProject(project);
      try {
        const task = await taskStore(ctx).update(prj, id, patch as any);
        if (!task) {
          return err(`Task not found: ${project}/${id}`);
        }
        return ok(projectTask(task, { fields, compact }));
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
        const result = await taskStore(ctx).claim(prj, id, resolveClaimActor(ctx, { ttlSec, client }, extra));
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
        const result = await taskStore(ctx).renewClaim(prj, id, resolveClaimActor(ctx, { ttlSec }, extra));
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
        const result = await taskStore(ctx).releaseClaim(prj, id, resolveClaimActor(ctx, {}, extra));
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
        const parent = await taskStore(ctx).get(prj, parentId);
        if (!parent) {
          return err(`Parent task not found: ${project}/${parentId}`);
        }
        const task = await taskStore(ctx).create({
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
      const subtree = await taskStore(ctx).subtree(prj, id);
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
        ...pageArgsSchema,
      },
    },
    async ({ project, id, ...pageArgs }) => {
      const prj = resolveProject(project);
      const parent = await taskStore(ctx).get(prj, id);
      if (!parent) {
        return err(`Task not found: ${project}/${id}`);
      }
      try {
        const request = toPageRequest(pageArgs);
        const children = await taskStore(ctx).children(prj, id);
        const result = paginateKeyed(children, request, (t) => t.updatedAt || '', (t) => t.id);
        return okWith(
          { parent: { id: parent.id, title: parent.title }, children: result.items },
          result.meta,
        );
      } catch (e) {
        if (e instanceof PaginationError) return errWith({ message: e.message, code: e.code, hint: e.hint });
        throw e;
      }
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
        evidence: taskEvidenceSchema.optional(),
      },
    },
    async ({ project, id, cascade, evidence }) => {
      const prj = resolveProject(project);
      if (evidence) {
        const parsed = taskEvidenceSchema.safeParse(evidence);
        if (!parsed.success) {
          return errWith({
            code: 'EVIDENCE_INVALID',
            message: parsed.error.issues[0]?.message ?? 'invalid evidence',
            hint: 'pass commitSha, ciUrl or checkOutput',
          });
        }
      }
      const meta = await readProjectMetadata(prj);
      if (meta?.requireEvidence && !evidence) {
        return errWith({
          code: 'EVIDENCE_REQUIRED',
          message: 'Closing this project requires evidence',
          hint: 'pass commitSha, ciUrl or checkOutput',
        });
      }
      const evidenceRecord = evidence
        ? { ...evidence, at: new Date().toISOString(), bySessionId: currentSessionId() ?? undefined }
        : undefined;
      try {
        if (evidenceRecord) {
          const updated = await taskStore(ctx).update(prj, id, { evidence: evidenceRecord });
          if (!updated) return err(`Task not found: ${project}/${id}`);
        }
        const result = await taskStore(ctx).closeWithCascade(prj, id, cascade || false);
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
