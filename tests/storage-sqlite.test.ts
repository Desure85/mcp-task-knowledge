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
    expect(profile.manifest.collections).toEqual(['tasks', 'docs', 'projects', 'history']);
    expect(profile.manifest.capabilities).toEqual({
      transactions: true,
      history: true,
      fullText: false,
      vectors: false,
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
    expect(codeOf(() => profile.events('log.json'))).toBe('CAPABILITY_UNAVAILABLE');
    // Proxy-backed collections throw a domain error synchronously: a silent empty answer would lie
    // about what the profile can do.
    expect(codeOf(() => profile.prompts.list('p'))).toBe('CAPABILITY_UNAVAILABLE');
    expect(codeOf(() => profile.memory.temporal('/tmp/x.json'))).toBe('CAPABILITY_UNAVAILABLE');
    expect(codeOf(() => profile.locks.withLock('x', async () => 1))).toBe('CAPABILITY_UNAVAILABLE');
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
