# Capacity budgets and limits (TR-09)

Measured on `sc02e-dod-100k-2026-11-08`, 100k tasks, `EMBEDDINGS_MODE=none`,
`CATALOG_ENABLED=false`, Node 24, file profile with sharding.

## Enforced budget (weekly CI)

Workflow `.github/workflows/scale-bench.yml` (Mondays 03:17 UTC + manual) seeds 100k
sharded tasks, runs `run-scale.mjs --only tasks_list,knowledge_list --reps 3`, then
`gate-scale.mjs` fails when any of these is exceeded:

| Signal | Budget | Baseline |
|---|---|---|
| `tasks_list` median | 2× baseline or 500 ms | 28 ms |
| `knowledge_list` median | 2× baseline or 500 ms | 33 ms |
| cold start (spawn → `/healthz`) | 5000 ms | 967 ms |
| RSS after load | 3072 MB | 2.1–2.2 GB measured at 100k |

Baseline: `docs/benchmarks/scale-baseline.json`. A gate failure uploads
`scale-result.json` and `scale-gate.json` as artifacts.

## Recommended maximum dataset

- **100k tasks + 100k documents** — validated by the weekly gate and the 2026-10 run.
- **1M** — **not validated**. The 2026-10 report measured 1M as empty placeholders plus
  extrapolation because `/tmp` lacked inodes; RSS/response sizes grow linearly and are
  already ~2.2 GB at 100k. Treat 1M as unsupported until a real run on ext4 with a
  memory ceiling is recorded.
- **Memory**: 3 GB RSS is the enforced ceiling for the 100k gate; the measured
  after-load value is 2.1–2.2 GB. A low-RAM runner (<4 GB) is not a supported benchmark host.
- **Response size**: `tasks_list` at 100k without pagination returns ~59 MB; use `limit`/
  cursor. The gate measures the paginated path only.

## What is not in CI, and why

| Benchmark | Not in CI because |
|---|---|
| `sqlite-index-bench.mjs` | needs a separate data build and compares prototype paths; covered by SC-02 measurements |
| `ui-bench.mjs` | needs a running Next dev server and Playwright; browser timing is noisy on shared runners |
| `graph-bench.mjs` | needs Playwright + large synthetic graphs; covered by `graph-viz.spec.ts` unit budgets |
| 1M seed | inode/time cost exceeds the 30-minute job on GitHub-hosted runners |
| memory ceiling above 3 GB | no runner with a stable cgroup limit; RSS is process-reported `/proc` value |

## Updating the budget

1. Run the workflow manually on a commit whose performance you trust.
2. Download `scale-result.json`; confirm the machine was not under load (cold start and RSS
   are the sanity signals).
3. Update `scale-baseline.json` in the same PR as the change that moved the number, with a
   one-line reason. Do not raise caps to make a red gate green without a measurement.
4. `tests/scale-gate.test.ts` covers the gate CLI: baseline pass, 2×/cap fail, RSS fail.

## Known limitations

- Three reps, median only; no p95 in the gate (p95 is in the raw result).
- Single shared GitHub runner; 2–6× run-to-run spread was observed in 2026-10.
- The gate runs only `tasks_list` and `knowledge_list`; search, memory and UI have separate
  measurements but no weekly enforcement.
- No disk/inode ceiling check in CI.
