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
import { KNOWLEDGE_DIR, PROMPTS_DIR, TASKS_DIR } from '../src/config.js';
import { getDirectChildren, getTaskSubtree, listTasks, listTasksPage, listTasksTree } from '../src/storage/tasks.js';
import { listDocs, listDocsPage, readDoc } from '../src/storage/knowledge.js';
import { resolveStoreId } from '../src/search/fts-index.js';
import { TemporalGraph } from '../src/memory/temporal-graph.js';
import { ProfileManager } from '../src/memory/user-profile.js';
import { LayeredMemory } from '../src/memory/layers.js';
import { SessionMemory } from '../src/memory/session-memory.js';
import {
  listPromptVersions,
  listSourceJsonFiles,
  readPromptBuildItems,
  readPromptsCatalog,
} from '../src/prompts/files.js';

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
    expect(profile.manifest.collections).toEqual(['tasks', 'docs', 'projects', 'prompts', 'memory', 'events', 'history', 'locks']);
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

describe('Y-02e2: task contract extras (cascade, subtree, children)', () => {
  it('closes a task together with its descendants when cascade is set', async () => {
    const root = await profile.tasks.create({ project: PROJECT, title: 'cascade root' });
    const child = await profile.tasks.create({ project: PROJECT, title: 'cascade child', parentId: root.id });
    const grandchild = await profile.tasks.create({ project: PROJECT, title: 'cascade grandchild', parentId: child.id });

    const result = await profile.tasks.closeWithCascade(PROJECT, root.id, true);
    expect(result.root?.id).toBe(root.id);
    expect(result.cascaded.map((task) => task.id).sort()).toEqual([child.id, grandchild.id].sort());

    const statuses = new Set<string>();
    for (const id of [root.id, child.id, grandchild.id]) {
      const stored = await profile.tasks.get(PROJECT, id);
      expect(stored).not.toBeNull();
      statuses.add(stored!.status);
    }
    expect(statuses.size).toBe(1);
    expect([...statuses][0]).not.toBe(root.status);

    for (const id of [grandchild.id, child.id, root.id]) await profile.tasks.deletePermanent(PROJECT, id);
  });

  it('does not touch descendants when cascade is off', async () => {
    const root = await profile.tasks.create({ project: PROJECT, title: 'no-cascade root' });
    const child = await profile.tasks.create({ project: PROJECT, title: 'no-cascade child', parentId: root.id });

    const result = await profile.tasks.closeWithCascade(PROJECT, root.id, false);
    expect(result.root?.id).toBe(root.id);
    expect(result.cascaded).toEqual([]);
    expect((await profile.tasks.get(PROJECT, child.id))?.status).toBe(child.status);

    expect((await profile.tasks.closeWithCascade(PROJECT, 'missing-id', true)).root).toBeNull();

    await profile.tasks.deletePermanent(PROJECT, child.id);
    await profile.tasks.deletePermanent(PROJECT, root.id);
  });

  it('returns children and subtree identical to the storage functions', async () => {
    const root = await profile.tasks.create({ project: PROJECT, title: 'extra root' });
    const child = await profile.tasks.create({ project: PROJECT, title: 'extra child', parentId: root.id });
    const grandchild = await profile.tasks.create({ project: PROJECT, title: 'extra grandchild', parentId: child.id });

    expect(await profile.tasks.children(PROJECT, root.id)).toEqual(await getDirectChildren(PROJECT, root.id));
    expect(await profile.tasks.subtree(PROJECT, root.id)).toEqual(await getTaskSubtree(PROJECT, root.id));
    expect(await profile.tasks.subtree(PROJECT, 'missing-id')).toBeNull();
    expect(await profile.tasks.children(PROJECT, grandchild.id)).toEqual([]);

    await profile.tasks.deletePermanent(PROJECT, grandchild.id);
    await profile.tasks.deletePermanent(PROJECT, child.id);
    await profile.tasks.deletePermanent(PROJECT, root.id);
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

describe('Y-02b: project metadata contract (file profile)', () => {
  const PROJECT_ID = `y02b-${process.pid}`;

  it('creates, lists, details, updates metadata and deletes a project', async () => {
    const created = await profile.project.create(PROJECT_ID, 'contract project');
    expect(created.id).toBe(PROJECT_ID);

    const listed = await profile.project.list(() => 'mcp');
    expect(listed.some((project) => project.id === PROJECT_ID)).toBe(true);

    const detail = await profile.project.detail(PROJECT_ID, () => 'mcp');
    expect(detail?.id).toBe(PROJECT_ID);
    expect(detail?.metadata?.description).toBe('contract project');

    const updated = await profile.project.updateMetadata(PROJECT_ID, { description: 'updated through the contract' });
    expect(updated?.description).toBe('updated through the contract');
    expect((await profile.project.readMetadata(PROJECT_ID))?.description).toBe('updated through the contract');

    const workflow = await profile.project.workflow(PROJECT_ID);
    expect(Array.isArray(workflow.statuses)).toBe(true);
    expect(workflow.statuses.length).toBeGreaterThan(0);

    const removed = await profile.project.remove(PROJECT_ID, true);
    expect(removed.deleted).toBe(true);
    expect(await profile.project.detail(PROJECT_ID, () => 'mcp')).toBeNull();
  });
});

describe('Y-02b: lock contract (file profile)', () => {
  it('never runs two critical sections of the same key at once', async () => {
    let active = 0;
    let maxActive = 0;
    const finished: number[] = [];

    await Promise.all(
      [1, 2, 3].map((index) =>
        profile.locks.withLock('contract-lock', async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active--;
          finished.push(index);
        }),
      ),
    );

    expect(maxActive).toBe(1);
    expect(finished).toHaveLength(3);
  });

  it('releases the section after a failure', async () => {
    await expect(
      profile.locks.withLock('contract-lock', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await expect(profile.locks.withLock('contract-lock', async () => 'ok')).resolves.toBe('ok');
  });
});

describe('Y-02b: history contract (file profile)', () => {
  it('lists and restores document versions', async () => {
    const created = await profile.docs.create({ project: PROJECT, title: 'history doc', content: 'first' });
    await profile.docs.update(PROJECT, created.id, { content: 'second' });
    await profile.docs.update(PROJECT, created.id, { content: 'third' });

    const versions = await profile.history.list(PROJECT, 'doc', created.id);
    expect(versions.length).toBeGreaterThan(0);
    expect(versions).toEqual(await profile.docs.versions(PROJECT, created.id));

    const oldest = versions.reduce((min, item) => (item.version < min.version ? item : min), versions[0]);
    const restored = await profile.history.restore(PROJECT, 'doc', created.id, oldest.version);
    expect(restored).not.toBeNull();
    expect(restored!.id).toBe(created.id);
  });

  it('refuses task history with an explicit capability error', async () => {
    await expect(profile.history.list(PROJECT, 'task', 'any-id')).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
    });
    await expect(profile.history.restore(PROJECT, 'task', 'any-id', 1)).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
    });
  });
});

describe('Y-02b: event log contract (file profile)', () => {
  let storage: string;

  beforeAll(() => {
    storage = fs.mkdtempSync(path.join(os.tmpdir(), 'y02b-events-'));
  });

  afterAll(() => {
    fs.rmSync(storage, { recursive: true, force: true });
  });

  it('appends, replays, snapshots and compacts events', () => {
    // `storagePath` is the log file itself (EventLog rewrites it atomically per append).
    const log = profile.events(path.join(storage, 'sync-events.json'));
    const first = log.append('entity-1', 'task', 'create', { id: 'entity-1', title: 'first' }, 1);
    const second = log.append('entity-1', 'task', 'update', { id: 'entity-1', title: 'second' }, 2);

    expect(second.eventId).toBeGreaterThan(first.eventId);
    expect(log.since(first.eventId).map((event) => event.eventId)).toEqual([second.eventId]);
    expect(log.since(0).map((event) => event.eventId)).toEqual([first.eventId, second.eventId]);

    // Snapshots are built by `compact()` (that is where the file profile folds the log).
    const compacted = log.compact();
    expect(compacted.compacted).toBeGreaterThanOrEqual(1);
    expect(compacted.remaining).toBe(0);

    const snapshot = log.snapshot('entity-1');
    expect(snapshot?.state).toMatchObject({ title: 'second' });
    expect(log.snapshots().map((entry) => entry.entityId)).toEqual(['entity-1']);
  });
});

describe('Y-02c: prompt contract (file profile)', () => {
  const PROMPTS_PROJECT = `y02c-${process.pid}`;
  const promptProjectBase = path.join(PROMPTS_DIR, PROMPTS_PROJECT);

  beforeAll(() => {
    fs.mkdirSync(path.join(promptProjectBase, 'prompts'), { recursive: true });
    fs.mkdirSync(path.join(promptProjectBase, 'rules'), { recursive: true });
    const write = (kind: 'prompts' | 'rules', file: string, data: Record<string, unknown>) =>
      fs.writeFileSync(path.join(promptProjectBase, kind, file), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    write('prompts', 'demo@1.0.0.json', { id: 'demo', version: '1.0.0', metadata: { kind: 'prompt' }, template: 'first' });
    write('prompts', 'demo@2.0.0.json', { id: 'demo', version: '2.0.0', metadata: { kind: 'prompt' }, template: 'second' });
    write('rules', 'rule-a@1.0.0.json', { id: 'rule-a', version: '1.0.0', metadata: { kind: 'rule' }, template: 'rule' });
  });

  afterAll(() => {
    fs.rmSync(promptProjectBase, { recursive: true, force: true });
  });

  it('lists source files with kind and path', async () => {
    const listed = await profile.prompts.list(PROMPTS_PROJECT);
    expect(listed).toHaveLength(3);
    expect(listed.map((item) => item.id).sort()).toEqual(['demo', 'demo', 'rule-a']);
    expect(listed.find((item) => item.id === 'rule-a')?.kind).toBe('rule');

    const direct = await listSourceJsonFiles(PROMPTS_PROJECT);
    expect(listed.map((item) => item.path).sort()).toEqual([...direct].sort());
  });

  it('reads one version or the latest by default', async () => {
    const latest = await profile.prompts.get(PROMPTS_PROJECT, 'demo');
    expect(latest?.version).toBe('2.0.0');
    expect((latest?.data as { template?: string }).template).toBe('second');

    const first = await profile.prompts.get(PROMPTS_PROJECT, 'demo', '1.0.0');
    expect((first?.data as { template?: string }).template).toBe('first');

    expect(await profile.prompts.get(PROMPTS_PROJECT, 'missing')).toBeNull();
    expect(await profile.prompts.get(PROMPTS_PROJECT, 'demo', '9.9.9')).toBeNull();
  });

  it('lists versions oldest first and marks the latest', async () => {
    const versions = await profile.prompts.versions(PROMPTS_PROJECT, 'demo');
    expect(versions.map((item) => item.version)).toEqual(['1.0.0', '2.0.0']);
    expect(versions.map((item) => item.latest)).toEqual([false, true]);
    expect(versions).toEqual(await listPromptVersions(PROMPTS_PROJECT, 'demo'));
  });

  it('reports generated artifacts as absent until the pipeline builds them', async () => {
    expect(await profile.prompts.catalog(PROMPTS_PROJECT)).toBeNull();
    expect(await profile.prompts.catalog(PROMPTS_PROJECT)).toEqual(await readPromptsCatalog(PROMPTS_PROJECT));
    expect(await profile.prompts.buildItems(PROMPTS_PROJECT)).toEqual([]);
    expect(await profile.prompts.buildItems(PROMPTS_PROJECT)).toEqual(await readPromptBuildItems(PROMPTS_PROJECT));
  });

  it('exposes the moved helpers through the register/helpers re-exports', async () => {
    const viaHelpers = await import('../src/register/helpers.js');
    const viaFiles = await import('../src/prompts/files.js');
    expect(viaHelpers.readPromptsCatalog).toBe(viaFiles.readPromptsCatalog);
    expect(viaHelpers.readPromptBuildItems).toBe(viaFiles.readPromptBuildItems);
    expect(viaHelpers.listPromptVersions).toBe(viaFiles.listPromptVersions);
    expect(viaHelpers.findFileByIdVersion).toBe(viaFiles.findFileByIdVersion);
    expect(viaHelpers.listSourceJsonFiles).toBe(viaFiles.listSourceJsonFiles);
  });
});

describe('Y-02d: memory contract (file profile)', () => {
  let memoryDir: string;

  beforeAll(() => {
    memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'y02d-memory-'));
  });

  afterAll(() => {
    fs.rmSync(memoryDir, { recursive: true, force: true });
  });

  it('persists temporal facts through the profile factory', () => {
    const storagePath = path.join(memoryDir, 'temporal.json');
    const temporal = profile.memory.temporal(storagePath);

    const fact = temporal.addFact({ statement: 'the sky is blue', category: 'world', tags: ['sky'] });
    expect(temporal.getFact(fact.id)).toMatchObject({ statement: 'the sky is blue', valid: true });
    expect(temporal.query({ tag: 'sky' }).map((item) => item.id)).toContain(fact.id);

    expect(temporal.invalidateFact(fact.id, 'night')).toBe(true);
    expect(temporal.getFact(fact.id)?.valid).toBe(false);
    expect(temporal.getFactHistory(fact.id).length).toBeGreaterThan(0);
    expect(temporal.stats()).toMatchObject({ totalFacts: 1, validFacts: 0, invalidatedFacts: 1 });

    // The factory hands out real storage: another instance on the same path sees the same state.
    const reloaded = new TemporalGraph({ storagePath });
    expect(reloaded.getFact(fact.id)?.statement).toBe('the sky is blue');
    expect(reloaded.getFact(fact.id)?.invalidationReason).toBe('night');
  });

  it('persists user profiles through the factory', () => {
    const storagePath = path.join(memoryDir, 'profiles');
    const profiles = profile.memory.profiles(storagePath);

    const updated = profiles.updateProfile('user-1', {
      static: { role: 'engineer' },
      dynamicFact: { statement: 'prefers dark mode', category: 'ui' },
    });
    expect(updated.static.role.value).toBe('engineer');
    expect(profiles.getValidDynamicFacts('user-1')).toHaveLength(1);
    expect(profiles.buildContextBlock('user-1')).toContain('engineer');
    expect(profiles.listUsers()).toContain('user-1');

    const reloaded = new ProfileManager({ storagePath });
    expect(reloaded.getProfile('user-1')?.static.role.value).toBe('engineer');

    expect(profiles.deleteProfile('user-1')).toBe(true);
    expect(profiles.getProfile('user-1')).toBeNull();
  });

  it('keeps layered memory and promotions', () => {
    const storagePath = path.join(memoryDir, 'layers.json');
    const layered = profile.memory.layered({ storagePath });

    const fact = layered.add('conversation', { statement: 'user asked about the DAG', category: 'topic' });
    expect(layered.get('conversation', fact.id)?.statement).toBe('user asked about the DAG');
    expect(layered.getLayer('conversation')).toHaveLength(1);

    expect(layered.promote('conversation', 'session', fact.id)).toBe(true);
    expect(layered.getLayer('session')).toHaveLength(1);

    // Persistence parity is checked while the fact is still valid: `getLayer` returns valid facts.
    const reloaded = new LayeredMemory({ storagePath });
    expect(reloaded.getLayer('session')[0]?.statement).toBe('user asked about the DAG');

    expect(layered.invalidate('session', fact.id)).toBe(true);
    expect(layered.stats().session.total).toBe(1);
  });

  it('keeps session memory and conventions', () => {
    const filePath = path.join(memoryDir, 'session-memory.json');
    const session = profile.memory.session({ filePath });

    const saved = session.saveSession({
      startedAt: '2026-11-09T10:00:00.000Z',
      endedAt: '2026-11-09T11:00:00.000Z',
      summary: 'Y-02d memory contract',
      nextSteps: ['Y-02e'],
      filesModified: ['src/storage/contracts.ts'],
      decisions: [],
      conventions: [],
      metadata: {},
    });
    expect(saved.id).toBeTruthy();
    expect(session.getLastSession()?.summary).toBe('Y-02d memory contract');
    expect(session.getSessions()).toHaveLength(1);

    session.addConvention('one increment per PR');
    expect(session.getConventions()).toContain('one increment per PR');
    expect(session.getContextSummary()).toContain('Y-02d memory contract');

    const reloaded = new SessionMemory({ filePath });
    expect(reloaded.getLastSession()?.summary).toBe('Y-02d memory contract');
    expect(reloaded.getConventions()).toContain('one increment per PR');
  });
});
