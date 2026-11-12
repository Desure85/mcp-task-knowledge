/** TK-04: dashboard widget config + layout and data. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseTaskQuery, QueryError } from '../query/parser.js';
import { matchesQuery } from '../query/saved.js';
import type { Task } from '../types.js';

export type WidgetType = 'list' | 'distribution' | 'burndown' | 'time';
export interface WidgetConfig {
  id: string;
  type: WidgetType;
  title?: string;
  query?: string;
  field?: 'status' | 'priority' | 'type' | 'tag' | 'assignee';
  days?: number;
  limit?: number;
}
export interface WidgetLayout { user: string; widgets: WidgetConfig[]; updatedAt: string }

const FIELDS = new Set(['status', 'priority', 'type', 'tag', 'assignee']);
const TYPES = new Set(['list', 'distribution', 'burndown', 'time']);

export function validateWidget(w: WidgetConfig): void {
  if (!w.id?.trim()) throw new QueryError('QUERY_SYNTAX', 'widget id must not be empty');
  if (!TYPES.has(w.type)) throw new QueryError('QUERY_SYNTAX', `unknown widget type "${w.type}"`);
  if (w.type === 'list' && w.query) parseTaskQuery(w.query);
  if (w.type === 'distribution' && !FIELDS.has(w.field ?? '')) throw new QueryError('QUERY_SYNTAX', 'distribution requires field: status|priority|type|tag|assignee');
  if (w.type === 'burndown') {
    const days = w.days ?? 30;
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new QueryError('QUERY_SYNTAX', 'burndown days must be 1..365');
  }
}

function store(root: string): string { return path.join(root, 'dashboard-widgets.json'); }
export async function readLayouts(root: string): Promise<Record<string, WidgetLayout>> {
  try { return JSON.parse(await fs.readFile(store(root), 'utf8')) as Record<string, WidgetLayout>; } catch { return {}; }
}
export async function saveLayout(root: string, user: string, widgets: WidgetConfig[]): Promise<WidgetLayout> {
  if (widgets.length > 20) throw new QueryError('QUERY_SYNTAX', 'at most 20 widgets');
  const ids = new Set<string>();
  for (const w of widgets) { validateWidget(w); if (ids.has(w.id)) throw new QueryError('QUERY_SYNTAX', `duplicate widget id "${w.id}"`); ids.add(w.id); }
  const layouts = await readLayouts(root);
  const layout: WidgetLayout = { user, widgets, updatedAt: new Date().toISOString() };
  layouts[user] = layout;
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(store(root), JSON.stringify(layouts, null, 2) + '\n', 'utf8');
  return layout;
}

export function widgetData(w: WidgetConfig, tasks: Task[]): Record<string, unknown> {
  if (w.type === 'time') return { type: 'time', supported: false, reason: 'work items arrive with TK-05' };
  if (w.type === 'list') {
    const parsed = parseTaskQuery(w.query ?? '');
    const matched = tasks.filter((t) => matchesQuery(parsed.ast, t));
    return { type: 'list', total: matched.length, tasks: matched.slice(0, w.limit ?? 10) };
  }
  if (w.type === 'distribution') {
    const field = w.field!;
    const counts: Record<string, number> = {};
    for (const t of tasks) {
      const values = field === 'tag' ? (t.tags ?? []) : [String((t as unknown as Record<string, unknown>)[field] ?? 'unassigned')];
      for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
    }
    return { type: 'distribution', field, counts };
  }
  const days = w.days ?? 30;
  const buckets: Array<{ date: string; created: number; done: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets.push({
      date: key,
      created: tasks.filter((t) => (t.createdAt ?? '').slice(0, 10) === key).length,
      done: tasks.filter((t) => (t.status ?? '').toLowerCase() === 'done' && (t.updatedAt ?? '').slice(0, 10) === key).length,
    });
  }
  return { type: 'burndown', days, buckets, note: 'done uses updatedAt; no closedAt in wire' };
}
