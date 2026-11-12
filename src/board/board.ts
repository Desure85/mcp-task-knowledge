/** TK-03: configurable board (saved query + columns) and sprints. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Task } from '../types.js';
import { parseTaskQuery, QueryError } from '../query/parser.js';
import { matchesQuery } from '../query/saved.js';

export interface BoardColumn { id: string; title: string; query: string }
export interface BoardConfig {
  project: string;
  query?: string;
  columns: BoardColumn[];
  swimlaneField?: 'type' | 'priority' | 'assignee' | 'tag';
  updatedAt?: string;
}
export interface Sprint { id: string; name: string; startDate: string; endDate: string; createdAt: string }

const CONFIG_FILE = 'board-config.json';
const SPRINT_FILE = 'sprints.json';
export async function readBoards(root: string): Promise<Record<string, BoardConfig>> {
  try { return JSON.parse(await fs.readFile(path.join(root, CONFIG_FILE), 'utf8')) as Record<string, BoardConfig>; } catch { return {}; }
}
export async function saveBoard(root: string, config: BoardConfig): Promise<BoardConfig> {
  if (config.columns.length < 1 || config.columns.length > 20) throw new QueryError('QUERY_SYNTAX', 'board needs 1..20 columns');
  const ids = new Set<string>();
  for (const c of config.columns) {
    if (!c.id.trim() || ids.has(c.id)) throw new QueryError('QUERY_SYNTAX', `duplicate/empty column id "${c.id}"`);
    ids.add(c.id);
    try { parseTaskQuery(c.query); } catch (e) { if (e instanceof QueryError) throw new QueryError(e.code, `column ${c.id}: ${e.message}`); throw e; }
  }
  if (config.query) parseTaskQuery(config.query);
  const all = await readBoards(root);
  const next: BoardConfig = { ...config, updatedAt: new Date().toISOString() };
  all[config.project] = next;
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, CONFIG_FILE), JSON.stringify(all, null, 2) + '\n', 'utf8');
  return next;
}
export function buildBoard(tasks: Task[], config: BoardConfig): {
  columns: Array<{ id: string; title: string; total: number; tasks: Task[] }>;
  swimlanes: Record<string, Record<string, number>>;
} {
  const base = config.query ? parseTaskQuery(config.query) : null;
  const visible = tasks.filter((t) => matchesQuery(base?.ast ?? null, t));
  const columns = config.columns.map((c) => {
    const parsed = parseTaskQuery(c.query);
    const matched = visible.filter((t) => matchesQuery(parsed.ast, t));
    return { id: c.id, title: c.title, total: matched.length, tasks: matched };
  });
  const swimlanes: Record<string, Record<string, number>> = {};
  if (config.swimlaneField) {
    for (const col of columns) {
      for (const t of col.tasks) {
        const raw = (t as unknown as Record<string, unknown>)[config.swimlaneField];
        const values = Array.isArray(raw) ? raw.map(String) : [String(raw ?? 'none')];
        for (const v of values) {
          swimlanes[v] ??= {};
          swimlanes[v][col.id] = (swimlanes[v][col.id] ?? 0) + 1;
        }
      }
    }
  }
  return { columns, swimlanes };
}
export async function readSprints(root: string): Promise<Sprint[]> {
  try { return JSON.parse(await fs.readFile(path.join(root, SPRINT_FILE), 'utf8')) as Sprint[]; } catch { return []; }
}
export async function saveSprint(root: string, input: Omit<Sprint, 'createdAt'>): Promise<Sprint> {
  if (!input.name.trim()) throw new QueryError('QUERY_SYNTAX', 'sprint name must not be empty');
  const start = Date.parse(input.startDate);
  const end = Date.parse(input.endDate);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) throw new QueryError('QUERY_SYNTAX', 'sprint dates invalid or end < start');
  const all = await readSprints(root);
  const sprint: Sprint = { ...input, createdAt: new Date().toISOString() };
  const i = all.findIndex((s) => s.id === sprint.id);
  if (i >= 0) all[i] = sprint; else all.push(sprint);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, SPRINT_FILE), JSON.stringify(all, null, 2) + '\n', 'utf8');
  return sprint;
}
export async function deleteSprint(root: string, id: string): Promise<boolean> {
  const all = await readSprints(root);
  const next = all.filter((s) => s.id !== id);
  if (next.length === all.length) return false;
  await fs.writeFile(path.join(root, SPRINT_FILE), JSON.stringify(next, null, 2) + '\n', 'utf8');
  return true;
}
