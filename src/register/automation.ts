/** T-06 tools: task templates, recurring definitions, bidirectional doc links. */
import { z } from 'zod/v3';
import { DATA_DIR, resolveProject } from '../config.js';
import { storageProfile } from '../core/storage-context.js';
import { ok, err, errWith } from '../utils/respond.js';
import { deleteRecurring, deleteTemplate, nextOccurrence, readRecurring, readTemplates, saveRecurring, saveTemplate, tickRecurring, type Schedule } from '../automation/tasks.js';
import type { ServerContext } from './context.js';

const scheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily'), time: z.string().optional() }),
  z.object({ kind: z.literal('weekly'), dayOfWeek: z.number().int().min(0).max(6), time: z.string().optional() }),
  z.object({ kind: z.literal('monthly'), dayOfMonth: z.number().int().min(1).max(28), time: z.string().optional() }),
]);

function taskStore(ctx: ServerContext) { return storageProfile(ctx).tasks; }
function docStore(ctx: ServerContext) { return storageProfile(ctx).docs; }

export function registerAutomationTools(ctx: ServerContext): void {
  ctx.server.registerTool('tasks_template_list', { title: 'Task Templates', description: 'List task templates.', inputSchema: {} },
    async () => ok({ templates: await readTemplates(DATA_DIR) }));

  ctx.server.registerTool('tasks_template_save', {
    title: 'Save Task Template',
    description: 'Create or replace a task template with default fields (priority/type/tags/description/links).',
    inputSchema: {
      id: z.string().min(1).max(64), name: z.string().min(1).max(120),
      defaults: z.object({
        description: z.string().optional(), priority: z.enum(['high', 'medium', 'low']).optional(),
        type: z.string().optional(), tags: z.array(z.string()).optional(), links: z.array(z.string()).optional(),
      }),
    },
  }, async (input: { id: string; name: string; defaults: Record<string, unknown> }) => {
    try { return ok(await saveTemplate(DATA_DIR, input as never)); } catch (e) { return errWith({ message: (e as Error).message, code: 'TEMPLATE_INVALID' }); }
  });

  ctx.server.registerTool('tasks_template_delete', { title: 'Delete Task Template', description: 'Delete a template by id.', inputSchema: { id: z.string().min(1) } },
    async ({ id }: { id: string }) => (await deleteTemplate(DATA_DIR, id)) ? ok({ id, deleted: true }) : err(`template not found: ${id}`));

  ctx.server.registerTool('tasks_recurring_list', { title: 'Recurring Tasks', description: 'List recurring definitions and next run.', inputSchema: {} },
    async () => ok({ recurring: await readRecurring(DATA_DIR) }));

  ctx.server.registerTool('tasks_recurring_save', {
    title: 'Save Recurring Task',
    description: 'Create or replace a recurring definition (daily/weekly/monthly, UTC time, optional templateId).',
    inputSchema: {
      id: z.string().min(1).max(64), project: z.string().optional(), title: z.string().min(1),
      templateId: z.string().optional(), schedule: scheduleSchema,
      nextAt: z.string().optional(),
    },
  }, async (input: { id: string; project?: string; title: string; templateId?: string; schedule: Schedule; nextAt?: string }) => {
    const prj = resolveProject(input.project);
    try {
      const tpls = await readTemplates(DATA_DIR);
      if (input.templateId && !tpls.some((t) => t.id === input.templateId)) return err(`template not found: ${input.templateId}`);
      const out = await saveRecurring(DATA_DIR, { ...input, project: prj, schedule: input.schedule });
      return ok({ ...out, nextAtPreview: nextOccurrence(input.schedule, new Date()).toISOString() });
    } catch (e) { return errWith({ message: (e as Error).message, code: 'RECURRING_INVALID' }); }
  });

  ctx.server.registerTool('tasks_recurring_delete', { title: 'Delete Recurring Task', description: 'Delete a recurring definition.', inputSchema: { id: z.string().min(1) } },
    async ({ id }: { id: string }) => (await deleteRecurring(DATA_DIR, id)) ? ok({ id, deleted: true }) : err(`recurring not found: ${id}`));

  ctx.server.registerTool('tasks_recurring_tick', {
    title: 'Tick Recurring Tasks',
    description: 'Create due instances exactly once per occurrence (idempotent across restarts). Safe to call repeatedly.',
    inputSchema: { now: z.string().optional() },
  }, async ({ now }: { now?: string }) => {
    const at = now ? new Date(now) : new Date();
    if (Number.isNaN(at.getTime())) return err('invalid now');
    try {
      const res = await tickRecurring(DATA_DIR, at, (input) => taskStore(ctx).create(input));
      return ok({ now: at.toISOString(), ...res });
    } catch (e) { return errWith({ message: (e as Error).message, code: 'RECURRING_TICK' }); }
  });

  ctx.server.registerTool('task_document_links_set', {
    title: 'Link Task/Document',
    description: 'Set bidirectional links for one document and the listed tasks; removes stale doc links from other tasks.',
    inputSchema: { project: z.string().optional(), docId: z.string().min(1), taskIds: z.array(z.string().min(1)).max(200) },
  }, async ({ project, docId, taskIds }: { project?: string; docId: string; taskIds: string[] }) => {
    const prj = resolveProject(project);
    const doc = await docStore(ctx).update(prj, docId, { relatedTaskIds: taskIds });
    if (!doc) return err(`document not found: ${docId}`);
    const all = await taskStore(ctx).list({ project: prj, includeArchived: true, includeTrashed: true });
    const updated: string[] = [];
    for (const t of all) {
      const has = (t.relatedDocIds ?? []).includes(docId);
      const want = taskIds.includes(t.id);
      if (has === want) continue;
      const next = want ? [...(t.relatedDocIds ?? []), docId] : (t.relatedDocIds ?? []).filter((x) => x !== docId);
      await taskStore(ctx).update(prj, t.id, { relatedDocIds: next });
      updated.push(t.id);
    }
    return ok({ docId, taskIds, updatedTasks: updated });
  });

  ctx.server.registerTool('task_document_links_get', {
    title: 'Get Task/Document Links',
    description: 'Read bidirectional links by task or document.',
    inputSchema: { project: z.string().optional(), taskId: z.string().optional(), docId: z.string().optional() },
  }, async ({ project, taskId, docId }: { project?: string; taskId?: string; docId?: string }) => {
    const prj = resolveProject(project);
    if (taskId) {
      const t = await taskStore(ctx).get(prj, taskId);
      if (!t) return err(`task not found: ${taskId}`);
      return ok({ taskId, docIds: t.relatedDocIds ?? [] });
    }
    if (docId) {
      const d = await docStore(ctx).read(prj, docId);
      if (!d) return err(`document not found: ${docId}`);
      return ok({ docId, taskIds: d.relatedTaskIds ?? [] });
    }
    return err('taskId or docId is required');
  });
}


