import { randomUUID } from 'node:crypto';
import { z } from 'zod/v3';
import type { ServerContext } from './context.js';
import { storageProfile } from '../core/storage-context.js';
import { resolveProject } from '../config.js';
import { ok, errWith } from '../utils/respond.js';
import { resolveExtraSessionId, type GateExtra } from '../core/auth-gate.js';
import { currentSessionId } from '../core/request-context.js';
import { assertTransition, loadProjectWorkflow, WorkflowError } from '../workflow.js';
import {
  buildWorkItem,
  filterToIds,
  hasPredicate,
  parseTaskCommand,
  TaskCommandError,
  totalMinutes,
  type TaskCommandFilter,
} from '../commands/task-command.js';
import type { Task } from '../types.js';

const MAX_COMMAND_TASKS = 50;

function taskStore(ctx: ServerContext) {
  return storageProfile(ctx).tasks;
}

function userIdOf(ctx: ServerContext, extra: GateExtra | undefined): string | undefined {
  const sessionId = resolveExtraSessionId(extra) ?? currentSessionId() ?? 'local';
  const meta = ctx.sessionManager?.get(sessionId)?.metadata ?? {};
  return typeof meta.userId === 'string' && meta.userId ? meta.userId : undefined;
}

function commandError(e: TaskCommandError) {
  return errWith({ code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) });
}

