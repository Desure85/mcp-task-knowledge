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
import path from 'node:path';

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
  open(): void;
  close(): void;
  upsertTask(row: MetadataIndexTaskRow): void;
  deleteTask(id: string): void;
  upsertDoc(row: MetadataIndexDocRow): void;
  deleteDoc(id: string): void;
  listTasks(query?: MetadataIndexListQuery): MetadataIndexListResult<MetadataIndexTaskRow>;
  listDocs(query?: MetadataIndexListQuery): MetadataIndexListResult<MetadataIndexDocRow>;
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
