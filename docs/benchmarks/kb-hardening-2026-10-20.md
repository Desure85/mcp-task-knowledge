# KB hardening — baseline and after (2026-10-20)

Goal: `mcp-kb-hardening` — make the knowledge base a trusted source: reproducible
measurements first, then indexing out of the user path, search quality on mixed
RU/EN + code without RU regression, and fact-anchor verification.

Everything below comes from the same fixed fixtures and the same harness:

- `scripts/kb-bench.mjs` — fixture, retrieval, multilingual labels, stdio latency, component split
- `scripts/field-eval.mjs` — model judge (99 fields, multilingual labels), scoring identical to the original judge
- `scripts/kb-bench-queries.json` — 18 hand-written queries (6 RU paraphrases, 6 EN paraphrases, 6 code identifiers)

## Fixtures

| Set | Size | Source |
|---|---|---|
| Docs chunks | **146** chunks from 31 files (221,090 chars) | `docs/**/*.md`, `chunkSize=1700`, `overlap=170` — same algorithm as `src/search/index.ts` |
| Retrieval queries | 18 (6 RU / 6 EN / 6 code) | `scripts/kb-bench-queries.json`, expected doc file per query |
| Partner fields | 99 fields (78 evaluated, 21 `unclear`) | `/tmp/field-eval-data/gold_fields.json` |
| Language labels | 2024 entries × de/en/es/fr/pl/pt/ru/tr | `/tmp/field-eval-data/multilingual_labels.json` (note: `pl` is empty in the source set) |

Environment: node v26.8.1, model `gemma2-q4` (`embeddinggemma-2`, q4 ONNX, dim 768,
instruction prefixes on), `EMBEDDINGS_MODE=onnx-cpu`. The host has a GTX 1070 but no
CUDA runtime libraries, so the CUDA probe fails and the adapter falls back to CPU
(verified: same timings, no crash) — the GPU path itself could not be exercised here.

## Baseline (before changes)

### Retrieval — 146 docs, 18 queries

| Channel | hit@1 | hit@3 | MRR | RU hit@1 | EN hit@1 | code hit@1 |
|---|---:|---:|---:|---:|---:|---:|
| BM25 only | 72.2% | 88.9% | 0.867 | 50.0% | 100% | 100% |
| Hybrid (BM25+vector, RRF) | 83.3% | 88.9% | 0.884 | 50.0% | 100% | 100% |

RU misses at baseline: `privacy` query (rank 4, surfaced P2P sync) and `Obsidian vault`
query (rank 6, surfaced Getting Started).

### Model judge — fields + labels

| Metric | Baseline |
|---|---|
| Gold top-1 | **58/78 (74.4%)** |
| Gold top-3 | 68/78 |
| RU top-1 | 68.1% |
| EN top-1 | 78.1% |
| DE top-1 | 75.5% |
| ES top-1 | 73.3% |
| FR top-1 | 74.0% |
| PT top-1 | 73.3% |
| TR top-1 | 69.8% |

Server-side label retrieval (same 120-entry stratified slice, through the adapter)
reproduces the judge per-language numbers within 0.1 pp — the vector channel in the
server is faithful to the standalone model, so quality work can be measured in either place.

### Latency / memory / indexing (stdio, 146 docs)

| Measurement | Cold (no cache) | Warm start (persisted cache) |
|---|---:|---:|
| `initialize` | 380 ms | 374 ms |
| **First `search_knowledge`** | **40,427 ms** | **1,963 ms** |
| Warm search (median of 3) | 107 ms | 101 ms |
| RSS after search | 1,580 MB | 666 MB |
| Cached vectors | 146 | 146 |

Component split (in-process): adapter init 1,766 ms, **indexing 39,184 ms**, warm query 63 ms.
Indexing is inside the first search request: 146 chunks × ~268 ms each.

### Boundary check

