import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { migrateStorage } from '../src/storage/migrate.js';
import { createTask, listTasks, updateTask } from '../src/storage/tasks.js';
import { createDoc, readDoc, updateDoc } from '../src/storage/knowledge.js';
import { createProject } from '../src/projects.js';
import { DATA_DIR } from '../src/config.js';
import { createSqliteProfile } from '../src/storage/profiles/sqlite/index.js';
import { createPostgresProfile } from '../src/storage/profiles/postgres/index.js';

const dataDir = DATA_DIR;
const databasePath = path.join(dataDir, '.index', 'migration-test.sqlite');

async function fixture(): Promise<void> {
  await fsp.rm(path.join(dataDir, 'tasks'), { recursive: true, force: true });
  await fsp.rm(path.join(dataDir, 'knowledge'), { recursive: true, force: true });
  await fsp.rm(path.join(dataDir, 'projects'), { recursive: true, force: true });
  await fsp.rm(path.join(dataDir, 'blobs'), { recursive: true, force: true });
  await fsp.rm(path.join(dataDir, '.backups'), { recursive: true, force: true });
  await fsp.rm(databasePath, { force: true });

  await createProject('alpha', 'alpha project');
  const one = await createTask({ project: 'alpha', title: 'migrated task', description: 'body', tags: ['x'] });
  await updateTask('alpha', one.id, { priority: 'high' });
  const archived = await createTask({ project: 'alpha', title: 'archived task' });
  await updateTask('alpha', archived.id, { archived: true });
  const doc = await createDoc({ project: 'alpha', title: 'migrated doc', content: 'document body', tags: ['t'] });
  await updateDoc('alpha', doc.id, { content: 'document body v2' });
  await fsp.mkdir(path.join(dataDir, 'blobs'), { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'blobs', 'attachments-a.txt'), 'blob payload', 'utf8');
}

