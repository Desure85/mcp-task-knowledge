# TR-04 — Test Quality Audit: "Tests That Lie"

**Date:** 2026-09-12
**Scope:** all `*.test.ts` / `*.spec.ts` in `tests/` (118 files, ~23k LOC) and `src/` (76 files, ~13.6k LOC) — 194 files total.
**Method:** 5 parallel deep-read audit slices; every file in `tests/` and `tests/e2e-full/` was read in full; `src/` was deep-read for `src/__tests__/`, `src/core/`, `src/obsidian/__tests__/` and all heavy-mock files, remaining ~50 `src/` specs skimmed via test titles + weak-assert cross-check (marked confidence=low).

## Headline numbers

| Signal | Count |
|---|---|
| Test files audited | 194 |
| Weak-assert calls (`toBe(true)`/`toBeTruthy`/`toBeDefined`/`toBeInstanceOf`) | 858 |
| Mock-related lines (`vi.fn`/`vi.mock`/`vi.spyOn`/mock) | 182 |
| Literal tautologies found | 4 (`jwt-validator:787`, `memory-extended:304`, `config.test.ts:332`, plus hand-built-envelope files) |
| Files scored TAUTOLOGICAL | 5 |
| Files scored MOCK-DRIFT | 2 |
| Files scored WEAK | 24 |
| Files scored GOOD | ~163 |

**Verdict:** the suite is much healthier than the "AI-generated" hypothesis suggested — ~84% of files exercise real code with behavioural asserts. The rot is concentrated: a handful of files test *copies* of the implementation, hand-build the envelopes they then assert, or assert only `ok:true` shape. The recently-modified security stack (auth-gate, method-gate, safe-paths, session-manager, realtime-auth, security-stack, e2e aud-crit-security) is **genuinely tested** — real 401/-32001 denies, disk-level traversal proof, WS close 4001 on the wire.

## Score legend

- **GOOD** — real implementation under test, behaviour asserted, negative paths covered.
- **WEAK** — real code runs but assertions are shape-only / happy-path-only / under-specified.
- **TAUTOLOGICAL** — assertions cannot fail (self-equality, hand-built objects asserted, inline SUT copies).
- **MOCK-DRIFT** — the thing under test is re-implemented or bypassed; production code can break freely.

## Top 10 worst offenders

| # | File | Score | Problem | Evidence |
|---|------|-------|---------|----------|
| 1 | `tests/tasks_dag.test.ts` | TAUTOLOGICAL | Entire file tests **inline re-implementations** of `detectCycle`/`topoSort`/`buildDAG` ("mirrors src/storage/tasks.ts"), not the real module | lines 21–98 |
| 2 | `tests/openapi.test.ts` | MOCK-DRIFT | `zodToOpenApi` converter is **defined inside the test file**; production converter never imported — passes even if real code is deleted | lines 6–34 |
| 3 | `tests/markdown.test.ts` | MOCK-DRIFT | `_getToolHandler` returns `null` ("test storage functions directly"); export/import/roundtrip tests hand-roll slugify+matter+glob instead of invoking registered handlers | lines 53–59, 113–126, 500–557 |
| 4 | `tests/cli.tools_list.contract.test.ts` | TAUTOLOGICAL | Greps `src/index.ts` for `registerTool(` — but index.ts is a 22-line delegate (TD-001), zero matches guaranteed → always green, contract unenforced | lines 12–20 |
| 5 | `tests/jsonrpc-fuzz.test.ts` | TAUTOLOGICAL | `normalizeEnvelope` copy-pasted into the test (fuzzes a clone); property `threw \|\| result !== undefined` is always true | lines 16–31, 45 |
| 6 | `src/obsidian/__tests__/confirm.replace.e2e.test.ts` | TAUTOLOGICAL | Names claim "confirm=false rejected" but confirm gate lives in the tool layer the test bypasses; every assert is `toBeTruthy()`/`>=0` — unfalsifiable | lines 49, 51, 54, 58, 64, 69 |
| 7 | `tests/obsidian.export.smoke.cli-envelope.test.ts` + `tests/obsidian.import.smoke.cli-envelope.test.ts` | TAUTOLOGICAL | Hand-build `{ok,error}` envelope literals then assert them; "replace not confirmed" test never invokes the confirm gate | export: 46–68, 92–98; import: 52–69, 80–86 |
| 8 | `tests/e2e-full/memory-lifecycle.test.ts` | WEAK | ~30 calls asserting only `env.ok===true`; `temporal_query` after invalidate doesn't assert fact absence; `entity_search` on unseeded data | lines 82–83, 93 |
| 9 | `tests/chaos-shutdown.test.ts` | WEAK | Test named "restarts cleanly after SIGKILL" sends **SIGTERM** and never restarts the server | lines 134–145 |
| 10 | `tests/app-container.test.ts` | WEAK | "stop handles transport close errors" builds a throwing `badAdapter` then admits "can't directly set adapter" — error path never runs; `_setState` tests test the test helper | lines 109–139, 411–427 |

