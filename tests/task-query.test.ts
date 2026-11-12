import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { parseTaskQuery, QueryError } from '../src/query/parser.js';
import { matchesQuery, sortTasks, saveSearch, readSavedSearches, deleteSearch } from '../src/query/saved.js';
import type { Task } from '../src/types.js';

const ROOT = path.join(process.cwd(), '.tmp-tests-task-query');
const base = { project: 'mcp', status: 'todo', priority: 'medium', type: 'task', createdAt: '2026-01-01', updatedAt: '2026-01-01' } as Task;
const t1: Task = { ...base, id: 't1', title: 'Fix login bug', tags: ['bug'] };
const t2: Task = { ...base, id: 't2', title: 'Write docs', status: 'Doing', priority: 'low', tags: ['docs'] };
const t3: Task = { ...base, id: 't3', title: 'Ship two words', priority: 'high' };

beforeAll(async () => { await fsp.rm(ROOT, { recursive: true, force: true }); await fsp.mkdir(ROOT, { recursive: true }); });
afterAll(async () => { await fsp.rm(ROOT, { recursive: true, force: true }); });

describe('TK-02 query language', () => {
  it('parses field terms, tags, OR and parentheses', () => {
    const q = parseTaskQuery('project: mcp #bug OR (status: Doing AND -priority: low)');
    expect(matchesQuery(q.ast, t1)).toBe(true);
    expect(matchesQuery(q.ast, t2)).toBe(false);
  });
  it('supports quoted values, NOT and sort', () => {
    const q = parseTaskQuery('"two words" sort by: title');
    expect(q.sortBy).toBe('title');
    expect(matchesQuery(q.ast, t3)).toBe(true);
    expect(matchesQuery(q.ast, t1)).toBe(false);
    expect(sortTasks([t2, t3], 'title').map((t) => t.id)).toEqual(['t3', 't2']);
  });
  it('rejects unknown fields and broken syntax with codes', () => {
    expect(() => parseTaskQuery('nope: x')).toThrowError(QueryError);
    try { parseTaskQuery('nope: x'); } catch (e) { expect((e as QueryError).code).toBe('QUERY_UNKNOWN_FIELD'); }
    try { parseTaskQuery('(a OR b'); } catch (e) { expect((e as QueryError).code).toBe('QUERY_SYNTAX'); }
  });
  it('saves, lists and deletes searches idempotently', async () => {
    await saveSearch(ROOT, 'bugs', '#bug');
    await saveSearch(ROOT, 'bugs', 'project: mcp #bug');
    expect((await readSavedSearches(ROOT)).filter((s) => s.name === 'bugs')).toHaveLength(1);
    expect((await readSavedSearches(ROOT))[0]!.query).toBe('project: mcp #bug');
    expect(await deleteSearch(ROOT, 'bugs')).toBe(true);
    expect(await deleteSearch(ROOT, 'bugs')).toBe(false);
  });
});
