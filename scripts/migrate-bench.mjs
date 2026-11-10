#!/usr/bin/env node
/**
 * Y-08b — замер окна паузы миграции SQLite → Postgres на N записей.
 *
 * Usage:
 *   POSTGRES_URL=postgres://... node scripts/migrate-bench.mjs --count 100000
 *
 * Создаёт SQLite-базу с N задачами (прямые INSERT в одной транзакции, без API-обвязки), затем
 * прогоняет migrateStorage(sqlite-to-postgres) и печатает длительность — это консервативная оценка
 * окна, в течение которого цель обновляется. Требует `npm run build` и доступный PostgreSQL.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function parse(argv) {
  const options = { count: 100_000 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--count') options.count = Number(argv[++index]);
  }
  if (!Number.isFinite(options.count) || options.count <= 0) {
    console.error('--count must be a positive number');
    process.exit(2);
  }
  return options;
}

const options = parse(process.argv.slice(2));
const connectionString = process.env.POSTGRES_URL;
if (!connectionString) {
  console.error('POSTGRES_URL is required');
  process.exit(2);
}

const { openSqliteDatabase } = await import(new URL('../dist/storage/profiles/sqlite/db.js', import.meta.url).href);
const { openPostgresDatabase } = await import(new URL('../dist/storage/profiles/postgres/db.js', import.meta.url).href);
const { migrateStorage } = await import(new URL('../dist/storage/migrate.js', import.meta.url).href);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-bench-'));
const databasePath = path.join(dataDir, 'source.sqlite');
const handle = openSqliteDatabase(databasePath);
const db = handle.db;
const insert = db.prepare('insert into tasks(project, id, data) values(?,?,?)');
const now = new Date().toISOString();
const started = performance.now();
db.transaction(() => {
  for (let index = 0; index < options.count; index += 1) {
    const task = {
      id: `bench-${index}`,
      project: 'bench',
      title: `benchmark task ${index}`,
      description: 'migration pause window corpus',
      status: 'todo',
      priority: 'medium',
      tags: ['bench'],
      createdAt: now,
      updatedAt: now,
      archived: false,
      trashed: false,
    };
    insert.run('bench', task.id, JSON.stringify(task));
  }
})();
handle.close();
const fixtureMs = performance.now() - started;

// Fresh target: the pause window is measured for a real first migration, not an upsert of leftovers.
const { default: pg } = await import('pg');
const pgPool = new pg.Pool({ connectionString });
await pgPool.query('truncate tasks, docs, doc_versions, projects');
await pgPool.end();

const migrationStarted = performance.now();
const report = await migrateStorage({
  dataDir,
  databasePath,
  connectionString,
  direction: 'sqlite-to-postgres',
});
const pauseWindowMs = performance.now() - migrationStarted;

console.log(JSON.stringify({ count: options.count, fixtureMs: Math.round(fixtureMs), pauseWindowMs: Math.round(pauseWindowMs), checksumsEqual: report.checksums.equal, counts: report.counts.tasks }, null, 2));
fs.rmSync(dataDir, { recursive: true, force: true });
process.exit(report.checksums.equal ? 0 : 1);
