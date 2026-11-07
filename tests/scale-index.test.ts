import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodeKeyCursor } from '../src/utils/pagination.js';

// DATA_DIR must be set before the dynamic imports below: config.ts resolves
// every path at module load.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sc02c-'));
process.env.DATA_DIR = DATA_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(DATA_DIR, 'vault');
process.env.EMBEDDINGS_MODE = 'none';
process.env.STORAGE_INDEX = 'auto';

import type * as TasksNS from '../src/storage/tasks.js';
import type * as KnowledgeNS from '../src/storage/knowledge.js';
import type * as IndexNS from '../src/storage/metadata-index.js';

let tasks: typeof TasksNS;
let knowledge: typeof KnowledgeNS;
let mod: typeof IndexNS;
let index: IndexNS.SqliteMetadataIndex;
let TASKS_DIR = '';
let KNOWLEDGE_DIR = '';

const projectCounter = { n: 0 };
function uniqueProject(prefix: string): string {
  projectCounter.n += 1;
  return `${prefix}-${projectCounter.n}-${Math.random().toString(16).slice(2, 8)}`;
}

function taskFile(project: string, id: string): string {
  return path.join(TASKS_DIR, project, `${id}.json`);
}

function docFile(project: string, id: string): string {
  return path.join(KNOWLEDGE_DIR, project, `${id}.md`);
}

async function withoutIndex<T>(fn: () => Promise<T>): Promise<T> {
  mod.setActiveMetadataIndex(undefined);
  try {
    return await fn();
  } finally {
    mod.setActiveMetadataIndex(index);
  }
}

function filePage<T>(fn: () => Promise<T>): Promise<T> {
  return withoutIndex(fn);
}

async function ensureFilled(project: string): Promise<void> {
  await tasks.listTasksPage(project, { limit: 50 });
  await mod.awaitProjectIndexed(project);
  expect(mod.getProjectIndexFillState(project)).toBe('complete');
}

function taskIds(page: { items: Array<{ id: string }> }): string[] {
  return page.items.map((item) => item.id);
}

function projectRow(project: string): { file_count: number; synced_at: string } | undefined {
  const db = new Database(path.join(DATA_DIR, '.index', 'metadata.db'), { readonly: true });
  try {
    return db
      .prepare('SELECT file_count, synced_at FROM projects WHERE project = ?')
      .get(project) as { file_count: number; synced_at: string } | undefined;
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  mod = await import('../src/storage/metadata-index.js');
  tasks = await import('../src/storage/tasks.js');
  knowledge = await import('../src/storage/knowledge.js');
  const config = await import('../src/config.js');
  TASKS_DIR = config.TASKS_DIR;
  KNOWLEDGE_DIR = config.KNOWLEDGE_DIR;
  index = new mod.SqliteMetadataIndex({ dataDir: DATA_DIR });
  index.open();
  mod.setActiveMetadataIndex(index);
});

beforeEach(() => {
  mod.resetIndexFillStateForTests();
});

