import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';

// TMP envs must be set before dynamic imports (config.ts resolves paths at module load).
const TMP_DIR = path.join(process.cwd(), '.tmp-tests-pagination');
process.env.DATA_DIR = TMP_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_DIR, 'vault');
process.env.EMBEDDINGS_MODE = 'none';

import type * as TasksNS from '../src/storage/tasks.js';
import type * as KnowledgeNS from '../src/storage/knowledge.js';
import type * as PagingNS from '../src/utils/pagination.js';

let tasks: typeof TasksNS;
let knowledge: typeof KnowledgeNS;
let paging: typeof PagingNS;

function uniqProj(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

beforeAll(async () => {
  await rmrf(TMP_DIR);
  await fsp.mkdir(TMP_DIR, { recursive: true });
  await fsp.mkdir(process.env.OBSIDIAN_VAULT_ROOT!, { recursive: true });
  tasks = await import('../src/storage/tasks.js');
  knowledge = await import('../src/storage/knowledge.js');
  paging = await import('../src/utils/pagination.js');
});

afterAll(async () => {
  await rmrf(TMP_DIR);
});

async function seedTasks(project: string, n: number) {
  const created: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = await tasks.createTask({ project, title: `Task ${i}`, tags: i % 2 === 0 ? ['even'] : ['odd'] });
    created.push(t.id);
    // Distinct mtimes so the page order is deterministic (1 ms resolution).
    await new Promise((r) => setTimeout(r, 2));
  }
  return created;
}

// ---------------------------------------------------------------------------
// Cursor pagination: completeness and stability
// ---------------------------------------------------------------------------
describe('listTasksPage: cursor pagination', () => {
  it('walks every item exactly once and reports hasMore', async () => {
    const prj = uniqProj('walk');
    const ids = await seedTasks(prj, 7);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await tasks.listTasksPage(prj, { limit: 3, cursor });
      expect(page.items.length).toBeLessThanOrEqual(3);
      seen.push(...page.items.map((t) => t.id));
      cursor = page.hasMore ? paging.encodeKeyCursor(page.keys[page.keys.length - 1], page.items[page.items.length - 1].id) : null;
      pages++;
      expect(pages).toBeLessThan(10);
    } while (cursor);

    expect(new Set(seen).size).toBe(7);
    expect(seen.sort()).toEqual([...ids].sort());
  });

  it('a cursor stays valid when a newer task is inserted (no duplicates)', async () => {
    const prj = uniqProj('insert');
    await seedTasks(prj, 4);

    const first = await tasks.listTasksPage(prj, { limit: 2 });
    expect(first.items).toHaveLength(2);
    const cursor = paging.encodeKeyCursor(first.keys[1], first.items[1].id);

    // Insert AFTER the cursor was issued: the new task is newer than the cursor key,
    // so it belongs to an earlier page and must not reappear below.
    await tasks.createTask({ project: prj, title: 'Inserted later' });

    const second = await tasks.listTasksPage(prj, { limit: 2, cursor });
    const firstIds = new Set(first.items.map((t) => t.id));
    for (const item of second.items) expect(firstIds.has(item.id)).toBe(false);
  });

  it('rejects a tampered cursor with INVALID_CURSOR', async () => {
    const prj = uniqProj('bad');
    await seedTasks(prj, 2);
    await expect(tasks.listTasksPage(prj, { limit: 2, cursor: 'not-a-cursor' })).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
    });
  });

  it('rejects a cursor issued for another shape (v/keys missing)', async () => {
    const prj = uniqProj('shape');
    await seedTasks(prj, 2);
    const wrong = Buffer.from(JSON.stringify({ v: 1, o: 5 }), 'utf8').toString('base64url');
    await expect(tasks.listTasksPage(prj, { limit: 2, cursor: wrong })).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
    });
  });
});

