# Reliability Contract (TR-08)

> **Scope.** This document describes the reliability behavior that **exists today**
> in `mcp-task-knowledge` — connector failure modes, retry/circuit-breaker
> machinery, batch partial-failure semantics, and the drain lifecycle.
> It is a *contract*: tests pin each claim, and every claim cites `file:line`.
> Gaps are documented as gaps, not glossed. Nothing here describes aspirational
> behavior; where the code does not provide a guarantee, that is stated
> explicitly and tracked in `BACKLOG.md`.

---

## 1. Connector failure modes

All built-in connectors live in `src/connectors/`. They differ in **three**
dimensions that matter when the remote API is unreachable:

| Connector | Fetch timeout | Error surface | Injectable fetch |
|-----------|---------------|---------------|------------------|
| `web-crawler` | **Yes** — `AbortSignal.timeout(timeoutMs)`, default `10_000` (`web-crawler.ts:16,61`) | Swallows errors → returns `{ok:true, title:'', content:'', links:[]}` (`web-crawler.ts:66-77`) | No (uses global `fetch`) |
| `github` | **No** — plain `fetch` (`github.ts:21`) | Throws `Error("GitHub API <status>: …")` → propagates to MCP as `isError` (`github.ts:26`) | No |
| `jira` | **No** — plain `fetch` (`jira.ts:27`) | Throws `Error("Jira API <status>: …")` (`jira.ts:28`) | No |
| `slack` | **No** — plain `fetch` (`slack.ts:20`) | Throws on HTTP error **and** on `{ok:false}` Slack envelope (`slack.ts:27-30`) | No |
| `gdrive` | **No** — plain `fetch` via `doFetch` (`gdrive.ts:51-54`) | Caught → `{ok:false, error:{message}}` (`gdrive.ts:117-121`) | **Yes** — `constructor(fetchFn)` (`gdrive.ts:46`) |
| `gmail` | **No** — `doFetch` (`gmail.ts:64-67`) | Caught → `{ok:false, error:{message}}` (`gmail.ts:147-151`) | **Yes** (`gmail.ts:59`) |
| `notion` | **No** — `notionFetch` (`notion.ts:70-81`) | Caught → `{ok:false, error:{message}}` (`notion.ts:135-139`) | **Yes** (`notion.ts:65`) |
| `onedrive` | **No** — `doFetch` (`onedrive.ts:51-54`) | Caught → `{ok:false, error:{message}}` (`onedrive.ts:104-108`) | **Yes** (`onedrive.ts:46`) |
| `linear` | **No** — `graphql` (`linear.ts:57-72`) | Caught → `{ok:false, error:{message}}` (`linear.ts:130-134`) | **Yes** (`linear.ts:52`) |

### What this means in practice

- **Hang risk (known gap).** Eight of nine connectors issue `fetch` with **no
  timeout**. Node's built-in `fetch` (undici) has a default *headers* timeout
  of 300 s and no overall body timeout — a stalled remote can pin a tool call
  for minutes. Only `web-crawler` bounds the wait (`timeoutMs`, default 10 s,
  configurable via connector config `timeoutMs`, `web-crawler.ts:20`).
- **Error shape is inconsistent.**
  - `github` / `jira` / `slack` let the thrown `Error` propagate; the MCP layer
    surfaces it as a protocol-level `isError` result, **not** the
    `{ok:false, error:{message}}` envelope used elsewhere.
  - `gdrive` / `gmail` / `notion` / `onedrive` / `linear` catch and return the
    standard `ErrEnvelope` (`src/utils/respond.ts:4`).
  - `web-crawler` is the outlier: it returns `{ok:true}` with **empty fields**
    on any failure — including DNS failures and timeouts — so callers cannot
    distinguish "page was empty" from "fetch failed" (`web-crawler.ts:66-77`).
- **Health checks are shallow.** `health()` for gdrive/gmail/notion/onedrive/
  linear reports `healthy:true` once initialized with credentials — it does
  **not** probe the remote API (e.g. `linear.ts:113-118`). Only `github`,
  `jira`, `slack` perform a live call in `health()` (`github.ts:96-104`,
  `jira.ts:80-88`, `slack.ts:88-96`).
- **Init failure is fail-fast.** `github`/`jira`/`slack` throw in `init()`
  when credentials are missing; `ConnectorRegistry.initAll` catches this and
  records `{id, error}` in the `errors` array without aborting other
  connectors (`registry.ts:73-77`).

