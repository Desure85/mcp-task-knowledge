import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  compactShards,
  listDataFiles,
  migrateToShards,
  resolveDataFile,
  shardOfId,
  writeDataPath,
} from '../src/storage/sharding.js';

let root: string;
let tasks: typeof import('../src/storage/tasks.js');
let knowledge: typeof import('../src/storage/knowledge.js');

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sc06-'));
  process.env.DATA_DIR = root;
  process.env.CURRENT_PROJECT = 'p';
  process.env.EMBEDDINGS_MODE = 'none';
  vi.resetModules();
  tasks = await import('../src/storage/tasks.js');
  knowledge = await import('../src/storage/knowledge.js');
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('SC-06 sharding', () => {
  it('derives stable two-character shards', () => {
    expect(shardOfId('ab12')).toBe('ab');
    expect(shardOfId('AB12')).toBe('ab');
    expect(shardOfId('')).toBe('zz');
  });

  it('migrates root files, reads both layouts and never duplicates', async () => {
    const dir = path.join(root, 'tasks', 'migrate');
    await fs.mkdir(path.join(dir, 'ab'), { recursive: true });
    await fs.writeFile(path.join(dir, 'ab1.json'), JSON.stringify({ id: 'ab1', title: 'root' }));
    await fs.writeFile(path.join(dir, 'ab', 'ab2.json'), JSON.stringify({ id: 'ab2', title: 'shard' }));

    let listed = await listDataFiles(dir, '.json');
    expect(listed.map((f) => f.id).sort()).toEqual(['ab1', 'ab2']);

    const result = await migrateToShards(dir, '.json', { force: true });
    expect(result.moved).toBe(1);
    expect(await fs.stat(path.join(dir, 'ab', 'ab1.json'))).toBeTruthy();
    expect(await fs.stat(path.join(dir, '.sharded'))).toBeTruthy();

    listed = await listDataFiles(dir, '.json');
    expect(listed.map((f) => f.id).sort()).toEqual(['ab1', 'ab2']);
    expect(await resolveDataFile(dir, 'ab1', '.json')).toBe(path.join(dir, 'ab', 'ab1.json'));

    // Second migration is idempotent and does not create duplicates.
    const again = await migrateToShards(dir, '.json', { force: true });
    expect(again.moved).toBe(0);
    expect((await listDataFiles(dir, '.json')).length).toBe(2);
  });

  it('writes new files to a shard after migration and compacts back', async () => {
    const dir = path.join(root, 'tasks', 'write');
    await fs.mkdir(dir, { recursive: true });
    await migrateToShards(dir, '.json', { force: true });
    const p = await writeDataPath(dir, 'cd99', '.json', 50_000);
    expect(p).toBe(path.join(dir, 'cd', 'cd99.json'));
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, '{}');
    expect((await listDataFiles(dir, '.json')).length).toBe(1);

    const compacted = await compactShards(dir, '.json', { force: true });
    expect(compacted.moved).toBe(1);
    expect(await fs.stat(path.join(dir, 'cd99.json'))).toBeTruthy();
    expect(await fs.stat(path.join(dir, '.sharded')).catch(() => null)).toBeNull();
  });

  it('reads and updates tasks from a migrated project without duplicates', async () => {
    const created = await tasks.createTask({ project: 'p', title: 'Sharded task' });
    const dir = await tasks.tasksProjectDir('p');
    await migrateToShards(dir, '.json', { force: true });
    expect(await fs.stat(path.join(dir, shardOfId(created.id), `${created.id}.json`))).toBeTruthy();

    const loaded = await tasks.getTask('p', created.id);
    expect(loaded?.title).toBe('Sharded task');
    const all = await tasks.listTasks({ project: 'p' });
    expect(all.filter((t) => t.id === created.id)).toHaveLength(1);

    const updated = await tasks.updateTask('p', created.id, { title: 'Sharded updated' });
    expect(updated?.title).toBe('Sharded updated');
    expect(await fs.stat(path.join(dir, shardOfId(created.id), `${created.id}.json`))).toBeTruthy();
    expect(await tasks.deleteTaskPermanent('p', created.id)).toBe(true);
    expect(await tasks.getTask('p', created.id)).toBeNull();
  });

  it('archives stale closed tasks without deleting them', async () => {
    const task = await tasks.createTask({ project: 'p', title: 'Old closed' });
    const dir = await tasks.tasksProjectDir('p');
    await migrateToShards(dir, '.json', { force: true });
    const file = path.join(dir, shardOfId(task.id), `${task.id}.json`);
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    raw.status = 'completed';
    raw.updatedAt = new Date('2020-01-01T00:00:00.000Z').toISOString();
    await fs.writeFile(file, JSON.stringify(raw, null, 2));

    const archived = await tasks.archiveStaleClosedTasks('p', 30);
    expect(archived).toContain(task.id);
    const reread = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(reread.archived).toBe(true);
    expect(reread.status).toBe('completed');
    expect((await tasks.listTasks({ project: 'p' })).some((t) => t.id === task.id)).toBe(false);
    expect((await tasks.listTasks({ project: 'p', includeArchived: true })).some((t) => t.id === task.id)).toBe(true);
  });

  it('reads and updates knowledge docs from a migrated project', async () => {
    const doc = await knowledge.createDoc({ project: 'p', title: 'Doc', content: 'body' });
    const dir = path.join(root, 'knowledge', 'p');
    await migrateToShards(dir, '.md', { force: true });
    expect(await fs.stat(path.join(dir, shardOfId(doc.id), `${doc.id}.md`))).toBeTruthy();

    expect((await knowledge.readDoc('p', doc.id))?.content).toBe('body');
    const listed = await knowledge.listDocs({ project: 'p' });
    expect(listed.filter((d) => d.id === doc.id)).toHaveLength(1);

    const updated = await knowledge.updateDoc('p', doc.id, { content: 'new body' });
    expect(updated?.content).toBe('new body');
    expect(await fs.stat(path.join(dir, shardOfId(doc.id), `${doc.id}.md`))).toBeTruthy();
    expect(await knowledge.deleteDocPermanent('p', doc.id)).toBe(true);
    expect(await knowledge.readDoc('p', doc.id)).toBeNull();
  });
});
