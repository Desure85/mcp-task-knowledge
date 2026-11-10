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

Scope note (recorded in `docs/dev-cycle/decisions/2026-11-10-0510-y-08a.md`): the 100k pause-window
measurement was not performed in this increment; it is part of the Y-08b runbook/measurement instead of
being claimed here.
