# ADR-2026-11-12: Git-history layer for MU-03/SC-07

- **Status:** Accepted (design gate; implementation pending)
- **Context:** MU-03 wants per-operation history on `DATA_DIR`; SC-07 requires that a
  commit-per-operation is not used at 100k+ files (`git add`/`status` are O(N)).
- **Decision owner:** autonomous backlog run `S-20261109-night`

## Question

Use `git` CLI via `execFile` or `isomorphic-git`? And how to batch commits without losing
changes when the process dies?

## Evidence

Benchmark on Windows, Node 24, temp repo with 100 files (git 2.x):

- `git add -A && git commit` ×10: min **155.3 ms**, median **170.0 ms**, max **183.3 ms**.
- `isomorphic-git` is **not installed** (`package.json` has no dependency); adding it would
  add an image-size/dependency cost and its commit latency is not measured here.

The measured cost is per commit, not per file; 100k files would still make every
`git add`/`status` walk the tree, so per-operation commits are rejected by SC-07.

## Decision

1. **Transport:** `execFile('git', ...)` from `node:child_process`; no new dependency.
   `isomorphic-git` is rejected for this iteration (unmeasured latency, extra package);
   it remains an option only if the git binary is absent and a design revision is opened.
2. **Commit batching (SC-07):** a repository-level queue collects relative paths from
   task/knowledge/prompt writes. A flush happens when **100 paths** or **2 s** accumulate,
   whichever first, and produces **one commit**. The operation returns after the write;
   the queue is durable enough for a crash: each queued path is appended to
   `DATA_DIR/.history/queue.jsonl` before the write, and a startup recovery commits or
   re-applies the queue.
3. **Locking:** per-entity `withFileLock` remains; a repository lock (`history:repo`) is
   taken only during flush. Batch operations take entity locks in sorted id order, enqueue
   all paths, then flush once.
4. **Revert semantics:** restore/history is a **new commit**, never `reset --hard` or file
   deletion; the UI/tool can show a line/field diff.
5. **Startup dirty tree:** if `git status --porcelain` is non-empty at AppContainer init,
   commit it as `recovered` with the session author, then continue.
6. **No git binary:** history is disabled with a single WARN; task/knowledge operations
   proceed normally. No retry loop, no silent fallback to non-git history.
7. **Author:** `--author` from current session `userId` (or client label); missing identity
   uses a deterministic `mcp-task-knowledge <mcp@localhost>`.
8. **Ignore:** `audit.log`, `.jwt-revoked.json`, `.backups/`, `memory/`, `.history/queue.jsonl`
   and temporary files.

## Consequences

- One commit per batch, not per operation; a single-operation update may not be visible in
  git until the timer/size flush. Tools that read history must flush first.
- Crash recovery is required: queue file + startup `recovered` commit; SC-07's DoD test
  `tests/git-history-batch.test.ts` must cover N operations → one commit, revert as new
  commit, and crash/no-loss.
- On Windows, ~170 ms per commit is acceptable at batch boundaries; per-operation would be
  unacceptable at 100k files.
- `isomorphic-git` is not evaluated empirically; this is recorded as a limitation, not a
  claim of equivalence.

## Alternatives rejected

- **Per-operation commit:** O(N) `git add/status`, violates SC-07.
- **`reset --hard` restore:** rewrites history and can lose concurrent work.
- **SQLite revision table only:** duplicates diff/restore logic already needed for git;
  can be revisited if git is absent.
- **isomorphic-git now:** unmeasured latency and new dependency; not justified by evidence.

## Follow-up

Implement `src/history/git.ts` + queue/flush + `tests/git-history-batch.test.ts`; wire
tasks/docs/prompts writes; then MU-04 tools and MU-07 concurrency tests.
