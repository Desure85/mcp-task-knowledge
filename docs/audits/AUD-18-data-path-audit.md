# AUD-18 — Data-path audit: storage → sync → search → memory

**Date:** 2026-09-12
**Scope:** `src/storage/`, `src/sync/`, `src/search/`, `src/memory/` (+ `src/fs.ts`, `src/behavioral/fts-search.ts` where it intersects the data path)
**Focus:** races, crash windows, injection, isolation. Prompt-injection via stored content is covered by TR-01 and intentionally excluded.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 5 |
| Medium | 6 |
| Low | 4 |

Top 3 most critical:

1. **Path traversal via `userId` in profile tools** — `memory_profile_get/update/context` pass a raw `userId` string into `ProfileManager.fileFor()` which does `join(storageDir, userId + '.json')` with no `resolveUnder`/`assertSafeSegment`. `userId: "../../x"` reads/writes/deletes arbitrary `*.json` files outside the profiles dir. (`src/memory/user-profile.ts:95-97`, `src/register/memory.ts:652,675,703`)
2. **Non-atomic `writeFileSync` JSON stores across memory/sync layers** — `TemporalGraph`, `EntityGraph`, `SessionMemory`, `LayeredMemory`, `ProfileManager`, `EventLog` all persist whole-state JSON via direct `writeFileSync` (no tmp+rename, no fsync). A crash/ENOSPC mid-write corrupts the entire store; `load()` then silently "starts fresh" → total data loss masked as a warning. (`src/memory/temporal-graph.ts:150-157`, `src/memory/entity-graph.ts:457-465`, `src/memory/session-memory.ts:288-296`, `src/memory/layers.ts:76`, `src/memory/user-profile.ts:113-121`, `src/sync/event-log.ts:141-149`)
3. **Lost-update RMW races on every JSON store** — all stores above keep an in-memory copy, mutate it, and rewrite the whole file. Two processes (or two server instances over HTTP/TCP transports, or cluster workers) interleaving `load → mutate → save` silently drop each other's writes. No locking, no CAS, no merge. Same pattern in `updateTask`/`updateDoc` (read doc → patch → write) — concurrent updates to the same task/doc lose one writer's patch. (`src/storage/tasks.ts:159-243`, `src/storage/knowledge.ts:122-158`)

---

## Findings