describe('Y-08a: migrate-storage file ↔ SQLite', () => {
  it('dry-run reports the plan without mutating anything', async () => {
    await fixture();
    const report = await migrateStorage({ dataDir, databasePath, direction: 'file-to-sqlite', dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.counts.tasks.source).toBe(2);
    expect(report.counts.docs.source).toBe(1);
    expect(report.counts.projects.source).toBe(1);
    expect(report.counts.versions.source).toBeGreaterThanOrEqual(1);
    expect(report.counts.tasks.created).toBe(2);
    expect(fs.existsSync(databasePath)).toBe(false);
    expect(fs.existsSync(path.join(dataDir, '.backups'))).toBe(false);
  });

  it('migrates file → SQLite, verifies checksums and is idempotent', async () => {
    await fixture();
    const first = await migrateStorage({ dataDir, databasePath, direction: 'file-to-sqlite' });
    expect(first.checksums.equal).toBe(true);
    expect(first.discrepancies).toEqual([]);
    expect(first.backupPath).toBeDefined();
    expect(first.counts.tasks.created).toBe(2);
    expect(first.counts.docs.created).toBe(1);
    expect(first.counts.versions.created).toBeGreaterThanOrEqual(1);

    const profile = createSqliteProfile({ databasePath });
    try {
      const tasks = await profile.tasks.list({ project: 'alpha', includeArchived: true, includeTrashed: true });
      expect(tasks.map((task) => task.title).sort()).toEqual(['archived task', 'migrated task']);
      const migrated = tasks.find((task) => task.title === 'migrated task');
      expect(migrated).toMatchObject({ priority: 'high', description: 'body', tags: ['x'] });
      const doc = (await profile.docs.list({ project: 'alpha' }))[0];
      expect(doc.title).toBe('migrated doc');
      expect((await profile.docs.read('alpha', doc.id))?.content.trimEnd()).toBe('document body v2');
      const versions = await profile.docs.versions('alpha', doc.id);
      expect(versions.length).toBeGreaterThanOrEqual(1);
    } finally {
      profile.close?.();
    }
    const blob = await import('node:fs/promises').then((mod) => mod.readFile(path.join(path.dirname(databasePath), 'blobs', 'attachments-a.txt'), 'utf8'));
    expect(blob).toBe('blob payload');

    const second = await migrateStorage({ dataDir, databasePath, direction: 'file-to-sqlite' });
    expect(second.counts.tasks).toMatchObject({ created: 0, updated: 0, skipped: 2 });
    expect(second.counts.docs).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect(second.checksums.equal).toBe(true);
  });

  it('updates a changed record and detects corruption in verify-only mode', async () => {
    await fixture();
    await migrateStorage({ dataDir, databasePath, direction: 'file-to-sqlite' });
    const task = (await listTasks({ project: 'alpha' }))[0];
    await updateTask('alpha', task.id, { title: 'changed after migration' });
    const changed = await migrateStorage({ dataDir, databasePath, direction: 'file-to-sqlite' });
    expect(changed.counts.tasks.updated).toBe(1);
    expect(changed.checksums.equal).toBe(true);

    // Corrupt the target out-of-band, then verify: no writes, mismatch reported.
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(databasePath);
    db.prepare("update tasks set data = json_set(data, '$.title', 'corrupted title') where project = 'alpha' and id = ?").run(task.id);
    db.close();
    const before = Date.now();
    const verified = await migrateStorage({ dataDir, databasePath, direction: 'file-to-sqlite', verifyOnly: true });
    expect(Date.now() - before).toBeGreaterThanOrEqual(0);
    expect(verified.verifyOnly).toBe(true);
    expect(verified.checksums.equal).toBe(false);
    expect(verified.discrepancies.some((entry) => entry.startsWith('tasks:'))).toBe(true);
    const profile = createSqliteProfile({ databasePath });
    try {
      expect((await profile.tasks.get('alpha', task.id))?.title).toBe('corrupted title');
    } finally {
      profile.close?.();
    }
  });

  it('migrates SQLite → file and restores the readable file layout', async () => {
    await fixture();
    await migrateStorage({ dataDir, databasePath, direction: 'file-to-sqlite' });
    await fsp.rm(path.join(dataDir, 'tasks'), { recursive: true, force: true });
    await fsp.rm(path.join(dataDir, 'knowledge'), { recursive: true, force: true });
    await fsp.rm(path.join(dataDir, 'projects'), { recursive: true, force: true });
    await fsp.rm(path.join(dataDir, 'blobs'), { recursive: true, force: true });

    const report = await migrateStorage({ dataDir, databasePath, direction: 'sqlite-to-file' });
    expect(report.checksums.equal).toBe(true);
    expect(report.discrepancies).toEqual([]);
    const tasks = await listTasks({ project: 'alpha', includeArchived: true });
    expect(tasks.map((task) => task.title).sort()).toEqual(['archived task', 'migrated task']);
    const docs = await import('../src/storage/knowledge.js').then((mod) => mod.listDocs({ project: 'alpha' }));
    const doc = docs[0];
    expect(doc.title).toBe('migrated doc');
    expect((await readDoc('alpha', doc.id))?.content.trimEnd()).toBe('document body v2');
    const { listDocVersions } = await import('../src/storage/knowledge.js');
    expect((await listDocVersions('alpha', doc.id)).length).toBeGreaterThanOrEqual(1);
    expect(await fsp.readFile(path.join(dataDir, 'blobs', 'attachments-a.txt'), 'utf8')).toBe('blob payload');
  });
});


const postgresUrl = process.env.POSTGRES_URL;
const describePostgres = postgresUrl ? describe : describe.skip;

describePostgres('Y-08b: migrate-storage SQLite ↔ Postgres (requires POSTGRES_URL)', () => {
  it(
    'migrates sqlite→postgres and postgres→sqlite with equal checksums',
    async () => {
      await fixture();
      const postgresDatabasePath = path.join(dataDir, '.index', 'pg-source.sqlite');
      await migrateStorage({ dataDir, databasePath: postgresDatabasePath, direction: 'file-to-sqlite' });

      const pgProfile = await createPostgresProfile({ connectionString: postgresUrl! });
      const { default: pg } = await import('pg');
      const pool = new pg.Pool({ connectionString: postgresUrl! });
      await pool.query('truncate tasks, docs, doc_versions, projects');
      await pool.end();

      const toPostgres = await migrateStorage({
        dataDir,
        databasePath: postgresDatabasePath,
        connectionString: postgresUrl!,
        direction: 'sqlite-to-postgres',
      });
      expect(toPostgres.checksums.equal).toBe(true);
      expect(toPostgres.discrepancies).toEqual([]);
      expect(toPostgres.counts.tasks).toMatchObject({ created: 2, skipped: 0 });

      try {
        const tasks = await pgProfile.tasks.list({ project: 'alpha', includeArchived: true, includeTrashed: true });
        expect(tasks.map((task) => task.title).sort()).toEqual(['archived task', 'migrated task']);
        const docs = await pgProfile.docs.list({ project: 'alpha' });
        expect(docs).toHaveLength(1);
      } finally {
        pgProfile.close?.();
      }

      // Idempotent postgres rerun.
      const again = await migrateStorage({
        dataDir,
        databasePath: postgresDatabasePath,
        connectionString: postgresUrl!,
        direction: 'sqlite-to-postgres',
      });
      expect(again.counts.tasks).toMatchObject({ created: 0, updated: 0, skipped: 2 });
      expect(again.checksums.equal).toBe(true);

      // Back from Postgres into a fresh SQLite database.
      const backPath = path.join(dataDir, '.index', 'pg-roundtrip.sqlite');
      await fsp.rm(backPath, { force: true });
      const back = await migrateStorage({
        dataDir,
        databasePath: backPath,
        connectionString: postgresUrl!,
        direction: 'postgres-to-sqlite',
      });
      expect(back.checksums.equal).toBe(true);
      expect(back.discrepancies).toEqual([]);
      const sqliteProfile = createSqliteProfile({ databasePath: backPath });
      try {
        expect(await sqliteProfile.tasks.list({ project: 'alpha', includeArchived: true, includeTrashed: true })).toHaveLength(2);
        expect(await sqliteProfile.docs.list({ project: 'alpha' })).toHaveLength(1);
      } finally {
        sqliteProfile.close?.();
      }
    },
    120_000,
  );
});
