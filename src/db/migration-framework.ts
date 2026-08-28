/**
 * db/migration-framework.ts — SQLite migration framework (BM-013, closes TD-009).
 *
 * Versioned schema migrations with up/down support, transactional batch apply,
 * statement cache with LRU eviction, and production-safe pragmas
 * (WAL mode, busy_timeout, wal_autocheckpoint). Protected against concurrent
 * migrations via a lock table + IMMEDIATE transactions.
 *
 * Usage:
 *   const framework = new MigrationFramework({
 *     databasePath: 'data/app.db',
 *     migrations: [
 *       { id: '0001-init', up: (db) => db.exec('CREATE TABLE ...'), down: (db) => db.exec('DROP TABLE ...') },
 *     ],
 *   });
 *   framework.migrate();
 *   framework.status();
 */

import Database from 'better-sqlite3';
import { childLogger } from '../core/logger.js';

const log = childLogger('migration-framework');

// ─── Types ────────────────────────────────────────────────────────

export type MigrationDatabase = Database.Database;

export interface Migration {
  /** Unique migration id (ordered lexicographically, e.g. '0001-init'). */
  id: string;
  /** Human-readable description. */
  description?: string;
  /** Apply the migration. */
  up(db: MigrationDatabase): void;
  /** Revert the migration (optional). */
  down?(db: MigrationDatabase): void;
}

export interface MigrationFrameworkOptions {
  /** SQLite database path or ':memory:'. Default: ':memory:'. */
  databasePath?: string;
  /** Ordered migrations. */
  migrations?: Migration[];
  /** Statement cache size (LRU). Default: 100. */
  statementCacheSize?: number;
  /** Busy timeout in ms. Default: 5000. */
  busyTimeoutMs?: number;
}

export interface AppliedMigration {
  id: string;
  appliedAt: string;
}

export interface MigrationStatus {
  /** Applied migrations (oldest first). */
  applied: AppliedMigration[];
  /** Pending migration ids (ordered). */
  pending: string[];
  /** Schema version (count of applied migrations). */
  version: number;
}

// ─── Statement cache (LRU) ────────────────────────────────────────

export class StatementCache {
  private readonly maxSize: number;
  private readonly cache = new Map<string, Database.Statement>();

  constructor(db: Database.Database, maxSize = 100) {
    this.maxSize = maxSize;
    this.db = db;
  }

  private readonly db: Database.Database;

  /**
   * Get (or prepare + cache) a prepared statement. LRU eviction on overflow.
   */
  prepare(sql: string): Database.Statement {
    const hit = this.cache.get(sql);
    if (hit) {
      // refresh recency
      this.cache.delete(sql);
      this.cache.set(sql, hit);
      return hit;
    }

    const statement = this.db.prepare(sql);
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(sql, statement);
    return statement;
  }

  /** Number of cached statements. */
  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}

// ─── MigrationFramework ───────────────────────────────────────────

export class MigrationFramework {
  private readonly db: Database.Database;
  private readonly migrations: Migration[];
  private readonly statements: StatementCache;
  private closed = false;

  constructor(options?: MigrationFrameworkOptions) {
    const databasePath = options?.databasePath ?? ':memory:';
    this.db = new Database(databasePath);
    this.migrations = [...(options?.migrations ?? [])].sort((a, b) => a.id.localeCompare(b.id));
    this.statements = new StatementCache(this.db, options?.statementCacheSize ?? 100);

    // Production-safe pragmas
    this.db.pragma(`busy_timeout = ${options?.busyTimeoutMs ?? 5000}`);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('wal_autocheckpoint = 1000');

    this.ensureSchema();
  }

  /**
   * Apply all pending migrations (each in its own transaction).
   */
  migrate(): string[] {
    return this.migrateUp();
  }

