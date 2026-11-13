# TK-05 design: commands, workflow rules, work items

- **Status:** design contract prepared; **implementation deliberately deferred** until real users
  exercise project workflows (the backlog item stays `blocked`, not done).
- **Date:** 2026-11-13
- **Depends on:** TK-03 (boards/sprints), V-02 (`workflow.transitions`), TK-01 (`assignee`)

## Command grammar (v1, proposed)

```text
tasks_command({
  command: "State Done",          // v1: only "State <status>" + optional "for me"
  filter: { project?, ids?, assignee?, status?, tag?, priority?, query? },
  dryRun?: true,                  // default true: preview only
  confirm?: true,                 // required to apply
  expectedVersion?: number        // optional; per-task CAS, fail-fast
})
```

Accepted forms:

- `State <status>` — move every task matched by `filter`;
- `for me State <status>` — same, target `assignee == <authenticated user id>`;
- no other verbs in v1 (no assign, tag, priority, delete, time).

Rejections:

| Code | When |
|---|---|
| `COMMAND_SYNTAX` | unknown verb/status token, empty filter |
| `COMMAND_IDENTITY_REQUIRED` | `for me` without an authenticated user id |
| `COMMAND_TOO_MANY` | more than 50 matched tasks |
| `TRANSITION_NOT_ALLOWED` | project `workflow.transitions` forbids the move (reuse `assertTransition`) |
| `CONFLICT` | `expectedVersion` mismatch on any task |

Response:

<!-- doc-test: skip -->

```jsonc
{
  "ok": true,
  "data": {
    "command": "State Done",
    "dryRun": true,
    "matched": 3,
    "planned": [
      { "id": "...", "from": "in_progress", "to": "completed", "allowed": true }
    ],
    "applied": [],
    "failed": []
  }
}
```

`dryRun` defaults to true; `confirm:true` is required for writes. Applying is sequential with
per-task `updateTask(...)`, one failure does not roll back earlier tasks — `applied` and `failed`
are both returned. No implicit assignment, no deletion, no time entry.

## Workflow rules

- The only rule source is `ProjectWorkflow.transitions` (already enforced by `updateTask` and
  `assertTransition`). No second DSL, no hidden command-only exceptions.
- A project may define `transitions` per status; missing key means any transition allowed
  (current behavior). `workflow_update` remains the admin path.
- Preview uses the same `assertTransition` so a dry run matches the real outcome.

## Work items / time tracking

Proposed `Task.workItems` (additive, optional):

<!-- doc-test: skip -->

```jsonc
{
  "id": "uuid",
  "userId": "u-...",           // optional when auth is off
  "startedAt": "2026-11-13T10:00:00Z",
  "durationMin": 90,            // integer > 0, <= 24*60
  "description": "review",
  "createdAt": "2026-11-13T11:30:00Z"
}
```

Tools: `tasks_worklog_add({ id, durationMin, startedAt?, description?, expectedVersion? })`,
`tasks_worklog_list({ id })`; derived `spentMinutes` in `tasks_get` is a sum, not stored twice.
Time strings (`1h 30m`) are parsed only at the tool edge; storage keeps integer minutes.
No billing rates, no timers, no cross-task reports in v1.

## Why deferred

The backlog itself says the expensive part comes after first real users: selection semantics,
"for me" identity under optional auth, partial-failure policy and time rounding are product
decisions, not protocol ones. Shipping them now would freeze guesses into the wire format.

## Open questions (owner input needed)

1. Identity: should `for me` require auth (`AUTH_ENABLED`) or also accept `assignee:"me"` as a
   literal? Current auth can be disabled, so a real user id is not always available.
2. Selection: is `filter` the right scope, or should commands require explicit `ids` only?
3. Partial failure: fail-fast with rollback via versions, or best-effort with per-task results
   (proposed best-effort)?
4. Rounding: minimum 1 minute, or 15-minute increments like YouTrack?
5. Are work items billable metadata (rate/currency) in scope later, or strictly effort logging?

## Implementation gate

Implement only after at least one real project uses custom statuses/transitions and reports the
command shapes it needs. Until then this document is the contract to review; no tool is
registered, so no client depends on an unstable command surface.