`loopx check`: `ok=False`, 6 hits — 4× the word `credential` in docs/backlog text and
local session drafts, 2× `private_ip` in the security documentation that lists blocked
ranges (`169.254.169.254`). No secrets; recorded as accepted false positives, no follow-up.

## After changes

### 1. Indexing is no longer in the request path

`src/search/warmup.ts` + `adapter.warmup()` encode and cache knowledge docs in the
background: startup warmup for the current project (all projects with
`EMBEDDINGS_WARMUP_PROJECTS=all`), debounced re-index after storage writes, and a
per-project budget (`EMBEDDINGS_WARMUP_BUDGET_MS`, default 180 s; `EMBEDDINGS_WARMUP=0`
disables). `project_set_current` warms the project it switches to. Status is visible in
`embeddings_status.warmup`.

| Measurement (146 docs, CPU) | Baseline | After |
|---|---:|---:|
| `initialize` | 380 ms | 490 ms |
| **First `search_knowledge` after warmup** | **40,427 ms** | **100 ms** |
| Warm search (median of 3) | 107 ms | 102 ms |
| Warmup work (now off-request) | 39,184 ms inline | 40,197 ms background |
| RSS after search (cold) | 1,580 MB | 1,582 MB |
| Warm start (persisted cache): first search | 1,963 ms | 1,789 ms |
| Warm start: RSS | 666 MB | 613 MB |
| Ingest → re-indexed (`knowledge_bulk_create`, 1 new doc) | first search pays it | **453 ms**, search after 94 ms, new doc found |

Budget behaviour is explicit, not silent: with a 5 s budget only 16 of 146 docs were
indexed (`reason: budget exceeded`) and the first search then paid 47,674 ms for the
remaining 130. A large base that exceeds the default 180 s therefore still has a slow
first search — see *What is left*.

Two races were fixed along the way: `ensureVectorAdapter` now shares one init promise
(concurrent search during warmup used to see `vectorInitAttempted=true` and silently lose
the vector channel), and warmup never blocks `initialize` (boot stays lazy, DX-22).

### 2. Search quality on mixed RU/EN + code

Docs retrieval (146 chunks, 18 queries: 6 RU, 6 EN, 6 code):

| Metric | Baseline | After |
|---|---:|---:|
| hit@1 | 83.3% | **88.9%** |
| hit@3 | 88.9% | **94.4%** |
| MRR | 0.884 | **0.926** |
| RU hit@1 / hit@3 / MRR | 50.0% / 66.7% / 0.653 | **66.7% / 83.3% / 0.778** |
| EN hit@1 | 100% | 100% |
| code hit@1 | 100% | 100% |

The RU gain comes from the lexical confidence floor (0.15 → 0.05): the `privacy` query's
correct document was BM25 rank 2 with confidence 0.06, was filtered out, and fell from
rank 1 to rank 4 in fusion. No query regressed; `missed` went from 1 to 0.

Root causes fixed in the defaults (all measured, not assumed):

1. **Auto-detection preferred LaBSE over Gemma.** `modelCandidates()` only looked for
   `encoder.onnx`, so a checkout with both bundles silently ran the legacy model
   (gold 52/78, 47–57% outside RU/EN). Candidates now cover the `gemma-q4` bundle first.
2. **Gemma ran without its instruction prefixes** when the user did not set env vars.
   They are now applied automatically for EmbeddingGemma models.
3. **`dim` was never inferred for EmbeddingGemma**: `hidden_size` lives in
   `text_config` and is 512, while the model's `sentence_embedding` is 768 wide. Auto-config
   therefore saw "missing dim" and downgraded to `EMBEDDINGS_MODE=none` (BM25-only).
   The adapter now takes the real output width from its first encode; `EMBEDDINGS_DIM` is optional.

Model judge (identical scoring, same fixed sets):

