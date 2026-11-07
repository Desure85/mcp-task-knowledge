import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import matter from 'gray-matter';

// DATA_DIR must be set before the dynamic imports below: config.ts resolves
// every path at module load.
const TMP_DIR = path.join(process.cwd(), '.tmp-tests-page-cursor-filter');
process.env.DATA_DIR = TMP_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_DIR, 'vault');
process.env.EMBEDDINGS_MODE = 'none';
process.env.STORAGE_INDEX = 'off';

import type * as TasksNS from '../src/storage/tasks.js';
import type * as KnowledgeNS from '../src/storage/knowledge.js';
import type * as PagingNS from '../src/utils/pagination.js';
import type * as IndexNS from '../src/storage/metadata-index.js';

let tasks: typeof TasksNS;
let knowledge: typeof KnowledgeNS;
let paging: typeof PagingNS;
let indexMod: typeof IndexNS;
let TASKS_DIR = '';
let KNOWLEDGE_DIR = '';

/**
 * Whole seconds: `utimes` then reads back an exact multiple of 1000 ms, so page
 * order is deterministic without any sleep and without relying on the clock.
 */
const BASE_EPOCH = 1_700_000_000;

interface FixtureRow {
  id: string;
  matches: boolean;
  archived?: boolean;
  trashed?: boolean;
  /** Filename differs from the frontmatter id (docs only). */
  fileId?: string;
}

/**
 * Interleaved fixture: matching and non-matching rows alternate by mtime, plus
 * one archived and one trashed row that pass every filter but are excluded by
 * default. Rows are returned newest-first, which is the page order.
 */
function buildRows(): FixtureRow[] {
  const rows: FixtureRow[] = [];
  for (let i = 0; i < 12; i++) {
    rows.push({ id: `r${String(i).padStart(2, '0')}`, matches: i % 2 === 0 });
  }
  rows.splice(5, 0, { id: 'r-archived', matches: true, archived: true });
  rows.splice(9, 0, { id: 'r-trashed', matches: true, trashed: true });
  return rows;
}

async function setExactMtime(file: string, orderFromNewest: number, total: number): Promise<void> {
  const seconds = BASE_EPOCH + (total - orderFromNewest);
  const stamp = new Date(seconds * 1000);
  await fsp.utimes(file, stamp, stamp);
}

async function writeTaskFixture(project: string, rows: FixtureRow[]): Promise<void> {
  const dir = path.join(TASKS_DIR, project);
  await fsp.mkdir(dir, { recursive: true });
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const task = {
      id: row.id,
      project,
      title: row.id,
      description: '',
      status: row.matches ? 'pending' : 'done',
      type: row.matches ? 'bug' : 'task',
      priority: row.matches ? 'high' : 'low',
      tags: row.matches ? ['keep'] : ['other'],
      links: [],
      parentId: row.matches ? 'p-root' : 'p-other',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: row.matches ? '2026-01-02T00:00:00.000Z' : '2026-01-01T00:00:00.000Z',
      archived: Boolean(row.archived),
      trashed: Boolean(row.trashed),
    };
    const file = path.join(dir, `${row.id}.json`);
    await fsp.writeFile(file, JSON.stringify(task, null, 2));
    await setExactMtime(file, i, rows.length);
  }
}

async function writeDocFixture(project: string, rows: FixtureRow[]): Promise<void> {
  const dir = path.join(KNOWLEDGE_DIR, project);
  await fsp.mkdir(dir, { recursive: true });
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const fileId = row.fileId ?? row.id;
    const body = matter.stringify(`body of ${row.id}`, {
      id: row.id,
      project,
      title: row.id,
      tags: row.matches ? ['keep'] : ['other'],
      type: row.matches ? 'adr' : 'note',
      parentId: row.matches ? 'd-root' : 'd-other',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: row.matches ? '2026-01-02T00:00:00.000Z' : '2026-01-01T00:00:00.000Z',
      archived: Boolean(row.archived),
      trashed: Boolean(row.trashed),
    });
    const file = path.join(dir, `${fileId}.md`);
    await fsp.writeFile(file, body);
    await setExactMtime(file, i, rows.length);
  }
}

