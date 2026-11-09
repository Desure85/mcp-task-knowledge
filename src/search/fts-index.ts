/**
 * SC-03a — inverted index (SQLite FTS5) for search over tasks and knowledge.
 *
 * Why: `search_tasks`/`search_knowledge` used to tokenise the whole corpus on every call
 * (`bm25Search` builds df/avgdl per query), which is 23.6 s and 4.1 GB RSS on 100k documents.
 * This module is the storage layer of the replacement: one FTS5 table per index file, written by
 * the same tokenizer the in-memory BM25 uses, so ranking behaviour stays comparable while the
 * per-query cost becomes a MATCH over an index.
 *
 * Design notes:
 *   - `terms` holds *our* tokens (camelCase split, stopwords removed, lowercased), not the raw
 *     text: FTS5's own tokenizer does not split `getUserProfile` and does not know our stopword
 *     list, so indexing raw text would change recall silently.
 *   - **Every row carries `store`** (SC-03a2): a deployment can have several storages — `DATA_DIR`
 *     plus `MCP_TASK_DIR`/`MCP_KNOWLEDGE_DIR` overrides, the legacy `DATA_DIR/mcp/*` layout, or
 *     tasks and knowledge on different volumes. Legacy task ids are derived from file names
 *     (`123`, `TASK-1`), so the same id can exist in two stores; `(store, kind, id)` is the
 *     identity and `project` alone cannot discriminate (project names are per store).
 *   - `id`, `store`, `kind`, `project`, `updated_at` are `UNINDEXED` columns used for filtering and
 *     for joining back to storage; ranking uses FTS5 `bm25()`.
 *   - Query tokens are prefix-expanded (`auth*` for `auth` → `authentication`), which is what the
 *     in-memory BM25 gets for free from its tokenizer.
 *   - The schema carries a version row; a mismatch is reported by `stats()` so `doctor`/`reindex`
 *     (SC-03c) can rebuild instead of serving stale data.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { tokenize } from './bm25.js';

export const FTS_SCHEMA_VERSION = 3;

export type FtsKind = 'task' | 'doc';

export interface FtsRecord {
  /** Storage root the record lives in (see `resolveStoreId`). */
  store: string;
  kind: FtsKind;
  id: string;
  project: string;
  updatedAt: string;
  /** Raw searchable text; the module tokenises it. */
  text: string;
}

export interface FtsQuery {
  /** Natural-language query. */
  q: string;
  /** Restrict to one storage root. Omit only for deliberate cross-store tooling. */
  store?: string;
  kind?: FtsKind;
  project?: string;
  limit?: number;
}

export interface FtsHit {
  store: string;
  kind: FtsKind;
  id: string;
  project: string;
  /** Higher is better: negated `bm25()` rank (FTS5 returns smaller-is-better values). */
  score: number;
}

export interface FtsStats {
  rows: number;
  tasks: number;
  docs: number;
  schemaVersion: number;
  dbBytes: number;
  /** SC-03b: a write failed and the index may be missing rows. Cleared by `rebuild`. */
  dirty: boolean;
}

export interface FtsStoreStats {
  store: string;
  rows: number;
  tasks: number;
  docs: number;
}

/**
 * `search_fts_keys` maps the logical key to the FTS5 rowid. FTS5 treats `store`/`kind`/`id` as
 * UNINDEXED, so `DELETE ... WHERE store = ?` scans the whole table; doing that per written row
 * made a 100k rebuild quadratic (26 min of full scans, zero rows committed). Deletes go by rowid.
 */
const DDL = [
  `CREATE TABLE IF NOT EXISTS search_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS search_fts_keys (
     store TEXT NOT NULL,
     kind TEXT NOT NULL,
     id TEXT NOT NULL,
     rowid INTEGER NOT NULL,
     PRIMARY KEY (store, kind, id)
   )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
     id UNINDEXED,
     store UNINDEXED,
     kind UNINDEXED,
     project UNINDEXED,
     updated_at UNINDEXED,
     terms,
     tokenize = 'unicode61 remove_diacritics 2',
     prefix = '2 3'
   )`,
];

/**
 * Canonical identity of a storage root: absolute, without a trailing separator, lowercased on
 * Windows (the filesystem is case-insensitive there, so `C:\Tasks` and `c:/tasks` are one store).
 */
