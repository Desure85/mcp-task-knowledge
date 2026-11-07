# История сессий агента (архив AGENTS.md §8)

> Перенесено из `AGENTS.md`, раздел «Текущее состояние сессии», 2026-11-07 (P-20261107-9).
> Текст сохранён дословно: сессии 2026-08-28 … 2026-10-31, список PR #100-#173 и прежние планы «Что дальше».

### Сессия ses_e6cd1f9fcffes9PwNIHtPttsF7 (UI-34 DESIGN.md и стражи дизайна, 2026-10-31)

- `DESIGN.md` в корне: обязательное чтение до правки `web-ui/`, принципы A+B+C, две оси темы, каталог
  примитивов, контракт страницы и состояний, доступность AA, запреты, процесс добавления, журнал решений
  владельца (2026-10-31) и известный долг.
- `scripts/gen-design-doc.mjs` + `npm run design:doc`: генерирует таблицу токенов из `app/globals.css` и
  `lib/theme.ts` и каталог примитивов из `components/ui/index.ts` (первая строка JSDoc). Блоки между
  маркерами; руками не правятся.
- Тесты: `web-ui/lib/design-doc.test.ts` (расхождение документа с кодом) и `web-ui/lib/design-guards.test.ts`
  (нативные диалоги, голые контролы, контракт страницы). Allowlist'ы — реестр долга: устаревшая запись роняет тест.
- `CLAUDE.md` в корне импортирует `AGENTS.md`, добавляет обязательный `DESIGN.md` и приоритет правил проекта
  над внешними скиллами. `web-ui/README.md` и `docs/features/web-ui.md` ссылаются на `DESIGN.md` вместо
  копии правил.
- Страницы не переписывались: нарушения (собственные `h1` в Knowledge/Prompts, нативные контролы) внесены в
  allowlist как долг UI-11/UI-15/UI-16 и перечислены в `DESIGN.md` §10.

### Сессия ses_e72dfcc40ffezuSMVsJt9RRyXI (V-01/V-02 statuses and transitions, 2026-10-31)

- `src/workflow.ts`: `ProjectStatus`/`ProjectWorkflow`, default four statuses, legacy `blocked`, validation of status ids/categories/transitions and done reachability.
- `src/workflow-service.ts`: `project_statuses_get/set` and `project_transitions_get/set`; status removal is atomic under `withFileLock`, supports `moveTo`/`moves` and reports up to 20 task ids.
- `src/projects.ts`: workflow fields in `.project.json`, `updateProjectMeta` serialized; `src/storage/tasks.ts`: status/transition checks on create/update/close and per-project close target.
- Dashboard/briefing/DAG count by category; bulk update/close return per-task `failed` entries. Client adds `api.projects.statuses/transitions` and `ToolCallError.code`.
- Tests: `tests/project-statuses.test.ts` (5), `tests/task-transitions.test.ts` (5), `tests/project-statuses-concurrency.test.ts` (1); live web-ui client test 5 passed. API reference regenerated.

### Сессия ses_e72dfcc40ffezuSMVsJt9RRyXI (Node.js 24 + CI hygiene, 2026-10-30)

