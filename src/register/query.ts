/** TK-02: tasks_query + saved searches. */
import { z } from 'zod/v3';
import { DATA_DIR } from '../config.js';
import { storageProfile } from '../core/storage-context.js';
import { resolveProject } from '../config.js';
import { ok, err, errWith } from '../utils/respond.js';
import { QueryError, parseTaskQuery } from '../query/parser.js';
import { deleteSearch, matchesQuery, readSavedSearches, saveSearch, sortTasks } from '../query/saved.js';
import type { ServerContext } from './context.js';

function taskStore(ctx: ServerContext) { return storageProfile(ctx).tasks; }

export function registerQueryTools(ctx: ServerContext): void {
  ctx.server.registerTool('tasks_query', {
    title: 'Tasks Query',
    description: 'Query tasks with the TK-02 language: `project: X #tag status: Doing assignee: me`, AND/OR/NOT, parentheses, quoted values, sort by: updated|created|priority|title.',
    inputSchema: {
      query: z.string().min(1),
      project: z.string().optional(),
      includeArchived: z.boolean().optional(),
      limit: z.number().int().min(1).max(500).default(50).optional(),
    },
  }, async ({ query, project, includeArchived, limit }: { query: string; project?: string; includeArchived?: boolean; limit?: number }) => {
    const prj = resolveProject(project);
    try {
      const parsed = parseTaskQuery(query);
      const all = await taskStore(ctx).list({ project: prj, includeArchived: includeArchived ?? false });
      const matched = sortTasks(all.filter((t) => matchesQuery(parsed.ast, t)), parsed.sortBy);
      return ok({ project: prj, query, sortBy: parsed.sortBy, total: matched.length, tasks: matched.slice(0, limit ?? 50) });
    } catch (e) {
      if (e instanceof QueryError) return errWith({ message: e.message, code: e.code, ...(e.position !== undefined ? { position: e.position } : {}) });
      throw e;
    }
  });

  ctx.server.registerTool('tasks_saved_search_list', {
    title: 'Saved Searches',
    description: 'List saved task queries.',
    inputSchema: {},
  }, async () => ok({ searches: await readSavedSearches(DATA_DIR) }));

  ctx.server.registerTool('tasks_saved_search_save', {
    title: 'Save Search',
    description: 'Create or replace a named saved query.',
    inputSchema: { name: z.string().min(1).max(80), query: z.string().min(1), project: z.string().optional() },
  }, async ({ name, query, project }: { name: string; query: string; project?: string }) => {
    try { parseTaskQuery(query); } catch (e) { if (e instanceof QueryError) return errWith({ message: e.message, code: e.code }); throw e; }
    const saved = await saveSearch(DATA_DIR, name, query, project);
    return ok(saved);
  });

  ctx.server.registerTool('tasks_saved_search_delete', {
    title: 'Delete Saved Search',
    description: 'Delete a saved query by name.',
    inputSchema: { name: z.string().min(1) },
  }, async ({ name }: { name: string }) => {
    const deleted = await deleteSearch(DATA_DIR, name);
    return deleted ? ok({ name, deleted: true }) : err(`saved search not found: ${name}`);
  });
}