export function resolveStoreId(root: string): string {
  let resolved = path.resolve(root);
  if (resolved.length > 1 && resolved.endsWith(path.sep)) resolved = resolved.slice(0, -1);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Escape a token for an FTS5 query string; tokens are alphanumeric after `tokenize`. */
function matchExpression(query: string): string | undefined {
  const tokens = Array.from(new Set(tokenize(query)));
  if (tokens.length === 0) return undefined;
  // Prefix expansion for terms long enough to be selective; 1-2 char prefixes match everything.
  const parts = tokens.map((token) => (token.length >= 3 ? `${token}*` : token));
  return parts.join(' OR ');
}

export class FtsSearchIndex {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    for (const statement of DDL) this.db.exec(statement);
    const current = this.meta('schema_version');
    if (current !== String(FTS_SCHEMA_VERSION)) {
      if (current !== undefined) {
        // A different schema means the terms layout changed: drop and let the caller rebuild.
        this.db.exec('DROP TABLE IF EXISTS search_fts');
        this.db.exec('DROP TABLE IF EXISTS search_fts_keys');
        for (const statement of DDL) this.db.exec(statement);
      }
      this.setMeta('schema_version', String(FTS_SCHEMA_VERSION));
    }
  }

  /** Open (or create) an index file. */
  static open(file: string): FtsSearchIndex {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    return new FtsSearchIndex(new Database(file));
  }

  /** Open in memory (tests and short-lived processes). */
  static inMemory(): FtsSearchIndex {
    return new FtsSearchIndex(new Database(':memory:'));
  }

  private meta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM search_meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  private setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO search_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      key,
      value,
    );
  }

  /** Insert or replace records; returns how many rows were written. */
  upsert(records: FtsRecord[]): number {
    if (records.length === 0) return 0;
    const findRowid = this.db.prepare('SELECT rowid AS rid FROM search_fts_keys WHERE store = ? AND kind = ? AND id = ?');
    const deleteRow = this.db.prepare('DELETE FROM search_fts WHERE rowid = ?');
    const insert = this.db.prepare(
      'INSERT INTO search_fts(id, store, kind, project, updated_at, terms) VALUES(?, ?, ?, ?, ?, ?)',
    );
    const putKey = this.db.prepare(
      'INSERT INTO search_fts_keys(store, kind, id, rowid) VALUES(?, ?, ?, ?) ' +
        'ON CONFLICT(store, kind, id) DO UPDATE SET rowid = excluded.rowid',
    );
    const write = this.db.transaction((batch: FtsRecord[]) => {
      for (const record of batch) {
        const existing = findRowid.get(record.store, record.kind, record.id) as { rid: number } | undefined;
        if (existing) deleteRow.run(existing.rid);
        const row = insert.run(
          record.id,
          record.store,
          record.kind,
          record.project,
          record.updatedAt,
          tokenize(record.text).join(' '),
        );
        putKey.run(record.store, record.kind, record.id, Number(row.lastInsertRowid));
      }
      return batch.length;
    });
    return write(records);
  }

  /** Remove one record; returns true when something was deleted. */
  remove(store: string, kind: FtsKind, id: string): boolean {
    const row = this.db
      .prepare('SELECT rowid AS rid FROM search_fts_keys WHERE store = ? AND kind = ? AND id = ?')
      .get(store, kind, id) as { rid: number } | undefined;
    if (!row) return false;
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM search_fts WHERE rowid = ?').run(row.rid);
      this.db.prepare('DELETE FROM search_fts_keys WHERE store = ? AND kind = ? AND id = ?').run(store, kind, id);
    })();
    return true;
  }

  /** Replace the whole index (all stores) in one transaction; clears the dirty flag. */
  rebuild(records: FtsRecord[]): number {
    const insert = this.db.prepare(
      'INSERT INTO search_fts(id, store, kind, project, updated_at, terms) VALUES(?, ?, ?, ?, ?, ?)',
    );
    const putKey = this.db.prepare('INSERT INTO search_fts_keys(store, kind, id, rowid) VALUES(?, ?, ?, ?)');
    const run = this.db.transaction((batch: FtsRecord[]) => {
      this.db.exec('DELETE FROM search_fts');
      this.db.exec('DELETE FROM search_fts_keys');
      for (const record of batch) {
        const row = insert.run(
          record.id,
          record.store,
          record.kind,
          record.project,
          record.updatedAt,
          tokenize(record.text).join(' '),
        );
        putKey.run(record.store, record.kind, record.id, Number(row.lastInsertRowid));
      }
      return batch.length;
    });
    const written = run(records);
    this.clearDirty();
    return written;
  }

  /** Drop everything belonging to one store (project deletion / reindex of one storage). */
  clearStore(store: string): number {
    const rows = this.db
      .prepare('SELECT rowid AS rid FROM search_fts WHERE store = ?')
      .all(store) as Array<{ rid: number }>;
    this.db.transaction(() => {
      const deleteRow = this.db.prepare('DELETE FROM search_fts WHERE rowid = ?');
      for (const row of rows) deleteRow.run(row.rid);
      this.db.prepare('DELETE FROM search_fts_keys WHERE store = ?').run(store);
    })();
    return rows.length;
  }

  /**
   * SC-03b: drop every row of one project inside one store. Project deletion removes whole
   * directories, so per-row `remove` calls never happen and the rows would otherwise survive.
   */
  removeProject(store: string, project: string): number {
    const rows = this.db
      .prepare('SELECT rowid AS rid, kind, id FROM search_fts WHERE store = ? AND project = ?')
      .all(store, project) as Array<{ rid: number; kind: FtsKind; id: string }>;
    this.db.transaction(() => {
      const deleteRow = this.db.prepare('DELETE FROM search_fts WHERE rowid = ?');
      const deleteKey = this.db.prepare('DELETE FROM search_fts_keys WHERE store = ? AND kind = ? AND id = ?');
      for (const row of rows) {
        deleteRow.run(row.rid);
        deleteKey.run(store, row.kind, row.id);
      }
    })();
    return rows.length;
  }

  /**
   * SC-03b: mark the index as possibly incomplete without throwing. Used when a write hook
   * fails: the file is already written and stays the source of truth, `reindex` repairs.
   */
  markDirty(reason: string): void {
    this.setMeta('dirty', '1');
    this.setMeta('dirty_reason', reason);
  }

  isDirty(): boolean {
    return this.meta('dirty') === '1';
  }

  dirtyReason(): string | undefined {
    return this.meta('dirty_reason');
  }

  clearDirty(): void {
    this.db.prepare("DELETE FROM search_meta WHERE key IN ('dirty', 'dirty_reason')").run();
  }

  /**
   * Ranked search. Pass `store` for normal use: without it the query spans every store in this
   * index file, which is only meaningful for deliberate cross-store tooling.
   */
  query(options: FtsQuery): FtsHit[] {
    const expression = matchExpression(options.q);
    if (!expression) return [];
    const limit = Math.max(1, Math.min(500, Math.trunc(options.limit ?? 20)));
    const conditions = ['search_fts MATCH ?'];
    const params: unknown[] = [expression];
    if (options.store) {
      conditions.push('store = ?');
      params.push(options.store);
    }
    if (options.kind) {
      conditions.push('kind = ?');
      params.push(options.kind);
    }
    if (options.project) {
      conditions.push('project = ?');
      params.push(options.project);
    }
    params.push(limit);
    const rows = this.db
      .prepare(
        `SELECT id, store, kind, project, bm25(search_fts) AS rank
           FROM search_fts
          WHERE ${conditions.join(' AND ')}
          ORDER BY rank
          LIMIT ?`,
      )
      .all(...params) as Array<{ id: string; store: string; kind: FtsKind; project: string; rank: number }>;
    return rows.map((row) => ({
      store: row.store,
      kind: row.kind,
      id: row.id,
      project: row.project,
      score: -row.rank,
    }));
  }

  /** Counts for one store, or for the whole index file when `store` is omitted. */
  stats(store?: string): FtsStats {
    const where = store ? ' WHERE store = ?' : '';
    const args = store ? [store] : [];
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM search_fts${where}`).get(...args) as { n: number }).n;
    const tasks = (
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM search_fts${where ? `${where} AND` : ' WHERE'} kind = 'task'`)
        .get(...args) as { n: number }
    ).n;
    const docs = (
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM search_fts${where ? `${where} AND` : ' WHERE'} kind = 'doc'`)
        .get(...args) as { n: number }
    ).n;
    const pageCount = (this.db.pragma('page_count', { simple: true }) as number) ?? 0;
    const pageSize = (this.db.pragma('page_size', { simple: true }) as number) ?? 0;
    return {
      rows: total,
      tasks,
      docs,
      schemaVersion: Number(this.meta('schema_version') ?? 0),
      dbBytes: pageCount * pageSize,
      dirty: this.isDirty(),
    };
  }

  /**
   * SC-03c: searchable rows of one project. The read path compares these counts with the
   * metadata index (archived/trashed excluded on both sides); a mismatch means the FTS rows
   * are incomplete and the request must keep the file-scan path rather than answer from a
   * partial index.
   */
  projectCounts(store: string, project: string): { tasks: number; docs: number } {
    const rows = this.db
      .prepare(
        `SELECT kind, COUNT(*) AS n
           FROM search_fts
          WHERE store = ? AND project = ?
          GROUP BY kind`,
      )
      .all(store, project) as Array<{ kind: FtsKind; n: number }>;
    let tasks = 0;
    let docs = 0;
    for (const row of rows) {
      if (row.kind === 'task') tasks = row.n;
      else if (row.kind === 'doc') docs = row.n;
    }
    return { tasks, docs };
  }

  /** Per-store row counts, so `doctor` can show which storage an index file covers. */
  stores(): FtsStoreStats[] {
    return this.db
      .prepare(
        `SELECT store,
                COUNT(*) AS rows,
                SUM(CASE WHEN kind = 'task' THEN 1 ELSE 0 END) AS tasks,
                SUM(CASE WHEN kind = 'doc' THEN 1 ELSE 0 END) AS docs
           FROM search_fts
          GROUP BY store
          ORDER BY store`,
      )
      .all() as FtsStoreStats[];
  }

  close(): void {
    this.db.close();
  }
}