- Node 20 EOL: обновлены все workflow (12 файлов), Dockerfile (базовые образы, NodeSource 24.x, proxy-stages), web-ui/Dockerfile, compose-файлы, docs/README/CONTRIBUTING/AGENTS; `engines.node >=22.0.0`, добавлен `.nvmrc=24`.
- Версии Actions перенесены из dependabot-PR (#194/#195/#199/#200/#202/#203/#210) единым изменением: checkout v7, setup-node v7, upload-artifact v7, docker/login 4.6.0, setup-buildx 4.3.0, build-push 7.3.0, setup-qemu 4.3.0. Inputs сверены по `action.yml` — используемые не изменились; checkout v7 ломает только `pull_request_target`/`workflow_run` (в репозитории их нет).
- Проверка нативных модулей на Node 24 (ABI 137): better-sqlite3 12.11.1 и onnxruntime-node 1.30.0 загружаются; полный `npm test` зелёный (259/3026), web-ui tsc — 0 ошибок, docker build проходит (в образе Node 24).
- Гейт для CI: `mcp-node:24-bullseye|alpine` ещё не опубликованы в GHCR (20-е есть) — перед мержем нужно вручную запустить `docker-build-base` (workflow_dispatch), иначе push-сборка баз упадёт на отсутствующем BASE_NODE_IMAGE.
- Флейк окружения: `chaos-shutdown` падает по таймауту SIGTERM, если порт 4001 занят чужим/осиротевшим процессом; при свободном порте и `--maxWorkers=4` полный прогон зелёный. Это не регрессия Node 24 (ручной SIGTERM — exit 0 за 14 мс).

### Сессия ses_e72dfcc40ffezuSMVsJt9RRyXI (остаток аудита AUD-11..16 + TR-16, 2026-10-30)

- AUD-11..16 в BACKLOG числились `pending`, хотя код фиксов и тесты уже были в master. Для каждого пункта сделан revert-check (откат именно фикса → тест падает): AUD-11 (4 теста), AUD-12 (2), AUD-13 (4), AUD-14 (leak после failed init), AUD-15 (phantom WS-сессия), AUD-16 (eviction и persist по отдельности). Статусы → done со ссылками на тесты.
- **Вакуумные тесты найдены и исправлены** (тест зелёный без фикса = ложное покрытие): AUD-14 проверял только `remote` truthy — FIFO-очередь его проходила; переписан на два loopback-IP (`127.0.0.1`/`127.0.0.2`) + сценарий «failed init с чужого IP → следующий init не наследует remote». AUD-15 тестировал `validateToken()` на собственной проводке; добавлен реальный `/ws` handshake через `HttpTransportAdapter` с проверкой `authenticatedCount === 0`. AUD-16 тест «not FIFO» имел порядок вставки == порядку exp; переставлен (long-lived вставляется первым).
- TR-16: `trustLevel` (`system`|`user`|`external`) в frontmatter knowledge-доков и memory-фактов (createDoc, import_single/import_markdown, bulk_create/update, extraction, temporal graph, async bulk_import). Egress: для `external` дополнительно применяются `EXTERNAL_PATTERNS` (active HTML, `javascript:`/`data:text/html`, fetch/curl, beacon-image); annotate-блок помечается `[EXTERNAL UNTRUSTED CONTENT]`, исходный JSON-блок не меняется. Тесты: `tests/tr16-trust-level.test.ts` (15).
- Решение владельца требуется: несколько админов (хранилище пользователей, хеши, UI) — НЕ реализовано, только предложение в отчёте сессии.

### Сессия S-20261030-prodaudit (аудит production-readiness, ветка audit/prod-readiness)

- Baseline master: build ok, 2957 тестов зелёные. Найдено и закрыто: AUD-18a (path traversal `userId` в ProfileManager, в т.ч. delete), AUD-18b (неатомарная запись memory/sync-хранилищ), AUD-18f (`writeText`). Попутно: `deleteProfile` использовал `require` в ESM и всегда возвращал false.
- Расхождения доки с кодом: живой `tools/list` = 116 (118 с catalog + dynamic tools), доки говорили 100/101/76/114; `scripts/api-reference.mjs` обрезал список на 100 (нет пагинации) — исправлено; битая ссылка на `docs/api/reference.md`; в BACKLOG AUD-08/09/17 числились pending при реализованном коде.
- Продолжение (ветка feat/admin-login-prod = web-ui WIP + аудит): живые пробы AUD-04/05/06/07 зелёные (tests/e2e-full/aud-high-security.test.ts); AUD-18c закрыт (`withFileLock`; tmp-имя writeJson коллидировало в одну мс → ENOENT); AUD-18d латентен (EventLog не подключён). Админка: `/login`, гард маршрутов (AppShell), выход, `/access` (claims, токен, одноразовые setup-ссылки); баг `serverInfo.version = 0.0.0` (читался несуществующий `_implementation`).
- BREAKING (клиентов нет, 2026-10-30): `SECURITY_STACK` теперь включён по умолчанию (выкл. `0|false|off`); санитайзер и egress-скан остаются opt-in (`SECURITY_SANITIZER_MODE`, `SECURITY_EGRESS_MODE`) — при включении по умолчанию они портили frontmatter и ломали JSON-ответы.
- BREAKING (клиентов нет, 2026-10-30): память агента (`temporal-graph.json`, `profiles/`, `layers.json`) переехала из `~/.local/share/mcp-task-knowledge/` в `$DATA_DIR/memory/` — раньше `DATA_DIR` игнорировался: в Docker с томом память терялась при пересоздании контейнера, разные `DATA_DIR` делили одну память, e2e-тесты писали в `$HOME`. Автомиграции нет (она тащила бы тестовый мусор в каждый свежий каталог): перенос вручную `mkdir -p $DATA_DIR/memory && cp -r ~/.local/share/mcp-task-knowledge/{temporal-graph.json,profiles,layers.json} $DATA_DIR/memory/`.
- web-ui: выбор проекта переживает перезагрузку (localStorage + повторный `project_set_current` на новой сессии) и переключается из шапки; realtime показывает Offline после 3 неудач; `next start` не проксирует WebSocket → нужен `NEXT_PUBLIC_MCP_WS_URL`.
- Выход из админки отзывает JWT на сервере: токены входа несут `jti`, `POST /auth/logout` проверяет подпись и вызывает `revokeByJti` (персист в `DATA_DIR/.jwt-revoked.json`); подделанный токен ничего не отзывает. Несколько админов по-прежнему нет — один пользователь из `MCP_LOGIN_*`.
- Egress-скан включён по умолчанию в режиме `annotate` (TR-14): текст результата не меняется, при находках добавляется отдельный блок `⚠️ [UNTRUSTED CONTENT]`; `SECURITY_EGRESS_MODE=off|redact|block|warn`. Санитайзер по-прежнему opt-in.
- Флейк-источник: e2e-тесты с фиксированными счётчиками портов (chaos-shutdown берёт 4001) падают, если на порту завис чужой сервер; новые живые тесты используют порты от ОС.
- Не проверено и остаётся открытым: AUD-05/06/11/12/13/14/15/16, AUD-18c/d/e, TR-01/04/14/16/17. Статусы AUD-04/07 в таблице не менялись — нужна проверка e2e.

### Сессия ses_ea99b2472ffeIU0Jd5H493qwWg (Этап Q — KB hardening, 2026-10-20)

- Индексация выведена из запроса: `src/search/warmup.ts` (фоновый per-project прогрев, debounce, бюджет 180 с, `EMBEDDINGS_WARMUP=0` off) + `adapter.warmup()` + инкрементальный reindex по событиям `storage/knowledge-events.ts` + `project_set_current` прогревает проект. Первый `search_knowledge` после прогрева: 100 мс вместо 40 427 мс; ingest → indexed 453 мс.
- `ensureVectorAdapter` теперь делит один init-promise: поиск во время фонового прогрева не теряет vector-канал (иначе видел `vectorInitAttempted=true` без адаптера).
- **Найденные баги дефолтов:** авто-детект выбирал LaBSE `encoder.onnx` вместо Gemma (gold 52/78 vs 58/78, вне RU/EN 47–57% vs 69–78%); Gemma не получала instruction-префиксы; dim не выводился, т.к. `hidden_size` лежит в `text_config` (512), а реальный выход 768 — авто-конфиг молча падал в `EMBEDDINGS_MODE=none`. Всё трое исправлено, `EMBEDDINGS_DIM` стал опциональным (адаптер берёт длину реального вектора).
- Лексический floor по умолчанию 0.15 → 0.05: floor выбрасывал реальный RU-хит (confidence 0.06), docs hit@1 83.3% → 88.9%, RU 50% → 66.7%.
- Отклонено по замерам: RRF_K 5..60 (порядок не меняется), maxLen 512 (+0.005 MRR, 2.1× индексация, +1 ГБ RSS), чанкинг 1000/100 (та же точность при +64% чанков), mean-pooling (= sentence_embedding).
- `scripts/verify-memory.mjs` (`npm run memory:verify`): статусы verified/pending-merge/stale/no-anchor в теги, strong/weak анкоры (имена файлов в прозе и `/tmp/*` не делают факт stale), ветки тикета по префиксу, бюджеты `--limit`/`--budget-ms`. 120 фактов agent-memory против ALB: 27/2/0/91 за 6.7 с.
- Честный гэп: 40 с прогрева на 146 доках CPU; при базе больше бюджета остаток индексируется по требованию (первый поиск после частичного прогрева может быть медленным). CUDA-библиотек в песочнице нет — проверен только CPU-fallback.

### Сессия S-20260911-msec (Этап M фаза 1)

- PR #184 замерджен вручную в master (`5d64bc3`) — вся серия PH-001..015 на мастере
- AUD-01: `decideMethodCall` — общий method-level гейт; раньше resources/prompts/completion шли мимо auth на http+tcp
- AUD-02: все мутации из resources/read убраны; action-URI → `{ok:false,hint}` стабы
- AUD-03: `src/fs.ts` path-guards; permissive charset на storage (legacy id с пробелами/точками читаются), строгий regex — только на новых project_create

### Сессия S-20260911-e2ec (Q-014: добить e2e)

- Построена карта покрытия: до сессии e2e дёргал 45/114 инструментов; добавлены слайсы:
  - 15 `projects.test.ts` — project lifecycle (create→set_current→purge dryRun/confirm→delete force/идемпотентность)
  - 16 `tasks-bulk-dag.test.ts` — tasks_bulk_update/archive/trash/restore/delete_permanent + set_deps/get_deps/dag
  - 17 `knowledge-lifecycle.test.ts` — knowledge bulk lifecycle, tree, export_single/bundle/markdown, import_single, multimodal import, two-stage search
  - 18 `memory-extended.test.ts` — profiles, layers, scope_filter/tags, context_assemble, entity_search, temporal history/stats, evolve, conflicts, gc, observations, dream, async jobs (submit/status/cancel, extract_async), framework_adapter, benchmark
  - 19 `prompts-experiments.test.ts` — experiments/variants/bandit/metrics/feedback/ab_report/exports/catalog + bulk_update/delete
  - 20 `misc-surface.test.ts` — session_info/cluster degraded shapes, embeddings status/try_init, tool_help, graph_export_mermaid/graph_visualize, dashboard_trends, tools_run, relay share_brief/broadcast_rule
  - 21 `connectors-all.test.ts` — все 9 семейств коннекторов: регистрация по env-флагам (github/jira/slack требуют creds на init)
- **Баги, найденные e2e и исправлены:**
  - `src/register/setup.ts` — `REPO_ROOT` указывал на `dist/` в prod-сборке → prompts reindex (scripts/prompts.mjs) молча никогда не работал в prod; версия из package.json тоже не читалась
  - `src/register/memory.ts` — `memory_scope_filter` затирал `fact.scope` перед фильтрацией → любой dimension-фильтр всегда возвращал 0
  - `scripts/prompts.mjs` — `exportCatalog` не писал `metadata.status/domain/tags` → `prompts_list` по status/domain/tag никогда не матчился в prod-режиме
- harness: retry-обёртка rm в close() — orphan-подпроцессы реиндекса догоняли cleanup (ENOTEMPTY)
- Задокументированные гэпы: StreamableHTTP-сессии не трекаются SessionManager (session_list пуст после authenticate → session_info по живой сессии недостижим); scripts/ не входит в npm `files` (reindex не работает в установленном пакете)

### Последние действия (ночная сессия 2026-08-28/29, PR #119-#136)

- 2026-08-28: PR #119 — TD-010 Centralized error handling (ErrorCategory/ToolError/ErrorHandler/middleware)
- 2026-08-28: PR #120 — TD-011 Graceful degradation (CircuitBreaker→core, ServiceAvailability, withFallback, health-checks embeddings/catalog)
- 2026-08-28: PR #121 — TD-013 Test timing safety (session-manager 11 + rate-limiter 3 → vi.useFakeTimers)
- 2026-08-28: TD-014 WIP commit strategy (git wip alias + AGENTS.md 3.4)
- 2026-08-29: PR #122 — TD-012 Mock interface sync (tsconfig.test.json + tests/type-check.test.ts satisfies, fixed drift)
- 2026-08-29: PR #123 — Q-004 Core MCP E2E (tests/mcp-core-e2e.test.ts, stdio client)
- 2026-08-29: PR #124 — Q-005 Coverage threshold 80% (92.7% фактически)
- 2026-08-29: PR #125 — Q-008 JSON-RPC fuzzing (fast-check, нашёл -0 edge case в CI)
- 2026-08-29: PR #126 — Q-009 Chaos/shutdown (SIGTERM/SIGINT/SIGKILL, data integrity)
- 2026-08-29: PR #127 — Q-006 BM25 load tests (10k/50k, no-blowup)
- 2026-08-29: PR #128 — Q-007 Schema validation (ajv, draft-07+2020-12)
- 2026-08-29: PR #129 — BM-011 Behavioral dashboard (zero-dep HTML)
- 2026-08-29: PR #130 — P2 token-manager+a003 fake timers
- 2026-08-29: PR #131 — P1 flaky fixes (jwt nbf deterministic, SQLite таймауты 20s)
- 2026-08-29: PR #132 — AI-009 Wire ServiceAvailability (onVectorError + singleton registry)
- 2026-08-29: PR #133 — AI-008 Dashboard CLI (npm run dashboard)
- 2026-08-29: PR #134 — Q-012 Full test type-check (tsconfig.test.json → tests/**, 61 errors fixed)
- 2026-08-29: PR #135 — Q-013 Atomic writeJson (tmp+rename, ENOSPC-safe)
- 2026-08-29: PR #136 — AI-010 Schema drafts unified (draft-07)
- 2026-08-29: PR #137 — Q-010 Property-based core testing (fast-check)
- 2026-08-29: PR #138 — TD-008 ESM service-catalog import (ambient types)
- 2026-08-29: PR #139 — BM-012 LAN Relay (WS + AES-256-GCM + UDP multicast)
- 2026-08-29: PR #140 — TD-007 crypto.randomUUID (uuid dep dropped)
- 2026-08-29: PR #141 — Q-011 Wire format snapshots
- 2026-08-29: PR #142 — TD-006 JSDoc public functions
- 2026-08-29: PR #143 — D-005 Architecture diagram (Mermaid)
- 2026-08-29: PR #144 — D-001 API reference (76 tools, auto-gen)
- 2026-08-29: PR #145 — AI-004 BACKLOG CI validation
- 2026-08-29: PR #146 — AI-007 Agent performance tracking
- 2026-08-29: PR #147 — DX-007 Shared test factories
- 2026-08-29: PR #148 — DX-003 Dev CLI (diagnose/tools/sessions/export)
- 2026-08-29: PR #149 — DX-008 ESLint + Prettier
- 2026-08-29: PR #150 — DX-001 Hot tool registration
- 2026-08-29: PR #151 — DX-002 Wildcard filters
- 2026-08-29: PR #152 — DX-004 Hot config reload
- 2026-08-29: PR #153 — DX-005 ETag response cache
- 2026-08-29: PR #154 — TD-005 Knowledge versioning
- 2026-08-29: PR #155 — D-002 ADR (5 records)
- 2026-08-29: PR #156 — D-003 CONTRIBUTING + D-004 CHANGELOG
- 2026-08-29: PR #157 — AI-011 Claude Code plugin export (ADR-006)
- 2026-08-29: PR #158 — AI-012 Claude Code plugin import
- 2026-08-30: PR #159 — AI-013 Streaming progress notifications
- 2026-08-30: PR #160 — AI-015 Parallel tool batching
- 2026-08-30: PR #161 — AI-016 Rate-limit dashboard
- 2026-08-30: PR #162 — AI-014 OAuth 2.1 PKCE provider
- 2026-08-30: PR #163 — INT-004 Connector framework
- 2026-08-30: PR #164 — INT-001 GitHub connector
- 2026-08-30: PR #165 — INT-002 Jira + INT-003 Slack connectors
- 2026-08-30: PR #166 — SYNC-001/002 Protocol + SyncManager
- 2026-08-30: PR #167 — SYNC-003 3-way merge conflict resolver
- 2026-08-30: PR #168 — SYNC-004 Event sourcing + GC
- 2026-08-30: PR #169 — SYNC-005 E2E durability tests
- 2026-08-30: PR #170 — INT-005 REST wrappers + OpenAPI
- 2026-08-30: PR #171 — INT-006 gRPC wrappers
- 2026-08-30: PR #172 — OC-006 P2P sync setup
- 2026-08-30: PR #173 — OC-007 + OC-008 memory browser + config cleanup

### Что дальше

- **2026-09-11 (S-20260911-aud1):** аудит request-path (баги+секьюрити) → 17 находок в BACKLOG как Этап M (AUD-01..17) + AUD-18 (data-path аудит не проведён). Плюс Этап N — DX/Onboarding (DX-10..26): setup-wizard с идемпотентным merge клиентских конфигов, doctor, backup/restore DATA_DIR, agent_bootstrap/briefing/capabilities tools (только после design review — не регистрировать сырые), single-binary PoC, MCP Inspector CI. DX-ядро — после crit-фазы Этапа M. Плюс Этап O — Trust/Hardening (TR-01..13): аудиты prompt-injection через stored content, Web UI (уже подтверждён XSS в markdown-ссылках, TR-02), коннекторов/кредов, качества тестов; hardening: Docker root→non-root, dependabot+npm audit CI, privacy-декларация; governance: API-политика, MCP elicitation для confirm-флоу. Критичное: resources/read без auth + мутации через task://action (AUD-01/02), path traversal project/id (AUD-03), мёртвый security-стек — ACL/sanitizer/audit/auth-protection/rate-limit имеют 0 call sites (AUD-07), session expiry не прекращает доступ (AUD-05). Порядок: AUD-01+02+03 связанным инкрементом, затем AUD-07.
- BM-012 (LAN Relay, low, большая — mDNS+AES WebSocket, отдельный заход)
- Sync (5 pending), Tech Debt (3 pending: TD-005, TD-007, TD-008), Quality (3: Q-010, Q-011 + Q-012/013 done), Docs (5), Integration Hub (6), Web UI (7), OpenCode Integration (4+2)
- LoopX-цель: mcp-task-knowledge-goal (16 todo, 15 done)
- 2026-08-28: PR #100-#104 — SK-003..RL-005 (discovery, templates, policy, guardrails, enforcement)
- 2026-08-28: PR #105 — WF-005 state persistence; PR #106 — fix flaky knowledge test (monotonic updatedAt)
- 2026-08-28: PR #107 — WF-006 subflows (этап Workflows done 6/6)
- 2026-08-28: PR #108-#109 — SK-005 converters, SK-006 permissions (этап Skills done 6/6)
- 2026-08-28: PR #110-#111 — RL-004 rule packs, RL-006 rule import (этап Rules done 6/6)
- 2026-08-28: PR #112-#114 — MEM-002 entity graph, MEM-003 distillation, MEM-004 memory IO (этап Memory done 4/4)
- 2026-08-28: PR #115-#116 — BM-009 cross-project search, BM-010 guard rules auto-learning

### Что дальше

- BM-011 (Behavioral dashboard, low), BM-012 (LAN relay, low), BM-013 (Migration framework, high), BM-014 (FTS5 search, medium)
- Sync (5 pending), Tech Debt (10 pending), Quality (8), Docs (5), Integration Hub (6), Web UI (7), OpenCode Integration (4+2)
- WF-005..MEM-004 закрыли критический путь "SK-001 → WF-001 → WF-002"
