# TR-04 — аудит качества тестов («тесты, которые врут»)

**Статус проработки:** завершена 2026-11-06 на `0f717b6` (worktree `mcp-tk-tr04`, ветка `docs/tr04-test-audit`).

**Как читать этот документ.** Оценки GOOD / WEAK / TAUTOLOGICAL / MOCK-DRIFT из части 1 получены чтением кода и
являются гипотезами, а не доказательствами. Доказательство даёт только мутация: если тест остаётся зелёным при
сломанном модуле, он не наблюдает код. Часть 2 — машинный проход по всем файлам, часть 3 — 15 мутационных
экспериментов по кандидатам и 5 контрольных. Итог: 14 гипотез подтверждены, 2 опровергнуты, у одного теста
предмета в `src/` нет вовсе.

## Часть 1. Read-based проход 2026-09-12 — гипотезы

> Всё ниже — результат чтения файлов пятью параллельными проходами. Счётчики (`858 weak-assert`, `4 тавтологии`)
> получены глазами и регулярками по выдержкам, а не воспроизводимым прибором; оценки файлов не проверялись
> поломкой кода. Использовать как список гипотез для части 3, не как вердикт.

**Date:** 2026-09-12
**Scope:** all `*.test.ts` / `*.spec.ts` in `tests/` (118 files, ~23k LOC) and `src/` (76 files, ~13.6k LOC) — 194 files total.
**Method:** 5 parallel deep-read audit slices; every file in `tests/` and `tests/e2e-full/` was read in full; `src/` was deep-read for `src/__tests__/`, `src/core/`, `src/obsidian/__tests__/` and all heavy-mock files, remaining ~50 `src/` specs skimmed via test titles + weak-assert cross-check (marked confidence=low).

### Headline numbers

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

### Score legend

- **GOOD** — real implementation under test, behaviour asserted, negative paths covered.
- **WEAK** — real code runs but assertions are shape-only / happy-path-only / under-specified.
- **TAUTOLOGICAL** — assertions cannot fail (self-equality, hand-built objects asserted, inline SUT copies).
- **MOCK-DRIFT** — the thing under test is re-implemented or bypassed; production code can break freely.

### Top 10 worst offenders

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

### Honourable mentions (fix lines, not files)

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

### Security-critical files — verified GOOD

`sec003-auth-gate`, `aud01-method-gate`, `aud03-safe-paths`, `session-manager`, `realtime-auth`, `security-stack`, `session-tools`, `auth`, `a003-token-ttl`, `middleware`, `acl.unit`, `e2e-full/aud-crit-security`, `e2e-full/http-auth`, `e2e-full/http-sessions`, `e2e-full/tcp-transport`, `src/core/input-sanitizer`, `src/core/auth-protection`, `src/core/secret-manager`, `src/core/oauth` — all assert real rejection (401, isError, -32001, close-4001, PathValidationError, on-disk audit entries, disk-level traversal proof). No mock-drift in the security slice.

### Per-file score table (non-GOOD only; everything else = GOOD/keep)

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

### Recommended BACKLOG tasks

