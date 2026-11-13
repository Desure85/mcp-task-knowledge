# Task commands and work items (TK-05)

## Commands

`tasks_command` supports exactly two forms:

```text
State <status>
for me State <status>
```

- `<status>` is a status id (`in_progress`) or label (`In progress`); the project workflow is authoritative.
- `filter` needs at least one predicate: `ids`, `assignee`, `status`, `tag` or `priority`.
- `dryRun` defaults to **true** and returns a preview with `planned[]` and per-task `allowed`.
- `dryRun:false` requires `confirm:true`; otherwise `COMMAND_CONFIRM_REQUIRED`.
- Maximum **50** matched tasks; `COMMAND_TOO_MANY` above that.
- `for me` requires an authenticated user id (`COMMAND_IDENTITY_REQUIRED`); stdio/no-auth sessions must use `filter.assignee`.
- Transition rules are the project's `workflow.transitions` via `assertTransition`; no command-only exceptions.
- Applying is sequential and best-effort: `applied[]` and `failed[]` are returned; earlier successes are not rolled back.
- Optional `expectedVersion` is per-task CAS; mismatches appear in `failed` with `CONFLICT`.

## Work items

`tasks_worklog_add({ id, durationMin, startedAt?, description?, expectedVersion? })` appends a
`TaskWorkItem` to `Task.workItems`:

```jsonc
{ "id": "uuid", "userId": "u-1", "startedAt": "2026-11-13T10:00:00Z", "durationMin": 90, "description": "review", "createdAt": "..." }
```

- `durationMin` is an integer 1..1440; `startedAt` is ISO-8601.
- `tasks_worklog_list` returns items sorted by `startedAt` and their total.
- Work items are additive and stored in the task JSON; old clients that ignore the field keep working.

## Limits

- No edit/delete of a work item; no timer, rates, currency or cross-task time report.
- No UI screen yet.
- Partial command failures are reported, not transactional.
- `for me` is only as good as the session's `userId` metadata; open local stdio has none.
