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

const SCHEMA_VERSION = 6;

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
    create table if not exists events (
      log_path text not null,
      event_id integer not null,
      entity_id text not null,
      entity_type text not null,
      operation text not null,
      snapshot text,
      version integer not null,
      timestamp text not null,
      primary key (log_path, event_id)
    );
    create index if not exists events_log on events(log_path, event_id);
    create table if not exists snapshots (
      log_path text not null,
      entity_id text not null,
      entity_type text not null,
      state text,
      last_event_id integer not null,
      timestamp text not null,
      primary key (log_path, entity_id)
    );
    create table if not exists locks (
      key text primary key,
      owner text not null,
      expires_at integer not null
    );
    create virtual table if not exists search_fts using fts5(
      store,
      kind,
      project,
      id UNINDEXED,
      title,
      body,
      tokenize = 'unicode61'
    );
    create table if not exists search_fts_keys (
      store text not null,
      kind text not null,
      project text not null,
      id text not null,
      rowid integer not null,
      primary key (store, kind, project, id)
    );
    create index if not exists search_fts_keys_project on search_fts_keys(project);
    create table if not exists search_index_state (
      project text primary key,
      complete integer not null default 0,
      dirty integer not null default 0,
      updated_at text not null
    );
    create table if not exists vector_collections (
      collection text primary key,
      fingerprint text not null,
      chunking_version text not null,
      build_text_version text not null,
      dimension integer not null,
      active integer not null default 0,
      read_only integer not null default 0,
      created_at text not null
    );
    create table if not exists vector_rows (
      collection text not null,
      store text not null,
      kind text not null,
      project text not null,
      id text not null,
      fingerprint text not null,
      vector text not null,
      primary key (collection, store, kind, project, id)
    );
    create index if not exists vector_rows_identity on vector_rows(store, kind, project);
    create table if not exists vector_keys (
      collection text not null,
      vec_rowid integer not null,
      store text not null,
      kind text not null,
      project text not null,
      id text not null,
      primary key (collection, store, kind, project, id)
    );    create index if not exists tasks_project on tasks(project);
    create index if not exists docs_project on docs(project);
  `);
  db.prepare(
    'insert into profile_meta(key, value) values(?, ?) on conflict(key) do update set value = excluded.value',
  ).run('schema_version', String(SCHEMA_VERSION));
  return { db, close: () => db.close() };
}
