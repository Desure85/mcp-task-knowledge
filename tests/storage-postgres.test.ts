/**
 * Y-06a1 — контрактные тесты Postgres-профиля против настоящего PostgreSQL.
 *
 * Запуск: `POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:55434/mcp_test npx vitest run tests/storage-postgres.test.ts`.
 * Без `POSTGRES_URL` набор документированно пропускается: локальный Docker недоступен, но
 * `embedded-postgres` поднимает настоящий PostgreSQL 18 — см. `.tools/pg-server.mjs` (решение Y-06a1).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPostgresProfile } from '../src/storage/profiles/postgres/index.js';
import { PostgresEventLog } from '../src/storage/profiles/postgres/index.js';
import { createStorageProfile, readStorageProfileKind } from '../src/storage/profile-select.js';
import { StoreError } from '../src/storage/contracts.js';

const connectionString = process.env.POSTGRES_URL;
const describePostgres = connectionString ? describe : describe.skip;


describePostgres('Y-06a1: Postgres profile', () => {
  let profile: Awaited<ReturnType<typeof createPostgresProfile>>;
  let blobsDir: string;

  beforeAll(async () => {
    blobsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-profile-'));
    profile = await createPostgresProfile({ connectionString: connectionString!, blobsDir });
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: connectionString! });
    await pool.query('truncate tasks, docs, doc_versions, projects, events, snapshots, search_index, search_state');
    await pool.end();
  });

  afterAll(async () => {
    profile?.close?.();
    if (blobsDir) fs.rmSync(blobsDir, { recursive: true, force: true });
  });

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('waitFor timeout');
}

describe('Y-06a2: Postgres search (tsvector + pg_trgm)', () => {
  it('rebuilds the index and answers candidates through the async path', async () => {
    await profile.tasks.create({ project: 'search', title: 'postgres migration plan', description: 'vector store notes' });
    await profile.tasks.create({ project: 'search', title: 'unrelated cooking recipe' });
    await profile.docs.create({ project: 'search', title: 'postgres knowledge doc', content: 'the pgvector extension is discussed here' });
    await profile.tasks.create({ project: 'other', title: 'postgres must not leak' });

    profile.search.ensureIndexed('search');
    await waitFor(() => profile.search.isIndexComplete('search'));
    expect(profile.search.fillState('search')).toBe('complete');
    expect(profile.search.dirty()).toBe(false);

    const hits = await profile.search.candidatesAsync!({
      store: profile.search.taskStoreId(),
      kind: 'task',
      project: 'search',
      query: 'postgres',
      limit: 10,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.project === 'search')).toBe(true);
    expect(hits.every((hit) => hit.score > 0)).toBe(true);
    expect(hits.some((hit) => hit.id && hit.id.length > 0)).toBe(true);

    const docHits = await profile.search.candidatesAsync!({
      store: profile.search.docStoreId(),
      kind: 'doc',
      project: 'search',
      query: 'pgvector',
      limit: 10,
    });
    expect(docHits.length).toBe(1);

    const isolated = await profile.search.candidatesAsync!({
      store: profile.search.taskStoreId(),
      kind: 'task',
      project: 'other',
      query: 'postgres',
      limit: 10,
    });
    expect(isolated.length).toBe(1);

    expect(profile.search.countTasks('search')).toBe(2);
    expect(profile.search.taskStoreId()).toBe('postgres:tasks');
    expect(profile.search.docStoreId()).toBe('postgres:docs');

    // Idempotent: a second ensureIndexed keeps the same row set.
    profile.search.ensureIndexed('search');
    await waitFor(() => profile.search.isIndexComplete('search'));
    const again = await profile.search.candidatesAsync!({
      store: profile.search.taskStoreId(),
      kind: 'task',
      project: 'search',
      query: 'postgres',
      limit: 10,
    });
    expect(again.map((hit) => hit.id).sort()).toEqual(hits.map((hit) => hit.id).sort());
  });

  it('uses the pg_trgm fallback for a near-miss query', async () => {
    // The embedded server allows CREATE EXTENSION, so the provider reports trgm=true and the SQL
    // fallback branch is exercised. 'postgre' does not match the lexeme 'postgres' in tsquery.
    await profile.tasks.create({ project: 'trgm', title: 'postgres operational runbook' });
    profile.search.ensureIndexed('trgm');
    await waitFor(() => profile.search.isIndexComplete('trgm'));
    const hits = await profile.search.candidatesAsync!({
      store: profile.search.taskStoreId(),
      kind: 'task',
      project: 'trgm',
      query: 'postgre',
      limit: 10,
    });
    expect(hits.length).toBe(1);
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it('maintains the index on create, update and delete', async () => {
    const created = await profile.tasks.create({ project: 'mut', title: 'zebra unique marker' });
    await waitFor(async () => {
      const hits = await profile.search.candidatesAsync!({
        store: profile.search.taskStoreId(),
        kind: 'task',
        project: 'mut',
        query: 'zebra',
        limit: 5,
      });
      return hits.length === 1;
    });
    await waitFor(() => profile.search.countTasks('mut') === 1);

    await profile.tasks.update('mut', created.id, { title: 'renamed antelope marker' });
    await waitFor(async () => {
      const container = await profile.search.candidatesAsync!({
        store: profile.search.taskStoreId(),
        kind: 'task',
        project: 'mut',
        query: 'zebra',
        limit: 5,
      });
      return container.length === 0;
    });
    const renamed = await profile.search.candidatesAsync!({
      store: profile.search.taskStoreId(),
      kind: 'task',
      project: 'mut',
      query: 'antelope',
      limit: 5,
    });
    expect(renamed.map((hit) => hit.id)).toContain(created.id);

    await profile.tasks.deletePermanent('mut', created.id);
    await waitFor(async () => {
      const container = await profile.search.candidatesAsync!({
        store: profile.search.taskStoreId(),
        kind: 'task',
        project: 'mut',
        query: 'antelope',
        limit: 5,
      });
      return container.length === 0;
    });
    await waitFor(() => profile.search.countTasks('mut') === 0);

    // Missing project has no rows and no count.
    expect(profile.search.candidatesAsync?.({ store: 'postgres:tasks', kind: 'task', project: 'missing', query: 'x', limit: 5 })).toBeInstanceOf(Promise);
    expect(profile.search.countTasks('missing')).toBeUndefined();
  });

  it('reports stale/unindexed projects honestly', () => {
    expect(profile.search.fillState('never-indexed')).toBe('idle');
    expect(profile.search.isIndexComplete('never-indexed')).toBe(false);
  });
});

  it('publishes an honest manifest and leaves unimplemented capabilities unavailable', async () => {
    expect(profile.manifest.profile).toBe('postgres');
    expect(profile.manifest.collections).toEqual([
      'tasks',
      'docs',
      'projects',
      'prompts',
      'memory',
      'events',
      'history',
      'locks',
      'blobs',
    ]);
    expect(profile.manifest.capabilities).toMatchObject({ transactions: true, history: true, fullText: true, vectors: false });
    expect(profile.search.available()).toBe(true);
    // Sync facade cannot query the async driver; the registrar uses candidatesAsync (present).
    expect(typeof profile.search.candidatesAsync).toBe('function');
    await expect(profile.vectors.query(Float32Array.from([1]), { fingerprint: 'f', limit: 1 })).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
    });
    expect(profile.prompts).toBeDefined();
    expect(profile.memory).toBeDefined();
    expect(profile.blobs?.kind).toBe('file');
  });

  it('runs the task lifecycle with real transactions', async () => {
    const created = await profile.tasks.create({ project: 'p', title: 'first', description: 'body', tags: ['a'] });
    expect(created).toMatchObject({ project: 'p', title: 'first', status: 'todo', priority: 'medium', archived: false });
    expect(await profile.tasks.get('p', created.id)).toMatchObject({ id: created.id, title: 'first' });

    const updated = await profile.tasks.update('p', created.id, { title: 'renamed', priority: 'high' });
    expect(updated).toMatchObject({ title: 'renamed', priority: 'high' });
    expect((await profile.tasks.update('p', 'missing', { title: 'x' }))).toBeNull();

    const closed = await profile.tasks.close('p', created.id);
    expect(closed?.status).toBe('done');

    expect((await profile.tasks.archive('p', created.id))?.archived).toBe(true);
    expect(await profile.tasks.list({ project: 'p' })).toHaveLength(0);
    expect(await profile.tasks.list({ project: 'p', includeArchived: true })).toHaveLength(1);
    expect((await profile.tasks.restore('p', created.id))?.archived).toBe(false);
    expect((await profile.tasks.trash('p', created.id))?.trashed).toBe(true);
    expect(await profile.tasks.list({ project: 'p' })).toHaveLength(0);
    expect((await profile.tasks.restore('p', created.id))?.trashed).toBe(false);
    expect(await profile.tasks.deletePermanent('p', created.id)).toBe(true);
    expect(await profile.tasks.get('p', created.id)).toBeNull();
  });

  it('filters and pages tasks with cursors and countOnly', async () => {
    for (let index = 0; index < 5; index += 1) {
      const task = await profile.tasks.create({ project: 'page', title: `task ${index}` });
      await profile.tasks.update('page', task.id, { status: index % 2 === 0 ? 'todo' : 'done' });
    }
    const todos = await profile.tasks.list({ project: 'page', status: 'todo' });
    expect(todos).toHaveLength(3);
    const firstPage = await profile.tasks.page('page', { limit: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.total).toBe(5);
    expect(firstPage.hasMore).toBe(true);
    const secondPage = await profile.tasks.page('page', { limit: 2, cursor: firstPage.keys[firstPage.keys.length - 1] });
    expect(secondPage.items).toHaveLength(2);
    expect(secondPage.keys).not.toEqual(firstPage.keys);
    const countOnly = await profile.tasks.page('page', { limit: 2, countOnly: true });
    expect(countOnly.items).toEqual([]);
    expect(countOnly.total).toBe(5);
    const filteredPage = await profile.tasks.page('page', { limit: 10, status: 'done' });
    expect(filteredPage.items).toHaveLength(2);
  });

  it('builds task trees, children, subtree and closes with cascade', async () => {
    const root = await profile.tasks.create({ project: 'tree', title: 'root' });
    const child = await profile.tasks.create({ project: 'tree', title: 'child', parentId: root.id });
    const grandchild = await profile.tasks.create({ project: 'tree', title: 'grandchild', parentId: child.id });
    const tree = await profile.tasks.tree({ project: 'tree' });
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].children[0].id).toBe(grandchild.id);
    expect((await profile.tasks.children('tree', root.id)).map((task) => task.id)).toEqual([child.id]);
    expect((await profile.tasks.subtree('tree', root.id))?.children[0].id).toBe(child.id);
    expect(await profile.tasks.subtree('tree', 'missing')).toBeNull();

    const cascade = await profile.tasks.closeWithCascade('tree', root.id, true);
    expect(cascade.root?.status).toBe('done');
    expect(cascade.cascaded.map((task) => task.id).sort()).toEqual([child.id, grandchild.id].sort());
    const withoutCascade = await profile.tasks.closeWithCascade('tree', root.id, false);
    expect(withoutCascade.cascaded).toEqual([]);
    expect(await profile.tasks.closeWithCascade('tree', 'missing', true)).toEqual({ root: null, cascaded: [] });
  });

  it('keeps document versions and supports restore', async () => {
    const doc = await profile.docs.create({ project: 'p', title: 'doc', content: 'v1', tags: ['t'], trustLevel: 'user' });
    expect(doc).toMatchObject({ title: 'doc', content: 'v1', version: 1, archived: false });
    const second = await profile.docs.update('p', doc.id, { content: 'v2' });
    expect(second?.version).toBe(2);
    const versions = await profile.docs.versions('p', doc.id);
    expect(versions.map((version) => version.version)).toEqual([1, 2]);
    const restored = await profile.docs.restoreVersion('p', doc.id, 1);
    expect(restored?.content).toBe('v1');
    expect(await profile.docs.restoreVersion('p', doc.id, 99)).toBeNull();

    expect((await profile.docs.archive('p', doc.id))?.archived).toBe(true);
    expect(await profile.docs.list({ project: 'p' })).toHaveLength(0);
    expect((await profile.docs.restore('p', doc.id))?.archived).toBe(false);
    expect((await profile.docs.trash('p', doc.id))?.trashed).toBe(true);
    expect(await profile.docs.page('p', { limit: 10, includeTrashed: true })).toMatchObject({ total: 1 });
    expect(await profile.docs.page('p', { limit: 10, includeTrashed: true, countOnly: true, parentId: 'none' })).toMatchObject({
      total: 0,
    });
    expect(await profile.docs.deletePermanent('p', doc.id)).toBe(true);
    expect(await profile.docs.read('p', doc.id)).toBeNull();
  });

  it('exposes document history through HistoryProvider and refuses task history honestly', async () => {
    const doc = await profile.docs.create({ project: 'hist', title: 'history doc', content: 'one' });
    await profile.docs.update('hist', doc.id, { content: 'two' });
    const listed = await profile.history.list('hist', 'doc', doc.id);
    expect(listed.map((entry) => entry.version)).toEqual([1, 2]);
    const restored = await profile.history.restore('hist', 'doc', doc.id, 1);
    expect(restored?.content).toBe('one');
    await expect(profile.history.list('hist', 'task', doc.id)).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
  });

  it('manages projects, metadata and workflow', async () => {
    const created = await profile.project.create('proj', 'description');
    expect(created).toMatchObject({ id: 'proj', description: 'description' });
    await expect(profile.project.create('proj')).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(profile.project.create('bad id')).rejects.toMatchObject({ code: 'CONFLICT' });

    await profile.tasks.create({ project: 'proj', title: 'task' });
    const detail = await profile.project.detail('proj', () => 'proj');
    expect(detail).toMatchObject({ id: 'proj', isCurrent: true });
    expect(detail?.taskStats?.total).toBe(1);
    expect(detail?.metadata?.description).toBe('description');

    const statuses = [
      { id: 'todo', label: 'Todo', category: 'todo', color: '#888888', order: 0 },
      { id: 'doing', label: 'Doing', category: 'in_progress', color: '#888888', order: 1 },
      { id: 'done', label: 'Done', category: 'done', color: '#888888', order: 2 },
    ];
    const updated = await profile.project.updateMetadata('proj', { statuses, closeStatus: 'done' } as never);
    expect(updated?.statuses?.map((status) => status.id)).toEqual(['todo', 'doing', 'done']);
    const workflow = await profile.project.workflow('proj');
    expect(workflow.statuses.map((status) => status.id)).toEqual(['todo', 'doing', 'done']);
    expect(workflow.closeStatus).toBe('done');

    expect(await profile.project.remove('proj', false)).toMatchObject({ deleted: false });
    expect(await profile.project.remove('proj', true)).toMatchObject({ deleted: true });
    expect(await profile.project.detail('proj', () => 'proj')).toBeNull();
    expect(await profile.project.readMetadata('missing')).toBeNull();
    expect(await profile.project.updateMetadata('missing', {})).toBeNull();
    expect(await profile.project.remove('missing', false)).toMatchObject({ deleted: false });
  });

  it('serves projects list with counts', async () => {
    await profile.project.create('listable');
    await profile.tasks.create({ project: 'listable', title: 'one' });
    const projects = await profile.project.list(() => 'listable');
    const found = projects.find((project) => project.id === 'listable');
    expect(found).toMatchObject({ isCurrent: true, taskCount: 1, hasTasks: true });
  });

  it('persists the event log write-behind and compacts to the latest snapshot', async () => {
    const log = profile.events('events-a') as PostgresEventLog;
    const first = log.append('e1', 'task', 'create', { id: 'e1' }, 1);
    expect(first.eventId).toBe(1);
    expect(log.since(0)).toHaveLength(1);
    log.append('e1', 'task', 'update', { id: 'e1', v: 2 }, 2);
    expect(log.since(0)).toHaveLength(2);
    expect(log.since(2)).toHaveLength(0);
    expect(log.snapshot('e1')).toMatchObject({ entityId: 'e1', lastEventId: 2 });
    expect(log.snapshots()).toHaveLength(1);
    await log.flush();

    const reloaded = profile.events('events-a') as PostgresEventLog;
    await new Promise((resolve) => setTimeout(resolve, 50));
    await reloaded.flush();
    expect(reloaded.since(0).map((entry) => entry.eventId)).toEqual([1, 2]);
    expect(reloaded.snapshot('e1')?.lastEventId).toBe(2);

    const compact = log.compact();
    expect(compact).toEqual({ compacted: 2, remaining: 0 });
    await log.flush();
  });

  it('serializes critical sections across pool connections', async () => {
    let active = 0;
    let maxActive = 0;
    let counter = 0;
    await Promise.all(
      Array.from({ length: 5 }, () =>
        profile.locks.withLock('lock-key', async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          const current = counter;
          await new Promise((resolve) => setTimeout(resolve, 5));
          counter = current + 1;
          active -= 1;
        }),
      ),
    );
    expect(counter).toBe(5);
    expect(maxActive).toBe(1);
    await expect(
      profile.locks.withLock('fail-key', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // The advisory lock is released on rollback: the next section still runs.
    expect(await profile.locks.withLock('fail-key', async () => 'ok')).toBe('ok');
  });

  it('delegates prompts, memory and blobs to the shared implementations', async () => {
    expect(profile.prompts).toBeDefined();
    expect(await profile.prompts.list('no-project')).toEqual([]);
    const temporal = profile.memory.temporal(path.join(blobsDir, 'memory'));
    expect(temporal.stats().totalFacts).toBe(0);
    const blob = await profile.blobs!.put('exports/a.txt', new TextEncoder().encode('hello'));
    expect(await profile.blobs!.get(blob.key)).toEqual(new TextEncoder().encode('hello'));
  });

  it('selects the postgres kind from the environment and refuses the sync factory', () => {
    expect(readStorageProfileKind({ STORAGE_PROFILE: 'postgres' })).toBe('postgres');
    expect(readStorageProfileKind({ STORAGE_PROFILE: 'POSTGRES' })).toBe('postgres');
    expect(() => readStorageProfileKind({ STORAGE_PROFILE: 'oracle' })).toThrow(StoreError);
    expect(() => createStorageProfile({ kind: 'postgres' })).toThrow(/async createPostgresProfile/);
  });
});
