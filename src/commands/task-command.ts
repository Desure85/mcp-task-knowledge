import type { Task, TaskWorkItem } from '../types.js';

export class TaskCommandError extends Error {
  constructor(public readonly code: string, message: string, public readonly hint?: string) {
    super(message);
    this.name = 'TaskCommandError';
  }
}

export interface ParsedTaskCommand {
  forMe: boolean;
  statusToken: string;
}

/**
 * TK-05 v1 grammar: `State <status>` or `for me State <status>`.
 * Anything else is rejected; there is no free-form YouTrack syntax here.
 */
export function parseTaskCommand(raw: string): ParsedTaskCommand {
  const text = raw.trim().replace(/\s+/g, ' ');
  const m = /^(?:(for me)\s+)?state\s+(.+)$/i.exec(text);
  if (!m) {
    throw new TaskCommandError('COMMAND_SYNTAX', `unsupported command '${raw}'`, 'v1 supports: State <status> | for me State <status>');
  }
  return { forMe: Boolean(m[1]), statusToken: m[2] };
}

export interface TaskCommandFilter {
  ids?: string[];
  assignee?: string;
  status?: string;
  tag?: string;
  priority?: string;
}

export function filterToIds(tasks: Task[], filter: TaskCommandFilter): Task[] {
  const ids = filter.ids ? new Set(filter.ids) : undefined;
  return tasks.filter((t) => {
    if (ids && !ids.has(t.id)) return false;
    if (filter.assignee !== undefined && t.assignee !== filter.assignee) return false;
    if (filter.status !== undefined && t.status !== filter.status) return false;
    if (filter.tag !== undefined && !(t.tags ?? []).includes(filter.tag)) return false;
    if (filter.priority !== undefined && t.priority !== filter.priority) return false;
    return true;
  });
}

export function hasPredicate(filter: TaskCommandFilter): boolean {
  return Boolean(filter.ids?.length || filter.assignee || filter.status || filter.tag || filter.priority);
}

export function buildWorkItem(input: {
  userId?: string;
  durationMin: number;
  startedAt?: string;
  description?: string;
  now?: string;
  id: string;
}): TaskWorkItem {
  const now = input.now ?? new Date().toISOString();
  const item: TaskWorkItem = {
    id: input.id,
    startedAt: input.startedAt ?? now,
    durationMin: input.durationMin,
    createdAt: now,
  };
  if (input.userId) item.userId = input.userId;
  if (input.description) item.description = input.description;
  return item;
}

export function sumWorkMinutes(items: TaskWorkItem[] | undefined): number {
  return totalMinutes(items);
}

export function totalMinutes(items: TaskWorkItem[] | undefined): number {
  return (items ?? []).reduce((sum, item) => sum + item.durationMin, 0);
}
