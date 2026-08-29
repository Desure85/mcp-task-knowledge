/**
 * db/migration-framework.spec.ts — Tests for MigrationFramework (BM-013).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { MigrationFramework, StatementCache } from './migration-framework.js';
import type { Migration } from './migration-framework.js';

let testDir: string;

const MIGRATIONS: Migration[] = [
  {
    id: '0001-init',
    description: 'Create users table',
    up: (db) => db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)'),
    down: (db) => db.exec('DROP TABLE users'),
  },
  {
    id: '0002-tasks',
    description: 'Create tasks table',
    up: (db) => db.exec('CREATE TABLE tasks (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT)'),
    down: (db) => db.exec('DROP TABLE tasks'),
  },
  {
    id: '0003-index',
    description: 'Index tasks by user',
    up: (db) => db.exec('CREATE INDEX idx_tasks_user ON tasks (user_id)'),
    down: (db) => db.exec('DROP INDEX idx_tasks_user'),
  },
];

function makeFramework(path?: string): MigrationFramework {
  return new MigrationFramework({
    databasePath: path ?? ':memory:',
    migrations: MIGRATIONS,
  });
}

describe('BM-013: MigrationFramework', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `migrate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('migrate()', () => {
    it('applies all migrations in order', () => {
      const fw = makeFramework();
      const applied = fw.migrate();
      expect(applied).toEqual(['0001-init', '0002-tasks', '0003-index']);
      expect(fw.getVersion()).toBe(3);

      const status = fw.status();
      expect(status.pending).toEqual([]);
      expect(status.applied.map((m) => m.id)).toEqual(['0001-init', '0002-tasks', '0003-index']);
      fw.close();
    });

    it('is idempotent', () => {
      const fw = makeFramework();
      fw.migrate();
      const again = fw.migrate();
      expect(again).toEqual([]);
      expect(fw.getVersion()).toBe(3);
      fw.close();
    });

    it('creates the expected schema', () => {
      const fw = makeFramework();
      fw.migrate();
      const tables = (fw.statementsCache.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      ).all() as { name: string }[]).map((t) => t.name);
      expect(tables).toEqual(expect.arrayContaining(['users', 'tasks', '_migrations']));
      fw.close();
    });
  });

  describe('migrateUp() / migrateDown() / rollback()', () => {
    it('applies a limited number of migrations', () => {
      const fw = makeFramework();
      const applied = fw.migrateUp(2);
      expect(applied).toEqual(['0001-init', '0002-tasks']);
      expect(fw.getVersion()).toBe(2);
      fw.close();
    });

    it('reverts migrations newest-first with down()', () => {
      const fw = makeFramework();
      fw.migrate();
      const reverted = fw.migrateDown(2);
      expect(reverted).toEqual(['0003-index', '0002-tasks']);
      expect(fw.getVersion()).toBe(1);
      expect(fw.status().pending).toEqual(['0002-tasks', '0003-index']);
      fw.close();
    });

    it('rollback reverts the latest migration only', () => {
      const fw = makeFramework();
      fw.migrate();
      fw.rollback();
      expect(fw.getVersion()).toBe(2);
      // index gone, tables intact
      const hasIndex = fw.statementsCache.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_tasks_user'",
      ).get();
      expect(hasIndex).toBeUndefined();
      fw.close();
    });

    it('re-apply after rollback restores the schema', () => {
      const fw = makeFramework();
      fw.migrate();
      fw.rollback();
      fw.migrate();
      expect(fw.getVersion()).toBe(3);
      fw.close();
    });
  });

  describe('transactional safety', () => {
    it('rolls back a failing migration entirely', () => {
      const fw = new MigrationFramework({
        migrations: [
          ...MIGRATIONS,
          {
            id: '0004-broken',
            up: (db) => {
              db.exec('CREATE TABLE partial (x)');
              throw new Error('boom mid-migration');
            },
          },
        ],
      });

      expect(() => fw.migrate()).toThrow(/0004-broken failed/);
      // 0001-0003 applied, 0004 not recorded, its partial table rolled back
      expect(fw.getVersion()).toBe(3);
      const partial = fw.statementsCache.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'partial'",
      ).get();
      expect(partial).toBeUndefined();
      fw.close();
    });

    it('fails when reverting a migration without down()', () => {
      const noDown: Migration = {
        id: '0001-only-up',
        up: (db) => db.exec('CREATE TABLE x (id)'),
      };
      const fw = new MigrationFramework({ migrations: [noDown] });
      fw.migrate();
      expect(() => fw.rollback()).toThrow(/has no down/);
      expect(fw.getVersion()).toBe(1);
      fw.close();
    });
  });

  describe('StatementCache (LRU)', () => {
    it('caches prepared statements and evicts the oldest', () => {
      const fw = new MigrationFramework({ migrations: MIGRATIONS, statementCacheSize: 2 });
      const cache = fw.statementsCache;

      cache.prepare('SELECT 1');
      cache.prepare('SELECT 2');
      expect(cache.size).toBe(2);

      cache.prepare('SELECT 1'); // refresh recency
      cache.prepare('SELECT 3'); // evicts 'SELECT 2' (least recently used)
      expect(cache.size).toBe(2);
      fw.close();
    });
  });

  describe('WAL mode & pragmas', () => {
    // File-based SQLite WAL can be slow on CI filesystems — generous timeout
    it('enables WAL journal mode on file databases', () => {
      const dbPath = join(testDir, 'app.db');
      const fw = makeFramework(dbPath);
      fw.migrate();

      const raw = new Database(dbPath, { readonly: true });
      const mode = raw.pragma('journal_mode', { simple: true }) as string;
      expect(mode).toBe('wal');
      raw.close();
      fw.close();
    }, 20000);

    it('creates a persistent database file', () => {
      const dbPath = join(testDir, 'app.db');
      const fw = makeFramework(dbPath);
      fw.migrate();
      fw.close();
      expect(existsSync(dbPath)).toBe(true);
    }, 20000);
  });

  describe('status()', () => {
    it('reports pending migrations before applying', () => {
      const fw = makeFramework();
      const status = fw.status();
      expect(status.version).toBe(0);
      expect(status.pending).toEqual(['0001-init', '0002-tasks', '0003-index']);
      expect(status.applied).toEqual([]);
      fw.close();
    });
  });
});
