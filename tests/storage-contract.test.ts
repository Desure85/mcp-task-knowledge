/**
 * Y-02a — storage contract tests for the file profile.
 *
 * ADR-009: "Один набор контрактных тестов на профиль". This file is the harness plus the file
 * profile run. The profile must return exactly what the current storage functions return (Y-02
 * changes the access seam, not behaviour), so every collection test is paired with a parity check
 * against `src/storage/tasks.ts` / `src/storage/knowledge.ts`.
 *
 * When the SQLite profile lands (Y-05) it runs the same harness with another `makeProfile`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileProfile } from '../src/storage/profiles/file/index.js';
import { StoreError, type StorageProfile } from '../src/storage/contracts.js';
import { KNOWLEDGE_DIR, TASKS_DIR } from '../src/config.js';
import { listTasks, listTasksPage, listTasksTree } from '../src/storage/tasks.js';
import { listDocs, listDocsPage, readDoc } from '../src/storage/knowledge.js';
import { resolveStoreId } from '../src/search/fts-index.js';

const PROJECT = `y02a-${process.pid}`;

let profile: StorageProfile;

function tempRoot(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `y02a-${label}-`));
}

beforeAll(() => {
  // The file profile serves the configured roots; pass them explicitly to prove the caller-owned
  // root contract works, and let the profile verify they match the configured directories.
  profile = createFileProfile({ tasksDir: TASKS_DIR, knowledgeDir: KNOWLEDGE_DIR });
});

afterAll(async () => {
  // Clean up this file's collection so a shared DATA_DIR run stays reproducible.
  const tasks = await profile.tasks.list({ project: PROJECT, includeTrashed: true, includeArchived: true });
  for (const task of tasks) await profile.tasks.deletePermanent(PROJECT, task.id);
  const docs = await profile.docs.list({ project: PROJECT, includeTrashed: true, includeArchived: true });
  for (const doc of docs) await profile.docs.deletePermanent(PROJECT, doc.id);
});

describe('Y-02a: profile manifest', () => {
  it('describes the file profile and its roots', () => {
    expect(profile.manifest.profile).toBe('file');
    expect(profile.manifest.collections).toEqual(['tasks', 'docs']);
    expect(profile.manifest.capabilities).toEqual({
      transactions: false,
      history: true,
      fullText: true,
      vectors: true,
      efficientListing: true,
    });
    expect(profile.manifest.roots.tasks).toBe(resolveStoreId(TASKS_DIR));
    expect(profile.manifest.roots.knowledge).toBe(resolveStoreId(KNOWLEDGE_DIR));
  });

  it('refuses a root that is not the configured directory', () => {
    expect(() => createFileProfile({ tasksDir: tempRoot('other') })).toThrow(StoreError);
    try {
      createFileProfile({ tasksDir: tempRoot('other') });
    } catch (error) {
      expect((error as StoreError).code).toBe('CONFIG_MISMATCH');
    }
  });
});

describe('Y-02a: task contract (file profile)', () => {
  it('creates, reads and updates a task', async () => {
    const created = await profile.tasks.create({
      project: PROJECT,
      title: 'contract task',
      description: 'created through the contract',
      tags: ['contract'],
      priority: 'high',
    });
    expect(created.id).toBeTruthy();
    expect(created.project).toBe(PROJECT);

    const read = await profile.tasks.get(PROJECT, created.id);
    expect(read).toMatchObject({ id: created.id, title: 'contract task', priority: 'high' });

    const updated = await profile.tasks.update(PROJECT, created.id, { title: 'contract task v2' });
    expect(updated?.title).toBe('contract task v2');
    expect((await profile.tasks.get(PROJECT, created.id))?.title).toBe('contract task v2');

    expect(await profile.tasks.get(PROJECT, 'missing-id')).toBeNull();
    expect(await profile.tasks.update(PROJECT, 'missing-id', { title: 'x' })).toBeNull();
  });

  it('lists with filters and matches the storage function exactly', async () => {
    const created = await profile.tasks.create({ project: PROJECT, title: 'tagged task', tags: ['contract-tag'] });
    const listed = await profile.tasks.list({ project: PROJECT, tag: 'contract-tag' });
    expect(listed.map((task) => task.id)).toContain(created.id);

    const direct = await listTasks({ project: PROJECT, tag: 'contract-tag' });
    expect(listed).toEqual(direct);

    const byStatus = await profile.tasks.list({ project: PROJECT, status: created.status });
    expect(byStatus.map((task) => task.id)).toContain(created.id);
  });

  it('pages identically to the storage function', async () => {
    for (const index of [1, 2, 3]) {
      await profile.tasks.create({ project: PROJECT, title: `page task ${index}`, tags: ['contract-page'] });
    }
    const options = { limit: 2, tag: 'contract-page' };
    const page = await profile.tasks.page(PROJECT, options);
    const direct = await listTasksPage(PROJECT, options);

    expect(page.items.map((task) => task.id)).toEqual(direct.items.map((task) => task.id));
    expect(page.keys).toEqual(direct.keys);
    expect(page.total).toBe(direct.total);
    expect(page.hasMore).toBe(direct.hasMore);

    // `TaskPage.keys` are raw page keys; the wire cursor is encoded one layer up (page-args), so
    // the contract checks the count-only path here instead of inventing a second encoding.
    const countOnly = await profile.tasks.page(PROJECT, { ...options, countOnly: true });
    const countOnlyDirect = await listTasksPage(PROJECT, { ...options, countOnly: true });
    expect(countOnly.total).toBe(countOnlyDirect.total);
    expect(countOnly.items).toHaveLength(0);
  });

  it('runs the archive → trash → restore → delete lifecycle', async () => {
    const created = await profile.tasks.create({ project: PROJECT, title: 'lifecycle task' });

    await profile.tasks.archive(PROJECT, created.id);
    expect(await profile.tasks.list({ project: PROJECT, tag: 'none' })).not.toContainEqual(
      expect.objectContaining({ id: created.id }),
    );
    expect((await profile.tasks.list({ project: PROJECT, includeArchived: true })).some((t) => t.id === created.id)).toBe(true);

    await profile.tasks.restore(PROJECT, created.id);
    await profile.tasks.trash(PROJECT, created.id);
    expect((await profile.tasks.list({ project: PROJECT })).some((t) => t.id === created.id)).toBe(false);
    expect((await profile.tasks.list({ project: PROJECT, includeTrashed: true })).some((t) => t.id === created.id)).toBe(true);

    await profile.tasks.restore(PROJECT, created.id);
    expect(await profile.tasks.deletePermanent(PROJECT, created.id)).toBe(true);
    expect(await profile.tasks.get(PROJECT, created.id)).toBeNull();
    expect(await profile.tasks.deletePermanent(PROJECT, created.id)).toBe(false);
  });

  it('closes a task through the workflow', async () => {
    const created = await profile.tasks.create({ project: PROJECT, title: 'close me' });
    const closed = await profile.tasks.close(PROJECT, created.id);
    expect(closed).not.toBeNull();
    expect(closed!.status).not.toBe(created.status);
  });

  it('returns a tree identical to the storage function', async () => {
    const parent = await profile.tasks.create({ project: PROJECT, title: 'tree parent' });
    const child = await profile.tasks.create({ project: PROJECT, title: 'tree child', parentId: parent.id });

    const tree = await profile.tasks.tree({ project: PROJECT });
    const direct = await listTasksTree({ project: PROJECT });
    expect(tree).toEqual(direct);

    const parentNode = tree.find((node) => node.id === parent.id);
    expect(parentNode?.children.map((node) => node.id)).toContain(child.id);

    await profile.tasks.deletePermanent(PROJECT, child.id);
    await profile.tasks.deletePermanent(PROJECT, parent.id);
  });

  it('claims, renews and releases a task', async () => {
    const created = await profile.tasks.create({ project: PROJECT, title: 'claim me' });
    const mine = { sessionId: 'session-a', ttlSec: 60 };

    const claimed = await profile.tasks.claim(PROJECT, created.id, mine);
    expect(claimed.status).toBe('claimed');

    const other = await profile.tasks.claim(PROJECT, created.id, { sessionId: 'session-b' });
    expect(other.status).toBe('claimed_by_other');

    const renewed = await profile.tasks.renewClaim(PROJECT, created.id, mine);
    expect(renewed.status).toBe('renewed');

    const released = await profile.tasks.releaseClaim(PROJECT, created.id, mine);
    expect(released.status).toBe('released');

    expect((await profile.tasks.claim(PROJECT, 'missing-id', mine)).status).toBe('not_found');
  });
});

describe('Y-02a: knowledge contract (file profile)', () => {
  it('creates, reads and updates a document', async () => {
    const created = await profile.docs.create({
      project: PROJECT,
      title: 'contract doc',
      content: '# body',
      tags: ['contract'],
      type: 'note',
    });
    expect(created.id).toBeTruthy();

    const read = await profile.docs.read(PROJECT, created.id);
    expect(read).toMatchObject({ id: created.id, title: 'contract doc', content: '# body' });

    const updated = await profile.docs.update(PROJECT, created.id, { title: 'contract doc v2', content: '# body v2' });
    expect(updated?.title).toBe('contract doc v2');
    expect((await profile.docs.read(PROJECT, created.id))?.content).toBe('# body v2');
    expect(await profile.docs.read(PROJECT, 'missing')).toBeNull();
  });

  it('lists and pages identically to the storage functions', async () => {
    await profile.docs.create({ project: PROJECT, title: 'paged doc 1', content: 'a', tags: ['contract-doc'] });
    await profile.docs.create({ project: PROJECT, title: 'paged doc 2', content: 'b', tags: ['contract-doc'] });

    const listed = await profile.docs.list({ project: PROJECT, tag: 'contract-doc' });
    expect(listed).toEqual(await listDocs({ project: PROJECT, tag: 'contract-doc' }));

    const options = { limit: 1 };
    const page = await profile.docs.page(PROJECT, options);
    const direct = await listDocsPage(PROJECT, options);
    expect(page.items.map((doc) => doc.id)).toEqual(direct.items.map((doc) => doc.id));
    expect(page.keys).toEqual(direct.keys);
    expect(page.total).toBe(direct.total);
  });

  it('runs the archive → trash → restore → delete lifecycle', async () => {
    const created = await profile.docs.create({ project: PROJECT, title: 'doc lifecycle', content: 'x' });

    await profile.docs.archive(PROJECT, created.id);
    expect((await profile.docs.list({ project: PROJECT })).some((doc) => doc.id === created.id)).toBe(false);
    await profile.docs.restore(PROJECT, created.id);

    await profile.docs.trash(PROJECT, created.id);
    expect((await profile.docs.list({ project: PROJECT })).some((doc) => doc.id === created.id)).toBe(false);
    expect((await profile.docs.list({ project: PROJECT, includeTrashed: true })).some((doc) => doc.id === created.id)).toBe(true);
    await profile.docs.restore(PROJECT, created.id);

    expect(await profile.docs.deletePermanent(PROJECT, created.id)).toBe(true);
    expect(await profile.docs.read(PROJECT, created.id)).toBeNull();
  });

  it('lists versions and restores one', async () => {
    const created = await profile.docs.create({ project: PROJECT, title: 'versioned doc', content: 'v1' });
    await profile.docs.update(PROJECT, created.id, { content: 'v2' });
    await profile.docs.update(PROJECT, created.id, { content: 'v3' });

    const versions = await profile.docs.versions(PROJECT, created.id);
    expect(versions.length).toBeGreaterThan(0);
    const oldest = versions.reduce((min, item) => (item.version < min.version ? item : min), versions[0]);

    const restored = await profile.docs.restoreVersion(PROJECT, created.id, oldest.version);
    expect(restored).not.toBeNull();
    expect(typeof restored!.content).toBe('string');

    const readAgain = await readDoc(PROJECT, created.id);
    // The stored body gains a trailing newline from the markdown writer; compare the text.
    expect(readAgain?.content.trimEnd()).toBe(restored!.content.trimEnd());
  });
});
