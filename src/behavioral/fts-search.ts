/**
 * behavioral/fts-search.ts — FTS5 full-text search over behavioral memory (BM-014).
 *
 * SQLite FTS5 index across intents, failures, and resolutions.
 * Natural-language search with filtered query (file_path, status, since)
 * and pagination. Zero external deps beyond better-sqlite3 (already in tree).
 *
 * Usage:
 *   const fts = new FtsMemorySearch({ storagePath: '.behavioral/fts.db' });
 *   fts.indexIntent(record);
 *   fts.indexFailure(record);
 *   fts.indexResolution(record);
 *   const results = fts.query({ query: 'rate limit auth', limit: 10 });
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { childLogger } from '../core/logger.js';

const log = childLogger('fts-search');

// ─── Types ────────────────────────────────────────────────────────

export type MemoryKind = 'intent' | 'failure' | 'resolution';

export interface FtsRecord {
  /** Unique row id within FTS (kind:id). */
  rowId: string;
  /** Type of memory record. */
  kind: MemoryKind;
  /** Source record id (memoryId / failureId / resolutionId). */
  recordId: string;
  /** File path (intents only, empty for others). */
  filePath: string;
  /** Status: 'resolved' | 'unresolved' (failures only), '' otherwise. */
  status: string;
  /** ISO 8601 timestamp of the original record. */
  timestamp: string;
  /** Searchable text body. */
  body: string;
}

export interface FtsQueryOptions {
  /** Natural-language search query (FTS5 MATCH syntax). */
  query: string;
  /** Filter by file path (exact match). */
  filePath?: string;
  /** Filter by status ('resolved' / 'unresolved'). */
  status?: string;
  /** Filter: only records since this ISO timestamp (inclusive). */
  since?: string;
  /** Filter: only records before this ISO timestamp (inclusive). */
  until?: string;
  /** Filter by kind. */
  kind?: MemoryKind;
  /** Page number (1-based). Default: 1. */
  page?: number;
  /** Page size. Default: 20. */
  pageSize?: number;
}

export interface FtsQueryResult {
  /** Total matching rows (before pagination). */
  total: number;
  /** Current page (1-based). */
  page: number;
  /** Page size. */
  pageSize: number;
  /** Total pages. */
  totalPages: number;
  /** Results on the current page. */
  rows: FtsRecord[];
}

export interface FtsMemorySearchOptions {
  /** SQLite database path or ':memory:'. Default: ':memory:'. */
  databasePath?: string;
  /** Busy timeout in ms. Default: 5000. */
  busyTimeoutMs?: number;
}

// ─── FtsMemorySearch ──────────────────────────────────────────────

export class FtsMemorySearch {
  private readonly db: Database.Database;
  private readonly stmtIndex: Database.Statement;
  private readonly stmtDelete: Database.Statement;
  private readonly stmtCount: Database.Statement;
  private closed = false;

  constructor(options?: FtsMemorySearchOptions) {
    const databasePath = options?.databasePath ?? ':memory:';
    if (databasePath !== ':memory:') {
      const dir = dirname(databasePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(databasePath);
    this.db.pragma(`busy_timeout = ${options?.busyTimeoutMs ?? 5000}`);
    this.db.pragma('journal_mode = WAL');

    // FTS5 table stores body text (supports snippet/highlight auxiliary functions).
    // memory_meta side table holds filterable metadata columns.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_meta (
        row_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        record_id TEXT NOT NULL,
        file_path TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        timestamp TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        body,
        row_id UNINDEXED
      );
      CREATE INDEX IF NOT EXISTS idx_meta_file ON memory_meta (file_path);
      CREATE INDEX IF NOT EXISTS idx_meta_status ON memory_meta (status);
      CREATE INDEX IF NOT EXISTS idx_meta_kind ON memory_meta (kind);
      CREATE INDEX IF NOT EXISTS idx_meta_ts ON memory_meta (timestamp);
    `);

    this.stmtIndex = this.db.prepare(
      `INSERT OR REPLACE INTO memory_fts (row_id, body) VALUES (?, ?)`,
    );
    this.stmtDelete = this.db.prepare(
      `DELETE FROM memory_fts WHERE row_id = ?`,
    );
    this.stmtCount = this.db.prepare('SELECT COUNT(*) AS n FROM memory_meta WHERE row_id = ?');
  }

  /**
   * Index (or re-index) a memory record.
   */
  index(record: FtsRecord): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(
        `INSERT OR REPLACE INTO memory_meta (row_id, kind, record_id, file_path, status, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(record.rowId, record.kind, record.recordId, record.filePath, record.status, record.timestamp);
      this.stmtIndex.run(record.rowId, record.body);
    });
    tx();
    log.debug({ rowId: record.rowId, kind: record.kind }, 'indexed');
  }

  /**
   * Index an IntentRecord.
   */
  indexIntent(r: {
    memoryId: string;
    prompt: string;
    file: string;
    timestamp: string;
    tags?: string[];
    context?: Record<string, unknown>;
  }): void {
    const body = [r.prompt, (r.tags ?? []).join(' '), JSON.stringify(r.context ?? {})].join('\n');
    this.index({
      rowId: `intent:${r.memoryId}`,
      kind: 'intent',
      recordId: r.memoryId,
      filePath: r.file,
      status: '',
      timestamp: r.timestamp,
      body,
    });
  }

