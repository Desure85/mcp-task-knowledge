# migrate-storage (file ↔ SQLite)

`src/storage/migrate.ts` moves a DATA_DIR between the file profile and the SQLite profile by the phases
from ADR-009: plan (dry-run) → target snapshot (backup) → delta in an exclusive section → verification
(checksums) → report. It never mutates the source, so switching `STORAGE_PROFILE` back is the rollback.

```bash
npm run build
node scripts/migrate-storage.mjs --data ./data --direction file-to-sqlite --dry-run
node scripts/migrate-storage.mjs --data ./data --direction file-to-sqlite
node scripts/migrate-storage.mjs --data ./data --direction file-to-sqlite --verify
node scripts/migrate-storage.mjs --data /data --db /data/.index/storage.sqlite --direction sqlite-to-file

# Postgres as source or target (POSTGRES_URL is read from the environment)
POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/mcp \
  node scripts/migrate-storage.mjs --data ./data --direction sqlite-to-postgres
POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/mcp \
  node scripts/migrate-storage.mjs --data ./data --direction postgres-to-sqlite \
  --db ./data/.index/target.sqlite
```

What is migrated: tasks, documents (body + frontmatter), project metadata, document versions and blobs.
What is not: event logs/locks (operational data recreated by the profile) and prompt/memory stores
(they live as files in both profiles, so moving the DATA_DIR already moves them).

Guarantees:

- `--dry-run` writes nothing and creates no backup; `--verify` compares both sides and reports
  discrepancies without writing.
- Idempotent: records are compared by a canonical sha256 of their JSON, so a second run reports
  `skipped` and an in-place change reports `updated`; nothing is duplicated.
- The target is snapshotted under `DATA_DIR/.backups/migrate-<timestamp>` before the delta; the source
  tree/database is left untouched.
- The report contains per-collection counts (`source/created/updated/skipped`), source/target checksums
  with `equal`, a `discrepancies` list (missing/extra/differing records and post-migration mismatch) and
  a `switchHint`.

## Pause-window benchmark (100k)

`bash
npm run build
POSTGRES_URL=postgres://... node scripts/migrate-bench.mjs --count 100000
`

The script builds a 100k-task SQLite fixture with direct INSERTs in one transaction, truncates the
Postgres target, runs a real `sqlite-to-postgres` migration and prints the pause window. Measured
locally against PostgreSQL 18.6 (embedded-postgres): fixture 1.0 s, **pause window 42.9 s**,
`checksumsEqual=true`. The window is a conservative estimate — rows are upserted one by one;
COPY/batching is a recorded follow-up, not silently assumed.

## Postgres caveats

- Blobs are only compared when both sides keep them locally (file/SQLite). Postgres stores no blob rows;
  attachments stay next to the profile (`STORAGE_BLOBS_DIR`) and are not part of checksums for
  Postgres directions.
- The Postgres target schema is created on demand; the rollback artefact is
  `postgres-snapshot.json` in the backup directory.
- Stage-Y gate note: the shared cross-profile contract suite, `docs/benchmarks/` hit@1/medianMs/RSS
  and CI service runs are still open; this runbook does not claim them.
