import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

// TMP env must be set before dynamic imports (config.ts resolves paths at load).
const DATA_DIR = fs.mkdtempSync(path.join(process.cwd(), '.tmp-sc02b-'));
process.env.DATA_DIR = DATA_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(DATA_DIR, 'vault');
process.env.EMBEDDINGS_MODE = 'none';
process.env.STORAGE_INDEX = 'auto';

import type * as TasksNS from '../src/storage/tasks.js';
import type * as KnowledgeNS from '../src/storage/knowledge.js';
import type * as ProjectsNS from '../src/projects.js';
import type * as IndexNS from '../src/storage/metadata-index.js';
import type { MetadataIndex, MetadataIndexDocRow, MetadataIndexTaskRow } from '../src/storage/metadata-index.js';

let tasks: typeof TasksNS;
let knowledge: typeof KnowledgeNS;
let projects: typeof ProjectsNS;
let mod: typeof IndexNS;
let real: ReturnType<typeof buildIndex>;
let TASKS_DIR = '';
let KNOWLEDGE_DIR = '';

type RealIndex = IndexNS.SqliteMetadataIndex;

function buildIndex(): RealIndex {
  const index = new mod.SqliteMetadataIndex({ dataDir: DATA_DIR });
  index.open();
  return index;
}

function indexPath(): string {
  return path.join(DATA_DIR, '.index', 'metadata.db');
}

function readMetaValue(key: string): string | undefined {
  const db = new Database(indexPath(), { readonly: true });
  try {
    return db.prepare('SELECT value FROM meta WHERE key = ?').pluck().get(key) as string | undefined;
  } finally {
    db.close();
  }
}

function projectName(prefix: string): string {
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
}

function taskFile(project: string, id: string): string {
  return path.join(TASKS_DIR, project, `${id}.json`);
}

function docFile(project: string, id: string): string {
  return path.join(KNOWLEDGE_DIR, project, `${id}.md`);
}

function expectedTaskRow(project: string, id: string): MetadataIndexTaskRow {
  const file = taskFile(project, id);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    id,
    project: raw.project || project,
    status: raw.status,
    priority: raw.priority ?? null,
    type: raw.type ?? 'task',
    parentId: raw.parentId ?? null,
    updatedAt: raw.updatedAt ?? null,
    mtimeMs: fs.statSync(file).mtimeMs,
    archived: Boolean(raw.archived),
    trashed: Boolean(raw.trashed),
    relPath: path.relative(DATA_DIR, file),
    tags: [...(raw.tags ?? [])].sort(),
  };
}

function taskRow(project: string, id: string): MetadataIndexTaskRow | undefined {
  return real.listTasks({ project }).items.find((row) => row.id === id);
}

function docRow(project: string, id: string): MetadataIndexDocRow | undefined {
  return real.listDocs({ project }).items.find((row) => row.id === id);
}

beforeAll(async () => {
  mod = await import('../src/storage/metadata-index.js');
  tasks = await import('../src/storage/tasks.js');
  knowledge = await import('../src/storage/knowledge.js');
  projects = await import('../src/projects.js');
  const config = await import('../src/config.js');
  TASKS_DIR = config.TASKS_DIR;
  KNOWLEDGE_DIR = config.KNOWLEDGE_DIR;
  real = buildIndex();
  mod.setActiveMetadataIndex(real);
});

