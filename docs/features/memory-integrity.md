# Memory graph: integrity and snapshots (MU-06)

## Write path

`memory/temporal-graph.json` is written **atomically**: `writeFileAtomicSync` writes a temp file
and `rename()`s it over the target. A reader sees either the old or the new complete JSON, never
a half-written file. A failed write removes the temp file and leaves the previous graph intact.

The whole graph is still rewritten on every mutation (facts are stored as one JSON object). At
~750 KB this is acceptable; it is not append-only and does not scale to millions of facts.

## Snapshots

Every successful save may create a copy in `<storagePath>.snapshots/`:

- default interval **1 hour**; the first save after process start also snapshots;
- default **24** newest files, older ones pruned;
- filenames `temporal-graph-<ISO>-<seq>.json`;
- snapshot errors are logged and never fail the write;
- configurable per `TemporalGraph` instance via
  `{ snapshot: { dir?, intervalMs?, keep? } }`.

Snapshots are **not** in git: DATA_DIR is user data and a 750 KB file per hour would bloat
history. They are local recovery material, not backups; copy them off-host if that is required.

## Multiple clients

- One process, one `TemporalGraph` instance: calls are synchronous and serialized by the event
  loop, so there is no intra-process interleaving.
- Several **processes** (e.g. stdio + HTTP on the same DATA_DIR): each loads the file at startup
  and rewrites it wholesale. This is **last-write-wins**, not a merge: a fact added by process A
  while B holds an older copy can be lost when B writes. Atomic rename prevents corruption but
  not lost updates.
- There is no cross-process lock, no CRDT and no optimistic version check on `addFact`. Do not
  point two writable instances at one DATA_DIR for concurrent writes; use one writer or separate
  DATA_DIRs.

## Recovery

1. Stop writers.
2. Inspect the newest file in `<storagePath>.snapshots/` and validate JSON.
3. Copy it over `temporal-graph.json` (keep the damaged file as `.bak-<date>`).
4. Restart. Invalid JSON currently loads as an empty graph with a warning — a damaged main file
   without a snapshot loses facts, which is why snapshots exist.

## Limits

- No automatic restore command/UI; recovery is manual.
- Snapshot pruning is by mtime; a burst of writes within one millisecond can prune by filename
  tie-break, still keeping `keep` newest names.
- No integrity checksum per fact; JSON parse is the only validation.