export function registerTaskCommandTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    'tasks_command',
    {
      title: 'Task Command',
      description:
        'Apply a YouTrack-style command to matching tasks. v1 supports only "State <status>" and ' +
        '"for me State <status>". Dry-run by default; confirm:true applies. Max 50 tasks.',
      inputSchema: {
        command: z.string().min(1).max(120).describe('State <status> | for me State <status>'),
        project: z.string().optional(),
        filter: z
          .object({
            ids: z.array(z.string()).max(MAX_COMMAND_TASKS).optional(),
            assignee: z.string().optional(),
            status: z.string().optional(),
            tag: z.string().optional(),
            priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
          })
          .optional()
          .describe('At least one predicate is required (ids/assignee/status/tag/priority)'),
        dryRun: z.boolean().optional().describe('Preview only; default true'),
        confirm: z.boolean().optional().describe('Required with dryRun:false'),
        expectedVersion: z.number().int().positive().optional().describe('Per-task CAS; any mismatch fails that task'),
      },
    },
    async (args, extra: GateExtra) => {
      let parsed;
      try {
        parsed = parseTaskCommand(args.command);
      } catch (e) {
        if (e instanceof TaskCommandError) return commandError(e);
        throw e;
      }

      const prj = resolveProject(args.project);
      const me = userIdOf(ctx, extra);
      const filter: TaskCommandFilter = { ...(args.filter ?? {}) };
      if (parsed.forMe) {
        if (!me) {
          return errWith({
            code: 'COMMAND_IDENTITY_REQUIRED',
            message: '"for me" needs an authenticated user id on this session',
            hint: 'Authenticate the session, or use an explicit filter.assignee',
          });
        }
        if (filter.assignee && filter.assignee !== me) {
          return commandError(new TaskCommandError('COMMAND_SYNTAX', '"for me" conflicts with filter.assignee'));
        }
        filter.assignee = me;
      }
      if (!hasPredicate(filter)) {
        return commandError(new TaskCommandError('COMMAND_SYNTAX', 'filter needs at least one predicate'));
      }

      const workflow = await loadProjectWorkflow(prj);
      const target = workflow.statuses.find(
        (s) => s.id === parsed.statusToken || s.label.toLowerCase() === parsed.statusToken.toLowerCase(),
      );
      if (!target || target.archived) {
        return errWith({
          code: 'COMMAND_SYNTAX',
          message: `unknown or archived status '${parsed.statusToken}'`,
          hint: `statuses: ${workflow.statuses.filter((s) => !s.archived).map((s) => s.id).join(', ')}`,
        });
      }

      const store = taskStore(ctx);
      const all = await store.list({ project: prj, includeArchived: false, includeTrashed: false });
      const matched = filterToIds(all, filter);
      if (matched.length > MAX_COMMAND_TASKS) {
        return errWith({
          code: 'COMMAND_TOO_MANY',
          message: `command matches ${matched.length} tasks; limit is ${MAX_COMMAND_TASKS}`,
          hint: 'Narrow the filter or pass explicit ids',
        });
      }

      const planned = matched.map((task: Task) => {
        if (task.status === target.id) {
          return { id: task.id, from: task.status, to: target.id, allowed: true, noop: true };
        }
        try {
          assertTransition(workflow, task.status, target.id);
          return { id: task.id, from: task.status, to: target.id, allowed: true };
        } catch (e) {
          if (e instanceof WorkflowError) {
            return { id: task.id, from: task.status, to: target.id, allowed: false, reason: e.message };
          }
          throw e;
        }
      });

      const preview = {
        command: args.command,
        dryRun: args.dryRun !== false,
        project: prj,
        targetStatus: target.id,
        matched: matched.length,
        planned,
      };

      if (args.dryRun !== false) return ok(preview);
      if (args.confirm !== true) {
        return errWith({
          code: 'COMMAND_CONFIRM_REQUIRED',
          message: 'applying a command requires confirm:true and dryRun:false',
          hint: 'Run with dryRun:true first, then repeat with confirm:true',
        });
      }

      const applied: Array<{ id: string; from: string; to: string }> = [];
      const failed: Array<{ id: string; error: string; code?: string }> = [];
      for (const item of planned) {
        if (!item.allowed) {
          failed.push({ id: item.id, error: item.reason ?? 'transition not allowed', code: 'TRANSITION_NOT_ALLOWED' });
          continue;
        }
        if (item.noop) continue;
        try {
          await store.update(prj, item.id, { status: target.id }, args.expectedVersion);
          applied.push({ id: item.id, from: item.from, to: target.id });
        } catch (e) {
          failed.push({
            id: item.id,
            error: e instanceof Error ? e.message : String(e),
            ...(typeof (e as { code?: unknown }).code === 'string' ? { code: (e as { code: string }).code } : {}),
          });
        }
      }

      return ok({ ...preview, dryRun: false, applied, failed });
    },
  );

  ctx.server.registerTool(
    'tasks_worklog_add',
    {
      title: 'Add Task Work Item',
      description: 'Log effort on a task. Duration is integer minutes (1..1440); appended to workItems.',
      inputSchema: {
        id: z.string().min(1),
        project: z.string().optional(),
        durationMin: z.number().int().min(1).max(1440),
        startedAt: z.string().datetime().optional(),
        description: z.string().max(500).optional(),
        expectedVersion: z.number().int().positive().optional(),
      },
    },
    async (args, extra: GateExtra) => {
      const prj = resolveProject(args.project);
      const store = taskStore(ctx);
      const task = await store.get(prj, args.id);
      if (!task) return errWith({ code: 'TASK_NOT_FOUND', message: `task '${args.id}' not found in project '${prj}'` });
      const item = buildWorkItem({
        id: randomUUID(),
        userId: userIdOf(ctx, extra),
        durationMin: args.durationMin,
        startedAt: args.startedAt,
        description: args.description,
      });
      const workItems = [...(task.workItems ?? []), item];
      await store.update(prj, args.id, { workItems }, args.expectedVersion);
      return ok({ taskId: args.id, item, totalMinutes: totalMinutes(workItems) });
    },
  );

  ctx.server.registerTool(
    'tasks_worklog_list',
    {
      title: 'List Task Work Items',
      description: 'List logged work items for a task and their total minutes.',
      inputSchema: { id: z.string().min(1), project: z.string().optional() },
    },
    async (args) => {
      const prj = resolveProject(args.project);
      const task = await taskStore(ctx).get(prj, args.id);
      if (!task) return errWith({ code: 'TASK_NOT_FOUND', message: `task '${args.id}' not found in project '${prj}'` });
      const items = [...(task.workItems ?? [])].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      return ok({ taskId: args.id, items, totalMinutes: totalMinutes(items) });
    },
  );
}