afterAll(() => {
  mod.setActiveMetadataIndex(undefined);
  real.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

describe('SC-02b task write points', () => {
  it('createTask upserts a row that matches the file', async () => {
    const project = projectName('create');
    const task = await tasks.createTask({ project, title: 'first', priority: 'high', tags: ['a', 'b'] });
    expect(taskRow(project, task.id)).toEqual(expectedTaskRow(project, task.id));
  });

  it('updateTaskUnlocked rewrites status, priority, type, tags and parent', async () => {
    const project = projectName('update');
    const parent = await tasks.createTask({ project, title: 'parent' });
    const child = await tasks.createTask({ project, title: 'child', parentId: parent.id });

    await tasks.updateTask(project, child.id, {
      status: 'in_progress',
      priority: 'low',
      type: 'bug',
      tags: ['ui'],
      parentId: undefined,
    });
    expect(taskRow(project, child.id)).toEqual(expectedTaskRow(project, child.id));

    await tasks.updateTask(project, child.id, { tags: ['ui', 'regression'] });
    expect(taskRow(project, child.id)?.tags).toEqual(['regression', 'ui']);
    expect(taskRow(project, child.id)).toEqual(expectedTaskRow(project, child.id));

    await tasks.archiveTask(project, child.id);
    expect(taskRow(project, child.id)?.archived).toBe(true);
    expect(taskRow(project, child.id)).toEqual(expectedTaskRow(project, child.id));

    await tasks.trashTask(project, child.id);
    expect(taskRow(project, child.id)?.trashed).toBe(true);
    expect(taskRow(project, child.id)).toEqual(expectedTaskRow(project, child.id));

    await tasks.restoreTask(project, child.id);
    expect(taskRow(project, child.id)?.archived).toBe(false);
    expect(taskRow(project, child.id)?.trashed).toBe(false);
    expect(taskRow(project, child.id)).toEqual(expectedTaskRow(project, child.id));
  });

  it('claim, renew and release upsert the row and change only mtime', async () => {
    const project = projectName('claim');
    const task = await tasks.createTask({ project, title: 'leased' });
    const actor = { sessionId: 'ses-1' };
    const before = taskRow(project, task.id);
    expect(before).toBeDefined();

    const claimed = await tasks.claimTask(project, task.id, actor);
    expect(claimed.status).toBe('claimed');
    const afterClaim = taskRow(project, task.id);
    expect(afterClaim).toEqual(expectedTaskRow(project, task.id));
    expect(afterClaim?.updatedAt).toBe(before?.updatedAt);
    expect(afterClaim?.status).toBe(before?.status);
    expect(afterClaim?.priority).toBe(before?.priority);

    await tasks.renewTaskClaim(project, task.id, actor);
    const afterRenew = taskRow(project, task.id);
    expect(afterRenew).toEqual(expectedTaskRow(project, task.id));
    expect(afterRenew?.updatedAt).toBe(before?.updatedAt);

    const released = await tasks.releaseTaskClaim(project, task.id, actor);
    expect(released.status).toBe('released');
    const afterRelease = taskRow(project, task.id);
    expect(afterRelease).toEqual(expectedTaskRow(project, task.id));
    expect(afterRelease?.updatedAt).toBe(before?.updatedAt);
    expect(JSON.parse(fs.readFileSync(taskFile(project, task.id), 'utf8')).claim).toBeUndefined();
  });

  it('expired-claim sweeper writes through the same hook', async () => {
    const project = projectName('sweep');
    const task = await tasks.createTask({ project, title: 'stale lease' });
    await tasks.claimTask(project, task.id, { sessionId: 'ses-old', ttlSec: 1 });
    const file = taskFile(project, task.id);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.claim.expiresAt = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(file, JSON.stringify(raw, null, 2));

    const pruned = await tasks.pruneExpiredClaims(project);
    expect(pruned).toContain(`${project}/${task.id}`);
    expect(taskRow(project, task.id)).toEqual(expectedTaskRow(project, task.id));
  });

  it('moveTasksToType and moveTasksToStatus upsert', async () => {
    const project = projectName('move');
    const a = await tasks.createTask({ project, title: 'a' });
    const b = await tasks.createTask({ project, title: 'b' });

    await tasks.moveTasksToType(project, [a.id, b.id], 'feature');
    expect(taskRow(project, a.id)).toEqual(expectedTaskRow(project, a.id));
    expect(taskRow(project, a.id)?.type).toBe('feature');

    await tasks.moveTasksToStatus(project, [a.id, b.id], 'closed');
    expect(taskRow(project, b.id)).toEqual(expectedTaskRow(project, b.id));
    expect(taskRow(project, b.id)?.status).toBe('closed');
  });

  it('deleteTaskPermanent removes the row and is idempotent', async () => {
    const project = projectName('delete');
    const task = await tasks.createTask({ project, title: 'gone' });
    expect(taskRow(project, task.id)).toBeDefined();

    expect(await tasks.deleteTaskPermanent(project, task.id)).toBe(true);
    expect(taskRow(project, task.id)).toBeUndefined();

    expect(await tasks.deleteTaskPermanent(project, task.id)).toBe(false);
    expect(taskRow(project, task.id)).toBeUndefined();
  });
});

describe('SC-02b document write points', () => {
  it('createDoc and updateDoc upsert a row that matches the file', async () => {
    const project = projectName('docs');
    const doc = await knowledge.createDoc({ project, title: 'note', content: 'body', tags: ['kb'] });

    const row = docRow(project, doc.id);
    expect(row).toEqual({
      id: doc.id,
      project,
      title: 'note',
      type: null,
      parentId: null,
      trustLevel: 'user',
      updatedAt: doc.updatedAt,
      mtimeMs: fs.statSync(docFile(project, doc.id)).mtimeMs,
      archived: false,
      trashed: false,
      relPath: path.relative(DATA_DIR, docFile(project, doc.id)),
      tags: ['kb'],
    });

    await knowledge.updateDoc(project, doc.id, { title: 'renamed', tags: ['kb', 'sc02'], type: 'guide' });
    const updated = docRow(project, doc.id);
    expect(updated?.title).toBe('renamed');
    expect(updated?.type).toBe('guide');
    expect(updated?.tags).toEqual(['kb', 'sc02']);
    expect(updated?.mtimeMs).toBe(fs.statSync(docFile(project, doc.id)).mtimeMs);

    await knowledge.archiveDoc(project, doc.id);
    expect(docRow(project, doc.id)?.archived).toBe(true);
    expect(docRow(project, doc.id)?.mtimeMs).toBe(fs.statSync(docFile(project, doc.id)).mtimeMs);
  });

  it('deleteDocPermanent removes the row and is idempotent', async () => {
    const project = projectName('docdel');
    const doc = await knowledge.createDoc({ project, title: 'temp', content: 'x' });
    expect(docRow(project, doc.id)).toBeDefined();

    expect(await knowledge.deleteDocPermanent(project, doc.id)).toBe(true);
    expect(docRow(project, doc.id)).toBeUndefined();

    expect(await knowledge.deleteDocPermanent(project, doc.id)).toBe(false);
    expect(docRow(project, doc.id)).toBeUndefined();
  });
});

describe('SC-02b project_delete', () => {
  it('removes every task and doc row of the project', async () => {
    const project = projectName('prjdel');
    await projects.createProject(project);
    const task = await tasks.createTask({ project, title: 't' });
    const doc = await knowledge.createDoc({ project, title: 'd', content: 'x' });
    expect(taskRow(project, task.id)).toBeDefined();
    expect(docRow(project, doc.id)).toBeDefined();

    const result = await projects.deleteProject(project, true);
    expect(result.deleted).toBe(true);
    expect(real.listTasks({ project }).total).toBe(0);
    expect(real.listDocs({ project }).total).toBe(0);
  });
});

describe('SC-02b index failure never breaks the mutation', () => {
  it('a throwing upsert still writes the file and flags dirty', async () => {
    const project = projectName('throwing');
    const throwing: MetadataIndex = {
      dataDir: real.dataDir,
      open: () => undefined,
      close: () => undefined,
      upsertTask: () => {
        throw new Error('injected upsert failure');
      },
      deleteTask: () => {
        throw new Error('injected delete failure');
      },
      upsertDoc: () => undefined,
      deleteDoc: () => undefined,
      listTasks: (query) => real.listTasks(query),
      listDocs: (query) => real.listDocs(query),
      markDirty: (reason) => real.markDirty(reason),
      deleteProject: () => undefined,
      rebuild: (options) => real.rebuild(options),
      isProjectComplete: () => false,
      fillProject: async (options) => ({ project: options.project, tasks: 0, docs: 0, ms: 0 }),
      recountProject: () => undefined,
      markProjectsComplete: () => 0,
    };

    mod.setActiveMetadataIndex(throwing);
    try {
      const task = await tasks.createTask({ project, title: 'survives' });
      expect(fs.existsSync(taskFile(project, task.id))).toBe(true);
      expect(taskRow(project, task.id)).toBeUndefined();
      expect(readMetaValue('dirty')).toBe('1');
      expect(readMetaValue('dirty_reason')).toContain('injected upsert failure');
    } finally {
      mod.setActiveMetadataIndex(real);
    }

    await tasks.createTask({ project, title: 'after recovery' });
    expect(real.listTasks({ project }).total).toBe(1);
  });

  it('a closed index still lets the mutation succeed', async () => {
    const project = projectName('closed');
    const closed = buildIndex();
    closed.close();
    mod.setActiveMetadataIndex(closed);
    try {
      const task = await tasks.createTask({ project, title: 'no index here' });
      expect(fs.existsSync(taskFile(project, task.id))).toBe(true);
    } finally {
      mod.setActiveMetadataIndex(real);
    }
  });
});

describe('SC-02b rebuild', () => {
  it('reproduces every row from files, in bounded batches, skipping version snapshots', async () => {
    const project = projectName('rebuild');
    const taskA = await tasks.createTask({ project, title: 'r1', tags: ['x'] });
    const taskB = await tasks.createTask({ project, title: 'r2', priority: 'high' });
    const doc = await knowledge.createDoc({ project, title: 'doc', content: 'v1', tags: ['d'] });
    await knowledge.updateDoc(project, doc.id, { content: 'v2' });

    const tasksBefore = real.listTasks({ project });
    const docsBefore = real.listDocs({ project });
    expect(tasksBefore.total).toBe(2);
    expect(docsBefore.total).toBe(1);

    const db = new Database(indexPath());
    db.exec('DELETE FROM task_tags; DELETE FROM tasks; DELETE FROM doc_tags; DELETE FROM docs;');
    db.close();
    expect(real.listTasks({ project }).total).toBe(0);

    const result = await real.rebuild({ tasksDir: TASKS_DIR, knowledgeDir: KNOWLEDGE_DIR, batchSize: 2 });
    expect(result.tasks).toBeGreaterThanOrEqual(2);
    expect(result.docs).toBeGreaterThanOrEqual(1);
    expect(result.batches).toBeGreaterThanOrEqual(2);

    const tasksAfter = real.listTasks({ project });
    expect(tasksAfter.items).toEqual(tasksBefore.items);
    expect(tasksAfter.items.map((row) => row.id).sort()).toEqual([taskA.id, taskB.id].sort());
    expect(real.listDocs({ project }).items).toEqual(docsBefore.items);
    expect(readMetaValue('dirty')).toBe('0');
  });
});

describe('SC-02b STORAGE_INDEX=off', () => {
  it('does not touch the index when no index is registered', async () => {
    const project = projectName('off');
    const before = real.listTasks().total;
    mod.setActiveMetadataIndex(undefined);
    try {
      const task = await tasks.createTask({ project, title: 'files only' });
      expect(fs.existsSync(taskFile(project, task.id))).toBe(true);
    } finally {
      mod.setActiveMetadataIndex(real);
    }
    expect(real.listTasks().total).toBe(before);
    expect(real.listTasks({ project }).total).toBe(0);
  });
});
