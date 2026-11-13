# Two-way task sync (INT-008, mock v1)

## Contract

`tasks_sync({ project?, system: "file", direction: "pull"|"push"|"both", dryRun?, confirm? })`
runs **one** sync cycle and returns counts plus per-item ids:

```jsonc
{ "dryRun": true, "createdLocal": [], "updatedLocal": [], "createdExternal": [], "updatedExternal": [], "skipped": [], "conflicts": [], "errors": [] }
```

- `dryRun` defaults to **true**; writes require `dryRun:false` **and** `confirm:true`.
- `system:"file"` uses a JSON file adapter at `$DATA_DIR/sync/<project>.json`; it is the
  mock/offline tracker, not YouTrack.
- `system:"youtrack"` returns `SYNC_NOT_CONFIGURED`: a writable token and the write-side
  YouTrack adapter are not part of this mock release.

## Change detection

Each task stores `external: { system, id, url?, updatedAt?, localHash? }`.

- Local change = `localHash` (SHA-256 of mapped fields) differs from the current task.
  `updatedAt` is not used because writing the link itself bumps it.
- External change = tracker `updatedAt` differs from `external.updatedAt` saved at last sync.
- Both changed, equal timestamps, different mapped fields → `conflicts[]` entry, no writes.
- Both changed, different timestamps → newer side wins.
- No change → `skipped`, so a second cycle is a no-op and cannot loop.

## Mapping

`DEFAULT_MAPPING` in `src/sync/mapping.ts` maps `status` and `priority` identity-style; it is
validated for empty/duplicate values. A custom mapping can be passed to `syncTasks()` in code;
the MCP tool currently uses the default.

## Verified

- `tests/task-sync.test.ts` — 7/7: pull, idempotent second cycle, push once without duplicates,
  external-only edit, local-only edit, newer-side wins, equal-timestamp conflict, dry-run.
- `tests/file-tracker.test.ts` — persistence/id assignment.
- Revert-check: disabling the local-newer branch → RED.

## Limits

- **No live YouTrack/Jira/Linear**: only the file adapter is wired; write-side YouTrack is TODO.
- No background/scheduled sync, no pagination/large-tracker handling, no project-level mapping UI.
- Conflict is detected at the mapped-field set, not resolved per individual field; newer-side
  comparison uses task-level `updatedAt`.
- The file adapter is single-process JSON without locking; it is a mock, not a durable tracker.
- No deletion propagation (external deletes do not delete local tasks or vice versa).