## Honourable mentions (fix lines, not files)

- `tests/jwt-validator.test.ts:787` — literal `expect(true).toBe(true)` in JWKS-cache test.
- `tests/e2e-full/memory-extended.test.ts:304` — `expect(ok===true || ok===false).toBe(true)` tautology; :328 `badSuite` test asserts `ok:true` for `suite:'all'`.
- `tests/memory-extract-async.test.ts:145` — `if (status==='completed') return;` silent-pass inside a failure test.
- `tests/embeddings.cache.test.ts:75–78` — LRU eviction test deliberately never asserts eviction.
- `tests/integration.test.ts:70–98` — asserts `DEFAULT_PROJECT==='mcp'` and that an inline zod schema "is defined"; zero product code.
- `tests/logging-middleware.test.ts:172–202` — truncation/maxDepth tests are assertion-free ("no crash = success").
- `tests/dashboard.test.ts:36–59` — named dashboard_* but re-implements grouping logic on storage; dashboard handlers uncovered.
- `tests/bm25.unit.test.ts:105–128` — k1/b params asserted by result count only; params could be dead code.
- `tests/ab.bandits.test.ts` — epsilon>0 exploration branch never exercised.
- `tests/knowledge.versioning.test.ts:15` — no DATA_DIR isolation; writes into real KNOWLEDGE_DIR.
- `tests/logger.test.ts:40–46` — "respects LOG_LEVEL" can't test LOG_LEVEL (singleton already built).
- `src/behavioral/fts-search.spec.ts:124` — "sanitizes special characters" asserts only `total>=0`.
- `src/proxy/resilience.spec.ts:135–143` — metric shape asserted, counters never checked.
- `tests/e2e-full/prompts-bulk.test.ts:69–73` — `bulk_close` result never inspected; closed status unverified.
- `tests/e2e-full/http-auth.test.ts:138` — `not.toBe(401)` passes on 500/400.
- `tests/e2e-full/http-observability.test.ts:80` — /metrics scraped without generating traffic first.
- `tests/obsidian.import.e2e.cli-server.test.ts:129` — confirmed import asserts only `typeof data === 'object'`.
- `tests/obsidian.roundtrip.test.ts:67–78` — roundtrip verifies existence, not content fidelity.
- `tests/prompts.build.test.ts:111–116` — filter cases assert `built===1`, filtered output never inspected.
- `tests/prompts.tools.registered.test.ts` — regex-scans source text, not runtime registration.
- `tests/stdio-transport.test.ts` — shape-only asserts; `connect()` never invoked.
- `tests/vector.adapter.guard.test.ts` — only negative guard branches.
- `tests/e2e-full/tasks-knowledge-search.test.ts:74–75` — negative search asserts `isError:false`, not empty results.
- `tests/e2e-full/bridge-config-relay.test.ts:82–84`, `dashboard-session-cluster.test.ts:42–48`, `tools-meta.test.ts:64–68` — ok:true-only asserts.
- `src/__tests__/config.spec.ts:38`, `project_list.spec.ts:21` — shared fixed `/tmp/mcp-data` path (parallel flakiness risk).
- `tests/tasks.move_subtree.test.ts:66–67` — duplicated `rejects.toThrow(/Cycle detected/)` (copy-paste).

## Security-critical files — verified GOOD

`sec003-auth-gate`, `aud01-method-gate`, `aud03-safe-paths`, `session-manager`, `realtime-auth`, `security-stack`, `session-tools`, `auth`, `a003-token-ttl`, `middleware`, `acl.unit`, `e2e-full/aud-crit-security`, `e2e-full/http-auth`, `e2e-full/http-sessions`, `e2e-full/tcp-transport`, `src/core/input-sanitizer`, `src/core/auth-protection`, `src/core/secret-manager`, `src/core/oauth` — all assert real rejection (401, isError, -32001, close-4001, PathValidationError, on-disk audit entries, disk-level traversal proof). No mock-drift in the security slice.

## Per-file score table (non-GOOD only; everything else = GOOD/keep)

