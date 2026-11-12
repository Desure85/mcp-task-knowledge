/** TK-04: dashboard widget layout per user + rendering. */
import { z } from 'zod/v3';
import { DATA_DIR } from '../config.js';
import { storageProfile } from '../core/storage-context.js';
import { currentSessionId } from '../core/request-context.js';
import { ok, errWith } from '../utils/respond.js';
import { QueryError } from '../query/parser.js';
import { readLayouts, saveLayout, widgetData, type WidgetConfig } from '../dashboard/widgets.js';
import type { ServerContext } from './context.js';

const widgetSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(['list', 'distribution', 'burndown', 'time']),
  title: z.string().max(120).optional(),
  query: z.string().optional(),
  field: z.enum(['status', 'priority', 'type', 'tag', 'assignee']).optional(),
  days: z.number().int().min(1).max(365).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

function userOf(explicit?: string): string { return explicit?.trim() || currentSessionId() || 'local'; }

export function registerDashboardWidgetTools(ctx: ServerContext): void {
  ctx.server.registerTool('dashboard_widgets_get', {
    title: 'Dashboard Widgets',
    description: 'Read a user dashboard widget layout (per session by default).',
    inputSchema: { user: z.string().optional() },
  }, async ({ user }: { user?: string }) => {
    const key = userOf(user);
    return ok((await readLayouts(DATA_DIR))[key] ?? { user: key, widgets: [], updatedAt: null });
  });

  ctx.server.registerTool('dashboard_widgets_set', {
    title: 'Set Dashboard Widgets',
    description: 'Replace a user dashboard layout (≤20 widgets). Types: list, distribution, burndown, time.',
    inputSchema: { user: z.string().optional(), widgets: z.array(widgetSchema).max(20) },
  }, async ({ user, widgets }: { user?: string; widgets: WidgetConfig[] }) => {
    try { return ok(await saveLayout(DATA_DIR, userOf(user), widgets)); }
    catch (e) { if (e instanceof QueryError) return errWith({ message: e.message, code: e.code }); throw e; }
  });

  ctx.server.registerTool('dashboard_widgets_render', {
    title: 'Render Dashboard Widgets',
    description: 'Render saved widgets for a user: list query, distribution by field, burndown; time is unsupported until TK-05.',
    inputSchema: { user: z.string().optional(), project: z.string().optional() },
  }, async ({ user, project }: { user?: string; project?: string }) => {
    const key = userOf(user);
    const layout = (await readLayouts(DATA_DIR))[key];
    if (!layout) return ok({ user: key, widgets: [] });
    const tasks = await storageProfile(ctx).tasks.list({ project, includeArchived: false, includeTrashed: false });
    return ok({ user: key, widgets: layout.widgets.map((w) => ({ id: w.id, title: w.title, ...widgetData(w, tasks) })) });
  });
}
