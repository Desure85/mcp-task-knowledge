/**
 * SC-03a — FTS5 index over tasks and knowledge (storage layer).
 *
 * The point of the index is that query terms and indexed terms come from the *same* tokenizer as
 * the in-memory BM25 (`src/search/bm25.ts`), otherwise recall changes silently when the read path
 * switches over (SC-03c). These tests pin that parity together with filtering, upsert semantics
 * and schema handling.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { FtsSearchIndex, FTS_SCHEMA_VERSION, resolveStoreId, type FtsRecord } from '../src/search/fts-index.js';

let tmpDir: string;
let index: FtsSearchIndex;

function record(overrides: Partial<FtsRecord> & { id: string; text: string }): FtsRecord {
  return { store: 's1', kind: 'task', project: 'p', updatedAt: '2026-11-08T00:00:00.000Z', ...overrides };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc03a-'));
  index = FtsSearchIndex.open(path.join(tmpDir, 'search.db'));
});

afterEach(() => {
  index.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('SC-03a: tokenisation parity with in-memory BM25', () => {
  it('matches snake_case against camelCase and vice versa', () => {
    index.upsert([record({ id: 'a', text: 'call getUserProfile before saving' })]);
    expect(index.query({ q: 'get_user_profile' }).map((hit) => hit.id)).toEqual(['a']);

    index.upsert([record({ id: 'b', text: 'call get_user_profile before saving' })]);
    expect(index.query({ q: 'getUserProfile' }).map((hit) => hit.id)).toContain('b');
  });

  it('matches an inner segment of a camelCase identifier', () => {
    // Prefix expansion alone cannot rescue this: `getuserprofile` does not start with `user`, so
    // the case only passes when the index stores split identifiers (the BM25 tokenizer).
    index.upsert([record({ id: 'a', text: 'call getUserProfile before saving' })]);
    expect(index.query({ q: 'userProfile' }).map((hit) => hit.id)).toEqual(['a']);
  });

  it('matches acronym runs', () => {
    index.upsert([record({ id: 'a', text: 'the HTTPServer is down' })]);
    expect(index.query({ q: 'http server' }).map((hit) => hit.id)).toEqual(['a']);
  });

  it('matches a ticket id in both spellings', () => {
    index.upsert([record({ id: 'a', text: 'fixed in DEV-7613 yesterday' })]);
    expect(index.query({ q: 'DEV-7613' }).map((hit) => hit.id)).toEqual(['a']);
    expect(index.query({ q: 'dev 7613' }).map((hit) => hit.id)).toEqual(['a']);
  });

  it('matches Russian morphology-free terms', () => {
    index.upsert([record({ id: 'a', text: 'документы удаляются в архив' })]);
    expect(index.query({ q: 'документы архив' }).map((hit) => hit.id)).toEqual(['a']);
  });

  it('expands prefixes so `auth` finds `authentication`', () => {
    index.upsert([record({ id: 'a', text: 'the authentication module rejects expired tokens' })]);
    expect(index.query({ q: 'auth' }).map((hit) => hit.id)).toEqual(['a']);
  });

  it('returns nothing for a stopword-only query', () => {
    index.upsert([record({ id: 'a', text: 'the quick brown fox' })]);
    expect(index.query({ q: 'the and of' })).toEqual([]);
  });
});

describe('SC-03a: filtering and ranking', () => {
  it('filters by kind and project', () => {
    index.upsert([
      record({ id: 't1', text: 'auth token rotation', kind: 'task', project: 'alpha' }),
      record({ id: 'd1', text: 'auth token rotation', kind: 'doc', project: 'alpha' }),
      record({ id: 't2', text: 'auth token rotation', kind: 'task', project: 'beta' }),
    ]);
    expect(index.query({ q: 'auth rotation', kind: 'doc' }).map((hit) => `${hit.kind}:${hit.id}`)).toEqual(['doc:d1']);
    expect(index.query({ q: 'auth rotation', project: 'beta' }).map((hit) => hit.id)).toEqual(['t2']);
    expect(index.query({ q: 'auth rotation', kind: 'task', project: 'alpha' }).map((hit) => hit.id)).toEqual(['t1']);
  });

  it('ranks the document matching more query terms above a single-term match', () => {
    index.upsert([
      record({ id: 'both', text: 'authentication token rotation policy' }),
      record({ id: 'one', text: 'authentication guide' }),
    ]);
    const hits = index.query({ q: 'authentication token rotation' });
    expect(hits[0].id).toBe('both');
    expect(hits.map((hit) => hit.id)).toContain('one');
  });

  it('honours the limit', () => {
    const records = Array.from({ length: 10 }, (_, i) => record({ id: `r${i}`, text: `authentication ${i}` }));
    index.upsert(records);
    expect(index.query({ q: 'authentication', limit: 3 })).toHaveLength(3);
  });
});

describe('SC-03a: write semantics', () => {
  it('replaces the terms of an existing record', () => {
    index.upsert([record({ id: 'a', text: 'legacy behaviour' })]);
    expect(index.query({ q: 'legacy' })).toHaveLength(1);
    index.upsert([record({ id: 'a', text: 'modern behaviour' })]);
    expect(index.query({ q: 'legacy' })).toHaveLength(0);
    expect(index.query({ q: 'modern' }).map((hit) => hit.id)).toEqual(['a']);
    expect(index.stats().rows).toBe(1);
  });

  it('removes a single record', () => {
    index.upsert([record({ id: 'a', text: 'to be removed' }), record({ id: 'b', text: 'to be removed' })]);
    expect(index.remove('s1', 'task', 'a')).toBe(true);
    expect(index.remove('s1', 'task', 'a')).toBe(false);
    expect(index.query({ q: 'removed' }).map((hit) => hit.id)).toEqual(['b']);
  });

  it('rebuilds the whole index in one go', () => {
    index.upsert([record({ id: 'old', text: 'stale entry' })]);
    index.rebuild([record({ id: 'new', text: 'fresh entry' })]);
    expect(index.query({ q: 'stale' })).toEqual([]);
    expect(index.query({ q: 'fresh' }).map((hit) => hit.id)).toEqual(['new']);
    expect(index.stats().rows).toBe(1);
  });

  it('reports counts per kind', () => {
    index.upsert([record({ id: 't', text: 'a' }), record({ id: 'd', kind: 'doc', text: 'b' })]);
    const stats = index.stats();
    expect(stats).toMatchObject({ rows: 2, tasks: 1, docs: 1, schemaVersion: FTS_SCHEMA_VERSION });
    expect(stats.dbBytes).toBeGreaterThan(0);
  });
});

describe('SC-03a: schema handling', () => {
  it('drops and recreates the table when the stored schema version differs', () => {
    const file = path.join(tmpDir, 'versioned.db');
    const first = FtsSearchIndex.open(file);
    first.upsert([record({ id: 'a', text: 'before upgrade' })]);
    first.close();

    const raw = new Database(file);
    raw.prepare('UPDATE search_meta SET value = ? WHERE key = ?').run(String(FTS_SCHEMA_VERSION + 1), 'schema_version');
    raw.close();

    const second = FtsSearchIndex.open(file);
    expect(second.stats()).toMatchObject({ rows: 0, schemaVersion: FTS_SCHEMA_VERSION });
    expect(second.query({ q: 'upgrade' })).toEqual([]);
    second.close();
  });

  it('keeps data when the schema version matches', () => {
    const file = path.join(tmpDir, 'stable.db');
    const first = FtsSearchIndex.open(file);
    first.upsert([record({ id: 'a', text: 'survives restart' })]);
    first.close();

    const second = FtsSearchIndex.open(file);
    expect(second.query({ q: 'survives' }).map((hit) => hit.id)).toEqual(['a']);
    second.close();
  });
});

describe('SC-03a2: several storages in one index file', () => {
  it('keeps the same project name and id in two stores apart', () => {
    // Legacy task ids come from file names, so an id collision across stores is realistic.
    index.upsert([
      record({ store: 'store-a', id: 'shared', project: 'p', text: 'alpha storage sentence' }),
      record({ store: 'store-b', id: 'shared', project: 'p', text: 'beta storage sentence' }),
    ]);

    expect(index.query({ q: 'alpha', store: 'store-a' }).map((hit) => hit.id)).toEqual(['shared']);
    expect(index.query({ q: 'alpha', store: 'store-b' })).toEqual([]);
    expect(index.query({ q: 'beta', store: 'store-b' }).map((hit) => hit.id)).toEqual(['shared']);
    expect(index.query({ q: 'sentence', store: 'store-a' })).toHaveLength(1);
    expect(index.query({ q: 'sentence' }).length).toBe(2); // deliberate cross-store tooling sees both
  });

  it('scopes stats and counts per store', () => {
    index.upsert([
      record({ store: 'store-a', id: 't1', text: 'a' }),
      record({ store: 'store-a', id: 'd1', kind: 'doc', text: 'b' }),
      record({ store: 'store-b', id: 't2', text: 'c' }),
    ]);
    expect(index.stats('store-a')).toMatchObject({ rows: 2, tasks: 1, docs: 1 });
    expect(index.stats('store-b')).toMatchObject({ rows: 1, tasks: 1, docs: 0 });
    expect(index.stats()).toMatchObject({ rows: 3, tasks: 2, docs: 1 });
    expect(index.stores()).toEqual([
      { store: 'store-a', rows: 2, tasks: 1, docs: 1 },
      { store: 'store-b', rows: 1, tasks: 1, docs: 0 },
    ]);
  });

  it('removes only the named store row and can clear a whole store', () => {
    index.upsert([
      record({ store: 'store-a', id: 'shared', text: 'shared text' }),
      record({ store: 'store-b', id: 'shared', text: 'shared text' }),
    ]);

    expect(index.remove('store-a', 'task', 'shared')).toBe(true);
    expect(index.query({ q: 'shared', store: 'store-b' })).toHaveLength(1);

    index.upsert([record({ store: 'store-a', id: 'other', text: 'shared text' })]);
    expect(index.clearStore('store-a')).toBe(1);
    expect(index.stats('store-a').rows).toBe(0);
    expect(index.stats('store-b').rows).toBe(1);
  });

  it('normalises store ids so one directory is one store', () => {
    const base = path.join(tmpDir, 'tasks');
    const withSeparator = base.endsWith(path.sep) ? base : base + path.sep;
    expect(resolveStoreId(base)).toBe(resolveStoreId(withSeparator));
    expect(resolveStoreId(base)).toBe(resolveStoreId(path.join(tmpDir, '.', 'tasks')));
    if (process.platform === 'win32') {
      expect(resolveStoreId(base.toUpperCase())).toBe(resolveStoreId(base.toLowerCase()));
    }
  });
});

describe('SC-03b: storage writes keep the index in step', () => {
  let tasks: typeof import('../src/storage/tasks.js');
  let knowledge: typeof import('../src/storage/knowledge.js');
  let indexer: typeof import('../src/search/fts-indexer.js');
  let fts: FtsSearchIndex;

  const project = () => `sc03b-${Math.random().toString(16).slice(2, 10)}`;

  beforeAll(async () => {
    tasks = await import('../src/storage/tasks.js');
    knowledge = await import('../src/storage/knowledge.js');
    indexer = await import('../src/search/fts-indexer.js');
  });

  beforeEach(() => {
    fts = FtsSearchIndex.inMemory();
    indexer.setActiveFtsIndex(fts);
  });

  afterEach(() => {
    indexer.setActiveFtsIndex(undefined);
    fts.close();
  });

  const taskHits = (query: string) =>
    fts.query({ q: query, store: indexer.taskStoreId(), kind: 'task' });
  const docHits = (query: string) =>
    fts.query({ q: query, store: indexer.knowledgeStoreId(), kind: 'doc' });

  it('indexes a created task under the task store', async () => {
    const prj = project();
    const task = await tasks.createTask({ project: prj, title: 'Falcon migration checklist' });

    const hits = taskHits('falcon');
    expect(hits.map((hit) => hit.id)).toContain(task.id);
    expect(hits[0].store).toBe(indexer.taskStoreId());
  });

  it('drops the old terms when a task title changes', async () => {
    const prj = project();
    const task = await tasks.createTask({ project: prj, title: 'Falcon migration checklist' });
    await tasks.updateTask(prj, task.id, { title: 'Osprey rollout checklist' });

    expect(taskHits('falcon')).toHaveLength(0);
    expect(taskHits('osprey').map((hit) => hit.id)).toContain(task.id);
  });

  it('removes a trashed task and brings it back on restore', async () => {
    const prj = project();
    const task = await tasks.createTask({ project: prj, title: 'Kestrel audit notes' });

    await tasks.trashTask(prj, task.id);
    expect(taskHits('kestrel')).toHaveLength(0);

    await tasks.restoreTask(prj, task.id);
    expect(taskHits('kestrel').map((hit) => hit.id)).toContain(task.id);
  });

  it('removes a permanently deleted task', async () => {
    const prj = project();
    const task = await tasks.createTask({ project: prj, title: 'Merlin retention policy' });

    expect(await tasks.deleteTaskPermanent(prj, task.id)).toBe(true);
    expect(taskHits('merlin')).toHaveLength(0);
  });

  it('indexes knowledge writes under the knowledge store and drops stale content', async () => {
    const prj = project();
    const doc = await knowledge.createDoc({
      project: prj,
      title: 'Deployment runbook',
      content: 'Blue green switchover with a canary step',
    });

    const created = docHits('canary');
    expect(created.map((hit) => hit.id)).toContain(doc.id);
    expect(created[0].store).toBe(indexer.knowledgeStoreId());

    await knowledge.updateDoc(prj, doc.id, { content: 'Rollback drill with a shadow reader' });
    expect(docHits('canary')).toHaveLength(0);
    expect(docHits('shadow').map((hit) => hit.id)).toContain(doc.id);
  });

  it('removes an archived doc, restores it, then drops it on permanent delete', async () => {
    const prj = project();
    const doc = await knowledge.createDoc({ project: prj, title: 'Harbor notes', content: 'berth allocation' });

    await knowledge.archiveDoc(prj, doc.id);
    expect(docHits('berth')).toHaveLength(0);

    await knowledge.restoreDoc(prj, doc.id);
    expect(docHits('berth').map((hit) => hit.id)).toContain(doc.id);

    expect(await knowledge.deleteDocPermanent(prj, doc.id)).toBe(true);
    expect(docHits('berth')).toHaveLength(0);
  });

  it('keeps the write and flags the index when the index write fails', async () => {
    const prj = project();
    let dirtyReason: string | undefined;
    const broken = {
      upsert: () => {
        throw new Error('index is read-only');
      },
      remove: () => {
        throw new Error('index is read-only');
      },
      removeProject: () => {
        throw new Error('index is read-only');
      },
      markDirty: (reason: string) => {
        dirtyReason = reason;
      },
    } as unknown as FtsSearchIndex;
    indexer.setActiveFtsIndex(broken);

    const task = await tasks.createTask({ project: prj, title: 'Petrel incident review' });

    expect(task.id).toBeTruthy();
    expect(dirtyReason).toContain('task write');
    expect(dirtyReason).toContain('index is read-only');
  });

  it('clears the dirty flag only on a full rebuild', () => {
    fts.upsert([record({ id: 'kept', text: 'kept term' })]);
    expect(fts.stats().dirty).toBe(false);

    fts.markDirty('boom');
    expect(fts.stats().dirty).toBe(true);
    expect(fts.dirtyReason()).toBe('boom');

    fts.rebuild([]);
    expect(fts.stats().dirty).toBe(false);
  });
});

describe('SC-03c: the search tools read the index', () => {
  let tasks: typeof import('../src/storage/tasks.js');
  let knowledge: typeof import('../src/storage/knowledge.js');
  let indexer: typeof import('../src/search/fts-indexer.js');
  let metadata: typeof import('../src/storage/metadata-index.js');
  let registerSearchTools: typeof import('../src/register/search.js').registerSearchTools;
  let meta: NonNullable<ReturnType<typeof metadata.createMetadataIndex>>;

  const project = () => `sc03c-${Math.random().toString(16).slice(2, 10)}`;
  const envelope = (result: { content: Array<{ text: string }> }) => JSON.parse(result.content[0].text);

  function makeTools() {
    const tools = new Map<string, (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>>();
    registerSearchTools({
      server: {
        registerTool: (name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>) => {
          tools.set(name, handler);
        },
      },
      ensureVectorAdapter: async () => undefined,
    } as unknown as Parameters<typeof registerSearchTools>[0]);
    return tools;
  }

  beforeAll(async () => {
    tasks = await import('../src/storage/tasks.js');
    knowledge = await import('../src/storage/knowledge.js');
    indexer = await import('../src/search/fts-indexer.js');
    metadata = await import('../src/storage/metadata-index.js');
    registerSearchTools = (await import('../src/register/search.js')).registerSearchTools;
    const created = metadata.createMetadataIndex({ dataDir: process.env.DATA_DIR as string });
    if (!created) throw new Error('metadata index is required for the SC-03c read path');
    meta = created;
    metadata.setActiveMetadataIndex(meta);
  });

  afterAll(() => {
    metadata.setActiveMetadataIndex(undefined);
    meta.close();
  });

  beforeEach(() => {
    indexer.setActiveFtsIndex(index);
  });

  afterEach(() => {
    indexer.setActiveFtsIndex(undefined);
  });

  async function waitForIndex(prj: string) {
    await indexer.awaitProjectFtsIndexed(prj);
    await metadata.awaitProjectIndexed(prj);
  }

  it('falls back to the file scan while the index is empty, then serves the index', async () => {
    const prj = project();
    const task = await tasks.createTask({ project: prj, title: 'Falcon migration checklist' });
    const tools = makeTools();

    const first = envelope(await tools.get('search_tasks')!({ project: prj, query: 'falcon migration' }));
    expect(first.ok).toBe(true);
    expect(first.source).toBe('scan');
    expect(first.indexing).toBe(true);
    expect(first.data[0].item.id).toBe(task.id);

    await waitForIndex(prj);
    expect(indexer.isProjectFtsComplete(prj)).toBe(true);

    const second = envelope(await tools.get('search_tasks')!({ project: prj, query: 'falcon migration checklist' }));
    expect(second.source).toBe('fts');
    expect(second.data[0].item.id).toBe(task.id);
  });

  it('never answers from an index that lost a row, and repairs it in the background', async () => {
    const prj = project();
    const task = await tasks.createTask({ project: prj, title: 'Kestrel audit notes' });
    const tools = makeTools();
    indexer.ensureProjectFtsIndexed(prj);
    await waitForIndex(prj);
    expect(indexer.isProjectFtsComplete(prj)).toBe(true);

    index.remove(indexer.taskStoreId(), 'task', task.id);
    const stale = envelope(await tools.get('search_tasks')!({ project: prj, query: 'kestrel audit' }));
    expect(stale.source).toBe('scan');
    expect(stale.indexing).toBe(true);

    await waitForIndex(prj);
    const repaired = envelope(await tools.get('search_tasks')!({ project: prj, query: 'kestrel audit notes' }));
    expect(repaired.source).toBe('fts');
    expect(repaired.data[0].item.id).toBe(task.id);
  });

  it('keeps the file path while the index is dirty', async () => {
    const prj = project();
    await tasks.createTask({ project: prj, title: 'Merlin retention policy' });
    const tools = makeTools();
    indexer.ensureProjectFtsIndexed(prj);
    await waitForIndex(prj);
    expect(indexer.isProjectFtsComplete(prj)).toBe(true);

    index.markDirty('simulated write failure');
    const result = envelope(await tools.get('search_tasks')!({ project: prj, query: 'merlin retention' }));
    expect(result.source).toBe('scan');
    expect(indexer.isProjectFtsComplete(prj)).toBe(false);
  });

  it('keeps the file path for a type-filtered search, which filters the corpus before ranking', async () => {
    const prj = project();
    await tasks.createTask({ project: prj, title: 'Osprey rollout checklist' });
    const tools = makeTools();
    indexer.ensureProjectFtsIndexed(prj);
    await waitForIndex(prj);

    const result = envelope(await tools.get('search_tasks')!({ project: prj, query: 'osprey rollout', type: 'task' }));
    expect(result.source).toBe('scan');
    expect(result.data[0].item.id).toBeTruthy();
  });

  it('drops an archived document from the index and keeps the completeness invariant', async () => {
    const prj = project();
    const doc = await knowledge.createDoc({ project: prj, title: 'Harbor notes', content: 'berth allocation plan' });
    const tools = makeTools();
    indexer.ensureProjectFtsIndexed(prj);
    await waitForIndex(prj);
    expect(indexer.isProjectFtsComplete(prj)).toBe(true);

    await knowledge.archiveDoc(prj, doc.id);
    expect(indexer.isProjectFtsComplete(prj)).toBe(true);

    const result = envelope(await tools.get('search_knowledge')!({ project: prj, query: 'berth allocation' }));
    expect(result.source).toBe('fts');
    expect(result.data).toHaveLength(0);
  });

  it('promotes a verbatim identifier hit without a vector adapter', async () => {
    const prj = project();
    const task = await tasks.createTask({ project: prj, title: 'Fix DEV-7613 decoder', description: 'unrelated payload' });
    const tools = makeTools();
    indexer.ensureProjectFtsIndexed(prj);
    await waitForIndex(prj);

    const result = envelope(await tools.get('search_tasks')!({ project: prj, query: 'DEV-7613' }));
    expect(result.source).toBe('fts');
    expect(result.data[0].item.id).toBe(task.id);
    expect(result.data[0].exactMatches).toBeGreaterThan(0);
  });

  it('finds a new term and drops the old one through storage writes', async () => {
    const prj = project();
    const task = await tasks.createTask({ project: prj, title: 'Falcon migration checklist' });
    const tools = makeTools();
    indexer.ensureProjectFtsIndexed(prj);
    await waitForIndex(prj);

    await tasks.updateTask(prj, task.id, { title: 'Petrel migration checklist' });
    const found = envelope(await tools.get('search_tasks')!({ project: prj, query: 'petrel migration' }));
    expect(found.source).toBe('fts');
    expect(found.data[0].item.id).toBe(task.id);

    const gone = envelope(await tools.get('search_tasks')!({ project: prj, query: 'falcon' }));
    expect(gone.data).toHaveLength(0);
  });
});

describe('SC-03a: rebuild scales with the corpus', () => {
  it('rebuilds 20k documents without a per-row table scan', () => {
    const text = 'deployment runbook cursor pagination storage index cache invalidation policy rollout '.repeat(3);
    const records = Array.from({ length: 20_000 }, (_, i) => record({ id: `scale-${i}`, text }));
    const startedAt = Date.now();
    index.rebuild(records);
    const elapsedMs = Date.now() - startedAt;

    expect(index.stats().rows).toBe(20_000);
    expect(elapsedMs).toBeLessThan(10_000);
  }, 30_000);
});