| File | Score | Recommendation |
|---|---|---|
| tests/tasks_dag.test.ts | TAUTOLOGICAL | **delete** (real fns covered by tasks.unit.test.ts:494–668) or rewire to real imports |
| tests/openapi.test.ts | MOCK-DRIFT | **rewrite** importing real converter, or delete |
| tests/markdown.test.ts | MOCK-DRIFT | **rewrite** to invoke `registerMarkdownTools` handlers |
| tests/cli.tools_list.contract.test.ts | TAUTOLOGICAL | **rewrite**: scan `src/register/*.ts` or call live `tools/list` |
| tests/jsonrpc-fuzz.test.ts | TAUTOLOGICAL | **rewrite**: import real `normalizeEnvelope`; drop self-fuzz |
| src/obsidian/**tests**/confirm.replace.e2e.test.ts | TAUTOLOGICAL | **rewrite** through tool layer or **delete** (siblings cover plan/exec) |
| tests/obsidian.export.smoke.cli-envelope.test.ts | TAUTOLOGICAL | **delete** — duplicated by real `*.e2e.cli-server.test.ts` |
| tests/obsidian.import.smoke.cli-envelope.test.ts | TAUTOLOGICAL | **delete** — same |
| tests/e2e-full/memory-lifecycle.test.ts | WEAK | **rewrite** — assert data, not just `env.ok` |
| tests/chaos-shutdown.test.ts | WEAK | fix test body (SIGKILL + actual restart) or rename |
| tests/app-container.test.ts | WEAK | fix :411 (inject failing adapter or drop); drop _setState self-tests |
| tests/integration.test.ts | WEAK | replace :70–98 with real registration asserts |
| tests/logging-middleware.test.ts | WEAK | capture log sink; assert truncation output |
| tests/dashboard.test.ts | WEAK | rewrite against dashboard_* handlers or rename file |
| tests/memory-extract-async.test.ts | WEAK | remove silent-pass branch :145 |
| tests/embeddings.cache.test.ts | WEAK | assert eviction via memory-only stats |
| tests/logger.test.ts | WEAK | resetModules for env test; drop no-throw asserts |
| tests/bm25.unit.test.ts | WEAK | assert score ordering differs across k1/b |
| tests/ab.bandits.test.ts | WEAK | add epsilon>0 exploration case |
| tests/knowledge.versioning.test.ts | WEAK | add TMP DATA_DIR isolation |
| tests/memory-perf.test.ts | WEAK | keep as benchmark; don't count as regression gate |
| tests/obsidian.import.e2e.cli-server.test.ts | WEAK | assert `knowledgeImported`/`tasksImported` counts :129 |
| tests/obsidian.roundtrip.test.ts | WEAK | verify content/hierarchy survived roundtrip |
| tests/prompts.build.test.ts | WEAK | inspect filtered output in filter cases |
| tests/prompts.tools.registered.test.ts | WEAK | keep (cheap guard) — note it asserts source text |
| tests/stdio-transport.test.ts | WEAK | keep (e2e covers connect) |
| tests/type-check.test.ts | WEAK | keep — compile-time `satisfies` guards by design |
| tests/vector.adapter.guard.test.ts | WEAK | extend: positive path + bad-model error |
| src/behavioral/fts-search.spec.ts | WEAK | strengthen :124 (assert sanitized query/non-total) |
| src/proxy/resilience.spec.ts | WEAK | assert counter increments :135–143 |
| src/audit/logger.spec.ts | WEAK (low conf.) | keep; minor toBeDefined clusters |
| e2e-full: memory-extended, prompts-bulk, http-auth, http-observability, tasks-knowledge-search, bridge-config-relay, dashboard-session-cluster, tools-meta | WEAK | line-level fixes listed above |

## Recommended BACKLOG tasks

| Suggested ID | Task | Priority |
|---|---|---|
| TR-04a | Delete `tasks_dag.test.ts`, `obsidian.*.smoke.cli-envelope.test.ts` (×2); rewire or delete `confirm.replace.e2e.test.ts` | high |
| TR-04b | Rewrite `openapi.test.ts` and `markdown.test.ts` to exercise real modules/handlers | high |
| TR-04c | Rewrite `cli.tools_list.contract.test.ts` (scan `src/register/` or live `tools/list`) and `jsonrpc-fuzz.test.ts` (import real `normalizeEnvelope`) | high |
| TR-04d | Rewrite `e2e-full/memory-lifecycle.test.ts` to assert data, not envelope shape | medium |
| TR-04e | Line-level fixes batch: jwt-validator:787, memory-extended:304/328, memory-extract-async:145, embeddings.cache:75, chaos-shutdown:134, app-container:411, integration:70–98, logging-middleware:172–202, prompts-bulk:69, http-auth:138, fts-search:124, resilience:135 | medium |
| TR-04f | Coverage gaps: dashboard_* handlers, confirm-gate at tool layer, ab.bandits epsilon>0, bm25 param sensitivity, vector.adapter positive path | medium |
| TR-04g | Test hygiene: TMP DATA_DIR isolation for knowledge.versioning + src/**tests** shared `/tmp/mcp-data`; extract shared http/tcp e2e harness (~200 duplicated lines across 6 files) | low |

## Notes

- e2e harness (`tests/e2e-full/harness.ts`) spawns the **real** `dist/index.js` over stdio with isolated tmp DATA_DIR — no mock-drift at e2e level.
- `src/` mocks are confined to true boundaries (fetch, MCP SDK, ToolInvoker) — exemplary pattern in `connectors/real-apis.spec.ts`, `workflows/executor.spec.ts`, `core/input-sanitizer.spec.ts`.
- ~50 `src/` spec files were skimmed (confidence=low); none showed red flags in titles/weak-assert cross-check, but a full deep-read pass could be a follow-up if TR-04a–g land.
