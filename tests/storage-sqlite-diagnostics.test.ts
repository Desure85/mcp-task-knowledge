/**
 * Y-05c — диагностика и обслуживание SQLite-профиля: `doctor`-снимок и `reindex`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createSqliteProfile } from '../src/storage/profiles/sqlite/index.js';
import {
  inspectSqliteStorage,
  rebuildSqliteStorageIndexes,
} from '../src/storage/profiles/sqlite/diagnostics.js';
import { runReindexCli } from '../src/cli/reindex.js';
import { scanDataDir } from '../src/cli/doctor.js';

const dirs: string[] = [];
const profiles: ReturnType<typeof createSqliteProfile>[] = [];
const originalProfileEnv = process.env.STORAGE_PROFILE;

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'y05c-diag-'));
  dirs.push(dir);
  return dir;
}

function paths(dataDir: string) {
  return {
    dataDir,
    tasksDir: path.join(dataDir, 'tasks'),
    knowledgeDir: path.join(dataDir, 'knowledge'),
    projectsMetaDir: path.join(dataDir, 'projects'),
  };
}

async function populatedProfile(dataDir: string) {
  const databasePath = path.join(dataDir, '.index', 'storage.sqlite');
  const profile = createSqliteProfile({ databasePath });
  profiles.push(profile);
  await profile.tasks.create({ project: 'p', title: 'diag task one' });
  await profile.tasks.create({ project: 'p', title: 'diag task two' });
  await profile.docs.create({ project: 'p', title: 'diag doc', content: 'body' });
  profile.search.ensureIndexed('p');
  return { databasePath, profile };
}

function rawRun(databasePath: string, sql: string): void {
  const db = new Database(databasePath);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

afterEach(() => {
  for (const profile of profiles.splice(0)) profile.close?.();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  if (originalProfileEnv === undefined) delete process.env.STORAGE_PROFILE;
  else process.env.STORAGE_PROFILE = originalProfileEnv;
});

describe('Y-05c: inspectSqliteStorage', () => {
  it('reports a fresh database honestly', () => {
    const dataDir = tempDir();
    const databasePath = path.join(dataDir, '.index', 'storage.sqlite');
    const profile = createSqliteProfile({ databasePath });
    profiles.push(profile);
    const report = inspectSqliteStorage(databasePath);
    expect(report.exists).toBe(true);
    expect(report.schemaVersion).toBeGreaterThanOrEqual(5);
    expect(report.counts.tasks).toBe(0);
    expect(report.fts5).toBe(true);
    expect(report.warnings).toEqual([]);
  });

  it('counts collections and FTS rows, and flags dirty indexes', async () => {
    const dataDir = tempDir();
    const { databasePath } = await populatedProfile(dataDir);
    const report = inspectSqliteStorage(databasePath);
    expect(report.counts.tasks).toBe(2);
    expect(report.counts.docs).toBe(1);
    expect(report.counts.ftsRows).toBe(3);
    expect(report.index.complete).toBeGreaterThan(0);
    expect(report.warnings).toEqual([]);

    rawRun(databasePath, "update search_index_state set dirty = 1, complete = 0 where project = 'p'");
    const dirty = inspectSqliteStorage(databasePath);
    expect(dirty.warnings.some((warning) => warning.startsWith('sqlite-fts-dirty'))).toBe(true);
    expect(dirty.index.dirtyProjects).toEqual(['p']);
  });

  it('flags drift between search_fts and the canonical collections', async () => {
    const dataDir = tempDir();
    const { databasePath } = await populatedProfile(dataDir);
    rawRun(databasePath, "delete from search_fts where project = 'p' and id = (select id from search_fts where project = 'p' limit 1)");
    const report = inspectSqliteStorage(databasePath);
    expect(report.warnings.some((warning) => warning.startsWith('sqlite-fts-drift'))).toBe(true);
  });

  it('reports sqlite-vec unavailability instead of hiding it', () => {
    const dataDir = tempDir();
    const databasePath = path.join(dataDir, '.index', 'storage.sqlite');
    const profile = createSqliteProfile({ databasePath });
    profiles.push(profile);
    const report = inspectSqliteStorage(databasePath, {
      vecProbe: () => ({
        node: process.version,
        sqlite: '3.53.2',
        fts5: true,
        vec: { available: false, error: 'not installed' },
      }),
    });
    expect(report.vec.available).toBe(false);
    expect(report.warnings.some((warning) => warning.startsWith('sqlite-vec-unavailable'))).toBe(true);
  });
});

describe('Y-05c: FTS rowid map', () => {
  it('keeps search_fts_keys consistent with search_fts through writes and deletes', async () => {
    const dataDir = tempDir();
    const { databasePath, profile } = await populatedProfile(dataDir);
    const task = await profile.tasks.create({ project: 'p', title: 'rowid map task' });
    await profile.tasks.update('p', task.id, { title: 'rowid map task renamed' });
    await profile.tasks.deletePermanent('p', task.id);
    const db = new Database(databasePath);
    try {
      const fts = (db.prepare('select count(*) as total from search_fts').get() as { total: number }).total;
      const keys = (db.prepare('select count(*) as total from search_fts_keys').get() as { total: number }).total;
      const dangling = (
        db
          .prepare('select count(*) as total from search_fts_keys k left join search_fts f on f.rowid = k.rowid where f.rowid is null')
          .get() as { total: number }
      ).total;
      expect(keys).toBe(fts);
      expect(dangling).toBe(0);
      const stale = db.prepare("select count(*) as total from search_fts where id = ?").get(task.id) as { total: number };
      expect(stale.total).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe('Y-05c: rebuildSqliteStorageIndexes', () => {
  it('rebuilds FTS, clears dirty flags and checkpoints the WAL', async () => {
    const dataDir = tempDir();
    const { databasePath } = await populatedProfile(dataDir);
    rawRun(databasePath, "update search_index_state set dirty = 1, complete = 0 where project = 'p'");
    const rebuilt = await rebuildSqliteStorageIndexes(databasePath);
    expect(rebuilt.dirtyBefore).toBe(1);
    expect(rebuilt.projects).toBe(1);
    expect(rebuilt.indexed).toBe(1);
    expect(rebuilt.ftsRows).toBe(3);
    const after = inspectSqliteStorage(databasePath);
    expect(after.warnings).toEqual([]);
  });
});

describe('Y-05c: CLI integration', () => {
  it('reindex and doctor handle the SQLite profile', async () => {
    const dataDir = tempDir();
    const { databasePath } = await populatedProfile(dataDir);
    process.env.STORAGE_PROFILE = 'sqlite';
    const cliPaths = paths(dataDir);
    fs.mkdirSync(path.join(dataDir, '.index'), { recursive: true });

    const rebuilt = await runReindexCli(['--data', '--json'], cliPaths);
    expect(rebuilt.exitCode).toBe(0);
    expect(rebuilt.report?.storageProfile).toBe('sqlite');
    expect((rebuilt.report?.sqlite as { projects: number }).projects).toBe(1);

    const doctorReport = await scanDataDir(cliPaths);
    expect(doctorReport.sqlite?.counts.tasks).toBe(2);
    expect(doctorReport.sqlite?.databasePath).toBe(databasePath);
    expect(doctorReport.issues.filter((issue) => issue.check.startsWith('sqlite-'))).toEqual([]);

    rawRun(databasePath, "update search_index_state set dirty = 1, complete = 0 where project = 'p'");
    const verify = await runReindexCli(['--data', '--verify', '--json'], cliPaths);
    expect(verify.exitCode).toBe(1);
    const dirtyDoctor = await scanDataDir(cliPaths);
    expect(dirtyDoctor.issues.some((issue) => issue.check === 'sqlite-fts-dirty')).toBe(true);
  });
});