| Suggested ID | Task | Priority |
|---|---|---|
| TR-04a | Delete `tasks_dag.test.ts`, `obsidian.*.smoke.cli-envelope.test.ts` (×2); rewire or delete `confirm.replace.e2e.test.ts` | high |
| TR-04b | Rewrite `openapi.test.ts` and `markdown.test.ts` to exercise real modules/handlers | high |
| TR-04c | Rewrite `cli.tools_list.contract.test.ts` (scan `src/register/` or live `tools/list`) and `jsonrpc-fuzz.test.ts` (import real `normalizeEnvelope`) | high |
| TR-04d | Rewrite `e2e-full/memory-lifecycle.test.ts` to assert data, not envelope shape | medium |
| TR-04e | Line-level fixes batch: jwt-validator:787, memory-extended:304/328, memory-extract-async:145, embeddings.cache:75, chaos-shutdown:134, app-container:411, integration:70–98, logging-middleware:172–202, prompts-bulk:69, http-auth:138, fts-search:124, resilience:135 | medium |
| TR-04f | Coverage gaps: dashboard_* handlers, confirm-gate at tool layer, ab.bandits epsilon>0, bm25 param sensitivity, vector.adapter positive path | medium |
| TR-04g | Test hygiene: TMP DATA_DIR isolation for knowledge.versioning + src/**tests** shared `/tmp/mcp-data`; extract shared http/tcp e2e harness (~200 duplicated lines across 6 files) | low |

### Notes

- e2e harness (`tests/e2e-full/harness.ts`) spawns the **real** `dist/index.js` over stdio with isolated tmp DATA_DIR — no mock-drift at e2e level.
- `src/` mocks are confined to true boundaries (fetch, MCP SDK, ToolInvoker) — exemplary pattern in `connectors/real-apis.spec.ts`, `workflows/executor.spec.ts`, `core/input-sanitizer.spec.ts`.
- ~50 `src/` spec files were skimmed (confidence=low); none showed red flags in titles/weak-assert cross-check, but a full deep-read pass could be a follow-up if TR-04a–g land.

## Часть 2. Машинный проход 2026-11-06

### Прибор

`scripts/audit-tests.mjs` (Node, без зависимостей) обходит дерево по тем же правилам, что `vitest.config.ts`
(`**/*.{test,spec}.?(c|m)[jt]s?(x)`, исключены `node_modules`, `dist`, `web-ui`, `.opencode`, `service-catalog`),
и для каждого файла считает:

- **Чем тест достигает продакшн-кода**: прямой импорт `src/`, импорт `dist/`, `scripts/`, подпроцесс
  (`spawn`/`execFile`, в том числе `promisify(execFile)` и путь через `path.join(..., 'scripts', ...)`),
  HTTP, только файловые операции, ничего. Импорты прослеживаются через локальные хелперы (глубина 2), потому что
  `tests/e2e-full/*` ходят в сервер через `tests/e2e-full/harness.ts`.
- **Импорты только типа** (`import type`) не считаются достижением кода: они стираются при сборке.
- **Метрики ассертов**: число `expect(`, доля `toBeTruthy`/`toBeFalsy`/`toBeDefined`/`toBeInstanceOf`,
  тавтологии (`expect(true).toBe(true)`, `expect(x).toBe(x)`, точное дополнение `x === true || x === false`),
  тесты без единого ассерта, моки на собственный предмет (`vi.mock` по пути в `src/`, файл существует).

Рейтинг — это **кандидаты**, не вердикт. Прибор не видит: импорт через переменную (`const P = '../config.ts'`),
обёртки вокруг `spawn`, ассерты на собранный вручную объект, хелперы-ассерты, зеркала логики. Поэтому вердикт
даёт только часть 3.

### Калибровка прибора

Прибор сам проверяется known-answer тестом `src/__tests__/audit-tests.test.ts` (13 проверок). Синтетическое дерево
строится в `os.tmpdir()` (не в репозитории, иначе vitest подхватил бы фикстуры как настоящие тесты) и содержит
файлы с заранее известным ответом: честный импорт, импорт через barrel-хелпер, подпроцесс через `path.join`,
подпроцесс через `promisify(execFile)`, спавн `dist/index.js` из хелпера, встроенная копия предмета, литеральная
тавтология, точное дополнение, настоящая дизъюнкция (не должна считаться тавтологией), мок собственного предмета,
тест без ассертов, импорт через переменную. Проверка: `npx vitest run src/__tests__/audit-tests.test.ts`.

### Результат по 272 файлам

| Вердикт | Файлов |
|---|---|
| OK | 204 |
| E2E (код достигнут через подпроцесс/HTTP) | 46 |
| NO-SUT (продакшн-код не достигнут) | 11 |
| NO-ASSERT (есть тесты без ассертов) | 8 |
| TAUTOLOGY | 2 |
| WEAK-SHAPE (только форма, ≥80% слабых ассертов) | 1 |

Сырой вывод: `node scripts/audit-tests.mjs --json` (или `--top N` для таблицы). Кандидаты с ненулевым рейтингом:

| Рейтинг | Файл | Вердикт | Достижение | Тестов | expect | Причина |
|---|---|---|---|---|---|---|
| 50 | tests/cli.tools_list.contract.test.ts | NO-SUT | fs-only | 1 | 1 | продакшн-код не достигнут |
| 50 | tests/jsonrpc-fuzz.test.ts | NO-SUT | none | 8 | 15 | продакшн-код не достигнут |
| 50 | tests/openapi.test.ts | NO-SUT | none | 9 | 16 | продакшн-код не достигнут |
| 50 | tests/prompts.tools.registered.test.ts | NO-SUT | fs-only | 1 | 1 | продакшн-код не достигнут |
| 50 | tests/schema-validation.test.ts | NO-SUT | fs-only | 14 | 20 | продакшн-код не достигнут |
| 50 | tests/transport-wire-snapshots.test.ts | NO-SUT | none | 7 | 10 | продакшн-код не достигнут |
| 37 | tests/jwt-validator.test.ts | TAUTOLOGY | direct-src | 75 | 109 | тавтологии (1), тест без ассертов (1/75) |
| 35 | `src/__tests__/config.spec.ts` | NO-SUT | none | 4 | 7 | импорт через переменную (см. границы) |
| 35 | `src/__tests__/project_list.spec.ts` | NO-SUT | fs-only | 2 | 6 | импорт через переменную |
| 35 | tests/embeddings.cache.test.ts | NO-SUT | none | 3 | 7 | импорт через переменную |
| 35 | tests/tasks_dag.test.ts | NO-SUT | none | 18 | 28 | импорт только типа |
| 35 | tests/vector.adapter.guard.test.ts | NO-SUT | none | 2 | 2 | продакшн-код не достигнут |
| 32 | tests/e2e-full/memory-extended.test.ts | TAUTOLOGY | subprocess-dist | 9 | 73 | тавтология (1) |
| 20 | tests/logging-middleware.test.ts | NO-ASSERT | direct-src | 24 | 26 | тесты без ассертов (4/24) |
| 15 | tests/type-check.test.ts | WEAK-SHAPE | direct-src | 5 | 5 | только форма (100%) |
| 5 | src/transport/tls.spec.ts, tests/realtime.spec.ts, tests/session-manager.test.ts, tests/stream-transport.test.ts, tests/transport.test.ts, tests/e2e-full/aud-crit-security.test.ts, tests/devcycle-next.test.ts | NO-ASSERT | mixed | — | — | по одному тесту без ассерта |

Файлы, которые прибор пометил как NO-SUT, но которые **достигают кода через подпроцесс** (проверено вручную):
`tests/devcycle-state.test.ts`, `tests/devcycle-next.test.ts`, `tests/executable-docs.test.ts` — они запускают
`scripts/devcycle.mjs` и `scripts/executable-docs.mjs`. Это класс ложных срабатываний, который прибор теперь
ловит (`path.join(..., 'scripts', ...)` и `promisify(execFile)`), и он закреплён фикстурами.

## Часть 3. Мутационный эксперимент

### Протокол

Для каждого кандидата:

1. Прогон **только этого** тест-файла до мутации (baseline). Красный baseline — файл исключается из эксперимента.
2. Точечная мутация в модуле, который тест заявляет как предмет: смена оператора, возвращаемого значения или
   полезной нагрузки. Мутация должна менять то, что тест обязан заметить.
3. Прогон того же файла после мутации.
4. Откат: `git checkout -- <файл>`, затем проверка `git status --short` по этому файлу (пусто).
5. Для тестов, которые спавнят `node dist/index.js`, мутируется `src/`, затем `npm run build` в этом worktree;
   после отката — пересборка. Чужой `dist` не трогается.

### Семантика «красный/зелёный»

- **Кандидат**: GREEN → GREEN = тест не наблюдает предмет (врёт, гипотеза подтверждена). GREEN → RED = тест
  наблюдает предмет (гипотеза опровергнута). RED baseline = исключён.
- **Контроль** (5 случайных файлов, которые считаются здоровыми): GREEN → RED = мутация эффективна, эксперимент
  валиден. GREEN → GREEN = мутация эквивалентна или неэффективна; переделать мутацию, тест не обвинять.

### Таблица

| # | Тест | Мутация | До | После | Вывод |
|---|---|---|---|---|---|
| K1 | tests/tasks_dag.test.ts | `buildDAG` в `src/storage/tasks.ts` больше не строит рёбра | GREEN | GREEN | **врёт**: файл тестирует собственные копии `detectCycle`/`topoSort`/`buildDAG`; реальных `detectCycle`/`topoSort` в `src/` нет |
| K2 | tests/openapi.test.ts | `zodToOpenApi` в `src/register/openapi.ts` возвращает `{}` | GREEN | GREEN | **врёт**: конвертер определён внутри теста, настоящий не импортируется |
| K3 | tests/markdown.test.ts | имя первого инструмента в `registerMarkdownTools` изменено | GREEN | GREEN | **врёт про tool-слой**: регистрация вызывается, но обработчики не выполняются, ассерты идут по storage |
| K4 | tests/cli.tools_list.contract.test.ts | `tasks_list` переименован в `src/register/tasks.ts` | GREEN | GREEN | **врёт**: регэксп читает 22-строчный делегат `src/index.ts`, реальная регистрация не проверяется |
| K5 | tests/jsonrpc-fuzz.test.ts | мутация невозможна: `normalizeEnvelope` в `src/` отсутствует | — | — | **предмета нет**: `git grep normalizeEnvelope src/` пуст, файл фаззит собственную копию |
| K6 | `src/obsidian/__tests__/confirm.replace.e2e.test.ts` | confirm-гейт импорта в `src/register/obsidian.ts` отключён | GREEN | GREEN | **врёт**: тест вызывает `importProjectFromVault` напрямую, гейт tool-слоя не задействован; название обещает «confirm=false rejected», тело утверждает обратное |
| K7 | tests/obsidian.export.smoke.cli-envelope.test.ts | `knowledgeCount` в `exportProjectToVault` = −1 | GREEN | GREEN | **врёт про данные**: конверт собран в тесте, у реального результата проверяется только `typeof` |
| K8 | tests/obsidian.import.smoke.cli-envelope.test.ts | план импорта: `creates.knowledge += 1000` | GREEN | GREEN | **врёт про данные**: счётчики плана проверяются только по типу |
| K9 | tests/e2e-full/memory-lifecycle.test.ts | `memory_temporal_query` возвращает `facts: []` при `ok:true` | GREEN | GREEN | **врёт про данные**: 30 вызовов проверяют конверт, полезная нагрузка не проверяется |
| K10 | tests/app-container.test.ts | `stop()` стал no-op | GREEN | RED | гипотеза о `stop()` **опровергнута**: тест его наблюдает |
| K10b | tests/app-container.test.ts | ошибка закрытия транспорта в `stop()` стала фатальной (`throw`) | GREEN | GREEN | **врёт про заявленную ветку**: путь ошибки транспорта не исполняется ни разу |
| K11 | tests/dashboard.test.ts | `filterByDateRange` возвращает `[]` | GREEN | GREEN | **врёт про обработчики**: `dashboard_*` не вызываются, проверяется группировка на storage |
| K12 | tests/jwt-validator.test.ts | `jwksCacheTtl` по умолчанию 300000 → 0 | GREEN | GREEN | **врёт про кеш**: TTL JWKS-кеша не проверяется (строка `expect(true).toBe(true)` — лишь симптом) |
| K13 | tests/bm25.unit.test.ts | `k1` по умолчанию 1.5 → 0.1 | GREEN | GREEN | **врёт про параметры**: k1/b влияют на счёт, но тест проверяет только число результатов |
| K14 | tests/ab.bandits.test.ts | ветка исследования отключена (`Math.random() < 0`) | GREEN | GREEN | **врёт про ветку**: `epsilon > 0` не исполняется |
| K15 | tests/prompts.tools.registered.test.ts | `prompts_catalog_get` переименован в `src/register/helpers.ts` | GREEN | RED | гипотеза «всегда зелёный» **опровергнута**: текстовый контракт реагирует на переименование, но остаётся проверкой текста, а не рантайма |
| K16 | tests/embeddings.cache.test.ts | вытесняется самый новый элемент вместо самого старого | GREEN | GREEN | **врёт про вытеснение**: тест не проверяет, какой элемент выжил |
| N1 | tests/schema-validation.test.ts | `scripts/validate-schemas.mjs` завершается с кодом 1 | GREEN | GREEN | **новое**: файл зеркалит логику скрипта, сам скрипт не запускается (проверено: мутированный скрипт возвращает 1) |
| C1 | tests/session-manager.test.ts | истечение сессии отключено | GREEN | RED | контроль валиден |
| C2 | tests/transport.test.ts | `registry.get(type)` возвращает `undefined` | GREEN | RED | контроль валиден |
| C3 | src/transport/tls.spec.ts | `rejectUnauthorized` по умолчанию `false` | GREEN | RED | контроль валиден |
| C4 | tests/knowledge.versioning.test.ts | версия документа не инкрементируется | GREEN | RED | контроль валиден |
| C5 | tests/e2e-full/http-auth.test.ts | гейт авторизации пропускает всё | GREEN | RED | контроль валиден (см. границы: мутация типо-невалидна) |

### Итог эксперимента

- Подтверждено 14 гипотез (K1–K4, K6–K9, K10b, K11–K14, K16) — эти тесты зелёные при сломанном предмете.
- Опровергнуто 2 (K10, K15) — файл наблюдает хотя бы часть своего предмета.
- Предмета нет у 1 (K5).
- Новое подтверждено 1 (N1).
- Контроль: 5 из 5 красные, значит мутации были эффективны и методика отличает «врёт» от «не врёт».

## Часть 4. Что это значит для пунктов TR-04

| Пункт | Статус после эксперимента |
|---|---|
| TR-04a | Подтверждён: K1 (tasks_dag), K7/K8 (obsidian.*.smoke), K6 (confirm.replace). Удалять или переводить на реальные модули |
| TR-04b | Подтверждён: K2 (openapi). K3 (markdown) — уточнение: тест доходит до storage, лживая часть — tool-слой |
| TR-04c | Подтверждён: K4 (cli.tools_list). K5 (jsonrpc-fuzz) — сильнее, чем «клон»: функции нет в `src/` вовсе |
| TR-04d | Подтверждён: K9, полезная нагрузка не проверяется |
| TR-04e | Подтверждён и расширен: K12 (не только строка 787, но и весь JWKS-кеш), K13 (bm25), K14 (bandits), K16 (eviction), K10b (ветка ошибки транспорта). K15 — переформулировать: тест реагирует на переименование, но проверяет текст, а не рантайм |
| TR-04f | Частично: K11 (dashboard_*). `vector.adapter` и `confirm-gate` в tool-слое не мутировали — остаются гипотезами |
| TR-04g | Не проверялся мутацией: гигиена изоляции данных требует отдельного прогона |

## Часть 5. Новые подпункты

| ID | Задача | Почему |
|---|---|---|
| TR-04h | `tests/schema-validation.test.ts` — зеркало `scripts/validate-schemas.mjs` | N1: скрипт сломан (rc=1), тест зелёный. DoD: тест запускает скрипт и падает при `rc != 0`, либо зеркало удаляется |
| TR-04i | `tests/transport-wire-snapshots.test.ts` — контракт SDK, не нашего слоя | Нет импорта `src/`: проверяется `serializeMessage`/`deserializeMessage` из `@modelcontextprotocol/sdk`. DoD: либо перевести на наш wire-слой, либо пометить как контракт зависимости и не считать покрытием проекта |

## Часть 6. Границы проверки

- Мутированы 15 кандидатов и 5 контролей; `chaos-shutdown`, `vector.adapter.guard`, `type-check`, `logging-middleware`,
  `realtime.spec`, `stream-transport` в выборку не вошли — их оценки остаются гипотезами.
- Один baseline-прогон `tests/e2e-full/memory-lifecycle.test.ts` дал RED, но 3 последующих прогона и полный
  `npm test` — GREEN. Воспроизвести не удалось; вероятно, загрязнение состояния от предыдущих прогонов. Это
  отдельный риск изоляции, а не вывод о тесте.
- C5: `tsc` сообщает ошибки типов, но всё равно эмитит JS (`noEmitOnError` не выставлен), поэтому мутация попала в
  `dist`. Контроль валиден по поведению, но мутация типо-невалидна — для чистого эксперимента её нужно переписать.
- Мутации в `tests/**` не делались (запрещено поручением). `web-ui/**` и `service-catalog/**` вне области: первый
  исключён конфигом vitest, второй — отдельный пакет.
- Полный прогон: 272 файла, 3124 теста, GREEN (`npm test`, 43.7 с).