  /**
   * Apply up to `count` pending migrations (default: all).
   */
  migrateUp(count?: number): string[] {
    const applied: string[] = [];
    const pending = this.status().pending;

    const limit = count === undefined ? pending.length : Math.min(count, pending.length);
    for (let i = 0; i < limit; i++) {
      applied.push(this.applyOne(pending[i]));
    }
    if (applied.length > 0) {
      log.info({ applied }, 'migrations applied');
    }
    return applied;
  }

  /**
   * Revert up to `count` applied migrations (newest first). Default: 1.
   */
  migrateDown(count = 1): string[] {
    const reverted: string[] = [];
    const applied = this.appliedIds();
    const limit = Math.min(count, applied.length);

    for (let i = 0; i < limit; i++) {
      const id = applied[applied.length - 1 - i];
      reverted.push(this.revertOne(id));
    }
    if (reverted.length > 0) {
      log.info({ reverted }, 'migrations reverted');
    }
    return reverted;
  }

  /**
   * Revert the latest migration (rollback).
   */
  rollback(): string[] {
    return this.migrateDown(1);
  }

  /**
   * Current migration status.
   */
  status(): MigrationStatus {
    const applied = this.appliedRecords();
    const appliedIds = new Set(applied.map((m) => m.id));
    const pending = this.migrations.filter((m) => !appliedIds.has(m.id)).map((m) => m.id);
    return { applied, pending, version: applied.length };
  }

  /**
   * Schema version (number of applied migrations).
   */
  getVersion(): number {
    return this.status().version;
  }

  /**
   * Statement cache access (for application queries).
   */
  get statementsCache(): StatementCache {
    return this.statements;
  }

  /**
   * Close the database (and its prepared statements).
   */
  close(): void {
    if (this.closed) return;
    this.statements.clear();
    this.db.close();
    this.closed = true;
  }

  // ─── Internal ───────────────────────────────────────────────────

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS _migrations_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        owner TEXT NOT NULL,
        acquired_at TEXT NOT NULL
      );
    `);
  }

  private acquireLock(): void {
    // IMMEDIATE transaction prevents two processes from migrating concurrently
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.statements.prepare(
        'INSERT OR REPLACE INTO _migrations_lock (id, owner, acquired_at) VALUES (1, ?, ?)',
      ).run(`pid-${process.pid}`, new Date().toISOString());
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw new Error(`[migration-framework] failed to acquire migration lock: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private releaseLock(): void {
    this.db.exec('COMMIT');
  }

  private applyOne(id: string): string {
    const migration = this.migrations.find((m) => m.id === id);
    if (!migration) throw new Error(`[migration-framework] unknown migration: ${id}`);
    if (this.isApplied(id)) return id;

    this.acquireLock();
    try {
      migration.up(this.db);
      this.statements.prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)')
        .run(migration.id, new Date().toISOString());
      this.releaseLock();
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw new Error(`[migration-framework] migration ${id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    log.debug({ id }, 'migration applied');
    return id;
  }

  private revertOne(id: string): string {
    const migration = this.migrations.find((m) => m.id === id);
    if (!migration) throw new Error(`[migration-framework] unknown migration: ${id}`);
    if (!migration.down) throw new Error(`[migration-framework] migration ${id} has no down()`);
    if (!this.isApplied(id)) return id;

    this.acquireLock();
    try {
      migration.down(this.db);
      this.statements.prepare('DELETE FROM _migrations WHERE id = ?').run(migration.id);
      this.releaseLock();
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw new Error(`[migration-framework] rollback ${id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    log.debug({ id }, 'migration reverted');
    return id;
  }

  private isApplied(id: string): boolean {
    const row = this.statements.prepare('SELECT 1 FROM _migrations WHERE id = ?').get(id);
    return row !== undefined;
  }

  private appliedIds(): string[] {
    return this.appliedRecords().map((m) => m.id);
  }

  private appliedRecords(): AppliedMigration[] {
    const rows = this.statements.prepare('SELECT id, applied_at FROM _migrations ORDER BY applied_at, id').all() as {
      id: string;
      applied_at: string;
    }[];
    return rows.map((r) => ({ id: r.id, appliedAt: r.applied_at }));
  }
}