  /**
   * Index a FailureRecord.
   */
  indexFailure(r: {
    failureId: string;
    memoryId: string;
    errorType: string;
    message: string;
    stack?: string;
    timestamp: string;
    resolved: boolean;
    context?: Record<string, unknown>;
  }): void {
    const body = [r.errorType, r.message, r.stack ?? '', JSON.stringify(r.context ?? {})].join('\n');
    this.index({
      rowId: `failure:${r.failureId}`,
      kind: 'failure',
      recordId: r.failureId,
      filePath: '',
      status: r.resolved ? 'resolved' : 'unresolved',
      timestamp: r.timestamp,
      body,
    });
  }

  /**
   * Index a ResolutionRecord.
   */
  indexResolution(r: {
    resolutionId: string;
    failureId: string;
    fixingMemoryId: string;
    approach: string;
    failedApproaches?: string[];
    timestamp: string;
    metadata?: Record<string, unknown>;
  }): void {
    const body = [r.approach, (r.failedApproaches ?? []).join('\n'), JSON.stringify(r.metadata ?? {})].join('\n');
    this.index({
      rowId: `resolution:${r.resolutionId}`,
      kind: 'resolution',
      recordId: r.resolutionId,
      filePath: '',
      status: 'resolved',
      timestamp: r.timestamp,
      body,
    });
  }

  /**
   * Remove a record from the index.
   */
  remove(rowId: string): boolean {
    const tx = this.db.transaction(() => {
      const info = this.db.prepare('DELETE FROM memory_meta WHERE row_id = ?').run(rowId);
      this.stmtDelete.run(rowId);
      return info.changes > 0;
    });
    const removed = tx();
    if (removed) log.debug({ rowId }, 'removed');
    return removed;
  }

  /**
   * Query the FTS5 index with filters and pagination.
   */
  query(options: FtsQueryOptions): FtsQueryResult {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.max(1, options.pageSize ?? 20);
    const offset = (page - 1) * pageSize;

    // Sanitize the MATCH query: wrap bare terms in quotes to avoid FTS5
    // syntax errors from special characters. If the user wants raw FTS5
    // syntax they can pass it as-is (we only escape if it looks unsafe).
    const matchExpr = this.sanitizeMatch(options.query);

    const where: string[] = [];
    const params: unknown[] = [];

    // FTS5 join: we match in memory_fts and join to memory_meta via rowid
    let sql = `SELECT m.row_id, m.kind, m.record_id, m.file_path, m.status, m.timestamp,
                      snippet(memory_fts, 0, '<mark>', '</mark>', '…', 32) AS snippet
               FROM memory_fts f
               JOIN memory_meta m ON m.row_id = f.row_id
               WHERE memory_fts MATCH ?`;
    params.push(matchExpr);

    if (options.filePath) {
      where.push('m.file_path = ?');
      params.push(options.filePath);
    }
    if (options.status) {
      where.push('m.status = ?');
      params.push(options.status);
    }
    if (options.kind) {
      where.push('m.kind = ?');
      params.push(options.kind);
    }
    if (options.since) {
      where.push('m.timestamp >= ?');
      params.push(options.since);
    }
    if (options.until) {
      where.push('m.timestamp <= ?');
      params.push(options.until);
    }
    if (where.length > 0) {
      sql += ' AND ' + where.join(' AND ');
    }

    // Count total (before pagination)
    const countSql = `SELECT COUNT(*) AS n FROM (${sql})`;
    const total = (this.db.prepare(countSql).get(...params) as { n: number }).n;

    // Paged results — rank by FTS5 bm25() (lower = better, so invert)
    sql += ' ORDER BY bm25(memory_fts) ASC LIMIT ? OFFSET ?';
    params.push(pageSize, offset);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      row_id: string;
      kind: MemoryKind;
      record_id: string;
      file_path: string;
      status: string;
      timestamp: string;
      snippet: string;
    }>;

    return {
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      rows: rows.map((r) => ({
        rowId: r.row_id,
        kind: r.kind,
        recordId: r.record_id,
        filePath: r.file_path,
        status: r.status,
        timestamp: r.timestamp,
        body: r.snippet,
      })),
    };
  }

  /**
   * Total number of indexed records.
   */
  get count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM memory_meta').get() as { n: number }).n;
  }

  /**
   * Close the database.
   */
  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  // ─── Internal ───────────────────────────────────────────────────

  /**
   * Sanitize a user-provided FTS5 MATCH expression.
   *
   * FTS5 has its own query syntax (AND, OR, NEAR, column filters, *).
   * If the input contains characters that would break the parser and
   * the user clearly didn't intend raw syntax, we wrap each token in
   * double quotes so it's treated as a phrase/term query.
   */
  private sanitizeMatch(input: string): string {
    const trimmed = input.trim();
    if (trimmed === '') return '""';

    // If the input already looks like valid FTS5 syntax (contains operators
    // or quoted phrases), pass it through unchanged.
    if (/^".*"$/.test(trimmed) || /\b(AND|OR|NOT|NEAR)\b/.test(trimmed) || trimmed.includes('*')) {
      return trimmed;
    }

    // Otherwise, quote each whitespace-separated token to avoid syntax errors
    // from punctuation, slashes, etc.
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' ');
  }
}
