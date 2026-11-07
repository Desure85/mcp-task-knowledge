/**
 * SC-02a — derived SQLite metadata index for the file storage profile.
 *
 * Files stay the source of truth (owner decision Y-09): this index is a
 * throwaway cache of list metadata (id, path, mtime, filters). It is created
 * in one place (`AppContainer.init`, after the DATA_DIR schema gate) and is
 * not read or written by the storage layer yet — write hooks are SC-02b and
 * the paginated read path is SC-02c.
 *
 * Behaviour:
 *   - one file per DATA_DIR: `DATA_DIR/.index/metadata.db` (WAL);
 *   - `meta.schema_version` mismatch or a foreign `meta.data_dir` drops and
 *     recreates the index (nothing to lose: it is derived);
 *   - an unreadable/corrupt file disables the index for the process
 *     (`STORAGE_INDEX=off` behaviour) with a warning — the server still boots;
 *   - `STORAGE_INDEX=off` never creates the directory or the file.
 *
 * Design and schema: `docs/dev-cycle/decisions/2026-11-07-1437-sc02-sqlite-index.md`.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import type { KnowledgeDocMeta, Task } from '../types.js';
import { childLogger } from '../core/logger.js';

const log = childLogger('storage:metadata-index');

/** Bumped when the index schema changes; a mismatch rebuilds the index. */
export const METADATA_INDEX_SCHEMA_VERSION = 1;

/** Directory under DATA_DIR that holds the derived index. */
export const METADATA_INDEX_DIR = '.index';

/** File name of the derived index database. */
export const METADATA_INDEX_FILE = 'metadata.db';

/** `auto` enables the index for the file profile; `off` is the rollback switch. */
export type StorageIndexMode = 'auto' | 'off';

/** Minimal logger surface (pino-compatible). */
export interface MetadataIndexLogger {
  warn(obj: unknown, msg?: string, ...args: unknown[]): void;
  info?(obj: unknown, msg?: string, ...args: unknown[]): void;
}

export interface MetadataIndexTaskRow {
  id: string;
  project: string;
  status: string;
  priority: string | null;
  type: string;
  parentId: string | null;
  updatedAt: string | null;
  /** Exactly `fs.stat().mtimeMs` — the SC-01 page key. */
  mtimeMs: number;
  archived: boolean;
  trashed: boolean;
  /** Path relative to DATA_DIR (supports legacy and sharded layouts). */
  relPath: string;
  tags: string[];
}

export interface MetadataIndexDocRow {
  id: string;
  project: string;
  title: string | null;
  type: string | null;
  parentId: string | null;
  trustLevel: string | null;
  updatedAt: string | null;
  mtimeMs: number;
  archived: boolean;
  trashed: boolean;
  relPath: string;
  tags: string[];
}

/** Minimal list query for the scaffold; SC-02c adds the page filters. */
export interface MetadataIndexListQuery {
  project?: string;
  limit?: number;
  offset?: number;
}

export interface MetadataIndexListResult<T> {
  items: T[];
  /** Exact row count for the query, ignoring `limit`/`offset`. */
  total: number;
}

/**
 * Internal abstraction over the metadata index (decision §"Профили хранилищ").
 * Kept intentionally small so the file profile can own it when Y-02 lands.
 */
export interface MetadataIndex {
  /** Absolute DATA_DIR the index belongs to; `rel_path` is relative to it. */
  readonly dataDir: string;
  open(): void;
  close(): void;
  upsertTask(row: MetadataIndexTaskRow): void;
  deleteTask(id: string): void;
  upsertDoc(row: MetadataIndexDocRow): void;
  deleteDoc(id: string): void;
  listTasks(query?: MetadataIndexListQuery): MetadataIndexListResult<MetadataIndexTaskRow>;
  listDocs(query?: MetadataIndexListQuery): MetadataIndexListResult<MetadataIndexDocRow>;
  /** SC-02b: mark the index stale after a failed write or an out-of-band change. */
  markDirty(reason?: string): void;
  /** SC-02b: `project_delete` removes every row of the project. */
  deleteProject(project: string): void;
  /** SC-02b: full rebuild from files, bounded batches (memory stays flat). */
  rebuild(options: MetadataIndexRebuildOptions): Promise<MetadataIndexRebuildResult>;
}

