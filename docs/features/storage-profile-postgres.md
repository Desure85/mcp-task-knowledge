# PostgreSQL storage profile

`STORAGE_PROFILE=postgres` stores tasks, documents, projects, versions, events and locks in a real
PostgreSQL database. The wire format of every tool is unchanged: the same JSON documents are stored in
`jsonb` columns.

## Enabling it

```bash
export POSTGRES_URL=postgres://user:password@127.0.0.1:5432/mcp
export STORAGE_PROFILE=postgres
mcp-task-knowledge
```

- Missing `POSTGRES_URL` fails at boot with `CONFIG_MISMATCH` and a hint instead of opening a partial
  client.
- The profile creates its own schema on boot (`pg_meta`, `tasks`, `docs`, `doc_versions`, `projects`,
  `events`, `snapshots`, `locks`, `search_index`, `search_state`).
- `pg_trgm` is installed when the role is allowed to `CREATE EXTENSION`; the flag is reported honestly
  and will drive the Y-06a2 search provider.

## What is implemented now (Y-06a1) and what is not

| Area | Status |
|---|---|
| Tasks (CRUD, filters, pages/cursors, lifecycle, tree/subtree/children, cascade close) | implemented |
| Documents (CRUD, archive/trash/restore, versions on create/update, version restore) | implemented |
| Projects (create/list/detail stats/metadata/workflow/remove with force) | implemented |
| History (document versions; task history returns `CAPABILITY_UNAVAILABLE`) | implemented |
| Locks (`pg_advisory_xact_lock`, cross-process serialization) | implemented |
| Event log | write-behind cache over sync contract; `flush()` makes persistence observable |
| Full-text search (`tsvector` + `pg_trgm`) | **Y-06a2** — `capabilities.fullText=false` for now |
| Vectors (`pgvector`/HNSW) | **Y-06b** — extension is not available in every environment |
| Task claims | `CAPABILITY_UNAVAILABLE` (same honest limitation as the SQLite profile) |

## Verifying locally without Docker

The repository deliberately does not ship PostgreSQL binaries. On a machine without Docker or a
PostgreSQL server, a real server can be started from the npm package `embedded-postgres` in a scratch
directory (PostgreSQL 18.x binaries):

```bash
# in a scratch directory
npm install embedded-postgres pg
node -e " ... new EmbeddedPostgres({...}).initialise()/start()/createDatabase('mcp_test') ... "

POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:55434/mcp_test \
  npx vitest run tests/storage-postgres.test.ts --maxWorkers=1
```

Without `POSTGRES_URL` the suite is skipped with that explanation. CI does not yet start a Postgres
service because the repository token used for the current session has no `workflow` scope; this is
recorded in `docs/dev-cycle/decisions/2026-11-10-0340-y-06a1.md` rather than claimed as a CI check.
