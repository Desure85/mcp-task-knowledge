# Backlog ↔ tracker reconciliation (AA-09)

`BACKLOG.md` is the normative source of item status. The task tracker under
`DATA_DIR/tasks/<project>/` may contain derived records, and it can drift. This read-only
checker reports drift; it never writes `BACKLOG.md` or task files.

## Explicit mapping

Because tracker ids are UUIDs and the same human title may change, the mapping is explicit in
`docs/backlog-tracker-map.json`:

```json
{
  "T-002": { "taskTitle": "1.2 TCP/Unix сервер (multi-client)" },
  "TR-20": { "taskId": "3f9c…" }
}
```

- `taskTitle` — exact title after whitespace collapse and case-folding (preferred; readable).
- `taskId` — stable tracker UUID when the title is not stable.
- Only mapped ids are compared; unmapped BACKLOG rows are out of scope by design.

## Status normalisation

`done`, `completed`, `closed` → `done`; `in progress`, `in_progress`, `in-progress`, `wip` →
`in_progress`; `todo` → `pending`; `blocked`, `review`, `deferred` preserved. Markdown emphasis and
✅/❌ are ignored.

## Usage

```bash
DATA_DIR=/data node scripts/backlog-sync-check.mjs --project mcp
node scripts/backlog-sync-check.mjs --data ./data --project mcp --json
```

- Exit `0` — `0 расхождений`.
- Exit `1` — at least one mismatch; each line names the id and both statuses.
- Exit `2` — missing DATA_DIR/mapping/BACKLOG or invalid args.
- The checker only reads; a read-only hash check is part of `tests/backlog-sync-check.test.ts`.

## Known limit

In this environment `/data` is absent and `C:\Users\dm\mcpTrackerData\tasks` has no project task
files, so the real tracker cannot be compared here. The checker and its mapping were exercised
against isolated fixtures; run the command above where the live tracker exists. When the tracker's
titles change, update the mapping rather than silently fuzzy-matching.
