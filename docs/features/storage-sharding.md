# Storage sharding (SC-06)

The file profile stores tasks as `DATA_DIR/tasks/<project>/<id>.json` and knowledge docs as
`DATA_DIR/knowledge/<project>/<id>.md`. Directories above roughly 50k entries become slow to
`readdir`/backup. SC-06 adds an optional sharded layout while keeping both layouts readable.

## Layout

```text
tasks/<project>/ab12cd34-....json        legacy, still read
tasks/<project>/ab/ab12cd34-....json     sharded: first two chars of the id
knowledge/<project>/ab12cd34-....md
knowledge/<project>/ab/ab12cd34-....md
tasks/<project>/.sharded                 marker written by migration
```

- `shardOfId(id)` = first two lowercase `[a-z0-9]` chars; anything else → `zz`.
- Reads try root first, then the shard, then the legacy flat `DATA_DIR/tasks/<id>.json` /
  `DATA_DIR/knowledge/<id>.md`.
- `listDataFiles` reads root files **and** all two-character shard dirs, deduplicates by id, and
  prefers the root copy. A partial migration therefore cannot duplicate a task in list/search.
- The `.sharded` marker switches new writes to shards. Existing projects migrate lazily when a
  write crosses `50_000` files, or explicitly through `migrateToShards`.

## Maintenance

```bash
# 100k sharded corpus (256 shards, ~443 files each in the 2026-11-12 run)
node scripts/bench/seed-scale.mjs --n 100000 --out /tmp/scale --sharded --tasks-only

# Reads are per shard: measured 0.67 ms for one 374-entry shard, far below 100 ms.
```

- `compactShards(root, ext, {threshold})` moves records back when a project is small again and
  removes empty shard dirs/marker.
- `archiveStaleClosedTasks(project, days)` sets `archived=true`/`archivedAt` on closed tasks older
  than the cutoff. It never changes status and never deletes.
- The sweep is opt-in: `TASK_ARCHIVE_AFTER_DAYS=90` runs once per `AppContainer.init`.
- Compaction is a maintenance primitive, not a timer; an operator/cron calls it. No background
  daemon is started by the server.

## Limits

- Sharding applies to the file profile only; SQLite/Postgres profiles are unchanged.
- Migration is serial per project and writes files one by one; run it during a quiet window.
- The lazy threshold counter is process-local; files added by another process are picked up on the
  next recount/migration, not instantly.
- The root copy wins during a half-finished migration; remove duplicates only after verification.
- Bench numbers are for a warm local SSD; DoD compares a single shard `readdir`, not end-to-end
  search with cold caches.
