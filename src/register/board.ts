/** TK-03 tools: configurable board and sprints. */
import { z } from 'zod/v3';
import { DATA_DIR, resolveProject } from '../config.js';
import { storageProfile } from '../core/storage-context.js';
import { ok, err, errWith } from '../utils/respond.js';
import { QueryError } from '../query/parser.js';
import { buildBoard, deleteSprint, readBoards, readSprints, saveBoard, saveSprint, type BoardConfig } from '../board/board.js';
import type { ServerContext } from './context.js';

function taskStore(ctx: ServerContext) { return storageProfile(ctx).tasks; }
const columnSchema = z.object({ id: z.string().min(1).max(64), title: z.string().min(1).max(120), query: z.string().min(1) });

export function registerBoardTools(ctx: ServerContext): void {
  ctx.server.registerTool('project_board_get', {
    title: 'Project Board',
    description: 'Read board config (saved query, columns, swimlane field).',
    inputSchema: { project: z.string().optional() },
  }, async ({ project }: { project?: string }) => {
    const prj = resolveProject(project);
    return ok((await readBoards(DATA_DIR))[prj] ?? { project: prj, columns: [] });
  });

  ctx.server.registerTool('project_board_set', {
    title: 'Set Project Board',
    description: 'Replace board config: saved query, 1..20 columns with query per column, optional swimlane field.',
    inputSchema: {
      project: z.string().optional(),
      query: z.string().optional(),
      columns: z.array(columnSchema).min(1).max(20),
      swimlaneField: z.enum(['type', 'priority', 'assignee', 'tag']).optional(),
    },
  }, async (args: { project?: string; query?: string; columns: BoardConfig['columns']; swimlaneField?: BoardConfig['swimlaneField'] }) => {
    const prj = resolveProject(args.project);
    try { return ok(await saveBoard(DATA_DIR, { project: prj, ...args })); }
    catch (e) { if (e instanceof QueryError) return errWith({ message: e.message, code: e.code }); throw e; }
  });

  ctx.server.registerTool('tasks_board', {
    title: 'Render Task Board',
    description: 'Render the saved board: columns by query + swimlane counts. Falls back to one column per distinct status.',
    inputSchema: { project: z.string().optional(), includeArchived: z.boolean().optional() },
  }, async ({ project, includeArchived }: { project?: string; includeArchived?: boolean }) => {
    const prj = resolveProject(project);
    const tasks = await taskStore(ctx).list({ project: prj, includeArchived: includeArchived ?? false });
    const saved = (await readBoards(DATA_DIR))[prj];
    const config: BoardConfig = saved ?? {
      project: prj,
      columns: [...new Set(tasks.map((t) => t.status))].map((s) => ({ id: s, title: s, query: `status: ${s}` })),
    };
    try { return ok({ project: prj, config, ...buildBoard(tasks, config) }); }
    catch (e) { if (e instanceof QueryError) return errWith({ message: e.message, code: e.code }); throw e; }
  });

  ctx.server.registerTool('project_sprint_list', {
    title: 'Sprint List',
    description: 'List sprints with dates.',
    inputSchema: {},
  }, async () => ok({ sprints: await readSprints(DATA_DIR) }));

  ctx.server.registerTool('project_sprint_save', {
    title: 'Save Sprint',
    description: 'Create or replace a sprint (id, name, startDate, endDate).',
    inputSchema: { id: z.string().min(1).max(64), name: z.string().min(1).max(120), startDate: z.string(), endDate: z.string() },
  }, async (input: { id: string; name: string; startDate: string; endDate: string }) => {
    try { return ok(await saveSprint(DATA_DIR, input)); }
    catch (e) { if (e instanceof QueryError) return errWith({ message: e.message, code: e.code }); throw e; }
  });

  ctx.server.registerTool('project_sprint_delete', {
    title: 'Delete Sprint',
    description: 'Delete a sprint by id; tasks keep sprintId but it no longer resolves.',
    inputSchema: { id: z.string().min(1) },
  }, async ({ id }: { id: string }) => {
    const deleted = await deleteSprint(DATA_DIR, id);
    return deleted ? ok({ id, deleted: true }) : err(`sprint not found: ${id}`);
  });

  ctx.server.registerTool('tasks_sprint_assign', {
    title: 'Assign Sprint',
    description: 'Assign tasks to a sprint; sprintId=null clears membership.',
    inputSchema: { project: z.string().optional(), ids: z.array(z.string().min(1)).min(1).max(200), sprintId: z.string().nullable() },
  }, async ({ project, ids, sprintId }: { project?: string; ids: string[]; sprintId: string | null }) => {
    const prj = resolveProject(project);
    if (sprintId !== null) {
      const sprint = (await readSprints(DATA_DIR)).find((s) => s.id === sprintId);
      if (!sprint) return err(`sprint not found: ${sprintId}`);
    }
    const updated: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    for (const id of ids) {
      try {
        const t = await taskStore(ctx).update(prj, id, { sprintId });
        if (t) updated.push(id); else failed.push({ id, error: 'not found' });
      } catch (e) { failed.push({ id, error: (e as Error).message }); }
    }
    return ok({ sprintId, updated, failed });
  });
}

