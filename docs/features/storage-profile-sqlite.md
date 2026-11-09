# SQLite storage profile

`STORAGE_PROFILE=sqlite` switches the server's storage layer to a single SQLite database instead of
the default files-and-git profile. Both profiles implement the same contracts from
[ADR-009](docs/adr/0009-pluggable-storage-and-embeddings.md); the wire format of every tool stays the
same.

## Enabling it

```bash
export DATA_DIR=/path/to/data           # the database lives at $DATA_DIR/.index/storage.sqlite
export STORAGE_PROFILE=sqlite
mcp-task-knowledge                       # or: node dist/index.js
```

- Default is `STORAGE_PROFILE=file` (unchanged behaviour).
- An unknown value fails at boot with `CONFIG_MISMATCH` instead of silently falling back.
- The database file is created on first boot with the current schema version.

## What the profile stores

| Collection | Storage | Notes |
|---|---|---|
| Tasks, knowledge documents | SQLite rows (canonical JSON) | CRUD, filters, pages with cursors, lifecycle, task trees/cascade |
| Projects, project metadata, workflow | SQLite | workflow built from metadata through the shared `src/workflow.ts` normalizers |
| Document versions | `doc_versions` table | every update records a version; `restoreVersion` restores it and records the restore |
| Prompts, memory | shared file-backed implementations | deliberate: prompts are file-sourced by wire contract (`PromptRecord.path`), memory classes take caller paths; a native store is a separate ADR |
| Event log, snapshots | `events`/`snapshots` tables | same semantics as the file journal; ids are not reused after compaction |
| Locks | `locks` table | conditional upsert with lease + bounded wait; works across processes |
| Full-text search | FTS5 `search_fts` table | indexed text comes from the shared `buildTextForTask`/`buildTextForDoc`; kept in step with mutations, rebuilt by `reindex` |
| Vectors | `vector_collections`/`vector_rows`/`vector_keys` + `vec0` tables | ANN via `sqlite-vec`; when the extension is unavailable the store uses brute-force cosine and says so |

`embeddings_status` reports the active collection, the indexing queue (`state/total/done/queued/
skipped/ratePerSec`), and whether external embeddings are enabled — the same fields as with the file
profile.

## Diagnostics and maintenance

```bash
STORAGE_PROFILE=sqlite mcp-task-knowledge doctor --data        # includes a SQLite section
STORAGE_PROFILE=sqlite mcp-task-knowledge doctor --data --json # same, machine-readable
STORAGE_PROFILE=sqlite mcp-task-knowledge reindex --data       # rebuild FTS, clear dirty, WAL checkpoint
STORAGE_PROFILE=sqlite mcp-task-knowledge reindex --data --verify  # exit 1 when something needs a rebuild
```

`doctor` warns about: `sqlite-fts5-unavailable`, `sqlite-fts-dirty` (projects whose index writes
failed), `sqlite-fts-drift` (index rows vs canonical collections), and `sqlite-vec-unavailable`
(vectors still work through the brute-force fallback).

## Benchmark

`scripts/storage-bench.mjs` compares the two profiles on the same workload:

```bash
npm run build
node scripts/storage-bench.mjs --count 10000      # quick check
node scripts/storage-bench.mjs --count 100000 --json
```

It measures create/list/page/get/update. Results for this machine are recorded in
`docs/dev-cycle/decisions/2026-11-10-0130-y-05c.md`; the script is the reproducible source, not a
throughput guarantee.

## Known limitations (recorded, not hidden)

- Prompts and memory stay file-backed (see above).
- `ProjectInfo.paths` is empty in this profile: SQLite has no filesystem roots; removing the field
  from the wire format is a separate tool-contract change.
- Vector ANN re-scores a bounded candidate pool (`max(limit*8, 32)`) with exact cosine; this is a
  deliberate trade-off, not a metric approximation.
- The Docker check for `sqlite-vec` could not be run in the development environment (Docker daemon
  unavailable); `sqlite-vec` is an npm package with prebuilt binaries and the Node-side gate is
  verified by `tests/sqlite-vec-gate.test.ts`. The Docker check remains a CI/infra step if the
  project ever ships the profile in a container image.