| File | Issue | Severity | Evidence | Category |
|------|-------|----------|----------|----------|
| `src/memory/user-profile.ts` | `fileFor(userId)` = `join(storageDir, userId + '.json')` — no segment validation. `userId` comes from MCP tool args (`z.string().min(1)` only). `getProfile`/`updateProfile`/`deleteProfile`/`buildContextBlock` all reachable → arbitrary read/write/delete of `<anything>.json` relative to profiles dir. | **critical** | `user-profile.ts:95-97`; entry points `register/memory.ts:652,675,703` | injection / isolation |
| `src/memory/temporal-graph.ts` | `save()` uses `writeFileSync` directly — no tmp+rename, no fsync. Crash mid-write → truncated JSON → `load()` catches parse error and "starts fresh" (line 146), silently discarding all facts. | **critical** | `temporal-graph.ts:150-157`, `139-148` | crash |
| `src/memory/entity-graph.ts` | Same non-atomic whole-file rewrite in `save()`; `load()` swallows errors → fresh empty graph. | high | `entity-graph.ts:457-465`, `445-455` | crash |
| `src/memory/session-memory.ts` | Same pattern: `writeFileSync(this.filePath, ...)`; corrupt file → `load()` returns empty storage. | high | `session-memory.ts:288-296`, `271-286` | crash |
| `src/memory/layers.ts` | Same non-atomic `writeFileSync` persistence. | high | `layers.ts:76` | crash |
| `src/memory/user-profile.ts` | Same non-atomic `writeFileSync` per-profile write. | high | `user-profile.ts:113-121` | crash |
| `src/sync/event-log.ts` | `persist()` rewrites the entire event log + snapshots on **every** `append()` via `writeFileSync` — O(n) write amplification per event plus a crash window on each append. `compactThreshold` is stored but never used to auto-trigger `compact()` — log grows unboundedly until someone calls `compact()` manually. | high | `event-log.ts:77` (persist per append), `141-149`, `61` (threshold unused) | crash / unbounded growth |
| `src/storage/tasks.ts` | `updateTask` is read-modify-write with no locking: `getTask` → merge patch → `writeJson`. Two concurrent updates to the same task lose one patch. `closeTaskAndUnblock`/`closeTaskWithCascade` iterate `listTasks` snapshots that can go stale mid-loop. | medium | `tasks.ts:159-243`, `254-281`, `388-410` | race |
| `src/storage/knowledge.ts` | `updateDoc` RMW race (same pattern). Additionally the version snapshot is written **before** the main doc write (lines 136-141 vs 155-156): a crash between them leaves a `.versions/` snapshot for a version that was never written — history claims a version exists that the doc never reached. | medium | `knowledge.ts:122-158` | race / crash |
| `src/storage/knowledge.ts` | `writeText` (used for all `.md` docs and version snapshots) is **not** atomic — direct `fs.writeFile`, unlike `writeJson`'s tmp+rename. Crash mid-write corrupts the doc; frontmatter parse then yields garbage meta. | medium | `fs.ts:48-51` vs `fs.ts:19-30` | crash |
| `src/fs.ts` | `writeJson` tmp+rename is atomic at the rename step but **no `fsync`** of the tmp file before rename nor of the directory after rename — on a power-loss the rename may be durable while content is not (or vice versa on some filesystems). Also tmp name uses `pid + Date.now()` — two `writeJson` calls for the same path in the same millisecond within one process collide on the tmp name (second overwrites first's tmp; both renames still succeed but the first writer's data is silently replaced — benign for same-target writes, still a race). | medium | `fs.ts:19-30` | crash / race |
| `src/storage/tasks.ts` | TOCTOU in `deleteTaskPermanent`/`getTask`: `pathExists` then `unlink`/`readJson` — file can disappear between check and use; `readJson` throws raw ENOENT to the caller instead of returning null. | low | `tasks.ts:28-33`, `148-152` | race |
| `src/sync/sync-manager.ts` | `SyncManager` keeps the entire version log **in memory only** — `versions[]` grows unboundedly, never persisted, never compacted. Restart loses all sync state; long-running process leaks memory linearly with writes. Also `recordVersion` is not concurrency-safe across processes (separate `nextTaskVersion` counters → duplicate version numbers if two instances run). | medium | `sync-manager.ts:13-29` | unbounded growth / isolation |
| `src/sync/conflict-resolver.ts` | `threeWayMerge` last-write-wins compares `local.updatedAt >= remote.updatedAt` — with equal timestamps it silently picks local (line 81 `>=`), and with missing timestamps defaults to remote (line 83). Clock skew between sync peers makes LWW arbitrary; no tiebreaker by node id. Also `manual` strategy writes `null` into conflicting fields (line 74) — silently corrupts the merged entity if the caller doesn't post-process. | medium | `conflict-resolver.ts:74-86` | race / data loss |
| `src/behavioral/fts-search.ts` | `sanitizeMatch` passes input through unchanged when it contains `AND|OR|NOT|NEAR` or `*` or is wrapped in quotes (line 347) — intentional raw-FTS5 passthrough. Not SQL injection (parameterized `MATCH ?`), but a malformed raw expression throws an unhandled SQLite error to the tool caller, and a crafted expression can force expensive`NEAR` scans (DoS-ish). Low severity since FTS5 can't escape the query context. | low | `fts-search.ts:341-355` | injection (contained) |
| `src/search/vector.ts` | `OnnxVectorAdapter.search` catches **all** errors and returns `[]` (line 437-439) — malformed embeddings, OOM in `encodeBatch`, tensor shape mismatches all silently degrade to "no vector results" with no log. Also `encodeBatch` allocates `batch * seqLen` BigInt64Arrays with no cap on `texts.length` — a caller passing a huge corpus can force a giant allocation (memory DoS). `maxLen` is capped at 512 only when metadata provides it (line 117); config-supplied `maxLen` is unbounded. | medium | `vector.ts:386-439`, `278-286`, `104-106` | crash / input validation |
| `src/search/emb_cache.ts` | Disk cache writes `.bin` then `.json` meta non-atomically (lines 72-74) — crash between them leaves a `.bin` with stale/missing meta; `get()` validates hash+dims so impact is a cache miss, not corruption. `id` is used as filename via `path.join(this.dir, id + '.bin')` — `id` is a doc/task id (UUID, safe today) but the cache doesn't defend itself if a non-UUID id ever flows in. | low | `emb_cache.ts:52-74` | crash / latent traversal |
| `src/memory/entity-graph.ts` | `discoverDir`/`walkFiles` follow any directory the caller passes — no confinement to project root; symlinks are followed implicitly by `statSync` (a symlinked dir inside the scanned tree can pull in files outside it). `parseImports` regexes are heuristic (fine) but `resolveRelative` uses `existsSync` probes — TOCTOU is harmless here (read-only). | low | `entity-graph.ts:297-341`, `381-405` | isolation |
| `src/memory/memory-io.ts` | `importFromClaudeDir`/`importFromObsidianDir`/`importFromCursorDir` accept an arbitrary directory path and walk it — by design (import), but there is no size/depth cap: a hostile or accidental huge tree (or a symlink loop — `walk` has no cycle detection on realpath) can hang the tool. `importJson` accepts arbitrary session objects with no schema validation — a crafted `sessions[]` entry with a huge `decisions` array or weird types lands verbatim in storage. | low | `memory-io.ts:98-124`, `257-285` | input validation / isolation |
| `src/memory/temporal-graph.ts` | `addFact` with `supersedesFactId` mutates `oldFact` in place then `save()` — if `save()` throws (ENOSPC), in-memory state says invalidated while disk still shows valid → divergence between memory and disk that persists until restart. Same in-place-mutate-then-save pattern in `invalidateFact`, `addRelationship`. | medium | `temporal-graph.ts:171-196`, `222-233`, `333-340` | crash / consistency |
| `src/sync/` (dead code) | `SyncManager`, `EventLog`, `threeWayMerge` are not referenced from `src/register/` or `src/tools/` — the sync stack is unreachable via MCP tools today. All findings above are latent; if wired later they arrive with these defects built in. | low | `grep -r "SyncManager\|EventLog" src/register src/tools` → no matches | process |