| Metric | Baseline (explicit Gemma) | After (auto-detected) |
|---|---:|---:|
| Gold top-1 | 58/78 (74.4%) | 58/78 (74.4%) |
| Gold top-3 | 68/78 | 68/78 |
| RU top-1 (120-entry slice) | 68.1% | 68.1% |
| EN / DE / ES / FR / PT / TR (120) | 78.1 / 75.5 / 73.3 / 74.0 / 73.3 / 69.8 | identical |
| Out-of-box model | LaBSE: 52/78, 47.4–57.3% | **Gemma: 58/78, 81.5–83.6% (full set)** |

Full fixed set (2024 entries; 1841–2020 queries per language, raw JSON in
`docs/benchmarks/kb-hardening-field-eval-full.json`):

| Language | Top-1 | Top-3 | n |
|---|---:|---:|---:|
| RU | 83.6% | 94.8% | 2020 |
| EN | 83.6% | 96.0% | 2009 |
| DE | 82.2% | 93.0% | 2011 |
| ES | 82.7% | 94.8% | 2018 |
| FR | 81.5% | 93.2% | 1841 |
| PT | 81.8% | 93.9% | 2018 |
| TR | 82.0% | 92.9% | 2017 |

Every measured language clears 80% top-1, including Turkish (82.0%). Slice-based runs are
misleading here: on a stratified 200-entry slice TR read 73%, and on 120 entries every
language read 73–78% — the slice's group mix, not the model, drives that. Server-side
retrieval through the adapter reproduces the judge per language within 0.1 pp, so the
number reflects what `search_knowledge` gets. The source set has no `pl` values at all.

Measured and rejected (each on the same sets):

| Hypothesis | Result |
|---|---|
| `RRF_K` 5 / 10 / 20 / 30 / 60 | Identical ordering on all 18 queries — not shipped as a knob |
| `maxLen` 512 instead of 256 | +0.005 MRR, 2.1× indexing time, +1 GB RSS |
| Chunking 1000/100 instead of 1700/170 | Same 88.9 / 94.4 / 0.926 with 64% more chunks |
| Mean pooling instead of `sentence_embedding` | Bit-identical vectors for EmbeddingGemma (the head *is* mean pooling) |

### 3. verify-memory — anchor liveness

`scripts/verify-memory.mjs` (`npm run memory:verify`) indexes the repository once
(`git ls-files` + suffix map + line counts), then classifies every fact:
`verified` / `pending-merge` / `stale` / `no-anchor`, written to tags as
`state:<status>` plus `verified:<date>`. Ticket branches match by prefix (`DEV-1234-…`).
`--limit` and `--budget-ms` (default 120 s) bound a run; unreached facts are reported as
`skipped` and never written.

Run against the real `agent-memory` project (120 facts, ALB checkout):

| Status | Count |
|---|---:|
| verified | 27 (23%) |
| pending-merge | 2 (2%) |
| stale | 0 |
| no-anchor | 91 (76%) |
| duration | 6.7 s |

Two false-positive classes were removed before trusting the output: bare filenames in prose
(`article-compact.md`) and illustrative paths outside the repo's top-level directories
(`/tmp/x.php`) are now *weak* anchors — they can confirm a fact but never make it stale.
Without that rule the same run reported 19 stale facts. `--write` was exercised on a copy
(`/tmp/kb-verify-demo`, 8 facts → `state:verified` / `state:no-anchor`); the real memory
store was not mutated.

### 4. Regression evidence

| Check | Result |
|---|---|
| `npm test` | 250 files, **2941 passed** (2914 existing + 27 new) |
| `npm run test:types` | clean |
| `tests/cold-start.test.ts` | median 384 ms (hard-fail 2000 ms) |
| `EMBEDDINGS_MODE=none` | warmup `disabled`, search 196 ms, RSS 122 MB |
| GPU path | host has a GTX 1070 but no CUDA runtime libs → adapter initialises via CPU fallback, no crash, timings equal to CPU |
| `npm run backlog:check` | 297 total / 235 done / 61 pending |

