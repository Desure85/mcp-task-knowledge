/** TK-02: evaluate a parsed query against a task; saved searches store. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { QueryNode, ParsedQuery } from './parser.js';
import type { Task } from '../types.js';

function textOf(t: Task): string {
  return [t.title, t.description ?? '', ...(t.tags ?? [])].join('\n').toLowerCase();
}

export function matchesQuery(node: QueryNode | null, task: Task): boolean {
  if (!node) return true;
  if (node.type === 'and') return matchesQuery(node.left, task) && matchesQuery(node.right, task);
  if (node.type === 'or') return matchesQuery(node.left, task) || matchesQuery(node.right, task);
  if (node.type === 'not') return !matchesQuery(node.node, task);
  const v = node.value.toLowerCase();
  switch (node.field) {
    case 'project': return task.project.toLowerCase() === v;
    case 'id': return task.id.toLowerCase() === v;
    case 'assignee': return (task.assignee ?? '').toLowerCase() === v;
    case 'status': return task.status.toLowerCase() === v;
    case 'type': return (task.type ?? 'task').toLowerCase() === v;
    case 'priority': return task.priority.toLowerCase() === v;
    case 'tag': return (task.tags ?? []).some((tag) => tag.toLowerCase() === v);
    case 'text': return textOf(task).includes(v);
    default: return textOf(task).includes(v);
  }
}

export function sortTasks(tasks: Task[], sortBy: ParsedQuery['sortBy']): Task[] {
  const prio = { high: 3, medium: 2, low: 1 } as const;
  return [...tasks].sort((a, b) => {
    if (sortBy === 'priority') return (prio[b.priority] ?? 0) - (prio[a.priority] ?? 0);
    if (sortBy === 'title') return a.title.localeCompare(b.title);
    if (sortBy === 'created') return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
  });
}

export interface SavedSearch { name: string; query: string; project?: string; createdAt: string; updatedAt: string }
function file(root: string): string { return path.join(root, 'saved-searches.json'); }
export async function readSavedSearches(root: string): Promise<SavedSearch[]> {
  try { return JSON.parse(await fs.readFile(file(root), 'utf8')) as SavedSearch[]; } catch { return []; }
}
export async function saveSearch(root: string, name: string, query: string, project?: string): Promise<SavedSearch> {
  if (!name.trim()) throw new Error('name must not be empty');
  const all = await readSavedSearches(root);
  const now = new Date().toISOString();
  const existing = all.find((s) => s.name === name);
  if (existing) { existing.query = query; existing.project = project; existing.updatedAt = now; }
  else all.push({ name, query, project, createdAt: now, updatedAt: now });
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(file(root), JSON.stringify(all, null, 2) + '\n', 'utf8');
  return all.find((s) => s.name === name)!;
}
export async function deleteSearch(root: string, name: string): Promise<boolean> {
  const all = await readSavedSearches(root);
  const next = all.filter((s) => s.name !== name);
  if (next.length === all.length) return false;
  await fs.writeFile(file(root), JSON.stringify(next, null, 2) + '\n', 'utf8');
  return true;
}