### Documented gaps (tracked in BACKLOG)

- **TR-08-G1:** No `fetch` timeout on github/jira/slack/gdrive/gmail/notion/
  onedrive/linear — a hung remote stalls the tool call indefinitely.
- **TR-08-G2:** Connectors bypass the circuit breaker entirely (see §2) —
  repeated calls to a downed API each pay the full TCP/TLS latency.
- **TR-08-G3:** `web-crawler` collapses failures into `{ok:true, empty}` —
  indistinguishable from a legitimately empty page.
- **TR-08-G4:** Error envelope inconsistency — github/jira/slack throw
  (protocol `isError`) while the other five return `{ok:false}`.

---

## 2. Retry / circuit-breaker story

### What exists

`src/core/circuit-breaker.ts` implements a classic three-state breaker:

- **closed → open** after `failureThreshold` consecutive failures
  (default **5**, `circuit-breaker.ts:27-31`).
- **open → half-open** after `resetTimeoutMs` (default **10 000 ms**),
  evaluated lazily on `currentState` read (`circuit-breaker.ts:48-55`).
- **half-open → closed** after `halfOpenSuccessThreshold` successes
  (default **2**, `circuit-breaker.ts:66-77`).
- **half-open → open** on any failure (`circuit-breaker.ts:80-88`).

`src/core/graceful-degradation.ts` wraps it in `ServiceAvailability`
(per-service tracker mapping circuit state to `available | degraded |
unavailable`, `graceful-degradation.ts:44-49,124-133`) plus:

- `withFallback(availability, call, fallbackValue)` — returns the fallback
  instead of throwing when the circuit is open or the call throws
  (`graceful-degradation.ts:233-247`).
- `ServiceAvailabilityRegistry` — process-wide singleton
  (`getServiceAvailabilityRegistry`, `graceful-degradation.ts:163-167`).
- `toComponentHealth()` — maps availability into the health module's
  `ComponentHealth` for `/readyz` reporting (`graceful-degradation.ts:136-160`).

### Who actually uses it

| Consumer | Where | How |
|----------|-------|-----|
| `embeddings` | `app-container.ts:647-655` | Registered with a **custom** circuit: `failureThreshold: 2`, `resetTimeoutMs: 30_000`, `halfOpenSuccessThreshold: 1`. Search tools record failures via `onVectorError` → `recordFailure()` (`register/search.ts:8-12,31,53`). |
| `catalog` | `app-container.ts:656-659` | Registered with **default** circuit config; health reported via `toComponentHealth()`. |
| proxy resilience | `proxy/resilience.ts:23-25` | Re-exports `CircuitBreaker` for backward compatibility (TD-011 extraction). |

### What is NOT covered (documented gaps)

- **No retry/backoff anywhere.** The breaker only *gates* calls; nothing
  re-issues a failed call with delay. `withFallback` returns the fallback
  immediately — there is no jittered retry loop in the codebase.
- **Connectors do not use the breaker** (TR-08-G2). A downed GitHub API is
  hit on every `github_issue_list` call.
- **`recordSuccess` is never called for embeddings/catalog** — the trackers
  only ever see failures via `onVectorError`, so a service that recovers is
  not marked `available` again until the circuit's own half-open probe path
  is exercised by a *successful* `hybridSearch` (which does not call
  `recordSuccess` either — `search/index.ts:20-36` only invokes
  `onVectorError`). In practice the embeddings tracker can only move
  available → degraded → unavailable, never back. This is a known
  asymmetry, not a bug introduced here.

---

## 3. Batch partial-failure semantics

All bulk tools live in `src/register/bulk.ts`. The contract is:

### Envelope shape

- **Overall envelope is always `{ok:true, data:{count, results}}`** when the
  tool itself ran — even if every item failed. The only `{ok:false}` paths
  are *pre-flight* failures: missing `confirm:true` on destructive ops
  (`bulk.ts:259-261`), or a failed mandatory backup
  (`bulk.ts:262-263, 33-44` with `BACKUP_REQUIRED=1`).
- **Elicitation (TR-12):** when a destructive op (`project_purge`,
  `tasks_bulk_delete_permanent`, `knowledge_bulk_delete_permanent`) is called
  without `confirm:true`, the server first tries an MCP `elicitation/create`
  request asking the user to confirm. If the client doesn't declare the
  `elicitation` capability, the user declines/cancels, or the request fails,
  the tool falls back to the `{ok:false}` refusal envelope — fail-safe.
  `confirm:true` bypasses elicitation entirely (backward compatible).
