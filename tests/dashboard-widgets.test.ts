import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { readLayouts, saveLayout, widgetData, validateWidget, type WidgetConfig } from '../src/dashboard/widgets.js';
import type { Task } from '../src/types.js';

const ROOT = path.join(process.cwd(), '.tmp-tests-dashboard-widgets');
const base = { project: 'mcp', status: 'todo', priority: 'medium', type: 'task', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' } as Task;
const tasks: Task[] = [
  { ...base, id: 'a', title: 'Alpha', tags: ['bug'] },
  { ...base, id: 'b', title: 'Beta', status: 'done', priority: 'high', tags: ['bug', 'docs'], updatedAt: '2026-11-02T00:00:00Z' },
];
beforeAll(async () => { await fsp.rm(ROOT, { recursive: true, force: true }); await fsp.mkdir(ROOT, { recursive: true }); });
afterAll(async () => { await fsp.rm(ROOT, { recursive: true, force: true }); });

describe('TK-04 dashboard widgets', () => {
  it('validates widget configs', () => {
    expect(() => validateWidget({ id: 'x', type: 'distribution' } as WidgetConfig)).toThrow();
    expect(() => validateWidget({ id: 'x', type: 'nope' } as never)).toThrow();
    expect(() => validateWidget({ id: 'x', type: 'list', query: 'bad: x' })).toThrow();
    expect(() => validateWidget({ id: 'x', type: 'burndown', days: 0 })).toThrow();
  });
  it('saves one layout per user and rejects duplicate ids', async () => {
    await saveLayout(ROOT, 'u1', [{ id: 'q', type: 'list', query: '#bug' }]);
    expect((await readLayouts(ROOT))['u1']!.widgets[0]!.id).toBe('q');
    await expect(saveLayout(ROOT, 'u1', [{ id: 'q', type: 'list' }, { id: 'q', type: 'list' }])).rejects.toThrow();
  });
  it('renders list, distribution, burndown and unsupported time', () => {
    const list = widgetData({ id: 'l', type: 'list', query: '#bug' }, tasks);
    expect(list.total).toBe(2);
    const dist = widgetData({ id: 'd', type: 'distribution', field: 'status' }, tasks);
    expect(dist.counts).toMatchObject({ todo: 1, done: 1 });
    const burn = widgetData({ id: 'b', type: 'burndown', days: 2 }, tasks);
    expect(Array.isArray(burn.buckets)).toBe(true);
    expect(widgetData({ id: 't', type: 'time' }, tasks)).toMatchObject({ supported: false });
  });
});
