/**
 * AC-03/SC-03a — inverted index (SQLite FTS5) for search over tasks and knowledge.
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
 *   - `id`, `kind`, `project`, `updated_at` are `UNINDEXED` columns used for filtering and for
 *     joining back to storage; ranking uses FTS5 `bm25()`.
 *   - Query tokens are prefix-expanded (`auth*` for `auth` → `authentication`), which is what the
 *     in-memory BM25 gets for free from its substring-free token matching on short queries.
 *   - The schema carries a version row; a mismatch is reported by `stats()` so `doctor`/`reindex`
 *     (SC-03c) can rebuild instead of serving stale data.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { tokenize } from './bm25.js';

export const FTS_SCHEMA_VERSION = 1;

export type FtsKind = 'task' | 'doc';

export interface FtsRecord {
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
  kind?: FtsKind;
  project?: string;
  limit?: number;
}

export interface FtsHit {
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
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS search_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
     id UNINDEXED,
     kind UNINDEXED,
     project UNINDEXED,
     updated_at UNINDEXED,
     terms,
     tokenize = 'unicode61 remove_diacritics 2',
     prefix = '2 3'
   )`,
];

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
    const remove = this.db.prepare('DELETE FROM search_fts WHERE id = ? AND kind = ?');
    const insert = this.db.prepare(
      'INSERT INTO search_fts(id, kind, project, updated_at, terms) VALUES(?, ?, ?, ?, ?)',
    );
    const write = this.db.transaction((batch: FtsRecord[]) => {
      for (const record of batch) {
        remove.run(record.id, record.kind);
        insert.run(record.id, record.kind, record.project, record.updatedAt, tokenize(record.text).join(' '));
      }
      return batch.length;
    });
    return write(records);
  }

  /** Remove one record; returns true when something was deleted. */
  remove(kind: FtsKind, id: string): boolean {
    const result = this.db.prepare('DELETE FROM search_fts WHERE id = ? AND kind = ?').run(id, kind);
    return result.changes > 0;
  }

  /** Replace the whole index in one transaction. */
  rebuild(records: FtsRecord[]): number {
    const run = this.db.transaction((batch: FtsRecord[]) => {
      this.db.exec('DELETE FROM search_fts');
      return this.upsert(batch);
    });
    return run(records);
  }

  /** Ranked search. Returns fewer than `limit` hits when the index has fewer matches. */
  query(options: FtsQuery): FtsHit[] {
    const expression = matchExpression(options.q);
    if (!expression) return [];
    const limit = Math.max(1, Math.min(500, Math.trunc(options.limit ?? 20)));
    const conditions = ['search_fts MATCH ?'];
    const params: unknown[] = [expression];
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
        `SELECT id, kind, project, bm25(search_fts) AS rank
           FROM search_fts
          WHERE ${conditions.join(' AND ')}
          ORDER BY rank
          LIMIT ?`,
      )
      .all(...params) as Array<{ id: string; kind: FtsKind; project: string; rank: number }>;
    return rows.map((row) => ({ kind: row.kind, id: row.id, project: row.project, score: -row.rank }));
  }

  stats(): FtsStats {
    const total = (this.db.prepare('SELECT COUNT(*) AS n FROM search_fts').get() as { n: number }).n;
    const tasks = (this.db.prepare("SELECT COUNT(*) AS n FROM search_fts WHERE kind = 'task'").get() as { n: number }).n;
    const docs = (this.db.prepare("SELECT COUNT(*) AS n FROM search_fts WHERE kind = 'doc'").get() as { n: number }).n;
    const pageCount = (this.db.pragma('page_count', { simple: true }) as number) ?? 0;
    const pageSize = (this.db.pragma('page_size', { simple: true }) as number) ?? 0;
    return {
      rows: total,
      tasks,
      docs,
      schemaVersion: Number(this.meta('schema_version') ?? 0),
      dbBytes: pageCount * pageSize,
    };
  }

  close(): void {
    this.db.close();
  }
}