function expectedIds(rows: FixtureRow[]): string[] {
  return rows.filter((r) => r.matches && !r.archived && !r.trashed).map((r) => r.id);
}

interface PageLike {
  items: Array<{ id: string }>;
  keys: string[];
  hasMore: boolean;
  total: number;
  totalExact: boolean;
}

interface WalkResult {
  ids: string[];
  pageSizes: number[];
  hasMoreFlags: boolean[];
  totals: number[];
}

/**
 * Walks every page through the public `nextCursor` contract and returns what
 * the caller would actually see: ids in order, page sizes, hasMore flags.
 */
async function walk(
  fetch: (cursor: string | null) => Promise<PageLike>,
  limit: number,
): Promise<WalkResult> {
  const ids: string[] = [];
  const pageSizes: number[] = [];
  const hasMoreFlags: boolean[] = [];
  const totals: number[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 100; guard++) {
    const page = await fetch(cursor);
    pageSizes.push(page.items.length);
    hasMoreFlags.push(page.hasMore);
    totals.push(page.total);
    ids.push(...page.items.map((item) => item.id));
    if (!page.hasMore) {
      return { ids, pageSizes, hasMoreFlags, totals };
    }
    expect(page.items.length).toBeGreaterThan(0);
    const last = page.items[page.items.length - 1];
    cursor = paging.encodeKeyCursor(page.keys[page.keys.length - 1], last.id);
  }
  expect.fail('cursor walk did not terminate within 100 pages — the cursor never advances');
}

function expectCompleteWalk(result: WalkResult, expected: string[], limit: number): void {
  // No gaps, no duplicates, exact expected set.
  expect(new Set(result.ids).size).toBe(result.ids.length);
  expect(result.ids).toEqual(expected);
  // Every page but the last is exactly `limit`; the last one is not empty.
  for (let i = 0; i < result.pageSizes.length - 1; i++) {
    expect(result.pageSizes[i]).toBe(limit);
    expect(result.hasMoreFlags[i]).toBe(true);
  }
  expect(result.hasMoreFlags[result.hasMoreFlags.length - 1]).toBe(false);
  expect(result.pageSizes[result.pageSizes.length - 1]).toBeGreaterThan(0);
  // The reported total is the number of records that pass the filter.
  for (const total of result.totals) expect(total).toBe(expected.length);
}

beforeAll(async () => {
  await fsp.rm(TMP_DIR, { recursive: true, force: true });
  await fsp.mkdir(TMP_DIR, { recursive: true });
  await fsp.mkdir(process.env.OBSIDIAN_VAULT_ROOT!, { recursive: true });
  tasks = await import('../src/storage/tasks.js');
  knowledge = await import('../src/storage/knowledge.js');
  paging = await import('../src/utils/pagination.js');
  indexMod = await import('../src/storage/metadata-index.js');
  const config = await import('../src/config.js');
  TASKS_DIR = config.TASKS_DIR;
  KNOWLEDGE_DIR = config.KNOWLEDGE_DIR;
});

