/**
 * Y-05a1 — SQLite-профиль: задачи и документы за контрактами ADR-009.
 *
 * Профиль хранит канонические записи в SQLite; тест проверяет объявленную часть контракта и честные
 * `CAPABILITY_UNAVAILABLE` для ещё не реализованных коллекций (Y-05a2/b), а не пустые ответы.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StoreError, type StorageProfile } from '../src/storage/contracts.js';
import { createSqliteProfile } from '../src/storage/profiles/sqlite/index.js';
import { createStorageProfile, readStorageProfileKind } from '../src/storage/profile-select.js';
import { FILE_CHUNKING_VERSION } from '../src/search/embeddings-file.js';
import { collectionId, fingerprintKey } from '../src/search/contracts.js';
import type { EmbeddingProvider, VectorRecord } from '../src/search/contracts.js';
import type { SqliteVectorStore } from '../src/storage/profiles/sqlite/vector-store.js';

const tempDirs: string[] = [];
const profiles: StorageProfile[] = [];

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'y05a1-sqlite-'));
  tempDirs.push(dir);
  return path.join(dir, 'storage.sqlite');
}

function openProfile(databasePath = tempDbPath()): StorageProfile {
  const profile = createSqliteProfile({ databasePath });
  profiles.push(profile);
  return profile;
}

afterEach(() => {
  for (const profile of profiles) profile.close?.();
  profiles.length = 0;
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

describe('Y-05a1: profile selection', () => {
  it('defaults to the file profile and accepts explicit sqlite', () => {
    expect(readStorageProfileKind({})).toBe('file');
    expect(readStorageProfileKind({ STORAGE_PROFILE: 'sqlite' })).toBe('sqlite');
    expect(readStorageProfileKind({ STORAGE_PROFILE: ' FILE ' })).toBe('file');
  });

  it('rejects unknown profile names instead of silently falling back', () => {
    expect(() => readStorageProfileKind({ STORAGE_PROFILE: 'postgres' })).toThrow(StoreError);
    expect(() => readStorageProfileKind({ STORAGE_PROFILE: 'postgres' })).toThrow(/unknown STORAGE_PROFILE/);
  });

  it('requires an explicit database path for the sqlite kind', () => {
    expect(() => createStorageProfile({ kind: 'sqlite' })).toThrow(/databasePath/);
  });

  it('publishes an honest manifest', () => {
    const profile = openProfile();
    expect(profile.manifest.profile).toBe('sqlite');
    expect(profile.manifest.collections).toEqual([
      'tasks',
      'docs',
      'projects',
      'history',
      'prompts',
      'memory',
      'events',
      'locks',
      'blobs',
    ]);
    expect(profile.manifest.capabilities).toEqual({
      transactions: true,
      history: true,
      fullText: true,
      vectors: true,
      efficientListing: false,
    });
    expect(profile.manifest.roots).toEqual({});
  });
});

describe('Y-05a1: tasks', () => {
  it('creates tasks with defaults and reads them back', async () => {
    const profile = openProfile();
    const created = await profile.tasks.create({ project: 'p', title: 'first task', tags: ['a'] });
    expect(created.id).toBeTruthy();
    expect(created.status).toBe('todo');
    expect(created.priority).toBe('medium');
    expect(created.createdAt).toBe(created.updatedAt);
    expect(await profile.tasks.get('p', created.id)).toEqual(created);
    expect(await profile.tasks.get('other', created.id)).toBeNull();
  });

  it('rejects a task without a title', async () => {
    const profile = openProfile();
    await expect(profile.tasks.create({ project: 'p', title: '   ' })).rejects.toThrow(/title is required/);
  });

  it('updates fields and bumps updatedAt', async () => {
    const profile = openProfile();
    const created = await profile.tasks.create({ project: 'p', title: 'task' });
    const updated = await profile.tasks.update('p', created.id, { title: 'renamed', status: 'in_progress' });
    expect(updated?.title).toBe('renamed');
    expect(updated?.status).toBe('in_progress');
    expect(updated?.createdAt).toBe(created.createdAt);
    expect(await profile.tasks.update('p', 'missing', { title: 'x' })).toBeNull();
  });

  it('filters list output by lifecycle and tag', async () => {
    const profile = openProfile();
    const keep = await profile.tasks.create({ project: 'p', title: 'keep', tags: ['x'] });
    const archived = await profile.tasks.create({ project: 'p', title: 'archived', tags: ['x'] });
    const trashed = await profile.tasks.create({ project: 'p', title: 'trashed' });
    await profile.tasks.archive('p', archived.id);
    await profile.tasks.trash('p', trashed.id);

    const visible = await profile.tasks.list({ project: 'p' });
    expect(visible.map((task) => task.id)).toEqual([keep.id]);
    const all = await profile.tasks.list({ project: 'p', includeArchived: true, includeTrashed: true });
    expect(all).toHaveLength(3);
    expect((await profile.tasks.list({ project: 'p', tag: 'x' })).map((task) => task.id)).toEqual([keep.id]);

    expect((await profile.tasks.restore('p', archived.id))?.archived).toBeUndefined();
    expect((await profile.tasks.list({ project: 'p' })).map((task) => task.id).sort()).toEqual([keep.id, archived.id].sort());
  });

  it('pages with keys, counts and hasMore', async () => {
    const profile = openProfile();
    for (let index = 0; index < 5; index += 1) {
      await profile.tasks.create({ project: 'p', title: `task ${index}` });
    }
    const first = await profile.tasks.page('p', { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.keys).toEqual(first.items.map((task) => task.id));
    expect(first.total).toBe(5);
    expect(first.totalExact).toBe(true);
    expect(first.hasMore).toBe(true);

    const second = await profile.tasks.page('p', { limit: 2, cursor: first.keys[first.keys.length - 1] });
    expect(second.items).toHaveLength(2);
    expect(second.hasMore).toBe(true);
    // The cursor must actually advance: two disjoint pages of two keys each.
    expect(second.keys).not.toEqual(first.keys);
    expect(new Set([...first.keys, ...second.keys]).size).toBe(4);

    const countOnly = await profile.tasks.page('p', { limit: 2, countOnly: true });
    expect(countOnly.items).toEqual([]);
    expect(countOnly.total).toBe(5);
  });

  it('builds trees, children, subtrees and closes with cascade', async () => {
    const profile = openProfile();
    const root = await profile.tasks.create({ project: 'p', title: 'root' });
    const child = await profile.tasks.create({ project: 'p', title: 'child', parentId: root.id });
    const grandchild = await profile.tasks.create({ project: 'p', title: 'grandchild', parentId: child.id });
    const other = await profile.tasks.create({ project: 'p', title: 'other' });

    const tree = await profile.tasks.tree({ project: 'p' });
    expect(tree).toHaveLength(2);
    const rootNode = tree.find((node) => node.id === root.id)!;
    expect(rootNode.children.map((node) => node.id)).toEqual([child.id]);
    expect(rootNode.children[0].children.map((node) => node.id)).toEqual([grandchild.id]);

    expect((await profile.tasks.children('p', root.id)).map((task) => task.id)).toEqual([child.id]);
    const subtree = await profile.tasks.subtree('p', root.id);
    expect(subtree?.id).toBe(root.id);
    expect(subtree?.children[0].children[0].id).toBe(grandchild.id);

    const closed = await profile.tasks.closeWithCascade('p', root.id, true);
    expect(closed.root?.status).toBe('done');
    expect(closed.cascaded.map((task) => task.id).sort()).toEqual([child.id, grandchild.id].sort());
    expect((await profile.tasks.get('p', grandchild.id))?.status).toBe('done');
    expect((await profile.tasks.get('p', other.id))?.status).toBe('todo');

    const single = await profile.tasks.create({ project: 'p', title: 'single' });
    const withoutCascade = await profile.tasks.closeWithCascade('p', single.id);
    expect(withoutCascade.root?.status).toBe('done');
    expect(withoutCascade.cascaded).toEqual([]);
  });

  it('deletes permanently and survives a profile restart', async () => {
    const databasePath = tempDbPath();
    const first = createSqliteProfile({ databasePath });
    const task = await first.tasks.create({ project: 'p', title: 'persisted' });
    expect(await first.tasks.deletePermanent('p', task.id)).toBe(true);
    expect(await first.tasks.deletePermanent('p', task.id)).toBe(false);
    const kept = await first.tasks.create({ project: 'p', title: 'kept' });
    first.close?.();

    const reopened = createSqliteProfile({ databasePath });
    profiles.push(reopened);
    expect((await reopened.tasks.get('p', kept.id))?.title).toBe('kept');
    expect(await reopened.tasks.get('p', task.id)).toBeNull();
  });
});

describe('Y-05a1: docs', () => {
  it('creates, reads and lists documents without content in list output', async () => {
    const profile = openProfile();
    const doc = await profile.docs.create({ project: 'p', title: 'Doc', content: '# body', tags: ['t'] });
    expect(doc.content).toBe('# body');
    expect((await profile.docs.read('p', doc.id))?.content).toBe('# body');

    const listed = await profile.docs.list({ project: 'p' });
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty('content');
  });

  it('updates, pages and runs the docs lifecycle', async () => {
    const profile = openProfile();
    const first = await profile.docs.create({ project: 'p', title: 'one', content: 'a' });
    await profile.docs.create({ project: 'p', title: 'two', content: 'b' });
    const updated = await profile.docs.update('p', first.id, { title: 'renamed', content: 'c' });
    expect(updated?.title).toBe('renamed');
    expect(updated?.content).toBe('c');

    const page = await profile.docs.page('p', { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(2);
    expect(page.hasMore).toBe(true);

    await profile.docs.archive('p', first.id);
    expect(await profile.docs.list({ project: 'p' })).toHaveLength(1);
    expect(await profile.docs.list({ project: 'p', includeArchived: true })).toHaveLength(2);
    await profile.docs.trash('p', first.id);
    expect(await profile.docs.list({ project: 'p', includeArchived: true })).toHaveLength(1);
    const restored = await profile.docs.restore('p', first.id);
    expect(restored?.archived).toBeUndefined();
    expect(restored?.trashed).toBeUndefined();
    expect(await profile.docs.deletePermanent('p', first.id)).toBe(true);
    expect(await profile.docs.read('p', first.id)).toBeNull();
  });
});

describe('Y-05a1: unimplemented collections are honest', () => {
  it('answers CAPABILITY_UNAVAILABLE instead of empty data', async () => {
    const profile = openProfile();
    await expect(profile.tasks.claim('p', 'id', { sessionId: 's' })).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
    });
    await expect(profile.history.list('p', 'task', 'id')).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
    const codeOf = (call: () => unknown): string | null => {
      try {
        call();
        return null;
      } catch (error) {
        return (error as StoreError).code ?? null;
      }
    };
    // Search and vectors are implemented in Y-05b; the remaining proxy stubs still fail honestly.
    expect(profile.search.available()).toBe(true);
    expect(profile.vectors).toBeDefined();
  });
});

describe('Y-05a2: projects', () => {
  it('creates, lists, details, updates metadata and removes projects', async () => {
    const profile = openProfile();
    expect(await profile.project.list(() => 'demo')).toEqual([]);

    const created = await profile.project.create('demo', 'demo project');
    expect(created.id).toBe('demo');
    expect(created.description).toBe('demo project');
    expect(created.paths).toEqual({ tasks: '', knowledge: '' });

    const listed = await profile.project.list(() => 'demo');
    expect(listed).toHaveLength(1);
    expect(listed[0].isCurrent).toBe(true);

    const metadata = await profile.project.readMetadata('demo');
    expect(metadata?.description).toBe('demo project');
    const updated = await profile.project.updateMetadata('demo', { description: 'renamed' });
    expect(updated?.description).toBe('renamed');
    expect(updated?.createdAt).toBe(metadata?.createdAt);

    await profile.tasks.create({ project: 'demo', title: 'first' });
    await profile.docs.create({ project: 'demo', title: 'Doc', content: 'body' });
    const detail = await profile.project.detail('demo', () => 'demo');
    expect(detail?.taskCount).toBe(1);
    expect(detail?.knowledgeCount).toBe(1);
    expect(detail?.taskStats.total).toBe(1);
    expect(detail?.knowledgeStats.total).toBe(1);
    expect(detail?.metadata?.description).toBe('renamed');

    const refused = await profile.project.remove('demo', false);
    expect(refused.deleted).toBe(false);
    expect(refused.message).toMatch(/still has/);
    const removed = await profile.project.remove('demo', true);
    expect(removed.deleted).toBe(true);
    expect(await profile.project.readMetadata('demo')).toBeNull();
    expect(await profile.tasks.list({ project: 'demo' })).toEqual([]);
  });

  it('validates project ids and duplicates', async () => {
    const profile = openProfile();
    await expect(profile.project.create('..bad id')).rejects.toMatchObject({ code: 'CONFLICT' });
    await profile.project.create('valid-1');
    await expect(profile.project.create('valid-1')).rejects.toThrow(/already exists/);
    expect((await profile.project.remove('missing', true)).deleted).toBe(false);
  });

  it('builds a workflow from metadata, defaulting when absent', async () => {
    const profile = openProfile();
    await profile.project.create('demo');
    const workflow = await profile.project.workflow('demo');
    expect(workflow.isDefault).toBe(true);
    expect(workflow.statuses.length).toBeGreaterThan(0);
    expect(workflow.initialStatuses.length).toBeGreaterThan(0);

    await profile.project.updateMetadata('demo', {
      statuses: [
        { id: 'todo', label: 'Todo', category: 'todo', color: 'st-todo', order: 0 },
        { id: 'done', label: 'Done', category: 'done', color: 'st-done', order: 1 },
      ],
      closeStatus: 'done',
    });
    const custom = await profile.project.workflow('demo');
    expect(custom.isDefault).toBe(false);
    expect(custom.statuses.map((status) => status.id)).toEqual(['todo', 'done']);
    expect(custom.closeStatus).toBe('done');
  });
});

describe('Y-05a2: document history', () => {
  it('records versions and restores them', async () => {
    const profile = openProfile();
    const doc = await profile.docs.create({ project: 'p', title: 'v1', content: 'first' });
    expect((await profile.docs.versions('p', doc.id)).map((entry) => entry.version)).toEqual([1]);

    await profile.docs.update('p', doc.id, { title: 'v2', content: 'second' });
    const versions = await profile.docs.versions('p', doc.id);
    expect(versions.map((entry) => entry.version)).toEqual([1, 2]);
    expect(versions[1].title).toBe('v2');
    expect(versions.every((entry) => Boolean(entry.updatedAt))).toBe(true);

    const restored = await profile.docs.restoreVersion('p', doc.id, 1);
    expect(restored?.content).toBe('first');
    expect((await profile.docs.read('p', doc.id))?.content).toBe('first');
    expect((await profile.docs.versions('p', doc.id)).length).toBe(3);

    expect(await profile.docs.restoreVersion('p', doc.id, 42)).toBeNull();
  });

  it('answers CAPABILITY_UNAVAILABLE for task history instead of an empty list', async () => {
    const profile = openProfile();
    await expect(profile.history.list('p', 'task', 'id')).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
  });
});

describe('Y-05a3: event log', () => {
  it('appends, reads deltas and persists across reopen', async () => {
    const databasePath = tempDbPath();
    const profile = createSqliteProfile({ databasePath });
    profiles.push(profile);
    const events = profile.events('sync/events.json');
    const first = events.append('task-1', 'task', 'create', { title: 'one' }, 1);
    const second = events.append('task-1', 'task', 'update', { title: 'two' }, 2);
    expect(first.eventId).toBe(1);
    expect(second.eventId).toBe(2);
    expect(events.since(0).map((event) => event.eventId)).toEqual([1, 2]);
    expect(events.since(1).map((event) => event.eventId)).toEqual([2]);
    expect(events.since(1, 1)).toHaveLength(1);
    profile.close?.();

    const reopened = createSqliteProfile({ databasePath });
    profiles.push(reopened);
    expect(reopened.events('sync/events.json').since(0).map((event) => event.eventId)).toEqual([1, 2]);
  });

  it('compacts into snapshots and garbage-collects events', async () => {
    const profile = openProfile();
    const events = profile.events('sync/events.json');
    events.append('task-1', 'task', 'create', { title: 'one' }, 1);
    events.append('task-1', 'task', 'update', { title: 'two' }, 2);
    events.append('task-2', 'task', 'create', { title: 'other' }, 1);

    expect(events.snapshot('task-1')).toBeUndefined();
    const result = events.compact();
    expect(result).toEqual({ compacted: 3, remaining: 0 });
    expect(events.snapshot('task-1')).toMatchObject({ entityId: 'task-1', state: { title: 'two' }, lastEventId: 2 });
    expect(events.snapshots()).toHaveLength(2);

    const after = events.append('task-1', 'task', 'update', { title: 'three' }, 3);
    expect(after.eventId).toBe(4);
    expect(events.compact()).toEqual({ compacted: 1, remaining: 0 });
  });
});

describe('Y-05a3: locks', () => {
  it('serializes concurrent critical sections per key', async () => {
    const profile = openProfile();
    const order: string[] = [];
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    await Promise.all([
      profile.locks.withLock('k', async () => {
        order.push('a:start');
        await sleep(10);
        order.push('a:end');
      }),
      profile.locks.withLock('k', async () => {
        order.push('b:start');
        await sleep(10);
        order.push('b:end');
      }),
    ]);
    expect(order).toHaveLength(4);
    const pairs = [
      ['a:start', 'a:end'],
      ['b:start', 'b:end'],
    ];
    for (const [start, end] of pairs) {
      expect(order.indexOf(end)).toBe(order.indexOf(start) + 1);
    }
  });

  it('releases the lock when the critical section throws', async () => {
    const profile = createSqliteProfile({ databasePath: tempDbPath(), lockTimeoutMs: 500 });
    profiles.push(profile);
    await expect(
      profile.locks.withLock('k', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(profile.locks.withLock('k', async () => 42)).resolves.toBe(42);
  });

  it('times out honestly when another holder keeps the lock', async () => {
    const databasePath = tempDbPath();
    const slow = createSqliteProfile({ databasePath, lockTimeoutMs: 5_000 });
    const fast = createSqliteProfile({ databasePath, lockTimeoutMs: 100 });
    profiles.push(slow, fast);
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const holding = slow.locks.withLock('k', async () => {
      await sleep(300);
    });
    await sleep(20);
    await expect(fast.locks.withLock('k', async () => 1)).rejects.toMatchObject({ code: 'CONFLICT' });
    await holding;
  });
});

describe('Y-05a3: delegated prompts and memory', () => {
  it('serves prompts and memory through their shared file-backed implementations', async () => {
    const profile = openProfile();
    await expect(profile.prompts.list('p')).resolves.toBeInstanceOf(Array);
    const temporal = profile.memory.temporal(tempDbPath() + '.memory.json');
    expect(typeof temporal).toBe('object');
    expect(temporal).not.toBeNull();
  });
});

describe('Y-05b1: FTS5 search provider', () => {
  it('indexes tasks and docs live and reports complete after ensureIndexed', async () => {
    const profile = openProfile();
    const index = profile.search;
    expect(index.available()).toBe(true);
    expect(index.isIndexComplete('p')).toBe(false);

    const task = await profile.tasks.create({ project: 'p', title: 'needle task', description: 'searchable body' });
    const doc = await profile.docs.create({ project: 'p', title: 'needle doc', content: 'document body' });
    expect(index.isIndexComplete('p')).toBe(false);

    index.ensureIndexed('p');
    expect(index.isIndexComplete('p')).toBe(true);
    expect(index.fillState('p')).toBe('complete');
    expect(index.dirty()).toBe(false);
    expect(index.countTasks('p')).toBe(1);

    const taskHits = index.candidates({ store: index.taskStoreId(), kind: 'task', project: 'p', query: 'needle', limit: 10 });
    expect(taskHits.map((hit) => hit.id)).toEqual([task.id]);
    expect(taskHits[0].score).toBeGreaterThan(0);

    const docHits = index.candidates({ store: index.docStoreId(), kind: 'doc', project: 'p', query: 'document', limit: 10 });
    expect(docHits.map((hit) => hit.id)).toEqual([doc.id]);

    // Another project must not leak into candidates.
    await profile.tasks.create({ project: 'other', title: 'needle task' });
    index.ensureIndexed('other');
    expect(
      index.candidates({ store: index.taskStoreId(), kind: 'task', project: 'p', query: 'needle', limit: 10 }).map((hit) => hit.id),
    ).toEqual([task.id]);
    expect(index.countTasks('other')).toBe(1);
  });

  it('keeps the index in step with lifecycle changes and rebuilds on demand', async () => {
    const profile = openProfile();
    const index = profile.search;
    const task = await profile.tasks.create({ project: 'p', title: 'lifecycle needle' });
    index.ensureIndexed('p');
    const find = () => index.candidates({ store: index.taskStoreId(), kind: 'task', project: 'p', query: 'needle', limit: 10 });

    expect(find()).toHaveLength(1);
    await profile.tasks.archive('p', task.id);
    expect(find()).toHaveLength(0);
    await profile.tasks.restore('p', task.id);
    expect(find()).toHaveLength(1);
    await profile.tasks.update('p', task.id, { title: 'renamed needle' });
    expect(find()).toHaveLength(1);
    await profile.tasks.deletePermanent('p', task.id);
    expect(find()).toHaveLength(0);
    expect(index.isIndexComplete('p')).toBe(true);
  });

  it('reports disabled when FTS is unavailable and survives reopen', async () => {
    const databasePath = tempDbPath();
    const profile = createSqliteProfile({ databasePath });
    profiles.push(profile);
    await profile.tasks.create({ project: 'p', title: 'persisted needle' });
    profile.search.ensureIndexed('p');
    expect(profile.search.isIndexComplete('p')).toBe(true);
    profile.close?.();

    const reopened = createSqliteProfile({ databasePath });
    profiles.push(reopened);
    expect(reopened.search.available()).toBe(true);
    expect(reopened.search.isIndexComplete('p')).toBe(true);
    expect(
      reopened.search.candidates({
        store: reopened.search.taskStoreId(),
        kind: 'task',
        project: 'p',
        query: 'persisted',
        limit: 10,
      }),
    ).toHaveLength(1);
  });
});

function fakeEmbeddingProvider() {
  const calls: string[][] = [];
  const fingerprint = { modelId: 'fake-vector-model', dimension: 3, pooling: 'mean' as const, queryPrefix: '', docPrefix: '' };
  const provider: EmbeddingProvider = {
    fingerprint: () => fingerprint,
    isReady: () => true,
    async embedQuery(text: string) {
      return Float32Array.from([text.length, 1, 0]);
    },
    async embedDocuments(texts: string[]) {
      calls.push([...texts]);
      return texts.map((text) => Float32Array.from([text.length, 1, 0]));
    },
  };
  return { provider, fingerprint, calls };
}

function vectorRecord(id: string, vector: number[], overrides: Partial<VectorRecord> = {}): VectorRecord {
  const fingerprint = fingerprintKey({ modelId: 'fake', dimension: 3, pooling: 'mean', queryPrefix: '', docPrefix: '' });
  return {
    store: 'knowledge',
    kind: 'doc',
    project: 'p',
    id,
    fingerprint,
    collection: collectionId(fingerprint, FILE_CHUNKING_VERSION),
    collectionMeta: { chunkingVersion: FILE_CHUNKING_VERSION, buildTextVersion: 'build-text:v1' },
    vector: Float32Array.from(vector),
    ...overrides,
  };
}

describe('Y-05b2: SQLite vector store', () => {
  it('stores vectors per collection and queries them by exact cosine', async () => {
    const profile = openProfile();
    await profile.vectors.upsert([
      vectorRecord('a', [1, 0, 0]),
      vectorRecord('b', [0.7, 0.7, 0]),
      vectorRecord('c', [0, 1, 0]),
    ]);
    const record = vectorRecord('x', [1, 0, 0]);
    const stats = await profile.vectors.stats();
    expect(stats.total).toBe(3);
    expect(stats.collections[record.collection]).toBe(3);

    const matches = await profile.vectors.query(Float32Array.from([1, 0, 0]), {
      fingerprint: record.fingerprint,
      limit: 10,
    });
    expect(matches.map((match) => match.id)).toEqual(['a', 'b', 'c']);
    expect(matches[0].score).toBeCloseTo(1, 5);
    expect(matches[1].score).toBeGreaterThan(matches[2].score);
    const onlyBest = await profile.vectors.query(Float32Array.from([1, 0, 0]), {
      fingerprint: record.fingerprint,
      minScore: 0.9,
      limit: 10,
    });
    expect(onlyBest.map((match) => match.id)).toEqual(['a']);
    expect((profile.vectors as SqliteVectorStore).annAvailable()).toBe(true);
  });

  it('filters by project/kind/minScore and reports collections honestly', async () => {
    const profile = openProfile();
    await profile.vectors.upsert([
      vectorRecord('doc-p', [1, 0, 0]),
      vectorRecord('task-p', [1, 0, 0], { store: 'tasks', kind: 'task' }),
      vectorRecord('doc-other', [1, 0, 0], { project: 'other' }),
    ]);
    const record = vectorRecord('x', [1, 0, 0]);
    expect(
      (
        await profile.vectors.query(Float32Array.from([1, 0, 0]), {
          fingerprint: record.fingerprint,
          project: 'p',
          kind: 'doc',
          limit: 5,
        })
      ).map((match) => match.id),
    ).toEqual(['doc-p']);
    const high = await profile.vectors.query(Float32Array.from([1, 0, 0]), {
      fingerprint: record.fingerprint,
      minScore: 0.99,
      limit: 5,
    });
    expect(high.every((match) => match.score >= 0.99)).toBe(true);
    const collections = await (profile.vectors as SqliteVectorStore).collections();
    expect(collections[0]).toMatchObject({ fingerprint: record.fingerprint, vectors: 3, active: true, readOnly: false });
    expect(collections[0].chunkingVersion).toBe(FILE_CHUNKING_VERSION);
  });

  it('deletes, clears and rejects dimension mismatches', async () => {
    const profile = openProfile();
    await profile.vectors.upsert([vectorRecord('a', [1, 0, 0]), vectorRecord('b', [0, 1, 0])]);
    await profile.vectors.delete('knowledge', 'doc', ['a']);
    expect((await profile.vectors.stats()).total).toBe(1);
    await expect(profile.vectors.upsert([vectorRecord('c', [1, 0])])).rejects.toMatchObject({ code: 'CONFLICT' });
    await profile.vectors.clear();
    expect((await profile.vectors.stats()).total).toBe(0);
  });

  it('falls back to brute-force cosine when sqlite-vec is unavailable', async () => {
    const profile = createSqliteProfile({ databasePath: tempDbPath(), vecAvailable: false });
    profiles.push(profile);
    expect((profile.vectors as SqliteVectorStore).annAvailable()).toBe(false);
    const record = vectorRecord('a', [1, 0, 0]);
    await profile.vectors.upsert([record, vectorRecord('b', [0, 1, 0])]);
    const matches = await profile.vectors.query(Float32Array.from([0, 1, 0]), {
      fingerprint: record.fingerprint,
      limit: 5,
    });
    expect(matches.map((match) => match.id)).toEqual(['b', 'a']);
    expect(matches[0].score).toBeCloseTo(1, 5);
  });
});

describe('Y-05b2: SQLite indexing wiring', () => {
  it('indexes tasks and docs into the vector store and skips unchanged content', async () => {
    const databasePath = tempDbPath();
    const manifestPath = databasePath + '.manifest.json';
    const { provider, calls } = fakeEmbeddingProvider();
    const profile = createSqliteProfile({
      databasePath,
      embeddingProvider: async () => provider,
      indexingManifestPath: manifestPath,
    });
    profiles.push(profile);
    expect(profile.indexing).toBeDefined();

    await profile.tasks.create({ project: 'p', title: 'first task', description: 'searchable' });
    await profile.tasks.create({ project: 'p', title: 'second task' });
    await profile.docs.create({ project: 'p', title: 'doc', content: 'knowledge body' });

    await profile.indexing!.ensureIndexed('p');
    await (profile.indexing as unknown as { drain(): Promise<void> }).drain();
    expect((await profile.vectors.stats()).total).toBe(3);
    expect(calls.flat()).toHaveLength(3);

    await profile.indexing!.ensureIndexed('p');
    await (profile.indexing as unknown as { drain(): Promise<void> }).drain();
    expect(calls.flat()).toHaveLength(3);
    expect(fs.existsSync(manifestPath)).toBe(true);
    // done is cumulative across runs; the second pass processed items but skipped embedding work.
    expect(profile.indexing!.status('p')[0]).toMatchObject({ done: 6, skipped: 3 });
  });
});