## What is left

1. **Per-language gate is met only on the full set.** The 80% top-1 criterion holds on all
   2024 entries (81.5–83.6%), but not on small slices (a 200-entry slice gave TR 73%, a
   120-entry slice gave 73–78% everywhere). Any future regression gate must run the full
   set (~35 min on CPU) or use a slice large enough to be representative — otherwise it
   will report false failures.
2. **Warmup cost on CPU.** 40 s for 146 chunks means the default 180 s budget covers
   roughly 600 docs. Beyond that the rest is indexed on demand and the first search is slow
   again (47.7 s at a 5 s budget). Persisted cache makes a warm start cheap (1.8 s);
   GPU would cut indexing roughly 500× but is unavailable here.
3. **CUDA path is unverified.** Only the CPU fallback could be exercised in this sandbox;
   the fallback itself works and is covered by the probe.
4. **verify-memory is L1 only.** Semantic drift is still manual; 76% of the sampled facts
   have no strong anchor, which is expected for pattern facts but means the status alone
   is not a trust signal — it is a pointer to which facts need a human look.
5. **Dataset gap.** `multilingual_labels.json` has empty values for every `pl` entry, so
   Polish is not measured at all.

## Addendum — Granite Embedding 311M Multilingual R2 (evaluated 2026-10-20)

UltraBERT (dmis-lab, 2026-10-14) was checked first and rejected without a benchmark:
its model card declares **English only** (text and code), so it cannot serve the RU half
of the base. `ibm-granite/granite-embedding-311m-multilingual-r2` is the relevant
candidate instead: 200+ languages, Apache 2.0, ONNX weights, 768d, 32K context,
**CLS pooling**, no instruction prefixes.

Same 146-chunk fixture and 18 queries; Gemma was re-measured on the rebuilt fixture first
(88.9 / 94.4 / 0.926 — identical to the numbers above), so the comparison is same-day
and same-data. Granite used the quint8 AVX2 ONNX export (298 MB).

| Metric (146 docs, CPU) | Gemma q4 (256) | Granite q8 (256) | Granite q8 (512) |
|---|---:|---:|---:|
| hit@1 | **88.9%** | 83.3% | 83.3% |
| hit@3 | **94.4%** | 88.9% | 88.9% |
| MRR | **0.926** | 0.869 | 0.869 |
| RU hit@1 | **66.7%** | 50.0% | 66.7% |
| EN / code hit@1 | 100 / **100%** | 100 / 100% | 100 / 83.3% |
| Indexing 146 docs | 40.2 s | 46.8 s | 108.0 s |
| First search after warmup | **100 ms** | 135 ms | — |
| Warm query | 74–102 ms | **36–91 ms** | 49 ms |
| RSS | 1,582 MB | **1,066 MB** | 1,504 MB |

Verdict: **Granite stays out of the defaults.** At the same 256-token window it is 1.5×
lighter in RAM and faster per query, but loses 5.6 pp hit@1 and 16.7 pp on RU; restoring
RU parity requires the 512-token window, which costs 2.5× the indexing time and still
loses overall. It remains a documented fallback for Apache-2.0-only deployments and for
RAM-constrained hosts.

To make this measurable at all, the adapter learned **CLS pooling**: the mode is
auto-detected from the model's `1_Pooling/config.json` (Granite ships
`pooling_mode_cls_token: true`) and can be forced with `EMBEDDINGS_POOLING=cls|mean|model`.
Without it every Granite vector would have been mean-pooled — silently wrong.

Reproducibility caveat: the gold-field and multilingual-label fixtures used earlier in
this report lived under `/tmp` and were lost when it was cleaned. `scripts/field-eval.mjs`
takes `--gold` / `--labels`, so the judge is fine, but the gate cannot be re-run until the
sets are rebuilt and committed — tracked as KE-06.
