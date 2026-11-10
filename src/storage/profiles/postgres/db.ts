/**
 * Y-06a — соединение и схема Postgres-профиля.
 *
 * Профиль не знает, откуда берётся URL: `POSTGRES_URL` читает точка сборки и передаёт строку
 * подключения сюда (ADR-009 rule 1). Коллекции задач/документов хранятся как JSONB-документы —
 * ровно те же объекты, что отдают инструменты, поэтому wire-формат не зависит от профиля;
 * полнотекстовый поиск — `tsvector` (generated column) + GIN и `pg_trgm` для частичного совпадения.
 * Векторы — Y-06b: до появления pgvector-гейта `vectors` остаётся честной заглушкой.
 */

import pg from 'pg';

export const POSTGRES_SCHEMA_VERSION = 2;

export interface PostgresDatabaseOptions {
  /** libpq connection string; caller-provided (no config import here). */
  connectionString: string;
  /** Connection pool ceiling; defaults to 5. */
  maxConnections?: number;
  /** Test hook: skip `create extension` when the role cannot install extensions. */
  manageExtensions?: boolean;
}

export interface PostgresDatabase {
  pool: pg.Pool;
  /** True when `pg_trgm` was installed/available — used by SearchProvider honestly. */
  trgm: boolean;
  /** True when the `vector` (pgvector) extension is available — Y-06b ANN path. */
  pgvector: boolean;
  /** pgvector version when available (null otherwise), reported instead of guessed. */
  pgvectorVersion: string | null;
  close(): Promise<void>;
}

const SCHEMA_SQL = `
create table if not exists pg_meta (
  key text primary key,
  value text not null
);

create table if not exists tasks (
  project text not null,
  id text not null,
  data jsonb not null,
  archived boolean not null default false,
  trashed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (project, id)
);
create index if not exists tasks_project on tasks(project);
create index if not exists tasks_parent on tasks(project, ((data->>'parentId')));

create table if not exists docs (
  project text not null,
  id text not null,
  data jsonb not null,
  archived boolean not null default false,
  trashed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (project, id)
);
create index if not exists docs_project on docs(project);

create table if not exists doc_versions (
  project text not null,
  id text not null,
  version integer not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (project, id, version)
);

create table if not exists projects (
  project text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists events (
  path text not null,
  id bigint not null,
  data jsonb not null,
  primary key (path, id)
);

create table if not exists snapshots (
  path text not null,
  entity_id text not null,
  data jsonb not null,
  primary key (path, entity_id)
);

create table if not exists locks (
  key text primary key,
  owner text not null,
  acquired_at bigint not null,
  expires_at bigint not null
);

create table if not exists search_index (
  store text not null,
  kind text not null,
  project text not null,
  id text not null,
  title text not null default '',
  body text not null default '',
  tsv tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, ''))
  ) stored,
  primary key (store, kind, project, id)
);
create index if not exists search_index_tsv on search_index using gin(tsv);
create index if not exists search_index_project on search_index(project, store, kind);

create table if not exists search_state (
  project text primary key,
  complete boolean not null default false,
  dirty boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Y-06b: vector collections and canonical vectors. ANN tables are created per collection
-- (dimension is part of the collection address) only when pgvector is available.
create table if not exists vector_collections (
  collection text primary key,
  fingerprint text not null,
  chunking_version text not null,
  build_text_version text not null,
  dimension integer not null,
  active boolean not null default false,
  read_only boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists vector_rows (
  collection text not null,
  store text not null,
  kind text not null,
  project text not null,
  id text not null,
  fingerprint text not null,
  embedding jsonb not null,
  primary key (collection, store, kind, project, id)
);
create index if not exists vector_rows_identity on vector_rows(store, kind, project);
create table if not exists vector_keys (
  collection text not null,
  vec_id bigint not null,
  store text not null,
  kind text not null,
  project text not null,
  id text not null,
  primary key (collection, store, kind, project, id)
);
`;

export async function openPostgresDatabase(options: PostgresDatabaseOptions): Promise<PostgresDatabase> {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 5,
    application_name: 'mcp-task-knowledge',
  });
  let trgm = false;
  let pgvector = false;
  let pgvectorVersion: string | null = null;
  try {
    await pool.query('select 1');
    if (options.manageExtensions !== false) {
      try {
        await pool.query('create extension if not exists pg_trgm');
        trgm = true;
      } catch {
        // Managed databases may forbid CREATE EXTENSION; the search provider degrades honestly.
        trgm = false;
      }
      try {
        await pool.query('create extension if not exists vector');
      } catch {
        // pgvector is optional: the vector store falls back to exact cosine over jsonb rows.
      }
    }
    try {
      const installed = await pool.query("select extversion from pg_extension where extname = 'vector'");
      if (installed.rows[0]) {
        pgvector = true;
        pgvectorVersion = String(installed.rows[0].extversion);
      }
    } catch {
      pgvector = false;
    }
    await pool.query(SCHEMA_SQL);
    await pool.query(
      `insert into pg_meta(key, value) values ('schema_version', $1)
       on conflict(key) do update set value = excluded.value`,
      [String(POSTGRES_SCHEMA_VERSION)],
    );
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
  return {
    pool,
    trgm,
    pgvector,
    pgvectorVersion,
    close: async () => {
      await pool.end();
    },
  };
}
