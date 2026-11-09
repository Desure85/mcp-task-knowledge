/**
 * Y-05a — SQLite-профиль: открытие БД и миграции.
 *
 * Файл создаётся вызывающим кодом (правило 1 ADR-009: корни/пути передаёт вызывающий). Профиль
 * не импортирует `config.ts`, чтобы тесты могли открыть свою временную БД без DATA_DIR.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export interface SqliteDatabase {
  db: Database.Database;
  close(): void;
}

const SCHEMA_VERSION = 2;

export function openSqliteDatabase(databasePath: string): SqliteDatabase {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    create table if not exists profile_meta (
      key text primary key,
      value text not null
    );
    create table if not exists tasks (
      project text not null,
      id text not null,
      data text not null,
      primary key (project, id)
    );
    create table if not exists docs (
      project text not null,
      id text not null,
      data text not null,
      primary key (project, id)
    );
    create table if not exists projects (
      project text primary key,
      data text not null
    );
    create table if not exists doc_versions (
      project text not null,
      id text not null,
      version integer not null,
      data text not null,
      updated_at text not null,
      primary key (project, id, version)
    );
    create index if not exists tasks_project on tasks(project);
    create index if not exists docs_project on docs(project);
  `);
  db.prepare(
    'insert into profile_meta(key, value) values(?, ?) on conflict(key) do update set value = excluded.value',
  ).run('schema_version', String(SCHEMA_VERSION));
  return { db, close: () => db.close() };
}