- **`results` contains only the successes.** `updateTask`/`updateDoc`/
  `archiveTask`/`trashTask`/`restoreTask`/`closeTask`/`deleteTaskPermanent`
  return `Task | null` / `KnowledgeDoc | null` — `null` on missing ID — and
  the bulk handlers push only non-null results
  (`bulk.ts:73-79, 96-102, 149-155, 168-174, 207-213, 226-232, 265-271`;
  storage: `tasks.ts:159-161`, `knowledge.ts:122`).

### Per-item errors — the exception

Only **`tasks_bulk_delete_permanent` with `dryRun:true`** produces per-item
error entries: `{ok:true, data:task}` for found tasks, `{ok:false,
error:{message:"Task not found: …"}}` for missing ones
(`bulk.ts:243-256`). Every other bulk tool **silently drops** failed items —
`count` reflects successes only, and there is no `errors` array.

### Consequences

- A mixed batch (one valid ID + one bogus ID) returns `ok:true`,
  `count:1`, `results:[<valid item>]` — the caller cannot tell the bogus ID
  failed without diffing input vs output.
- An exception thrown mid-loop (e.g. `updateTask` throwing on a dependency
  cycle, `tasks.ts:183`) **aborts the whole batch** — items after the
  throwing one are never processed, and the error propagates as a
  protocol-level `isError`, losing the already-completed results.
  Documented gap **TR-08-G5**.

---

## 4. Drain lifecycle

Implemented in `src/health/checker.ts` + `src/health/endpoints.ts`
(SCALE-001), mounted by HTTP transports.

### State machine

```
            POST /drainz                DELETE /drainz
  serving ───────────────▶ draining ───────────────▶ serving
```

- `POST /drainz` → `checker.startDraining()` sets `draining=true`
  (`checker.ts:88-91`, `endpoints.ts:64-70`). Response `200
  {draining:true, message:"…no new sessions will be accepted"}`.
- `DELETE /drainz` → `checker.stopDraining()` clears the flag
  (`checker.ts:97-100`, `endpoints.ts:71-77`). Response `200
  {draining:false, …}`.
- `GET /drainz` (or any other method) → `200 {draining:<bool>}` status only
  (`endpoints.ts:79-83`).

### Effect on probes

- **`GET /readyz` returns 503 while draining.** `check()` computes
  `ready = !this.draining && every(component.ready)` (`checker.ts:60-62`);
  `readyz` maps `ready:false` → HTTP 503 with the full
  `HealthCheckResult` body including `draining:true`
  (`endpoints.ts:50-57`). This is the Kubernetes-readable signal: the pod
  stays *alive* but is pulled from the service endpoints.
- **`GET /healthz` is unaffected by draining.** `liveness()` only checks
  `status !== 'unhealthy'` (`checker.ts:71-74`) — draining does not change
  component status, so liveness stays 200. Correct: draining is not a
  reason to restart the process.
- **No enforcement beyond the probe.** `startDraining` only flips a flag —
  nothing in the transport layer actually rejects new sessions based on
  `isDraining`. The contract is *observational*: orchestrators read
  `/readyz` and stop routing. Documented gap **TR-08-G6**: session
  admission does not consult `draining`.

### Idempotence

`startDraining`/`stopDraining` are idempotent (`checker.ts:88-100`) —
repeated POSTs or DELETEs return 200 with the current state.

---

## Test coverage pinning this contract

| Claim | Test |
|-------|------|
| Connector fail-fast → `{ok:false}` envelope (not hang) | `tests/reliability-contract.test.ts` — injectable `fetchFn` rejecting |
| web-crawler timeout config exists | `tests/reliability-contract.test.ts` |
| Circuit breaker state transitions | `src/core/circuit-breaker.spec.ts` (pre-existing) |
| `withFallback` returns fallback on open/throw | `src/core/graceful-degradation.spec.ts` (pre-existing) |
| Mixed batch → `ok:true` + successes only | `tests/reliability-contract.test.ts` |
| `tasks_bulk_delete_permanent` dryRun per-item errors | `tests/reliability-contract.test.ts` |
| Drain → readyz 503, healthz 200, DELETE resumes | `src/health/endpoints.spec.ts` (extended) |