afterAll(() => {
  mod.setActiveMetadataIndex(undefined);
  index.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

describe('SC-02c empty index', () => {
  it('serves the full listing from files, then from the index after the fill', async () => {
    const project = uniqueProject('empty');
    const created = await withoutIndex(async () => [
      await tasks.createTask({ project, title: 'a' }),
      await tasks.createTask({ project, title: 'b' }),
    ]);
    const doc = await withoutIndex(() => knowledge.createDoc({ project, title: 'doc-a', content: 'x' }));

    expect(index.listTasks({ project }).total).toBe(0);
    expect(index.isProjectComplete(project)).toBe(false);

    mod.resetIndexReadStats();
    const before = await tasks.listTasksPage(project, { limit: 50 });
    expect(taskIds(before).slice().sort()).toEqual(created.map((t) => t.id).sort());
    expect(before.totalExact).toBe(false);
    expect(mod.getIndexReadStats()).toEqual({ indexReads: 0, filesReads: 1 });

    await mod.awaitProjectIndexed(project);
    expect(mod.getProjectIndexFillState(project)).toBe('complete');

    mod.resetIndexReadStats();
    const after = await tasks.listTasksPage(project, { limit: 50 });
    expect(taskIds(after)).toEqual(taskIds(before));
    expect(after.keys).toEqual(before.keys);
    expect(after.totalExact).toBe(true);
    expect(mod.getIndexReadStats()).toEqual({ indexReads: 1, filesReads: 0 });

    const docs = await knowledge.listDocsPage(project, { limit: 50 });
    expect(docs.items.map((d) => d.id)).toEqual([doc.id]);
  });

  it('keeps the file path when the index is detached (STORAGE_INDEX=off)', async () => {
    const project = uniqueProject('off');
    await tasks.createTask({ project, title: 'only' });

    mod.resetIndexReadStats();
    const page = await withoutIndex(() => tasks.listTasksPage(project, { limit: 50 }));
    expect(page.items).toHaveLength(1);
    expect(mod.getIndexReadStats()).toEqual({ indexReads: 0, filesReads: 1 });
  });
});

describe('SC-02c page equivalence with the file path', () => {
  let project = '';
  let parentId = '';
  let other = '';

beforeAll(async () => {
    project = uniqueProject('eq');
    other = uniqueProject('eq-other');
    const parent = await tasks.createTask({ project, title: 'parent', status: 'pending', priority: 'high', type: 'task', tags: ['a'] });
    parentId = parent.id;
    await tasks.createTask({ project, title: 'child', status: 'in_progress', priority: 'medium', type: 'bug', tags: ['a', 'b'], parentId });
    await tasks.createTask({ project, title: 'completed', status: 'completed', priority: 'low', type: 'feature', tags: ['b'] });
    const archived = await tasks.createTask({ project, title: 'archived', status: 'pending', tags: [] });
    await tasks.archiveTask(project, archived.id);
    const trashed = await tasks.createTask({ project, title: 'trashed', status: 'pending', tags: [] });
    await tasks.trashTask(project, trashed.id);
    await tasks.createTask({ project, title: 'plain', status: 'pending', priority: 'high', tags: [] });
    await tasks.createTask({ project: other, title: 'foreign', status: 'pending' });
    await ensureFilled(project);
  });

  const combos: Array<{ label: string; opts: Parameters<typeof tasks.listTasksPage>[1]; contentFilter: boolean }> = [
    { label: 'no filter', opts: { limit: 50 }, contentFilter: false },
    { label: 'status', opts: { limit: 50, status: 'pending' }, contentFilter: true },
    { label: 'tag', opts: { limit: 50, tag: 'a' }, contentFilter: true },
    { label: 'priority', opts: { limit: 50, priority: 'high' }, contentFilter: true },
    { label: 'parentId', opts: { limit: 50, parentId: '' }, contentFilter: true },
    { label: 'type', opts: { limit: 50, type: 'bug' }, contentFilter: true },
    { label: 'updatedSince (all)', opts: { limit: 50, updatedSince: '2000-01-01T00:00:00.000Z' }, contentFilter: true },
    { label: 'updatedSince (none)', opts: { limit: 50, updatedSince: '2999-01-01T00:00:00.000Z' }, contentFilter: true },
    { label: 'includeArchived', opts: { limit: 50, includeArchived: true }, contentFilter: false },
    { label: 'page of two', opts: { limit: 2 }, contentFilter: false },
  ];

  for (const combo of combos) {
    it(`matches the file path for ${combo.label}`, async () => {
      const opts = { ...combo.opts, parentId: combo.label === 'parentId' ? parentId : combo.opts.parentId };
      const indexed = await tasks.listTasksPage(project, opts);
      const fromFiles = await filePage(() => tasks.listTasksPage(project, opts));
      expect(taskIds(indexed)).toEqual(taskIds(fromFiles));
      expect(indexed.keys).toEqual(fromFiles.keys);
      expect(indexed.hasMore).toBe(fromFiles.hasMore);
      if (combo.contentFilter) expect(indexed.total).toBe(fromFiles.total);
      if (!combo.contentFilter) expect(indexed.totalExact).toBe(true);
    });
  }

  it('countOnly returns the exact filtered total without reading files', async () => {
    mod.resetIndexReadStats();
    const indexed = await tasks.listTasksPage(project, { limit: 50, status: 'pending', countOnly: true });
    const fromFiles = await filePage(() => tasks.listTasksPage(project, { limit: 50, status: 'pending', countOnly: true }));
    expect(indexed.items).toEqual([]);
    expect(indexed.total).toBe(fromFiles.total);
    expect(indexed.totalExact).toBe(true);
    expect(mod.getIndexReadStats()).toEqual({ indexReads: 1, filesReads: 1 });
  });

  it('accepts a file-path cursor and issues a cursor the file path accepts', async () => {
    const fromFilesFirst = await filePage(() => tasks.listTasksPage(project, { limit: 2 }));
    const cursorFromFiles = encodeKeyCursor(fromFilesFirst.keys[1], fromFilesFirst.items[1].id);
    const indexedSecond = await tasks.listTasksPage(project, { limit: 2, cursor: cursorFromFiles });
    const fromFilesSecond = await filePage(() => tasks.listTasksPage(project, { limit: 2, cursor: cursorFromFiles }));
    expect(taskIds(indexedSecond)).toEqual(taskIds(fromFilesSecond));
    expect(indexedSecond.hasMore).toBe(fromFilesSecond.hasMore);

    const indexedFirst = await tasks.listTasksPage(project, { limit: 2 });
    const cursorFromIndex = encodeKeyCursor(indexedFirst.keys[1], indexedFirst.items[1].id);
    const fromFilesWithIndexCursor = await filePage(() => tasks.listTasksPage(project, { limit: 2, cursor: cursorFromIndex }));
    expect(taskIds(fromFilesWithIndexCursor)).toEqual(taskIds(indexedSecond));
  });

  it('orders equal mtime rows by id ascending, like the file path', async () => {
    const tie = uniqueProject('tie');
    const a = await tasks.createTask({ project: tie, title: 'a' });
    const b = await tasks.createTask({ project: tie, title: 'b' });
    const stamp = new Date(Date.now() - 60_000);
    fs.utimesSync(taskFile(tie, a.id), stamp, stamp);
    fs.utimesSync(taskFile(tie, b.id), stamp, stamp);
    await ensureFilled(tie);

    const indexed = await tasks.listTasksPage(tie, { limit: 50 });
    const fromFiles = await filePage(() => tasks.listTasksPage(tie, { limit: 50 }));
    expect(indexed.keys[0]).toBe(indexed.keys[1]);
    expect(taskIds(indexed)).toEqual(taskIds(fromFiles));
    expect(indexed.items[0].id < indexed.items[1].id).toBe(true);
  });
});

describe('SC-02c completeness across ordinary writes', () => {
  it('keeps the project complete after create, update and delete of tasks and documents', async () => {
    const project = uniqueProject('writes');
    const t1 = await tasks.createTask({ project, title: 'one' });
    const d1 = await knowledge.createDoc({ project, title: 'doc-one', content: 'x' });
    await ensureFilled(project);

    const filled = projectRow(project);
    expect(filled?.file_count).toBe(2);
    expect(index.isProjectComplete(project)).toBe(true);

    const t2 = await tasks.createTask({ project, title: 'two' });
    const d2 = await knowledge.createDoc({ project, title: 'doc-two', content: 'y' });
    expect(projectRow(project)?.file_count).toBe(4);
    expect(index.isProjectComplete(project)).toBe(true);

    await tasks.updateTask(project, t2.id, { status: 'in_progress' });
    await knowledge.updateDoc(project, d2.id, { title: 'doc-two renamed' });
    expect(projectRow(project)?.file_count).toBe(4);
    expect(index.isProjectComplete(project)).toBe(true);

    await tasks.deleteTaskPermanent(project, t1.id);
    await knowledge.deleteDocPermanent(project, d1.id);
    expect(projectRow(project)?.file_count).toBe(2);
    expect(index.isProjectComplete(project)).toBe(true);

    mod.resetIndexReadStats();
    const page = await tasks.listTasksPage(project, { limit: 50 });
    const docs = await knowledge.listDocsPage(project, { limit: 50 });
    expect(taskIds(page)).toEqual([t2.id]);
    expect(docs.items.map((d) => d.id)).toEqual([d2.id]);
    expect(mod.getIndexReadStats()).toEqual({ indexReads: 2, filesReads: 0 });
    expect(projectRow(project)?.synced_at).toBe(filled?.synced_at);
    expect(mod.getProjectIndexFillState(project)).toBe('complete');
  });
});

describe('SC-02c self-heal and degraded modes', () => {
  it('heals an out-of-band edit when the row is on the page', async () => {
    const project = uniqueProject('heal');
    const task = await tasks.createTask({ project, title: 'edit me', status: 'pending' });
    await ensureFilled(project);

    const file = taskFile(project, task.id);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.status = 'completed';
    fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`);
    const future = new Date(Date.now() + 2_000);
    fs.utimesSync(file, future, future);

    const page = await tasks.listTasksPage(project, { limit: 50 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].status).toBe('completed');
    expect(index.listTasks({ project, status: 'completed' }).total).toBe(1);

    mod.resetIndexReadStats();
    const filtered = await tasks.listTasksPage(project, { limit: 50, status: 'completed' });
    expect(taskIds(filtered)).toEqual([task.id]);
    expect(mod.getIndexReadStats()).toEqual({ indexReads: 1, filesReads: 0 });
  });

  it('survives a file deleted out of band and stays on the index', async () => {
    const project = uniqueProject('orphan');
    const gone = await tasks.createTask({ project, title: 'gone' });
    const kept = await tasks.createTask({ project, title: 'kept' });
    await ensureFilled(project);

    fs.unlinkSync(taskFile(project, gone.id));

    const page = await tasks.listTasksPage(project, { limit: 50 });
    expect(taskIds(page)).toEqual([kept.id]);
    expect(page.total).toBe(1);
    expect(index.listTasks({ project }).total).toBe(1);

    mod.resetIndexReadStats();
    await tasks.listTasksPage(project, { limit: 50 });
    expect(mod.getIndexReadStats()).toEqual({ indexReads: 1, filesReads: 0 });
  });

  it('falls back to the file path while the index is dirty and recovers after a rebuild', async () => {
    const project = uniqueProject('dirty');
    await tasks.createTask({ project, title: 'one', status: 'pending' });
    await ensureFilled(project);

    index.markDirty('test');
    expect(index.isProjectComplete(project)).toBe(false);

    mod.resetIndexReadStats();
    const dirtyPage = await tasks.listTasksPage(project, { limit: 50, status: 'pending' });
    expect(dirtyPage.items).toHaveLength(1);
    expect(mod.getIndexReadStats()).toEqual({ indexReads: 0, filesReads: 1 });

    await index.rebuild({ tasksDir: TASKS_DIR, knowledgeDir: KNOWLEDGE_DIR });
    expect(index.isProjectComplete(project)).toBe(true);

    mod.resetIndexReadStats();
    await tasks.listTasksPage(project, { limit: 50, status: 'pending' });
    expect(mod.getIndexReadStats()).toEqual({ indexReads: 1, filesReads: 0 });
  });
});

describe('SC-02c knowledge pages', () => {
  it('matches the file path across filters, pagination and countOnly', async () => {
    const project = uniqueProject('docs');
    const parent = await knowledge.createDoc({ project, title: 'parent', content: 'p', type: 'adr', tags: ['a'] });
    await knowledge.createDoc({ project, title: 'child', content: 'c', type: 'api', tags: ['a', 'b'], parentId: parent.id });
    await knowledge.createDoc({ project, title: 'feature', content: 'f', type: 'feature', tags: ['b'] });
    const archived = await knowledge.createDoc({ project, title: 'archived', content: 'z' });
    await knowledge.updateDoc(project, archived.id, { archived: true } as never);
    const trashed = await knowledge.createDoc({ project, title: 'trashed', content: 't' });
    await knowledge.updateDoc(project, trashed.id, { trashed: true } as never);
    await ensureFilled(project);

    const combos: Array<{ label: string; opts: Parameters<typeof knowledge.listDocsPage>[1]; contentFilter: boolean }> = [
      { label: 'no filter', opts: { limit: 50 }, contentFilter: false },
      { label: 'tag', opts: { limit: 50, tag: 'a' }, contentFilter: true },
      { label: 'type', opts: { limit: 50, type: 'api' }, contentFilter: true },
      { label: 'parentId', opts: { limit: 50, parentId: parent.id }, contentFilter: true },
      { label: 'includeArchived', opts: { limit: 50, includeArchived: true }, contentFilter: false },
      { label: 'page of one', opts: { limit: 1 }, contentFilter: false },
    ];

    for (const combo of combos) {
      const indexed = await knowledge.listDocsPage(project, combo.opts);
      const fromFiles = await filePage(() => knowledge.listDocsPage(project, combo.opts));
      expect(indexed.items.map((d) => d.id)).toEqual(fromFiles.items.map((d) => d.id));
      expect(indexed.keys).toEqual(fromFiles.keys);
      expect(indexed.hasMore).toBe(fromFiles.hasMore);
      if (combo.contentFilter) expect(indexed.total).toBe(fromFiles.total);
    }

    const cursorPage = await knowledge.listDocsPage(project, { limit: 1 });
    const cursor = encodeKeyCursor(cursorPage.keys[0], cursorPage.items[0].id);
    const indexedSecond = await knowledge.listDocsPage(project, { limit: 1, cursor });
    const fromFilesSecond = await filePage(() => knowledge.listDocsPage(project, { limit: 1, cursor }));
    expect(indexedSecond.items.map((d) => d.id)).toEqual(fromFilesSecond.items.map((d) => d.id));

    const counted = await knowledge.listDocsPage(project, { limit: 50, tag: 'a', countOnly: true });
    const countedFiles = await filePage(() => knowledge.listDocsPage(project, { limit: 50, tag: 'a', countOnly: true }));
    expect(counted.items).toEqual([]);
    expect(counted.total).toBe(countedFiles.total);
    expect(counted.totalExact).toBe(true);
  });

  it('heals an out-of-band document edit and a deleted document', async () => {
    const project = uniqueProject('docs-heal');
    const edited = await knowledge.createDoc({ project, title: 'edited', content: 'a', type: 'adr' });
    const gone = await knowledge.createDoc({ project, title: 'gone', content: 'b' });
    await ensureFilled(project);

    const file = docFile(project, edited.id);
    const raw = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, raw.replace('type: adr', 'type: api'));
    const future = new Date(Date.now() + 2_000);
    fs.utimesSync(file, future, future);
    fs.unlinkSync(docFile(project, gone.id));

    const page = await knowledge.listDocsPage(project, { limit: 50 });
    expect(page.items.map((d) => d.id)).toEqual([edited.id]);
    expect(page.items[0].type).toBe('api');
    expect(page.total).toBe(1);
    expect(index.listDocs({ project }).total).toBe(1);
  });
});

describe('SC-02c partial index for the default count', () => {
  function plan(sql: string, params: unknown[]): string {
    const db = new Database(path.join(DATA_DIR, '.index', 'metadata.db'), { readonly: true });
    try {
      return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>)
        .map((row) => row.detail)
        .join('\n');
    } finally {
      db.close();
    }
  }

  it('plans the active-task count through the partial index', () => {
    const detail = plan('SELECT COUNT(*) FROM tasks WHERE project = ? AND archived = 0 AND trashed = 0', ['x']);
    expect(detail).toContain('idx_tasks_active_page');
    expect(detail).not.toMatch(/\bSCAN tasks\b/);
  });

  it('plans the active-document count through the partial index', () => {
    const detail = plan('SELECT COUNT(*) FROM docs WHERE project = ? AND archived = 0 AND trashed = 0', ['x']);
    expect(detail).toContain('idx_docs_active_page');
    expect(detail).not.toMatch(/\bSCAN docs\b/);
  });
});
