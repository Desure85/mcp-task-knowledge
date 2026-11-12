import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createMetadataIndex,
  METADATA_INDEX_SCHEMA_VERSION,
  SqliteMetadataIndex,
  type MetadataIndexDocRow,
  type MetadataIndexTaskRow,
} from '../src/storage/metadata-index.js';

const tempDirs: string[] = [];

function makeDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-sc02a-'));
  tempDirs.push(dir);
  return dir;
}

function indexPath(dataDir: string): string {
  return path.join(dataDir, '.index', 'metadata.db');
}

function taskRow(overrides: Partial<MetadataIndexTaskRow> = {}): MetadataIndexTaskRow {
  return {
    id: 't-1',
    project: 'alpha',
    status: 'todo',
    priority: 'high',
    type: 'task',
    parentId: null,
    updatedAt: '2026-11-01T10:00:00.000Z',
    mtimeMs: 1730000000000.125,
    archived: false,
    trashed: false,
    relPath: 'tasks/alpha/t-1.json',
    tags: ['backend', 'db'],
    ...overrides,
  };
}

function docRow(overrides: Partial<MetadataIndexDocRow> = {}): MetadataIndexDocRow {
  return {
    id: 'd-1',
    project: 'alpha',
    title: 'Index design',
    type: 'note',
    parentId: null,
    trustLevel: 'user',
    updatedAt: '2026-11-02T10:00:00.000Z',
    mtimeMs: 1730000100000.5,
    archived: false,
    trashed: false,
    relPath: 'knowledge/alpha/d-1.md',
    tags: ['sc02'],
    ...overrides,
  };
}