/** SC-02b: directories the rebuild scans (legacy overrides are honoured by the caller). */
export interface MetadataIndexRebuildOptions {
  tasksDir: string;
  knowledgeDir: string;
  /** Rows per transaction; 2000 keeps RSS flat on 100k (DoD SC-02b). */
  batchSize?: number;
}

export interface MetadataIndexRebuildResult {
  tasks: number;
  docs: number;
  batches: number;
  ms: number;
}

export interface CreateMetadataIndexOptions {
  dataDir: string;
  mode?: StorageIndexMode;
  logger?: MetadataIndexLogger;
}

const SCHEMA_SQL = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;

CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  project     TEXT NOT NULL,
  status      TEXT NOT NULL,
  priority    TEXT,
  type        TEXT NOT NULL DEFAULT 'task',
  parent_id   TEXT,
  updated_at  TEXT,
  mtime_ms    REAL NOT NULL,
  archived    INTEGER NOT NULL DEFAULT 0,
  trashed     INTEGER NOT NULL DEFAULT 0,
  rel_path    TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX idx_tasks_page        ON tasks(project, mtime_ms DESC, id ASC);
CREATE INDEX idx_tasks_status_page ON tasks(project, status, mtime_ms DESC, id ASC);
CREATE INDEX idx_tasks_type_page   ON tasks(project, type, mtime_ms DESC, id ASC);
CREATE INDEX idx_tasks_parent_page ON tasks(project, parent_id, mtime_ms DESC, id ASC);
CREATE INDEX idx_tasks_priority    ON tasks(project, priority, mtime_ms DESC, id ASC);

CREATE TABLE task_tags (task_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (task_id, tag)) WITHOUT ROWID;
CREATE INDEX idx_task_tags_tag ON task_tags(tag, task_id);