---

## Notes on what is already OK

- `writeJson` (Q-013) **is** atomic at the rename level (tmp + `fs.rename`, tmp cleanup on failure) — `src/fs.ts:19-30`. Missing only fsync durability.
- Path traversal on task/knowledge/project ids is closed by `resolveUnder`/`assertSafeSegment`/`resolveUnderPath` (AUD-03) — `src/fs.ts:80-121`, used consistently in `storage/tasks.ts` and `storage/knowledge.ts`.
- FTS5 queries are parameterized (`MATCH ?`, `= ?`) — no SQL string interpolation of user input in `fts-search.ts`.
- BM25 (`search/bm25.ts`) is pure in-memory — no I/O, no injection surface; worst case is CPU time on a huge corpus.
- `updateDoc` monotonic `updatedAt` bump (knowledge.ts:127-130) correctly handles same-ms updates.

---

## Recommended BACKLOG tasks

| Suggested ID | Task | Addresses |
|--------------|------|-----------|
| AUD-18a | **Validate `userId` (and all id-like tool args) with `assertSafeSegment` before joining to storage paths** — apply to `ProfileManager.fileFor`, `EmbeddingsCache` filenames, and audit every `join(dir, userControlled)` in `src/memory/`. | critical #1 |
| AUD-18b | **Route all whole-file JSON persistence through `writeJson` (tmp+rename)** — convert `TemporalGraph.save`, `EntityGraph.save`, `SessionMemory.save`, `LayeredMemory` save, `ProfileManager.save`, `EventLog.persist` to async atomic writes; add fsync of tmp file + parent dir for durability. | critical #2, high rows |
| AUD-18c | **Per-entity write serialization** — add an in-process per-key mutex (e.g. `Map<string, Promise>` chain) around `updateTask`/`updateDoc` and each memory store's mutate+save; document that multi-process writes to the same DATA_DIR are unsupported OR introduce lockfiles. | critical #3, medium RMW rows |
| AUD-18d | **EventLog: honor `compactThreshold`** — auto-`compact()` when `events.length > threshold`; batch `persist()` (append to a journal file instead of full rewrite, or debounce). | high event-log row |
| AUD-18e | **SyncManager persistence + bounded log** — persist version log (or rebuild from EventLog), cap retained versions, make counters restart-safe. | medium sync row |
| AUD-18f | **threeWayMerge hardening** — deterministic tiebreaker (node id) for equal `updatedAt`; `manual` strategy must not write `null` into merged fields — return conflicts separately and leave entity unmerged. | medium merge row |
| AUD-18g | **Vector adapter input caps + error visibility** — cap `texts.length` per `encodeBatch` call, bound `maxLen` from config, log (not swallow) errors in `search()`. | medium vector row |
| AUD-18h | **MemoryIO import limits** — max file count/depth/realpath cycle detection in `collectFiles`; zod-validate imported session records. | low import row |
| AUD-18i | **Fix knowledge version-snapshot ordering** — write the doc first (or write snapshot+doc under one atomic step) so `.versions/` never references an unwritten version. | medium knowledge row |