function readMetaValue(dbPath: string, key: string): string | undefined {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare('SELECT value FROM meta WHERE key = ?').pluck().get(key) as string | undefined;
  } finally {
    db.close();
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('SqliteMetadataIndex — lifecycle', () => {
  it('opens once, creates DATA_DIR/.index/metadata.db, closes idempotently', () => {
    const dataDir = makeDataDir();
    const index = new SqliteMetadataIndex({ dataDir });

    index.open();
    index.open();
    expect(index.isOpen).toBe(true);
    expect(index.path).toBe(indexPath(dataDir));
    expect(fs.existsSync(indexPath(dataDir))).toBe(true);

    index.close();
    index.close();
    expect(index.isOpen).toBe(false);
  });

  it('records schema_version, data_dir, built_at and dirty in meta', () => {
    const dataDir = makeDataDir();
    const index = new SqliteMetadataIndex({ dataDir });
    index.open();
    index.close();

    expect(readMetaValue(indexPath(dataDir), 'schema_version')).toBe(String(METADATA_INDEX_SCHEMA_VERSION));
    expect(readMetaValue(indexPath(dataDir), 'data_dir')).toBe(path.resolve(dataDir));
    expect(readMetaValue(indexPath(dataDir), 'built_at')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(readMetaValue(indexPath(dataDir), 'dirty')).toBe('0');
  });

  it('keeps tasks, docs, tags and exact mtime across reopen', () => {
    const dataDir = makeDataDir();
    const first = new SqliteMetadataIndex({ dataDir });
    first.open();
    first.upsertTask(taskRow());
    first.upsertDoc(docRow());
    first.close();

    const second = new SqliteMetadataIndex({ dataDir });
    second.open();
    const tasks = second.listTasks();
    const docs = second.listDocs();
    second.close();

    expect(tasks.total).toBe(1);
    expect(tasks.items[0]).toEqual(taskRow());
    expect(tasks.items[0]?.mtimeMs).toBe(1730000000000.125);
    expect(docs.total).toBe(1);
    expect(docs.items[0]).toEqual(docRow());
  });
});

describe('SqliteMetadataIndex — rebuild triggers', () => {
  it('drops and recreates the index when schema_version differs', () => {
    const dataDir = makeDataDir();
    const index = new SqliteMetadataIndex({ dataDir });
    index.open();
    index.upsertTask(taskRow());
    index.close();

    const raw = new Database(indexPath(dataDir));
    raw.prepare("UPDATE meta SET value = '999' WHERE key = 'schema_version'").run();
    raw.close();

    const reopened = new SqliteMetadataIndex({ dataDir });
    reopened.open();
    expect(reopened.listTasks().total).toBe(0);
    reopened.close();

    expect(readMetaValue(indexPath(dataDir), 'schema_version')).toBe(String(METADATA_INDEX_SCHEMA_VERSION));
  });

  it('drops and recreates the index when data_dir belongs to another directory', () => {
    const dataDir = makeDataDir();
    const index = new SqliteMetadataIndex({ dataDir });
    index.open();
    index.upsertTask(taskRow());
    index.close();

    const raw = new Database(indexPath(dataDir));
    raw.prepare("UPDATE meta SET value = '/somewhere/else' WHERE key = 'data_dir'").run();
    raw.close();

    const reopened = new SqliteMetadataIndex({ dataDir });
    reopened.open();
    expect(reopened.listTasks().total).toBe(0);
    reopened.close();

    expect(readMetaValue(indexPath(dataDir), 'data_dir')).toBe(path.resolve(dataDir));
  });
});

describe('createMetadataIndex — degradation', () => {
  it('does not create the directory or the file when STORAGE_INDEX is off', () => {
    const dataDir = makeDataDir();
    const index = createMetadataIndex({ dataDir, mode: 'off' });

    expect(index).toBeNull();
    expect(fs.existsSync(path.join(dataDir, '.index'))).toBe(false);
  });

  it('returns null and warns on a corrupt database file without touching it', () => {
    const dataDir = makeDataDir();
    fs.mkdirSync(path.join(dataDir, '.index'), { recursive: true });
    fs.writeFileSync(indexPath(dataDir), 'this is definitely not a sqlite database');
    const warn = vi.fn();

    const index = createMetadataIndex({ dataDir, logger: { warn } });

    expect(index).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(indexPath(dataDir), 'utf8')).toBe('this is definitely not a sqlite database');
  });

  it('opens normally when enabled', () => {
    const dataDir = makeDataDir();
    const index = createMetadataIndex({ dataDir, mode: 'auto' });

    expect(index).not.toBeNull();
    expect(index?.isOpen).toBe(true);
    index?.close();
  });
});

describe('SqliteMetadataIndex — two instances on one file', () => {
  it('opens both with WAL and sees committed rows across connections', () => {
    const dataDir = makeDataDir();
    const a = new SqliteMetadataIndex({ dataDir });
    const b = new SqliteMetadataIndex({ dataDir });
    a.open();
    b.open();

    a.upsertTask(taskRow({ id: 't-a', mtimeMs: 1000 }));
    expect(b.listTasks().items.map((r) => r.id)).toEqual(['t-a']);

    b.upsertTask(taskRow({ id: 't-b', mtimeMs: 2000 }));
    expect(a.listTasks().items.map((r) => r.id)).toEqual(['t-b', 't-a']);
    expect(fs.existsSync(`${indexPath(dataDir)}-wal`)).toBe(true);

    b.close();
    a.close();
  });
});

describe('SC-02g layout compatibility', () => {
  it('rebuilds rows when a task moves from project layout to shards and reads both layouts', async () => {
    const dir = makeDataDir();
    const tasksDir = path.join(dir, 'tasks');
    const knowledgeDir = path.join(dir, 'knowledge');
    fs.mkdirSync(path.join(tasksDir, 'alpha'), { recursive: true });
    fs.mkdirSync(knowledgeDir, { recursive: true });
    const task = (id: string) => JSON.stringify({ id, project: 'alpha', title: id, status: 'todo', priority: 'medium', type: 'task' });
    fs.writeFileSync(path.join(tasksDir, 'alpha', 't-1.json'), task('t-1'));
    fs.writeFileSync(path.join(tasksDir, 't-2.json'), task('t-2'));

    const index = createMetadataIndex({ dataDir: dir })!;
    index.open();
    try {
      await index.rebuild({ tasksDir, knowledgeDir });
      let rows = index.listTasks({ project: 'alpha' }).items;
      expect(rows.map((r) => r.id).sort()).toEqual(['t-1', 't-2']);
      const before = rows.find((r) => r.id === 't-1')!;
      expect(before.relPath.replace(/\\/g, '/')).toBe('tasks/alpha/t-1.json');

      fs.mkdirSync(path.join(tasksDir, 'al'), { recursive: true });
      fs.renameSync(path.join(tasksDir, 'alpha', 't-1.json'), path.join(tasksDir, 'al', 't-1.json'));
      await index.rebuild({ tasksDir, knowledgeDir });

      rows = index.listTasks({ project: 'alpha' }).items;
      expect(rows.map((r) => r.id).sort()).toEqual(['t-1', 't-2']);
      const after = rows.find((r) => r.id === 't-1')!;
      expect(after.relPath.replace(/\\/g, '/')).toBe('tasks/al/t-1.json');
      expect(rows.filter((r) => r.id === 't-1')).toHaveLength(1);
    } finally {
      index.close();
    }
  });
});