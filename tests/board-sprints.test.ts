import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { buildBoard, readBoards, readSprints, saveBoard, saveSprint, deleteSprint } from '../src/board/board.js';
import type { Task } from '../src/types.js';

const ROOT = path.join(process.cwd(), '.tmp-tests-board-sprints');
const base = { project: 'mcp', status: 'todo', priority: 'medium', type: 'task', createdAt: '2026-01-01', updatedAt: '2026-01-01' } as Task;
const tasks: Task[] = [
  { ...base, id: 'a', title: 'A', tags: ['bug'] },
  { ...base, id: 'b', title: 'B', status: 'doing', priority: 'high', tags: ['bug'] },
  { ...base, id: 'c', title: 'C', status: 'done' },
];
beforeAll(async () => { await fsp.rm(ROOT, { recursive: true, force: true }); await fsp.mkdir(ROOT, { recursive: true }); });
afterAll(async () => { await fsp.rm(ROOT, { recursive: true, force: true }); });

describe('TK-03 boards and sprints', () => {
  it('builds columns from queries and swimlanes by priority', () => {
    const config = { project: 'mcp', query: '#bug', columns: [
      { id: 'todo', title: 'To do', query: 'status: todo' },
      { id: 'doing', title: 'Doing', query: 'status: doing' },
    ], swimlaneField: 'priority' as const };
    const board = buildBoard(tasks, config);
    expect(board.columns.map((c) => c.total)).toEqual([1, 1]);
    expect(board.swimlanes.medium!.todo).toBe(1);
    expect(board.swimlanes.high!.doing).toBe(1);
  });
  it('saves config and rejects bad/duplicate columns', async () => {
    await saveBoard(ROOT, { project: 'mcp', columns: [{ id: 'x', title: 'X', query: '#bug' }] });
    expect((await readBoards(ROOT))['mcp']!.columns[0]!.id).toBe('x');
    await expect(saveBoard(ROOT, { project: 'mcp', columns: [{ id: 'x', title: 'X', query: '#a' }, { id: 'x', title: 'Y', query: '#b' }] })).rejects.toThrow();
    await expect(saveBoard(ROOT, { project: 'mcp', columns: [{ id: 'x', title: 'X', query: 'nope: x' }] })).rejects.toThrow();
  });
  it('saves, lists and deletes sprints with date checks', async () => {
    await saveSprint(ROOT, { id: 's1', name: 'S1', startDate: '2026-11-01', endDate: '2026-11-14' });
    expect((await readSprints(ROOT)).map((s) => s.id)).toContain('s1');
    await expect(saveSprint(ROOT, { id: 's2', name: 'S2', startDate: '2026-11-14', endDate: '2026-11-01' })).rejects.toThrow();
    expect(await deleteSprint(ROOT, 's1')).toBe(true);
    expect(await deleteSprint(ROOT, 's1')).toBe(false);
  });
});