// ---------------------------------------------------------------------------
// Filters and count-only
// ---------------------------------------------------------------------------
describe('listTasksPage: filters and counts', () => {
  it('filters by tag and reports an exact total', async () => {
    const prj = uniqProj('filter');
    await seedTasks(prj, 6);
    const page = await tasks.listTasksPage(prj, { limit: 50, tag: 'even' });
    expect(page.totalExact).toBe(true);
    expect(page.total).toBe(3);
    expect(page.items.every((t) => (t.tags || []).includes('even'))).toBe(true);
  });

  it('countOnly returns the total without items', async () => {
    const prj = uniqProj('count');
    await seedTasks(prj, 5);
    const page = await tasks.listTasksPage(prj, { limit: 2, countOnly: true });
    expect(page.items).toHaveLength(0);
    expect(page.total).toBe(5);
    expect(page.totalExact).toBe(true);
  });

  it('unfiltered fast path reports file-based total and totalExact=false', async () => {
    const prj = uniqProj('fast');
    await seedTasks(prj, 3);
    const page = await tasks.listTasksPage(prj, { limit: 2 });
    expect(page.total).toBe(3);
    expect(page.totalExact).toBe(false);
    expect(page.hasMore).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Knowledge docs
// ---------------------------------------------------------------------------
describe('listDocsPage', () => {
  it('paginates documents and filters by type with an exact total', async () => {
    const prj = uniqProj('docs');
    for (let i = 0; i < 5; i++) {
      await knowledge.createDoc({ project: prj, title: `Doc ${i}`, content: `body ${i}`, type: i % 2 === 0 ? 'adr' : 'note' });
      await new Promise((r) => setTimeout(r, 2));
    }

    const first = await knowledge.listDocsPage(prj, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const cursor = paging.encodeKeyCursor(first.keys[1], first.items[1].id);
    const second = await knowledge.listDocsPage(prj, { limit: 2, cursor });
    const firstIds = new Set(first.items.map((d) => d.id));
    for (const item of second.items) expect(firstIds.has(item.id)).toBe(false);

    const adr = await knowledge.listDocsPage(prj, { limit: 50, type: 'adr' });
    expect(adr.total).toBe(3);
    expect(adr.totalExact).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// finalizePage: fields, maxBytes, cursor after truncation
// ---------------------------------------------------------------------------
describe('finalizePage', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    id: `id-${i}`,
    updatedAt: `2026-10-0${(i % 9) + 1}T00:00:00.000Z`,
    title: `Row ${i}`,
    description: 'x'.repeat(200),
  }));

  it('projects only the requested fields', () => {
    const result = paging.finalizePage(rows.slice(0, 3), { total: 3, totalExact: true, hasMore: false, limit: 3 }, { limit: 3, fields: ['id', 'title'] }, () => null);
    expect(Object.keys(result.items[0] as object).sort()).toEqual(['id', 'title']);
    expect(result.meta.count).toBe(3);
  });

  it('truncates by maxBytes and hands out a cursor past the kept items', () => {
    const request = { limit: 10, maxBytes: 700 };
    const result = paging.finalizePage(
      rows,
      { total: 10, totalExact: true, hasMore: false, limit: 10 },
      request,
      (index) => paging.encodeKeyCursor(rows[index].updatedAt, rows[index].id),
    );
    expect(result.meta.truncated).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.length).toBeLessThan(10);
    expect(result.meta.hasMore).toBe(true);
    expect(result.meta.nextCursor).toBeTruthy();
    // The cursor must point at the last KEPT item, not at the last item of the page.
    const decoded = paging.decodeKeyCursor(result.meta.nextCursor!);
    expect(decoded.id).toBe((result.items[result.items.length - 1] as { id: string }).id);
  });

  it('countOnly empties items but keeps the total', () => {
    const result = paging.finalizePage(rows, { total: 10, totalExact: true, hasMore: false, limit: 10 }, { countOnly: true }, () => null);
    expect(result.items).toHaveLength(0);
    expect(result.meta.total).toBe(10);
    expect(result.meta.hasMore).toBe(false);
  });

  it('always returns at least one item even when it alone exceeds maxBytes', () => {
    const result = paging.finalizePage(rows, { total: 10, totalExact: true, hasMore: true, limit: 10 }, { maxBytes: 10 }, (i) => paging.encodeKeyCursor(rows[i].updatedAt, rows[i].id));
    expect(result.items).toHaveLength(1);
    expect(result.meta.truncated).toBe(true);
    expect(result.meta.nextCursor).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Ranked pagination (search)
// ---------------------------------------------------------------------------
describe('paginateRanked', () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}` }));

  it('uses the offset when no cursor is given (backward compatibility)', () => {
    const result = paging.paginateRanked(items, { limit: 2, offset: 2 }, 'scope');
    expect(result.items.map((i) => i.id)).toEqual(['r2', 'r3']);
    expect(result.meta.hasMore).toBe(true);
  });

  it('rejects a cursor issued for a different query scope', () => {
    const first = paging.paginateRanked(items, { limit: 2 }, 'scope-a');
    expect(() => paging.paginateRanked(items, { limit: 2, cursor: first.meta.nextCursor! }, 'scope-b')).toThrowError(
      /different query/,
    );
  });

  it('walks all ranked items without gaps', () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: PagingNS.PageResult<{ id: string }> = paging.paginateRanked(items, { limit: 2, cursor }, 'scope');
      seen.push(...page.items.map((i) => i.id));
      cursor = page.meta.nextCursor;
    } while (cursor);
    expect(seen).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
  });
});