afterAll(async () => {
  await fsp.rm(TMP_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tasks: a content filter must page over the filtered list, not over all files
// ---------------------------------------------------------------------------
describe('listTasksPage: filtered pages skip nothing', () => {
  const rows = buildRows();
  const expected = expectedIds(rows);
  const project = 'cursor-filter-tasks';

  beforeAll(async () => {
    await writeTaskFixture(project, rows);
  });

  const filters: Array<[string, Record<string, unknown>]> = [
    ['status', { status: 'pending' }],
    ['tag', { tag: 'keep' }],
    ['priority', { priority: 'high' }],
    ['type', { type: 'bug' }],
    ['parentId', { parentId: 'p-root' }],
    ['updatedSince', { updatedSince: '2026-01-02T00:00:00.000Z' }],
  ];

  for (const [name, filter] of filters) {
    it(`walks every matching task across pages (filter: ${name})`, async () => {
      const result = await walk((cursor) => tasks.listTasksPage(project, { limit: 2, cursor, ...filter }), 2);
      expectCompleteWalk(result, expected, 2);
    });
  }
});

// ---------------------------------------------------------------------------
// Documents: same invariant, including a filename that differs from the payload id
// ---------------------------------------------------------------------------
describe('listDocsPage: filtered pages skip nothing', () => {
  const rows = buildRows();
  const expected = expectedIds(rows);
  const project = 'cursor-filter-docs';

  beforeAll(async () => {
    await writeDocFixture(project, rows);
  });

  const filters: Array<[string, Record<string, unknown>]> = [
    ['tag', { tag: 'keep' }],
    ['type', { type: 'adr' }],
    ['parentId', { parentId: 'd-root' }],
  ];

  for (const [name, filter] of filters) {
    it(`walks every matching doc across pages (filter: ${name})`, async () => {
      const result = await walk((cursor) => knowledge.listDocsPage(project, { limit: 2, cursor, ...filter }), 2);
      expectCompleteWalk(result, expected, 2);
    });
  }

  it('positions the cursor by the payload id, not by the filename', async () => {
    const divergingProject = 'cursor-filter-docs-diverging';
    const diverging: FixtureRow[] = [];
    for (let i = 0; i < 6; i++) {
      diverging.push({
        id: `d${String(i).padStart(2, '0')}`,
        fileId: `file-${String(i).padStart(2, '0')}`,
        matches: i % 2 === 0,
      });
    }
    await writeDocFixture(divergingProject, diverging);
    const result = await walk(
      (cursor) => knowledge.listDocsPage(divergingProject, { limit: 1, cursor, tag: 'keep' }),
      1,
    );
    expectCompleteWalk(result, expectedIds(diverging), 1);
  });
});

// ---------------------------------------------------------------------------
// Cross-path: the file path and the index path must agree on ids and order
// ---------------------------------------------------------------------------
describe('file path vs index path: same ids, same order', () => {
  const rows = buildRows();
  const project = 'cursor-filter-cross';
  let index: IndexNS.SqliteMetadataIndex;

  beforeAll(async () => {
    await writeTaskFixture(project, rows);
    index = new indexMod.SqliteMetadataIndex({ dataDir: TMP_DIR });
    index.open();
    indexMod.setActiveMetadataIndex(index);
    // First page read triggers the project fill; wait for it to complete.
    await tasks.listTasksPage(project, { limit: 50 });
    await indexMod.awaitProjectIndexed(project);
    expect(indexMod.getProjectIndexFillState(project)).toBe('complete');
  });

  afterAll(() => {
    indexMod.setActiveMetadataIndex(undefined);
    index.close();
  });

  for (const [name, filter] of [
    ['status', { status: 'pending' }],
    ['tag', { tag: 'keep' }],
  ] as Array<[string, Record<string, unknown>]>) {
    it(`agrees on id order for filter ${name}`, async () => {
      const viaIndex = await walk((cursor) => tasks.listTasksPage(project, { limit: 2, cursor, ...filter }), 2);
      indexMod.setActiveMetadataIndex(undefined);
      let viaFiles: WalkResult;
      try {
        viaFiles = await walk((cursor) => tasks.listTasksPage(project, { limit: 2, cursor, ...filter }), 2);
      } finally {
        indexMod.setActiveMetadataIndex(index);
      }
      expect(viaIndex.ids).toEqual(viaFiles.ids);
      expectCompleteWalk(viaFiles, expectedIds(rows), 2);
      expectCompleteWalk(viaIndex, expectedIds(rows), 2);
    });
  }
});
