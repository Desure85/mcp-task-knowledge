/** T-06: task templates, recurring definitions with idempotent tick. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CreateTaskInput } from '../storage/contracts.js';
import type { Task } from '../types.js';

export interface TaskTemplate {
  id: string;
  name: string;
  defaults: Partial<Omit<CreateTaskInput, 'project' | 'title'>>;
  createdAt: string;
}
export type Schedule =
  | { kind: 'daily'; time?: string }
  | { kind: 'weekly'; dayOfWeek: number; time?: string }
  | { kind: 'monthly'; dayOfMonth: number; time?: string };
export interface RecurringDef {
  id: string;
  project: string;
  title: string;
  templateId?: string;
  schedule: Schedule;
  nextAt: string;
  lastRunAt?: string;
  createdKeys: string[];
  createdAt: string;
}

const TEMPLATE_FILE = 'task-templates.json';
const RECURRING_FILE = 'task-recurring.json';
export async function readTemplates(root: string): Promise<TaskTemplate[]> {
  try { return JSON.parse(await fs.readFile(path.join(root, TEMPLATE_FILE), 'utf8')) as TaskTemplate[]; } catch { return []; }
}
export async function saveTemplate(root: string, t: Omit<TaskTemplate, 'createdAt'>): Promise<TaskTemplate> {
  if (!t.id.trim()) throw new Error('template id must not be empty');
  const all = await readTemplates(root);
  const out: TaskTemplate = { ...t, createdAt: new Date().toISOString() };
  const i = all.findIndex((x) => x.id === out.id);
  if (i >= 0) {
    out.createdAt = all[i]!.createdAt;
    all[i] = out;
  } else {
    all.push(out);
  }
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, TEMPLATE_FILE), JSON.stringify(all, null, 2) + '\n', 'utf8');
  return out;
}
export async function deleteTemplate(root: string, id: string): Promise<boolean> {
  const all = await readTemplates(root);
  const next = all.filter((t) => t.id !== id);
  if (next.length === all.length) return false;
  await fs.writeFile(path.join(root, TEMPLATE_FILE), JSON.stringify(next, null, 2) + '\n', 'utf8');
  return true;
}

function parseTime(t?: string): { h: number; m: number } {
  if (!t) return { h: 9, m: 0 };
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) throw new Error(`invalid time "${t}"`);
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`invalid time "${t}"`);
  return { h, m: min };
}
export function nextOccurrence(schedule: Schedule, after: Date): Date {
  const { h, m } = parseTime(schedule.time);
  const d = new Date(after.getTime());
  if (schedule.kind === 'daily') {
    d.setUTCDate(d.getUTCDate() + 1);
  } else if (schedule.kind === 'weekly') {
    if (!Number.isInteger(schedule.dayOfWeek) || schedule.dayOfWeek < 0 || schedule.dayOfWeek > 6) throw new Error('dayOfWeek must be 0..6');
    do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== schedule.dayOfWeek);
  } else {
    if (!Number.isInteger(schedule.dayOfMonth) || schedule.dayOfMonth < 1 || schedule.dayOfMonth > 28) throw new Error('dayOfMonth must be 1..28');
    const candidate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), schedule.dayOfMonth, h, m, 0, 0));
    if (candidate.getTime() > after.getTime()) return candidate;
    d.setUTCMonth(d.getUTCMonth() + 1, schedule.dayOfMonth);
  }
  d.setUTCHours(h, m, 0, 0);
  return d;
}
export async function readRecurring(root: string): Promise<RecurringDef[]> {
  try { return JSON.parse(await fs.readFile(path.join(root, RECURRING_FILE), 'utf8')) as RecurringDef[]; } catch { return []; }
}
export async function saveRecurring(root: string, input: Omit<RecurringDef, 'createdAt' | 'createdKeys' | 'nextAt'> & { nextAt?: string }): Promise<RecurringDef> {
  if (!input.title.trim()) throw new Error('title must not be empty');
  const all = await readRecurring(root);
  const def: RecurringDef = {
    ...input,
    nextAt: input.nextAt ?? nextOccurrence(input.schedule, new Date()).toISOString(),
    createdKeys: all.find((d) => d.id === input.id)?.createdKeys ?? [],
    createdAt: new Date().toISOString(),
  };
  const i = all.findIndex((d) => d.id === def.id);
  if (i >= 0) all[i] = def; else all.push(def);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, RECURRING_FILE), JSON.stringify(all, null, 2) + '\n', 'utf8');
  return def;
}
export async function deleteRecurring(root: string, id: string): Promise<boolean> {
  const all = await readRecurring(root);
  const next = all.filter((d) => d.id !== id);
  if (next.length === all.length) return false;
  await fs.writeFile(path.join(root, RECURRING_FILE), JSON.stringify(next, null, 2) + '\n', 'utf8');
  return true;
}

/** Deterministic tick: create one task per due occurrence, never twice for the same key. */
export async function tickRecurring(
  root: string,
  now: Date,
  create: (input: CreateTaskInput) => Promise<Task>,
  templates?: TaskTemplate[],
): Promise<{ created: Array<{ defId: string; key: string; taskId: string }>; skipped: number }> {
  const defs = await readRecurring(root);
  const tpls = templates ?? await readTemplates(root);
  const created: Array<{ defId: string; key: string; taskId: string }> = [];
  let skipped = 0;
  for (const def of defs) {
    let next = new Date(def.nextAt);
    let guard = 0;
    while (next.getTime() <= now.getTime() && guard++ < 366) {
      const key = `${def.id}:${next.toISOString()}`;
      if (!def.createdKeys.includes(key)) {
        const tpl = def.templateId ? tpls.find((t) => t.id === def.templateId) : undefined;
        const task = await create({ ...(tpl?.defaults ?? {}), project: def.project, title: def.title });
        def.createdKeys.push(key);
        if (def.createdKeys.length > 200) def.createdKeys = def.createdKeys.slice(-200);
        created.push({ defId: def.id, key, taskId: task.id });
      } else skipped++;
      def.lastRunAt = next.toISOString();
      next = nextOccurrence(def.schedule, next);
    }
    def.nextAt = next.toISOString();
  }
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, RECURRING_FILE), JSON.stringify(defs, null, 2) + '\n', 'utf8');
  return { created, skipped };
}
