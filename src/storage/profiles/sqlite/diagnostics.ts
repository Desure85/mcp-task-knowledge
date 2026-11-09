/**
 * Y-05c — диагностика и обслуживание SQLite-профиля.
 *
 * `inspectSqliteStorage` — read-only снимок состояния БД для `doctor`: схема, счётчики коллекций,
 * состояние FTS-индекса, доступность `sqlite-vec`, размер файла и честные предупреждения.
 * `rebuildSqliteStorageIndexes` — обслуживание для `reindex`: пересобирает FTS по всем проектам,
 * сбрасывает dirty-флаги и делает WAL checkpoint. Оба работают с путём, который передаёт вызывающий
 * (ADR-009 rule 1), и не импортируют config.
 */

import fs from 'node:fs';
import Database from 'better-sqlite3';
import { probeSqliteVec, type SqliteVecProbe } from './vec-gate.js';
import { createSqliteProfile } from './index.js';

export interface SqliteStorageCounts {
  tasks: number;
  docs: number;
  projects: number;
  vectorRows: number;
  vectorCollections: number;
  ftsRows: number;
}

export interface SqliteStorageReport {
  databasePath: string;
  exists: boolean;
  sizeBytes: number;
  node: string;
  sqlite: string;
  fts5: boolean;
  schemaVersion: number | null;
  counts: SqliteStorageCounts;
  index: { projects: number; complete: number; dirty: number; dirtyProjects: string[] };
  vec: { available: boolean; version?: string };
  warnings: string[];
}

export interface SqliteReindexReport {
  databasePath: string;
  projects: number;
  indexed: number;
  ftsRows: number;
  dirtyBefore: number;
  sizeBefore: number;
  sizeAfter: number;
  durationMs: number;
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db.prepare("select name from sqlite_master where type = 'table' and name = ?").get(table);
  return Boolean(row);
}

function count(db: Database.Database, sql: string, ...params: unknown[]): number {
  try {
    return Number((db.prepare(sql).get(...params) as { total: number }).total);
  } catch {
    return 0;
  }
}

export function inspectSqliteStorage(
  databasePath: string,
  options: { vecProbe?: (db: Database.Database) => SqliteVecProbe } = {},
): SqliteStorageReport {
  const exists = fs.existsSync(databasePath);
  const report: SqliteStorageReport = {
    databasePath,
    exists,
    sizeBytes: exists ? fs.statSync(databasePath).size : 0,
    node: process.version,
    sqlite: 'unknown',
    fts5: false,
    schemaVersion: null,
    counts: { tasks: 0, docs: 0, projects: 0, vectorRows: 0, vectorCollections: 0, ftsRows: 0 },
    index: { projects: 0, complete: 0, dirty: 0, dirtyProjects: [] },
    vec: { available: false },
    warnings: [],
  };
  if (!exists) {
    report.warnings.push('sqlite database does not exist yet (the profile creates it on first boot)');
    return report;
  }
  const db = new Database(databasePath, { readonly: true });
  try {
    const probe = options.vecProbe
      ? options.vecProbe(db)
      : probeSqliteVec(db);
    report.sqlite = probe.sqlite;
    report.fts5 = probe.fts5;
    report.vec = { available: probe.vec.available, version: probe.vec.version };
    report.schemaVersion = tableExists(db, 'profile_meta')
      ? (() => {
          const row = db.prepare("select value from profile_meta where key = 'schema_version'").get() as
            | { value: string }
            | undefined;
          return row ? Number(row.value) : null;
        })()
      : null;
    report.counts = {
      tasks: count(db, 'select count(*) as total from tasks'),
      docs: count(db, 'select count(*) as total from docs'),
      projects: count(db, 'select count(*) as total from projects'),
      vectorRows: count(db, 'select count(*) as total from vector_rows'),
      vectorCollections: count(db, 'select count(*) as total from vector_collections'),
      ftsRows: count(db, 'select count(*) as total from search_fts'),
    };
    if (tableExists(db, 'search_index_state')) {
      const rows = db.prepare('select project, complete, dirty from search_index_state').all() as Array<{
        project: string;
        complete: number;
        dirty: number;
      }>;
      report.index.projects = rows.length;
      report.index.complete = rows.filter((row) => row.complete === 1 && row.dirty === 0).length;
      report.index.dirty = rows.filter((row) => row.dirty === 1).length;
      report.index.dirtyProjects = rows.filter((row) => row.dirty === 1).map((row) => row.project);
    }

    if (!report.fts5) report.warnings.push('sqlite-fts5-unavailable: SQLite was built without FTS5');
    else if (report.index.dirty > 0) {
      report.warnings.push(
        `sqlite-fts-dirty: ${report.index.dirty} project(s) need reindex (${report.index.dirtyProjects.join(', ')})`,
      );
    }
    if (!report.vec.available) {
      report.warnings.push('sqlite-vec-unavailable: vector search falls back to brute-force cosine');
    }
    const liveTasks = count(
      db,
      "select count(*) as total from tasks where coalesce(json_extract(data, '$.archived'), 0) = 0 and coalesce(json_extract(data, '$.trashed'), 0) = 0",
    );
    const liveDocs = count(
      db,
      "select count(*) as total from docs where coalesce(json_extract(data, '$.archived'), 0) = 0 and coalesce(json_extract(data, '$.trashed'), 0) = 0",
    );
    const expected = liveTasks + liveDocs;
    if (report.index.complete > 0 && report.counts.ftsRows !== expected) {
      report.warnings.push(`sqlite-fts-drift: search_fts has ${report.counts.ftsRows} rows, collections expect ${expected}`);
    }
  } finally {
    db.close();
  }
  return report;
}

export async function rebuildSqliteStorageIndexes(databasePath: string): Promise<SqliteReindexReport> {
  const startedAt = Date.now();
  const before = inspectSqliteStorage(databasePath);
  if (!before.exists) {
    throw new Error(`sqlite database ${databasePath} does not exist`);
  }
  const profile = createSqliteProfile({ databasePath });
  try {
    const projects = await profile.tasks.list({ includeArchived: true, includeTrashed: true });
    const docs = await profile.docs.list({ includeArchived: true, includeTrashed: true });
    const names = [...new Set([...projects.map((task) => task.project), ...docs.map((doc) => doc.project)])].sort();
    for (const project of names) profile.search.ensureIndexed(project);
    profile.close?.();
    const db = new Database(databasePath);
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } finally {
      db.close();
    }
    const after = inspectSqliteStorage(databasePath);
    return {
      databasePath,
      projects: names.length,
      indexed: after.index.complete,
      ftsRows: after.counts.ftsRows,
      dirtyBefore: before.index.dirty,
      sizeBefore: before.sizeBytes,
      sizeAfter: after.sizeBytes,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    // close is idempotent on better-sqlite3? guard to be safe for early throws.
    try {
      profile.close?.();
    } catch {
      /* already closed */
    }
  }
}