CREATE TABLE docs (
  id          TEXT PRIMARY KEY,
  project     TEXT NOT NULL,
  title       TEXT,
  type        TEXT,
  parent_id   TEXT,
  trust_level TEXT,
  updated_at  TEXT,
  mtime_ms    REAL NOT NULL,
  archived    INTEGER NOT NULL DEFAULT 0,
  trashed     INTEGER NOT NULL DEFAULT 0,
  rel_path    TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX idx_docs_page        ON docs(project, mtime_ms DESC, id ASC);
CREATE INDEX idx_docs_type_page   ON docs(project, type, mtime_ms DESC, id ASC);
CREATE INDEX idx_docs_parent_page ON docs(project, parent_id, mtime_ms DESC, id ASC);

CREATE TABLE doc_tags (doc_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (doc_id, tag)) WITHOUT ROWID;
CREATE INDEX idx_doc_tags_tag ON doc_tags(tag, doc_id);

CREATE TABLE projects (
  project      TEXT PRIMARY KEY,
  dir_mtime_ms REAL NOT NULL,
  file_count   INTEGER NOT NULL,
  synced_at    TEXT NOT NULL
) WITHOUT ROWID;
`;

const DROP_SQL = `
DROP TABLE IF EXISTS task_tags;
DROP TABLE IF EXISTS doc_tags;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS docs;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS meta;
`;

/** Raw row shapes returned by better-sqlite3. */
interface TaskDbRow {
  id: string;
  project: string;
  status: string;
  priority: string | null;
  type: string;
  parent_id: string | null;
  updated_at: string | null;
  mtime_ms: number;
  archived: number;
  trashed: number;
  rel_path: string;
}

interface DocDbRow {
  id: string;
  project: string;
  title: string | null;
  type: string | null;
  parent_id: string | null;
  trust_level: string | null;
  updated_at: string | null;
  mtime_ms: number;
  archived: number;
  trashed: number;
  rel_path: string;
}

interface TagDbRow {
  id: string;
  tag: string;
}

export class SqliteMetadataIndex implements MetadataIndex {
  /** Absolute path of the index database. */
  readonly path: string;
  /** Absolute DATA_DIR this index belongs to. */
  readonly dataDir: string;
  private readonly logger?: MetadataIndexLogger;
  private db?: Database.Database;

  constructor(options: { dataDir: string; logger?: MetadataIndexLogger }) {
    this.dataDir = path.resolve(options.dataDir);
    this.path = path.join(this.dataDir, METADATA_INDEX_DIR, METADATA_INDEX_FILE);
    this.logger = options.logger;
  }

  get isOpen(): boolean {
    return this.db !== undefined;
  }

  /** Idempotent: a second call on an open instance is a no-op. */
  open(): void {
    if (this.db) return;
    fs.mkdirSync(path.dirname(this.path), { recursive: true });

    let db: Database.Database | undefined;
    try {
      db = new Database(this.path);
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.pragma('busy_timeout = 5000');
      db.pragma('temp_store = MEMORY');
      db.pragma('wal_autocheckpoint = 1000');
      this.prepareSchema(db);
      this.db = db;
    } catch (err) {
      try {
        db?.close();
      } catch {
        // The original failure is the one that matters.
      }
      throw err;
    }
  }

  /** Idempotent: safe to call on a closed or never-opened instance. */
  close(): void {
    const db = this.db;
    this.db = undefined;
    if (!db) return;
    db.close();
  }

  upsertTask(row: MetadataIndexTaskRow): void {
    const db = this.requireDb();
    db.transaction((task: MetadataIndexTaskRow) => {
      db.prepare(
        `INSERT INTO tasks
           (id, project, status, priority, type, parent_id, updated_at, mtime_ms, archived, trashed, rel_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           project = excluded.project,
           status = excluded.status,
           priority = excluded.priority,
           type = excluded.type,
           parent_id = excluded.parent_id,
           updated_at = excluded.updated_at,
           mtime_ms = excluded.mtime_ms,
           archived = excluded.archived,
           trashed = excluded.trashed,
           rel_path = excluded.rel_path`,
      ).run(
        task.id,
        task.project,
        task.status,
        task.priority,
        task.type,
        task.parentId,
        task.updatedAt,
        task.mtimeMs,
        task.archived ? 1 : 0,
        task.trashed ? 1 : 0,
        task.relPath,
      );
      db.prepare('DELETE FROM task_tags WHERE task_id = ?').run(task.id);
      const insertTag = db.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag) VALUES (?, ?)');
      for (const tag of task.tags) insertTag.run(task.id, tag);
    })(row);
  }

  deleteTask(id: string): void {
    const db = this.requireDb();
    db.transaction((taskId: string) => {
      db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
      db.prepare('DELETE FROM task_tags WHERE task_id = ?').run(taskId);
    })(id);
  }

  upsertDoc(row: MetadataIndexDocRow): void {
    const db = this.requireDb();
    db.transaction((doc: MetadataIndexDocRow) => {
      db.prepare(
        `INSERT INTO docs
           (id, project, title, type, parent_id, trust_level, updated_at, mtime_ms, archived, trashed, rel_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           project = excluded.project,
           title = excluded.title,
           type = excluded.type,
           parent_id = excluded.parent_id,
           trust_level = excluded.trust_level,
           updated_at = excluded.updated_at,
           mtime_ms = excluded.mtime_ms,
           archived = excluded.archived,
           trashed = excluded.trashed,
           rel_path = excluded.rel_path`,
      ).run(
        doc.id,
        doc.project,
        doc.title,
        doc.type,
        doc.parentId,
        doc.trustLevel,
        doc.updatedAt,
        doc.mtimeMs,
        doc.archived ? 1 : 0,
        doc.trashed ? 1 : 0,
        doc.relPath,
      );
      db.prepare('DELETE FROM doc_tags WHERE doc_id = ?').run(doc.id);
      const insertTag = db.prepare('INSERT OR IGNORE INTO doc_tags (doc_id, tag) VALUES (?, ?)');
      for (const tag of doc.tags) insertTag.run(doc.id, tag);
    })(row);
  }

  deleteDoc(id: string): void {
    const db = this.requireDb();
    db.transaction((docId: string) => {
      db.prepare('DELETE FROM docs WHERE id = ?').run(docId);
      db.prepare('DELETE FROM doc_tags WHERE doc_id = ?').run(docId);
    })(id);
  }

  markDirty(reason?: string): void {
    const db = this.requireDb();
    db.transaction(() => {
      writeMeta(db, 'dirty', '1');
      writeMeta(db, 'dirty_at', new Date().toISOString());
      if (reason) writeMeta(db, 'dirty_reason', reason);
    })();
  }

  deleteProject(project: string): void {
    const db = this.requireDb();
    db.transaction(() => {
      db.prepare('DELETE FROM task_tags WHERE task_id IN (SELECT id FROM tasks WHERE project = ?)').run(project);
      db.prepare('DELETE FROM tasks WHERE project = ?').run(project);
      db.prepare('DELETE FROM doc_tags WHERE doc_id IN (SELECT id FROM docs WHERE project = ?)').run(project);
      db.prepare('DELETE FROM docs WHERE project = ?').run(project);
      db.prepare('DELETE FROM projects WHERE project = ?').run(project);
    })();
  }

  async rebuild(options: MetadataIndexRebuildOptions): Promise<MetadataIndexRebuildResult> {
    const db = this.requireDb();
    const batchSize = Math.max(1, Math.trunc(options.batchSize ?? 2000));
    const started = Date.now();

    db.transaction(() => {
      db.exec('DELETE FROM task_tags; DELETE FROM tasks; DELETE FROM doc_tags; DELETE FROM docs;');
    })();

    let tasks = 0;
    let docs = 0;
    let batches = 0;
    let taskBatch: MetadataIndexTaskRow[] = [];
    for await (const row of scanTaskRows(this.dataDir, options.tasksDir)) {
      taskBatch.push(row);
      if (taskBatch.length >= batchSize) {
        this.insertTaskBatch(taskBatch.splice(0, batchSize));
        tasks += batchSize;
        batches++;
      }
    }
    if (taskBatch.length > 0) {
      this.insertTaskBatch(taskBatch);
      tasks += taskBatch.length;
      batches++;
    }
    taskBatch = [];

    let docBatch: MetadataIndexDocRow[] = [];
    for await (const row of scanDocRows(this.dataDir, options.knowledgeDir)) {
      docBatch.push(row);
      if (docBatch.length >= batchSize) {
        this.insertDocBatch(docBatch.splice(0, batchSize));
        docs += batchSize;
        batches++;
      }
    }
    if (docBatch.length > 0) {
      this.insertDocBatch(docBatch);
      docs += docBatch.length;
      batches++;
    }

    db.transaction(() => {
      writeMeta(db, 'built_at', new Date().toISOString());
      writeMeta(db, 'dirty', '0');
    })();

    return { tasks, docs, batches, ms: Date.now() - started };
  }

  private insertTaskBatch(rows: MetadataIndexTaskRow[]): void {
    const db = this.requireDb();
    const insert = db.prepare(
      `INSERT OR REPLACE INTO tasks
         (id, project, status, priority, type, parent_id, updated_at, mtime_ms, archived, trashed, rel_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const clearTags = db.prepare('DELETE FROM task_tags WHERE task_id = ?');
    const insertTag = db.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag) VALUES (?, ?)');
    db.transaction((batch: MetadataIndexTaskRow[]) => {
      for (const row of batch) {
        insert.run(
          row.id,
          row.project,
          row.status,
          row.priority,
          row.type,
          row.parentId,
          row.updatedAt,
          row.mtimeMs,
          row.archived ? 1 : 0,
          row.trashed ? 1 : 0,
          row.relPath,
        );
        clearTags.run(row.id);
        for (const tag of row.tags) insertTag.run(row.id, tag);
      }
    })(rows);
  }

  private insertDocBatch(rows: MetadataIndexDocRow[]): void {
    const db = this.requireDb();
    const insert = db.prepare(
      `INSERT OR REPLACE INTO docs
         (id, project, title, type, parent_id, trust_level, updated_at, mtime_ms, archived, trashed, rel_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const clearTags = db.prepare('DELETE FROM doc_tags WHERE doc_id = ?');
    const insertTag = db.prepare('INSERT OR IGNORE INTO doc_tags (doc_id, tag) VALUES (?, ?)');
    db.transaction((batch: MetadataIndexDocRow[]) => {
      for (const row of batch) {
        insert.run(
          row.id,
          row.project,
          row.title,
          row.type,
          row.parentId,
          row.trustLevel,
          row.updatedAt,
          row.mtimeMs,
          row.archived ? 1 : 0,
          row.trashed ? 1 : 0,
          row.relPath,
        );
        clearTags.run(row.id);
        for (const tag of row.tags) insertTag.run(row.id, tag);
      }
    })(rows);
  }

  listTasks(query?: MetadataIndexListQuery): MetadataIndexListResult<MetadataIndexTaskRow> {
    const db = this.requireDb();
    const { whereSql, params } = buildWhere(query);
    const total = db
      .prepare<unknown[], { total: number }>(`SELECT COUNT(*) AS total FROM tasks${whereSql}`)
      .get(...params)?.total ?? 0;
    const rows = db
      .prepare<unknown[], TaskDbRow>(
        `SELECT id, project, status, priority, type, parent_id, updated_at, mtime_ms, archived, trashed, rel_path
           FROM tasks${whereSql}
          ORDER BY mtime_ms DESC, id ASC
          LIMIT ? OFFSET ?`,
      )
      .all(...params, limitOf(query), offsetOf(query));
    const tags = readTags(db, 'task_tags', 'task_id', rows.map((r) => r.id));
    return {
      items: rows.map((r) => ({
        id: r.id,
        project: r.project,
        status: r.status,
        priority: r.priority,
        type: r.type,
        parentId: r.parent_id,
        updatedAt: r.updated_at,
        mtimeMs: r.mtime_ms,
        archived: r.archived !== 0,
        trashed: r.trashed !== 0,
        relPath: r.rel_path,
        tags: tags.get(r.id) ?? [],
      })),
      total,
    };
  }

  listDocs(query?: MetadataIndexListQuery): MetadataIndexListResult<MetadataIndexDocRow> {
    const db = this.requireDb();
    const { whereSql, params } = buildWhere(query);
    const total = db
      .prepare<unknown[], { total: number }>(`SELECT COUNT(*) AS total FROM docs${whereSql}`)
      .get(...params)?.total ?? 0;
    const rows = db
      .prepare<unknown[], DocDbRow>(
        `SELECT id, project, title, type, parent_id, trust_level, updated_at, mtime_ms, archived, trashed, rel_path
           FROM docs${whereSql}
          ORDER BY mtime_ms DESC, id ASC
          LIMIT ? OFFSET ?`,
      )
      .all(...params, limitOf(query), offsetOf(query));
    const tags = readTags(db, 'doc_tags', 'doc_id', rows.map((r) => r.id));
    return {
      items: rows.map((r) => ({
        id: r.id,
        project: r.project,
        title: r.title,
        type: r.type,
        parentId: r.parent_id,
        trustLevel: r.trust_level,
        updatedAt: r.updated_at,
        mtimeMs: r.mtime_ms,
        archived: r.archived !== 0,
        trashed: r.trashed !== 0,
        relPath: r.rel_path,
        tags: tags.get(r.id) ?? [],
      })),
      total,
    };
  }

  private requireDb(): Database.Database {
    if (!this.db) throw new Error('metadata index is not open');
    return this.db;
  }

  /**
   * Creates the schema or rebuilds it when the stored schema version or the
   * DATA_DIR does not match. Rebuild = drop + recreate: the index is derived
   * and holds no data that exists nowhere else.
   */
  private prepareSchema(db: Database.Database): void {
    // On a garbage file this is the statement that raises SQLITE_NOTADB.
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;');
    const version = readMeta(db, 'schema_version');
    const storedDataDir = readMeta(db, 'data_dir');
    const matches = version === String(METADATA_INDEX_SCHEMA_VERSION) && storedDataDir === this.dataDir;

    if (matches) {
      this.logger?.info?.({ path: this.path }, 'metadata index opened');
      return;
    }

    db.transaction(() => {
      db.exec(DROP_SQL);
      db.exec(SCHEMA_SQL);
      writeMeta(db, 'schema_version', String(METADATA_INDEX_SCHEMA_VERSION));
      writeMeta(db, 'data_dir', this.dataDir);
      writeMeta(db, 'built_at', new Date().toISOString());
      writeMeta(db, 'dirty', '0');
    })();

    this.logger?.info?.(
      { path: this.path, previousVersion: version, previousDataDir: storedDataDir },
      'metadata index rebuilt',
    );
  }
}

/**
 * Opens the derived index and degrades instead of failing: `off`, a corrupt
 * file or a native-binding failure returns `null` so the caller keeps serving
 * through the file-scan path.
 */
export function createMetadataIndex(options: CreateMetadataIndexOptions): SqliteMetadataIndex | null {
  if (options.mode === 'off') return null;

  const index = new SqliteMetadataIndex({ dataDir: options.dataDir, logger: options.logger });
  try {
    index.open();
    return index;
  } catch (err) {
    options.logger?.warn(
      { err, path: index.path },
      'metadata index disabled — falling back to file scans (set STORAGE_INDEX=off to silence)',
    );
    return null;
  }
}

function readMeta(db: Database.Database, key: string): string | undefined {
  return db.prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?').get(key)?.value;
}

function writeMeta(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
}

function buildWhere(query?: MetadataIndexListQuery): { whereSql: string; params: unknown[] } {
  const params: unknown[] = [];
  if (query?.project !== undefined) params.push(query.project);
  return {
    whereSql: query?.project !== undefined ? ' WHERE project = ?' : '',
    params,
  };
}

/** `-1` tells SQLite "no limit"; the scaffold has no default page size. */
function limitOf(query?: MetadataIndexListQuery): number {
  if (query?.limit === undefined) return -1;
  return Math.max(0, Math.trunc(query.limit));
}

function offsetOf(query?: MetadataIndexListQuery): number {
  return Math.max(0, Math.trunc(query?.offset ?? 0));
}

function readTags(
  db: Database.Database,
  table: 'task_tags' | 'doc_tags',
  idColumn: 'task_id' | 'doc_id',
  ids: string[],
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (ids.length === 0) return result;
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db
    .prepare<unknown[], TagDbRow>(
      `SELECT ${idColumn} AS id, tag FROM ${table} WHERE ${idColumn} IN (${placeholders}) ORDER BY tag ASC`,
    )
    .all(...ids);
  for (const row of rows) {
    const list = result.get(row.id);
    if (list) list.push(row.tag);
    else result.set(row.id, [row.tag]);
  }
  return result;
}

// ── SC-02b: process-wide index and storage write hooks ──────────────

let activeIndex: MetadataIndex | undefined;

/** Registers (or clears) the index used by storage write hooks. One per process. */
export function setActiveMetadataIndex(index: MetadataIndex | null | undefined): void {
  activeIndex = index ?? undefined;
}

export function getActiveMetadataIndex(): MetadataIndex | undefined {
  return activeIndex;
}

/**
 * Flags the active index as stale without throwing. Used when the storage layer
 * cannot attribute a failure to a single row (backup restore, failed rebuild).
 */
export function markActiveIndexDirty(reason: string): void {
  const index = activeIndex;
  if (!index) return;
  try {
    index.markDirty(reason);
  } catch (err) {
    log.warn({ err, reason }, 'metadata index dirty flag failed');
  }
}

export function buildTaskRow(
  project: string,
  task: Task,
  mtimeMs: number,
  relPath: string,
): MetadataIndexTaskRow {
  return {
    id: task.id,
    project: task.project || project,
    status: task.status,
    priority: task.priority ?? null,
    type: task.type ?? 'task',
    parentId: task.parentId ?? null,
    updatedAt: task.updatedAt ?? null,
    mtimeMs,
    archived: Boolean(task.archived),
    trashed: Boolean(task.trashed),
    relPath,
    tags: task.tags ?? [],
  };
}

export function buildDocRow(
  project: string,
  doc: KnowledgeDocMeta,
  mtimeMs: number,
  relPath: string,
): MetadataIndexDocRow {
  return {
    id: doc.id,
    project: doc.project || project,
    title: doc.title ?? null,
    type: doc.type ?? null,
    parentId: doc.parentId ?? null,
    trustLevel: doc.trustLevel ?? null,
    updatedAt: doc.updatedAt ?? null,
    mtimeMs,
    archived: Boolean(doc.archived),
    trashed: Boolean(doc.trashed),
    relPath,
    tags: doc.tags ?? [],
  };
}

/**
 * File → stat → upsert, inside the caller's write lock. An index failure is
 * logged and flagged (`meta.dirty`), never thrown: the file is already written
 * and stays the source of truth.
 */
export async function indexTaskWrite(project: string, task: Task, filePath: string): Promise<void> {
  const index = activeIndex;
  if (!index) return;
  try {
    const st = await fsp.stat(filePath);
    index.upsertTask(buildTaskRow(project, task, st.mtimeMs, path.relative(index.dataDir, filePath)));
  } catch (err) {
    noteIndexFailure(index, err, 'task write', { id: task.id, project });
  }
}

export async function indexDocWrite(project: string, doc: KnowledgeDocMeta, filePath: string): Promise<void> {
  const index = activeIndex;
  if (!index) return;
  try {
    const st = await fsp.stat(filePath);
    index.upsertDoc(buildDocRow(project, doc, st.mtimeMs, path.relative(index.dataDir, filePath)));
  } catch (err) {
    noteIndexFailure(index, err, 'doc write', { id: doc.id, project });
  }
}

export function indexTaskDelete(id: string): void {
  const index = activeIndex;
  if (!index) return;
  try {
    index.deleteTask(id);
  } catch (err) {
    noteIndexFailure(index, err, 'task delete', { id });
  }
}

export function indexDocDelete(id: string): void {
  const index = activeIndex;
  if (!index) return;
  try {
    index.deleteDoc(id);
  } catch (err) {
    noteIndexFailure(index, err, 'doc delete', { id });
  }
}

export function indexProjectDelete(project: string): void {
  const index = activeIndex;
  if (!index) return;
  try {
    index.deleteProject(project);
  } catch (err) {
    noteIndexFailure(index, err, 'project delete', { project });
  }
}

function noteIndexFailure(
  index: MetadataIndex,
  err: unknown,
  op: string,
  context: Record<string, unknown>,
): void {
  log.warn({ err, op, ...context }, 'metadata index write failed — files stay the source of truth');
  try {
    index.markDirty(`${op}: ${err instanceof Error ? err.message : String(err)}`);
  } catch (dirtyErr) {
    log.warn({ err: dirtyErr, op }, 'metadata index dirty flag failed');
  }
}

// ── SC-02b: rebuild scan (files are the source of truth) ────────────

async function listEntries(dir: string): Promise<fs.Dirent[]> {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function* scanTaskRows(dataDir: string, tasksDir: string): AsyncGenerator<MetadataIndexTaskRow> {
  for (const entry of await listEntries(tasksDir)) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      const dir = path.join(tasksDir, entry.name);
      for (const child of await listEntries(dir)) {
        if (!child.isFile() || !child.name.endsWith('.json')) continue;
        const row = await readTaskRowAt(dataDir, entry.name, path.join(dir, child.name));
        if (row) yield row;
      }
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      const row = await readTaskRowAt(dataDir, undefined, path.join(tasksDir, entry.name));
      if (row) yield row;
    }
  }
}

async function readTaskRowAt(
  dataDir: string,
  projectHint: string | undefined,
  file: string,
): Promise<MetadataIndexTaskRow | null> {
  try {
    const [raw, st] = await Promise.all([fsp.readFile(file, 'utf8'), fsp.stat(file)]);
    const task = JSON.parse(raw) as Task;
    const id = task.id || path.basename(file, '.json');
    const project = projectHint ?? task.project ?? 'default';
    return buildTaskRow(project, { ...task, id }, st.mtimeMs, path.relative(dataDir, file));
  } catch (err) {
    log.warn({ err, file }, 'metadata index rebuild skipped an unreadable task file');
    return null;
  }
}

async function* scanDocRows(dataDir: string, knowledgeDir: string): AsyncGenerator<MetadataIndexDocRow> {
  for (const entry of await listEntries(knowledgeDir)) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      const dir = path.join(knowledgeDir, entry.name);
      for (const child of await listEntries(dir)) {
        if (!child.isFile() || !child.name.endsWith('.md')) continue;
        const row = await readDocRowAt(dataDir, entry.name, path.join(dir, child.name));
        if (row) yield row;
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const row = await readDocRowAt(dataDir, undefined, path.join(knowledgeDir, entry.name));
      if (row) yield row;
    }
  }
}

async function readDocRowAt(
  dataDir: string,
  projectHint: string | undefined,
  file: string,
): Promise<MetadataIndexDocRow | null> {
  try {
    const [raw, st] = await Promise.all([fsp.readFile(file, 'utf8'), fsp.stat(file)]);
    // gray-matter caches every parsed document in `matter.cache` when called
    // without options, keyed by the full text and never evicted: a 100k corpus
    // retains ~650 MB and OOMs the rebuild. Any options object disables that cache.
    const meta = matter(raw, {}).data as unknown as KnowledgeDocMeta;
    const id = meta.id || path.basename(file, '.md');
    const project = projectHint ?? meta.project ?? 'default';
    return buildDocRow(project, { ...meta, id }, st.mtimeMs, path.relative(dataDir, file));
  } catch (err) {
    log.warn({ err, file }, 'metadata index rebuild skipped an unreadable doc file');
    return null;
  }
}

