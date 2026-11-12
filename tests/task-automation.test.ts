import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { readTemplates, saveTemplate, deleteTemplate, nextOccurrence, readRecurring, saveRecurring, deleteRecurring, tickRecurring } from '../src/automation/tasks.js';
import type { CreateTaskInput } from '../src/storage/contracts.js';
import type { Task } from '../src/types.js';

const ROOT = path.join(process.cwd(), '.tmp-tests-task-automation');
beforeAll(async () => { await fsp.rm(ROOT, { recursive: true, force: true }); await fsp.mkdir(ROOT, { recursive: true }); });
afterAll(async () => { await fsp.rm(ROOT, { recursive: true, force: true }); });

describe('T-06 templates and recurring', () => {
  it('saves/deletes templates', async () => {
    await saveTemplate(ROOT, { id: 'tpl', name: 'Bug', defaults: { priority: 'high', tags: ['bug'] } });
    expect((await readTemplates(ROOT))[0]!.defaults.priority).toBe('high');
    expect(await deleteTemplate(ROOT, 'tpl')).toBe(true);
    expect(await deleteTemplate(ROOT, 'tpl')).toBe(false);
  });
  it('computes daily/weekly/monthly next occurrence', () => {
    const after = new Date('2026-11-12T10:00:00Z');
    expect(nextOccurrence({ kind: 'daily' }, after).toISOString()).toBe('2026-11-13T09:00:00.000Z');
    expect(nextOccurrence({ kind: 'weekly', dayOfWeek: 1 }, after).getUTCDay()).toBe(1);
    expect(nextOccurrence({ kind: 'monthly', dayOfMonth: 15 }, after).toISOString()).toBe('2026-11-15T09:00:00.000Z');
  });
  it('ticks due instances once and is idempotent across restart', async () => {
    await saveRecurring(ROOT, { id: 'r1', project: 'mcp', title: 'Daily', schedule: { kind: 'daily' }, nextAt: '2026-11-10T09:00:00.000Z' });
    const made: string[] = [];
    const create = async (input: CreateTaskInput): Promise<Task> => { made.push(input.title); return { ...input, id: `id${made.length}`, status: 'todo', priority: input.priority ?? 'medium', type: 'task', createdAt: 'x', updatedAt: 'x' } as Task; };
    const r1 = await tickRecurring(ROOT, new Date('2026-11-12T12:00:00Z'), create);
    expect(r1.created).toHaveLength(3);
    const r2 = await tickRecurring(ROOT, new Date('2026-11-12T12:00:00Z'), create);
    expect(r2.created).toHaveLength(0);
    expect(made).toHaveLength(3);
    expect((await readRecurring(ROOT))[0]!.createdKeys).toHaveLength(3);
    expect(await deleteRecurring(ROOT, 'r1')).toBe(true);
  });
});
