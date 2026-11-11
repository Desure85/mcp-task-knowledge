# BACKLOG.md — Бэклог задач

> **Назначение:** Приоритезированный список задач для развития проекта `mcp-task-knowledge`.
> Агент обновляет статусы после каждого этапа/подэтапа работы.
> Связь с ROADMAP.md: каждая задача ссылается на этап дорожной карты.

---

## Стратегия

### Этап 0 — Фундамент ✅

- [x] F-001: Рефакторинг `src/index.ts` (4010 строк → модули)
- [x] F-002: Абстракция Transport Layer
- [x] F-003: ToolRegistry (версионирование, ETag, пагинация)
- [x] F-004: Структурированное логирование (Pino)
- [x] F-005: Prometheus exporter
- [x] F-006: Убрать `any` типы

### Этап 1 — Рыночная конкурентоспособность ✅

- [x] MR-002: Task hierarchy (parentId, depth validation, cascade close)
- [x] MR-001: Streamable HTTP transport
- [x] MR-010: npm publish + MCPMarket listing
- [x] MR-005: Task dependency graph (DAG)
- [x] MR-003: Semantic search (BM25 + embeddings)
- [x] MR-004: REST API documentation (OpenAPI/Swagger)

### Этап 2 — Документация и распространение ✅

- [x] MR-014: README overhaul
- [x] MR-013: Claude Code / Windsurf integration guides
- [x] MR-011: Claude Desktop / Cursor certified config
- [x] MR-006: VS Code extension

### Этап 3 — Транспорт и сессии (текущий)

- [x] T-001: AppContainer (lifecycle, state machine)
- [x] T-002: TCP/Unix multi-client сервер (PR #49)
- [x] T-003: Stdio single-client сервер (вынести из main) (PR #50)
- [x] S-001: SessionManager (TTL, idle timeout, lifecycle) (PR #51)
- [x] S-002: ToolExecutor и ToolContext (per-session) (PR #52)
- [x] S-003: Per-session rate limiting (token bucket) (PR #53)
- [x] S-004: MCP tool `session_info` — клиент может запросить своё состояние (rate limit remaining, TTL, idle timeout) (PR #66)
- [x] S-005: Session metrics — Prometheus gauges для активных сессий, duration histogram, idle timer (PR #67)
- [x] MW-001: Middleware pipeline для tool calls (pre/post hooks, logging, error handling) (PR #55)
- [x] MW-002: Internal event bus (pub/sub внутри сервера) (PR #57)
- [x] MW-003: Built-in logging middleware (request/response через MW-001) (PR #59)
- [x] CFG-001: Unified configuration (env + config file + defaults + schema validation)

### Этап 4 — Авторизация, ACL, безопасность

- [x] A-001: `mcp.authenticate` + pre-auth method window (PR #60)
- [x] A-002: JWT/JWKS validation (PR #61)
- [x] A-003: Привязка tokenClaims к session TTL (PR #63)
- [x] ACL-001: Модель ACL и policy definitions (PR #64)
- [x] ACL-002: Фильтрация списков инструментов/ресурсов по ACL
- [x] ACL-003: Проверка авторизации при вызове инструментов
- [x] SEC-001: Audit logging (все MCP-операции → structured audit trail)
- [x] SEC-002: TLS/mTLS поддержка + certificate rotation
- [x] SEC-003: Token refresh flow + short-lived tokens
- [x] SEC-004: Secret management (env, vault, KMS integration)
- [x] SEC-005: Authentication protection (rate-limit, lockout, brute-force prevention)
- [x] SEC-006: Input sanitization (XSS, SQL injection, path traversal protection)

### Этап 5 — Инфраструктура качества

- [x] Q-004: E2E тесты MCP-инструментов
- [x] Q-005: Coverage threshold enforcement (минимум 80%)
- [x] Q-006: Нагрузочные тесты для BM25 и vector search
- [x] Q-007: Schema validation tests (ajv для schemas/*.json)
- [x] Q-008: Фаззинг: JSON-RPC framing/parser/validator
- [x] Q-009: Chaos/shutdown тесты (graceful degradation)
- [x] Q-010: Property-based testing для core-модулей (fast-check)
- [x] Q-011: Snapshot testing для transport adapters
- [x] SYNC-005: E2E durability тесты (синхронизация)

### Этап 6 — Proxy, синхронизация, DX

- [x] P-001: Proxy bootstrap и конфигурация
- [x] P-002: Зеркалирование инструментов/ресурсов через прокси
- [x] P-003: Проброс запросов/уведомлений, flow control
- [x] P-004: Устойчивость и observability прокси
- [x] SYNC-001: Протокол версионирования и курсоры
- [x] SYNC-002: RPC `mcp.sync.*` (delta/snapshot/ack)
- [x] SYNC-003: Conflict resolver (3-way merge)
- [x] SYNC-004: Event sourcing и snapshots (GC)
- [x] DX-001: Hot registration of tools (runtime add/remove)
- [x] DX-002: Namespaces и wildcard фильтры для инструментов
- [x] DX-003: Dev CLI (diagnostics, config validation, health check)
- [x] DX-004: Hot reload конфигов/политик без перезапуска
- [x] DX-005: Proxy response caching (ETag-based, TTL)

### Этап 7 — Масштабируемость

- [x] SCALE-001: Health/readiness/drain endpoints
- [x] SCALE-002: Load balancer integration + sticky sessions
- [x] SCALE-003: Cluster state synchronization (sessions/registry)
- [x] SCALE-004: Tool sharding across nodes
- [x] SCALE-005: Auto-scaling и resource limits

### Этап 8 — Интеграции

- [x] INT-004: Connector framework (plug-in SDK + registry)
- [x] INT-001: GitHub connector
- [x] INT-002: Jira connector (только чтение; YouTrack и синхронизация — INT-007/INT-008)
- [x] INT-003: Slack/Discord connector
- [x] MR-012: Real-time collaboration (WebSocket)
- [x] INT-005: REST wrappers для MCP tools
- [x] INT-006: gRPC wrappers для MCP tools

### Этап 9 — Skills, Rules, Workflows, Memory

- [x] SK-001: Skills CRUD (Markdown + YAML frontmatter)
- [x] SK-002: Skill invocation pipeline
- [x] SK-003: Skill discovery + импорт из awesome-cursorrules
- [x] SK-004: Pre-built skill templates
- [x] SK-005: Skill sharing + конвертеры форматов
- [x] SK-006: Skill permissions (Agent Skills spec)
- [x] RL-001: Rules storage (global → project → user)
- [x] RL-002: Rules evaluation (runtime guard checks)
- [x] RL-003: Policy-as-code (JSON/DSL)
- [x] RL-004: Built-in rule packs
- [x] RL-005: Rule enforcement hooks
- [x] RL-006: Rule import (.cursorrules, CLAUDE.md, .clinerules)
- [x] WF-001: Workflow DAG builder
- [x] WF-002: Workflow executor
- [x] WF-003: Workflow templates
- [x] WF-004: Human-in-the-loop
- [x] WF-005: Workflow state persistence
- [x] WF-006: Workflow chaining (subflow)
- [x] MEM-001: Session memory
- [x] MEM-002: Entity graph
- [x] MEM-003: Context distillation
- [x] MEM-004: Memory import/export

### Этап 10 — Web UI

- [x] UI-001: Web UI foundation (Next.js + auth + API client)
- [x] UI-002: Tasks board (Kanban/List view)
- [x] UI-003: Knowledge editor (Markdown/MDX)
- [x] UI-004: Prompt management (versions, variants, A/B)
- [x] UI-005: Realtime updates (WebSocket)
- [x] UI-006: Feedback loop & usage analytics
- [x] UI-007: Docker/CI pipeline для Web UI

### Этап AB — Compact-режим и инструкции агентам

- [ ] CM-01: тест-спека текущего поведения `tools_run` и `tools_batch`
- [ ] CM-02: флаг `parallel` в `tools_run` или `tools_batch` в компактном режиме
- [ ] CM-03: серверные `instructions` в `initialize`
- [ ] CM-04: мост `--tools meta|full` на клиента
- [ ] CM-05: замер на чистых инстансах и слабых моделях
- [ ] CM-06: решение по проектному скиллу

### Этап AC — Контракты MCP: схемы, счётчики и большие ответы

- [ ] AC-01: схемы и валидация аргументов инструментов
- [ ] AC-02: честные счётчики и одно значение слова «blocked»
- [ ] AC-03: фильтры, проекции и размер больших ответов
- [ ] AC-04: диагностика вызовов — `tools_run`, `tool_schema`, лог
- [ ] AC-05: `search_tasks` — прогрев индекса и честный статус

### Критический путь

```
T-001 (AppContainer) ✅ → T-002 (TCP/Unix) → S-001 (Sessions) → A-001 (Auth) → ACL-001 (ACL)
                       → T-003 (Stdio)
                       → MW-001 (Middleware) → RL-005 (Rule hooks), ACL-003 (Auth checks)
MW-002 (Event bus) → INT-004 (Connector framework), SYNC-002 (Sync RPC)
CFG-001 (Unified config) → DX-004 (Hot reload), SEC-004 (Secret management)
SK-001 (Skills CRUD) → WF-001 (Workflow DAG) → WF-002 (Executor)
```

---

## Статусы

| Статус | Описание |
|--------|----------|
| `pending` | Не начата, ждёт очереди |
| `in_progress` | В работе |
| `blocked` | Заблокирована зависимостью |
| `done` | Завершена |
| `deferred` | Отложена (не актуальна / низкий приоритет) |

### Гейты готовности: что нельзя начинать без проработки

Статус `blocked` у пункта из очереди означает не «ждёт зависимость», а «нет артефакта, без которого реализация станет переделкой». Артефакт назван в начале колонки «Зависимости»; после его появления зависимость переписывается, а пункт возвращается в очередь.

- `Проработка (design): …` — нужно решение о контракте, схеме или форме API, которого в репозитории нет. Выход: ADR или раздел в docs с зафиксированным контрактом.
- `Проработка (research): …` — сам пункт аудит, замер или PoC. Выход: отчёт с находками или числами, а не код.
- `Проработка (spec): …` — текст пункта разошёлся с кодом на текущем HEAD. Выход: переписанная постановка с проверяемым DoD.
- `Гейт владельца: …` — нужен выбор владельца продукта. Выход: записанное решение в ADR или в тексте пункта.
- Пункт, который просто ждёт закрытия другого пункта, остаётся в очереди: такая зависимость указана без префикса.

## Приоритеты

| Приоритет | Описание |
|-----------|----------|
| `critical` | Блокер, надо сделать ASAP |
| `high` | Важно, в ближайших спринтах |
| `medium` | Полезно, запланировано |
| `low` | Улучшение, когда будет время |

---

## Этап 0 — Архитектурный каркас (Foundation)

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| F-001 | Рефакторинг `src/index.ts`: вынести регистрацию инструментов в отдельные модули | critical | done | 0.1 | — |
| F-002 | Создать абстракцию Transport Layer (подготовка к TCP/WS) | medium | done | 0.2 | F-001 |
| F-003 | Реестр инструментов: версионирование, etag, пагинация | medium | done | 0.3 | F-001 |
| F-004 | Добавить структурированное логирование (Pino или Winston) | medium | done | 0.4 | — |
| F-005 | Метрики: Prometheus exporter (счётчики вызовов, latency) | low | done | 0.4 | F-004 ✅ |
| F-006 | Убрать `any` типы в критических местах (vectorAdapter, toolRegistry) | medium | done | 0.1 | — |

---

## Этап 1 — Транспорт

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| T-001 | AppContainer: композиция приложения с lifecycle | medium | done | 1.1 | F-002 ✅ |
| T-002 | TCP/Unix multi-client сервер | medium | **done** ✅ | 1.2 | T-001 ✅ |
| T-003 | Stdio single-client сервер (вынести из main) | low | **done** ✅ | 1.3 | T-001 ✅ |
| T-004 | Transport health check: метод `health()` на TransportAdapter — проверка что транспорт жив (socket listening, connection alive). Для SCALE-001 `/healthz`. Stdio всегда healthy | low | done | PR #72 | T-001 |

---

## Cross-cutting: Middleware & Infrastructure

> Фундаментальные компоненты, от которых зависят ACL, Rules, Auth и другие подсистемы.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| MW-001 | Middleware pipeline: chain of pre/post interceptors для tool calls. Базовый интерфейс `ToolMiddleware { before(ctx), after(ctx, result), onError(ctx, err) }`. Порядок execution, short-circuit, error propagation | high | ✅ done | PR #55 | T-001 |
| MW-002 | Internal event bus: pub/sub шина внутри сервера. Топики: `tool.called`, `task.created`, `session.opened`. Подписчики: logger, metrics, rules engine, connectors. Typed events, async dispatch | high | ✅ done | PR #57 | T-001 |
| MW-003 | Built-in logging middleware: request/response logging для tool calls через MW-001 pipeline. Structured log: tool name, input, output (truncated), duration, sessionId, userId. Конфигурируемый verbosity | medium | ✅ done | PR #59 | MW-001, S-002 |
| CFG-001 | Unified configuration: единая система конфигурации — env vars, config file (YAML/JSON), runtime defaults, schema validation (Zod). Иерархия: defaults → config file → env → CLI args. API: `config.get('server.port')` | high | done | PR #71 | T-001 |

---

## Этап 2 — Многопользовательские сессии

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| S-001 | SessionManager: TTL, idle timeout, lifecycle | medium | **done** ✅ | 2.1 | T-001 |
| S-002 | ToolExecutor и ToolContext (per-session) | medium | **done** ✅ | 2.2 | S-001 |
| S-003 | Per-session rate limiting (token bucket) | medium | **done** ✅ | 2.3 | S-001 |
| S-004 | MCP tool `session_info`: клиент запрашивает своё состояние — rate limit remaining, TTL, idle timeout, session age | medium | **done** | — | S-001, S-003, S-002 |
| S-005 | Session Prometheus metrics: gauges `mcp_sessions_active`, `mcp_sessions_total`, histogram `mcp_session_duration_seconds`, `mcp_session_idle_seconds` | low | **done** | — | S-001, F-005 |

---

## Этап 3 — Авторизация

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| A-001 | `mcp.authenticate` + pre-auth method window | medium | done | 3.1 | S-001 |
| A-002 | JWT/JWKS validation | high | done | 3.2 | A-001 |
| A-003 | Привязка tokenClaims к session TTL | medium | done | 3.3 | A-002, S-001 |

---

## Этап 4 — ACL

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| ACL-001 | Модель ACL и policy definitions | medium | **done** | 4.1 | A-002 |
| ACL-002 | Фильтрация списков инструментов/ресурсов по ACL | medium | **done** | 4.2 | ACL-001 |
| ACL-003 | Проверка авторизации при вызове инструментов | medium | **done** | 4.3 | ACL-001 |

---

## Этап 5 — Thin Proxy

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| P-001 | Proxy bootstrap и конфигурация | medium | done | PR #72 | A-002 |
| P-002 | Зеркалирование инструментов/ресурсов через прокси | medium | done | PR #73 | P-001 |
| P-003 | Проброс запросов/уведомлений, flow control | medium | done | PR #74 | P-002 |
| P-004 | Устойчивость и observability прокси | low | done | PR #75 | P-003 |

---

## Этап 8 — Безопасность (Security)

> Из ROADMAP stage 8. Системная безопасность — аутентификация, аудит, шифрование, секреты.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| SEC-001 | Audit logging: запись всех MCP-операций в structured audit trail — кто, что, когда, результат. Формат: JSON lines, ротация по размеру/времени. Хранение: файл + optional remote (Syslog/Loki). MCP tools: `audit.query`, `audit.export` | high | done | PR #76 | A-002 |
| SEC-002 | TLS/mTLS поддержка: TLS для TCP/HTTP транспорта. mTLS для server-to-server (proxy ↔ server). Certificate rotation без downtime. Конфигурация через `CFG-001` | medium | done | PR #81 | T-002, CFG-001 |
| SEC-003 | Token refresh flow: short-lived access tokens (15-30 min) + refresh tokens. Refresh endpoint, token revocation, token blacklist. Связь с `A-002` и `A-003` | high | done | PR #77 | A-002 |
| SEC-004 | Secret management: хранение секретов (API keys, tokens) — env vars, Docker secrets, HashiCorp Vault integration (optional). Шифрование at-rest для конфиденциальных данных. API: `secrets.get`, `secrets.set` | medium | done | PR #80 | CFG-001 |
| SEC-005 | Authentication protection: rate-limit на `mcp.authenticate` (5 attempts/min), lockout после N failures, exponential backoff. CAPTCHA integration (optional). IP-based blocking | medium | done | PR #78 | A-001 |
| SEC-006 | Input sanitization: валидация и очистка всех tool input — XSS prevention, SQL injection, path traversal, command injection. Стандартный sanitizer перед вызовом handler. Часть MW-001 pipeline | medium | done | PR #79 | MW-001 |

---

## Market Research Phase — Приоритеты по результатам исследования рынка (апр. 2026)

> Отчёт: `docs/market-research/mcp-market-research-2026.pdf`. Конкуренты: Agentic Tools MCP (81★), TaskMaster v2, TaskMaster v1.
> Ключевые gaps: HTTP transport, semantic search, task hierarchy, VS Code extension.
> Скриншоты UI: `docs/market-research/ui-screenshot.png`, `ui-knowledge.png`, `ui-search.png`.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| MR-001 | Streamable HTTP transport (вместо stdio) | critical | done | — | F-001 |
| MR-002 | Task subtasks: parentId, иерархия (1+ уровней) | critical | done | — | — |
| MR-003 | Semantic search: BM25 + векторные эмбеддинги | high | done | — | — |
| MR-004 | REST API documentation (OpenAPI/Swagger) | high | done | — | — |
| MR-005 | Task dependency graph (блокировки, DAG) | high | done | — | MR-002 |
| MR-006 | VS Code extension (companion для Web UI) | high | done | — | MR-001 |
| MR-007 | Dashboard аналитика: статистика, графики | medium | done | — | — |
| MR-008 | Multi-project workspace (улучшенный selector) | medium | done | — | — |
| MR-009 | Markdown import/export для knowledge base | medium | done | — | — |
| MR-010 | MCPMarket listing + npm publish | critical | done | — | — |
| MR-011 | Claude Desktop / Cursor certified config | high | done | — | — |
| MR-012 | Real-time collaboration (WebSocket) | medium | done | #181 | — |
| MR-013 | Claude Code / Windsurf integration guides | high | done | — | — |
| MR-014 | README overhaul: install, features, demo GIF | high | done | — | — |

---

## Этап 6 — Синхронизация

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| SYNC-001 | Протокол версионирования и курсоры | medium | completed | #166 | — |
| SYNC-002 | RPC `mcp.sync.*` (delta/snapshot/ack) | medium | completed | #166 | SYNC-001 |
| SYNC-003 | Conflict resolver (3-way merge) | high | completed | #167 | SYNC-002 |
| SYNC-004 | Event sourcing и snapshots (GC) | low | completed | #168 | SYNC-002 |
| SYNC-005 | E2E durability тесты: проверка синхронизации при сбоях — disconnect, split-brain, concurrent writes. Восстановление после crash | medium | completed | #169 | SYNC-003 |

---

## Этап 9 — Developer Experience (DX)

> Из ROADMAP stage 9. Улучшения для разработчиков, использующих MCP сервер.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| DX-001 | Hot registration of tools: runtime добавление/удаление инструментов без перезапуска. API: `tools.register()`, `tools.unregister()`. Уведомления клиентам через MW-002 (event bus) | medium | completed | #150 | 9.1 | MW-002 |
| DX-002 | Namespaces и wildcard фильтры: группировка инструментов по namespace (`project.*`, `search.*`). Фильтрация при `tools/list` по паттерну (`search.*`, `*.create`). Поддержка в ACL | medium | completed | #151 | 9.2 | MW-001 |
| DX-003 | Dev CLI: CLI-утилита для локальной разработки — `mcp-tk diagnose` (health check, config validation), `mcp-tk tools` (list registered tools), `mcp-tk sessions` (active sessions), `mcp-tk export` (data backup) | medium | completed | #148 | 9.4 | CFG-001 |
| DX-004 | Hot reload конфигов/политик: watch на config files, reload без restart. Graceful transition (old connections continue, new connections use new config). Зависит от `CFG-001` | medium | completed | #152 | 9.5 | CFG-001, MW-002 |
| DX-005 | Proxy response caching: ETag-based кеширование ответов в прокси. TTL per-tool. Cache invalidation при write operations. API: `cache.stats`, `cache.invalidate` | low | completed | #153 | 9.3 | P-002 |
| DX-006 | Pre-push CI hooks: husky + lint-staged — `tsc --noEmit` + `vitest run` перед каждым push. Цель: не пускать в CI код с TS-ошибками или падающими тестами. Установить: `npx husky init`, добавить `pre-push` hook | high | done | PR #82 | — |
| DX-007 | Shared test factories: вынести `createMockContext()`, `createMockAdapter()` и др. в `tests/helpers.ts`. Сейчас дублируется в 5 тестовых файлах (1764 строк). Единый источник правды для моков ServerContext, TransportAdapter | medium | completed | #147 | — |
| DX-008 | ESLint + Prettier: добавить ESLint (strict TS config) и Prettier. CI lint job. Pre-commit hook через husky. autofix на `npm run lint:fix` | medium | completed | #149 | DX-006 |

---

## Этап 10 — Масштабируемость (Scalability)

> Из ROADMAP stage 10. Масштабирование от single-server к кластеру.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| SCALE-001 | Health/readiness/drain endpoints: `/healthz` (liveness), `/readyz` (readiness — deps check: DB, embeddings), `/drainz` (graceful shutdown — stop accepting new sessions). Standard Kubernetes probes | high | done | PR #83 | T-001 |
| SCALE-002 | Load balancer integration + sticky sessions: session affinity по session ID. Support для AWS ALB, Nginx, HAProxy. Docs по настройке. Health check integration | medium | done | #182 | S-001, SCALE-001 |
| SCALE-003 | Cluster state synchronization: репликация session state и registry между нодами. Consensus protocol (Raft/etcd) или eventual consistency. Split-brain detection | low | done | #182 | SYNC-002, S-001 |
| SCALE-004 | Tool sharding across nodes: распределение инструментов по нодам (по namespace/prefix). Routing layer в прокси. Tool discovery across cluster | low | done | #182 | P-002, DX-002 |
| SCALE-005 | Auto-scaling и resource limits: HPA на основе метрик (active sessions, CPU, memory). Resource quotas per-session. Graceful degradation при нагрузке | low | done | #182 | SCALE-001, S-003 |

---

## Технический долг и улучшения (не привязаны к этапу)

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| TD-001 | Рефакторинг монолитного `src/index.ts` (разделение на модули) | high | done | — | F-001 → done via F-001 |
| TD-002 | Типизация: заменить `any` на конкретные типы | medium | done | F-006 ✅ | — |
| TD-003 | Удалить legacy-поддержку путей знаний | low | deferred | — | — |
| TD-004 | Rate limiting на уровне инструментов | medium | done | S-003 | — | покрыто S-003 (PR #53) |
| TD-005 | Версионирование документов знаний | low | completed | (branch pushed, PR pending) | — |
| TD-006 | Добавить JSDoc для публичных функций | medium | completed | #142 | — |
| TD-007 | Migration от `uuid` v9 к `crypto.randomUUID()` | low | completed | #140 | — |
| TD-008 | ESM-совместимый импорт service-catalog | medium | completed | #138 | — |
| TD-009 | Data migration framework: версия схемы данных, миграции up/down, rollback. CLI: `mcp-tk migrate [up\|down\|status]`. Применяется при запуске. Защита от одновременных миграций | medium | closed | #117 (BM-013) | CFG-001 |
| TD-010 | Centralized error handling: единый error handler для tool calls — классификация ошибок (validation, not found, internal, permission), consistent error responses, error context для logging | medium | completed | #119 | MW-001 |
| TD-011 | Graceful degradation: при недоступности optional сервисов (embeddings, AI models) — fallback к базовому функционалу. Circuit breaker pattern. Health status indicators | medium | completed | #120 | MW-001, SCALE-001 |
| TD-012 | Mock interface sync: при изменении TransportAdapter/ServerContext/etc — автоматически проверять что моки в тестах соответствуют реальным интерфейсам. Утилита `tests/type-check.ts` или tsd | medium | completed | #122 | DX-007 |
| TD-013 | Test timing safety: заменить `sleep()` на `vi.useFakeTimers()` в тестах session-manager, rate-limiter. Текущие timing-тесты flaky при высокой нагрузке CI | medium | completed | #121 | Q-009 |
| TD-014 | WIP commit strategy для агента: автоматический `git commit -m "WIP"` перед началом каждой BACKLOG задачи. Восстановление после крэша без потери staged changes | low | completed | — (docs, master) | — |

---

## Качество и тестирование

> Из ROADMAP stage 7 + дополнительные.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| Q-001 | Unit-тесты для `src/search/bm25.ts` (покрытие edge-cases) | high | done | 7.1 | — |
| Q-002 | Unit-тесты для `src/storage/tasks.ts` | high | done | 7.1 | — |
| Q-003 | Unit-тесты для `src/storage/knowledge.ts` | high | done | 7.1 | — |
| Q-004 | Интеграционные E2E тесты для основных MCP-инструментов | medium | completed | #123 | 7.1 | — |
| Q-005 | Coverage threshold enforcement (минимум 80%) | medium | completed | #124 | 7.4 | Q-001..Q-004 |
| Q-006 | Нагрузочные тесты для BM25 и vector search | low | completed | #127 | 7.2 | — |
| Q-007 | Schema validation tests (ajv для schemas/*.json) | low | completed | #128 | 7.1 | — |
| Q-008 | Фаззинг JSON-RPC: random payloads для framing, parser, validator. Инструменты: fast-check / property-based testing. Цель — найти краш-баги и undefined behavior | medium | completed | #125 | 7.3 | — |
| Q-009 | Chaos/shutdown тесты: SIGTERM/SIGKILL во время обработки,OOM simulation, disk full. Проверка graceful shutdown (T-001), data integrity, session recovery | medium | completed | #126 | 7.5 | T-001, Q-004 |
| Q-010 | Property-based testing для core-модулей: fast-check для SessionManager (TTL/idle edge cases), RateLimiter (burst/refill boundaries), ToolExecutor (hook ordering). Цель — найти неочевидные баги | medium | completed | #137 | S-001, S-003 |
| Q-011 | Snapshot testing для transport adapters: vitest snapshots для Content-Length framing, JSON-RPC messages, handshake. Обнаружение regression в wire format | low | completed | #141 | T-002, T-003 |
| Q-012 | Полный type-check тестов: включить tests/**/*.ts в tsc-прогон (tsconfig.test.json) и починить оставшиеся ~60 strict-ошибок в legacy тестах (сейчас type-check только для tests/type-check.test.ts) | medium | completed | #134 | TD-012 |
| Q-013 | chaos-тесты для OOM и disk-full симуляции (расширение Q-009: ENOSPC при записи задач не должен портить данные) | low | completed | #135 | Q-009 |
| Q-015 | Хрупкие тесты и pre-push: (а) overlap-тест devcycle ждёт читаемый lock и держит окно 8 с вместо гонки старта двух процессов; (б) search-perf меряет тёплую медиану и стоимость на документ, абсолютные потолки как грубая сеть; (в) e2e-наборы падают сразу с сообщением dist устарел через tests/support/dist-guard.ts, pre-push собирает dist перед vitest. Выявлена продуктовая гонка lock в scripts/lib/devcycle-state.mjs (неатомарное создание, нечитаемый lock считается устаревшим) — нужен отдельный пункт | medium | in_progress | 7.2 | — |
| Q-016 | Атомарный захват single-writer lock в `/devcycle`: `fs.writeFile(..., {flag:'wx'})` создаёт файл пустым и только потом пишет содержимое, поэтому второй тик получал `EEXIST`, читал `lock.json` без владельца (`holder === null`), считал его устаревшим, удалял живой lock и тоже получал `ok: true` — два тика подряд, два merge. Создание lock переведено на временный файл + `fs.link` (exclusive create сразу с содержимым), свежий нечитаемый lock считается занятым 5 с по mtime, а не устаревшим, reclaim выполняется под гвардией `lock.json.reclaim` (два reclaim-ера не могут оба удалить и создать), `release()` удаляет только свой lock по токену владельца. DoD: кросс-процессный инвариант «не больше одного `ok: true` на раунд» (6 процессов × 6 раундов, плюс гонка за устаревший lock), регрессионный тест на окно «файл есть, содержимого нет» падает на старом коде (`[true, true]` вместо одного победителя) и зелёный 30 прогонов подряд, стенд на 560 попыток — 0 двойных захватов (до правки 7 раундов из 70, до 5 победителей в раунде) | high | in_progress | 7.2 | Q-015 |
| TS-01 | Стабильность тестов и безопасный прогон (надёжность раньше фич): полный `vitest run` без лимита воркеров на 72-ядерной машине поднимал ~70 процессов по ~0.9 ГБ, уводил систему в нехватку памяти и перезагружал её; тот же прогон запускают `.husky/pre-push` и локальный `npm test`. DoD: (1) потолок воркеров в `vitest.config.ts` — `min(4, ядра/2)`, переопределяется `VITEST_MAX_WORKERS`, и он же в `npm test`/`test:coverage` и `.husky/pre-push`; (2) тест доказывает, что конфиг ограничивает число воркеров и что env-переопределение работает; (3) три флейка (`tests/executable-docs.test.ts`, `tests/e2e-full/auth-session-stress.test.ts`, `tests/pagination.unit.test.ts`) имеют названную причину и цифры до/после на серии ≥20 прогонов файла; (4) `npx vitest run` без флагов держит пик памяти ≤ 8 ГБ (замер по сумме RSS дерева процессов, цифра приложена); (5) 3 полных прогона с `--maxWorkers=4` зелёные, `npm run test:types` зелёный, `npm run backlog:check` зелёный; (6) `retry` и `fileParallelism:false` не используются как маскировка | high | done | — | Q-015, Q-017 |
| TS-02 | Изоляция каталога данных между тест-файлами (продолжение TS-01): `tests/setup.ts` задавал один `DATA_DIR = <cwd>/.tmp-vitest` на весь прогон, поэтому параллельные сьюты видели задачи, знания, `.state.json`, `.jwt-revoked.json` и `.index/metadata.db` друг друга, а каталог копился между прогонами (1029 проектов, 23 МБ на 2026-11-09) и требовал `rm -rf .tmp-vitest` перед полным прогоном (примечание AC-05 в AGENTS §8). DoD: (1) setup создаёт `mkdtemp` на тест-файл, снимает каталог в `afterAll`, осиротевшие — свип только по своему префиксу `mcp-vitest-` старше 2 ч, чужое в `/tmp` не трогается; (2) страж `tests/data-isolation.test.ts` краснеет при откате к общему каталогу и при мутации `mkdtemp` на фиксированный путь; (3) 3 полных `npx vitest run` без предварительной очистки `.tmp-vitest` зелёные, каталог после прогонов не меняется; (4) `npm run test:types` и `npm run backlog:check` зелёные; (5) 44 файла со своим `DATA_DIR` не менялись | high | done | #318 | TS-01 |
| Q-017 | Осиротевшие серверы из тестов (P-20261106-2): после полных прогонов оставались процессы `node dist/index.js` (ppid=systemd, cwd=worktree), они держали 4002/4003 и ломали следующий прогон. Корни: `client.connect()` в `__tests__/{project_purge_filters,resources_and_tools_resources,search_tools_lazy_init}`, `tests/e2e-full/harness.ts`, `mcp-prompts`, `elicitation` стоял вне try/finally — таймаут теста (5 с под нагрузкой) во время connect оставлял сервер жить; `child.kill('SIGTERM')` в e2e-наборах не ждал exit и не эскалировал в SIGKILL; chaos-shutdown и 7 e2e-наборов держали фиксированные счётчики портов (4000, 4400, 4600, 4700, 4800, 4950, 4970, 5050), поэтому осиротевший сервер валил следующий прогон и хук pre-push, а `waitForExit` терял exit, случившийся до навешивания слушателя, и отдавал null. Добавлены `tests/support/server-process.ts` (`getFreePort`, `spawnTrackedServer`, `trackServer`, `terminateServer` с SIGTERM→SIGKILL, `terminateTrackedServers`) и глобальный страж `tests/support/orphan-guard.ts` (vitest globalSetup/teardown: новые `dist/index.js` с cwd = корень проекта → падение с PID и портом; baseline не трогает чужой dev-сервер). DoD: мутация без гашения → страж красный (`pid=... ports=...`), после фикса зелёный; 3 полных прогона и `sh .husky/pre-push` — 0 сирот; `e2e:full` 122; под нагрузкой 6 busy-loop — 0 сирот; воспроизведение исходной утечки (100 busy-loop, таймауты в `__tests__`) — 0 сирот | high | in_progress | 7.5 | Q-009, Q-004 |

---

## Документация

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| D-001 | API reference для всех MCP-инструментов | medium | completed | #144 | — |
| D-002 | Architecture Decision Records (ADR) | low | completed | (branch pushed, PR pending) | — |
| D-003 | CONTRIBUTING.md для контрибьюторов | low | completed | (branch pushed, PR pending) | — |
| D-004 | CHANGELOG.md (автоматический из conventional commits) | low | completed | (branch pushed, PR pending) | — |
| D-005 | Architecture diagram: Mermaid/PlantUML диаграмма — компоненты (AppContainer, SessionManager, ToolExecutor, Transport), связи, data flow. В README или /docs. Обновлять при изменении архитектуры | medium | completed | #143 | — |

---

## Агент-инфраструктура

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| AI-001 | Создать AGENTS.md | critical | done | — | — |
| AI-002 | Создать BACKLOG.md | critical | done | — | — |
| AI-003 | Актуализировать ROADMAP.md | critical | done | — | — |
| AI-004 | Автоматическое обновление трекинг-троек в CI | low | completed | #145 | AI-001..AI-003 |
| AI-005 | Market research отчёт (PDF) | high | done | — | — |
| AI-006 | ~~Web UI: Kanban, Knowledge, Search (Next.js)~~ → заменена на UI-001..UI-007 | high | done | — | — |
| AI-007 | Agent performance tracking: логирование времени на задачу, потреблённых токенов, количества PR. Автообновление в BACKLOG. Цель — анализировать velocity и оптимизировать процесс | low | completed | #146 | AI-001..AI-003 |
| AI-008 | Behavioral dashboard CLI: `mcp-tk dashboard` — рендер src/behavioral/dashboard.ts в HTML-файл из .behavioral/ | low | completed | #133 | BM-011 |
| AI-009 | Wire-in ServiceAvailability (TD-011) в реальные вызовы embeddings/catalog: сейчас трекеры зарегистрированы в app-container, но recordFailure/recordSuccess не вызываются из инструментов — health-чеки всегда healthy | medium | completed | #132 | TD-011 |
| AI-010 | Унифицировать draft-схемы: prompt.schema.json на draft-2020-12, остальные на draft-07 — привести к одному draft или документировать различие | low | completed | #136 | Q-007 |
| AI-011 | Claude Code plugin export: exportClaudeCodePlugin — генерация .claude-plugin/plugin.json + skills/*/SKILL.md + README. ADR-006 | medium | completed | #157 | SK-005 |
| AI-012 | Claude Code plugin import: prompts_import_plugin — чтение .claude-plugin/plugin.json + skills/*/SKILL.md, конвертация в наш формат | medium | completed | #158 | AI-011 |
| AI-013 | MCP streaming responses: поддержка partial/streaming tool results (SSE chunked) для long-running operations (embeddings init, bulk import) | high | completed | #159 | — |
| AI-014 | OAuth 2.1 provider: авторизация для HTTP transport (PKCE flow, token endpoint, scope-based ACL). Прод-уровень security | high | completed | #162 | A-002 |
| AI-015 | Tool batching API: `tools_batch` — группировка нескольких tool calls в один request с параллельным выполнением и агрегированным ответом | medium | completed | #160 | — |
| AI-016 | Rate-limit dashboard: UI для визуализации rate-limit состояния (per-session buckets, refill rate, denied requests) | low | completed | #161 | TD-004 |

---

## Этап A — Skills System (Agent Skills)

> Концепция: Переиспользуемые "навыки" для AI-агента — аналог Claude Code SKILL.md, Cursor .cursorrules, Cline .clinerules.
> Формат: Гибридный — собственный формат как основной, с конвертерами из .cursorrules / SKILL.md / .clinerules.
> Стандарт: [agentskills.io](https://agentskills.io) — открытый спецификация для AI-скиллов.
> Ресурсы: awesome-cursorrules (38.9K ⭐), awesome-clinerules.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| SK-001 | Skills CRUD: создание, редактирование, версионирование скиллов. Markdown + YAML frontmatter, поддержка `$ARGUMENTS`, `${VARS}` | critical | done | PR #89 | — |
| SK-002 | Skill invocation pipeline: триггер → контекст → выполнение → результат. `context: fork` для сабагентов, shell injection `!command`` | critical | done | PR #97 | SK-001 |
| SK-003 | Skill discovery: каталог с тегами, поиск, категории. Импорт из awesome-cursorrules и других источников | high | done | PR #100 | SK-001 |
| SK-004 | Skill templates: pre-built скиллы из коробки — code-review, deploy, test-gen, refactor, debug, architecture-review | high | done | PR #101 | SK-001 |
| SK-005 | Skill sharing: экспорт/импорт. Конвертеры: .cursorrules ↔ SKILL.md ↔ .clinerules ↔ наш формат. Git-native хранение | medium | done | PR #108 | SK-001 |
| SK-006 | Skill permissions: `allowed-tools`, `disable-model-invocation`, scope (project/user/global) по Agent Skills spec | medium | done | PR #109 | SK-001, SK-002 |

---

## Этап B — Rules & Policies Engine

> Концепция: Guardrails и правила для AI-агента — аналог .cursorrules, CLAUDE.md, .clinerules, policy-as-code.
> Уровни: global → project → user. Наследование и переопределение на каждом уровне.
> Runtime: guard checks перед вызовом MCP-инструментов, input/output validation.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| RL-001 | Rules storage: иерархия правил (global → project → user). Формат Markdown + YAML frontmatter. Наследование, переопределение | critical | done | PR #92 | — |
| RL-002 | Rules evaluation: runtime guard checks перед вызовом MCP-инструментов. Input/output validation, schema checks | critical | done | PR #98 | RL-001 |
| RL-003 | Policy-as-code: JSON/DSL описание политик. Git-native, версонируются с кодом. Условные правила (if file=*.ts then...) | high | done | PR #102 | RL-001 |
| RL-004 | Built-in rule packs: предустановленные наборы — security-rules, ts-strict, react-conventions, python-style, team-standards | medium | done | PR #110 | RL-001 |
| RL-005 | Rule enforcement hooks: pre/post hooks на MCP tool calls. Блокировка, предупреждение, логирование, auto-fix. Реализуется через `MW-001` (middleware pipeline) | high | done | PR #104 | RL-002, MW-001 |
| RL-006 | Rule import: импорт из .cursorrules, CLAUDE.md, .clinerules, .windsurfrules. Конвертеры в наш формат | medium | done | PR #111 | RL-001 |

---

## Этап C — Workflows (AI Agent Flows)

> Концепция: Последовательности AI-действий — аналог Windsurf Flows, Cursor rules chaining, Claude Code skill flows.
> Пример: research → plan → implement → review. Переиспользуемые шаблоны для агента.
> Уровень абстракции: AI Agent Flows (high-level) + tool orchestration (low-level), с вложенностью.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| WF-001 | Workflow DAG builder: определение графа — nodes (tools/skills/rules), edges (dependencies), conditions, triggers | critical | done | PR #93 | SK-001 |
| WF-002 | Workflow executor: выполнение — sequential, parallel, conditional branching, error recovery, retry logic | critical | done | PR #94 | WF-001 |
| WF-003 | Workflow templates: pre-built flows — code-review-pipeline, feature-dev-flow, bug-triage, release-checklist, research-and-plan | high | done | PR #95 | WF-001 |
| WF-004 | Human-in-the-loop: точки останова для подтверждения пользователем. Approve/reject/modify перед критическими шагами | high | done | PR #96 | WF-002 |
| WF-005 | Workflow state persistence: чекпоинты, возобновление после сбоев. Resume с места остановки. Session linkage | medium | done | PR #105 | WF-002 |
| WF-006 | Workflow chaining: вложенные workflows (subflow), composability. Workflow как step внутри другого workflow | medium | done | PR #107 | WF-002 |

---

## Этап D — Developer Memory & Context

> Концепция: Персистентная память для AI-агента между сессиями. Архитектурные решения, конвенции, lesson learned.
> Расширение текущего knowledge-base модуля специализации под AI context management.
> Аналоги: PersistMemory MCP, Beam, CASS (310 ⭐), .claude/ project memory.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| MEM-001 | Session memory: персистентная память между сессиями AI-агента. Автосохранение контекста, архитектурные решения, конвенции | high | done | PR #84 | — |
| MEM-002 | Entity graph: граф сущностей проекта — файлы→модули→зависимости. Semantic search по графу, auto-discovery | medium | done | PR #112 | MEM-001 |
| MEM-003 | Context distillation: авто-суммаризация сырого контекста в actionable knowledge. Compress old sessions | medium | done | PR #113 | MEM-001 |
| MEM-004 | Memory import/export: импорт из .claude/, .cursor/, Obsidian vault. Экспорт в стандартные форматы | medium | done | PR #114 | MEM-001 |

---

## Этап E — Integration Hub

> Концепция: Коннекторы к внешним системам — GitHub, Jira, YouTrack, Slack, Discord.
> Plug-in architecture: SDK + registry для добавления новых коннекторов.
> Каждый коннектор — набор MCP-инструментов с унифицированным интерфейсом.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| INT-004 | Connector framework: plug-in architecture для добавления коннекторов. SDK + registry + lifecycle hooks | high | completed | #163 | MW-002 |
| INT-001 | GitHub connector: issues, PRs, commits, code search. MCP tools: github_issue_*, github_pr_*, github_repo_* | high | completed | #164 | INT-004 |
| INT-002 | Jira connector, **только чтение** (`jira_issue_list/get`, `jira_project_list` через `/rest/api/2`). Заявленные ранее YouTrack и синхронизация задач НЕ реализованы (проверено 2026-10-30: в `src/connectors/jira.ts` YouTrack упомянут лишь в заголовке) — см. INT-007, INT-008 | medium | completed | #165 | INT-004 |
| INT-003 | Slack/Discord connector: уведомления, поиск, отправка сообщений из AI-агента | medium | completed | #165 | INT-004 |
| INT-005 | REST wrappers: генерация REST endpoints для MCP tools. Auto-generated OpenAPI spec. Поддержка GET/POST для tool invocation | low | completed | #170 | P-002 |
| INT-006 | gRPC wrappers: генерация gRPC service definitions для MCP tools. Protobuf schema. Streaming support | low | completed | #171 | P-002 |
| INT-007 | YouTrack-коннектор (чтение) | medium | pending | INT-004 | Отдельный `src/connectors/youtrack.ts`: REST `/api/issues`, `/api/admin/projects`, язык запросов YouTrack передаётся как есть, поля (`State`, `Priority`, `Assignee`, `Type`), комментарии; токен через SecretManager (TR-26); `health()` — реальный GET `/api/users/me`. Инструменты `youtrack_issue_list/get`, `youtrack_project_list`. Тесты на записанных ответах API |
| INT-008 | Двусторонняя синхронизация задач с внешним трекером | medium | pending | INT-007, MU-02 | Маппинг полей и состояний (конфиг), идемпотентные `*_sync` в обе стороны, внешний id в задаче, правила конфликтов поверх оптимистичной блокировки по версии (MU-02): побеждает более свежая правка по полю, конфликт по одному полю → `CONFLICT`. Сначала один трекер (YouTrack), затем Jira/Linear на том же каркасе. Тест: циклическая синхронизация не плодит дубли и не зацикливается |

---

## Этап 13 — Web UI

> Разбивка AI-006/MR-015 на конкретные задачи из ROADMAP stage 13.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| UI-001 | Web UI foundation: Next.js app, auth (OIDC/JWT), API client (typed SDK для MCP HTTP transport), layout/shell, responsive design | critical | completed | #174 | 13.1 | MR-001, A-002 |
| UI-002 | Tasks board: Kanban view (drag&drop), list view, filters, search. CRUD для задач. Зависимости визуализация (граф). Интеграция с MR-005 (DAG) | high | done | #177 | UI-001 |
| UI-003 | Knowledge editor: Markdown/MDX редактор с preview. Синтаксис highlight, drag&drop для файлов. Связь с search (MR-003) | high | done | #178 | UI-001 |
| UI-004 | Prompt management: версионирование промптов, A/B тестирование (связь с `ab-testing/`), variant comparison, template editor | medium | done | #179 | UI-001 |
| UI-005 | Realtime updates: WebSocket подключение для live-updates задач, знаний, сессий. Presence indicators. Оптимистичные обновления UI | medium | done | #181 | UI-002, MR-012 |
| UI-006 | Feedback loop & analytics: usage tracking (anon), feedback forms, analytics dashboard. Связь с MR-007 (dashboard) | low | done | #180 | UI-002 |
| UI-007 | Docker/CI для Web UI: multi-stage Dockerfile, CI pipeline (build → test → deploy), preview environments (Vercel/Docker) | medium | completed | #175 | UI-001 |

---

## Этап F — OpenCode Integration & Memory Sync

> Источник: заметки 2026-08-28 (консолидация из ~/.omo/notes).
> Часть задач уже покрыта существующими (TASK-9 → MR-001 done, TASK-10 → A-001/ACL done).
> Здесь — только новые задачи, не дублирующие существующие.
>
> Концепция: Интеграция mcp-task-knowledge как memory-бэкенда для OpenCode-агента.
> Sync facts.md/patterns.json → knowledge base, авто-инъекция контекста, OpenCode плагины.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| OC-001 | OpenCode плагин `memory-recall`: инжекция инструкции для авто-вызова `search_knowledge` в начале сессии (как session-draft.ts, но для recall). Плагин НЕ вызывает MCP сам — он инструктирует агента | high | done | — | — |
| OC-002 | OpenCode плагин `memory-sync`: hook `tool.execute.after` на `/remember` → debounce 30с → sync facts.md в knowledge base. Прямой MCP-вызов через `ctx.client` (OpenCode Plugin API) | medium | done | — | OC-001 |
| OC-003 | Дедупликация при sync: перед `knowledge_bulk_create` — `search_knowledge` по title, если найдено → `knowledge_bulk_update` вместо create. Избегает дублей при повторном sync | high | done | — | OC-002 |
| OC-004 | patterns.json sync: парсинг structured patterns в sync-скрипт/плагин. Каждая запись → knowledge item с тегами `[pattern, importance-N]` | medium | done | — | OC-002 |
| OC-005 | Авто-инъекция контекста: hook `experimental.chat.messages.transform` → extract query из last user message → `search_knowledge` top-5 → append compact results в system prompt. Бюджет ~2000 токенов, кэш по query hash (TTL 5 мин), min score threshold | medium | done | — | OC-001 |
| OC-006 | P2P sync Windows ↔ Linux: git sync facts.md + re-sync index после pull. Или Syncthing для `~/mcpTrackerData/`. Документация по настройке | low | completed | #172 | OC-002 |
| OC-007 | Web UI для browse/search памяти: начать с Obsidian export (уже работает), потом минимальный web UI (FastAPI/Express читающий SQLite) если Obsidian не устроит | low | completed | #173 | — |
| OC-008 | Cleanup конфига opencode.json: `--config` file вместо 20 env vars. Структурированный JSON-конфиг, git-trackable. Связано с CFG-001 | medium | completed | #173 | CFG-001 |

---

## Этап G — Behavioral Memory (извлечено из Codememory)

> Источник: byte271/Codememory — runtime behavior memory для AI-generated code.
> Ключевая идея: память не только о фактах, но и о поведении кода — intent, runtime traces,
> failures, proven fixes. Это закрывает цикл "generate → break → guess → regenerate".
> Наш mcp-task-knowledge уже имеет knowledge base + BM25 + vector search — добавляем
> behavioral layer поверх существующей инфраструктуры.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| BM-001 | Intent capture: MCP tool `capture_intent` — записывает why код написан (prompt, file, content hash). Возвращает stable `memory_id`. Idempotent — повторный capture того же intent возвращает `duplicate: true`. Хранится в knowledge_base с type=intent | high | done | PR #85 | — |
| BM-002 | Runtime observation: MCP tool `record_runtime` — записывает выполнение функции (args, return value, duration, errors, stack trace). Связывается с intent через `memory_id`. Observer API для ESM (manual) + CJS hook (auto-instrument) | high | done | PR #85 | BM-001 |
| BM-003 | Failure logging: MCP tool `log_failure` — записывает error привязанный к `memory_id`. Валидирует что runtime snapshots принадлежат intent. Структура: error_type, message, stack, context, timestamp | high | done | PR #85 | BM-001, BM-002 |
| BM-004 | Resolution logging: MCP tool `log_resolution` — связывает resolved failure с fixing intent (provenance). Записывает: какой fix применили, какой подход сработал, ссылку на commit/PR | high | done | PR #85 | BM-003 |
| BM-005 | Repair brief: MCP tool `get_repair_brief` — собирает структурированный контекст для починки: intent + runtime traces + failures + proven fixes из похожих прошлых ошибок. Один MCP-вызов вместо ручного поиска. Fuses intent + runtime + failure + suggested fix approach | critical | done | PR #86 | BM-001..BM-004 |
| BM-006 | Code lineage: MCP tool `get_code_lineage` — trace полной генерационной истории кода (parent → child → grandchild chains). Связь через content_hash: при изменении файла создаётся новый intent с parent=предыдущий | medium | done | PR #88 | BM-001 |
| BM-007 | Auto-heal worker: background thread polls unresolved failures, генерирует repair patches из historical memory. `auto_heal_trigger` (явный) + `auto_heal_status` (проверка). Patch = comment-annotated diff из proven fixes той же shape of failure | medium | done | PR #99 | BM-005 |
| BM-008 | Proactive guardrails: MCP tool `predict_issue` — проверяет proposed code ДО записи против known failure patterns. Возвращает warnings с confidence levels + risk assessment. Guard rules auto-learned из resolved failures | high | done | PR #103 | BM-004, RL-002 |
| BM-009 | Cross-project search: MCP tool `cross_project_search` — поиск failures + proven fixes across ALL projects. Bug fixed once в repo A → не нужно rediscover в repo B. Guard rules из Project A применяются к Project B | medium | done | PR #115 | BM-004, MR-008 |
| BM-010 | Guard rules auto-learning: при resolution failure → distill approach+context в reusable rule. Rule fires на future code matching same pattern. Хранится в rules engine (RL-001). Broadcast через relay (BM-012) | medium | done | PR #116 | BM-004, RL-001 |
| BM-011 | Behavioral dashboard: zero-dep HTML single-file UI — error rate trends (90-day), fix effectiveness (which approaches succeed), event timeline (intents/failures/resolutions/runtime). Dark-themed, auto-refresh. Расширение MR-007 | low | completed | #129 | BM-001..BM-004, MR-007 |
| BM-012 | LAN Relay: mDNS auto-discovery peers + AES-256-GCM encrypted WebSocket. `relay_status`, `share_brief`, `broadcast_rule`. Zero-config, no cloud. Collective guardrails — rule созданная одним dev → instant broadcast всем teammates | low | completed | #139 | BM-010, OC-006 |
| BM-013 | Migration framework: SQLite _migrations table + up/down migrations + transactional batch apply. Statement cache с LRU eviction. WAL mode, busy_timeout, wal_autocheckpoint. Закрывает TD-009 | high | completed | #117 | TD-009 |
| BM-014 | FTS5 search: SQLite built-in full-text search как fallback/дополнение к BM25+vector. Проще, без external deps, для small datasets. `query_memory` с FTS5 natural-language search + filtered query (file_path, status, since) + pagination | medium | completed | #118 | BM-001 |

---

## Этап H — Competitive Edge (Gap Analysis vs Competitors)

> Источник: Competitor research 2026-09-01 (Mem0, Letta, Zep/Graphiti, Cognee, A-MEM, Supermemory, LangGraph, CrewAI, AutoGen).
> Цель: закрыть ключевые gap'ы и сделать mcp-task-knowledge лучшей системой памяти для AI-агентов.
> Уникальные преимущества (уже есть): MCP-native 76+ tools, Skills/Rules/Workflows, Behavioral memory, A/B testing, LAN relay, Obsidian compat, Claude Code plugin, 2000+ tests.
> Задачи приоритезированы по impact/effort. HIGH = закрывает критический gap, MEDIUM = parity, LOW = nice-to-have.
>
> **Важно:** Часть функционала реализована как OpenCode плагины (extensions/opencode/):
>
> - session-draft.ts — саморефлексия агента (draft → facts.md)
> - memory-recall.ts — инструкция поиска по вики
> - memory-sync.ts — auto-sync facts.md → MCP (debounce, dedup, dual-scope)
> - memory-context.ts — авто-контекст из памяти (гибрид)
> - collect-subagent-drafts.sh — сбор драфтов сабагентов
> Эти плагины — часть продукта mcp-task-knowledge. Новые задачи расширяют их.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости | Конкурент |
|----|--------|-----------|--------|---------|-------------|-----------|
| NEXT-001 | Temporal Knowledge Graph: bi-temporal fact tracking (valid_time + transaction_time), edge invalidation вместо удаления, point-in-time queries ("что было правдой на дату X"). Расширение entity-graph (MEM-002) | high | done | H.1 | MEM-002 | Zep/Graphiti |
| NEXT-002 | Memory Extraction Pipeline: automatic conversation→fact extraction через LLM. Инструмент `memory_extract` — принимает dialogue/session transcript, извлекает структурированные факты, сохраняет в knowledge base. ADD-only модель (как Mem0 v3) | high | done | H.2 | MEM-001 | Mem0 |
| NEXT-003 | Memory Evolution: при добавлении нового факта — LLM проверяет existing memories на semantic overlap, обновляет context/attributes существующих (как A-MEM). Инструмент `memory_evolve` | medium | done | H.3 | NEXT-002 | A-MEM |
| NEXT-004 | User Profiles: auto-maintained always-on context (static + dynamic facts). ~50ms retrieval. Инструмент `profile_get` / `profile_update`. Хранится в knowledge base с type=profile | high | done | H.4 | NEXT-002 | Supermemory |
| NEXT-005 | Automatic Forgetting: temporal facts expire (TTL per fact type), contradictions resolved, noise pruned. Background GC task. Конфигурируемые retention policies | medium | done | H.5 | NEXT-001, NEXT-004 | Supermemory |
| NEXT-006 | Sleep-time/Dreaming Agent: async memory refinement during idle periods. Background worker: dedup, merge, summarise, extract patterns. Non-blocking, использует existing context-distiller (MEM-003) | medium | done | H.6 | MEM-003, NEXT-002 | Letta/Supermemory |
| NEXT-007 | Smart Context Assembly: token-budget-aware selection of facts/summaries/observations. Инструмент `context_assemble` — принимает query + token_budget, возвращает optimised context block. RRF fusion of BM25+vector+entity | high | done | H.7 | NEXT-001 | Zep |
| NEXT-008 | Entity-linking Retrieval: entity matching as third retrieval signal (BM25 + vector + entity). Entities extracted from query, matched against entity-graph (MEM-002). Boost scores for entity matches | medium | done | H.8 | MEM-002, MR-003 | Mem0 |
| NEXT-009 | Memory Conflict Resolution: LLM-based contradiction detection between new and existing facts. Marks old facts invalid (not deleted). Инструмент `memory_resolve_conflict` | medium | done | H.9 | NEXT-001, NEXT-002 | Mem0/Zep |
| NEXT-010 | Memory Scoping (multi-tenancy): user_id / agent_id / app_id / run_id dimensions. Каждый факт тегируется scope. Filter при search. Изоляция данных между tenants | medium | done | H.10 | ACL-001 | Mem0 |
| NEXT-011 | More Connectors: Google Drive, Gmail, Notion, OneDrive, Linear, web crawler. Auto-sync with webhooks. Расширение connector framework (INT-004) | low | done | H.11 | INT-004 | Реальные API merged (WIRE-009): Drive v3/Gmail v1/Notion v1/Graph v1.0/Linear GraphQL, fail-closed, 20 hermetic-тестов |
| NEXT-012 | Multimodal Ingestion: PDFs (text extract), images (OCR), video (transcription), code (AST-aware chunking). Расширение knowledge_create для multipart | low | done | H.12 | — | Ветка feat/next012-multimodal-ingestion: zero-dep extract() — PDF FlateDecode+Tj/TJ, PNG-tEXt/JPEG-COM/SVG, SRT/VTT cues, boundary-aware code chunking; 45 tests |
| NEXT-013 | Benchmark Participation: запустить LOCOMO, LongMemEval, BEAM, DMR benchmarks. Опубликовать результаты. Цель — доказать превосходство. DONE 2026-09-03: full run 18/20 (LOCOMO 5/5, LME 3/5 BM25 no-stemming quirk, BEAM 5/5, DMR 5/5), BM25-only, report `docs/benchmarks/results-2026-09-03.md`, branch `feat/next013-run-benchmarks-publish` | medium | done | H.13 | NEXT-001..007 | Mem0/Zep/Cognee |
| NEXT-014 | Graph Visualization UI: interactive knowledge graph viewer (Web UI). Nodes = entities, edges = relationships. Filter, search, expand. Часть UI-003 | low | done | H.14 | UI-001, MEM-002 | Supermemory/Letta |
| NEXT-015 | Cross-Framework Portability: SDK adapters для LangGraph, AutoGen, CrewAI, LangChain. mcp-task-knowledge как memory provider для любого framework | low | done (feat/next015-framework-adapters: adapters a54374b + descriptor 468be5f + wire-shape fix :92) | H.15 | — | Mem0 |
| NEXT-016 | Async Memory Operations: non-blocking `memory_extract_async` — returns immediately, webhook on completion. Для long-running extraction (large transcripts) | low | done | H.16 | NEXT-002 | feat/next016-extract-async: memory_extract_async поверх AsyncJobManager (те же params + webhookUrl/metadata), 6 tests |
| NEXT-017 | Memory Layers: conversation (in-flight), session (run-scoped), user (persistent). Three-tier memory scoping | medium | done | H.17 | NEXT-010 | Mem0/Letta |
| NEXT-018 | Observations/Pattern Detection: graph-based pattern surfacing — recurrences, co-occurrences, temporal patterns из entity-graph. Инструмент `memory_observations` | low | done | H.18 | NEXT-001 | Zep |
| NEXT-019 | Plugin: memory-dream.ts — background memory refinement (sleep-time compute). Плагин OpenCode: idle detection → dedup/merge/summarise facts.md → MCP sync. Расширение memory-sync.ts | medium | done | H.19 | NEXT-002, MEM-003 | Letta |
| NEXT-020 | Plugin: memory-extract.ts — automatic conversation→fact extraction. Плагин OpenCode: hook на end of session → LLM extract facts from transcript → facts.md → MCP sync | high | done | H.20 | NEXT-002 | Mem0 |
| NEXT-021 | Plugin: memory-context-v2.ts — full auto-context injection. Плагин вызывает MCP search_knowledge сам и инжектирует РЕЗУЛЬТАТ в system prompt, не инструкцию | high | done | H.21 | NEXT-007 | Zep |
| NEXT-022 | Plugin: memory-profile.ts — auto-maintained user profile. Плагин: при каждом /remember → extract user-specific facts → profile_get/update → always-on context injection | medium | done | H.22 | NEXT-004 | Supermemory |

---

### Этап H — Competitive Edge (Gap Analysis)

- [x] NEXT-001: Temporal Knowledge Graph (bi-temporal, edge invalidation, point-in-time queries)
- [x] NEXT-002: Memory Extraction Pipeline (conversation→fact extraction, LLM-powered)
- [x] NEXT-003: Memory Evolution (new memories update existing, A-MEM style)
- [x] NEXT-004: User Profiles (auto-maintained, always-on context, ~50ms)
- [x] NEXT-005: Automatic Forgetting (TTL, contradiction resolution, noise pruning)
- [x] NEXT-006: Sleep-time/Dreaming Agent (async memory refinement)
- [x] NEXT-007: Smart Context Assembly (token-budget-aware context selection)
- [x] NEXT-008: Entity-linking Retrieval (third retrieval signal)
- [x] NEXT-009: Memory Conflict Resolution (LLM-based contradiction detection)
- [x] NEXT-010: Memory Scoping Multi-tenancy (user/agent/app/run dimensions)
- [x] NEXT-011: More Connectors (Google Drive, Gmail, Notion, OneDrive, Linear)
- [x] NEXT-012: Multimodal Ingestion (PDF, image OCR, video, code AST)
- [x] NEXT-013: Benchmark Participation (LOCOMO 5/5, LongMemEval 3/5, BEAM 5/5, DMR 5/5 — docs/benchmarks/results-2026-09-03.md)
- [x] NEXT-014: Graph Visualization UI (interactive knowledge graph)
- [x] NEXT-015: Cross-Framework Portability (LangGraph/AutoGen/CrewAI adapters)
- [x] NEXT-016: Async Memory Operations (non-blocking + webhooks)
- [x] NEXT-017: Memory Layers (conversation/session/user three-tier)
- [x] NEXT-018: Observations/Pattern Detection (graph-based pattern surfacing)
- [x] NEXT-019: Plugin: memory-dream.ts (background memory refinement)
- [x] NEXT-020: Plugin: memory-extract.ts (auto conversation→fact extraction)
- [x] NEXT-021: Plugin: memory-context-v2.ts (full auto-context injection)
- [x] NEXT-022: Plugin: memory-profile.ts (auto-maintained user profile)

---

## Этап I — Wire-in & Integration (контроль качества)

> Код написан и протестирован, но НЕ подключён к серверу. Нужно wired в app-container / connector registry / HTTP transport.
> Источник: аудит 2026-09-02 — модули есть, тесты проходят, но MCP-клиент их не увидит без регистрации.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости | Что делать |
|----|--------|-----------|--------|---------|-------------|------------|
| WIRE-001 | Wire новые connectors (GDrive, Gmail, Notion, OneDrive, Linear, Web Crawler) в connector registry — зарегистрировать в `src/connectors/index.ts` + `src/connectors/registry.ts` | high | done | I.1 | INT-004 | Смержено 2026-09-03 (cb13fea/9921dad) |
| WIRE-002 | Wire RealtimeServer в HTTP transport — `getRealtimeServer().attach(httpServer, '/ws')` в `src/transport/http-transport.ts` | high | done | I.2 | MR-012 | Смержено 2026-09-03 (cb13fea) |
| WIRE-003 | Wire ClusterManager в app-container — register self node, start heartbeat, expose cluster tools | medium | done | I.3 | SCALE-002 | Смержено 2026-09-03 (d533e8e/24e5f6d): app-container wiring + register/cluster.ts (cluster_status/nodes/join), 5 tests |
| WIRE-004 | Wire multimodal ingestion — MCP tool `knowledge_import_multimodal` в `src/register/memory.ts` или `src/register/markdown.ts` | medium | done | I.4 | NEXT-012 | Смержено 2026-09-03 (896ecc5/1643e77): knowledge_import_multimodal (extract-only, DATA_DIR jail), 3 tests |
| WIRE-005 | Wire graph visualization — MCP tool `graph_visualize` в `src/register/` | low | done | I.5 | NEXT-014 | Смержено 2026-09-03 (35e1095/b343b86): graph_visualize (entity subgraph/query render), 3 tests |
| WIRE-006 | Wire framework adapters — MCP tool `memory_framework_adapter` или экспорт через REST wrapper | low | done | I.6 | NEXT-015 | Смержено 2026-09-03 (e6585e4/468be5f): memory_framework_adapter descriptor (langgraph/autogen/crewai/langchain), 2 tests |
| WIRE-007 | Wire benchmark harness — MCP tool `memory_benchmark_run` | low | done | I.7 | NEXT-013 | feat/wire007-benchmark-harness-tool — tool в src/register/memory.ts, runAllBenchmarks() + EphemeralBenchmarkAdapter, 6 tests |
| WIRE-008 | Wire async ops — MCP tools `memory_async_submit` / `memory_async_status` / `memory_async_cancel` | medium | done | I.8 | NEXT-016 | Смержено — feat/wire008-async-ops-tools (2026-09-03): обёртка над AsyncJobManager, 5 default processors (extract/search/bulk_import/evolve/dream) |
| WIRE-009 | Заполнить stub connectors реальными API-вызовами (GDrive, Gmail, Notion, OneDrive, Linear) | low | done | I.9 | WIRE-001 | Реализовано 2026-09-03 на feat/wire009-real-connector-apis (реальные HTTP к Drive v3 / Gmail v1 / Notion v1 / Graph v1.0 / Linear GraphQL, fail-closed err, 20 hermetic-тестов) |
| SEC-003 | Wire AuthManager в HTTP/TCP transport — auth-гейт на tools/call + fail-closed по дефолту (PROD-002 нашел: AuthManager не завайрен, http-transport без проверок) | high | done | I.10 | A-002 | Завайрено 2026-09-03: auth-gate.ts + mcp.authenticate + AppContainer.getAuthManager, branch feat/sec003-wire-authmanager-http-tcp |

---

### Этап I — Wire-in & Integration

- [x] WIRE-001: Wire новые connectors в registry
- [x] WIRE-002: Wire RealtimeServer в HTTP transport
- [x] WIRE-003: Wire ClusterManager в app-container
- [x] WIRE-004: Wire multimodal ingestion MCP tool
- [x] WIRE-005: Wire graph visualization MCP tool
- [x] WIRE-006: Wire framework adapters
- [x] WIRE-007: Wire benchmark harness MCP tool
- [x] WIRE-008: Wire async ops MCP tools
- [x] WIRE-009: Заполнить stub connectors реальными API

---

## Этап J — Усиление памяти и продукта (NEXT-2.0)

> Аудит 2026-09-02: из 12 набросанных пунктов 6 подтверждены кодом, 4 закрыты как лишние (дублируют существующее), 2 переформулированы.
> **Закрытые как лишние:** NEXT2-001 (LLM в сервере — задача агента), NEXT2-002 (memory-only = ACL-политика, есть DX-002), NEXT2-006 (MCP сам SDK, есть api-client + framework-adapters), NEXT2-011 (экспорт в форматы конкурентов — никому не нужно).
> **Вердикт:** остаётся 7 реальных задач.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости | Обоснование |
|----|--------|-----------|--------|---------|-------------|-------------|
| NEXT2-003 | Graph visualization page в web-ui: route `/graph` — рендер knowledge graph (graph-viz.ts) с данными из entity-graph/temporal-graph | medium | done | J.3 | NEXT-014, UI-001 | feat/next2003-graph-viz-page: app/graph/page.tsx + memory api client, tsc+build clean |
| NEXT2-004 | Memory browser page в web-ui: route `/memory` — просмотр extracted facts, temporal history, profiles, layers | medium | done | J.4 | NEXT-002, UI-001 | feat/next2004-memory-browser-page — 4 таба, typecheck+build clean |
| NEXT2-005 | Realtime в web-ui: страницы слушают WebSocket (live-updates задач/знаний) | medium | done | J.5 | WIRE-002, UI-005 | feat/next2005-realtime-webui: lib/realtime.ts + tasks/knowledge live-merge |
| NEXT2-007 | Benchmark runner CLI: `npm run benchmark` — запуск LOCOMO/LongMemEval/BEAM/DMR против реального инстанса, markdown-отчёт | medium | done | J.7 | NEXT-013 | branch feat/next2007-benchmark-runner-cli (pushed, no PR); dev-cli `benchmark` + MCPMemoryAdapter, 18/20 live |
| NEXT2-008 | npm publish pipeline: пакет НЕ опубликован на npm (проверено 2026-09-02), MR-010 значится done но publish не настроен. GitHub Actions workflow: tag → npm publish + GHCR | high | done | J.8 | MR-010 | feat/next2008-npm-publish-pipeline: .github/workflows/publish.yml + publishConfig |
| NEXT2-009 | Fuzzing для memory modules: fast-check property tests для extraction, temporal-graph (временные инварианты), scoping (комбинаторика) | low | done | J.9 | Q-008, NEXT-001 | tests/memory-fuzz.test.ts: 8 property-тестов (extraction bounds/confidence, temporal add/invalidate/supersede, scoping determinism/consistency) |
| NEXT2-010 | Perf-тесты для memory tools: latency (<50ms retrieval, <200ms extraction). НЕ CI gate — просто benchmark | low | done | J.10 | NEXT2-007 | tests/memory-perf.test.ts: extract/100-sent + entity-retrieve/500 + temporal-add200 с loose bounds, latencies в stdout (entity 5ms, temporal 74ms) |
| NEXT2-012 | Quickstart-to-production guide: полный пример «от установки до продакшена» (Docker + auth + web-ui) в docs/ | low | done | J.12 | D-001 | docs/quickstart-production.md: compose + JWT fail-closed + smoke + prod checklist |

---

## Блокированные

---

### Этап J — Усиление памяти и продукта

- [x] NEXT2-001: LLM-экстрактор — закрыто (AD: извлечение = задача агента, не сервера)
- [x] NEXT2-002: Memory-only mode — закрыто (дублирует ACL + DX-002 namespaces)
- [x] NEXT2-003: Graph visualization page в web-ui (/graph)
- [x] NEXT2-004: Memory browser page в web-ui (/memory)
- [x] NEXT2-005: Realtime в web-ui (страницы слушают WebSocket)
- [x] NEXT2-006: TS SDK — закрыто (MCP сам SDK, есть api-client + framework-adapters)
- [x] NEXT2-007: Benchmark runner CLI (npm run benchmark)
- [x] NEXT2-008: npm publish pipeline (publish.yml: tag → npm + GHCR)
- [x] NEXT2-009: Fuzzing для memory modules (fast-check property tests)
- [x] NEXT2-010: Perf-тесты для memory tools (latency benchmark, не CI gate)
- [x] NEXT2-011: Экспорт в форматы конкурентов — закрыто (никому не нужно)
- [x] NEXT2-012: Quickstart-to-production guide в docs/

---

## Блокированные

| ID | Задача | Причина | Статус |
|----|--------|---------|--------|
| MR-012 | Real-time collaboration (WebSocket) | done (дубль строки 295; WIRE-002 завайрен 2026-09-03) |

---

## Этап K — Full-server E2E

> Сквозные end-to-end тесты на весь функционал сервера — один погруженный клиент проходит все подсистемы как в проде.
> Отличие от Q-004 (E2E core tools) и SYNC-005 (E2E durability): здесь покрывается ВЕСЬ сервер целиком, все транспорты и все семейства инструментов.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости | Что делать |
|----|--------|-----------|--------|---------|-------------|------------|
| Q-014 | Full-server E2E: один e2e-сьют поднимает сервер и гоняет весь функционал — транспорты (stdio/HTTP/TCP + WS realtime), auth (authenticate → JWT → ACL deny/allow, fail-closed), сессии (TTL/idle/rate-limit), задачи (CRUD/hierarchy/DAG), знания (CRUD/search BM25+vector+FTS5), память (extract/evolve/profile/context), skills/rules/workflows CRUD+execute, sync (delta/snapshot/merge), cluster/sharding, connectors registry, dashboard/metrics endpoints. Запуск: `npm run e2e:full` (CI nightly, не gate). Требование: hermetic (эфемерные порты, tmp DATA_DIR), deterministic (fake timers где тайминги) | medium | done | K.1 | Q-004, SYNC-005, SEC-003, WIRE-002 | `tests/e2e-full/` 20 files / 58 tests green в Docker (слайсы 1-21). Слайсы 15-21 (S-20260911-e2ec): projects lifecycle+purge, tasks bulk+DAG, knowledge lifecycle+import/export, memory extended (profiles/layers/scopes/context/entity/evolve/conflicts/gc/observations/dream/async-jobs/adapter/benchmark), prompts experiments+A/B+exports+catalog, misc surface (session/cluster degraded, embeddings, tool_help, graph exports, trends, tools_run, relay), все 9 connector families. E2e нашли и исправили 3 prod-бага: REPO_ROOT→dist (prompts reindex мёртв в prod), memory_scope_filter затирал scope, exportCatalog терял metadata (status/domain/tag-фильтры prompts_list были мёртвы). Новые гэпы: StreamableHTTP-сессии не в SessionManager (session_info по живой сессии недостижим), scripts/ не в npm files (reindex в пакете не работает). Вне hermetic scope: multi-node sharding, ONNX-vector режимы, реальные вызовы коннекторов (нужны credentials) |

---

## Этап L — Prod Hardening (доведение до прод-состояния)

> План по итогам Q-014 аудита (S-20260911-e2ec): найденные prod-баги исправлены, остались мёртвый функционал, архитектурные гэпы и CI-хрупкость.
> Каждая задача = одна ветка + один PR (правило последовательных инкрементов).

### Фаза 1 — Реанимация мёртвого функционала (блокеры для prod-пользователей)

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| PH-001 | Prompts pipeline in-process / npm-пакет | high | done | — | `scripts/` не в npm `files` → reindex мёртв в установленном пакете. Переписать цепочку index→catalog→export→build как in-process сервис `src/services/prompts-pipeline.ts` (spawn node → вызов функции), `scripts/prompts.mjs` оставить тонкой CLI-обёрткой. Проверка: `npm pack` → установка → `prompts_list` после `bulk_create` |
| PH-002 | SessionManager ↔ StreamableHTTP wiring | high | done | — | HTTP-сессии не регистрируются в SessionManager → `session_list` пуст, `session_info` по живой сессии недостижим, per-session rate-limit не работает. Подключить sessionId из initialize-рукопожатия StreamableHTTP к SessionManager. e2e: authenticate → session_list показывает сессию, session_info по id, rate-limit счётчики |
| PH-003 | TCP ToolExecutor (S-002) | high | done | PH-002 | Per-connection TCP-сессии без tools (stream-transport `registerTools` no-op). Реализовать ToolExecutor для stream-transport: tools/list + tools/call по TCP. e2e: initialize → tools/list непустой → tasks_create roundtrip |

### Фаза 2 — Консистентность API и поверхности

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| PH-004 | Семантика current project (session-scoped) | medium | done | PH-002 | Глобальный `current` — shared mutable state: один агент `set_current` ломает default для всех подключённых. После PH-002 сделать current per-session (SessionManager), stdio-режим — single-session. Schema-default `'mcp'` не трогаем (обратная совместимость); явный `project` остаётся главным контрактом. Задокументировать в docs |
| PH-005 | Унификация error-стиля handlers | low | done | — | `project_purge` и другие бросают raw `Error` (protocol error) вместо `{ok:false}` envelope. Аудит всех `throw` в `src/register/*`, перевести на `err()` где это доменная ошибка, оставить throw только для протокольных |
| PH-006 | Connector expose-mode + registry visibility | medium | done | — | Два режима через env `CONNECTOR_EXPOSE_MODE=tools|resources|both` (default `both`): read-only операции (list/get/sync-status) также как MCP resources; mutations только tools (resources не умеют мутации — ограничение протокола). Плюс: регистрация через ToolRegistry →`tools_list`/`tool_help`/`tools_catalog` видят connector tools (сейчас blind spot). Обновить connectors-all e2e на оба режима |

### Фаза 3 — Memory multi-tenancy (полная изоляция)

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| PH-007 | Scope write-path для temporal facts | medium | done | — | `memory_temporal_add`/`memory_extract`(persist)/`memory_layer_add` принимают `scope{userId,agentId,appId,runId}` → факты хранят scope → `scope_filter` реально изолирует tenant'ов. e2e: факты tenant A невидимы при фильтре tenant B; unscoped остаются глобальными |

### Фаза 4 — CI / инфрагигиена

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| PH-008 | ESLint warnings sweep | medium | done | — | ~998/1000 warnings — любой новый `any` роняет линт. Пройтись по top-offenders (`no-explicit-any`, `no-unused-vars`, `no-useless-assignment`) → цель <700, либо осознанно поднять cap с планом снижения |
| PH-009 | Node 22/24 compatibility | medium | done | — | GHA форсит actions на Node 24 (deprecation warnings). Проверить `npm test`/`npm run e2e:full` на node:24, починить несовместимости, поднять `engines`/CI-matrix |
| PH-010 | Env-gated unit-тесты | low | done | — | `embeddings.cache` (model download), `new-connectors` webcrawler (network), `obsidian.roundtrip` — падают без сети/нативных зависимостей. Пометить `describe.skipIf(!process.env.NETWORK_TESTS)` / аналог |
| PH-011 | Добивка e2e-пробелов | low | done | — | `tasks_tree` — единственный registered tool без e2e-вызова; `memory_async_submit type:bulk_import` конкретно не дёрнут; session_info положительный путь после PH-002 |
| PH-016 | Безопасный пропуск proxy-образов в docker-build-base | medium | in_progress | — | На push workflow пропускал proxy-джобы слепо: один run-шаг с `exit 0` и условие `steps.skip-check.conclusion != 'success'` на всех следующих шагах. После перехода на Node 24 тег `mcp-node:24-bullseye` не публиковался, 6 base-джоб падали с `not found` (прогон 42070606130), лечилось ручным `workflow_dispatch` (42083930937). Решение: пропуск сохранён, но до проверки выполняется логин в GHCR, а наличие тега проверяет `docker buildx imagetools inspect`: образ есть — пропуск, нет (`not found`/404) — сборка и публикация на этом push, прочая ошибка (права/сеть/5xx) — падение с `::error::` и подсказкой `workflow_dispatch`. `max-parallel`, триггеры, матрица, теги, build-args и пины actions не менялись. Проверено: actionlint exit 0, разбор YAML, заглушка `docker` на трёх сценариях (есть/404/403), `npm run lint:md`, `npm run backlog:check`. Боевой прогон — за контролёром. Пересечение по смыслу: DX-31 (там осталось «опубликовать mcp-node:24-*»). |

### Фаза 5 — Расширенное покрытие (опционально)

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| PH-012 | Connector contract-тесты через mock-HTTP | low | pending | PH-006 | nock/msw-стабы GitHub/Jira/Slack API → реальные вызовы без credentials, проверка payload-маппинга и error-paths — без новых зависимостей: через встроенный undici MockAgent (nock/msw не добавлять). |
| PH-013 | ONNX/vector e2e job | low | pending | — | Отдельный nightly-job с `EMBEDDINGS_MODE=local`, кэш модели в CI; сейчас vector-пути только unit-спеками |
| PH-014 | WS realtime + MCP resources e2e | low | pending | PH-002 | WS relay с реальным пиром; `resources/list`, `resources/read`, `prompts/get` protocol surface |

### Фаза 6 — Web UI (GUI до ума)

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| PH-015a | CORS в http-transport | high | done | — | `MCP_CORS_ORIGIN` env (list/`*`), OPTIONS-preflight 204, `Access-Control-Expose-Headers: mcp-session-id`, foreign origin → 403. e2e в http-sessions.test.ts |
| PH-015b | api-client → SDK StreamableHTTP | high | done | PH-015a | `web-ui/lib/api-client.ts` переписан на `Client` + `StreamableHTTPClientTransport`: initialize → mcp-session-id reuse → опциональный `mcp.authenticate` (env `NEXT_PUBLIC_MCP_TOKEN` или runtime `setAuthToken` через sessionStorage). Singleton per tab, retry после failed connect |
| PH-015c | Полный MCP-стек в GUI | high | done | PH-015b | + `/projects` (list/create/set-current session-scoped), `/system` (sessions live, embeddings, tools catalog + auth token UI), tasks DAG (critical path/topo order/edges), knowledge edit-update fix (bulk_update вместо дубля create) + trash, prompts page на shared client + каталог (version/status/domain) + A/B (variants_stats + bandit_next), analytics через `dashboard_stats` с fallback, tool-имена/аргументы выверены по register-сигнатурам |
| PH-015d | web-ui тесты + CI | medium | done | PH-015b | vitest в web-ui: 35 тестов (18 realtime helpers + 14 api-client mock-SDK + 3 live env-gated `MCP_LIVE_URL`/`MCP_LIVE_JWT_SECRET` против реального сервера — проверены в docker). Workflow `web-ui.yml`: build server → web-ui typecheck → unit → live vs spawned `dist/index.js` http+JWT → next build |

---

## Этап M — Аудит request-path: баги и безопасность (2026-09-11)

> Источник: ручной аудит request-path (transports → auth → ACL → handlers) в сессии S-20260911-aud1.
> Ключевой паттерн: security-модули написаны и протестированы, но **не завайрены** в реальный request path
> (ноль call sites вне собственных файлов). Формат severity: crit = без auth / потеря данных, high = с auth.
> Каждая задача = одна ветка + один PR (правило последовательных инкрементов).

### Фаза 1 — Critical (неаутентифицированный доступ)

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| AUD-01 | Гейтить все MCP-методы, не только tools/call | critical | done | — | `authorizeHttpCall` (http-transport.ts:84) и `dispatchToMain` (stream-transport.ts:317) пропускают resources/list+read, prompts/list+get, completion/complete без auth. При requireAuth=true неаутентифицированный клиент: initialize → resources/read → читает task://knowledge://prompt://. Гейтить весь MAIN_DISPATCH_METHODS; pre-auth whitelist — только initialize/ping/authenticate |
| AUD-02 | Убрать мутации из resources/read | critical | done | AUD-01 | `task://action/{project}/{id}/{action}` вызывает updateTask/closeTask/trashTask/restoreTask/archiveTask через READ-эндпоинт (register/resources.ts:43-56,136-217). Мутации — только через гейтованные tools; resource handlers — read-only |
| AUD-03 | Path traversal: валидация project/id | critical | done | — | `project`/`id` = `z.string()` без whitelist → `path.join(TASKS_DIR\|KNOWLEDGE_DIR\|PROMPTS_DIR, project, id)` (storage/tasks.ts:10,29, knowledge.ts:11,67). Чтение/запись произвольных .json/.md вне DATA_DIR. Работает через tools/call (post-auth) и resources/read (pre-auth). Фикс: regex `[a-zA-Z0-9_-]+` на register-границе + `path.resolve` + startsWith(DATA_DIR) в storage |

### Фаза 2 — High (аутентифицированные)

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| AUD-04 | Session hijack через session_list | high | done | AUD-07 (admin-роль) | `session_list` отдаёт все живые session id любому аутентифицированному (register/session.ts:100); подстановка чужого `mcp-session-id` в header = имперсонация (http-transport.ts:164). Фикс: session_list/info — только своя сессия или admin-роль; биндинг session→remote при authenticate **Проверено живым сервером (S-20261030-prodaudit, tests/e2e-full/aud-high-security.test.ts).** |
| AUD-05 | Expiry реально прекращает доступ | high | done | — | `prune()` удаляет только запись SessionManager: SDK-транспорт в `adapter.sessions` жив + `authenticatedSessions` не чистится → TTL/idle/token-exp мёртвы, «закрытая» сессия работает дальше. Фикс: onClose → transport.close() + `authManager.revokeSession(id)`; гейт проверяет `sm.has(sessionId)` **Проверено живым сервером (S-20261030-prodaudit, tests/e2e-full/aud-high-security.test.ts).** |
| AUD-06 | WS realtime: auth + фильтры | high | done | — | `/ws` без auth (realtime.ts:46); клиентский `broadcast` принимает произвольные eventType/data → инъекция событий всем; клиент без project получает события всех проектов (фильтр :141). Фикс: токен при handshake, whitelist клиентских типов, no-subscription = no-events **Проверено живым сервером (S-20261030-prodaudit, tests/e2e-full/aud-high-security.test.ts).** |
| AUD-07 | Завайрить security-стек | high | done | — | Мёртвые модули (0 call sites): AuthProtection (SEC-005), InputSanitizer (SEC-006), ACLEngine (ACL-002/003, `ctx.acl` не создаётся), audit middleware (SEC-001), rule enforcement (RL-005), logging middleware (MW-003), RateLimiter.consume (S-003). Единая точка в wrapToolHandler/dispatch: protection.check → rateLimit.consume → acl.evaluate → audit. Каждая фича — e2e «реально срабатывает» **Проверено живым сервером (S-20261030-prodaudit, tests/e2e-full/aud-high-security.test.ts).** |

### Фаза 3 — Medium

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| AUD-08 | HTTP body cap + session cap | medium | done | — | POST body без лимита (http-transport.ts:167) → memory DoS; SM maxSessions обходится — transport попадает в `sessions` до `sm.create` (reject ловится, транспорт живёт). Фикс: Content-Length/maxBytes лимит; при SM-reject — transport.close() **Закрыто (S-20261030-prodaudit): MCP_MAX_BODY_BYTES в http-transport.ts (код проверен 2026-10-30).** |
| AUD-09 | Unix socket: права + опциональный auth | medium | done | — | Сокет без chmod + requireAuth=false → любой локальный юзер = полный доступ (stream-transport.ts:478, auth-gate.ts:60). Фикс: chmod 600; опционально requireAuth для unix **Закрыто (S-20261030-prodaudit): chmod 600 unix-сокета, stream-transport.ts (код проверен 2026-10-30).** |
| AUD-10 | tools_run/tools_batch: gated handler + scope | medium | done | — | Registry хранил raw handler → вызов без requestScope/auth/SecurityStack; исполнял tools при TOOLS_ENABLED=0. Фикс: registry хранит gated handler (setup.ts ×4 + app-container connector path через ctx.gateToolHandler), tools_run/tools_batch форвардят SDK extra (sessionId) и рефузят non-whitelist при TOOLS_ENABLED=0. Закрывает и TR-15. Тесты: tests/aud10-tools-run-gate.test.ts |
| AUD-11 | JWKS: kid-selection + cache TTL | medium | done | — | `resolveKey()` вызывает `jwksResolver()` без (protectedHeader, token) → kid не участвует → мульти-ключевой JWKS ломает валидацию (jwt-validator.ts:398). `jwksCacheTtl` — мёртвая опция. Фикс: `jwtVerify(token, jwksResolver, opts)`, передать cacheMaxAge  Реализовано: `jose.jwtVerify(token, createRemoteJWKSet-resolver)` — kid-selection и cacheMaxAge из `jwksCacheTtl`. Тесты: tests/aud11-jwks.test.ts (8); проверено откатом. |
| AUD-12 | Гигиена error-сообщений | medium | done | — | `e.message` уходит клиенту (auth-gate.ts:180, http-transport.ts:354, register/auth.ts:51) — внутренние пути/детали наружу. Фикс: наружу generic message, детали в server log  Реализовано: наружу generic 'internal error' + полный error в лог (auth-gate, register/auth); AuthError-сообщения контролируемые. Тесты: tests/aud-hardening.test.ts (AUD-12); проверено откатом. |
| AUD-13 | Rate-limit на mcp.authenticate | medium | done | AUD-07 | Брутфорс токена не ограничен; identity=sessionId → новый initialize = чистый счётчик. Фикс: AuthProtection по remote IP  Реализовано: AuthProtection в AuthManager по remote IP (port strip), создаётся безусловно в app-container. Тесты: tests/aud-hardening.test.ts (AUD-13); проверено откатом. |

### Фаза 4 — Low

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| AUD-14 | pendingInitRemotes — per-request map | low | done | — | FIFO-очередь мисатрибутит remote при параллельных initialize и течёт при неудачных init (http-transport.ts:60,202,265)  Реализовано: remote передаётся параметром в createSessionTransport (FIFO-очередь удалена). Тесты: tests/aud14-16-17.test.ts (AUD-14; leak-тест после failed init с разных loopback-IP); проверено откатом. |
| AUD-15 | revokeSession на close/prune | low | done | AUD-05 | `authenticatedSessions` растёт бесконечно, stale marks (auth.ts:160)  Реализовано: validateToken() без session-mark для WS + revokeSession в onClose (http/stream). Новый тест: tests/aud-hardening.test.ts (real /ws handshake → authenticatedCount 0); проверено откатом. |
| AUD-16 | JWT blacklist: eviction по exp + persist | low | done | — | Count-based eviction де-ревокает старые jti после 10k; рестарт снимает все ревокации (jwt-validator.ts:311)  Реализовано: Map<jti,exp>, exp-based eviction, persist в DATA_DIR/.jwt-revoked.json (app-container). Тесты: tests/aud14-16-17.test.ts (AUD-16); проверено откатом (eviction и persist отдельно). |
| AUD-17 | TLS: завайрить или дропнуть | low | done | — | `createTlsContext`/`TlsContext` — ноль вызовов (SEC-002 мёртв, транспорты plaintext). Либо wire в http/tcp adapters, либо честно пометить deferred **Закрыто (S-20261030-prodaudit): createTlsContext вызывается из http/stream-transport (код проверен 2026-10-30).** |

### Фаза 5 — Следующий аудит

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| AUD-18 | Аудит data-path (storage → sync → search → memory) | high | blocked | Проработка (research): промпт и скоуп аудита data-path (storage→sync→search→memory) с инвариантами | Request-path проаудирован, data-path — нет. Тем же промптом: гонки read-modify-write в `writeJson`, crash-окна, 3-way merge в `src/sync/`, GC event-log не съедает живое, FTS5/BM25 injection, изоляция scope (tenant A vs B). Находки → новый этап задач |

---

## Этап N — DX/Onboarding: развёртывание и первые 5 минут (2026-09-11)

> Цель: путь «установил → подключил агента → получил ценность» без ручной правки JSON
> и без гадания. Сейчас: `npm i -g` + ручной merge конфига клиента, `dev-cli.mjs`
> не шипится в npm (только repo scripts/).
>
> **Правило:** новые MCP-tools (DX-12/13/15) — сначала design review, регистрировать
> в ToolRegistry только финальный контракт. Ничего сырого наружу.
>
> **Зависимость этапа:** DX-10/DX-11 осмысленны после crit-фазы Этапа M
> (AUD-01/02/03) — не подключать wizard'ом к незащищённому серверу.

### Фаза 1 — Установка и диагностика (ядро)

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| DX-10 | `mcp-task-knowledge setup` — интерактивный установщик | high | done | AUD-01, AUD-03 | Бинарь в `dist/` (работает из npx): детект клиентов по конфиг-путям (Claude Desktop, Cursor, Windsurf, VS Code, Claude Code), вопросы (транспорт/DATA_DIR/auth), идемпотентный merge в `mcpServers` с бэкапом, финал — self-check: спавн stdio → `tools/list` → «✓ 114 tools» + cheatsheet. Флаг `--client X --yes` для CI |
| DX-11 | `mcp-task-knowledge doctor` — диагностика | high | done | — | Node ≥20, DATA_DIR существует/writable, конфиг валиден, порт свободен, клиентский конфиг ссылается на живой бинарь. Это же health-gate в конце setup |
| DX-26 | CLI surface polish | low | pending | DX-10 | `--help`, `ui` (http + open browser), `config show` (эффективный конфиг: env > file > defaults), `init --demo` (seed sample-проект), `uninstall` (вычистить клиентские конфиги), actionable errors («порт занят → --port», «DATA_DIR не writable → …») |
| DX-29 | Setup-link: одноразовая ссылка самонастройки агента | high | pending | AUD-07, AUD-05, DX-12 | Web UI: «Сгенерировать ссылку» → scope (project, role, TTL токена). Backend: `POST /admin/setup-links` → `{url, expiresAt}`; `GET /.well-known/mcp-setup/<otp>` → one-time reveal markdown-док для агента: server URL, transport, выданный scoped JWT, инструкции самонастройки (агент знает формат своего клиента), capabilities, default project. Security: TTL ссылки ~15мин, one-time reveal, rate-limit redemption, audit-log на create+redeem, токен scoped (project+role+exp). Stdio-вариант: doc отдаёт npx-snippet + env. Дублировать как MCP-tool `admin_setup_link` для админов без Web UI. Спековая альтернатива — OAuth DCR, оценить при дизайне |

### Фаза 2 — Первые 5 минут после подключения

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| DX-13 | `briefing` tool — контекст одним вызовом | medium | done | — | Один вызов вместо пяти в начале сессии: текущий проект, открытые задачи по приоритету, последние knowledge-доки, блокеры. Собрано из listTasks/listDocs/isTaskBlocked. Реализовано в src/register/briefing.ts, 11 тестов green |
| DX-14 | Seed workflow-промптов в поставку | medium | pending | — | Prompts-library пуста. Шипить 5-7 готовых (`plan_sprint`, `capture_decision`, `standup`, `postmortem`, `daily_review`) — видимая ценность через `prompts/list` сразу + учит агента паттернам |
| DX-12 | `agent_bootstrap` tool — самоинтеграция агента | medium | blocked | Проработка (design): design review контракта agent_bootstrap до регистрации в ToolRegistry | Tool возвращает готовый блок инструкций для AGENTS.md/system prompt («всегда передавай project, контракт ok/error, ключевые tools»). Design review до регистрации |
| DX-15 | `server_capabilities` manifest | low | blocked | Проработка (design): design review контракта server_capabilities (поля, лимиты) до регистрации | Какие домены включены/выключены env-флагами, версия, лимиты — агент не гадает и не ловит `tool not found` на выключенных фичах. Design review до регистрации |

### Фаза 3 — Данные как актив (backup/restore/integrity)

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| DX-16 | `admin_backup`/`admin_restore` — tar.gz DATA_DIR | high | done | [ADR-008](docs/adr/0008-admin-backup-restore.md) | Tool + CLI-обёртка, переносимый tar.gz архив DATA_DIR по ADR-008. Формулировка «dev-cli export умеет 80%» неверна: команда не копирует файлы и работает с пустым временным DATA_DIR (проверено 2026-11-06), обёртка пишется с нуля. Ответ на «где мой бэкап» и «как переехать на другую машину». Реализация делится на DX-16a и DX-16b |
| DX-16a | `admin_backup` + формат архива DATA_DIR | high | done | DX-16 | По ADR-008: свой writer tar.gz на node:zlib без новых зависимостей, манифест с formatVersion/sha256/profile/schemaVersion, исключение секретов и кешей, флаг include-secrets, атомарная запись через .partial. CLI backup поверх той же функции, DATA_DIR из env. DoD: round-trip backup→reader даёт побайтное равенство (restore — DX-16b); в архиве нет .jwt-revoked.json и auth.db без флага; повреждённый архив даёт BACKUP_ARCHIVE_INVALID; запись ../ даёт BACKUP_PATH_ESCAPE; симлинк даёт BACKUP_SYMLINK_REJECTED; revert-check каждого теста. Реализовано: src/services/backup-archive.ts, src/register/backup.ts, scripts/dev-cli.mjs backup; тесты tests/dx16-backup-archive.test.ts (21 тест, revert-check 21/21 RED); [ADR-008](docs/adr/0008-admin-backup-restore.md) с «Поправкой» про archiveBytes |
| DX-16b | `admin_restore` + ужесточение существующего restoreBackup | high | done | DX-16, DX-16a | По ADR-008 и дефектам Д1-Д5 (file:line в ADR): не доверять entry.from из манифеста (resolveUnder), отвергать симлинки, не перезаписывать .jwt-revoked.json, restore как замена в пределах scope с prune, dry-run по умолчанию + confirm + автоснапшот pre-restore, .restore.lock между процессами. DoD: restore не пишет вне DATA_DIR; отзыв токена после бэкапа не исчезает; документ, созданный после бэкапа, удаляется при prune; R12: knowledge_list до и после restore совпадает Реализовано: src/services/data-backup.ts (restoreArchive, acquireRestoreLock, ужесточённый restoreBackup), src/services/backup-archive.ts (исключения .server.lock/.restore.lock/.restore-tmp), src/register/backup.ts (admin_restore), scripts/dev-cli.mjs restore (export удалён); тесты tests/dx16b-admin-restore.test.ts (27) и tests/dx16b-cli-restore.test.ts (2), revert-check 25/25 RED→GREEN, включая M2 (неверный/устаревший applyToken) и M2b (повторная сверка плана под lock). R12: после restore побайтное равенство data-файлов проверено inventory-сравнением в round-trip тесте (живой tools/list knowledge_list отдельно не дёргался). Проба Д1-Д6 на 902d1e3: все шесть воспроизведены. Решение: docs/dev-cycle/decisions/2026-11-07-0117-dx-16b.md. R12-долг: живой knowledge_list до/после — за контролёром. |
| DX-17 | `doctor --data` — скан целостности DATA_DIR | medium | done | DX-11 | Все `*.json`/`*.md`: битый JSON, missing required fields, knowledge-сироты без проекта. Read-only отчёт + `--fix` для тривиального |
| DX-18 | Schema-version манифест + миграции | medium | done | — | `DATA_DIR/.schema-version`; при смене формата task JSON / frontmatter — миграция при старте или явная ошибка. Иначе апгрейд пакета молча криво читает старые данные |
| DX-19 | Auto-backup перед деструктивными операциями | medium | done | DX-16 | `project_purge`, bulk-ops, GC event-log → снапшот в `DATA_DIR/.backups/` перед выполнением. Copy дёшево, «oops» превращается в откат |

### Фаза 4 — Дистрибуция без Node.js

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| DX-20 | Single-binary PoC (Node SEA / pkg-форк) | low | blocked | Проработка (research): PoC-отчёт по сборке: bun:sqlite вместо better-sqlite3 и доставка libonnxruntime.so | Research+PoC: `mcp-task-knowledge.exe` без требования Node ≥20. Убирает класс проблем «npm не найден / старый node / медленный npx». **PoC (2026-09-12): `bun build --compile` работает** — 676 modules/250ms/100MB, initialize OK. Найдено: better-sqlite3 падает в $bunfs (bindings), но он мёртвый код → замена bun:sqlite (FTS5 OK); onnxruntime: .node инлайнится, libonnxruntime.so.1 — нет (нужен LD_LIBRARY_PATH или копия .so рядом). Вывод: для EMBEDDINGS_MODE=none single-binary реален |
| DX-21 | Homebrew formula / Scoop manifest | low | pending | DX-20 | Если бинарь получился — генератор формулы в release CI |
| DX-22 | Cold-start stdio: lazy-load тяжёлых подсистем | medium | done | — | Замерить время до первого ответа; ONNX/vector не тянуть на старте при `EMBEDDINGS_MODE=none`. Для stdio старт = UX каждой сессии агента; цель <500мс. **Done (2026-09-12):** TTFB median ~407-420ms (было ~483-540ms). Lazy: onnxruntime-node/web + @xenova/transformers (vector.ts, уже были), prom-client→initMetrics async (54ms), jose→JwtValidator/createTestToken (59ms), ws→realtime.js (36ms). Eager остаётся: MCP SDK, zod, fast-glob, gray-matter, pino — все <20ms. Regression guard: tests/cold-start.test.ts (median of 3, hard-fail <2000ms, логирует факт) |
| DX-27 | Публикация в official MCP registry | medium | pending | DX-10 | `server.json` + publish в `modelcontextprotocol/servers` → установка из UI клиента без конфиг-файлов вообще. Высшая форма DX |

### Фаза 5 — Доверие и проверяемость

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| DX-23 | MCP Inspector в CI | medium | done | — | Автоматизировать `npx @modelcontextprotocol/inspector`: handshake, tools/list, протокольные ошибки. Ловит «наши тесты зелёные, но не по спеке» |
| DX-24 | Executable docs | medium | done | — | Скрипт прогоняет каждый bash/json-сниппет README/getting-started против реального пакета. README с враньём убивает первое впечатление |
| DX-25 | Клиентская compat-матрица | low | pending | — | Таблица «Claude Desktop ✓ / Cursor ✓ / Windsurf ?» + дата последней ручной проверки, обновляется при релизе |
| DX-28 | Contributor DX | low | pending | — | CONTRIBUTING.md, PR/issue-шаблоны, актуализация docs/architecture.md (после WIRE-находок может расходиться с кодом), опционально devcontainer |

### Фаза 6 — Runtime support (Node 24)

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| DX-31 | Node.js 24: CI, Docker, engines | high | done | — | Node 20 EOL (апрель 2026). `engines.node >=22.0.0`, `.nvmrc=24`; все workflow — Node 24 (primary), `node-compat` матрица `22.x`+`24.x`; Dockerfile/web-ui/Dockerfile/compose — `node:24-bullseye` / `node:24-alpine`, base-образы `mcp-node:24-*`; подняты actions: checkout v7, setup-node v7, upload-artifact v7, docker/login 4.6.0, setup-buildx 4.3.0, build-push 7.3.0, setup-qemu 4.3.0 (inputs не менялись; checkout v7 ломает только `pull_request_target`/`workflow_run` — у нас их нет). Проверено на Node 24.22.2: build, test:types, lint, `npm test` 259 файлов/3026 тестов, web-ui `tsc`+`npm test`; нативные модули better-sqlite3 12.11 (ABI 137) и onnxruntime-node 1.30 грузятся. Осталось: опубликовать `mcp-node:24-*` через docker-build-base |
| DX-32 | CI: пропуск загрузки CUDA-бинарей onnxruntime-node при npm ci | high | done | — | Причина: на linux/x64 у `onnxruntime-node@1.30` postinstall (`node ./script/install`) по умолчанию берёт манифест `cuda12` и качает `Microsoft.ML.OnnxRuntime.Gpu.Linux` с `api.nuget.org`; в CI дважды падал `npm ci` с ETIMEDOUT (jobs prompts-pipeline и compat 22.x), ретрай помогал. В `script/install-utils.js` флаг читается из `ONNXRUNTIME_NODE_INSTALL` (или `npm_config_onnxruntime_node_install`), значение `skip` завершает install.js до скачивания; устаревший вариант `ONNXRUNTIME_NODE_INSTALL_CUDA` не использовать. CPU-библиотеки уже в npm-пакете, не бандлятся только CUDA-провайдеры. Где выставить: workflow-уровень `env: ONNXRUNTIME_NODE_INSTALL: skip` во всех job с `npm ci` (lint, web-ui, prompts-ci, prompts-sandbox-reindex, backlog-check, markdownlint-autofix, bulk-smoke, node-compat, publish); в `Dockerfile` — только CPU-стадии (`deps`), GPU-образ `runtime-onnx-gpu` обязан НЕ ставить skip: ему нужны `libonnxruntime_providers_cuda.so` и tensorrt, поэтому отдельный install с `ONNXRUNTIME_NODE_INSTALL=cuda12` (или без переменной) и проверка наличия библиотек. DoD: лог `npm ci` в CI не содержит обращений к `api.nuget.org` и `Microsoft.ML.OnnxRuntime.Gpu.Linux`; `rg -c "nuget.org" <job-log>` → 0; GPU-образ содержит `libonnxruntime_providers_cuda.so`; доки по установке (Docker/CI) объясняют переменную Реализовано (2026-10-31): `ONNXRUNTIME_NODE_INSTALL: skip` на всех root-install шагах workflows (lint, web-ui, prompts-ci, prompts-sandbox-reindex, backlog-check, markdownlint-autofix, bulk-smoke, node-compat, onnx-cpu-selfcheck, publish); в `Dockerfile` — `ARG/ENV ONNXRUNTIME_INSTALL=skip` в стадии `deps` (CPU), GPU-стадия `base-onnx-gpu-with-models` явно получает `ONNXRUNTIME_NODE_INSTALL=cuda12` и по-прежнему делает `npm rebuild onnxruntime-node` (CUDA-провайдеры остаются). Проверка: `unshare -rn` + install.js — с `skip` exit 0, `strace` 0 connect; без переменной — `ENOTFOUND api.nuget.org`; CPU без CUDA-библиотек грузит `ort.Tensor` и 41 тест (vector guard/autodetect/warmup/config) зелёный. В CI доказательство — строка шага «ONNX CUDA providers absent (ONNXRUNTIME_NODE_INSTALL=skip) — OK» (prompts-ci, node-compat) и отсутствие `api.nuget.org`/`Microsoft.ML.OnnxRuntime.Gpu.Linux` в логе. Скрипт/доки: `docs/deployment/docker.md`. |
| DX-33 | Убрать лишний бинарник GitHub CLI и служебное состояние агента из git | high | done | — | В `bin/` случайно закоммичен 42.7 MB ELF GitHub CLI 2.67.0 (коммит 9f949a1), не используется скриптами/workflows/Dockerfile; удалён и добавлен в `.gitignore`. Отслеживаемые `.opencode/goals/state.json.lock` и `state.json.sessions/**` сняты с индекса (`git rm --cached`), `.opencode` уже в `.gitignore`; дополнительно скрыт `.playwright-mcp/`. История не переписывалась — решение по `git filter-repo` за владельцем. Проверки: build, lint:md, backlog:check; дерево уменьшилось с 54.78 MiB до ~12.2 MiB. |
| DX-34 | Web-UI: убрать зависимость сборки от сети (Google Fonts) | medium | done | — | CI-проверка web-ui упала на PR #241 ошибкой Turbopack «next/font/google queries have exactly one entry» из-за недоступности `fonts.gstatic.com`. Нужно self-host IBM Plex через `next/font/local` или `@fontsource` с файлами в репозитории, без сетевых запросов при сборке. DoD: `next build` проходит без доступа к `fonts.googleapis.com`/`fonts.gstatic.com`; шрифты и их переменные (`--font-plex-sans`/`--font-plex-mono`) визуально не меняются. В рамках UI-26 только запись, реализация отдельно. **Done (2026-11-07):** шрифты self-hosted в `web-ui/app/fonts` (5 woff2, latin и cyrillic в одном файле на начертание: `next/font/local` не эмитит unicode-range и два файла одного веса молча роняют кириллицу в системный шрифт), `layout.tsx` переведён на `localFont` с теми же `--font-plex-sans`/`--font-plex-mono`. Сборка web-ui зелёная при заблокированной сети обеими командами (Turbopack `npm run build` и `npm run build -- --webpack`), в `.next` 0 ссылок на fonts.googleapis.com/fonts.gstatic.com; до правки обе команды падали на `Failed to fetch IBM Plex Sans/Mono from Google Fonts`. Визуально: ширина контрольных строк (латиница, кириллица, смешанная) в 6 вариантах темы совпала с google-вариантом до 0.000 px, кириллица рендерится файлом Plex (отличие от Arial 2.891 px до и после). Страж `web-ui/lib/no-remote-fonts.test.ts` (revert-check RED→GREEN). Решение: `docs/dev-cycle/decisions/2026-11-07-0405-web-ui-local-fonts.md`. |

### Фаза 7 — Процесс разработки

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| DX-35 | Команда `/devcycle`: управление циклом разработки | high | done | — | `scripts/devcycle.mjs` (Node, без зависимостей): `status` как read-only проба (LoopX через `turn plan`, PR и CI по headRefOid, пульс сессий только по session_id, worktree, журнал решений), `next` (детерминированный выбор из `BACKLOG.md`), `state get/enable/disable`, `log`, `tick` (single-writer lock, отказ при выключенном цикле, `git fetch`), `report`; коды возврата 0/1/2/3; недоступный источник даёт `n/a` и код 0. Слэш-команда `.claude/commands/devcycle.md` со сверкой расписания: `start` идемпотентен, `stop` удаляет cron даже без сохранённого cronId. Процесс перенесён из личных файлов контролёра в `docs/dev-cycle/` (README, tick, rules, decisions/). DoD: `npx vitest run tests/devcycle-next.test.ts tests/devcycle-state.test.ts`; счётчики pending/blocked/deferred совпадают с `npm run backlog:check`; `node scripts/devcycle.mjs status` не меняет `git status --short`. |
| DX-36 | `/devcycle readiness` и `/devcycle proposals`: режим «прод-грейд» | high | in_progress | DX-35 | Подкоманды в `.claude/commands/devcycle.md` вместо отдельной команды: `readiness` (снимок готовности по gates R1..R14 из `docs/dev-cycle/production-grade.md`, у каждого проба и порог, `n/a` вместо ложного «зелёного», тяжёлые пробы в отдельном worktree), `proposals` (предложения улучшений: только с пробой, поиск пересечений, не больше трёх за тик, классы `auto` и `owner`), проверки после паузы в `resume` (незапушенные worktree, красный master, жив ли исполнитель), правило «надёжность раньше фич». Вердикт «прод-грейд достигнут» выносит владелец. DoD: `npm run backlog:check`, `npm run lint:md`; первый прогон `/devcycle readiness` на свежем master приложить к PR |

---

## Этап O — Trust/Hardening: вторая волна аудитов и выдержка (2026-09-11)

> Вторая половина поверхности: request-path проаудирован (Этап M), но остались
> контент-агентная граница, Web UI, коннекторы, контейнер, supply chain и качество
> самих тестов. Тот же метод: находки только с file:line доказательствами,
> «подтверждено» vs «гипотеза».

### Фаза 1 — Аудиты

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| TR-01 | Аудит: indirect prompt injection через stored content | high | done | — | Stored knowledge/tasks/prompts/memory-факты → контекст агента. Враждебный документ = инструкция агенту. Аудит: какие поля попадают в tool output, маркировка «untrusted content», рекомендации (delimiters, правило в agent_bootstrap). Выход: threat-model + находки **Закрыто (S-20261030-prodaudit): Аудит выполнен: docs/audits/TR-01-prompt-injection-audit.md; мер — TR-14/17 (закрыты), TR-16 открыт.** |
| TR-02 | Аудит Web UI | high | done | 724059a | — | Подтверждённый вход: `renderMarkdown` экранирует `<>&` но НЕ `"` → `[x](" onclick="alert(1))` = attribute-injection XSS, `javascript:` URL тоже проходит (web-ui/app/knowledge/page.tsx:261,308-325, `dangerouslySetInnerHTML`). Плюс: CSRF на мутации, sessionStorage-токен, отсутствие sanitize-библиотеки |
| TR-03 | Аудит коннекторов и lifecycle кредов | medium | done | — | Токены plaintext в env/config (github.ts:33, gdrive.ts:64, linear.ts:47): где лежит конфиг, кто читает; OAuth-флоу, webhook-валидация, scope-минимизация, поведение при revoke/ротации. Отчёт: docs/audit/TR-03-connectors.md → TR-26..32 |
| TR-04 | Аудит качества тестов («тесты, которые врут») | high | done | — | 92.7% coverage при массовой AI-генерации: tautological asserts, mock-drift, зелёные при сломанной impl. Выход: список модулей с фейковым покрытием → дешёвый агент переписывает. **Проработка (2026-11-06):** методика и прибор — `scripts/audit-tests.mjs` (272 файла, калибровка 13 known-answer в `src/__tests__/audit-tests.test.ts`), мутационный эксперимент 15 кандидатов + 5 контролей: 14 гипотез подтверждены, 2 опровергнуты, у 1 предмета нет вовсе. Отчёт: `docs/audits/TR-04-test-quality-audit.md`. DoD: `npx vitest run src/__tests__/audit-tests.test.ts`; `node scripts/audit-tests.mjs` выдаёт таблицу кандидатов. Смержено: #275. |

### Фаза 2 — Hardening (конкретные фиксы)

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| TR-05 | Docker: non-root + hardening | medium | done | — | Dockerfile: 0 `USER`-директив = root-контейнер. Добавить non-root user, read-only fs где можно, ревизия .dockerignore, trivy-скан образа в CI |
| TR-06 | Supply chain базовый комплект | medium | done | — | Нет dependabot/renovate, `npm audit` не в CI. Добавить: dependabot.yml (npm+actions, weekly), `npm audit --omit=dev` gate, SHA-pinning для actions, политика minimumReleaseAge для новых deps |
| TR-07 | Privacy-декларация + PII-scrubbing | medium | done | — | Local-first манифест: честный список того, что уходит наружу (embeddings API, JWKS-fetch, коннекторы). Memory extraction — опция маскировать PII в фактах о пользователях. Selling point для agent-memory продукта |
| TR-08 | Reliability: деградация и partial failure | medium | done | — | Контракт задокументирован в docs/reliability.md (4 секции с file:line цитатами): connector failure modes (per-connector таблица timeout/error-shape/injectable-fetch), circuit-breaker story (embeddings+catalog only), batch partial-failure envelope, drain lifecycle. Тесты: tests/reliability-contract.test.ts + расширен src/health/endpoints.spec.ts. Гэпы → TR-33..38 |
| TR-09 | Perf-ёмкость: бюджеты и пределы | low | blocked | Проработка (research): замеры бюджета и пределов (benchmarks в CI) до нормирования порогов | benchmarks/ не подключены к CI (0 hits в workflows). Регрессионные бюджеты, макс. датасет до деградации, memory ceiling. Задокументировать пределы |
| TR-39 | Supply chain: `npm audit` без мажорных обновлений (P-20261105-1) | high | done | TR-06 | На 38a774d `npm audit --omit=dev` даёт 14 находок (2 critical, 9 high, 3 moderate). `npm audit fix` без `--force` и без мажоров закрыл 12: markdown-it 14.3.3 и linkify-it 5.0.2, js-yaml 3.15.2, picomatch 2.3.2, protobufjs 7.6.6 и @protobufjs/utf8 1.1.2, ajv 8.20.0/6.15.0 и fast-uri 3.1.9, express-цепочка (body-parser 2.4.0, qs 6.17.1, proxy-addr 2.0.8, path-to-regexp 8.4.2). Оставшиеся 2 high закрыты переходом на zod 4.6.7 и `@modelcontextprotocol/sdk` 1.32.0 (P-20261105-2). На 089ada4 `npm audit --omit=dev` даёт total=0, поэтому шаг в `bulk-smoke.yml` переведён в блокирующий режим без `continue-on-error` (P-20261106-7); невакуумность доказана подстановкой lodash 4.17.15 в копию lock в /tmp: код возврата 1, на настоящем lock 0. Реакция на красный — раздел «Что делать, если npm audit красный» в CONTRIBUTING.md |
| TR-40 | Supply chain: SDK 1.32 без zod 4 (P-20261105-2a) | high | in_progress | TR-39 | Обновлён `@modelcontextprotocol/sdk` 1.17.4 → 1.32.2 (диапазон `^1.32.0`; минимальная закрывающая версия — 1.32.0): закрыты все advisory SDK — cross-client leak GHSA-345p-7cg4-v4c7, отсутствие DNS-rebinding защиты, ReDoS, утечка OAuth-кредов на сервер, выбранный MCP-сервером, лимиты тела и JSON-RPC batch, bearer-токены чужого сервиса, cross-origin redirects. TS2589 снят без мажора zod 4: импорт `zod/v3` вместо корня `zod` — zod 3.25.76 публикует раздельные CJS `.d.cts` и ESM `.d.ts`, root-резолв давал в `SchemaOutput` сравнение двух разных деклараций и tsc падал OOM (14 ГБ, 16 мин; после правки build 9 с). Попутно: `fast-uri` 3.1.0 → 3.1.9 (ajv из SDK втянул его в prod-дерево), коннекторы регистрируются через `server.tool(name, description, cb)` — 1.32 отвергает config-объект в слоте схемы, SC-01 переключатель JSON/SSE ищет флаг в `_webStandardTransport` (SDK ≥1.24). Остаётся: zod 4 (P-20261105-2b), затем блокирующий `npm audit --audit-level=high` в CI. DoD: audit 1 high (zod), build/test:types/lint/lint:md/backlog:check, `npm test` (3108), `e2e:full` (122), web-ui tsc/тесты/build зелёные |
| TR-41 | Supply chain: zod 4.6.7 без переписывания схем (P-20261105-2b) | high | in_progress | TR-40 | `zod` поднят 3.25.76 → 4.6.7 (`^4.6.7`), все импорты остаются `zod/v3` (слой совместимости v3 API внутри пакета zod 4): схемы и их контракты не меняются. Доказано: `npm audit --omit=dev` — 0 уязвимостей; `tools/list` живого сервера до/после побайтово идентичен (126 инструментов), 6 сообщений валидации (тип, обязательное поле, min, enum, max) идентичны; `npm ls zod` — одна копия в prod-дереве; в lock изменился только zod. Проверки: build/test:types/lint/lint:md/backlog:check, полный vitest 3 прогона, `e2e:full` (122), Q-011 snapshots без правок, web-ui tsc и тесты. Остаётся: миграция схем на API `zod/v4` по модулям отдельными шагами, затем блокирующий `npm audit --audit-level=high` в CI. |

### Фаза 3 — Governance и spec-frontier

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| TR-10 | API governance doc | low | blocked | Проработка (design): политика API governance: breaking changes, коды ошибок, deprecation | Политика breaking changes для ~114 tools, таксономия error-кодов, нейминг-конвенция (tasks_*/memory_*/tools_*), deprecation-путь. ToolRegistry версионирует — политики нет |
| TR-11 | MCP spec frontier tracking | low | blocked | Проработка (design): политика spec frontier: что берём (elicitation/sampling/roots/subscriptions), что нет | Политика отслеживания спеки + оценка неиспользуемых фич: elicitation, sampling, roots, subscriptions. Выход: что брать, что осознанно нет |
| TR-12 | Elicitation для confirm-флоу | medium | done | TR-11, DX-19 | Деструктивные ops (project_purge, bulk-delete) → elicitation-запрос юзеру вместо слепого выполнения. Синергия с auto-backup DX-19. Реализовано: src/core/elicitation.ts (elicitConfirm → accepted/declined/unsupported/error), wired в tasks_bulk_delete_permanent + knowledge_bulk_delete_permanent + project_purge; confirm:true backward-compat; fail-safe на error. Тесты: src/core/elicitation.spec.ts (9), tests/e2e-full/elicitation.test.ts (5) |
| TR-13 | Upgrade-path e2e | low | pending | DX-18 | Данные версии N → апгрейд пакета → читаются корректно. Ловит то, что schema-version не покроет |

---

## Этап P — MCP spec compliance (2026-09-11)

> Сверка со спекой MCP (SDK 1.17.4, эпоха 2025-06-18). Минимум закрыт
> (initialize/tools/resources), но: prompts нет как MCP-поверхности,
> subscribe/listChanged/cancel/completion не реализованы, capabilities
> заявлены не по спеке. SPEC-01/02 — по сути баги: выполнять вместе с
> фазой 2 Этапа M.

### Фаза 1 — Баги соответствия

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| SPEC-01 | Cancel-propagation: реальный AbortSignal на запрос | high | done | — | Реализовано 1c9b542: pendingRequests Map keyed `${sessionId}:${requestId}` в stream+http transport, notifications/cancelled → controller.abort(reason), signal прокинут в handler extra. Тесты: tests/cancel-propagation.test.ts (218 строк) |
| SPEC-02 | Capabilities по спеке | high | done | — | Реализовано 8b94047 + уточнено SPEC-03/04: SERVER_CAPS = spec-форма {resources:{subscribe,listChanged}, tools:{listChanged}, prompts:{listChanged}, completion:{}}; флаги отражают реальную эмиссию |

### Фаза 2 — Непокрытая поверхность

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| SPEC-03 | MCP prompts surface | medium | done | — | `registerPrompt` — 0 вызовов: prompts только как tools, `prompts/list` → -32601, в UI клиентов пусто. Реализовано: src/register/mcp-prompts.ts — каталог → registerPrompt (name=id, argsSchema из variables), template рендер {{var}}, sentinel для пустой библиотеки (prompts/list отвечает [] вместо -32601); wired в app-container. Тесты: mcp-prompts.spec.ts (8) + tests/e2e-full/mcp-prompts.test.ts (2) |
| SPEC-04 | `listChanged` notifications | medium | done | SPEC-02 | Реализовано: SERVER_CAPS tools.listChanged=true, resources.listChanged=TOOL_RES_ENABLED; sendToolListChanged/sendResourceListChanged в tools_register/tools_unregister и после connector init; tools_unregister теперь вызывает RegisteredTool.remove() (SDK-level unregister — раньше тулза оставалась в native tools/list и callable); handles tracked в ctx.registeredToolHandles/registeredResourceHandles. SDK сам force-ставит listChanged=true на всех поверхностях с handlers — advertised prompts.listChanged=true, но эмиссии нет (startup snapshot). Тесты: tests/e2e-full/listchanged.test.ts (3) |
| SPEC-05 | `completion/complete` | low | blocked | Проработка (design): autocomplete или убрать completion/complete из dispatch | В MAIN_DISPATCH_METHODS (http-transport.ts:45), handler'а нет → -32601. Либо autocomplete (project names, prompt args), либо убрать из dispatch |
| SPEC-06 | `resources/subscribe` + `resources/updated` | medium | pending | SPEC-02 | Event-bus уже есть → мост: подписка на uri → `notifications/resources/updated` при изменении |
| SPEC-07 | `progressToken` gating | low | pending | — | `streaming.ts` шлёт progress без проверки токена; спека — только если клиент прислал `progressToken` в `_meta` |
| SPEC-08 | `logging/setLevel` | low | pending | — | Принять → прокинуть в pino level. Полезно для отладки удалённых подключений |

### Фаза 3 — Политика

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| SPEC-09 | Protocol-version conformance e2e | medium | pending | DX-23 | Зафиксировать negotiated `protocolVersion` в e2e; Inspector-гейт частично покроет |
| SPEC-10 | SDK upgrade policy | low | blocked | Проработка (design): политика апгрейда SDK: каденция и критерии ревью changelog | Периодический bump `@modelcontextprotocol/sdk` + ревью changelog на новые методы спеки |
| TR-14 | Egress prompt-injection scanner в ToolMiddleware.after() | high | done | TR-01 | Сканировать output всех tools на паттерны: "ignore previous", role markers, zero-width, base64 payload >50 chars. Отдельный Sanitizer-instance на egress. **Закрыто (S-20261030-prodaudit): Egress-скан включён по умолчанию в режиме annotate (данные нетронуты, предупреждение отдельным блоком; SECURITY_EGRESS_MODE=off выключает). Живой e2e в aud-high-security.test.ts.** |
| TR-15 | tools_run/tools_batch — пропускает auth-gate+SecurityStack | critical | done | TR-01 | Закрыто вместе с AUD-10: registry хранит gated handler (wrapToolHandler) → auth/ACL/audit/egress-scan применяются на dispatch через tools_run/tools_batch. Тесты: tests/aud10-tools-run-gate.test.ts |
| TR-16 | Trust/provenance metadata на stored docs | medium | done | TR-01 | Добавить trust_level: 'system'|'user'|'external' в frontmatter knowledge+memory; egress фильтр агрессивнее для external.  Реализовано: `trustLevel` ('system'|'user'|'external') в frontmatter knowledge и memory-фактов (createDoc/import/bulk, extraction, temporal graph); egress для external применяет EXTERNAL_PATTERNS и метит annotate-блок как EXTERNAL UNTRUSTED CONTENT, JSON остаётся парсимым. Тесты: tests/tr16-trust-level.test.ts (15); проверено откатом. |
| TR-17 | XML/context escaping в memory_context_assemble | high | done | TR-01 | buildBlock() интерполирует контент без escaping — stored </context> ломает boundary. Эскейпить или валидировать. **Закрыто (S-20261030-prodaudit): Экранирование в buildBlock уже было (escapeXmlText/Attr), тест tests/context-assembly.spec.ts «TR-17».** |
| DX-30 | web-ui realtime client: ?token= + unconditional subscribe | medium | blocked | Проработка (spec): актуализация текста под ticket/Authorization после UI-22, затем правка клиента; AUD-06 | web-ui/lib/realtime.ts не шлёт token и subscribe только при project — на requireAuth deployment будет 4001. |
| AUD-18a | Path traversal userId в ProfileManager | critical | done | AUD-18 | memory/user-profile.ts:95 join(storageDir, userId+'.json') без resolveUnder — arbitrary read/write **Закрыто (S-20261030-prodaudit): userId → resolveUnder в ProfileManager (get/update/delete); заодно `require` в ESM ломал deleteProfile.** |
| AUD-18b | Non-atomic JSON stores в memory/sync | critical | done | AUD-18 | TemporalGraph/EntityGraph/ProfileManager пишут writeFileSync без tmp+rename — crash = silent data loss **Закрыто (S-20261030-prodaudit): writeFileAtomicSync (tmp+rename) в user-profile/temporal-graph/entity-graph/event-log.** |
| AUD-18c | Lost-update RMW races в stores | high | done | AUD-18 | In-memory copy→mutate→rewrite без lock; concurrent updates теряются **Закрыто (S-20261030-prodaudit): withFileLock на updateTask/updateDoc; заодно tmp-имя writeJson коллидировало в одну мс → ENOENT (tests/lost-update.spec.ts). Только in-process — несколько процессов на одном DATA_DIR не координируются.** |
| AUD-18d | EventLog unbounded growth + no compaction | high | blocked | Проработка (design): чинить EventLog при подключении в рантайм или дропнуть; AUD-18 | persist() переписывает весь лог на каждый append; compactThreshold не используется **Латентно (2026-10-30): EventLog не подключён в рантайме (0 call sites вне sync/index.ts), рост недостижим. Чинить (JSONL-append + авто-compact) при подключении.** |
| AUD-18e | threeWayMerge LWW no tiebreaker + manual writes null | medium | blocked | Проработка (design): по мёртвому sync-стеку — завайрить threeWayMerge или удалить; AUD-18 | src/sync/ — merge bugs; whole sync stack is dead code (not wired) |
| AUD-18f | writeText не атомарный для .md knowledge docs | medium | done | AUD-18 | writeJson атомарный (Q-013), writeText — нет **Закрыто (S-20261030-prodaudit): writeText атомарный (tmp+rename).** |
| TR-04a | Delete lying tests: tasks_dag, obsidian.*.smoke (×2), confirm.replace.e2e | high | done | TR-04 | Тесты ре-имплементировали SUT. **Закрыто (2026-11-06):** удалены `tests/tasks_dag.test.ts`, `tests/obsidian.export.smoke.cli-envelope.test.ts`, `tests/obsidian.import.smoke.cli-envelope.test.ts`; `src/obsidian/__tests__/confirm.replace.e2e.test.ts` заменён на `tests/obsidian.confirm.replace.tool.test.ts` (реальный confirm-гейт через `registerObsidianTools`). Мутации до удаления: `topologicalSort` → GREEN в tasks_dag, RED в `tests/tasks.unit.test.ts`; счётчики plan export/import → GREEN в smoke, RED в `tests/obsidian.export.dryrun.plan.unit.test.ts` и `src/obsidian/__tests__/import.dryrun.plan.test.ts`; снятие confirm-гейта → GREEN в старом файле, RED в новом. Покрытие не потеряно: `src/obsidian/import.ts` statements 77.31% до и после, `src/obsidian/export.ts` 96.91%; ветвь 532 восстановлена `tests/obsidian.import.plan-exec.test.ts`. |
| TR-04b | Rewrite openapi.test.ts + markdown.test.ts на реальные модули | high | done | TR-04 | **Сделано (S-20261106-tr04b):** `tests/openapi.test.ts` (12 тестов) вызывает настоящие `generateOpenAPISpec`/`createOpenAPIHandler` из `src/register/openapi.ts` через реальный `ToolRegistry` и проверяет HTTP-маршруты; `tests/markdown.test.ts` (25 тестов) вызывает зарегистрированные обработчики `registerMarkdownTools` через mock ServerContext (было 9+19 тестов, обработчики не вызывались). Мутации: версия спеки 3.0.3→3.0.4, `categorizeTool` Tasks→Taskz, `slugify` без space→hyphen, `docToMarkdown` без tags, `ZodEnum` enum→пусто, `required.push` убран, overwrite-ветка отключена, `SEPARATOR` изменён — старые тесты зелёные (проверено для первых четырёх), новые красные. Coverage `src/storage/knowledge.ts` и `src/fs.ts` не изменился (44.01/56.41/36.36/44.01 и 55.83/75/64.28/55.83). DoD: `npx vitest run tests/openapi.test.ts tests/markdown.test.ts`. |
| TR-04c | Rewrite cli.tools_list.contract + jsonrpc-fuzz (real imports) | high | done | TR-04 | **Сделано (S-20261107-tr04c, ветка test/tr04c-rewrite-real):** `tests/cli.tools_list.contract.test.ts` (6 тестов) проверяет реальную регистрацию: `createServerContext()` + `defaultRegistration()` + spy на инстансный `server.registerTool` (обёртка `src/register/setup.ts:299`) — banned single-tools литералом, обязательное ядро из 19 имён, непустые `description`, `inputSchema`-объекты валидаторов, уникальность имён и пол >100 против вакуумного зелёного. `tests/jsonrpc-fuzz.test.ts` (2 теста) фаззит реальный путь `HttpTransportAdapter` → `JSON.parse` → `authorizeHttpCall` → SDK на порту от ОС с permissive `AuthManager`: статус <500, валидный конверт `jsonrpc:2.0`, коды из набора -32700/-32600/-32601/-32602/-32000/-32001, отсутствие stack-кадров и абсолютных путей, живость того же keep-alive сокета после мусора; копия `normalizeEnvelope` удалена (в `src/` её нет). Мутации: переименование `tasks_list` и `search_knowledge`, снятый `description`, дубль имени, stack в 400-теле (два seed), -32603 вместо -32000 — новые тесты RED ассертом, старые GREEN на тех же мутациях, откат → GREEN. DoD подтверждён. |
| TR-04d | Rewrite e2e-full/memory-lifecycle — assert data, not shape | medium | pending | TR-04 | 30 вызовов env.ok===true, temporal_query не проверяет данные; DoD: `facts: []` в `memory_temporal_query` (K9) красит тест. |
| TR-04e | Line-fixes batch: 12 файлов слабых ассертов | medium | pending | TR-04 | jwt-validator:787, memory-extended:304/328, chaos-shutdown:134, fts-search:124 и др.; DoD: мутации K10b, K12, K13, K14, K16 красят соответствующие файлы. |
| TR-04f | Coverage gaps: dashboard_*, confirm-gate, bandit epsilon>0, bm25 params | medium | pending | TR-04 | Реальные дыры покрытия при 92.7% total; DoD: `filterByDateRange → []` (K11) красит `tests/dashboard.test.ts`. |
| TR-04g | Test hygiene: DATA_DIR isolation + shared e2e http harness | low | pending | TR-04 | /tmp/mcp-data гонки; ~200 строк дублей в 6 e2e файлах; DoD: параллельный прогон двух файлов с общим `/tmp/mcp-data` не даёт гонок; число `spawnServer` в `tests/e2e-full` сокращено общим харнессом. |
| TR-04h | `tests/schema-validation.test.ts` зеркалит `scripts/validate-schemas.mjs` | medium | pending | TR-04 | N1: скрипт сломан (rc=1), тест зелёный. DoD: `node scripts/validate-schemas.mjs` с намеренной ошибкой красит тест; либо зеркало удалено. |
| TR-04i | `tests/transport-wire-snapshots.test.ts` тестирует SDK, не наш слой | low | pending | TR-04 | Нет импорта `src/`: проверяются `serializeMessage` и `deserializeMessage` из `@modelcontextprotocol/sdk`. DoD: тест переведён на наш wire-слой либо помечен как контракт зависимости и исключён из покрытия проекта. |
| TR-18 | tests/security-stack.test.ts:197,209 — `lockoutMs` → `maxLockoutMs` (pre-existing tsc error) | low | done | AUD-10 | AuthProtectionOptions нет `lockoutMs`. Закрыто 26fbe9d |
| TR-19 | Битые `_X` импорты в 4+ тест-файлах (event-bus, tool-executor, async-ops, multimodal) | medium | done | AUD-10 | tsconfig.test.json красный — экспорты удалены при рефакторинге, импорты остались. Закрыто 26fbe9d (17 test:types ошибок → 0) |
| TR-20 | WS tokenValidator: rate-limit по IP — realtime.ts не имеет req.socket.remoteAddress | medium | pending | AUD-13 | brute-force по /ws endpoint не ограничен — validator closure не видит req; прокидывать remote в RealtimeAttachOptions |
| TR-21 | AuthProtection дублирует ключи: sessionId в SecurityStack + IP в AuthManager | low | pending | AUD-13 | Два инстанса пишут разные ключи — не баг, но шум; унифицировать на IP-keyed |
| TR-22 | better-sqlite3 dead-code: FtsMemorySearch+MigrationFramework — 0 call sites в runtime | low | blocked | Проработка (design): завайрить FTS5 в query_memory или удалить модуль и зависимость | `src/behavioral/fts-search.ts`, `src/db/migration-framework.ts` экспортируются, но не подключены к register/tools (0 импортов). BM-013/BM-014 помечены completed, но фича не доходит до рантайма. Решить: wire FTS5 к `query_memory`/`memory_search` (ценность реальна) ИЛИ удалить модуль (убрать dep better-sqlite3, поможет single-binary DX-20) |
| TR-23 | `PROJECT_META_FILE` мёртвая константа — src/projects.ts:50 | low | pending | — | `.project.json` нигде не читается/пишется — реальный путь метаданных `DATA_DIR/projects/<id>.json`. Удалить константу + проверить ссылки. Найдено DX-17 |
| TR-24 | `getPackageVersion()` продублирована в register/setup.ts и services/schema-version.ts | low | pending | — | 10 строк: npm_package_version → package.json → '0.0.0'. Вынести в shared util при следующем касании. Найдено DX-18 |
| TR-25 | `knowledge_bulk_delete_permanent` без confirm-гейта — асимметрия с `tasks_bulk_delete_permanent`/`project_purge` | medium | done | DX-19 | Закрыто вместе с TR-12: добавлен `confirm: z.boolean().optional()` + elicitation-флоу в src/register/bulk.ts; e2e в tests/e2e-full/elicitation.test.ts + обновлён knowledge-lifecycle.test.ts |
| TR-26 | Wire SecretManager в ConnectorContext — убить прямые process.env чтения кредов | high | done | TR-03 | Все 8 коннекторов читают `process.env.*_TOKEN/API_KEY` напрямую (github.ts:33, jira.ts:33, slack.ts:36, gdrive.ts:63, gmail.ts:76, notion.ts:88, onedrive.ts:60, linear.ts:73). SecretManager (AES-GCM file/docker/vault) существует но 0 call sites — мёртвый код. Прокинуть `ctx.secrets.get()` |
| TR-27 | Dead `connectorConfigs` path + doc drift в connectors.md | high | done | TR-03 | app-container.ts:387 — `connectorConfigs = {}` всегда пустой; FileConfig не имеет `connectors` ключа. docs/features/connectors.md:52 документирует JSON-конфиг как рабочий — не работает. Либо wire FileConfig.connectors → connectorConfigs, либо удалить параметр и починить доку |
| TR-28 | webhookUrl SSRF-guard в memory async-ops | high | done | TR-03 | register/memory.ts:413,1311 — `z.string().url()` без allowlist; async-ops.ts:277 POSTит job.output на произвольный URL. Нет блока private/loopback/link-local (169.254.169.254), нет scheme-ограничения до https. Эксфильтрация фактов на внутренние сервисы |
| TR-29 | OAuth refresh для gdrive/gmail/onedrive — или удалить мёртвые поля | medium | blocked | Проработка (design): OAuth refresh-флоу или удаление мёртвых полей и документация; TR-03 | gdrive.ts:65-67 читает refreshToken/clientId/clientSecret но нигде не использует — нет вызова oauth2.googleapis.com/token. Access-token живёт ~1ч → после expiry все tools возвращают {ok:false} до рестарта. Либо реализовать refresh-флоу, либо удалить поля + задокументировать «refresh externally» |
| TR-30 | Web-crawler egress policy | medium | blocked | Проработка (design): политика egress web-crawler: scheme-allowlist, блок private-IP, лимит редиректов; TR-03 | web-crawler.ts:62 — fetch произвольного URL: нет scheme-allowlist (file://?), нет private-IP блока, нет redirect-лимита. sameOrigin() ограничивает только следование ссылок, не стартовый URL. SSRF + prompt-injection ingestion (см. TR-01) |
| TR-31 | Real health probes для OAuth-коннекторов | medium | pending | TR-03 | gdrive/gmail/notion/onedrive/linear health() проверяет только `!!token` — revoked token = healthy:true. Добавить дешёвый GET (/about, /me, /users/me) как у github/jira/slack |
| TR-32 | Logger redaction + JIRA_HOST https + scope-доки | low | pending | TR-03 | logger.ts — нет pino `redact` для *.token/*.apiKey/authorization (defense-in-depth перед wiring LoggingMiddleware). jira.ts — JIRA_HOST без https-энфорса → Basic-auth на plaintext host. connectors.md — задокументировать минимальные scopes per connector |
| TR-33 | Fetch timeouts на всех коннекторах | medium | done | TR-08 | 8/9 коннекторов делают plain `fetch` без timeout (github.ts:21, jira.ts:27, slack.ts:20, gdrive.ts:51, gmail.ts:64, notion.ts:70, onedrive.ts:51, linear.ts:57). Undici headers-timeout 300s → stalled remote пинит tool call на минуты. Добавить `AbortSignal.timeout()` как в web-crawler.ts:61 (default 10s, configurable) |
| TR-34 | Connectors → circuit breaker | medium | pending | TR-08 | Коннекторы обходят ServiceAvailability/CircuitBreaker — downed API получает полный TCP/TLS latency на каждый вызов. Зарегистрировать per-connector tracker в getServiceAvailabilityRegistry, recordFailure в catch-ветках, health() → toComponentHealth() |
| TR-35 | web-crawler: не схлопывать ошибки в {ok:true, empty} | low | pending | TR-08 | web-crawler.ts:66-77 — catch возвращает {ok:true, title:'', content:'', links:[]} — caller не отличит «пустая страница» от «fetch failed/timeout». Вернуть {ok:false,error} или добавить поле `error` в success-ответ |
| TR-36 | Единый error envelope для github/jira/slack | low | pending | TR-08 | github.ts:26, jira.ts:28, slack.ts:27-30 — throw → protocol isError, тогда как gdrive/gmail/notion/onedrive/linear возвращают {ok:false,error:{message}}. Унифицировать в ErrEnvelope |
| TR-37 | Bulk tools: per-item errors + exception isolation | medium | pending | TR-08 | bulk.ts — updateTask/updateDoc возвращают null на missing id → молча пропускаются (count<results.length без объяснения). Исключение mid-loop (dependency cycle, tasks.ts:183) аборти́т весь batch и теряет уже сделанные результаты. Добавить per-item {ok,error} как в tasks_bulk_delete_permanent dryRun (bulk.ts:243-256) + try/catch per item |
| TR-38 | Drain enforcement: session admission consults isDraining | medium | pending | TR-08 | checker.ts:88-91 — startDraining только флипает флаг; transport layer не реджектит новые сессии по isDraining. Контракт чисто observational (readyz 503). Wire draining → session admission в http/tcp транспортах |

---

## Архив (последние 20)

| ID | Задача | Закрыто | PR |
|----|--------|---------|-----|
| S-004 | session_info + session_list MCP tools (13 tests) | 2026-04-08 | #66 |
| S-005 | Session Prometheus metrics (gauges, histograms, callbacks, 17 tests) | 2026-04-08 | #67 |
| ACL-002 | Фильтрация списков инструментов/ресурсов по ACL (filterToolNames, filterResourceUris, 29 tests) | 2026-04-08 | #65 |
| ACL-003 | Проверка авторизации при вызове инструментов (middleware integration, 4 tests) | 2026-04-08 | #65 |
| ACL-001 | ACL model and policy definitions (ACLEngine, middleware, pre-hook, 51 tests) | 2026-04-08 | #64 |
| A-003 | Привязка tokenClaims к session TTL | 2026-04-07 | #63 |
| TD-004 | Rate limiting на уровне инструментов | 2026-04-08 | #53 (покрыто S-003) |
| T-003 | Stdio extraction: connected getter на всех TransportAdapter | 2026-04-07 | #50 |
| S-003 | Per-session rate limiting: token bucket algorithm | 2026-04-07 | #53 |
| S-002 | ToolContext и ToolExecutor: per-session tool execution | 2026-04-07 | #52 |
| S-001 | SessionManager: TTL, idle timeout, lifecycle management | 2026-04-07 | #51 |
| T-002 | TCP/Unix multi-client transport: StreamTransportAdapter | 2026-04-07 | #49 |
| AI-001 | Создать AGENTS.md | 2026-04-04 | #24 |
| AI-002 | Создать BACKLOG.md | 2026-04-04 | #24 |
| AI-003 | Актуализировать ROADMAP.md | 2026-04-04 | #24 |
| AI-005 | Market research отчёт (PDF) | 2026-04-04 | #27 |
| F-001 | Рефакторинг src/index.ts → модули | 2026-04-05 | #31 |
| MR-002 | Task hierarchy (parentId, depth, cascade) | 2026-04-04 | #29 |
| MR-001 | Streamable HTTP transport (MCP_TRANSPORT=http) | 2026-04-05 | #30 |
| MR-004 | OpenAPI 3.0 spec + API docs endpoint | 2026-04-05 | #35 |
| MR-005 | Task dependency graph (DAG) | 2026-04-05 | #34 |
| MR-010 | npm publish + Claude Desktop / Cursor config | 2026-04-05 | #32 |
| MR-014 | README overhaul for npm | 2026-04-05 | #33 |
| MR-006 | VS Code extension | 2026-04-05 | #36 |
| MR-013 | Claude Code / Windsurf integration guides | 2026-04-05 | #37 |
| MR-007 | Dashboard analytics: stats, activity, trends, project summary | 2026-04-05 | #38 |
| MR-009 | Markdown import/export для knowledge base | 2026-04-05 | #40 |
| F-003 | ToolRegistry: версионирование, ETag, пагинация | 2026-04-06 | #43 |
| F-004 | Structured logging with Pino (child loggers, LOG_LEVEL, LOG_FORMAT) | 2026-04-07 | #44 |
| F-005 | Prometheus exporter (tool calls, duration, resource reads, /metrics) | 2026-04-07 | #45 |
| F-006 | Type safety: replace any with concrete types (context, tool-registry, vector, config, metrics) | 2026-04-07 | #46 |
| T-001 | AppContainer: lifecycle manager with state machine, cleanup, signal handling | 2026-04-07 | #47 |

---

## Этап Q — Knowledge-base hardening: доверенный источник (2026-10-20)

> Фиксированные сеты и замеры до/после: `docs/benchmarks/kb-hardening-2026-10-20.md`,
> harness `scripts/kb-bench.mjs` + `scripts/field-eval.mjs`. Правило: сначала измеряем
> на том же сете, потом меняем; отклонённые по замерам гипотезы записаны в отчёте.

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| KE-01 | Baseline: фиксированные сеты + latency/RSS/индексация | high | done | — | 146 чанков docs, 18 RU/EN/code запросов, 99 полей (78 evaluated), 2024×8 labels. Baseline: hybrid hit@1 83.3%/MRR 0.884, gold 58/78, первый поиск 40.4 с, индексация 39.2 с, RSS 1580 MB |
| KE-02 | Индексация вне пути пользователя | high | done | KE-01 | `src/search/warmup.ts`: фоновый per-project warmup с debounce и бюджетом (180 с, `EMBEDDINGS_WARMUP=0` off), `adapter.warmup()`, инкрементальный reindex по событиям storage, `project_set_current` прогревает проект, статус в `embeddings_status`; `ensureVectorAdapter` делит init-promise. Первый поиск после прогрева 100 мс (было 40427), ingest→indexed 453 мс |
| KE-03 | Качество RU/EN+код без регресса RU | high | done | KE-01 | Авто-детект Gemma вместо LaBSE (gold 58/78 vs 52/78), авто-префиксы Gemma, реальный выходной dim (768, не text_config 512) — иначе авто-конфиг молча падал в BM25-only; лексический floor 0.15→0.05. Docs hit@1 88.9% (RU 66.7% vs 50), MRR 0.926. Отклонено: RRF_K, maxLen 512, чанкинг 1000/100, mean pooling |
| KE-04 | verify-memory: живость анкоров | medium | done | — | `scripts/verify-memory.mjs` + `npm run memory:verify`: git-индекс (ls-files/suffix-map/line counts), статусы verified/pending-merge/stale/no-anchor в теги, ветки тикета по префиксу, strong/weak анкоры против ложных stale, бюджеты `--limit`/`--budget-ms`. 120 фактов: 27/2/0/91 за 6.7 с |
| KE-06 | Долговечные фикстуры field-eval в репо | high | blocked | Проработка (research): источник и build-скрипт фикстур из ALB (common/messages, Bitrix24 defs); KE-01 | gold_fields.json и multilingual_labels.json жили в /tmp и были потеряны при очистке — гейт не воспроизводится. Пересобрать build-скриптами из ALB (`common/messages`, Bitrix24 field defs), положить в `scripts/fixtures/field-eval/`, перебазировать Gemma и Granite на новых сетах, обновить отчёт |
| KE-07 | Оценка Granite Embedding 311M Multilingual R2 | medium | done | KE-03 | Проверен как замена Gemma (UltraBERT отклонён без бенча — English-only). quint8 ONNX, CLS pooling, тот же docs-сет: hit@1 83.3% против 88.9% у Gemma, RU 50% против 66.7% (при 512 — паритет по RU, но индексация 108 с и общий hit@1 всё равно ниже). RSS ниже (1066 против 1582 MB), запросы быстрее. Вердикт: дефолт не меняем; добавлена поддержка CLS-pooling (авто из 1_Pooling/config.json + EMBEDDINGS_POOLING) |
| KE-05 | Языковой top-1 вне RU/EN ≥ 80% на полном сете | medium | done | KE-03 | Полный сет 2024 записей: ru 83.6, en 83.6, de 82.2, es 82.7, fr 81.5, pt 81.8, tr 82.0 (top-3 92.9–96.0). Срезы вводят в заблуждение: 200 записей → tr 73%, 120 → все 73–78%. Гейт регрессии гонять на полном сете (~35 мин CPU) или на достаточно крупной страте. Raw: docs/benchmarks/kb-hardening-field-eval-full.json |

## Этап R — Многопользовательская целостность и история изменений (2026-10-30)

> Решение владельца (2026-10-30): клиентов пока нет, ломающие изменения допустимы. История и откат — через git
> поверх файлового хранилища, но **не** «очередь с склеиванием коммитов» (смешает правки разных людей в один коммит
> с одним автором): коммит делается на каждую операцию внутри блокировки сущности, с автором из сессии.
> Порядок: MU-01 → MU-02 → MU-03, затем инструменты/UI. Основа: `withFileLock` (src/fs.ts, in-process),
> снимки `.versions` (TD-005) и `skill-manager` versions — заменяются git-историей (MU-04).

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| MU-01 | Единственный процесс-владелец данных | high | done | — | `DATA_DIR/.server.lock` (pid, как у БД): второй писатель на тот же каталог не стартует с понятной ошибкой. Сегодня `withFileLock` работает только внутри процесса, а граф памяти держится в памяти и перезаписывается целиком — два сервера на одном `DATA_DIR` теряют чужие записи. Проба: два процесса, параллельные update одной сущности. Реализовано (2026-11-07): `src/storage-lock.ts` — атомарный захват через `fs.link` с fallback на `wx`, владение по token, `kill(pid,0)` с EPERM как живой процесс, защита от переиспользования pid по starttime+btime из /proc, чужой hostname не снимается, протухший lock снимается с warn. Захват в `init()` до schema-gate, release на SIGINT/SIGTERM/exit, пропуск в proxy-режиме; отказ — `SERVER_LOCK_HELD`/`SERVER_LOCK_FOREIGN_HOST` с pid, hostname, startedAt и exit 1. Проба до кода: 56/60 потерянных update; после — второй процесс не стартует, 0 потерь. Тесты: `tests/server-lock.test.ts` (23, кейсы a-i, revert-check точечными мутантами). Доки: `docs/getting-started/configuration.md`, `docs/deployment/docker.md` |
| MU-02 | Оптимистичная блокировка по версии | high | blocked | Проработка (design): контракт версии и кодов CONFLICT в docs до реализации | `version` у задач/документов/промптов; update принимает `expectedVersion`; устаревшая версия → `CONFLICT` с текущим состоянием и диффом вместо тихой перезаписи. Правки разных полей сливаются автоматически (как сейчас), конфликт только по одному полю на устаревшей основе. Клиентский контракт и коды ошибок описать в docs |
| MU-03 | Git как слой истории на DATA_DIR | high | blocked | Проработка (design): ADR по git-слою: execFile vs isomorphic-git (замер латентности) и решение SC-07; MU-01 | Репозиторий на `tasks/ knowledge/ prompts/`; коммит на операцию под блокировкой сущности + общий замок репозитория, `--author` из сессии (userId/клиент); массовая операция: блокировки в фиксированном порядке, один коммит, при сбое откат; на старте «грязное» дерево → коммит `recovered`; `.gitignore`: audit.log, .jwt-revoked.json, .backups, memory/. Без бинаря git — работать без истории (warn). `git` CLI через execFile или isomorphic-git — решить замером (латентность коммита, размер образа) |
| MU-04 | Инструменты history/diff/restore | medium | pending | MU-03 | `tasks_/knowledge_/skills_{history,diff,restore}`; откат = новый коммит, не стирание; дифф текста — построчный, задач — по полям JSON. Убрать `.versions` (TD-005) и миграция существующих снимков в историю |
| MU-05 | UI: вкладка «История» и диалог конфликта | medium | pending | MU-02, MU-04 | Лента изменений (кто/когда/что), дифф, «восстановить эту версию»; при `CONFLICT` — «взять чужое / оставить моё / слить» |
| MU-06 | Память агента: целостность и история | low | blocked | Проработка (design): политика атомарности и снимков графа памяти при нескольких клиентах; MU-01 | Граф фактов (~750 КБ JSON) переписывается целиком на каждый факт: в git не класть (раздует историю), снимок раз в час; решить атомарность записи и политику при нескольких клиентах |
| MU-07 | Тесты конкурентных сценариев | high | pending | MU-02, MU-03 | Два клиента правят одно поле (CONFLICT), разные поля (слияние), массовая операция со сбоем посередине (всё или ничего), `kill -9` между записью и коммитом (recovered), второй писатель на `DATA_DIR`, авторство коммита по сессии |
| MU-08 | Мост stdio → один http-сервер | high | done | MU-01, P-001..P-004 | Сегодня один транспорт на процесс (`MCP_TRANSPORT`). Команда для клиента (`mcp-task-knowledge bridge --url … --token …`) поверх `src/proxy/*` (P-001..004 готовы): IDE-агент говорит stdio, данные ведёт единственный http-сервер. Флаг запуска `--proxy-upstream` (значение — URL ядра) и env-вариант: процесс не поднимает своё хранилище, а проксирует stdio↔ядро; токен и `auth.mode` из `ProxyConfig` (`src/proxy/types.ts:19-64`), переподключение с backoff и circuit breaker (`src/proxy/resilience.ts`), health шима в `doctor` (DX-11). Сейчас `ProxyBootstrap` не вызывается нигде вне `src/proxy` и спеков. Документировать схему «админка по http + агенты по stdio». Нужен ли отдельный транспорт-слушатель в ядре (Unix-сокет/named pipe), решает ADR AA-01. DoD: `npm test -- tests/thin-proxy-shim.test.ts`; pass — ядро по HTTP, два шима и Web UI видят одни данные (задача, созданная через шим A, читается шимом B и HTTP-клиентом по одному id); `kill -9` шима A не влияет на ядро и шим B; перезапуск ядра — шимы переподключаются и отвечают `tools/list` за ≤ 5 с; RSS ядра и `embeddings_status` показывают однократную загрузку модели (второго прогрева после подключения шимов нет); fail — расхождение данных, падение ядра вместе с шимом или повторная загрузка векторов. Windows не проверено — замена: CI `windows-latest`, named pipe. Реализовано (2026-11-07): `src/proxy/shim.ts` — `StdioBridge` (зеркало upstream в stdio-сервер, восстановление после потери сессии), `ProxyBootstrap` передаёт токен через `requestInit` и вызывает `mcp.authenticate` после каждого connect/reconnect, `ProxyMirror` принимает новый клиент и повторяет вызов один раз; команда `bridge` в `src/cli/bridge.ts` (флаги `--url`/`--proxy-upstream`, `--token`, env `MCP_PROXY_UPSTREAM`/`MCP_PROXY_TOKEN`, коды выхода 0/2/3/4, завершение по EOF stdin и смерти родителя, `DATA_DIR` не требуется). Health в `doctor` не сделан — остаётся DX-11 (у `doctor` нет секций). Тесты: `tests/thin-proxy-shim.test.ts` (7 кейсов a-g, revert-check на каждый). Решение: `docs/dev-cycle/decisions/2026-11-07-0215-mu-08.md` |
| MU-09 | Мост теряет опциональность и ограничения вложенных схем | high | done | MU-08 | Схема инструмента должна доезжать до клиента без изменений, а мост её переписывает: `jsonSchemaToZod` (`src/proxy/mirror.ts:57-64`) собирает вложенный объект как `z.object` из `properties` и не читает `required` этого объекта, поэтому обязательными становятся ВСЕ вложенные поля; верхний уровень обрабатывается верно (`jsonSchemaToShape`, `:76-100`). Проверено на f6a748f своим ядром и своим мостом на актуальном коде: прямой stdio отдаёт у `tasks_bulk_create` в item обязательным только `title`, мост — все семь полей; вызов с одним `title` через мост падает `-32602` с `Required` на `description`, `priority`, `type`, `tags`, `links`, `parentId`, а тот же вызов с полным набором проходит. Расхождение по `required` найдено у 12 инструментов и 13 путей: `tasks_bulk_create`, `tasks_bulk_update`, `knowledge_bulk_create`, `knowledge_bulk_update`, `prompts_bulk_update`, `prompts_bulk_delete`, `prompts_feedback_log`, `prompts_metrics_log_bulk` (два уровня), `project_statuses_set`, `project_types_set`, `project_transitions_set`, `memory_temporal_add`. Есть и обратная ошибка: у `project_transitions_set` мост теряет обязательность верхнего `transitions`. Поле объявлено как `.nullable()`, в JSON Schema это `type` массивом `[object, null]`; конвертер такой тип не распознаёт и отдаёт `z.any()`, а `z.any()` в Zod пропускает `undefined` и считается опциональным, поэтому `required` в опубликованной схеме исчезает. Проверено отдельно: `jsonSchemaToShape` на этой схеме даёт для `transitions` `isOptional() === true`, хотя в исходном `required` поле есть. Кроме `required` через мост теряются ограничения и подсказки: по всему реестру из 128 инструментов пропадают `description` (201), `minLength` (115), `default` (54), `minimum` (52), `maximum` (50), `enum` (37), `maxLength` (7), `anyOf` (5), `format` (3), `pattern` (3). Следствие: `priority: "nonsense"` проходит проверку моста и падает уже на ядре как `MCP error -32602: Internal error` вместо `invalid_enum_value`. Сделать: конвертер читает вложенные `required`, `enum`, границы, `format`, `pattern`, `default`, `anyOf`, `oneOf` и `description`; тип-массив (`[object, null]`) и `anyOf` распознаются, а не падают в `z.any()`; тест сравнивает `tools/list` прямого ядра и моста рекурсивно по всем инструментам — `required` на каждом уровне, тип, набор значений enum, наличие description. DoD: `npx vitest run tests/proxy-schema-parity.test.ts`; pass — рекурсивное сравнение по 128 инструментам даёт 0 расхождений, живая проба `tasks_bulk_create` с одним `title` через мост проходит, `priority: "nonsense"` через мост отклоняется тем же `invalid_enum_value`, что и напрямую; fail — любое расхождение либо проба. Revert-check: вернуть чтение `required` только на верхнем уровне — тест краснеет. Реализовано (2026-11-07, подход А): мост больше не пересобирает JSON Schema в zod. `src/proxy/passthrough.ts` регистрирует семь методов (`tools/list`, `tools/call`, `resources/list`, `resources/templates/list`, `resources/read`, `prompts/list`, `prompts/get`) на низкоуровневом `Server` и возвращает результат ядра без изменений, валидация остаётся на ядре; `src/proxy/shim.ts` создаёт `Server` с capabilities, повторяющими ядро, и прокидывает уведомления `list_changed`. Проба на своём ядре и мосту: 128 инструментов с обеих сторон, 0 расхождений вместо 13 путей `required` и нулевых счётчиков ограничений, `tasks_bulk_create` с одним `title` проходит, `priority: "nonsense"` возвращает тот же текст `Invalid enum value`, `resources/templates/list` 14 из 14 вместо 0. Тесты: `tests/proxy-schema-parity.test.ts` (8 кейсов) и `tests/thin-proxy-shim.test.ts` (12) зелёные; revert-check: возврат shim к `ProxyMirror` даёт RED по ассертам, возврат нового shim — GREEN. Решение: `docs/dev-cycle/decisions/2026-11-07-1150-mu-09.md` |

---

## Этап S — Трекер уровня YouTrack (2026-10-30)

> Решение владельца: ориентир по задачам — YouTrack (поля, язык запросов, доски, дашборды). Не копировать целиком:
> ставка на агентов — запросы и команды одной строкой. Слои зависят друг от друга, порядок строгий: TK-01 → TK-02 → TK-03 → TK-04.
> Развилка «свой трекер или мост к YouTrack» решается через INT-007/INT-008; лента активности берётся из git-истории (MU-03).

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| TK-01 | Модель данных задачи: исполнитель, срок, тип, настраиваемые поля проекта, комментарии | high | blocked | Проработка (design): ADR модели задачи (поля проекта, комментарии, типы связей, миграция .schema-version); MU-02 | Решение владельца: трекер свой; YouTrack — референс по функциям и языку запросов и внешний коннектор (INT-007, INT-008), не основа. Сейчас фиксированная схема (статус, приоритет, теги). Схема полей на проект (тип, enum, число, дата, пользователь), валидация zod, миграция существующих задач (`DATA_DIR/.schema-version`, DX-18); комментарии и упоминания; типы связей (depends, relates, duplicates, subtask) поверх DAG и parentId |
| TK-02 | Язык запросов и сохранённые поиски | high | pending | TK-01 | Парсер `project: X #Unresolved assignee: me sort by: updated`; инструмент `tasks_query("...")` вместо россыпи фильтров; сохранённые поиски; тесты на грамматику и границы (кавычки, скобки, неизвестное поле → понятная ошибка) |
| TK-03 | Доски и спринты поверх запросов | medium | pending | TK-02, V-04, V-05 | Базовая доска со своими статусами, сворачиванием колонок и дорожками по типу — этап V; здесь: колонки привязаны к полю состояния, дорожки по ПРОИЗВОЛЬНОМУ полю, спринты со сроками; доска = сохранённый запрос, а не жёсткие 4 колонки |
| TK-04 | Настраиваемые виджеты дашборда | medium | pending | TK-02 | Превратить `dashboard_*` в виджеты: список по запросу, burndown, распределение по полю, затраченное время; раскладка хранится на пользователя |
| TK-05 | Команды и workflow-правила, учёт времени | low | pending | TK-03 | `tasks_command("for me State Done")` по образцу YouTrack; правила на проект поверх графа допустимых переходов (данные и проверка — V-02); work items (затраченное время). Самое дорогое — после первых реальных пользователей |

---

## Этап T — Командная работа и вики (2026-10-30)

> Сверка 2026-10-30: `ACL-001..003` закрыты, но это только движок (выключен, не привязан к пользователям, без интерфейса);
> `SEC-001` пишет `audit.log`, смотреть его негде; вебхуков на события нет (единственный — завершение async-задачи памяти, NEXT-016).
> Без T-01/T-02 этап R (совместная работа) не имеет смысла. Пользовательская модель обязана учитывать этап S (исполнитель) и MU-03 (автор коммита).

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| T-01 | Пользователи, пароли и личные токены | high | done | MU-01 | Сейчас один админ из `MCP_LOGIN_USER/PASSWORD`. Хранилище: SQLite-файл `DATA_DIR/auth.db` через `better-sqlite3` (уже в dependencies), за интерфейсом `UserStore` (профили Y-05/Y-06 могут его подменить); пользователей заводит admin в админке; `auth.db` внести в `.gitignore` слоя истории (MU-03), хеши не включать в экспорты и backup (DX-16) без явного флага. Хеши — scrypt/argon2, не plaintext; роли, личные токены с именем, сроком и отзывом (список, revoke), смена пароля, управление из админки. `/auth/login` читает из хранилища, env-админ остаётся как bootstrap. Тесты: неверный пароль не различим по времени/тексту от неизвестного пользователя, отозванный токен не проходит, брутфорс-лимит сохранён |
| T-01a | `UserStore`: SQLite `auth.db`, scrypt, роли, личные токены | high | done | T-01 | `src/auth/user-store.ts`: scrypt-хеши (dummy для неизвестного), роли/disabled, смена пароля инвалидирует токены, токены только sha256+prefix, revoke/expiry, bootstrap env-админа; `/auth/login` читает store с env-fallback. DoD: тесты 8/8 + login 11/11, 4 мутации RED |
| T-01b | Админ-управление пользователями/токенами и валидатор в AuthManager | high | done | T-01, T-01a | MCP-инструменты/админ-UI для списка пользователей, создания, смены пароля, ролей, выпуска/списка/отзыва личных токенов; подключить `UserStore.verifyToken` как `TokenValidator` к `AuthManager`; сохранить брутфорс-лимит. T-01a хранилище и login уже готовы |
| T-01c | Web-админка пользователей и личных токенов | high | done | T-01, T-01b | Страница в `web-ui/app/access`: список пользователей, создание, смена пароля, роли, disable; список/выпуск/отзыв личных токенов через MCP admin-инструменты. Raw-токен показывать один раз, списки — только prefix. Дизайн — по `DESIGN.md` |
| T-02 | Права на уровне проекта + включить ACL | high | pending | T-01 | Подключить `ACLEngine` к пользователям: роли по проектам (viewer/editor/admin), по умолчанию включён; видимость проектов и инструментов по роли; UI управления участниками проекта. Живая проба: viewer не может писать, чужой проект не виден в `project_list`/поиске/`/ws`. Роли viewer/editor/admin по проектам, участников назначает admin в UI. ACL включён по умолчанию (решение владельца: после нового развёртывания в системе один админ, включение ничего не ломает); реализуется после T-01; флаг выключения сохранить; миграция существующих развёртываний: единственный env-админ становится admin всех проектов. |
| T-03 | Журнал действий в админке | medium | pending | T-01, MU-03 | Вкладка «кто, когда, что вызвал» поверх `audit.log` (фильтры по пользователю, инструменту, проекту, результату, времени; пагинация), ссылка на запись истории изменений. Только для admin; чувствительные поля уже маскируются (`redactFields`), проверить тестом |
| T-04 | Вебхуки и подписки на события | medium | pending | MU-03 | Исходящие вебхуки на события (задача создана/закрыта/изменена, документ изменён) с подписью HMAC, повторами и защитой от SSRF (как TR-28); подписки MCP (`resources/subscribe`, `listChanged`) для агентов без опроса. Настройка из админки. Тест: событие доставляется один раз, недоступный получатель не блокирует запись |
| T-05 | База знаний как вики | medium | pending | MU-03 | Wiki-ссылки `[[…]]` и граф обратных ссылок, шаблоны документов, вложения, статусы «черновик → опубликовано» с ревью, показ устаревших документов (по давности и якорям, как `memory:verify`, KE-04). Ссылки не должны ломать экранирование контекста (TR-17) |
| T-06 | Шаблоны и повторяющиеся задачи, обратные ссылки задача↔документ | low | pending | TK-01 | Шаблоны задач (поля по умолчанию), повторяющиеся задачи по расписанию (идемпотентно, без дублей после перезапуска), двусторонние ссылки между задачами и документами (`links` сейчас односторонние) |

---

## Этап U — Удобство для агентов (2026-10-30)

> Ставка: несколько агентов (Claude Code, OpenCode) работают с одним сервером одновременно; цена токенов и
> «двойная работа» важнее числа инструментов. Приоритеты: P0 = high, P1 = medium.
> Не дублирует: подписки/вебхуки — T-04, манифест возможностей — DX-15, trust-метки — TR-16 (done).
> Опора: `briefing` (src/register/briefing.ts), optimistic-lock MU-02, git-история MU-03, `withFileLock`
> (src/fs.ts), `SessionManager.prune` (src/core/session-manager.ts), `memory:verify` (scripts/verify-memory.mjs).
> Порядок: U-01 → U-03/U-04; U-02 — после MU-03 (до неё допустим `updatedAt`-фильтр); U-05 независим.

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| U-01 | Claim/lease задачи: два агента не берут одну работу | high | done | MU-01, MU-02 | Агент «берёт» задачу на TTL и продлевает heartbeat'ом. Поля задачи `claim: {bySessionId, byUserId, client, claimedAt, heartbeatAt, expiresAt}` — координационные: `renew` не двигает content-version MU-02, иначе heartbeat рождает ложный `CONFLICT` у чужих правок. Инструменты `tasks_claim({id, ttlSec})`, `tasks_renew`, `tasks_release`; `tasks_list`/`briefing` показывают владельца и срок. Просроченный lease снимается лениво при чтении и свипом (паттерн `SessionManager.prune`). Второй агент получает `{ok:false, code:'TASK_CLAIMED', holder, expiresAt}`; повторный claim своей задачи продлевает. MU-02 не дублируем (версии — его зона), MU-01 нужен, чтобы lease не ломался двумя серверами на одном `DATA_DIR`. DoD: `npm test -- tests/task-claim.test.ts` Реализовано (2026-10-30): `TaskClaim` в `src/types.ts`, `claimTask/renewTaskClaim/releaseTaskClaim/pruneExpiredClaims/startClaimSweeper` в `src/storage/tasks.ts` (все мутации под `withFileLock`, TTL 30 с–24 ч, default 1800; lease не трогает `updatedAt`, чтобы не мешать MU-02), инструменты `tasks_claim/tasks_renew/tasks_release` в `src/register/tasks.ts` (стабильные коды `TASK_CLAIMED`/`TASK_NOT_CLAIMED`, holder+expiresAt+hint), claim виден в `tasks_get`/`tasks_list`/`briefing`, фоновый свип `TASK_CLAIM_SWEEP_MS` (default 60000, 0 = off). MU-01/MU-02 не реализовывались. Тесты: `tests/task-claim.test.ts` (14, включая fake-clock expiry, гонку двух claim и renew без bump updatedAt); revert-check каждого поведения. Доки: `docs/features/tools.md`. |
| U-02 | Дельта «что изменилось с момента T» | medium | pending | MU-03 (мягко) | Инструмент `changes_since({since, project?, types?, includeDeleted?, limit?})` → `{items:[{kind,id,title,change,updatedAt}], nextSince}` по задачам, докам и фактам памяти. Источники до MU-03: `updatedAt` задач (`src/storage/tasks.ts`) и доков (`src/storage/knowledge.ts`), `recordedAt`/`validTo` графа фактов (`src/memory/temporal-graph.ts`), persisted `memory_fact`-доки, события знаний (`src/storage/knowledge-events.ts`). `nextSince` — серверное время начала запроса, не клиентское T: иначе расхождение часов даёт пропуски. После MU-03 удаления/переименования берутся из git-истории; до неё `includeDeleted` отдаёт `trashed/archived` как `change:'removed'`, а физические удаления не видны — это ограничение писать в описании инструмента. Дополняет `briefing` (снимок топ-N), не заменяет его. DoD: `npm test -- tests/changes-since.test.ts` |
| U-03 | Evidence при закрытии задачи | medium | pending | — | У задачи `evidence?: {commitSha?, ciUrl?, checkOutput?, note?, at, byUserId?, bySessionId?}`; `tasks_close` принимает `evidence` и валидирует: sha `^[0-9a-f]{7,40}$`, `ciUrl` только https, `checkOutput` ≤ 4 КБ. Настройка проекта `requireEvidence` — в `DATA_DIR/projects/<id>.json` (`readProjectMetadata`/`updateProjectMeta`, src/projects.ts; сейчас пишет только `description` — расширить схему). При включённой настройке закрытие без evidence → `{ok:false, code:'EVIDENCE_REQUIRED', hint:'pass commitSha, ciUrl or checkOutput'}`; evidence видно в `tasks_get` и (после MU-03) в истории. DoD: `npm test -- tests/task-evidence.test.ts` |
| U-04 | Экономия токенов в ответах | medium | pending | — | Частично реализовано в SC-01 (ветка `feat/list-pagination`): `fields`, `maxBytes`+`nextCursor`/`truncated`, курсор и стабильные коды ошибок уже есть на всех list/search-инструментах; остаётся `compact: true` и распространение на `memory_facts_*`-ответы. (1) `fields: string[]` на read-инструментах (`tasks_list`/`tasks_get`/`knowledge_list`/`knowledge_get`/`memory_facts_*`) — единый пост-фильтр, а не правка каждого обработчика; (2) `compact: true` — выкинуть null/пустые массивы и длинные текстовые поля, если не запрошены явно; (3) жёсткий `maxBytes` с `{items, nextCursor, truncated}` и стабильным порядком `(updatedAt desc, id)`, курсор — opaque base64; (4) ошибки `{ok:false, error:{code, message, hint, retryable}}` с кодами из `ErrorCategory`/`ToolError` (src/core/error-handler.ts) — сейчас `err()` (src/utils/respond.ts) отдаёт только message. Контракт BREAKING, клиентов нет. DoD: `npm test -- tests/response-economy.test.ts` |
| U-05 | Инструмент `memory_verify` (не только CLI) | medium | pending | KE-04 | Проверка актуальности факта по анкорам до того, как на него опереться. Логика уже есть в `scripts/verify-memory.mjs` (`npm run memory:verify`, package.json): статусы verified/pending-merge/stale/no-anchor, strong/weak анкоры, git-индекс, бюджеты `--limit`/`--budget-ms`. Вынести чистую часть в модуль (напр. `src/memory/verify.ts`) и переиспользовать скриптом и инструментом, чтобы вердикты не разъезжались. Вход `{factIds?, project?, budgetMs?, write?}`; выход по факту `{status, anchors:[{path,line,reason}], checkedAt}`; `write` обновляет теги только по явному запросу. DoD: `npm test -- tests/memory-verify-tool.test.ts` + паритет с `npm run memory:verify -- --limit 5` на одном `DATA_DIR` |
| U-06 | graph_neighbors: что связано с X и почему | medium | pending | U-04 | MCP-инструмент для агентов: одним вызовом вернуть соседей узла и причину связи (task dependency, document parentId, entity mention), с limit и fields по U-04. Без картинки и без нового серверного формата; использовать существующие связи и граф. DoD: `npm test -- tests/graph-neighbors.test.ts`; на проекте с задачей-блокером и документом-ребёнком ответ содержит оба типа связи и стабильный порядок. |

## Этап V — Workflow и доски задач (2026-10-30)

> Решение владельца: свои статусы, граф допустимых переходов (запрещённый перенос карточки блокируется и в UI, и на сервере),
> колонки со сворачиванием и горизонтальной прокруткой, типы задач и доски по типам (мультиселект типов: один тип — одна доска,
> несколько или «все» — дорожки друг под другом, как в YouTrack). Делается РАНЬШЕ TK-03/TK-05 и без языка запросов TK-02:
> настройки на проект в метаданных проекта (`readProjectMetadata`/`updateProjectMeta`, src/projects.ts). TK-03 и TK-05 потом
> надстраиваются поверх (доска = сохранённый запрос, команды `tasks_command`), а не дублируют этот этап.
> Опора: `Status` в src/types.ts (сейчас зашито `pending|in_progress|completed|closed`), `web-ui/app/tasks/page.tsx` (канбан),
> аудит UX `docs/ui/ux-audit-2026-10.md` (UI-16: список/таблица и массовые действия, UI-10..UI-12: дизайн-система и состояния).
> Порядок: V-01 → V-02; V-03 независим; V-04 после V-01/V-02/V-03; V-05 после V-03.

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| V-01 | Статусы на проект | high | done | — | Набор статусов в метаданных проекта: `{id, label, category, color, order, archived?}`, где category — одно из todo, in_progress, done; `Status` перестаёт быть жёстким union, дефолтный набор = текущие четыре (обратная совместимость, без миграции задач). Валидация zod: уникальные id, ≥1 статус категории done, нельзя удалить статус, который используют задачи (понятная ошибка со списком задач или режим «перенести в X»). Инструменты `project_statuses_get/set` (или поля `project_update`); `tasks_create/update/list` проверяют статус по набору проекта. Метрики `dashboard_*` считаются по категории, а не по имени статуса (иначе «Completion 0%» врёт на кастомных). DoD: `npm test -- tests/project-statuses.test.ts` (дефолт, свой набор, удаление занятого статуса, дашборд по категориям) Реализовано (2026-10-31): `src/workflow.ts` — `ProjectStatus`/`ProjectWorkflow`, дефолтные четыре статуса и legacy `blocked`; `src/workflow-service.ts` — `project_statuses_get/set`, атомарный `moveTo/moves` под `withFileLock`, проверка занятых статусов (до 20 task id); `src/projects.ts` — поля `statuses/transitions/closeStatus/initialStatuses` в `.project.json`, `updateProjectMeta` под lock; `src/storage/tasks.ts` — валидация статуса и `tasks_close` по `closeStatus`; категории в dashboard/briefing/DAG; клиент `api.projects.statuses`; тесты `tests/project-statuses.test.ts` (5), `tests/project-statuses-concurrency.test.ts` (1), `tests/doctor-data.test.ts` (30); API reference перегенерирован. |
| V-02 | Граф допустимых переходов | high | done | V-01 | Таблица `transitions: {from: [to,...]}` в метаданных проекта, по умолчанию «любой в любой» (текущее поведение). `tasks_update`/`tasks_bulk_update`/`tasks_close` отклоняют запрещённый переход `{ok:false, code:'TRANSITION_NOT_ALLOWED', from, to, allowed:[...], hint}` — проверка на сервере, UI только отражает её. Массовая операция: по каждой задаче отдельный результат, остальные проходят. Правка графа валидируется (все ссылки на существующие статусы, нет недостижимых done-статусов). Согласовать с TK-05 («допустимые переходы и правила на проект»): V-02 даёт данные и проверку, TK-05 добавляет правила и команды. DoD: `npm test -- tests/task-transitions.test.ts` (разрешён/запрещён, bulk с частичным отказом, дефолт не меняет поведение) + revert-check Реализовано (2026-10-31): `transitions` в метаданных проекта, default any-to-any, `project_transitions_get/set`; проверка перехода в storage (единый путь для update/close/bulk), стабильный `TRANSITION_NOT_ALLOWED` с `from/to/allowed/hint`; bulk update/close возвращают `failed` по каждой задаче; граф валидирует ссылки и достижимость done; тесты `tests/task-transitions.test.ts` (5), клиентский live-тест `api.projects.transitions`; revert-check ключевых проверок. |
| V-03 | Тип задачи | medium | done | — | Поле `type` у задачи (набор типов на проект: `{id,label,color,icon}`; дефолт: task, bug, feature). Совпадает с «типом» из TK-01 — здесь вводится только он, остальные поля проекта остаются в TK-01; при реализации TK-01 тип переезжает в схему полей без смены формата. Фильтр `type` в `tasks_list`/`search_tasks`, `briefing` показывает тип. Старые задачи без типа = `task` (без миграции). DoD: `npm test -- tests/task-type.test.ts` Реализовано (2026-10-31): `ProjectType`/`DEFAULT_PROJECT_TYPES` и `loadProjectTypes` в `src/workflow.ts`; `project_types_get/set` с `TYPE_IN_USE`, `moveTo/moves` и `TYPE_NOT_ALLOWED`; `tasks_create/update/bulk_*`, `tasks_list/tree`, `search_tasks` принимают `type`; старые задачи без типа читаются как `task`; `briefing` и `dashboard_stats` дают распределение по типам; клиент `api.projects.types`, live-тест 7 passed. Тесты: `tests/task-type.test.ts` (5). |
| V-04 | Доска: прокрутка, сворачивание и скрытие колонок, блокировка запрещённого переноса | high | done | V-01, V-02 | `web-ui/app/tasks/page.tsx`: колонки из статусов проекта (а не константа `COLUMNS`); горизонтальная прокрутка при многих колонках (sticky-заголовки, видимый индикатор «ещё N колонок», прокрутка при перетаскивании у края); колонка сворачивается в узкую полосу со счётчиком и снова разворачивается, можно скрыть совсем (чипы «показать скрытые»); состояние хранится на пользователя в `localStorage` (ключ с id проекта). При перетаскивании запрещённые колонки приглушаются, курсор `not-allowed`, drop отклоняется с понятным сообщением (причина из `allowed` ответа сервера); сервер остаётся источником истины (оптимистичный перенос откатывается при отказе). Клавиатурный перенос (меню «Переместить в…» только с разрешёнными статусами) — доступность по UX-аудиту. DoD: тест компонента колонок (свёрнуто/скрыто, запрет drop) + сценарий в браузере со скриншотами в PR Реализовано (2026-10-31): чистая логика `web-ui/lib/board.ts` — порядок статусов и архивные, разделение видимых/скрытых/свёрнутых колонок, `allowedTargets` (зеркало серверного `allowedTransitions`: нет графа или нет ключа `from` — все статусы), индикатор переполнения и маппинг цвета статуса в токен; 19 unit-тестов + revert-check. Страница грузит `project_get_current` → `project_statuses_get` + `project_transitions_get` + `tasks_list` проекта, рисует 9 колонок по 264 px (свёрнутая 48 px), sticky-заголовки в ограниченном по высоте скроллере, кнопки-индикаторы «ещё N колонок» слева/справа с плавной прокруткой и авто-прокруткой у края при перетаскивании; сворачивание/скрытие с чипами «Show hidden» и хранением в `localStorage` по ключу `mcp.tasksBoard.<project>` (try/catch, fallback); перетаскивание учитывает граф: запрещённые колонки приглушены, `cursor: not-allowed`, dragover без preventDefault, при drop показывается серверный `TRANSITION_NOT_ALLOWED` с `hint` и списком `allowed`, оптимистичный перенос откатывается; меню «Move to…» содержит только разрешённые статусы. Задачи с неизвестным проекту статусом остаются отдельной концевой колонкой «(not in project)». Тесты: `web-ui/lib/board.test.ts` (19), компонентные SSR-тесты `web-ui/app/tasks/board-render.test.tsx` (5: свёрнутая колонка, запрет drop, меню), живой `web-ui/lib/board.live.test.ts` (9 статусов, разрешённый `backlog→triage`, отказ `triage→done` с `allowed: [ready, blocked]`). Revert-check: игнорирование графа в `allowedTargets` роняет 3 теста, снятие try/catch в чтении prefs — 2 теста. Браузер (Chrome, свой сервер 3481/UI 3480): 9 колонок, `scrollWidth 2472` при `clientWidth 1140` → «4 more»; свёрнутая колонка 48 px и prefs переживают reload; скрытие QA даёт чип и возвращает колонку; `doing→qa` — `data-drop=denied`, opacity 0.5, not-allowed, сообщение с `Allowed: In review, Blocked`, карточка осталась на месте; `doing→review` переносит; меню для `doing` — ровно `In review, Blocked`; sticky-заголовок после прокрутки доски на 200 px остаётся на её верху; 390 px без горизонтального overflow страницы, 0 pageerror. Скриншоты: `docs/ui/screens/ui-v04/` (9). |
| V-05 | Доски по типам: мультиселект и дорожки | medium | done | V-03 | Над доской мультиселект типов (по умолчанию «все»): выбран один тип — одна доска; выбрано несколько или «все» — дорожки друг под другом (по одной на тип, с заголовком, счётчиком и сворачиванием дорожки), колонки у дорожек общие и выровнены. Выбор хранится на пользователя и проект. На телефоне дорожки сворачиваются по умолчанию, остаётся компактный переключатель типов. Пустые дорожки скрываются (с опцией показать). Задачи без типа считаются task. Перенос внутри дорожки работает как в V-04, смена типа — только через форму. DoD: компонентный тест + сценарий в браузере со скриншотами Реализовано (2026-11-02): чистая логика `web-ui/lib/board-lanes.ts` — порядок дорожек из набора типов, группировка задач по типу (без типа = task), неизвестные типы в одну дорожку Other (только при выборе «все»), счётчики, скрытие пустых дорожек с опцией показа, resolve/reconcile выбора, prefs `mcp.tasksBoardLanes.<project>` (try/catch, fallback, флаг stored для мобильного дефолта), маппинг цвета типа в токен; 17 unit-тестов. UI: `TypeMultiSelect` (настоящие checkbox в details, «All types», «Show empty lanes», компактная подпись на телефоне); общая сетка — один горизонтальный скроллер и один sticky-ряд заголовков статусов, дорожки друг под другом с заголовком (иконка, цвет, счётчик, сворачивание), колонки выровнены (замер: max Δ 0 px по 8 статусам); свёрнутые дорожки и выбор типов в `localStorage`, на 390 px дорожки свёрнуты по умолчанию; один тип — одна доска без дорожек и серверный фильтр `tasks_list` с `type` через `callToolAll` (все страницы); выбор типа с видимой подписью в формах создания и редактирования (дефолт task); бейдж типа на карточке (иконка и цвет токена); drag только внутри дорожки, межтиповой перенос отклоняется с причиной «Change the type in the card form», смена типа — только формой. Тесты: `board-lanes.test.ts` (17), `board.test.ts` (19), SSR `board-render.test.tsx` (14: дорожка, свёрнутая дорожка, бейдж, мультиселект), живой `board-lanes.live.test.ts` (1: типы, фильтр по типу, lanes, TYPE_NOT_ALLOWED). Revert-check: `allowedTargets` без графа — 3 теста, prefs без try/catch — 2. Браузер: 4 дорожки Task 6 / Bug 6 / Feature 5 / Chore 4; только Bug — 0 дорожек и 6 задач, запрос `type=bug` и `limit=200`; свёрнутая Feature — только заголовок, prefs переживают reload; drag bug backlog→ready разрешён, над чужой дорожкой denied + причина; смена типа в edit — карточка в feature; создание с feature — в feature; docs-only — пустое состояние, showEmpty показывает дорожку; 390 px — scrollWidth 390, все дорожки свёрнуты; 0 pageerror. Скриншоты: `docs/ui/screens/ui-v05/` (8). Этап V завершён. |

---

## Этап W — Админка: дизайн и UX (2026-10-31)

> Решения владельца (2026-10-31): база — направление A (Registry) + карточка агента со шкалой lease (из B) + режим чтения документа (из C); геометрия, шрифты и плотность одинаковы для всех палитр. Две независимые оси темы: режим (светлый, тёмный, как в системе) и палитра (набор токенов: акцент, поверхности, линии, цвета статусов, типов и приоритетов). Атрибуты `data-mode` и `data-theme` на корне, выбор в `localStorage`, inline-скрипт в layout применяет тему до отрисовки без мигания, переключатель — в Topbar. Стартовый набор — три палитры из макетов: Petrol (Registry), Copper (Night Desk), Indigo (Workbench, нынешний бренд); по умолчанию предлагается Indigo — на подтверждение владельца. Все компоненты берут цвета только из токенов; тема, не проходящая WCAG AA, не проходит CI.
> Источник задач — UX-аудит `docs/ui/ux-audit-2026-10.md` (§7, UI-10..UI-22) и макеты `docs/ui/design-directions-2026-10.md` (§7 рекомендация, §8.1 решения, §9 контраст). Не дублирует: `UI-001..UI-007` (фундамент Web UI), `V-04`/`V-05` (колонки и дорожки доски), `TK-02`/`TK-03`/`TK-04`, `MU-05`, `T-03`, `T-05`, `DX-29`.
> Порядок: UI-13 (P0, падения Knowledge) первым и без зависимостей; UI-22 независим (безопасность); UI-10 → UI-11/UI-12/UI-15 → UI-24 (страницы по одной: Knowledge → Tasks вместе с V-04/V-05 → Overview → остальные по убыванию числа зашитых цветов); UI-14 после UI-22.
> Решения владельца (2026-10-31): граф знаний нужен и команде (UI), и агентам (API и MCP); UI-30..UI-32 и U-06 ниже. UI-29 уже существует и не дублируется; UI-28 — смежная задача, должна быть в ветке/мерже до старта UI-30.

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| UI-13 | «Знания»: устранить падения и сделать поиск серверным | critical | done | — | При открытии документа запрашивать `knowledge_get`; тип элемента списка — без `content`; поиск по содержимому через `search_knowledge` вместо клиентского фильтра; защита от `undefined` в `renderMarkdown`. DoD: e2e `/knowledge`: создать документ, открыть, отредактировать, сохранить, `pageerror === 0`; ввод несовпадающего запроса не роняет страницу (в `document.body` список, а не «This page couldn't load»); `npm --prefix web-ui run test` зелёный Реализовано (2026-10-31): `KnowledgeListItem` без `content` в `web-ui/lib/api-client.ts`, нормализация `toKnowledgeListItem`/`normalizeKnowledgeItems` (`web-ui/lib/knowledge.ts`), открытие документа через `knowledge_get` с состояниями загрузки/ошибки, серверный поиск `search_knowledge` с debounce и пустым состоянием «ничего не найдено» + сброс, guard `renderMarkdown(undefined)`; `app/error.tsx` и `app/global-error.tsx` с «Повторить» и ссылкой на Overview. Тесты: `web-ui/lib/knowledge.test.ts` (6), `web-ui/lib/markdown.test.ts` (guard), live `web-ui/lib/api-client.live.test.ts` (create→list→get→search, 4 passed). Revert-check: снятие guard и возврат `content` в item → тесты падают. Скриншоты до/после: `docs/ui/screens/ui-13/` (F-01/F-02 воспроизведены на master-коде). |
| UI-22 | WS: токен не в URL | high | done | — | Убрать JWT из query-строки WebSocket. Варианты по возрастанию цены: `Sec-WebSocket-Protocol` с `bearer.<jwt>`; первое сообщение `{type:'auth', token}` сразу после `open` до `subscribe` с закрытием `4001` по таймауту 5 с; одноразовый ticket `POST /auth/ws-ticket` (TTL 30–60 с, привязка к сессии) и `?ticket=`. Учесть, что WS не проксируется Next: клиенту нужен `NEXT_PUBLIC_MCP_WS_URL`. Не дублирует AUD-06 (аутентификация WS, done), TR-20 (rate-limit по IP), TR-32 (redaction логов), DX-30 (описание устарело). DoD: `rg -n "searchParams.set\('token'" web-ui/lib/realtime.ts` → 0; в Network нет query с токеном; `tests/e2e-full/aud-high-security.test.ts` дополнен: без токена `4001`, с токеном соединение и `subscribe` работают, повторный redeem ticket отклонён; в access-log нет подстроки `eyJ` Реализовано (2026-10-31): схема «одноразовый ticket». `POST /auth/ws-ticket` (Bearer JWT в заголовке, как у защищённых маршрутов) выдаёт случайные 256 бит, TTL 30 с, single-use, in-memory `Map` с lazy-sweep и лимитом; ticket привязан к `sub` и `jti`, при `revokeByJti` не принимается (`src/core/ws-ticket.ts`, `src/transport/ws-ticket-route.ts`). WS upgrade принимает только `?ticket=`, старый `?token=<JWT>` отклоняется (4001); identity берётся из ticket, клиентский `?userId=` не подменяет её. Клиент `web-ui/lib/realtime.ts` получает новый ticket перед каждым подключением/переподключением; 401 → auth-expired (без цикла), сеть → обычный backoff. Логи не содержат ни JWT, ни ticket (логируются только userId/ip/reason). Тесты: `tests/ws-ticket.test.ts` (13: store + live endpoint/handshake, replay/expired/revoked/old token), `tests/realtime-auth.test.ts` (10), live e2e AUD-06 (ticket, replay, legacy), web-ui `lib/realtime.test.ts` (+7). Revert-check: single-use, TTL, revocation, client URL. Живая проверка: UI Tasks → «● Live», URL сокета `ws://127.0.0.1:3411/ws?ticket=<redacted>`, в логах нет `eyJ`/ticket. Скриншот: `docs/ui/screens/ui-22/tasks-live.png`. |
| UI-10 | Дизайн-система: токены, примитивы и две оси темы | high | done | — | Один набор токенов (цвет, радиус, тень, шкала шрифта, отступы) + примитивы `Button`, `IconButton`, `Input`, `Select`, `Card`, `Table`, `Badge`, `Modal`, `Toast`, `EmptyState`, `Skeleton`. База — A (Registry) + карточка агента со шкалой lease из B + режим чтения документа из C; геометрия и шрифты общие для всех палитр. Две независимые оси: `data-mode` (light, dark, system) и `data-theme` (Petrol, Copper, Indigo) на корне; выбор в `localStorage`; inline-скрипт в layout до отрисовки; переключатель в Topbar. Стартовый набор палитр: Petrol (A), Copper (B), Indigo (C, нынешний бренд); по умолчанию Indigo — на подтверждение владельца. Все цвета — только из токенов; зашитые классы на 8 старых страницах заменяются в UI-24 (базлайн 188: memory 52, analytics 29, graph 24, prompts 24, system 22, projects 17, knowledge 13, search 7 — не расти). CI-тест контраста WCAG AA для каждой палитры и режима (текст/фон, акцент/фон, статусы, типы, приоритеты), расчёт как в §9. Вне объёма: высококонтрастная палитра (UI-23), пользовательские темы с импортом JSON, сохранение выбора в серверном профиле (T-01), раскладки B и C как темы. DoD: `npm --prefix web-ui run build`; `npm --prefix web-ui run test -- lib/theme.contrast.test.ts` (новый тест: 3 палитры × 2 режима + system, порог 4.5:1); Playwright: сохранённые mode=dark и theme=copper дают `html[data-mode="dark"][data-theme="copper"]` до первого кадра (без вспышки); `rg -c "window.confirm" web-ui/app` → 0; `rg -n "v\\{p\\.version\\}" web-ui/app/prompts` → 0 Реализовано (2026-10-31): токены `@theme`/`@theme inline` в `web-ui/app/globals.css` (геометрия/шрифты/плотность A, 3 палитры × 2 режима, семантические токены, старые имена сохранены); две оси `data-theme`/`data-mode` + `lib/theme.ts`, inline-скрипт в `app/layout.tsx` до отрисовки, `ThemeManager` следит за system, `ThemeSwitcher` в Topbar (aria, Esc, клик-вне); примитивы `components/ui/*` (Button/Input/Select/Textarea/Card/Badge/Dialog/Skeleton/EmptyState/Tooltip), витрина `/design` (6 вариантов, production → 404); AppShell/Sidebar/Topbar и существующие components переведены на токены; страницы в старом стиле не переверстывались. Тесты: `web-ui/lib/theme.contrast.test.ts` (20 пар × 6 вариантов, все ≥ порогов; text-пары ≥4.5, line-strong/focus ≥3), `web-ui/lib/theme.test.ts` (6). Revert-check: испорченный токен → контраст падает. Скриншоты: `docs/ui/screens/ui-10/` (6 design + 6 Tasks/Overview + mobile Topbar). Зашитые цвета на старых страницах (вход для UI-24, regex bg/text/border-палитры + hex): memory 81, analytics 27, graph 27, prompts 34, system 27, projects 25, knowledge 29, search 9. |
| UI-11 | Контракт страницы и навигация | high | done | UI-10 | `PageHeader` на всех страницах, ровно один `h1`, skip-link, активное состояние пункта меню, «Overview» в навигации (или логотип-ссылка), единый источник заголовка (Topbar не дублирует `h1`), короткая метка раздела для узких экранов. DoD: Playwright по 12 маршрутам: `h1` ровно 1, skip-link переводит фокус в `main`; скриншот-сравнение заголовков; на `/` можно попасть из меню |
| UI-11a | PageHeader/h1, skip-link, Overview и активная навигация (без Playwright) | high | done | UI-11 | `PageHeader` — единственный `h1`; Topbar без `h1`; внутренние `h1` knowledge/prompts → `h2`; skip-link → focusable `main#main-content`; Overview в nav + `shortLabel`; `tests page-contract` 5/5, 3 мутации RED. Playwright — UI-11b |
| UI-11b | Playwright: 12 маршрутов, skip-link focus, скриншот-сравнение заголовков | high | done | UI-11, UI-11a | Добавить `@playwright/test`, конфиг и e2e-спеку: по 12 маршрутам ровно один `h1`, skip-link переводит фокус в `main`, скриншот заголовка (baseline для Linux CI), переход на `/` из меню. В браузере gates не требуется MCP-сервер: при недоступном API AppShell дорисовывает страницу |
| UI-12 | Контракт состояний (loading, error, empty, offline) | high | done | UI-10 | Состояния не смешиваются (`error` побеждает `empty`), `app/error.tsx`, `app/loading.tsx`, `not-found.tsx`, скелетоны вместо «Loading...», «Сервер недоступен» + «Повторить», баннер «Сессия истекла» на `/login`. DoD: сценарий отказа `route.abort('**/api/mcp**')` на 11 маршрутах: на каждом сообщение об ошибке и кнопка повтора, нигде нет одновременно пустого состояния; просроченный JWT ведёт на `/login` с баннером и возвратом на `next`; `rg -c "Loading\\.\\.\\." web-ui/app` → 0 |
| UI-12a | app-level states: loading/not-found/error и баннер истёкшей сессии (без Playwright) | high | done | UI-12 | `app/loading.tsx` на `SkeletonCard`, `app/not-found.tsx` со ссылкой на `/`, `error.tsx` с retry; `AppShell` добавляет `expired=1` и `next`, `/login` показывает баннер; `states-contract` 5/5, 3 мутации RED. Playwright abort — UI-12b |
| UI-12b | Playwright: error > empty, «Сервер недоступен» + «Повторить» на 11 маршрутах, abort('/api/mcp') | high | done | UI-12, UI-12a | Сценарий `route.abort('**/api/mcp**')`: на каждом маршруте сообщение об ошибке и кнопка повтора, нигде одновременно пустое состояние; просроченный JWT ведёт на `/login` с баннером и возвратом на `next`; `rg -c "Loading\\.\\.\\." web-ui/app` → 0. Добавить `@playwright/test` и конфиг |
| UI-15 | Доступность до AA | high | done | UI-10 | Подписи и `aria-label` на всех полях, `aria-label` на иконочных кнопках, клавиатурный доступ к карточкам и узлам графа, `role="tab"` и `aria-selected` для табов, `aria-expanded` для раскрывашек, брендовое `focus-visible`-кольцо, токен `--color-muted` с контрастом ≥ 4.5:1. DoD: `@axe-core/playwright` на 12 маршрутах: 0 critical и serious; скрипт контраста: 0 пар ниже 4.5:1; Tab-обход `/knowledge`, `/tasks`, `/graph` доходит до основного действия |
| UI-14 | Честный индикатор realtime | high | done | UI-22 | Таймаут подключения 5 с, после него «Offline», попытка переподключения видна; один источник статуса в shell; на страницах без live индикатора нет; popover «что это и как включить» (`NEXT_PUBLIC_MCP_WS_URL`); причина сбоя человеческим языком; убрать обещание несуществующего polling. DoD: Playwright с таймингом: при недоступном WS бейдж «Offline» ≤ 5 с; в исходниках нет «polling», если polling не реализован; инструкция в `docs/` со ссылкой из popover Реализовано (2026-10-31): единый индикатор в Topbar на всех страницах; состояния Live, Connecting (attempt), Reconnecting (countdown), Offline (Retry now), Realtime off с причиной и действием; 5-секундный таймаут WS и ticket, ticket 401 — существующий login flow, ticket network/5xx — Reconnecting; страница работает без realtime; aria-live с дебаунсом, текстовая подпись не только цвет; общий статус-мост owner-safe, Knowledge badge удалён, Tasks не менялся. Тесты: `web-ui/lib/realtime-state.test.ts` (9), `web-ui/lib/realtime.test.ts` (28), live `web-ui/lib/realtime.live.test.ts` (2), полный web-ui 193 passed/9 skipped. Инструкция: `docs/deployment/realtime.md`; скриншоты `docs/ui/screens/ui-14/` (13). |
| UI-16 | Задачи: список и таблица, массовые действия, быстрые фильтры | high | done | UI-10, V-04, V-05 | Переключатель «Доска / Список», таблица с сортировкой по колонкам, выбор задач и bulk-операции (`tasks_bulk_update`, `tasks_bulk_close`), чипы быстрых фильтров (мои, без исполнителя, просроченные — после TK-01), кнопки агентских действий после U-01/U-03. Сохранённые фильтры — после TK-02. DoD: на `/tasks` вид сохраняется в `localStorage`; выбор 3 задач и «Закрыть» закрывает все три (проверка `tasks_list`); сортировка по приоритету меняет порядок строк; e2e в `web-ui` зелёный |
| UI-17 | Overview как «что требует внимания» | high | done | UI-10, U-01 | Убрать 10 карточек-дублей меню; виджеты: заблокированные задачи, ближайшие сроки, задачи под claim (U-01), устаревшие документы (KE-04), лента последних изменений (MU-03 или U-02); у каждого виджета пустое состояние с действием; метрики с согласованными значением и подписью. DoD: на `/` ни одна карточка не ведёт просто в раздел без данных; «KNOWLEDGE N» и число тегов считаются от одной сущности (проверка на данных: N документов, M тегов, оба числа объяснены); лента показывает ≥ 3 события после правки задачи и документа |
| UI-18 | Analytics: тренды и активность | medium | pending | UI-10 | График создания и закрытия за период (день или неделя) на `dashboard_trends`, лента `dashboard_activity`, фильтр периода, осмысленное пустое состояние. Зависит от TK-04 только в части раскладки виджетов. DoD: `/analytics` показывает график с переключением day/week и ленту ≥ 10 событий; при пустом проекте объяснение и кнопка «Создать задачу»; используемые инструменты видны в Network (нет мёртвых вызовов) |
| UI-19 | System и Access как админ-раздел | medium | pending | UI-10 | Пагинация и поиск каталога инструментов (доступны все 119), таблица сессий с фильтром и кнопкой «Завершить сессию», раздел auth — 2–3 шага вместо абзаца, ссылка на `/access`; мобильная раскладка таблиц в карточки. DoD: `/system` позволяет открыть инструмент из хвоста каталога (поиск по имени № 119 находит его); завершение сессии убирает её из списка и из `session_list`; высота страницы < 2000 px при 5 строках на страницу |
| UI-20 | Мобильная версия | medium | pending | UI-10, UI-11 | Навигация через бургер или нижние табы вместо полосы из 10 пунктов; цели нажатия ≥ 44 px; таблицы в карточки; основное действие страницы закреплено; проверка на 390×844 и 768×1024. DoD: Playwright на 390×844: ни одна цель нажатия < 44 px, меню открывается и закрывается, активный раздел виден; горизонтальный overflow 0 на всех 12 маршрутах; скриншоты в PR |
| UI-21 | Access: сценарий «подключить агента» | medium | pending | UI-10, UI-12, DX-29 | Переписать `/access` как пошаговый сценарий: создать setup-link (DX-29), готовый сниппет конфига (MCP URL и токен) с копированием, «Проверить подключение» вызовом `ping` или `initialize` с этим токеном, человеческий текст вместо «Link lifetime minutes». DoD: Playwright: новый пользователь проходит 5 шагов (создать ссылку, скопировать сниппет, «Проверить» → «Подключение работает»); при недоступном сервере сообщение об ошибке (UI-12) |
| UI-23 | Высококонтрастная палитра | low | pending | UI-10 | Четвёртая палитра (например, High contrast) поверх тех же токенов и компонентов: усиленные границы, чистый фон, контраст текста ≥ 7:1 (AAA) для основных пар; не является режимом и не смешивается с mode: это отдельный `data-theme`. Доступность: не ломает AA-тест остальных палитр. DoD: тест контраста `lib/theme.contrast.test.ts` покрывает палитру и проходит порог AAA для основных пар; Playwright: `data-theme` переключается без мигания, все 12 маршрутов рендерятся; отдельный пункт меню в Topbar не добавляется (палитра в общем списке) |
| UI-24 | Переход страниц на токены и общие компоненты, по одной | high | done | UI-10, UI-13 | Заменить зашитые классы и `#hex` на токены и примитивы по одной странице в порядке: Knowledge (после UI-13) → Tasks (вместе с V-04/V-05) → Overview → остальные по убыванию зашитых цветов (memory 52, analytics 29, graph 24, prompts 24, system 22, projects 17, knowledge 13, search 7). Каждая страница: без изменения продуктовой логики, состояния через UI-12, доступность через UI-15; скриншоты 1440×900 и 390×844. DoD: после последней страницы `rg -n "bg-blue-" web-ui/app`, `rg -n "bg-green-" web-ui/app`, `rg -n "bg-gray-" web-ui/app`, `rg -n "#[0-9a-fA-F]{3,8}" web-ui/app` → 0 (кроме файла токенов); `npm --prefix web-ui run build` и `npm --prefix web-ui run test` зелёные; в PR — таблица «страница → было/стало» и скриншоты **Часть 1 (Tasks, Overview, Access, Login + оболочка) выполнена 2026-10-31. Часть 2 (Knowledge + экран чтения) выполнена 2026-10-31. Часть 3 (Memory, Analytics) выполнена 2026-10-31. Часть 4 (Graph, Prompts) выполнена 2026-10-31. Часть 5 (Projects, System, Search) выполнена 2026-10-31; все страницы UI-24 мигрированы.** Сделано: все зашитые цвета этих страниц и shell-компонентов заменены токенами (0 по guard-тесту), кнопки/поля/карточки/бейджи/empty/skeleton — на примитивах `components/ui`; Live-пилюля переведена на `st-done/st-doing/muted`; добавлен `web-ui/lib/no-hardcoded-colors.test.ts` (явный список файлов). Скриншоты: `docs/ui/screens/ui-24a/` (14: Tasks/Overview ×4 варианта, Access/Login ×2, mobile ×2). Часть 2: Knowledge и markdown-рендерер переведены на токены и примитивы, `window.confirm` заменён на `Dialog`, у полей есть подписи; добавлен экран чтения с TOC, метаданными и Export/Edit/Trash; prose оформлен для h1–h4, списков, цитат, кода, таблиц и линий; санитизация ссылок сохранена. Тесты: `web-ui/lib/markdown.test.ts` (23), `web-ui/lib/knowledge.test.ts` (6), контраст дополнен парами `ink/surface-2`, `muted/surface-2`, `accent/surface`; скриншоты `docs/ui/screens/ui-24b/` (13). Часть 3: Memory и Analytics переведены на токены и примитивы, вкладки Memory получили `role=tablist/tab/tabpanel` и клавиатурную навигацию, бары Analytics используют токены `st-*`/`pr-*` и `aria-valuetext`, у полей есть подписи; контраст дополнен парами статусов/приоритетов на `surface-2` (32 пары × 6 вариантов), guard включает обе страницы; скриншоты `docs/ui/screens/ui-24c/` (14). Часть 4: Graph рисует узлы/рёбра токенами через `getComputedStyle` и `MutationObserver`, добавлены легенда и сворачиваемая таблица узлов; Prompts использует `Badge` для статусов, нейтральные теги, подпись `latest` и доступные вкладки; контраст дополнен парой `st-done/canvas` (33 пары × 6 вариантов), guard включает Graph, Prompts и `graph-theme`; скриншоты `docs/ui/screens/ui-24d/` (13). Часть 5: Projects, System и Search переведены на токены и примитивы; три `window.confirm` заменены на `Dialog`, purge требует ввода id, System получил семантическую таблицу сессий и сокращённый auth-текст, Search — `EmptyState`/`Card`/`Badge`; подпись переключателя темы показывает разрешённый режим и совпадает с `html data-mode` (проверено 6 вариантов, reload, system и клавиатура), Graph перекрашивается при смене темы; guard динамически покрывает все app-страницы, top-level components и error boundaries, allowlist — только брендовый `app/icon.svg`; скриншоты `docs/ui/screens/ui-24e/` (14). |
| UI-25 | Дерево: задачи и документы | medium | done | UI-10 | Общий `TreeView` в `components/ui`: раскрытие/сворачивание, клавиатура, aria-expanded. В UI-16 — дерево задач в таблице с раскрытием подзадач, созданием подзадачи, выбором родителя, прогрессом «3 из 5» у родителя. Дерево документов по `parentId` (`knowledge_tree` уже есть на сервере; в UI нет ни дерева, ни выбора родителя), переключатель дерево/список, хлебные крошки в экране чтения, путь в результатах поиска. Перенос списка документов в навигатор (идея Workbench) — решение владельца, вне этой задачи. DoD: компонентный тест дерева; UI-16/Knowledge показывают вложенность и выбор родителя; `npm --prefix web-ui run test` зелёный. |
| UI-26 | Промпты: просмотр, редактирование, удаление | high | done | UI-10 | Карточка промпта открывает просмотр с полным template/compose, metadata, variables и списком версий; Edit — форма с label/hint, Save только изменённых полей через `prompts_bulk_update`, Cancel с confirm при несохранённых изменениях, Delete через destructive `Dialog`. Для полного текста добавлен `prompts_get` (версия по умолчанию — latest semver). Реализовано (2026-10-31): `prompts_get` + тест `tests/prompts-get.test.ts`; клиент `api.prompts.get/update/delete`; `lib/prompt-edit.ts` + 5 тестов (точечный patch, dirty-state, validation); live-тест create→get→update→get→delete; скриншоты `docs/ui/screens/ui-26/` (view/edit Indigo light+dark, validation, unsaved Dialog). |
| UI-27 | Единая форма поле-с-подписью, выравнивание формы Projects | medium | done | UI-10 | Использовать общий field-компонент (`Input`/`Select`/`Textarea` с label/hint/error) и выровнять форму New project: подписи на одной линии, поля одной высоты, подсказки у обоих полей, Create по нижнему краю поля, на телефоне — столбиком. Реализовано (2026-10-31): общий `FieldShell` уже был в `components/ui/Field.tsx`; Projects использует его через `Input`, добавлены hints у обоих полей и выравнивание Create; проверены другие формы с `items-end` — там поля без расхождения hint-строк. Скриншоты `docs/ui/screens/ui-26/projects-*`. |
| UI-28 | Граф знаний: читаемые подписи, понятные соседи, два режима | high | done | UI-24 | Подписи у всех узлов: сущности — полным именем, факты — сокращённым текстом (≤40 символов) при наведении/выборе и при достаточном приближении; жадное размещение без пересечений и обрезки за границей области, при коллизии менее важная подпись скрывается и появляется при наведении/выборе/приближении. Кнопка `Expand` заменена на `Show related facts` с пояснением «Loads more facts that mention «X»», состоянием загрузки, результатом (`Loaded N more facts` / `No more facts for «X»`) и disabled, когда дозагружать нечего; слово «neighbors» убрано. Панель: у сущности — `Mentioned in N facts` со списком фактов и `Often appears with` (с числом общих фактов, клик выбирает сущность), у факта — полный текст, категория, confidence, validFrom/validTo, теги, `Replaces`/`Replaced by`, кликабельные сущности; пустое состояние объясняет цвета и рёбра. Легенда под графом (сущность, факт, заменённый факт пунктиром, mentions, co-occurs, replaces пунктиром, толщина = число общих фактов). Два режима сегментами: `Entities` (по умолчанию, только сущности, ребро = со-упоминание в одном факте, толщина ∝ числу общих фактов, число на ховере, размер узла ∝ числу фактов) и `Facts & entities` (двудольный граф с mentions и replaces); выбор в `localStorage` (`graph.mode`). Навигация: зум колесом/кнопками вокруг указателя, пан фоном, клавиши `+`/`−`/`0`/стрелки, уровень зума текстом. Фокус на выбранном (соседи ярко, остальное приглушено, подписи скрыты) и поиск (подсветка совпадений, приглушение остальных, узлы не удаляются). Доступность: граф `role=img` с aria-label, фокусная область с клавишами, таблица узлов всегда видна (реальные кнопки, стрелки/Home/End, Enter выбирает, `aria-current`, число фактов и «чаще всего с»). DoD: подписи без наложений на 77 и на 300 узлах; оба режима переключаются и запоминаются; панель и related-facts работают; контраст и охранный тест зелёные; скриншоты 1440×900 и 390×844 Реализовано (2026-10-31): чистые модули `web-ui/lib/graph-model.ts` (режимы, со-упоминания с весами, `oftenAppearsWith`, `replacedLinks`, `truncateLabel`), `graph-labels.ts` (жадное размещение подписей с приоритетом по степени, обход кругов всех узлов через `include`, без пересечений и выхода за холст) и `graph-layout.ts` (детерминированная силовая раскладка: отталкивание по пространственной сетке, пружины с длиной ∝ 1/√веса, центрирование, охлаждение, остановка по смещению; 77 узлов ≈ 22 мс, 300 узлов ≈ 97 мс, лимит итераций для >300). UI: `components/graph/GraphCanvas.tsx` (постоянный экранный размер подписей через шаги зума, из-за чего скрытые по коллизии подписи появляются при приближении; фокус/поиск приглушают, но не удаляют; зум/пан/клавиатура), `NodePanel.tsx`, `Legend.tsx`, `ModeSwitch.tsx` (настоящие radio), `NodeTable.tsx` (колонка «Often with»). Страница грузит и недействующие факты (`includeInvalidated: true`) — заменённый факт виден пунктиром, ребро `replaces` и блок `Replaced by` работают. Тесты: `graph-model.test.ts` (22), `graph-labels.test.ts` (13), `graph-layout.test.ts` (12), `graph-theme.test.ts` (4) — 67 в наборе, весь web-ui 167; revert-check: снятие дедупа со-упоминаний и проверки коллизий подписей роняет тесты. Контраст дополнен парами `st-archive/canvas`, `danger/canvas`, `success/canvas` (37 пар × 6 вариантов); охранный тест цветов покрывает `components/graph/**` и три новых lib-файла. Браузер (Chrome, 1440×900 и 390×844): 0 pageerror, 1 h1, 46/89 в Entities и 77/98 в Facts & entities, 300/597 на синтетике, 390 px без горизонтального overflow; режим переживает reload; `Show related facts` отдаёт `No more facts for «Agents»` и дизейблится; таблица — один tab-stop, стрелки и Enter выбирают. Скриншоты: `docs/ui/screens/ui-28/` (11, включая кадр «до» с master). |
| UI-29 | Типизированные связи в графе знаний (субъект–отношение–объект) | medium | blocked | Проработка (design): серверный формат relations (subject/predicate/object), словарь predicate и миграция; UI-28 | Сейчас факт — свободный текст плюс список сущностей, поэтому рёбер «A использует B» нет: граф умеет только `mentions`, `co-occurs` и `replaces`. Нужен серверный формат связей: опциональное поле `relations: [{ subject, predicate, object }]` у temporal-фактов (старые факты без поля читаются как раньше, схема обратно совместима), извлечение отношений в `memory_extract` с валидацией `predicate` по словарю/allowlist и дедупом, приём поля в `memory_temporal_add`/`update`, отдача в `memory_temporal_query`/`history`, миграция без поломки существующих фактов. UI: третий режим «Relations» (или подпись рёбер отношением в режиме сущностей), фильтр по `predicate`, подпись ребра отношением и панель выбранного отношения; учесть, что без серверных данных UI-режим не имеет смысла. Оценка объёма: сервер 3–4 файла + миграция + 15–20 тестов, UI — режим и панель, ~2–3 дня. DoD: факт с `relations` проходит через API и рисуется ребром с подписью; старые факты без поля не ломаются (тест на чтение/запись); тесты на сериализацию, валидацию predicate и дедуп; скриншот режима. |
| UI-30 | «Всё про X»: общий граф и карточка узла | high | done | UI-28, UI-25 | UI для команды: единая карточка узла на существующих связях — факты с датами, задачи, документы, связанные сущности. Источники: зависимости и подзадачи задач (tasks_dag), parentId документов (knowledge_tree), упоминания сущностей в temporal facts. Без новых серверных форматов и без дублирования UI-29. DoD: Playwright: открыть узел из графа и из задачи/документа, увидеть связанные сущности и перейти к ним; `npm --prefix web-ui run test` зелёный. |
| UI-31 | Блокировки и влияние | high | done | UI-30 | На той же карточке узла: цепочка «что блокирует это», критический путь и «что заденем, если изменить X» по `tasks_dag`; для документов — зависимые документы по parentId. Без нового серверного формата, использовать существующий DAG. DoD: на тестовом проекте с цепочкой A → B → C карточка B показывает A как блокер и C как зависимое; `npm --prefix web-ui run test` зелёный. |
| UI-32 | Здоровье знаний | medium | pending | UI-30, U-05 | Обзор: устаревшие факты, противоречия, документы без связей, самые связанные узлы; список с действиями (открыть, проверить, связать). Опора на memory_verify (U-05) и существующий граф, без нового серверного формата. DoD: на данных с одним stale-фактом и одним несвязанным документом оба видны в списке; действие «проверить» ведёт к U-05; `npm --prefix web-ui run test` зелёный. |
| UI-33 | Пользовательские темы | medium | done | UI-10, UI-34 | Редактор темы из 3–4 базовых цветов на режим (акцент, фон, текст, при желании предупреждение); остальные токены вычисляются так, чтобы AA выполнялся по построению. Проверку WCAG AA вынести из автотеста в обычную функцию; редактор показывает результат вживую и предупреждает или блокирует сохранение (решение владельца за ним, предложено блокировать только критичные пары). Применение до отрисовки тем же inline-скриптом, без мигания. Управление в меню «Тема»: создать, дублировать, переименовать, удалить, сбросить, импорт и экспорт JSON. Безопасность: только значения цветов по строгой схеме (hex, rgb, hsl) для известных токенов, никакого произвольного CSS, откат к палитре по умолчанию при ошибке. Хранение: сначала localStorage с try/catch, серверный профиль после T-01, темы команды в данных проекта отдельным шагом. DoD: тест вычисления токенов (AA по построению на наборе базовых цветов), тест схемы импорта (произвольный CSS и неизвестные токены отклоняются), e2e редактора: сохранить тему, перезагрузить без мигания, сбросить; контраст-тест встроенных палитр не ослаблен. Реализовано (2026-10-31): модель и деривация в `web-ui/lib/custom-theme.ts` (3–5 базовых цветов на режим, совместный подбор светлоты под все пары токена одновременно, сдвиг фона из мёртвой зоны люминантности, отказ при акценте, равном фону); `lib/contrast.ts` расширен форматами hex 3/4/6/8, rgb(), hsl() и стал единственным расчётом для CI-теста, деривации и редактора; общая матрица `lib/theme-pairs.ts` (36 пар, 5 критичных); pre-paint скрипт читает версионированный store из localStorage, проверяет hex и применяет через setProperty, при ошибке — палитра по умолчанию; CSS-фолбэк `[data-theme="custom"]` наследует Indigo по режиму; страница `/themes`: список встроенных и своих тем, создание, дублирование, переименование, удаление через Dialog, сброс к палитре, импорт файлом и вставкой, экспорт JSON, живое превью и таблица контраста, сохранение блокируется критичными парами; меню темы показывает свои темы и ведёт на `/themes`; примитивы `ColorField` и `FileInput`; лимиты 20 тем, имя 40 символов, store 64 КБ, строгая схема значений. Тесты: `lib/custom-theme.test.ts` (21), `lib/theme-init.test.ts` (8), контраст-тест на общей матрице; охранный тест цветов расширен на все `components/**`. Доказательства на prod-сборке: pre-paint при заблокированных `/_next/static/**` (21 запрос) даёт `data-theme="custom"` и сохранённые токены, меню не открывается (гидратации нет); порча `mcp.customThemes` (битый JSON и токен `red`) откатывает в Indigo, страница рендерится. Revert-check (4, по одному, файлы восстановлены, diff пустой): одиночная пара вместо совместного поиска → падает `keeps every pair…`; снятая проверка hex в pre-paint → `rejects a tampered token…`; разрешённые неизвестные токены → `rejects unknown tokens…`; удалённая запись allowlist → `each page uses PageHeader…`. Попутно исправлено по живому прогону: `applyCustomTheme` не ставил `data-mode` (переключение Dark при своей теме было no-op) и шапка не обновляла подпись после применения темы из `/themes` (событие `storage` не приходит в той же вкладке — добавлен `mcp:theme-change`). Скриншоты: `docs/ui/screens/ui-33/` (10: меню, редактор, превью и таблица контраста, блокировка сохранения, Tasks и Knowledge в светлом и тёмном режиме, импорт/экспорт, 390 px), каждый ≤ 127 КБ (лимит 150 КБ). | |
| UI-33a | Темы в серверном профиле | medium | pending | UI-33, T-01 | Хранить выбранную тему и список своих тем в серверном профиле после T-01: API чтения/записи профиля, синхронизация между устройствами, конфликт локальной и серверной версии решается по updatedAt, офлайн-очередь. Клиент: localStorage остаётся кэшем, сервер — источником при наличии профиля. DoD: тема, сохранённая на одном устройстве, появляется на другом после входа; удаление на сервере убирает её из кэша; офлайн-изменения синхронизируются без дублей. |
| UI-33b | Темы команды в данных проекта | low | pending | UI-33, MU-02 | Хранить темы команды в данных проекта после MU-02: сущность проекта со списком тем, право редактирования по роли, публикация темы проекта всем участникам, копирование темы проекта в личные. DoD: участник видит тему команды без локального импорта; правка доступна только роли с правом; удаление темы не ломает выбранную тему у участников (откат к палитре). |
| UI-34 | DESIGN.md и стражи дизайна | high | done | UI-10, UI-24 | Единый стилевой гайд и защита от импровизации: корневой `DESIGN.md` (назначение и обязательное чтение до правки web-ui, принципы A + B + C, токены и две оси темы, каталог примитивов с правилами, контракт страницы и состояний, доступность AA, запреты, процесс добавления, журнал решений владельца, известный долг); генерируемые блоки токенов (app/globals.css и lib/theme.ts) и примитивов (components/ui/index.ts, первая строка JSDoc) обновляет `scripts/gen-design-doc.mjs` через `npm run design:doc`, расхождение ловит `web-ui/lib/design-doc.test.ts`; стражи `web-ui/lib/design-guards.test.ts`: нет `window.confirm`/`alert`/`prompt`, нет голых `button`/`input`/`select`/`textarea` вне components/ui, каждая app-страница использует `PageHeader` и не рисует свой `h1`; allowlist — реестр долга, устаревшая запись роняет тест; `CLAUDE.md` импортирует `AGENTS.md`. DoD: `npm run lint:md`, `npm run backlog:check`, `npm run design:doc -- --check`, web-ui `npx tsc --noEmit` и `npm test` зелёные; revert-check каждого стража. Реализовано (2026-10-31): DESIGN.md с 11 разделами и двумя генерируемыми блоками (28 цветовых токенов × 6 вариантов, 14 общих токенов, 13 примитивов); генератор без новых зависимостей, `--check` для CI и тест на шесть вариантов/состав экспортов; три стража с ratchet-allowlist (11 файлов голых контролов и 2 страницы с собственным h1 — долг UI-11/UI-15/UI-16, страницы не переписывались); `CLAUDE.md` с импортом AGENTS.md; раздел «Дизайн и UI» в AGENTS.md; README web-ui и docs/features/web-ui.md ссылаются на DESIGN.md. Revert-check: window.confirm на странице, голый `<button>`, собственный `<h1>` и правка globals.css без пересборки документа — каждый роняет свой тест. |
| UI-35 | Настройки проекта: статусы, типы и переходы | high | done | UI-10, UI-34, V-01, V-03 | Экран для людей вместо MCP-инструментов: страница `/projects/settings` с тремя вкладками (доступный tablist, стрелки, Home/End). Statuses: порядок перетаскиванием и кнопками выше/ниже, имя, категория, цвет только токенами `st-*`, архивирование, добавление, closeStatus, initialStatuses, удаление занятого статуса через Dialog с переносом задач (`moves`). Transitions: матрица строки-из-столбцы-в с кнопками-ячейками `aria-pressed`, легенда, режим «любой в любой» (`null`), подсветка и объяснение недостижимого done-статуса прямо в матрице. Types: имя, цвет `ty-*`, иконка из набора `TypeIcon`, порядок, удаление с переносом. Общее: черновик на вкладку, индикатор несохранённых изменений, Cancel с Dialog, один запрос на вкладку, перечитывание после сохранения, ошибки сервера у источника. Логика в `web-ui/lib/project-settings.ts` (перестановка, dirty, валидация, материализация графа, клиентское зеркало недостижимости, разбор `STATUS_IN_USE`/`TYPE_IN_USE`, восстановление отказанного удаления); компоненты `components/settings/*` controlled и hook-free. Найденный контракт сервера: удаление статуса, который ещё есть в сохранённом графе, отклоняется `INVALID_TRANSITIONS` даже после переноса задач — экран блокирует сохранение и отправляет сначала на вкладку Transitions. Тесты: `lib/project-settings.test.ts` (38), SSR-тесты трёх вкладок (31), живой тест против своего сервера на 3510 (5 статусов, граф, 3 типа, запрет удаления занятого, перенос); `web-ui/vitest.config.ts` расширен на `components/**/*.test.tsx`. Скриншоты `docs/ui/screens/ui-35/` (10): три вкладки в Indigo light и Petrol dark, диалог переноса, недостижимый done в матрице, 390 px. |

| UI-36 | Задача: быстрый просмотр в диалоге | high | done | UI-10, UI-12, UI-34 | Сейчас карточка даёт только действие Edit (`web-ui/app/tasks/page.tsx:1144` вызывает `setEditingTask`, форма начинается на строке 781), просмотра нет. Сделать: клик по карточке открывает `Dialog` только для чтения — полное описание без обрезки, тип, приоритет, теги, связи, зависимости (от чего зависит и что блокирует), подзадачи, история изменений, активная аренда claim; кнопка Edit ведёт на полную страницу UI-37, правки внутри быстрого окна нет; Esc и клик вне закрывают, фокус возвращается на карточку. Примитив `Dialog` уже есть в `components/ui`; стражи `design-guards.test.ts`, `no-hardcoded-colors.test.ts` и `design-doc.test.ts` не обходятся. Тот же паттерн «просмотр, затем правка» — вход для Knowledge и Prompts следующим шагом в их пунктах, отдельным пунктом реализации не заводится. DoD: `npm --prefix web-ui run test`; Playwright на `/tasks`; pass — клик по карточке открывает окно с полным описанием, внутри окна ноль редактируемых контролов (`dialog input`, `dialog textarea`, `dialog select`), Esc закрывает и возвращает фокус, правка доступна только кнопкой Edit, скриншоты 1440×900 и 390×844 в `docs/ui/screens/ui-36/`; fail — окно меняет данные либо описание обрезано |
| UI-37 | Задача: полная страница `/tasks/<id>` | high | done | UI-10, UI-12, UI-34, V-02, U-01 | Динамических маршрутов в `web-ui/app` нет вовсе (проверено `find` по каталогам с квадратными скобками — пусто). Сделать `web-ui/app/tasks/[id]/page.tsx`: прямой URL и перезагрузка работают, ссылка «открыть в новой вкладке» приходит из быстрого просмотра UI-36; правка полей и описания, связи, зависимости (блок UI-38), подзадачи; смена статуса только по графу переходов V-02 — запрещённый переход показывает серверный `TRANSITION_NOT_ALLOWED` с `allowed`; claim и renew по U-01 с видимым сроком аренды; архив и корзина через destructive `Dialog`; состояния loading, error и not-found по UI-12; ровно один `h1` и `PageHeader` по `DESIGN.md` §5; несуществующий id даёт 404 без падения страницы. DoD: `npm --prefix web-ui run test`; Playwright; pass — прямой переход на `/tasks/<id>` после перезагрузки показывает ту же задачу, запрещённый переход отклонён серверным кодом и объяснён в интерфейсе, claim продлевается и срок виден, архив и корзина спрашивают подтверждение, `h1` ровно один, скриншоты в `docs/ui/screens/ui-37/`; fail — прямой URL не работает либо правка обходит граф переходов |
| UI-38 | Зависимости в карточке задачи и отдельный вид DAG | high | done | UI-36, UI-37, SC-01 | Кнопка «Dependencies» в шапке (`web-ui/app/tasks/page.tsx:695-696`) открывает общую сводку проекта (`api.tasks.dag` на строке 506, блок на строке 857 и далее) без привязки к задаче. Сделать блок «Зависимости» в быстром просмотре и на полной странице: от чего зависит (со статусом каждой), что блокирует, цепочка до корня, признак «заблокирована по зависимостям» отдельно от статуса (имена полей — из AC-02); редактирование — поиск задачи, добавить и убрать ребро, отказ на цикл с серверным кодом. Общая сводка переезжает с кнопки над доской в отдельный маршрут с фильтрами `tag`, `limit` и «только с зависимостями» (после AC-03). Не дублирует UI-30 и UI-31: там карточка узла графа знаний, здесь задача; данные те же (`tasks_get_deps`, `tasks_dag`). DoD: `npm --prefix web-ui run test`; Playwright; pass — в карточке видны блокеры с их статусами и зависимые, добавление ребра обновляет оба конца, попытка создать цикл показывает серверную ошибку и ничего не меняет, сводка открывается отдельным маршрутом и фильтры уходят в API; fail — зависимости доступны только общей сводкой либо цикл проходит |
| UI-39 | Метки «на критическом пути» и «блокирует N» | high | done | UI-38, V-02 | `DagData` отдаёт только общий `criticalPath` и `blockedCount` (`web-ui/lib/api-client.ts:618-626`), числа «сколько задач транзитивно ждут эту» нет; `getBlockedByTask` считает только прямых зависимых (`src/storage/tasks.ts:1044-1047`). Сделать: сервер считает `onCriticalPath` и `dependentsCount` (транзитивные зависимые) в `tasks_list` и `tasks_get` по флагу, чтобы не удорожать список; UI показывает две независимые метки — «на критическом пути» и бейдж «блокирует N» с текстом и иконкой, не только цветом (`DESIGN.md` §6), пороги тоном из токенов; ось приоритета остаётся отдельной полосой. Тест на известном графе и пересчёт после `tasks_set_deps`. DoD: `npx vitest run tests/task-critical-path.test.ts` и `npm --prefix web-ui run test`; pass — на фикстуре A→B→C у A `dependentsCount` 2, у C 0, `onCriticalPath` совпадает с длиннейшей цепочкой, после `tasks_set_deps` числа пересчитаны, в UI метки читаются без цвета; fail — число только прямых зависимых либо метки различаются только цветом |
| UI-40 | Палитра статусов и типов: токены по оттенку и цвета темы | medium | pending | UI-10, UI-34, UI-35 | Палитра цвета статуса — шесть токенов `STATUS_COLOR_TOKENS` (`web-ui/lib/project-settings.ts:36-43`), типов — три (`:46`); значения заданы в `globals.css` для шести вариантов темы, контраст проверяет `web-ui/lib/theme.contrast.test.ts`. Сервер принимает любую строку цвета (`src/workflow.ts:118`), неизвестный токен в UI падает на цвет категории. Сделать: расширить палитру токенами по оттенку (~10–12: slate, blue, indigo, violet, pink, red, orange, amber, green, teal, cyan, gray) плюс ссылки на цвета темы (accent, success, warning, danger, info); хранить имя токена, не hex; каждый токен в шести вариантах темы с AA (текст на поверхности не ниже 4,5:1, плашка через `color-mix` от того же токена); свои темы из UI-33 получают значения новых токенов выводом из своей палитры с проверкой контраста; пикер — сетка образцов в текущей теме с подписью названия и предпросмотром плашки на светлом и тёмном; произвольный hex не давать; старые шесть токенов остаются валидными, существующие проекты не меняются. `/design` и `DESIGN.md` §3 и §4 обновляются тем же PR, `npm run design:doc` перегенерирован. DoD: `npm --prefix web-ui run test` и `npm run design:doc -- --check`; pass — каждый новый токен проходит AA во всех шести вариантах, страж `no-hardcoded-colors.test.ts` покрывает новые токены, таблица `DESIGN.md` совпадает с кодом, пикер показывает название и предпросмотр на обеих темах, проект со старыми токенами открывается без изменений; fail — любой токен ниже AA, hex в данных проекта либо расхождение документа с кодом |

## Этап Y — Подключаемое хранилище и эмбеддинги (2026-10-31)

> Решения владельца: хранилище — ПРОФИЛИ, а не свободное смешивание: «файлы + git» (как сейчас), «SQLite», «Postgres + pgvector». За одинаковыми MCP-инструментами меняются провайдеры: Store (задачи, знания, промпты, память, метаданные проекта, журнал событий), SearchProvider (BM25 в памяти, FTS5, tsvector и pg_trgm), VectorProvider (файловый кэш, sqlite-vec — наличие и совместимость с нашей версией Node и Docker ПРОВЕРИТЬ, pgvector с HNSW), HistoryProvider (git-коммиты этапа R, таблица версий), LockProvider (файловые замки, транзакции, SELECT FOR UPDATE), BlobProvider (каталог, S3 и совместимые, MinIO — ТОЛЬКО для вложений, экспортов и копий, не как основное хранилище). Провайдер объявляет возможности: транзакции, встроенная история, полнотекстовый поиск, векторы, эффективный листинг. Один набор контрактных тестов гоняется на каждом профиле; команда `migrate-storage` переносит между профилями с проверкой целостности.
> Эмбеддинги разделяются: EmbeddingProvider (локальный ONNX CPU/GPU, воркер-процесс, внешний API, выключено), VectorStore, IndexingService (очередь, идемпотентность по хэшу содержимого, пауза, прогресс), ChunkingStrategy. Отпечаток модели (modelId, размерность, пулинг, нормализация, instruction-префикс) хранится с каждым вектором; смена модели — новая коллекция с двойным чтением. Сегодня всё в одном классе OnnxVectorAdapter (`src/search/vector.ts`); прогрев 40 с на 146 документах (CPU) означает часы на 100 тысячах, поэтому вычисление отделяется от хранения, хранение постоянное и инкрементальное.
> Внешние облачные эмбеддинги — ПОДКЛЮЧАЕМЫЕ, но по умолчанию как сейчас: локальные или выключено. Облачные только по явному включению: флаг, предупреждение при старте, запись в декларации приватности, ключи через SecretManager, исключение приватных проектов и документов trustLevel external, лимиты и учёт стоимости.
> Открытая развилка (решает владелец, пункт-гейт): источник правды — файлы плюс индекс (сохраняет читаемость, Obsidian, git-историю этапа R) или база (мощнее, теряется прямая читаемость). Масштаб проверяется отдельными замерами; если этап с замерами ещё не в master, ссылаемся на результаты замеров масштаба без ID.
> Порядок: Y-01 → Y-02 → Y-03 → Y-04; Y-09 gate → Y-05 → Y-06/Y-08; Y-07 после Y-02.

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| Y-01 | ADR: подключаемое хранилище и эмбеддинги | high | done | — | Зафиксировать интерфейсы Store, SearchProvider, VectorProvider, HistoryProvider, LockProvider, BlobProvider и EmbeddingProvider, профили, объявления возможностей, формат отпечатка модели, правила двойного чтения и миграцию без простоя. Документ в `docs/adr/`, только архитектура, без кода. Обязан зафиксировать решение Y-09 (источник правды = активный провайдер, один активный профиль, UserStore (T-01) входит в контракт профиля). DoD: ADR принят, интерфейсы и профили перечислены, `npm run lint:md` зелёный. ADR-009 (`docs/adr/0009-pluggable-storage-and-embeddings.md`, статус Accepted с 2026-11-09, предложен 2026-11-08): семь интерфейсов, три профиля, манифест возможностей, отпечаток модели, двойное чтение, переход без простоя, решение Y-09 записано; отдельный раздел — что уже реализовано (SC-02 `MetadataIndex`, SC-03a/03a2 `search_fts`, `(store, kind, id)`) и граница Y-02. ADR принят владельцем 2026-11-09, статус `Accepted`; пункт закрыт. |
| Y-02 | Контрактные тесты и файловый профиль за интерфейсами | high | done | Y-01 | Вынести доступ к задачам, знаниям, промптам, памяти, метаданным проекта и журналу событий за интерфейсы; внедрение через AppContainer; файловый профиль остаётся текущим поведением. Один набор контрактных тестов для профиля. DoD: `npm test -- tests/storage-contract.test.ts`; поведение и wire-формат не меняются. ADR-009 принят 2026-11-09, можно стартовать. **Разбит 2026-11-09** на пять инкрементов: `Y-02a` — контракты задач и знаний и файловый профиль (делегирующий) плюс контрактные тесты с паритетом против текущих функций — done; `Y-02b` — метаданные проекта, журнал событий, история и замки за контрактами — done; `Y-02c` — промпты за контрактом (файловый доступ вынесен из регистратора) — done; `Y-02d` — память (temporal graph, профили, слоистая и сессионная память) — done; `Y-02e` — `AppContainer` отдаёт профиль, регистраторы получают хранилища из контекста, прямые импорты `src/storage/*` уходят из `src/register/**`. Пункт закрывается, когда done все пять |
| Y-03 | Разделение эмбеддингов: провайдер, хранилище, индексация, чанкинг | high | done | Y-02 | Разделить OnnxVectorAdapter на EmbeddingProvider, VectorStore, IndexingService и ChunkingStrategy; хранить отпечаток модели с каждым вектором; смена модели — новая коллекция с двойным чтением; расширить embeddings_status (провайдер, модель, размерность, проиндексировано, в очереди, скорость). DoD: `npm test -- tests/embedding-contract.test.ts`; отпечаток и двойное чтение покрыты тестами. |
| Y-04 | Внешние провайдеры эмбеддингов | medium | done | Y-03 | Подключаемые внешние API только по явному флагу: предупреждение при старте, запись в декларацию приватности, ключи через SecretManager, исключение приватных проектов и документов trustLevel external, лимиты и учёт стоимости. По умолчанию локальные или выключено. DoD: `npm test -- tests/embedding-external-policy.test.ts`; без флага внешних вызовов нет. |
| Y-05 | Профиль SQLite | high | done | Y-02, Y-03, Y-09 | Таблицы Store, FTS5 для SearchProvider, sqlite-vec для VectorProvider после проверки наличия и совместимости с Node и Docker, таблица версий как HistoryProvider, транзакции как LockProvider. Связь с результатами замеров масштаба. DoD: контрактные тесты зелёные на SQLite; `npm test -- tests/storage-sqlite.test.ts`. |
| Y-06 | Профиль Postgres и pgvector | medium | done | Y-05, Y-09 | Профиль для нескольких серверов: pgvector с HNSW, транзакции, оптимистичные версии, связь с MU-01 и MU-02. DoD: контрактные тесты зелёные на Postgres; `npm test -- tests/storage-postgres.test.ts`; миграция и откат проверены. |
| Y-07 | BlobProvider: S3 и MinIO | low | done | Y-02 | Абстракция для вложений, экспортов и копий; S3 и совместимые, MinIO — только для этих объектов, не как основное хранилище. DoD: `npm test -- tests/blob-provider.test.ts`; файловый и S3-провайдер проходят один контракт. |
| Y-08 | migrate-storage между профилями | medium | done | Y-05, Y-09 | Перенос между профилями с dry-run, проверкой целостности, отчётом о расхождениях и возможностью отката. DoD: `npm test -- tests/storage-migrate.test.ts`; dry-run не меняет данные, повторный запуск идемпотентен. |
| Y-09 | Гейт владельца: источник правды | high | done | — | Решено владельцем 2026-11-03: источник правды — активный провайдер хранения. В файловом профиле источник файлы, SQLite-индекс производный (SC-02/SC-03); в профилях SQLite и Postgres источник сама база. Один активный профиль, смена только через migrate-storage (Y-08). Решение должно быть записано в ADR Y-01. Разблокирует Y-05, Y-06, Y-08. DoD: решение записано в ADR Y-01, статус гейта обновлён. |

## Этап Z — Скиллы и плагины как пакеты, источники промптов, слияние (2026-10-31)

> Контекст по коду: промпт сегодня — один JSON-файл со строкой template (`schemas/prompt.schema.json`); импорт плагина Claude Code (`src/skills/skill-converters.ts`, AI-011/AI-012) читает `.claude-plugin/plugin.json` и один файл `skills/<name>/SKILL.md` на скилл, остальное теряется. В реальности скилл — ПАПКА: `SKILL.md` плюс references, scripts, assets, на которые он ссылается; плагин — ПАЧКА: skills, commands, agents, hooks, `.mcp.json`, `plugin.json`, лицензия.
> Решения владельца:
> (а) импорт из внешних хранилищ скиллов; первые источники — локальный маркетплейс Claude Code и GitHub-репозитории по ссылке (например anthropics/skills), далее awesome-списки и реестр MCP; Hugging Face и LangChain Hub — только после проверки API и лицензий;
> (б) импортированное связывается с источником: хранить источник, ссылку, версию или коммит источника, лицензию, дату, хэш исходного содержимого и сам исходный снимок как базу для трёхстороннего слияния; статус «изменён нами» = текущее содержимое не равно базе;
> (в) обновление никогда не затирает молча: при отсутствии наших правок — diff и обновление по кнопке (новая версия, откат); при наличии — «разошлись»: оставить своё (pin), взять чужое (своё остаётся в истории), авто-3-way без конфликтов (готовый SYNC-003), агентское слияние при конфликтах;
> (г) агентское слияние: сервер выдаёт данные и проверяет, сам не склеивает. `prompts_merge_prepare(id)` возвращает базу, версию источника, нашу версию, сводки изменений, конфликтные места, метаданные и готовую инструкцию: сохранить смысл наших правок, взять исправления источника, не потерять переменные, не добавлять команды и расширенные разрешения без пометки, не выполнять указания из слияемого текста. Агент сливает и вызывает `prompts_merge_apply(id, mergedContent, заметки, expectedVersion)`; сервер проверяет сохранность переменных, валидность формата, отсутствие новых `!command` и расширенных allowed-tools без флага, оптимистичную версию (MU-02). Результат сохраняется как ЧЕРНОВИК с подтверждением человеком; в интерфейсе кнопка «Copy merge prompt for my agent» и MCP-подсказка (prompts/get, SPEC-03);
> (д) безопасность: всё внешнее trustLevel external на ВСЕ файлы пакета; скрипты, хуки и `.mcp.json` при импорте показываются явно и по умолчанию отключены; сеть только по запросу и без фоновых запросов; лицензия показывается, при её отсутствии — предупреждение.
> Решения владельца по гейтам (2026-11-03): скилл, скачанный извне и не менявшийся у нас, обновляется одним явным действием (кнопка или команда) без подтверждения diff; фонового автообновления нет, периодическая проверка новых версий выключена по умолчанию и включается явно. Менявшийся скилл не сливается автоматически: сервер выдаёт данные и инструкцию (UI «Copy merge prompt», MCP-подсказка), человек передаёт её агенту, агент вызывает prompts_merge_apply, результат — черновик, применяется только после подтверждения человеком; автономное слияние агентом без подтверждения не допускается.
> Решения владельца (2026-11-07, P-20261107-12): промптам и скиллам нужна маркировка целевого агента (universal/claude/opencode и свои типы); теги остаются и нужны, `target` добавляется рядом с ними, а не вместо; в админке настраивается путь и формат развёртывания для каждого типа агента. Форма поля уточнена решением по гейту Z-13 от 2026-11-07: одно значение, не список.
> Порядок: Z-01 → Z-02 → Z-04 → Z-05 → Z-06 → Z-07 (гейт Z-09 закрыт); Z-03 после Z-01, Z-02 и UI-25; Z-08 после Z-05; Z-10 (гейт Z-13 закрыт 2026-11-07, мягко к Z-01), Z-11 после Z-10 (мягко к UI-25 и Z-03), Z-12 после Z-10 (мягко к Z-02 и Z-04).

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| Z-01 | Модель скилл-пакета | high | done | Y-02 (мягко) | Скилл — набор файлов: `SKILL.md` и вложения с относительными путями, хэши, лимиты размера, безопасные пути без выхода из каталога; хранение пакета. Можно делать на файловом профиле. DoD: `npm test -- tests/skill-package.test.ts`; обход путей и превышение лимита отклоняются. |
| Z-02 | Плагин-контейнер и импорт-экспорт без потерь | high | done | Z-01 | Состав плагина: skills, commands, agents, hooks, `.mcp.json`; манифест. Исправить AI-011/AI-012: сохранять и экспортировать все компоненты и вложения, а не один `SKILL.md`. DoD: `npm test -- tests/plugin-container.test.ts`; roundtrip папки плагина без потери файлов. |
| Z-03 | UI: дерево файлов скилла и страница плагина | high | pending | Z-01, Z-02, UI-25, UI-10 | Дерево файлов скилла на общем TreeView из UI-25, просмотр и редактирование каждого файла; страница плагина с составом и включением/выключением компонентов. DoD: `npm --prefix web-ui run test`; Playwright: открыть пакет, файл и переключить компонент. |
| Z-04 | Безопасность пакетов | high | done | Z-02 | trustLevel external на все файлы пакета; скрипты, hooks и `.mcp.json` показываются явно и по умолчанию отключены; сеть только по запросу; лицензия и предупреждение при её отсутствии. DoD: `npm test -- tests/plugin-security.test.ts`; импорт с hook не включает его без явного разрешения. |
| Z-05 | Источники промптов и скиллов | medium | pending | Z-02, Z-04, INT-004 | Интерфейс PromptSource и первые два источника: локальный маркетплейс Claude Code и GitHub-репозиторий по ссылке; поиск, preview, import. DoD: `npm test -- tests/prompt-sources.test.ts`; импорт из временного локального маркетплейса и GitHub-фикстуры. |
| Z-06 | Происхождение, снимок базы и обновление по diff | medium | pending | Z-05 | Хранить источник, ссылку, версию или коммит, лицензию, дату, хэш содержимого и снимок базы; статус «изменён нами»; обновление с diff, новой версией, откатом; при отсутствии правок — обновление по кнопке. DoD: `npm test -- tests/prompt-provenance.test.ts`; изменённый пакет не перезаписывается. |
| Z-07 | Слияние: prepare/apply, проверки и черновик | medium | pending | Z-06, MU-02, Z-09 | Авто-3-way по файлам через SYNC-003; `prompts_merge_prepare` и `prompts_merge_apply` с проверкой переменных, формата, новых `!command` и allowed-tools, expectedVersion; результат — черновик с подтверждением человеком; UI «Copy merge prompt» и MCP-подсказка. DoD: `npm test -- tests/prompt-merge.test.ts`; конфликтный пакет требует подтверждения, оптимистичная версия проверяется. |
| Z-08 | Дальнейшие источники | low | pending | Z-05 | awesome-списки и реестр MCP; Hugging Face и LangChain Hub — только после проверки API и лицензий. DoD: источник подключается через PromptSource без изменения ядра; отчёт о лицензии. |
| Z-09 | Гейты владельца: человек и автообновление | high | done | — | Решено владельцем 2026-11-03: скилл, скачанный извне и не менявшийся у нас, обновляется одним явным действием (кнопка или команда) без подтверждения diff; фонового автообновления нет, периодическая проверка новых версий выключена по умолчанию и включается явно. Менявшийся скилл не сливается автоматически: сервер выдаёт данные и инструкцию (UI «Copy merge prompt», MCP-подсказка), человек передаёт её агенту, агент вызывает prompts_merge_apply, результат — черновик, применяется только после подтверждения человеком; автономное слияние агентом без подтверждения не допускается. Разблокирует Z-07. DoD: решение записано в ADR/задаче, статус гейта обновлён. |
| Z-10 | Целевые агенты промптов и скиллов: реестр и поле `target` | high | done | — | Поле `target` — одно значение из реестра агентов, по умолчанию `universal`, рядом с `tags`, а не вместо них: у промпта в `metadata` (`schemas/prompt.schema.json:22`), у скилла в `Skill` и frontmatter (`src/skills/types.ts:30`). Не `targets` и не список: решено владельцем 2026-11-07 (Z-13). Встроенные типы universal, claude, opencode; пользовательские добавляются без правки ядра. Реестр по образцу `project_types_get/set` (`src/workflow-service.ts:80-146`, `src/register/project.ts:241-259`): хранение в мете проекта, нормализация, запрет удаления используемого типа без `moveTo`/`moves`, откат при ошибке. MCP: `project_agents_get` и `project_agents_set`. Параметр `target` в `prompts_list` и `prompts_search` — скаляр в обеих конвенциях: у list рядом с `tag`, у search рядом с `tags` (`src/register/prompts.ts:357,446`), сами `tag`/`tags` не трогаются. Схема и миграция: поля нет или оно пустое = `universal`. Регенерировать `docs/api-reference.md` через `npm run api:reference` после `npm run build`. DoD: `npm test -- tests/prompt-targets.test.ts`; pass — промпт без поля target виден при target=universal и при target=claude, промпт с target=claude не виден при target=opencode, реестр get/set переживает roundtrip, удаление используемого типа без `moveTo` отклоняется, в `docs/api-reference.md` появились оба инструмента; fail — любой из случаев. |
| Z-11 | UI: бейдж и фильтр по агенту, редактор `target`, страница реестра | medium | done | Z-10 | Страница промптов сегодня фильтрует только по статусу (`web-ui/app/prompts/page.tsx:210`), теги и домен — на клиенте. Добавить бейдж агента в список и карточку, серверный фильтр `target` (в `api.prompts.list`), редактор `target` с одиночным выбором в форме создания и правки, фильтр списка по одному значению, а не мультиселект, страницу реестра агентов в настройках по образцу вкладок типов (`web-ui/components/settings/TypesTab.tsx` и `types-tab.test.tsx`). Дерево файлов скилла не дублировать: оно в Z-03 и UI-25. Компоненты — только из `web-ui/components/ui`, контракт страницы и состояний по `DESIGN.md`, стражи `design-guards.test.ts`, `no-hardcoded-colors.test.ts`, `design-doc.test.ts` не обходятся. DoD: `npm --prefix web-ui run test` и `npx tsc --noEmit`; pass — тест подтверждает, что фильтр уходит в API параметром target, стражи дизайна и контраста зелёные, снимки шести сочетаний палитра×режим из `DESIGN.md` лежат в `docs/ui/screens/Z-11/`; fail — фильтр остался клиентским либо страж ослаблен allowlist-ом. |
| Z-12 | Развёртывание скиллов и промптов по типам агентов | high | done | Z-10 | В реестре агентов у каждого типа свой путь развёртывания и свой формат; у `universal` тоже отдельное место развёртывания, а не «куда попало». Запись только в каталоги из allowlist настроек; отказ на `..` через `resolveUnder`/`resolveUnderPath` (`src/fs.ts:150,165`) и отдельная проверка симлинков: в `src/fs.ts` её нет (0 вхождений `lstat`/`realpath`), поэтому это новая работа, а не готовая защита AUD-03. Предпросмотр diff (создать/изменить/удалить), применение только действием в админке; MCP-инструмент без подтверждения не пишет — использовать confirm-флоу `elicitConfirm` (`src/core/elicitation.ts:33`, образец `src/register/bulk.ts:299-306`). Снимок перед записью и откат к нему. External (TR-16) не разворачивается без показа команд и разрешений; hooks, scripts и `.mcp.json` из Z-04 остаются выключенными. Формат: `skill-md` как сегодняшний агентский формат либо явный новый конвертер в Z-02; формата opencode в `SkillExportFormat` нет (`src/skills/skill-converters.ts:30`), не считать его существующим. Открытый вопрос проработки, не гейт: один промпт нужен и claude, и opencode, но форматы у них разные — либо два промпта, либо один в универсальном формате с конвертацией при развёртывании (конвертеры SK-005, формата opencode нет); рекомендация контролёра — универсальный формат плюс конвертация при развёртывании, итог решается на дизайне Z-12 и за владельца не принимается. Пути в тексте и настройках — от `$HOME`, без личных абсолютных путей. DoD: `npm test -- tests/agent-deploy.test.ts`; pass — dry-run перечисляет create/update/delete и ничего не пишет, apply пишет только внутрь allowlist, путь вне allowlist отклонён, симлинк наружу отклонён, external без подтверждения не разворачивается, откат возвращает прежнее содержимое; fail — запись вне allowlist, без предпросмотра или без снимка. |
| Z-13 | Гейт владельца: форма поля `target` — списком или одним значением | high | done | — | Решено владельцем 2026-11-07: `target` ОДНИМ значением на промпт и скилл, не списком. Довод владельца: универсальные синкаются в одно место (одно место развёртывания на тип). Теги остаются отдельно. Гейт закрыт; Z-10 больше не ждёт гейта и делает поле `target` скаляром со значением по умолчанию `universal`, Z-11 — одиночный выбор в редакторе и фильтр по одному значению, Z-12 — путь и формат на каждый тип реестра, включая `universal`. Открытый вопрос проработки о форматах claude и opencode вынесен в Z-12 и исполнителем не решается. DoD: решение записано в `docs/dev-cycle/decisions/`, статус гейта обновлён; pass — записаны выбор, основание и влияние на Z-10..Z-12; fail — решения нет либо его принял исполнитель. |

---

---

## Этап X — Масштабирование (2026-10-31)

> Замеры: `docs/benchmarks/scale-2026-10.md` (1k/10k/100k, граф, UI, 1M-заглушки). Сейчас каждый
> списочный вызов читает и парсит ВСЕ файлы проекта (`listTasks` — `src/storage/tasks.ts:120-156`,
> `listDocs` — `src/storage/knowledge.ts:66-106`), поиск пересобирает BM25 на каждый запрос
> (`src/search/bm25.ts:33-92`), а ответы в десятки мегабайт упираются в квадратичное обрамление
> `ReadBuffer.append` MCP SDK (22.4 с на 64 MB). Факты: `tasks_list` 100k = 38 с / 56 MiB,
> `knowledge_list` 100k = 60 с / 41 MiB, `search_knowledge` 100k = 44 с (первый вызов),
> `dashboard_stats` 100k = 9.7 с, UI `/tasks` 10k = 6 с / 105k DOM, граф 5000 узлов = 13.7 с и
> 16.3 с Long Tasks. Не дублирует U-04 (расширяет его курсором и `maxBytes`), MU-03 (SC-07 — решение
> о пакетном коммите ДО его реализации), V-04/V-05 (колонки и дорожки доски), UI-16/UI-24 (список и
> токены). Порядок: SC-01 → SC-02 → SC-03; SC-04 после SC-01; SC-06 параллельно; SC-05 независим;
> SC-07 до MU-03; SC-08 последним.

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| SC-01 | Пагинация, `fields`, `count`, `maxBytes` и серверные фильтры во всех list/search | high | done | — | Расширить U-04: единый пост-фильтр `fields`, `compact`, курсор `(updatedAt desc, id)` как opaque base64, `maxBytes` → `{items, nextCursor, truncated}`, `count`/count-only, серверные фильтры `status/tag/type/parentId` для `tasks_list/tasks_tree/tasks_dag/knowledge_list/knowledge_tree/search_*`. Дефолт — лимит 200 и `maxBytes` 1 MiB (breaking, клиентов нет). DoD: `npm test -- tests/response-economy.test.ts`; `node scripts/bench/run-scale.mjs --data <100k> --n 100000 --only tasks_list,knowledge_list --reps 3` → `responseBytes < 1048576` и `medianMs < 1000` для обеих операций | Реализовано (2026-10-31): `src/utils/pagination.ts` (opaque-курсор `updatedAt desc, id asc`, query-scoped курсор поиска, `fields`, `maxBytes` с курсором от последнего отданного элемента, `countOnly`, `INVALID_CURSOR`), `src/register/page-args.ts` (единые zod-поля и сборка конверта), `listTasksPage`/`listDocsPage` в storage (readdir+stat, читаются только файлы страницы; полное чтение остаётся для содержательных фильтров и `countOnly`), параллельное чтение файлов (32) вместо последовательного, серверные фильтры `priority`/`parentId`/`updatedSince` и `type`/`parentId`. HTTP-транспорт отдаёт `application/json` вместо SSE (`MCP_JSON_RESPONSES=0` — вернуть SSE): SSE-фрейминг квадратичен, 20 MB = 4.2 с против 246 мс. Клиенты: Web UI долистывает страницы (временно до SC-04), таймаут запроса 120 с в web-ui/dev-cli/VS Code. Тесты: `tests/pagination.unit.test.ts` (15), `tests/e2e-full/pagination-contract.test.ts` (11); revert-check 4 падения. Замер 10k: `tasks_list` 897 мс / 5.9 MB -> 145 мс / 30 KB, `knowledge_list` 968 мс / 4.3 MB -> 142 мс / 22 KB. DoD: `npm test -- tests/pagination.unit.test.ts`; `node scripts/bench/run-scale.mjs --data <10k> --n 10000 --only tasks_list --reps 5` → `medianMs < 200`, `responseBytes < 102400` (замер: 145-175 мс; пол задаёт `stat` по 10k файлов ≈ 88-149 мс, его убирает индекс SC-02). |
| SC-01a | Курсор постраничного чтения при содержательном фильтре | high | done | — | Позиция курсора в файловом пути `listTasksPage`/`listDocsPage` считалась по списку всех файлов проекта, а применялась к отфильтрованному списку: неподходящие записи между подходящими сдвигали страницу, и обход курсором терял подходящие задачи и документы. Теперь позиция ищется внутри отфильтрованного списка по тому же ключу, что кодирует курсор (mtime desc, id asc, id из payload), и этот же индекс идёт в срез и в `hasMore`; формат курсора, контракты инструментов и индексный путь не менялись. DoD: `npm test -- tests/page-cursor-filter.test.ts`; pass — обход курсором до конца отдаёт ровно множество подходящих id без пропусков и дублей для status/tag/priority/type/parentId/updatedSince у задач и tag/type/parentId у документов, файловый и индексный пути дают одинаковый порядок; fail — любой пропуск или дубль | Реализовано (2026-11-07): `src/storage/tasks.ts`, `src/storage/knowledge.ts` (позиция курсора внутри `matched`, `hasMore` от того же индекса; `matched` несёт id из payload, поэтому документ с id во frontmatter, отличным от имени файла, позиционируется корректно); тесты `tests/page-cursor-filter.test.ts` (12); revert-check 8 падений в задачах и 4 в документах |
| SC-02 | SQLite-индекс метаданных задач и документов (файлы — источник истины) | high | done | SC-01 | **Проработка закрыта 2026-11-07**: дизайн, развилки и карта точек записи — `docs/dev-cycle/decisions/2026-11-07-1437-sc02-sqlite-index.md`; замеры «до/после» на 1k/10k/100k — `docs/benchmarks/sc02-2026-11-07.md` (100k: страница списка 0.69 и 1.42 мс против 1138 и 1381 мс файлового пути, rebuild 18.75 с, БД 134 MB, добавка к записи 0.18 мс); реализация разбита на подпункты SC-02a..SC-02g ниже. Таблицы `tasks`/`docs` (id, project, status, priority, type, parent_id, updated_at, tags) + обновление в той же критической секции, что `writeJson`/`writeText`; перестройка командой и ленивая сверка `stat` при старте; `doctor` показывает расхождения. Убирает O(N)-скан и холодный кэш (1000 файлов холодно = 25.8 с). DoD: `npm test -- tests/scale-index.test.ts` (эквивалентность list-результатов файловому пути, инвалидация, сверка при старте); `node scripts/bench/run-scale.mjs --data <100k> --n 100000 --only tasks_list,knowledge_list --reps 3` → `medianMs < 300` и `responseBytes < 1048576` | Реализовано (2026-11-08): DoD проверен end-to-end на реализации (SC-02c), не на прототипе — Windows 11/NTFS, Node 24.22.2, 100k задач + 100k документов, настоящий HTTP-сервер: `tasks_list` 28/79 мс и 32 789 B, `knowledge_list` 33/52 мс и 22 068 B против порога 300 мс / 1 MiB (запас 10.7× и 9.1×), `index.tasksPageWithFiles` 3.98 мс против 10 мс, холодный старт 967 мс, наполнение индекса 129.9 с на 200 000 строк (БД 142.5 MB). Подробно — `docs/benchmarks/sc02-2026-11-07.md` §8. Обязательные a..e смержены, пункт закрыт; SC-02d (`doctor` + `reindex`) остаётся следующим обязательным шагом цепочки, SC-02f/g — опциональны |
| SC-03 | Инвертированный индекс поиска (FTS5) вместо пересборки BM25 на запрос | high | done | SC-02 | Индекс терминов/FTS5 в той же SQLite-базе; `search_tasks`/`search_knowledge` читают индекс, а не токенизируют корпус (100k доков = 23.6 с и 4.1 GB RSS). Сохранить текущее качество: hit@1 на `scripts/kb-bench-queries.json` не ниже baseline (`docs/benchmarks/kb-hardening-2026-10-20.md`: hit@1 88.9 %, MRR 0.926). DoD: `npm test -- tests/search-index.test.ts`; `node scripts/bench/run-scale.mjs --data <100k> --n 100000 --only search_tasks,search_knowledge --reps 3` → `medianMs < 1000`; `node scripts/kb-bench.mjs retrieval --mode bm25` → hit@1 ≥ 0.889. **Разбит 2026-11-08** на три инкремента: `SC-03a` — хранилище (таблица FTS5, upsert/remove/rebuild, ranked query с фильтрами, версия схемы) — done; `SC-03b` — запись (индекс в актуальном состоянии при мутациях, `doctor`/`reindex`, полнота по проекту); `SC-03c` — чтение (search_* читают индекс с откатом на BM25, замер hit@1 и `medianMs` на 100k). Пункт закрывается, когда done все три **Закрыто 2026-11-09 (SC-03c)**: поиск читает FTS-кандидатов с доказанной полнотой и фолбэком на файловый скан; 100k (100k задач + 100k доков, embeddings off) — `search_tasks` median 544 мс / p95 598 мс, `search_knowledge` 42 мс / 636 мс, cold start 625 мс, RSS 156 МБ; `kb-bench --via-tool` hit@1 77.8 при 77.8 у старого пути (530 чанков, embeddings off). DoD-файл `tests/search-index.test.ts` не существует — фактический `tests/search-fts.test.ts`; `kb-bench --mode bm25` read-путь не исполняет — добавлен `--via-tool` |
| SC-04 | UI: серверная пагинация, виртуализация, агрегированные счётчики | high | done | SC-01 | Доска грузит по колонкам (`status`+`limit`) и виртуализирует карточки, счётчики колонок — из `count`/`dashboard_stats`; список знаний — серверная пагинация + виртуализация; фильтры на сервере. Сейчас 10k задач = 105k DOM и 6 с до отрисовки (`web-ui/app/tasks/page.tsx:85`). DoD: `node scripts/bench/ui-bench.mjs --pages tasks,knowledge` на 10k → `domNodes < 20000` и `domSettledMs < 1500` для обеих страниц; `npm --prefix web-ui run test` зелёный |
| SC-05 | Граф: лимит, окрестность узла, кластеризация, LOD и легенда | medium | pending | — | Дефолтный лимит 200–300 узлов с «показано N из M», режим окрестности (`depth=1..2`), кластеризация по типу/тегу с раскрытием, подписи только у крупных узлов. Сейчас 1000 узлов = 2.3 с и 2 с Long Tasks, 5000 = 13.7 с и 16.3 с (`scripts/bench/graph-bench.mjs`). DoD: `node scripts/bench/graph-bench.mjs --sizes 200,1000,5000` → при 5000 узлах `longTaskTotalMs < 2000` и `timedOut === false`; скриншоты 200/1000 в PR |
| SC-06 | Шардирование каталогов и ретеншн архива | medium | pending | SC-02 | При > 50k файлов в проекте писать в `tasks/<project>/<ab>/` и `knowledge/<project>/<ab>/` (ab = первые 2 символа id), чтение поддерживает оба layout (паттерн уже есть в `listTasks`/`listDocs`); автоархив закрытых задач старше T без удаления; фоновая компакция. 1M файлов в одном каталоге: `readdir` 1.07 с тёплый, `rm -rf` 24.8 с. DoD: `npm test -- tests/sharding.test.ts` (миграция, чтение старого layout, отсутствие дублей); `node scripts/bench/seed-scale.mjs --n 100000 --out <dir> --sharded` → `readdir` по шарду < 100 мс |
| SC-07 | Пакетная git-история (решение для MU-03) | medium | blocked | Проработка (design): ADR: пакетный коммит, отдельный репозиторий истории или таблица ревизий | До реализации MU-03 зафиксировать, что коммит на операцию при 100k+ файлов недопустим (`git add`/`status` = O(N) на запись): очередь изменений + коммит по таймеру/размеру пачки, либо отдельный репозиторий истории, либо таблица ревизий в SQLite. ADR + реализация пакетного коммита вместе с MU-03. DoD: `npm test -- tests/git-history-batch.test.ts` (N операций → один коммит, откат = новый коммит, нет потери изменений при падении); ADR в `docs/adr/` |
| SC-08 | Бенчмарк масштаба как ночной гейт | low | pending | SC-01..SC-04 | `npm run bench:scale -- --n 100000` с порогами из DoD выше, JSON-результаты в артефакт CI, регрессия > 2× от baseline — красный. Не входит в `npm test`. DoD: workflow `.github/workflows/scale-bench.yml` (schedule) зелёный на master; при искусственном замедлении `listTasks` порог падает |

### Подпункты SC-02 (проработка 2026-11-07)

> Проработка закрыта 2026-11-07. Дизайн и развилки: `docs/dev-cycle/decisions/2026-11-07-1437-sc02-sqlite-index.md`.
> Замеры «до/после» на 1k/10k/100k: `docs/benchmarks/sc02-2026-11-07.md`. Прототип-замер:
> `scripts/bench/sqlite-index-bench.mjs` (бенч, не в CI). Порядок: SC-02a → SC-02b → SC-02c → SC-02e →
> SC-02d → SC-02f → SC-02g (SC-02g после SC-06). SC-02 закрывается, когда SC-02a..SC-02e смержены.
> Подпункты намеренно не входят в счёт «Итого»: `scripts/check-backlog.mjs` считает только ID вида `PREFIX-NNN`.

| ID | Инкремент | Статус | DoD (исполняемая проверка) |
|----|-----------|--------|----------------------------|
| SC-02a | Каркас индекса: `src/storage/metadata-index.ts` (интерфейс `MetadataIndex` + `SqliteMetadataIndex`), `DATA_DIR/.index/metadata.db`, pragma WAL/busy_timeout, `meta.schema_version`/`data_dir`, флаг `STORAGE_INDEX` (`auto`/`off`), инициализация в `AppContainer.init` после `checkSchemaVersion`, деградация при ошибке открытия | done | `npm test -- tests/metadata-index.test.ts`; pass — открытие и закрытие, несовпадение версии схемы даёт rebuild, `off` не создаёт файл, битый файл даёт `off` и `warn`, чужой `data_dir` даёт rebuild; fail — сервер не стартует или падает мутация из-за индекса. Реализовано (2026-11-07): `src/storage/metadata-index.ts`, `DATA_DIR/.index/metadata.db` с WAL и `busy_timeout=5000`, `meta.schema_version`/`meta.data_dir`, `STORAGE_INDEX` (`auto` или `off`), инициализация в `AppContainer.init` после `checkSchemaVersion`, деградация `off`+`warn`; тесты `tests/metadata-index.test.ts` (9), revert-check 4 мутации, `.index/` исключён из бэкапа |
| SC-02b | Запись: upsert/delete в критических секциях `createTask`, `updateTaskUnlocked`, `persistClaim`, `moveTasksToType`, `moveTasksToStatus`, `deleteTaskPermanent`, `createDoc`, `updateDocUnlocked`, `deleteDocPermanent`, `project_delete`; `meta.dirty` при ошибке индекса; rebuild пачками по 2000 | done | `npm test -- tests/metadata-index-write.test.ts`; pass — после каждой мутации строка совпадает с файлом по id, project, status, priority, type, parent_id, updated_at, mtime, tags, rel_path; claim меняет только mtime; ошибка индекса не валит мутацию; rebuild 100k ≤ 250 MB RSS; fail — любая точка записи в обход индекса. Реализовано (2026-11-07): `indexTaskWrite`/`indexDocWrite`/`indexTaskDelete`/`indexDocDelete`/`indexProjectDelete` и process-wide `setActiveMetadataIndex` в `src/storage/metadata-index.ts`, хуки в `src/storage/tasks.ts` (create, update, persistClaim, move по типу и статусу, delete), `src/storage/knowledge.ts` (create, update, delete), `src/projects.ts` (`deleteProject`); порядок файл → `stat` → upsert, ошибка индекса даёт `warn` + `meta.dirty`; `rebuild` пачками по 2000 плюс перестройка после файловых миграций в `AppContainer.init` и `markDirty` после `restoreBackup`. Тесты `tests/metadata-index-write.test.ts` (13), revert-check 11 мутаций RED→GREEN. Замер 100k задач + 100k документов: rebuild 33.6 с, БД 131 MB, live heap 25–41 MB; пик RSS 302 MB на дефолтных настройках Node и 176 MB при `--max-old-space-size=160` (кеш `gray-matter` на 100k документов иначе держит ~650 MB текста — обойдён вызовом `matter(raw, {})` в rebuild) |
| SC-02c | Чтение: `listTasksPage`/`listDocsPage` через индекс (id, rel_path, ключ страницы; читается только страница), фильтры status/tag/priority/parentId/type/updatedSince, `countOnly`, точный `total`, self-heal по mtime, частичный индекс `WHERE archived=0 AND trashed=0` для count | done | `npm test -- tests/scale-index.test.ts`; pass — элементы и hasMore совпадают с файловым путём на фикстуре, курсор файлового пути принимается индексным и наоборот, внешняя правка файла исправляется при чтении страницы, `totalExact` соответствует ожидаемому; fail — расхождение страниц. Реализовано (2026-11-07): гейт полноты проекта `isProjectComplete` (`projects.synced_at` + равенство числа индексных строк `projects.file_count` + `meta.dirty=0`), фоновое наполнение одного проекта `ensureProjectIndexed`/`fillProject` (дедуп промиса, пачки 2000, запрос не ждёт) по форме `src/search/warmup.ts`, индексные страницы с фильтрами/курсором/`countOnly`, self-heal по mtime (upsert при расхождении, удаление строки-сироты + `recountProject`), схема v2 с частичными индексами `idx_{tasks,docs}_active_page`, внутренние счётчики источника чтения для тестов; `projects.file_count` поддерживается инкрементально в тех же транзакциях, что пишут строки (вставка +1, удаление −1, обновление 0), поэтому обычные записи не выбивают проект из индекса. Тесты `tests/scale-index.test.ts` (23), revert-check 6 мутаций RED→GREEN. Замер 100k (HTTP, 3 повтора, `scripts/bench/run-scale.mjs --only tasks_list,knowledge_list`): `tasks_list` 1176 → 16 мс, `knowledge_list` 1232 → 21 мс (порог 300 мс), ответы 32 365 / 22 156 байт (порог 1 MiB), наполнение индекса 35 с / 143 MB, RSS после нагрузки 470 → 138 MB. После 300 операций записи (50 циклов create/update/delete задач и документов): `file_count` 200 000 не изменился, различных `synced_at` — 1 (наполнение не перезапускалось), `tasks_list` 15 мс, `knowledge_list` 17 мс |
| SC-02d | Диагностика: секция `index` в `doctor` (сироты, пропуски, расхождения mtime/size, `dirty`, версия) + команда `reindex [--project] [--verify] [--force]` + исключение `.index/` из бэкапа | done | `npm test -- tests/metadata-index-doctor.test.ts`; pass — удалённый файл виден как сирота, добавленный как пропуск, `reindex` лечит, `doctor` не меняет данные, `.index` не попадает в бэкап; fail — `doctor` пишет в индекс без флага. Реализовано (2026-11-08): `src/cli/index-inspect.ts` (read-only сверка индекса с файлами по `rel_path` и `mtime_ms`: сироты, пропуски, дрейф, `file_count`, `dirty`, схема, `data_dir`; сэмплы ограничены), секция `Index:` в `doctor` и предупреждения `index-orphan`/`index-missing-file`/`index-mtime-drift`/`index-count-drift`/`index-dirty`/`index-schema`/`index-foreign`/`index-incomplete` (все — `warn`, `--fix` индекс не трогает), `src/cli/reindex.ts` + маршрут в `src/index.ts` (`--project`, `--verify` без записи и с exit 1 при расхождении, `--force` вместо «nothing to do», exit 2 при чужом `DATA_DIR`, режим `STORAGE_INDEX=off` — no-op), `MetadataIndex.markProjectsComplete()` — после полного `rebuild` проекты помечаются полными, иначе индекс не используется до фонового наполнения. Бэкап: `.index` добавлен в `BASE_EXCLUDED` архива (в `data-backup.ts` он был с SC-02a, архив его не исключал — 140 MB производных данных в каждом архиве). Тесты `tests/metadata-index-doctor.test.ts` (14), revert-check 4 мутации RED→GREEN. Замер на 100k: `reindex --verify` 10.4 с → 0 расхождений; полный `reindex --force` 128.3 с на 200 000 строк, после — проект полный, 0 расхождений |
| SC-02e | Замеры и порог: прототип `scripts/bench/sqlite-index-bench.mjs` в репозитории (бенч), документ `docs/benchmarks/sc02-2026-11-07.md`, порог SC-02 в DoD | done | `node scripts/bench/run-scale.mjs --data <100k> --n 100000 --only tasks_list,knowledge_list --reps 3` → `medianMs < 300`, `responseBytes < 1048576`; `node scripts/bench/sqlite-index-bench.mjs --data <100k> --before` → `index.tasksPageWithFiles.medianMs < 10`; fail — любой порог. Реализовано (2026-11-08): прототип и документ были в репозитории с проработки (PR #295), здесь прогнаны **обе** DoD-команды на реализации: `run-scale.mjs` 100k → `tasks_list` 28 мс / 32 789 B, `knowledge_list` 33 мс / 22 068 B; `sqlite-index-bench.mjs --before` → `index.tasksPageWithFiles` 3.98 мс. Заодно исправлена портируемость `--before`: `await import(path.resolve(...))` на Windows падал (`Received protocol 'c:'`), теперь `pathToFileURL(...).href` — команда исполняется на обеих платформах. Замеры, расхождения с Linux и три находки прогона — `docs/benchmarks/sc02-2026-11-07.md` §8 |
| SC-02f | Полные списки на индексе (не блокирует закрытие SC-02): `listTasks`/`listDocs` берут id и порядок из индекса, содержимое читается только для нужных полей; `dashboard_stats`/`briefing` считают по индексу | pending | `npm test -- tests/scale-index-consumers.test.ts`; pass — `tasks_tree`, `tasks_dag`, `dashboard_stats` на 100k < 300 мс и совпадают с файловым путём; fail — расхождение или медленнее |
| SC-02g | Совместимость с шардированием (после SC-06): `rel_path` уже хранится, добавить перестройку при смене layout и проверку чтения обоих layout'ов | pending | `npm test -- tests/sharding.test.ts` и `npm test -- tests/metadata-index.test.ts`; pass — индекс читает старый и новый layout, перестройка не теряет строк; fail — чтение layout'а только одного вида |

## Этап AA — Агентский комплект: ядро, драфты, установка (2026-11-02)

> Цель: mcp-task-knowledge ставится на «чистого» агента одной ссылкой из админки, и агент сам доводит комплект до рабочего состояния — подключает MCP, ставит плагины сбора драфтов, консолидации и синка в трекер. Сегодня это разрозненные части, работающие только на машине владельца: каждый stdio-клиент порождает свой процесс со своим состоянием (векторы загружаются в каждом процессе отдельно), плагины расходятся с репозиторием, импорт драфтов делался разовым скриптом и не повторяем. Один логический MCP-сервер: Web UI по HTTP и агенты по stdio работают с общими данными; в одном процессе это не обязательно.
> Решения владельца (2026-11-02): **G1** — ядро отдельным постоянным сервисом (HTTP/Unix), stdio-клиенты становятся тонкими шимами через Thin Proxy; выбор лидера среди процессов не берём (ядро исчезает вместе с агентом лидера). **G2** — драфты и знания ALB целятся в проект `alb` в `/data` (создаётся через `project_create`), не в `agent-drafts` и не в `/opt/mcp`; проект задаётся параметром ссылки DX-29, а не зашит. **G3** — синк по событию (конец консолидации, `/end-session`, `session.idle`), без постоянного демона; ночной прогон — только опция, установщик по умолчанию его не создаёт. Открыт единственный гейт владельца — AA-10 (судьба старых данных), ничего не удаляется без его решения.
> Контекст по коду (проверено 2026-11-03 на master): DX-29 уже реализован — `buildSetupMarkdown` (`src/core/setup-link.ts:246`), `POST /admin/setup-links` и `GET /.well-known/mcp-setup/<otp>` (`src/transport/http-transport.ts:344-350`), инструмент `admin_setup_link` (`src/register/session.ts:162`), — но документ описывает ТОЛЬКО подключение MCP: плагинов, драфтов, консолидации и синка в нём нет. Процесс обслуживает ровно один транспорт: `type: z.enum(['stdio','tcp','http'])` (`src/config/schema.ts:17`), одно поле `adapter` (`src/core/app-container.ts:209`), `start()` создаёт и подключает один адаптер (`src/core/app-container.ts:703-717`). Thin Proxy (P-001..P-004) написан и покрыт тестами, но `ProxyBootstrap` нигде не вызывается вне `src/proxy` и спеков. Серверная инструкция не задана вовсе: `new McpServer({...})` (`src/register/setup.ts:91`) без поля `instructions`. Существующие импортёры для журнала драфтов не годятся: `knowledge_import_markdown` дедуплицирует по `title.toLowerCase()` (`src/register/markdown.ts:297-322`), а title берётся только из frontmatter, иначе `'Untitled'` (`src/register/markdown.ts:54`), поэтому записи без frontmatter затирают друг друга; `knowledge_import_single` дедупа не имеет.
> Не дублирует: `DX-10` (интерактивный установщик клиентов), `DX-11` (doctor), `DX-26` (CLI surface), `DX-12` и `DX-15` (agent_bootstrap и server_capabilities — только после design review), `DX-29` (ссылка и документ подключения; AA-07 добавляет в документ секцию Bundle), `U-01..U-06`, `Y-02` (контракты хранилища — ядро на них опирается), `P-001..P-004` (сам прокси уже есть, подключается в MU-08), `Z-04` (безопасность пакетов), `Q-014` (e2e-слайсы).
> Порядок: AA-01 → MU-08 (бывший AA-03); AA-02 — необязательный, только после AA-01 и если ADR выберет несколько транспортов; AA-04 после MU-08 (и AA-02, если тот понадобится); AA-05 независим; AA-06 после AA-04 и AA-05; AA-07 после AA-05 и закрытия DX-29; AA-08 и AA-09 независимы; AA-10 — гейт владельца и ничего не удаляет.
> Объединение: `AA-03` (Thin Proxy как stdio-шим) слит с `MU-08` — отдельного AA-03 нет, нумерация AA-04..AA-10 сохранена.
> Кросс-платформенность: где в DoD написано «Windows не проверено в окружении», минимальная замена — job `windows-latest` в CI-матрице (sha256, пути, CRLF, длинные пути, named pipe вместо Unix-сокета); локально Windows не воспроизводится.

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| AA-01 | ADR: общее ядро и режимы запуска | high | done | Y-02 (мягко); MU-01, MU-08 (входные данные: lock владельца DATA_DIR и мост stdio→http) | Зафиксировать: ядро — постоянный сервис, stdio-клиенты подключаются шимом через Thin Proxy; режимы запуска и время жизни (ядро живёт дольше клиента; кто владеет `DATA_DIR` и векторами; что происходит при двух ядрах на одном каталоге); границы Unix-сокет / TCP loopback / named pipe (Windows) / HTTP; сигналы и graceful shutdown при нескольких клиентах; почему не выбираем лидера среди процессов. Не переизобретает MU-01 и MU-08, а фиксирует модель целиком и ссылается на них. Документ в `docs/adr/` следующим свободным номером (заняты 0001..0007, ожидается `0008`), только архитектура, без кода. DoD: ADR содержит разделы «режимы», «время жизни», «Windows», «сигналы», `npm run lint:md` зелёный; pass — файл есть, `rg -c "^## " docs/adr/*agent-core*.md` ≥ 4 и lint exit 0; fail — раздела нет или lint красный. |
| AA-02 | Ядро принимает несколько транспортов одновременно (запасной вариант) | medium | pending | AA-01 | Нужен только если ADR AA-01 выберет это; цель «и http, и stdio к общему ядру» достигается схемой MU-08 без нескольких транспортов в одном процессе. Заменить одиночный `adapter` на список: конфиг принимает перечисление (`MCP_TRANSPORT=stdio,http`), одиночное значение остаётся обратно совместимым (`src/config/schema.ts:17`, маппинг env в `src/config/loader.ts:46`); `start()` создаёт и подключает каждый адаптер (`src/core/app-container.ts:703-717`), `stop()` закрывает все (`src/core/app-container.ts:788-795`); сигналы поднимает только не-stdio транспорт (`src/core/app-container.ts:245`), закрытие stdio-пайпа не должно завершать процесс. `ServerContext` остаётся один (`createServerContext`). DoD: `npm test -- tests/multi-transport.test.ts`; для одного процесса с `MCP_TRANSPORT=stdio,http` pass — HTTP-клиент и stdio-клиент получают одинаковый `tools/list` (N инструментов), закрытие stdio-клиента не убивает процесс, `SIGTERM` закрывает оба адаптера без `unhandledRejection`; fail — второй транспорт не поднимается либо закрытие stdio-пайпа гасит процесс. Windows не проверено в окружении — замена: CI `windows-latest` на этот тест. |
| AA-04 | Журнал драфтов (append-only) и воркер синка в трекер | high | pending | AA-02 | На диске — журнал: append-only, единица записи со своим id, ничего не перезаписывается; MCP — индекс. Воркер синка: курсор и подтверждение (ack) после успешной записи, повтор при недоступности MCP, идемпотентный ключ `draft:ses_<id>#<n>` (хэш содержимого — в tags, не в title). Запись в трекер — только через идемпотентный путь по ключу: `knowledge_import_single` дедупа не имеет, а `knowledge_import_markdown` дедуплицирует по title (`src/register/markdown.ts:297-322`) и затирает записи без frontmatter, поэтому нужен upsert по внешнему ключу (новый инструмент либо поле `externalKey`) — это часть задачи. Проект — `alb` из параметров ссылки DX-29 (G2), создаётся через `project_create`. DoD: `npm test -- tests/draft-sync.test.ts`; сценарий на временном `DATA_DIR`: MCP выключен → 3 записи в журнале и в очереди; MCP включён → синк, 3 документа находятся `search_knowledge`; повторный синк → всё ещё 3; обрыв MCP посреди пачки → продолжение без дублей; две сессии пишут параллельно → потерь нет. pass — все пять пунктов, fail — любой дубль или потеря. |
| AA-05 | Плагины и скрипты комплекта — в репозитории, один источник правды | high | done | — | В репозитории `extensions/opencode/` 7 плагинов и README, но `session-draft.ts` есть только на машине владельца; `collect-subagent-drafts.sh` живёт в `~/.config/opencode/scripts/`, консолидация — в отдельном репозитории скиллов (`draft-consolidation`), а живые `memory-recall.ts` и `memory-sync.ts` расходятся с репозиторными. Перенести комплект (сборщик драфтов, напоминание, консолидация, синк) в репозиторий; живые копии свести к репозиторным либо объяснить каждое расхождение в `docs/plugins/opencode.md`. Инвентаризация read-only: версии, даты, живые или репозиторные. DoD: `diff -u extensions/opencode/<name>.ts ~/.config/opencode/plugins/<name>.ts` пуст для каждого плагина, либо расхождение перечислено в разделе «Расхождения» с причиной и решением; `git ls-files extensions/opencode` содержит `session-draft.ts`; pass — diff пуст или объяснён для всех 7 плагинов плюс session-draft, fail — есть необъяснённое расхождение. |
| AA-06 | Консолидация драфтов в факты и паттерны — часть комплекта, по событию | medium | pending | AA-04, AA-05 | Консолидация (`draft-consolidation`) переезжает из личных скиллов в комплект; запуск по событию (конец консолидации, `/end-session`), без демона и без ночного крона по умолчанию (G3); результат — записи в `facts.md`/`patterns.json` и событие синка в трекер, повторный запуск не плодит дубли. DoD: `npm test -- tests/draft-consolidation-event.test.ts`; pass — после прогона на временном каталоге появляется ≥ 1 факт с анкором, событие синка отправлено один раз (повторный вызов — ноль новых), `npm run memory:verify -- --limit 50` не показывает новых `stale` из-за отсутствия анкора; fail — дубли либо синк не сработал. |
| AA-07 | Комплект установки: `bundle.json` и `install-agent` | high | pending | DX-29, DX-10, DX-11, DX-26, AA-05, Z-04 | `bundle.json` — компоненты (ядро, шим, плагины, скрипты, консолидация, синк), версии, sha256, целевые пути по клиенту и ОС. `install-agent --client opencode` и `--client claude-code` на Node без bash: идемпотентно, `--dry-run`, бэкап, откат, проверка sha256; плагины исполняются с правами пользователя — учитывать `Z-04`. В документ DX-29 добавляется секция «Bundle»: что установится, куда и как откатить; ссылка остаётся одноразовой и ничего не ставит сама без команды агента. DoD: чистый временный `HOME`, выполнить инструкцию из ссылки; pass — плагины загружены, тестовый драфт найден поиском в трекере, повторный запуск установщика не меняет файлы (`--dry-run` ничего не пишет, второй реальный запуск сообщает «no changes»), `--rollback` возвращает исходное состояние, все sha256 совпали; fail — расхождение hash, дубли плагинов или отсутствие отката. Windows не проверено — замена: CI `windows-latest` (sha256, пути, CRLF, длинные пути). |
| AA-08 | Серверная инструкция и видимая поверхность инструментов | high | blocked | Проработка (design): профили: состав ≤60 инструментов и текст серверной инструкции | Поле `instructions` у `McpServer` сейчас не задано вовсе (`src/register/setup.ts:91`), поэтому агент не знает, когда что вызывать: за 30 дней OpenCode сделал 15 вызовов (12 из них `search_knowledge`, задач 0), Claude Code — 0. Дать 10–15 строк: 5–8 действий и когда их вызывать (`briefing` вместо пяти чтений, `tasks_*` при любой работе с задачами, `search_knowledge` перед ответом о проекте, `memory_*` для фактов), что НЕ использовать без нужды и что требует `project`. Урезать видимую по умолчанию поверхность профилями и флагами (134 зарегистрированных инструмента, цель — ≤ 60 в профиле по умолчанию); `DX-15` не дублировать. DoD: тест `tests/server-instructions.test.ts` проверяет, что `initialize` отдаёт непустой `instructions` ≤ 15 строк и в нём есть 4 обязательных пункта; метрика из `opencode.db` до и после; pass — инструкция отдаётся, поверхность ≤ 60, за 14 дней после релиза есть вызовы `tasks_*` (baseline 0); fail — инструкция длиннее 15 строк, поверхность не измерена или счётчик вызовов не вырос. |
| AA-09 | Один источник правды по статусам: `BACKLOG.md` и трекер | medium | pending | — | Источники расходятся: `T-002` в `BACKLOG.md` — `done` (PR #49), а в трекере (`/data/tasks/mcp`: «1.2 TCP/Unix сервер (multi-client)», «Этап 1. Транспорт: stdio + сетевой режим», «Этап 5. Тонкий клиент-прокси») — `pending`. Написать скрипт сверки по явной карте «ID бэклога ↔ id задачи» и решить, кто главный (предложено: `BACKLOG.md` нормативный, трекер получает производные записи, расхождение показывается, а не затирается). DoD: `DATA_DIR=/data node scripts/backlog-sync-check.mjs --project mcp` exit 0 и печатает `0 расхождений` по отображённым ID; pass — 0 mismatches, скрипт read-only; fail — есть расхождение либо скрипт мутирует данные. Не блокирует AA-01..AA-08. |
| AA-10 | Данные: `agent-drafts`, `/opt/mcp`, проект `alb` | low | blocked | Гейт владельца: судьба данных — agent-drafts, /opt/mcp/*, проект alb — оставить, архив или удалить | Гейт владельца, ничего не удаляется без его решения. Разобрать три набора: `agent-drafts` в `/data` (7949 документов, разовый эксперимент 2026-10-20, потребителей нет), `/opt/mcp/knowledge/alb` и `/opt/mcp/tasks/alb` (28 и 23 файла от 2025-08, сервер их не видит) и проект `alb` в `/data` (создаётся в AA-04 по G2). DoD: решение по каждому набору записано в задаче (оставить / архивировать / удалить) с обоснованием; pass — решения записаны, при удалении есть предварительная копия (`cp -a <dir> <dir>.bak-<date>`) и удаление выполнено через `project_delete` после подтверждения; fail — данные тронуты без решения или без копии. |

## Этап AB — Compact-режим и инструкции агентам (2026-11-07)

> Источник: обсуждение владельца 2026-11-07 и пункт `P-20261107-1` с дополнением (локальный
> `.devcycle/proposals.md`, вне git). Запись решения: `docs/dev-cycle/decisions/2026-11-07-0728-compact-mode.md`.
> Канон счёта инструментов (решение `2026-11-07-0645-p-20261107-9.md`): 128 по умолчанию, 130 с каталогом,
> 132 с записью каталога, 4 в компактном режиме (`MCP_TOOLS_ENABLED=false`); источник истины — живая
> регистрация, а не grep.
> Ставка этапа не число инструментов, а стоимость контекста на сессию и способность слабой модели найти
> нужный инструмент. Режим глобален для ядра (одно ядро обслуживает Claude Code, OpenCode и админку);
> выбор «на клиента» возможен только на мосте.
> Полная серверная инструкция, текст для агента и профили поверхности остаются в `AA-08`; `CM-03` закрывает
> проверяемую часть и не дублирует `AA-08`.
> Порядок: CM-01 → CM-03; CM-02 после ответа владельца; CM-04 после CM-02 и CM-03; CM-05 после CM-03 и
> точных id моделей; CM-06 только после CM-05.

Сверка фактов контролёра с кодом на `origin/master` 28e45a1 (2026-11-07):

- `instructions` сервер не отдаёт: поле не задано ни в одном конструкторе `McpServer`
  (`src/register/setup.ts:91`, `src/transport/stream-transport.ts:252`, `src/transport/http-transport.ts:634`,
  `src/proxy/shim.ts:62`), проба `client.getInstructions()` вернула `null`. Факт контролёра подтверждён.
- `tools_batch` в компактном режиме не регистрируется: два независимых списка из четырёх имён —
  инлайн-массив `src/register/setup.ts:322` и `TOOLS_DISABLED_WHITELIST` `src/register/tools-introspection.ts:10`;
  страж `tests/docs-tools-coverage.test.ts:182` фиксирует отсутствие. Дублирование списков — кандидат в техдолг,
  отдельным пунктом не заводится.
- `tools_run` последовательный, по умолчанию продолжает после ошибки, `stopOnError: true` прерывает;
  `tools_batch` параллельный (`Promise.all`, 1..50), флага остановки нет. Расхождение с «тестов на оба поведения
  нет» частичное: `tests/tools-batch.test.ts` уже проверяет агрегацию, частичный отказ и флаг `parallel: true`,
  а `stopOnError`, фактическая конкурентность и порядок результатов не покрыты.
- Размер ответа `tools/list` не воспроизведён: замер клиентом SDK на 28e45a1 — 87 757 байт (128 инструментов),
  компактный — 1 918 байт (4 инструмента). В факте контролёра было 65 801 и 1 908 байт; разница по полному
  ответу — 22 КБ, поэтому оценка «≈66 КБ» в `docs/features/tools.md` занижает стоимость сессии. Страницы
  `tools_list` — 20 по умолчанию, максимум 100 (`src/register/tools-introspection.ts:67-68`) — подтверждено.
- Флага `--tools` у `src/cli/bridge.ts` нет (есть `--url`, `--proxy-upstream`, `--token`); `CM-04` добавляет новый
  флаг, а не чинит существующий.

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| CM-01 | Тест-спека текущего поведения `tools_run` и `tools_batch` | high | done | — | Зафиксировать ТЕКУЩЕЕ поведение до изменения контракта: порядок результатов равен порядку `items`; по умолчанию ошибка в середине пачки не останавливает остальные; `stopOnError: true` прекращает цикл; `tools_batch` параллелен (`Promise.all`, 1..50) и не имеет флага остановки. `tests/tools-batch.test.ts` уже покрывает агрегацию, частичный отказ и флаг `parallel: true` — новый файл эти кейсы не дублирует, а добавляет `stopOnError`, ошибку в середине пачки, фактическую конкурентность и порядок. DoD: `npx vitest run tests/tools-run-batch-contract.test.ts`; pass — все кейсы зелёные и две мутации красят тест: удалить `break` при `stopOnError` в `src/register/tools-introspection.ts` (RED на остановке), заменить `Promise.all` на последовательный цикл (RED на конкурентности); fail — мутация не падает или тест зелёный без фикса. Конкурентность доказывается счётчиком активных обработчиков и барьером, без `sleep` |
| CM-02 | Флаг `parallel` в `tools_run` или `tools_batch` в компактном режиме | medium | pending | Гейт владельца: `parallel` в `tools_run` или регистрация `tools_batch` в compact; CM-01 | Развилка одна: оставить провод из четырёх инструментов и добавить `tools_run` флаг `parallel` (по умолчанию выключен), либо оставить четыре инструмента и зарегистрировать `tools_batch` пятым. Решение принимает владелец, до ответа пункт не берётся в работу. Вариант A: `parallel: true` сохраняет порядок результатов и семантику `stopOnError`, последовательный режим не меняется. Вариант B: `tools_batch` входит в оба списка (`src/register/setup.ts:322` и `src/register/tools-introspection.ts:10`) и в документацию, компактный провод становится 4+1. DoD: вариант A — `npx vitest run tests/tools-run-parallel.test.ts`; pass — при `parallel: false` максимум один активный обработчик, при `parallel: true` — два и больше, порядок результатов и `stopOnError` не меняются; вариант B — `npx vitest run tests/docs-tools-coverage.test.ts`; pass — компактный провод равен ожидаемому списку, `tools_batch` вызывается через провод и исполняет инструмент ядра; fail — провод расходится со списком либо мутация не красит тест |
| CM-03 | Серверные `instructions` в `initialize` | high | pending | — | Сначала проба, потом минимальная реализация: проверить, отдаёт ли ядро поле `instructions` в `initialize` и показывают ли его Claude Code и OpenCode без проектного скилла. По коду на 28e45a1 поле не задано ни в одном конструкторе `McpServer` (`src/register/setup.ts:91`, `src/transport/stream-transport.ts:252`, `src/transport/http-transport.ts:634`, `src/proxy/shim.ts:62`), проба `client.getInstructions()` дала `null`. Генерация: домены с числом инструментов из реестра (не хардкод) и протокол `tools_list search` → `tool_schema` → `tools_run`. Полная инструкция и профили остаются в `AA-08`; здесь только проверяемая часть без сокращения поверхности. DoD: `npx vitest run tests/server-instructions.test.ts`; pass — `client.getInstructions()` непустой, не длиннее 15 строк, содержит протокол и домены, число доменов совпадает с живым реестром, удаление домена из генератора красит тест; плюс проба двух клиентов: в чистой сессии агент без подсказки пересказывает не меньше двух шагов инструкции, результат записан в запись решения; fail — инструкция пустая или длиннее 15 строк, домены захардкожены либо клиент инструкцию не видит (тогда пункт закрывается выводом «instructions недостаточны для клиента X» и усиливает CM-04 и CM-06) |
| CM-03a | Генерация и wiring `instructions` | high | done | CM-03 | `src/core/server-instructions.ts`: домены/числа из живого реестра, ≤15 строк, протокол `tools_list search`→`tool_schema`→`tools_run`, `tools_batch`; выставление в `defaultRegistration`, TCP/Unix, HTTP per-session и bridge. DoD: `tests/server-instructions.test.ts` — живой `Client.getInstructions()` непустой, ≤15 строк, домены совпадают с реестром; 3 мутации RED. Живая проба клиентов вынесена в CM-03b |
| CM-03b | Проба Claude Code/OpenCode: видимость `instructions` | high | pending | CM-03, CM-03a | В чистой сессии без проектного скилла проверить, пересказывает ли агент ≥2 шага инструкции. В текущей среде CLI установлены (claude 2.1.319, opencode 1.19.5), но `claude -p` зависает на простом запросе (45 c) и MCP-пробе (180 c) — рабочей agent-сессии нет; ограничение записано в решении CM-03a. Если клиент инструкцию не покажет — зафиксировать вывод и усилить CM-04/CM-06 |
| CM-04 | Мост: `--tools meta` или `full` на клиента | medium | pending | CM-02, CM-03 | Компактный режим на клиенте при одном ядре: `bridge --tools meta` отдаёт клиенту четыре мета-инструмента, вызовы уходят в ядро через `tools_run`; `--tools full` (по умолчанию) поведение не меняет. Ядро и `DATA_DIR` не трогаются, режим ядра остаётся общим. DoD: `npx vitest run tests/bridge-tools-mode.test.ts`; pass — `client.listTools()` через мост с `--tools meta` равен четырём именам, вызов не-мета инструмента через `tools_run` возвращает данные ядра, с `--tools full` видно 128, без флага поведение прежнее; fail — клиент видит больше четырёх в meta либо вызов через `tools_run` не доходит до ядра. Revert-check: снятие фильтра в шиме красит тест |
| CM-05 | Замер на чистых инстансах и слабых моделях | medium | pending | Гейт владельца: точные id моделей (владелец назвал «… 2.6 Flash» и «DeepSeek 4.1», id не придумывать); CM-03 | Методика из дополнения к `P-20261107-1`: чистые инстансы без памяти и проектного скилла, только MCP через мост; 11 проверочных запросов и 3 записи (создать задачу, закрыть, найти знание); конфигурации A (полный список без instructions), B (полный с instructions), C (compact с instructions), D (compact без instructions); каждая модель три прогона. Метрики на строку: доля выполненных задач без подсказок, число вызовов, токены на сессию, ошибочные вызовы и выдуманные имена, подхвачен ли `instructions`. Целевые модели — слабые, плюс Claude для сравнения. DoD: `docs/benchmarks/compact-mode-<YYYY-MM-DD>.md`; pass — таблица содержит 4 конфигурации × не меньше 3 моделей × 3 прогона (не меньше 36 строк), в каждой строке заполнены все метрики, указан способ счёта токенов (usage провайдера или оценка с формулой), записано решение «по умолчанию режим X» с опорой на строки; fail — нет конфигурации, прогона или метрики либо решение без данных. Если провайдер не отдаёт usage, токены помечаются как оценка |
| CM-06 | Проектный скилл: только политика | low | pending | Проработка (decision): после CM-05 — если `instructions` достаточно, скилл не нужен; CM-05 | Скилл проекта `mcp` без каталога инструментов: теги `backlog-sync` и `decision`, bulk вместо одиночных вызовов, confirm-гейты на разрушающие операции, `trustLevel` для внешнего контента, ссылка на `docs/api-reference.md` вместо копии схем. Решается после CM-05: при выполнении порога в конфигурациях B и C скилл не создаётся, решение фиксируется. DoD: запись решения в `docs/dev-cycle/decisions/`; pass — один из двух исходов записан со ссылкой на строки CM-05: «скилл не нужен, instructions достаточно» либо «скилл нужен» и состав политики без каталога инструментов; fail — решения нет либо скилл дублирует каталог инструментов |

## Этап AC — Контракты MCP: схемы, счётчики и большие ответы (2026-11-07)

> Источник: поручение `P-20261107-14`, эксперимент с трекером (сессия `ses_e4c1d348cffekeZBOE1t2u47Bd`,
> раздел 6 «Журнал трудностей» и раздел 8 «Предлагаемые изменения»). Запись решения:
> `docs/dev-cycle/decisions/2026-11-07-0918-tasks-ui-and-mcp-contracts.md`.
> Почему отдельный этап, а не строка в «Качество и тестирование»: дефекты здесь не в тестах, а в
> контракте инструментов — что сервер публикует в `tools/list`, что возвращает в `count` и `total`,
> сколько отдаёт в одном ответе. `SC-01` (пагинация и `fields`) закрыт и эту часть уже дал,
> `U-04` закрывает экономию токенов только для list и search, `CM-01..CM-06` — стоимость контекста
> и инструкции. Пересечения названы в тексте пунктов, ни один пункт их не переизобретает.
> Находки проверены на `origin/master` f6a748f клиентом MCP SDK (stdio, свой `DATA_DIR`,
> `EMBEDDINGS_MODE=none`), а не по отчёту. Два утверждения на ядре не воспроизвелись (частичный патч
> `tasks_bulk_update`, `internal error` из `tools_run`) и помечены как «со слов эксперимента» только там,
> где проверки нет. Третье — «схема `tasks_bulk_create` требует все 7 полей» — воспроизвелось, но не на
> ядре: ядро публикует обязательным только `title`, а вложенные схемы переписывает мост. Это отдельный
> дефект этапа R, `MU-09`; `AC-01` ссылается на него и своей копии описания не держит.
> `Q-016` в этом файле — атомарный lock в `/devcycle` (`scripts/lib/devcycle-state.mjs`), к
> `tasks_set_deps` он отношения не имеет: ссылка эксперимента на `Q-016` ошибочна, пункт про
> `set_deps` заведён здесь как `AC-02` и существующих ID не дублирует.
> Порядок: AC-01 → AC-02; AC-03 после AC-02 (общие имена полей); AC-04 и AC-05 независимы.

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| AC-01 | Схемы и валидация аргументов инструментов | medium | done | MU-09 | Корень жалобы «`tasks_bulk_create` требует все 7 полей» — мост, а не сервер, и он закрыт пунктом MU-09 2026-11-07 (проба паритета: 128 инструментов, 0 расхождений, `tests/proxy-schema-parity.test.ts`): ядро на f6a748f публикует в item обязательным только `title` (у `knowledge_bulk_create` — `title` и `content`, у обоих `*_bulk_update` — `id`), а мост делает обязательными все вложенные поля и теряет enum с границами. Первая редакция этого пункта объясняла расхождение старой сборкой сервера или конвертацией схемы на клиенте — причина установлена, это объяснение снято. Здесь остаются дефекты самого ядра, подтверждённые и напрямую, и через мост: `tasks_bulk_create` с `parentId: ""` создаёт задачу и сохраняет пустую строку в файле (`src/storage/tasks.ts:93` пишет `input.parentId` без нормализации); неизвестное имя параметра молча игнорируется — `tasks_list({tags: [...]})` вернул все задачи вместо ошибки, потому что zod срезает лишние ключи. Сделать: контрактный тест «опубликованная схема равна Zod-опциональности» на шесть инструментов `*_bulk_*`; пустую строку трактовать как отсутствие поля в create и update; на лишние параметры отвечать `{ok:false, code:'UNKNOWN_PARAM', hint}` со списком допустимых имён верхнего уровня, а если клиенты начнут ломаться — fallback `meta.warnings` без отказа. DoD: `npx vitest run tests/mcp-argument-contracts.test.ts`; pass — минимальный вызов каждого из шести `*_bulk_*` напрямую проходит, `required` в опубликованной схеме равен ожидаемому списку, задача с `parentId: ""` не содержит ключа `parentId` в файле, `tasks_list({tags:['x']})` даёт `UNKNOWN_PARAM` с `hint` на `tag`, а `tasks_list({tag:'x'})` работает как раньше; fail — любое из условий не выполняется. Revert-check: снять нормализацию пустой строки и проверку лишних параметров — тест краснеет. Реализовано (2026-11-08): неизвестный параметр больше не игнорируется — центральный wrapper `registerTool` передаёт SDK «рыхлую» схему (v3 `passthrough` или v4 `looseObject`, по вкусу самого shape), поэтому лишние ключи доживают до обработчика, а guard в `src/core/tool-arguments.ts` отвечает `{ok:false, error:{code:"UNKNOWN_PARAM", message, hint:"Did you mean "tag"? Allowed: …", details:{unknown, allowed, suggestion}}}`; `tasks_list({tags})` даёт подсказку `tag`, `tasks_list({tag})` работает как раньше. Пустая строка трактуется как отсутствие поля: `blankToUndefined` в `src/utils/strings.ts` применён в `createTask`/`updateTaskUnlocked`/`createDoc`/`updateDocUnlocked`, поэтому `parentId: ""` не пишется в файл и снимает родителя при update. Контрактный тест сверяет опубликованную схему с Zod-опциональностью **всех** инструментов (а не только шести `*_bulk_*`) и прогоняет минимальные вызовы bulk-инструментов. Тесты `tests/mcp-argument-contracts.test.ts` (7). Побочный эффект, зафиксированный в решении: у инструментов, объявленных через `zod/v3`, опубликованное `additionalProperties` стало `true` (было `false`) — SDK сериализует именно ту схему, которой валидирует |
| AC-02 | Честные счётчики и одно значение слова «blocked» | high | done | Гейт владельца: сохранять ли автоперевод статуса в `tasks_set_deps`; счётчики и имена полей делаются без гейта | Подтверждено вызовом на f6a748f: `tasks_list({countOnly:true})` отдаёт `count: 0` при `total: 4`, потому что обе ветки финализации жёстко пишут ноль (`src/utils/pagination.ts:206` и `:245`); `search_tasks` по 60 совпадающим задачам даёт `total: 50` и `totalExact: true` — это потолок пула кандидатов (`Math.max(limit ?? 50, 50)`, `src/register/search.ts:52`), а не число совпадений. `tasks_set_deps` переписывает `status` в `blocked` только для статусов категории `todo` (`src/register/dependencies.ts:42`); `in_progress` не перезаписывается — проверено вызовом, утверждение «включая in_progress» не воспроизводится. Зато верхнеуровневое поле `status` в ответе `tasks_set_deps` означает три разные вещи: сохранённый статус в одной ветке, слово `blocked` на строке 46 и слово `unblocked` на строке 55 в других. И слово «blocked» живёт в трёх местах с разными числами: сохранённый статус, `tasks_dag.blockedCount` по невыполненным зависимостям (`:129-134`) и `tasks_get_deps.isBlocked`. Сделать: `count` равен `total` в режиме countOnly; у `search_tasks` либо настоящий `total`, либо `totalExact: false` и отдельное поле `candidates`; ответ `tasks_set_deps` содержит только `task`, `statusChanged`, `blockedByDeps` и `blockingDeps`, слова-действия в поле `status` не попадают; признаки переименованы — `blockedByDeps` для зависимости, `status` для сохранённого статуса; автоперевод статуса остаётся решением владельца (по умолчанию не менять либо флаг `markBlocked`). DoD: `npx vitest run tests/tasks-status-semantics.test.ts`; pass — countOnly даёт `count === total` на непустом проекте, при 60 совпадениях и лимите 50 либо `total: 60`, либо `totalExact: false` с `candidates: 50`, `set_deps` для задачи `in_progress` не меняет статус и отдаёт `blockedByDeps: true` и `statusChanged: false`, поле с именем `status` никогда не содержит `unblocked`; fail — любое расхождение. Revert-check: вернуть жёсткий ноль в `count` — тест краснеет. Реализовано (2026-11-08): `finalizePage` и `finalize` в `src/utils/pagination.ts` отдают `count === total` в режиме countOnly (было жёстко 0); `search_tasks` не выдаёт размер пула за число совпадений — при `items.length > pool` ответ помечен `totalExact:false` и `candidates`, при полном ранжировании total точный; то же сделано у `search_knowledge` (ранжирование ограничено `RANKED_LIMIT = 200`, и раньше `totalExact:true` был ложью при большем числе документов). `tasks_set_deps` возвращает `task`, `statusChanged`, `blockedByDeps`, `blockingDeps`: поле `status` теперь всегда хранимый статус, слов `blocked`/`unblocked` в нём нет, а автоперевод в `blocked` (только категория todo) управляется новым флагом `markBlocked` (по умолчанию `true` — поведение прежнее, гейт владельца на смену поведения не тронут). Тесты `tests/tasks-status-semantics.test.ts` (5) на живом сервере через in-memory транспорт. |
| AC-03 | Фильтры, проекции и размер больших ответов | medium | done | AC-02, U-04, SC-01 | `tasks_dag` принимает только `project` и `includeArchived` (`src/register/dependencies.ts:113-117`) и отдаёт `topologicalOrder`, `criticalPath` и `edges` целиком: 6,7 КБ на 62 задачах с короткими заголовками (замер на f6a748f), около 51 КБ на реальном проекте из 241 задачи — со слов эксперимента, там ответ обрезал транспорт. `tools_list` принимает `limit` не больше 100 (`src/register/tools-introspection.ts:68`), поэтому 128 инструментов клиент листает двумя страницами. `fields` уже есть у list и search после SC-01, у write-инструментов его нет: `tasks_create`, `tasks_update` и `tasks_set_deps` возвращают задачу целиком (около 0,3 КБ на вызов, 55 вызовов в эксперименте — около 16 КБ). Опции `compact` нет нигде, `meta.ms` нет ни в одном конверте (`src/utils/respond.ts`). Фильтра по списку кодов нет: `tasks_list` знает `status`, `type`, `tag`, `priority`, `parentId`, `updatedSince`. Сделать: фильтры `tag`, `limit`, `fields` и режим `onlyWithDeps` у `tasks_dag` с `truncated` и курсором; `limit` у `tools_list` до 300 либо авто-пагинация в ответе; `fields` и `compact` у write-инструментов задач и знаний; `meta.ms` в каждом конверте; `tasks_list` по списку `ids` и по списку `codes` для пакетного сопоставления кодов бэклога с id. DoD: `npx vitest run tests/response-filters.test.ts` плюс замер `tasks_dag` на проекте не меньше 240 задач с зависимостями; pass — отфильтрованный `tasks_dag` не больше 8 КБ и содержит `truncated` с курсором, `tools_list({limit:200})` отдаёт 128 без ошибки, write-ответ с `fields:['id']` не больше 120 байт, `meta.ms` — неотрицательное число, `tasks_list({ids:[...]})` возвращает ровно запрошенные задачи; fail — любое из условий. Revert-check: убрать `meta.ms` — тест краснеет. **Разбит 2026-11-08** на три инкремента (каждый — свой PR, DoD ниже): `AC-03a` — `meta.ms`, `tasks_list` по `ids`/`codes`, `tools_list` до 300 (done); `AC-03b` — `tasks_dag` с фильтрами и усечением; `AC-03c` — `fields`/`compact` у write-инструментов. Причина разбиения: пункт содержит пять независимых поверхностей, и каждая требует своих тестов и своей проверки на живом сервере; прецедент — SC-02, разбитый на SC-02a..g. Пункт закрывается, когда done все три подпункта. **Закрыт 2026-11-08**: AC-04a (PR #307), AC-04b (PR #308) и AC-04c влиты; DoD выполнен — отказ в `tools_run` приходит с исходным `code` и `requestId`, `tool_schema('tasks_bulk_create')` содержит `inputSchema.properties.items.items.properties.title`, хвост лога не содержит JWT и токенов. **Закрыт 2026-11-08**: AC-03a (PR #304), AC-03b (PR #305) и AC-03c влиты; DoD выполнен — `tasks_dag` на 240+ задачах отдаёт страницу ≤ 8 КБ с курсором, `tools_list({limit:200})` отдаёт 128 без второй страницы, write-ответ с `fields:['id']` ≤ 120 байт, `meta.ms` в каждом конверте, `tasks_list({ids})` возвращает ровно запрошенные задачи |
| AC-04 | Диагностика вызовов: `tools_run`, `tool_schema` и лог | medium | done | — | `tools_run` на bulk-инструментах в эксперименте дал `{ok:false, error:"internal error"}` — на f6a748f не воспроизводится: `tasks_bulk_create` с `items: []` через `tools_run` вернул `{ok:true, count:0}`, `tasks_create` через `tools_run` создал задачу. Подтверждено другое: `tools_run` отдаёт только `error.message` без `code`, `details` и идентификатора запроса (`src/register/tools-introspection.ts:194-203`), поэтому причину отказа по ответу не восстановить. `tool_schema` вместо схемы отдаёт пример с заглушкой `"items": "example"` — подтверждено живым вызовом MCP и тем же заглушечным примером в `docs/api-reference.md`. Сделать: `tools_run` пробрасывает исходный конверт ошибки (`code`, `message`, `details`) и `requestId`; по `requestId` серверный лог находится без `journalctl`; read-only инструмент для хвоста лога с вычищенными секретами; `tool_schema` отдаёт настоящую `inputSchema`, заглушка остаётся только в примере для нескалярных аргументов. DoD: `npx vitest run tests/tools-run-errors.test.ts`; pass — вложенный отказ валидации в `tools_run` приходит с исходным `code` и `requestId`, `tool_schema('tasks_bulk_create')` содержит путь `inputSchema.properties.items.items.properties.title` вместо строки `example`, хвост лога не содержит JWT и токенов; fail — любое из условий. Revert-check: снять проброс `code` — тест краснеет. **Разбит 2026-11-08** на три инкремента (каждый — свой PR): `AC-04a` — конверт ошибки и `requestId` в `tools_run`/`tools_batch` (done); `AC-04b` — настоящая `inputSchema` в `tool_schema`; `AC-04c` — read-only хвост лога с вычисткой секретов (требует файлового синка логов: сейчас pino пишет только в stderr). Пункт закрывается, когда done все три подпункта |
| AC-05 | `search_tasks`: прогрев индекса и честный статус | medium | done | SC-03 | Первый `search_tasks` сразу после массовой вставки в эксперименте упал таймаутом `-32001`, повторный ответил за 38 мс (со слов эксперимента; при `EMBEDDINGS_MODE=none` на f6a748f не воспроизведено). По коду индекс и ранжирование собираются внутри вызова, фонового прогрева для задач нет — он есть только для знаний (`src/search/warmup.ts`), а поиск задач идёт через `hybridSearch` в `src/register/search.ts:44-58`. У чисто векторных хитов поля `bm25Score` нет вовсе вместо нуля. Сделать: прогрев и инкрементальный reindex задач по событиям записи по образцу `src/storage/knowledge-events.ts` либо явный статус `INDEXING` с `retryAfterMs` вместо транспортного таймаута; `bm25Score: 0` отдавать всегда. DoD: `npx vitest run tests/search-tasks-warmup.test.ts`; pass — после вставки 200 задач первый `search_tasks` отвечает быстрее 2000 мс на `EMBEDDINGS_MODE=none` либо возвращает `{ok:false, code:'INDEXING', retryAfterMs}`, повторный ответ не дольше 200 мс, у векторного хита `bm25Score === 0`; fail — таймаут транспорта или отсутствующее поле. Revert-check: отключить прогрев — тест краснеет Примечание 2026-11-09: SC-03c переключил `search_tasks` на FTS-кандидатов с фоновым дозаполнением и полем `indexing`, поэтому «индекс собирается внутри вызова» больше не верно при полном индексе; остаток пункта — явный `INDEXING` вместо транспортного таймаута при пустом индексе и `bm25Score: 0` у векторных хитов. **Закрыт 2026-11-09 (AC-05)**: воспроизведение на 64ce804 (200 задач, `EMBEDDINGS_MODE=none`) дало первый `search_tasks` 48 мс, повторный 14 мс, после фонового fill 6 мс — транспортный таймаут не воспроизводится, поэтому подсистема прогрева задач не добавлялась. Сделано: `fuseRankings` отдаёт `bm25Score`/`vectorScore` всегда числом (`0`, если канала не было — `undefined` выпадал из JSON), а `toRanked` на границе инструмента доводит и чисто лексический скан (`bm25Score ?? score`, `vectorScore ?? 0`), поэтому поля есть и без векторного адаптера; ответ файлового скана размечен по состоянию индекса — `indexing` + `retryAfterMs` при идущем fill, `indexing` + `needsReindex` при `dirty`/ошибке fill, маркеров нет при выключенном или полном индексе; корпус больше `SEARCH_SCAN_MAX_TASKS` (по умолчанию 2000, читается лениво) при идущем fill не сканируется, а возвращает `{ok:false, error:{code:'INDEXING', details:{retryAfterMs}}}`; `type`-фильтр остаётся на файловом пути без `INDEXING`. Тесты `tests/search-tasks-warmup.test.ts` (7): на базе RED по заявленным дельтам, после правок 7/7, revert-check 4 мутации RED; `tests/search-fts.test.ts` 36/36; полный прогон 292 файла / 3415 тестов зелёный. Решение — `docs/dev-cycle/decisions/2026-11-09-1135-ac05-search-status.md`. |

### Подпункты AC-03 (разбиение 2026-11-08)

> Решение о разбиении — `docs/dev-cycle/decisions/2026-11-08-1745-ac-03a.md`. Подпункты не входят в счёт «Итого»:
> `scripts/check-backlog.mjs` считает только ID вида `PREFIX-NNN`, а AC-03 закрывается, когда done все три.

| ID | Инкремент | Статус | DoD (исполняемая проверка) |
|----|-----------|--------|----------------------------|
| AC-03a | `meta.ms` в каждом конверте, `tasks_list` по `ids` и `codes`, `tools_list` с `limit` до 300 | done | `npx vitest run tests/response-filters.test.ts`; pass — у успешного и ошибочного ответа `meta.ms` — неотрицательное число, `tasks_list({ids})` возвращает ровно запрошенные задачи, `{codes}` находит задачу по тегу без учёта регистра, `tools_list({limit:200})` отдаёт все 128 инструментов без второй страницы. Реализовано (2026-11-08): `request-context.ts` хранит `startedAt` вызова, `wrapToolHandler` его пишет, `respond.ts::json()` добавляет `meta.ms` во все конверты (`ok`/`okWith`/`err`/`errWith`), единственный ручной конверт в `bulk.ts` переведён на `ok()`; `tasks_list` получил `ids` (до 500, чтение по id) и `codes` (совпадение с тегами задачи, регистронезависимо); `ToolRegistry.list` и `tools_list` подняли предел страницы до 300 |
| AC-03b | `tasks_dag`: фильтры `tag`, `limit`, `fields`, `onlyWithDeps`, `truncated` и курсор | done | `npx vitest run tests/response-filters.test.ts` (часть 2) плюс замер `tasks_dag` на проекте не меньше 240 задач: отфильтрованный ответ не больше 8 КБ и содержит `truncated` с курсором; `edges`/`topologicalOrder`/`criticalPath` согласованы с выданной страницей. Реализовано (2026-11-08): `tag` и `onlyWithDeps` (узел с `dependsOn` **или** цель чьей-то зависимости) фильтруют набор, граф считается по всему набору, а ответ — страница топологического порядка (`limit` по умолчанию 200, `cursor`, `fields`, `maxBytes`); `edges` и `criticalPath` содержат только узлы страницы, `criticalPathTruncated` сообщает об усечении пути, счётчики считаются по видимому набору. `fields` проецирует и `topologicalOrder`, и `criticalPath`. `maxBytes` — явный бюджет на весь конверт: при превышении страница уменьшается и пересчитываются рёбра/путь. Тесты: 6 новых на 240-задачном проекте (60 в цепочке с тегом `perf`), из них замер фактического текста ответа с `maxBytes: 8192` ≤ 8192 байт. Revert-check 3 мутации RED |
| AC-03c | `fields` и `compact` у write-инструментов задач и знаний | done | `npx vitest run tests/response-filters.test.ts` (часть 3); pass — ответ `tasks_create` с `fields:['id']` не больше 120 байт, `compact:true` даёт минимальный набор полей, полный ответ без флагов не меняется. Реализовано (2026-11-08): `src/register/write-response.ts` — общие аргументы `fields`/`compact`, наборы `COMPACT_TASK_FIELDS`/`COMPACT_DOC_FIELDS` (`id,title,status,priority,updatedAt` / `id,title,type,updatedAt`) и `projectTask`/`projectDoc`; покрыты `tasks_create`, `tasks_update`, `tasks_set_deps`, `tasks_bulk_create`, `tasks_bulk_update`, `knowledge_bulk_create`, `knowledge_bulk_update`. Импорты (`knowledge_import_*`) не покрыты осознанно: у них своя форма ответа. Аргументы объявлены в схемах (после AC-01 неизвестный аргумент — ошибка). Тесты: 5 новых; `tasks_create` с `fields:['id']` — 116 байт фактического текста. Revert-check 3 мутации RED |

### Подпункты AC-04 (разбиение 2026-11-08)

> Решение о разбиении — `docs/dev-cycle/decisions/2026-11-08-1850-ac-04a.md`. Подпункты вне счётчика
> «Итого»; AC-04 закрыт (a/b/c), AC-04d — доработка после приёмки, AC-04e — кандидаты на живую проверку.

| ID | Инкремент | Статус | DoD (исполняемая проверка) |
|----|-----------|--------|----------------------------|
| AC-04a | Конверт ошибки и `requestId` в `tools_run`/`tools_batch` | done | `npx vitest run tests/tools-run-errors.test.ts`; pass — вложенный отказ приходит с исходным `code`, `hint`, `details` и uuid-`requestId`, тот же id есть в логе (`module: tools-run`, поля `requestId`/`tool`/`code`), успешный вызов тоже несёт `requestId`, `errorText` сохраняет прежнее строковое значение, `stopOnError` не сломан. Реализовано (2026-11-08): модуль `src/core/tools-diagnostics.ts` (разбор конверта, нормализация ошибки, лог, `innerResult`/`innerFailure`), `TOOLS_DISABLED`/`TOOL_NOT_FOUND` с подсказками, экспорт `diagnosticsLog` для проверки строки лога. Revert-check 3 мутации RED |
| AC-04b | `tool_schema` отдаёт настоящую `inputSchema` | done | `npx vitest run tests/tool-schema.test.ts`; pass — `tool_schema('tasks_bulk_create')` содержит путь `inputSchema.properties.items.items.properties.title`, заглушка `example` остаётся только в поле `example` для нескалярных аргументов, `required`/`properties` совпадают с протокольным `tools/list`; fallback-схема сохраняет имена и `required` и помечена `x-schema-source: fallback`. Реализовано (2026-11-08): `src/core/tool-schema.ts` — ленивая загрузка `toJsonSchemaCompat` из SDK по абсолютному пути (подъём до корня пакета, `pathToFileURL`), конвертация вкусом схемы (`_zod` → v4, иначе v3), `minimalInputSchema` как fallback, кэш по `name` + версии реестра. Тесты: 5 (включая обход всех 128 инструментов). Revert-check 2 мутации RED |
| AC-04c | Read-only хвост лога с вычисткой секретов | done | `npx vitest run tests/log-tail.test.ts`; pass — инструмент отдаёт последние N строк файла лога, JWT/токены/пароли маскируются, файл не меняется; решение о файловом синке и ротации записано. Реализовано (2026-11-08): файловый синк опционален (`LOG_FILE`, пишет и в stderr, и в файл; относительный путь от `DATA_DIR`), ротация 10 МБ × 3 с `LOG_ROTATE_BYTES`/`LOG_ROTATE_KEEP`; `logs_tail` читает последние 256 КБ, отдаёт ≤ `lines` (200) и ≤ `maxBytes` (64 КБ), фильтрует по уровню (не-JSON строки сохраняются), маскирует JWT/bearer/`ghp_`/`sk-`/поля `password`/`token`/`secret`/`apiKey`; без `LOG_FILE` — `LOG_FILE_DISABLED` с подсказкой. Новый инструмент: счёт 129/131/133, обновлены `tools.md`, `README.md`, контракт в AGENTS.md, `api-reference.md`. Тесты: 8; revert-check 3 мутации RED |
| AC-04d | Вложенные `params` валидируются схемой инструмента; `logs_tail` закрывает классы секретов | done | `npx vitest run tests/tools-run-errors.test.ts tests/log-tail.test.ts`; pass — `tools_run{tasks_create,{project}}` без `title` и `tasks_bulk_create items:[{}]` дают `VALIDATION_ERROR` с путями `title` / `items[0].title`, `requestId` и подсказкой, файл задачи не создан; `logs_tail` маскирует Basic-авторизацию в поле `authorization`, `?token=`/`?password=`, `user:pass@host`, `MCP_LOGIN_PASSWORD=`/`MCP_PROXY_TOKEN=`, `AKIA…`, PEM `PRIVATE KEY`, camelCase/дефисные ключи (`clientSecret`, `authToken`, `x-api-key`), `password=…&user=`, а hex-хэш и uuid не трогает. Реализовано (2026-11-08): `validateNestedParams` в `src/core/tool-arguments.ts` проверяет `params` той же loose-схемой до handler в `tools_run`/`tools_batch` (loose — чтобы `UNKNOWN_PARAM` остался достижим), отказ идёт через `innerFailure`, брошенная классифицированная ошибка сохраняет `code`; `SECRET_PATTERNS` в `src/core/log-file.ts` расширены. Тесты: 4 в `tests/tools-run-errors.test.ts` и таблица 12+7 в `tests/log-tail.test.ts`. Revert-check: 1 мутация валидации и 3 мутации паттернов RED; живая проба на копии `/data` — 0 новых файлов. |
| AC-04e | Кандидаты диагностики после AC-04: живая проверка, затем фикс | pending | **Кандидаты не воспроизведены — сначала живая проверка на текущем master; без воспроизведения не править.** (1) сквозной `requestId` для прямых вызовов: id есть только у вложенных (`src/core/tools-diagnostics.ts`), `src/utils/respond.ts` его не несёт; (2) `logs_tail` не фильтрует по `requestId`, хотя сценарий AC-04a — «найти строку по id»; (3) читается только активный файл, `.1`/`.2` недостижимы, `truncated` не сообщает, что запись уехала в ротацию; (4) `project` в `logs_tail` принимается и игнорируется (`src/register/logs.ts:46-47`) — мёртвый параметр и межпроектная выдача. Проверка каждого — живой вызов с файловым логом; pass — дефект воспроизведён и закрыт тестом, fail — не воспроизводится (закрыть пункт с записью в решении). Пятый кандидат (брошенный `ToolError` терял `code`) закрыт в AC-04d вместе с правкой того же catch. |

### Подпункты SC-03 (разбиение 2026-11-08)

> Решение о разбиении — `docs/dev-cycle/decisions/2026-11-08-2000-sc-03a.md`. Подпункты вне счётчика
> «Итого»; SC-03 закрывается, когда done все три.

| ID | Инкремент | Статус | DoD (исполняемая проверка) |
|----|-----------|--------|----------------------------|
| SC-03a | Хранилище FTS5-индекса | done | `npx vitest run tests/search-fts.test.ts`; pass — индекс хранит наши термы (`tokenize()` из BM25: camelCase/snake_case, акронимы, тикеты, русский), запрос находит по внутреннему сегменту идентификатора и по префиксу (`auth` → `authentication`), фильтры `kind`/`project`, upsert перезаписывает термы, `remove`/`rebuild`, счётчики по видам, несовпадение версии схемы пересоздаёт таблицу. Реализовано (2026-11-08): `src/search/fts-index.ts` (`FtsSearchIndex.open`/`.inMemory`, `upsert`, `remove`, `rebuild`, `query`, `stats`, `search_meta` с версией), `tokenize` экспортирован. Тесты: 16. Revert-check 4 мутации RED |
| SC-03a2 | Измерение «хранилище» в индексе | done | `npx vitest run tests/search-fts.test.ts` (часть 2); pass — одинаковые `project`/`id` в двух хранилищах не смешиваются, `stats(store)`/`stores()` считают по хранилищам, `remove`/`clearStore` не задевают соседнее, `resolveStoreId` нормализует путь. Реализовано (2026-11-08): ключ `(store, kind, id)`, `resolveStoreId(root)` (абсолютный путь, нижний регистр на Windows), `remove(store,kind,id)`, `clearStore(store)`, `stats(store)`, `stores()`; схема FTS → v2. Причина: `MCP_TASK_DIR`/`MCP_KNOWLEDGE_DIR` вне `DATA_DIR`, legacy `DATA_DIR/mcp/*`, legacy-id из имён файлов. Revert-check 3 мутации RED |
| SC-03b | Индекс пишется при мутациях | done | `npx vitest run tests/search-fts.test.ts` (часть 2); pass — `tasks_create`/`tasks_update`/`knowledge_bulk_*` обновляют термы (старый терм пропадает), удалённая задача/документ исчезает из выдачи, `reindex --verify` сообщает расхождение, `doctor` предупреждает о неполном/устаревшем индексе, индекс живёт в `.index/metadata.db`. Реализовано (2026-11-08): `src/search/fts-indexer.ts` (`setActiveFtsIndex`, `noteTaskWritten`/`noteDocWritten`, `noteTaskRemoved`/`noteDocRemoved`, `noteProjectRemoved`, `rebuildFtsIndex`), хуки в `src/storage/tasks.ts` и `src/storage/knowledge.ts` рядом с `indexTaskWrite`/`indexDocWrite` (bulk-инструменты идут через те же storage-функции), `src/projects.ts` (удаление проекта), подключение в `AppContainer` на `.index/metadata.db` под `STORAGE_INDEX`; текст — `buildTextForTask`/`buildTextForDoc`; archived/trashed удаляются, restore возвращает; сбой записи не валит мутацию, ставит `search_meta.dirty`. `index-inspect`/`reindex`/`doctor` получили FTS-секцию. Тесты: 28 в файле (8 новых). Revert-check 4 мутации RED |
| SC-03c | Поиск читает индекс | done | `npx vitest run tests/search-fts.test.ts` (часть 3) плюс `node scripts/kb-bench.mjs retrieval --mode bm25` → hit@1 ≥ 0.889 и `node scripts/bench/run-scale.mjs --data <100k> --n 100000 --only search_tasks,search_knowledge --reps 3` → `medianMs < 1000`; при отсутствии индекса — откат на in-memory BM25 Реализовано (2026-11-09): `search_tasks`/`search_knowledge` берут до 500 кандидатов из `search_fts` и ранжируют их существующим `hybridSearch`/`promoteExactMatches`; проект считается полным только при `metadata complete && !fts.dirty && rows == count(archived=0,trashed=0)`; неполный/грязный индекс — файловый скан с `source: 'scan'` и фоновым дозаполнением (`indexing: true`), `totalExact: false` при упёртом пуле. `type`-фильтр остаётся на файловом пути. `reindex --data` применяет миграции DATA_DIR (boot больше не перестраивает индекс), boot-перестройка помечает проекты complete и пересобирает FTS. Тесты: 36 в `tests/search-fts.test.ts`. Замеры и revert-check — в `docs/dev-cycle/decisions/2026-11-09-1100-sc-03c.md` |

### Подпункты Y-02 (разбиение 2026-11-09)

> Решение о разбиении — `docs/dev-cycle/decisions/2026-11-09-1030-y-02a.md`, контракты —
> ADR-009. Подпункты вне счётчика «Итого»; Y-02 закрывается, когда done все три.

| ID | Инкремент | Статус | DoD (исполняемая проверка) |
|----|-----------|--------|----------------------------|
| Y-02a | Контракты задач и знаний, файловый профиль | done | `npx vitest run tests/storage-contract.test.ts --maxWorkers=2`; pass — манифест профиля (`profile: file`, возможности) и отказ `CONFIG_MISMATCH` на чужом корне; CRUD задач и документов, фильтры и страницы **паритетны** прямым функциям `src/storage/*`, дерево паритетно `listTasksTree`, жизненный цикл archive/trash/restore/delete, claim/renew/release, версии документов и восстановление версии. Реализовано (2026-11-09): `src/storage/contracts.ts` (`TaskStore`, `DocStore`, `StorageProfile`, `StoreManifest`, `StoreError`), `src/storage/profiles/file/index.ts` (делегирование без логики, сверка корня с конфигурацией), `tests/storage-contract.test.ts` (13 тестов). Revert-check 3 мутации RED |
| Y-02b | Метаданные проекта, журнал событий, история и замки | done | `npx vitest run tests/storage-contract.test.ts --maxWorkers=2` (часть 2); pass — `ProjectStore` (создание/список/деталь/метаданные/workflow/удаление), `LockProvider` (критические секции сериализуются, замок освобождается после исключения), `HistoryProvider` (версии документа паритетны `docs.versions`, история задачи — явный `CAPABILITY_UNAVAILABLE`), `EventLogStore` (append/since/snapshot/compact). Реализовано (2026-11-09): интерфейсы в `src/storage/contracts.ts`, делегирование в `src/storage/profiles/file/index.ts` (`src/projects.ts`, `src/workflow.ts`, `src/sync/event-log.ts`, `src/fs.ts`); wire-формат не менялся, поэтому `paths` в `ProjectInfo` остаются. Тесты: 19 в файле (6 новых). Revert-check 4 мутации RED |
| Y-02c | Промпты за контрактом | done | `npx vitest run tests/storage-contract.test.ts --maxWorkers=2` (часть 3); pass — `PromptStore` (list с id+version+kind+path, get конкретной версии и последней, versions oldest-first с latest, catalog, buildItems) паритетен прямым функциям, а `src/register/helpers.ts` отдаёт те же ссылки на функции (перенос без второй копии). Реализовано (2026-11-09): `src/prompts/files.ts` (перенос `readPromptsCatalog`/`readPromptBuildItems`/`listSourceJsonFiles`/`listPromptVersions`/`findFileByIdVersion` из регистратора без изменения путей), `PromptStore` и `profile.prompts` в контрактах, `FilePromptStore` в файловом профиле. Запись промптов осталась в инструментах до Y-02e. Тесты: 24 в файле (5 новых). Revert-check 3 мутации RED |
| Y-02d | Память за контрактами | done | `npx vitest run tests/storage-contract.test.ts --maxWorkers=2` (часть 4); pass — `MemoryStore` с фабриками `temporal(storagePath)`, `profiles(storagePath)`, `layered(options)`, `session(options)`; интерфейсы `TemporalMemoryStore`/`ProfileMemoryStore`/`LayeredMemoryStore`/`SessionMemoryStore`; операции через профиль персистентны (второй экземпляр на том же пути читает то же состояние), все классы совместимы структурно. Реализовано (2026-11-09): контракты в `src/storage/contracts.ts`, `FileMemoryStore` в файловом профиле создаёт существующие классы (`TemporalGraph`, `ProfileManager`, `LayeredMemory`, `SessionMemory`); пути по-прежнему задаёт вызывающий. Тесты: 28 в файле (4 новых). Revert-check 3 мутации RED |
| Y-02e | Профиль в `AppContainer`, регистраторы без прямых импортов | pending | `npx vitest run tests/storage-contract.test.ts` (часть 5) и guard-тест: в `src/register/**` нет импортов `src/storage/*`, `src/prompts/files.js` и `src/search/fts-index.ts`; pass — регистраторы получают хранилища из контекста, все прежние тесты инструментов зелёные, wire-формат не изменился |

### Подпункты остатка этапа Y (план 2026-11-09)

> План целиком — [`docs/dev-cycle/plans/2026-11-09-y-stage.md`](docs/dev-cycle/plans/2026-11-09-y-stage.md);
> решение о плане — `docs/dev-cycle/decisions/2026-11-09-1405-y-stage-plan.md`. Подпункты вне счётчика
> «Итого»; каждый — отдельная ветка и PR. Закрытие этапа — по условию из §5 плана.

#### Y-02e — точка сборки (закрывает Y-02)

| ID | Размер | Работа | Статус | DoD |
|----|--------|--------|--------|-----|
| Y-02e1 | S | `createServerContext()` создаёт файловый `StorageProfile` и публикует в `ServerContext.storage` (поле опциональное для тест-моков); guard-тест фиксирует точный allowlist 11 регистраторов (11 файлов / 20 импортов, только сокращается) | done | `npx vitest run tests/storage-wiring.test.ts`; pass — профиль в контексте, манифест честный (profile/коллекции/возможности), roots = `resolveStoreId(TASKS_DIR\|KNOWLEDGE_DIR)`, smoke-чтение через профиль, allowlist ровно 11 файлов; мутации «профиль не публикуется», «манифест врёт», «новый прямой импорт» — RED. Реализовано (2026-11-09) |
| Y-02e2 | M | `register/tasks.ts`, `knowledge.ts`, `bulk.ts`, `markdown.ts` переходят на `ctx.storage` через `storageProfile(ctx)`; контракт `TaskStore` расширен `closeWithCascade`/`subtree`/`children`, TTL и `MAX_TASK_DEPTH` перенесены в контракт; allowlist 11 → 7 | done | `tests/storage-contract.test.ts` 31/31 (+3 на cascade/subtree/children, паритет с функциями хранилища); `tests/storage-wiring.test.ts` — allowlist ровно 7 файлов / 12 импортов; затронутые наборы 99/99; полный прогон — 17 упавших файлов идентичны базовой линии master (Windows-среда); мутации «новый прямой импорт», «не та коллекция», «TTL сломан», «cascade игнорируется» — RED. Реализовано (2026-11-09) |
| Y-02e3 | M | `prompts.ts`, `memory.ts`, `resources.ts`, `search-resources.ts`, `aliases.ts`, `helpers.ts` и найденный `mcp-prompts.ts` переходят на `ctx.storage`; `register/helpers` больше не реэкспортирует файловый доступ к промптам; allowlist 7 → 1 файл | done | `tests/storage-wiring.test.ts` 3/3: allowlist ровно 1 файл / 4 импорта + wiring-тест `tasks://current` на данных профиля; контракт 31/31; затронутые наборы (prompts/memory/resources/markdown/aliases) зелёные; полный прогон — 17 упавших файлов идентичны базовой линии master (Windows-среда); мутации «helpers снова импортирует prompts/files», «aliases читает доки» — RED. Известный пробел: fallback `ContextAssembler.searchFn` в memory не покрыт тестом. Реализовано (2026-11-09) |
| Y-02e4 | S | `SearchProvider` в контрактах, файловый профиль делегирует `fts-indexer` и metadata-индексу, `register/search.ts` на `storageProfile(ctx).search`; allowlist → 0, Y-02 закрыт | done | `tests/storage-wiring.test.ts` 3/3: allowlist **пуст** (0 файлов / 0 импортов) + профиль и wiring-тест; `tests/storage-contract.test.ts` 31/31; затронутые поисковые наборы 117/117 (`search-fts` 36, `search`, `search-tasks-warmup`, `response-filters`); мутации «прямой импорт», «пустые кандидаты», «индекс недоступен», «счётчик задач ноль» — RED. Реализовано (2026-11-09) |

#### Y-03 — разделение эмбеддингов

| ID | Размер | Работа | Статус | DoD |
|----|--------|--------|--------|-----|
| Y-03a | M | Контракты `EmbeddingProvider`, `VectorStore`, `IndexingService`, `ChunkingStrategy`, `EmbeddingFingerprint`; файловый провайдер и чанкинг делегируют текущему адаптеру | done | `npx vitest run tests/embedding-contract.test.ts` — 12/12: отпечаток стабилен и чувствителен к каждому полю, fake-адаптер доказывает делегирование и порядок батчей, незагруженный реальный адаптер отдаёт `CAPABILITY_UNAVAILABLE` вместо пустых векторов, чанкинг совпадает с `buildChunksForDoc`/`chunkText`, версия зависит от опций, `VectorStore`/`IndexingService` реализуемы fake-объектами; 4 мутации RED. Реализовано (2026-11-09): `src/search/contracts.ts` + `src/search/embeddings-file.ts`, адаптеру добавлены `isReady`/`fingerprint`/`embed` аддитивно, поведение поиска не менялось |
| Y-03b | L | Отпечаток с каждым вектором; коллекция `отпечаток + chunking + buildText`; двойное чтение без слияния score, метка коллекции в хитах, счётчики обеих коллекций в статусе | done | `npx vitest run tests/embedding-collections.test.ts` — 11/11: адресация коллекции чувствительна к трём компонентам, store держит коллекции раздельно (query/stats/collections/delete/clear), профиль пишет в caller-root, двойное чтение — активные первыми, старые только для недостающих, без дублей и без кросс-сортировки, `coverage` корректен, статус помечает активную/readOnly; 132/132 затронутых; 5 мутаций RED. Реализовано (2026-11-09): `vector-store-file.ts`, `dual-read.ts`, `embeddings-status.ts`, `StorageProfile.vectors` |
| Y-03c | M | `IndexingService`: очередь, идемпотентность по хэшу содержимого, пауза/прогресс, warmup; `embeddings_status` очередь и скорость | done | `npx vitest run tests/indexing-service.test.ts` — 11/11: холодный старт не блокирует (провайдер «зависает», вызов возвращается, статус running); векторы в адресованной коллекции; повторная индексация неизменного контента не вызывает `embedDocuments`; изменённый элемент — один; пауза сохраняет очередь, резюме доканчивает; провайдер отсутствует → `error` с сообщением; прогресс/скорость на инъецированных часах; манифест переживает рестарт; 10k в памяти (~1 с); профиль с `embeddingProvider` индексирует; статус несёт очередь. 133/133 затронутых, 6 мутаций RED. Реализовано (2026-11-09) |

#### Y-04 — внешние провайдеры эмбеддингов

| ID | Размер | Работа | Статус | DoD |
|----|--------|--------|--------|-----|
| Y-04a | M | Политика и выбор провайдера: флаг, предупреждение при старте, приватность, ключи через SecretManager, исключения private/`trustLevel external`, лимиты и стоимость; fake-провайдер, сети нет | done | `npx vitest run tests/embedding-external-policy.test.ts` — 12/12: без флага `DISABLED` и нулевые внешние вызовы, ключ читается лениво и не попадает в события, стоимость считается, лимит текстов/минуту срабатывает и восстанавливается, гейт блокирует исключённые проекты и `trustLevel=external`, индексатор не ставит заблокированное в очередь (`blocked`), ошибка провайдера → `PROVIDER_ERROR` + событие без секрета, статус `external` выключен по умолчанию; 108/108 затронутых; 7 мутаций RED. Реализовано (2026-11-09): `external-policy.ts`, `external-provider.ts`, гейт в индексаторе/профиле, `embeddings_status.external`, строка в `docs/privacy.md` |
| Y-04b | M | HTTP-провайдер (OpenAI-совместимый) за флагом: таймауты, ретраи, лимиты, отчёт стоимости; ошибка — признак деградации, не пустая выдача; документация конфигурации | done | `npx vitest run tests/embedding-external-http.test.ts` — 9/9 на локальном `node:http`: успех с Bearer-токеном и разбором векторов, батчи по `maxTextsPerRequest`, ретрай 500 → успех, таймаут вместо зависания, отказ на неверное число векторов/смену размерности, валидация конфигурации, обёртка без флага не делает запросов, с флагом ключ доходит до сервера, стоимость считается, секрет не в событиях, постоянный 503 → `PROVIDER_ERROR` + событие; 95/95 затронутых; 6 мутаций RED. Реализовано (2026-11-09): `external-http-provider.ts`, ленивый `createInner(secret)` в обёртке, выбор провайдера в `setup`, `externalEmbeddingConfigProblem` |

#### Y-05 — профиль SQLite

| ID | Размер | Работа | Статус | DoD |
|----|--------|--------|--------|-----|
| Y-05a1 | L | Гейт sqlite-vec (Node 24/Docker, результат в решение); `STORAGE_PROFILE=sqlite`; SQLite-Store для задач и документов + контрактные тесты на SQLite-фабрике | done | `npx vitest run tests/storage-sqlite.test.ts tests/sqlite-vec-gate.test.ts` — 18/18: гейт Node 24.22.2 / SQLite 3.53.2 / FTS5 / sqlite-vec 0.1.9 загружается и vec0 ищет; выбор профиля (`file` по умолчанию, `sqlite`, ошибка на неизвестном, обязательный `databasePath`); задачи CRUD/фильтры/жизненный цикл/пагинация с курсором/tree/subtree/cascade/персистентность; документы CRUD/page/lifecycle, list без content; заглушки → `CAPABILITY_UNAVAILABLE`; 69/69 затронутых; 6 мутаций RED. Реализовано (2026-11-09): `profiles/sqlite/*`, `profile-select.ts`, выбор в `setup.ts`, `sqlite-vec@0.1.9` в dependencies. Ограничение: Docker-проверка — Y-05c |
| Y-05a2 | M | SQLite-Store для проектов и истории версий документов; манифест расширяется честно; остальные коллекции — Y-05a3/Y-05b | done | `npx vitest run tests/storage-sqlite.test.ts` — 19/19: проекты create/list/detail/updateMetadata/workflow(default и кастомный)/remove(force и отказ)/дубликаты/невалидный id; история — версии при create/update, restore снапшота новой версией, отсутствующая версия → null, task history → `CAPABILITY_UNAVAILABLE`; манифест `[tasks,docs,projects,history]`, capabilities.history=true. 51/51 затронутых; 6 мутаций RED. Реализовано (2026-11-09). Ограничения записаны: `ProjectInfo.paths` в SQLite — пустые строки (wire-формат не менялся); промпты/память требуют отдельного решения (источник истины — файлы) → Y-05a3 |
| Y-05a3 | M | SQLite: события (`EventLogStore`) и замки (`LockProvider`); промпты/память — через существующие реализации с записанным ограничением | done | `npx vitest run tests/storage-sqlite.test.ts` — 25/25: события append/дельта/лимит/персистентность, компакция в снапшоты и GC, неубывающий `eventId`; замки — сериализация конкурентных секций, освобождение при исключении, таймаут против второго соединения; промпты/память делегируются и не отвечают `CAPABILITY_UNAVAILABLE`; манифест `[tasks,docs,projects,history,prompts,memory,events,locks]`. 63/63 затронутых; 5 мутаций RED. Реализовано (2026-11-10): таблицы events/snapshots/locks, экспорт FilePromptStore/FileMemoryStore. Ограничение: промпты/память — файловые по природе (wire `PromptRecord.path`), нативный SQLite для них — отдельный ADR |
| Y-05b1 | L | SQLite: `SearchProvider` на FTS5 в той же БД — тексты из общих `buildTextForTask/Doc`, живое сопровождение индекса, dirty/fillState/ensureIndexed, кандидаты по bm25, `countTasks` | done | `npx vitest run tests/storage-sqlite.test.ts` — 28/28: доступность, `isIndexComplete` до/после `ensureIndexed`, кандидаты по задачам и документам, изоляция проектов, `countTasks`, archive/restore/update/delete в индексе, `fillState=complete`, персистентность индекса между перезапусками; `capabilities.fullText=true`; 62/62 затронутых; 5 мутаций RED. Реализовано (2026-11-10) |
| Y-05b2 | L | `SearchProvider` SQLite (FTS5, качество ≥ baseline), `VectorProvider` (sqlite-vec или объявленная недоступность с откатом), `HistoryProvider` (таблица версий), `LockProvider` (транзакции) | done | `tests/search-fts.test.ts` + `tests/storage-sqlite.test.ts`: контракт SearchProvider, hit@1 ≥ baseline, векторный канал — контракт либо явный `CAPABILITY_UNAVAILABLE` с признаком |
| Y-05c | M | Диагностика и обслуживание SQLite-профиля (`doctor`/`reindex`), бенчмарк file vs sqlite на 100k, документация | done | `tests/storage-sqlite.test.ts` (часть 2): `doctor` показывает профиль и возможности, `reindex` работает, бенчмарк записан в `docs/benchmarks/`, конфигурация описана |

#### Y-07 — BlobProvider

| ID | Размер | Работа | Статус | DoD |
|----|--------|--------|--------|-----|
| Y-07a | S | Контракт `BlobProvider` (put/get/delete/list/size) и файловая реализация | done | `tests/blob-provider.test.ts`: файловый провайдер проходит контракт, запись идемпотентна, отсутствующий ключ → `NOT_FOUND` |
| Y-07b | M | S3/MinIO адаптер (SigV4 без новой зависимости), тот же контракт; прогон против MinIO в CI | done | `tests/blob-provider.test.ts` (часть 2): оба провайдера проходят один набор; MinIO только для вложений/экспортов/копий |

#### Y-06 — профиль Postgres

| ID | Размер | Работа | Статус | DoD |
|----|--------|--------|--------|-----|
| Y-06a1 | L | Postgres Store-коллекции: задачи/документы/проекты/история/события/замки на JSONB, схема и пул, `STORAGE_PROFILE=postgres` и `POSTGRES_URL`; контрактные тесты против реального PostgreSQL 18.6 | done | `tests/storage-postgres.test.ts` 12/12 на настоящем Postgres; затронутые наборы 97/97; 6 мутаций RED |
| Y-06a2 | M | Postgres `SearchProvider`: `tsvector` + `pg_trgm` с async-адаптером под синхронный контракт, обновление индекса на мутациях, parity кандидатов | done | Поиск не меняет ответы инструментов; контрактные тесты на Postgres; мутации RED |
| Y-06b | L | `VectorProvider` Postgres (pgvector + HNSW после гейта), оптимистичные версии (MU-02), связь с MU-01 | done | `tests/storage-postgres.test.ts` (часть 2): векторный контракт, конфликт версий → `CONFLICT`, HNSW используется (план запроса) |

#### Y-08 — migrate-storage (закрывает этап Y)

| ID | Размер | Работа | Статус | DoD |
|----|--------|--------|--------|-----|
| Y-08a | L | Движок миграции по фазам ADR (dry-run → снимок → дельта в эксклюзивной секции → переключение → проверка → уборка), file↔sqlite; расхождения и контрольные суммы; замер окна паузы 100k | done | `tests/storage-migrate.test.ts`: dry-run не мутирует, повторный запуск идемпотентен, откат = возврат конфигурации, отчёт с расхождениями, окно измерено |
| Y-08b | M | Миграция в/из Postgres, runbook и отчёт; проверка на 100k или документированное ограничение среды | done | `tests/storage-migrate.test.ts` (часть 2): Postgres как источник и цель, целостность сверена, runbook описывает шаги и откат |
> Примечание (2026-11-09, план этапа Y): 24 инкремента, порядок и гейты — в
> `docs/dev-cycle/plans/2026-11-09-y-stage.md`. Статусы подпунктов обновляются в их PR;
> «Итого» не меняется.

## Статистика бэклога

> Агент обновляет после каждого изменения.

**Последнее обновление:** 2026-11-09 (ADR-009 принят владельцем 2026-11-09: Y-01 → `done`; TS-02 → `done` после мержа PR #318; строки сводки Y и Quality приведены к фактическим (Quality не учитывала TS-01/TS-02); «Итого»: done 291 → 293, остальное без изменений. Ранее SC-02e закрыт: DoD SC-02 проверен end-to-end на реализации на 100k — `tasks_list` 28 мс, `knowledge_list` 33 мс против порога 300 мс, `index.tasksPageWithFiles` 3.98 мс против 10 мс; `SC-02` и `SC-02e` в `done`, `sqlite-index-bench --before` починен для Windows; ранее MU-09 закрыт: мост прокидывает схемы ядра без пересборки, паритет 128 из 128, `tests/proxy-schema-parity.test.ts`; ранее P-20261107-15: гейт Z-13 закрыт — `target` одним значением на промпт и скилл, Z-10..Z-12 приведены к решению, вопрос форматов claude/opencode вынесен в Z-12; ранее P-20261107-14: задачи в UI — быстрый просмотр в диалоге, страница `/tasks/<id>`, зависимости в карточке и отдельный вид DAG, метки критического пути и веса, палитра статусов и типов — этап W; контракты MCP из эксперимента с трекером — новый этап AC, находки проверены на f6a748f, часть не воспроизвелась, корень расхождения bulk-схем найден в мосте — MU-09; ранее Z-10…Z-13: целевые агенты промптов и скиллов, реестр агентов, развёртывание по allowlist с предпросмотром и откатом, гейт владельца — этап Z; DX-34: шрифты web-ui self-hosted через `next/font/local` — сборка без сети, кириллица и латиница в одном файле на начертание, страж `no-remote-fonts.test.ts`; TR-04b: openapi и markdown тесты переписаны на реальные модули, мутационная матрица; Q-017: осиротевшие серверы из тестов — общий lifecycle-хелпер с SIGTERM→SIGKILL, порты от ОС вместо фиксированных счётчиков, коннект-ошибки закрывают транспорт, глобальный страж сирот по cwd с PID и портом; Q-016: атомарный захват lock в `/devcycle` — `fs.link` вместо `wx`-записи, grace для нечитаемого lock, гвардия reclaim, release по токену; Q-015: хрупкие тесты devcycle и BM25 perf, e2e падают сразу на устаревшем dist, pre-push собирает dist; PH-016: пропуск proxy-образов в docker-build-base теперь проверяет наличие тега в GHCR; ранее 2026-11-03 — этап AA: агентский комплект — ядро по HTTP/Unix со stdio-шимами, журнал драфтов и идемпотентный синк в трекер, плагины в репозитории, `bundle.json` и `install-agent`, серверная инструкция, сверка статусов бэклога с трекером; сначала: UI-35: экран настроек проекта — статусы, переходы и типы с черновиками по вкладкам, матрицей переходов и переносом задач; UI-33: пользовательские темы — редактор из базовых цветов с AA по построению, pre-paint и импорт/экспорт; UI-14: честный realtime-индикатор; V-05: дорожки по типам и мультиселект — этап V завершён; merge origin/master с SC-01/UI-34 и долистыванием задач. Ранее: SC-01, UI-34, V-04, V-03, этап X, этапы Y/Z, UI-30..UI-32, U-06, UI-28, UI-29, DX-33, UI-26/UI-27, DX-34, V-01/V-02, UI-24 части 1–5, UI-10, UI-13, UI-22, DX-32)

| Категория | Всего | pending | in_progress | done | blocked | deferred |
|-----------|-------|---------|-------------|------|---------|----------|
| Foundation (0) | 6 | 0 | 0 | 6 | 0 | 0 |
| Transport (1) | 4 | 0 | 0 | 4 | 0 | 0 |
| Middleware & Infra | 4 | 0 | 0 | 4 | 0 | 0 |
| Sessions (2) | 5 | 0 | 0 | 5 | 0 | 0 |
| Auth (3) | 3 | 0 | 0 | 3 | 0 | 0 |
| ACL (4) | 3 | 0 | 0 | 3 | 0 | 0 |
| Proxy (5) | 4 | 0 | 0 | 4 | 0 | 0 |
| Security (8) | 6 | 0 | 0 | 6 | 0 | 0 |
| Sync (6) | 5 | 0 | 0 | 5 | 0 | 0 |
| DX (9) | 8 | 0 | 0 | 8 | 0 | 0 |
| Scalability (10) | 5 | 0 | 0 | 5 | 0 | 0 |
| Market Research | 14 | 0 | 0 | 14 | 0 | 0 |
| Tech Debt | 14 | 0 | 0 | 13 | 0 | 1 |
| Quality | 18 | 1 | 3 | 14 | 0 | 0 |
| Docs | 5 | 0 | 0 | 5 | 0 | 0 |
| Agent Infra | 16 | 0 | 0 | 16 | 0 | 0 |
| Skills (A) | 6 | 0 | 0 | 6 | 0 | 0 |
| Rules (B) | 6 | 0 | 0 | 6 | 0 | 0 |
| Workflows (C) | 6 | 0 | 0 | 6 | 0 | 0 |
| Memory (D) | 4 | 0 | 0 | 4 | 0 | 0 |
| Integration Hub (E) | 8 | 2 | 0 | 6 | 0 | 0 |
| Web UI (13) | 7 | 0 | 0 | 7 | 0 | 0 |
| OpenCode Integration (F) | 8 | 0 | 0 | 8 | 0 | 0 |
| Behavioral Memory (G) | 14 | 0 | 0 | 14 | 0 | 0 |
| Competitive Edge (H) | 22 | 0 | 0 | 22 | 0 | 0 |
| Wire-in (I) | 10 | 0 | 0 | 10 | 0 | 0 |
| NEXT2 (J) | 8 | 0 | 0 | 8 | 0 | 0 |
| Full-server E2E (K) | 1 | 0 | 0 | 1 | 0 | 0 |
| Prod Hardening (L) | 15 | 3 | 1 | 11 | 0 | 0 |
| Audit request-path (M) | 18 | 17 | 0 | 0 | 1 | 0 |
| DX/Onboarding (N) | 26 | 16 | 1 | 5 | 4 | 0 |
| Trust/Hardening (O) | 23 | 12 | 3 | 2 | 6 | 0 |
| MCP spec compliance (P) | 12 | 8 | 0 | 2 | 2 | 0 |
| KB hardening (Q) | 7 | 0 | 0 | 6 | 1 | 0 |
| Multi-user integrity (R) | 9 | 3 | 0 | 3 | 3 | 0 |
| YouTrack-level tracker (S) | 5 | 4 | 0 | 0 | 1 | 0 |
| Team work and wiki (T) | 6 | 6 | 0 | 0 | 0 | 0 |
| Agent convenience (U) | 6 | 5 | 0 | 1 | 0 | 0 |
| Workflow and boards (V) | 5 | 0 | 0 | 5 | 0 | 0 |
| Admin UI design and UX (W) | 31 | 19 | 0 | 11 | 1 | 0 |
| Scaling (X) | 8 | 5 | 0 | 2 | 1 | 0 |
| Pluggable storage (Y) | 9 | 9 | 0 | 0 | 0 | 0 |
| Skills and packages (Z) | 13 | 11 | 0 | 2 | 0 | 0 |
| Agent bundle (AA) | 9 | 7 | 0 | 0 | 2 | 0 |
| Compact mode and agent instructions (AB) | 6 | 6 | 0 | 0 | 0 | 0 |
| MCP contracts (AC) | 5 | 1 | 0 | 4 | 0 | 0 |
| **Итого** | **428** | **70** | **7** | **328** | **22** | **1** |

> Примечание (2026-09-04): сводка приведена к фактическим строкам.
> Примечание (2026-09-11): Этап M (AUD-01..18), Этап N (DX-10..29), Этап O
> (TR-01..13) и Этап P (SPEC-01..10) добавлены постфактум — 64 pending.
> `npm run backlog:check` green.
> Примечание (2026-11-03): разметка гейтов готовности — 23 пункта переведены в `blocked`
> (проработка design/research/spec и гейты владельца), см. раздел «Статусы». Ещё 2 пункта
> (`AUD-18d`, `AUD-18e`) переведены в `blocked` вне счётчика: валидатор не считает ID с буквенным суффиксом.
> Примечание (2026-11-06): TR-04a закрыт, но остаётся вне счётчика по той же причине — «Итого» не меняется.
> Примечание (2026-11-07): TR-04c закрыт, но остаётся вне счётчика по той же причине (ID с буквенным суффиксом) — «Итого» не меняется.
> Примечание (2026-11-07): добавлен этап AB (CM-01..CM-06) по обсуждению compact-режима; все шесть пунктов
> `pending`, гейты владельца и проработка вынесены в колонку зависимостей — очередь их пропускает по правилам
> `tick.md`, без перевода в `blocked`. «Итого»: 405 → 411, pending 93 → 99.
> Примечание (2026-11-07): P-20261107-14 добавил этап AC (AC-01..AC-05, все `pending`) и пункты
> W `UI-36..UI-40`; «Итого» 415 → 425, pending 102 → 112. Находки эксперимента проверены на `origin/master`
> f6a748f клиентом MCP SDK; три утверждения не воспроизвелись (обязательные поля схем `*_bulk_*`,
> частичный патч `tasks_bulk_update`, `internal error` из `tools_run`) и в тексте пунктов прямо помечены.
> Ссылка эксперимента на `Q-016` ошибочна: в этом файле `Q-016` — атомарный lock в `/devcycle`, к
> `tasks_set_deps` он отношения не имеет.
> Примечание (2026-11-07, доработка): корень жалобы «`tasks_bulk_create` требует все 7 полей» найден в мосте,
> а не в ядре, — добавлен `MU-09` (этап R), «Итого» 425 → 426, pending 112 → 113. Из списка
> нерепродуцируемых находок она исключена: ядро публикует обязательным только `title`, вложенные `required`
> теряет `jsonSchemaToZod`; `AC-01` переведён в `medium`, ссылается на `MU-09` и держит только дефекты ядра
> (`parentId: ""`, молчаливо игнорируемые параметры).
> Примечание (2026-11-07, MU-09): мост переведён с пересборки схем в zod на прокидывание результата ядра
> (`src/proxy/passthrough.ts`), паритет `tools/list` 128 из 128 и `resources/templates/list` 14 из 14
> подтверждён `tests/proxy-schema-parity.test.ts`; пункт переведён в `done`, «Итого» 426 без изменений,
> pending 113 → 112, done 283 → 284.
> Примечание (2026-11-08, SC-02e): обе DoD-команды прогнаны на реализации (не на прототипе) на 100k:
> `tasks_list` 28 мс / 32 789 B, `knowledge_list` 33 мс / 22 068 B против порога 300 мс / 1 MiB,
> `index.tasksPageWithFiles` 3.98 мс против 10 мс — `docs/benchmarks/sc02-2026-11-07.md` §8.
> `SC-02e` переведён в `done` (вне счётчика: буквенный суффикс), `SC-02` — в `done`,
> «Итого» 426 без изменений, pending 112 → 111, done 284 → 285. Заодно исправлен `--before`
> в `sqlite-index-bench.mjs` (ESM-импорт абсолютного пути на Windows падал), записаны две
> платформенные находки: синхронный `rebuild()` на первом старте и устаревший `.server.lock`.
> Примечание (2026-11-08, SC-02d): `doctor` получил секцию `Index:` и восемь предупреждений о
> расхождениях индекса (сироты, пропуски, дрейф `mtime`, `file_count`, `dirty`, схема, чужой
> `data_dir`, неполные проекты), появилась команда `reindex [--project] [--verify] [--force]`,
> `.index` исключён из архива бэкапа, полный `rebuild` помечает проекты полными. Подпункт вне
> счётчика (буквенный суффикс), «Итого» не меняется. Замер: `reindex --verify` 10.4 с на 100k,
> полный `reindex --force` 128.3 с на 200 000 строк.
> Массовые мержи 2026-09-04: WIRE-007/008/009, SEC-003, NEXT2-003/004/005/007/008,
> NEXT-011/012/013/015/016, NEXT2-009/010/012, Q-014 слайсы 1-14.
> Примечание (2026-11-08, AC-01): аргументы инструментов приведены к контракту — неизвестный
> параметр возвращает UNKNOWN_PARAM с подсказкой (`tags` → `tag`) вместо молчаливого игнорирования,
> пустая строка (parentId: "") больше не пишется в файл и снимает родителя при update,
> контрактный тест сверяет опубликованную схему с Zod-опциональностью всех инструментов.
> Пункт вне подпунктов, «Итого» 426 без изменений: pending 111 → 110, done 285 → 286.
> Примечание (2026-11-08, AC-02): счётчики стали честными — `countOnly` отдаёт `count === total`
> (раньше `count: 0` рядом с `total: 10`), `search_tasks`/`search_knowledge` при усечённом
> ранжировании помечают ответ `totalExact: false` и называют `candidates`, вместо того чтобы
> выдавать 50 кандидатов за «ровно 50 совпадений». `tasks_set_deps` говорит на одном языке:
> `task`, `statusChanged`, `blockedByDeps`, `blockingDeps`; слова `blocked`/`unblocked` из поля
> `status` убраны, автоперевод остался прежним и вынесен в флаг `markBlocked`.
> «Итого» 426 без изменений: pending 110 → 109, done 286 → 287.
> Примечание (2026-11-08, AC-03a): часть AC-03 закрыта — `meta.ms` появился в каждом конверте
> (успех и ошибка), `tasks_list` умеет `ids` и `codes`, `tools_list` отдаёт до 300 инструментов
> одной страницей. Пункт AC-03 остаётся `pending` до AC-03b/AC-03c, «Итого» не меняется.
> Примечание (2026-11-08, AC-03b): `tasks_dag` отдаёт страницу графа, а не весь граф —
> фильтры `tag`/`onlyWithDeps`, `limit` (по умолчанию 200), курсор, `fields`, `maxBytes`;
> рёбра и критический путь согласованы со страницей (`criticalPathTruncated` при усечении).
> Изменение поведения для проектов >200 задач: полный `topologicalOrder` больше не приходит
> без курсора. Пункт AC-03 остаётся `pending` до AC-03c, «Итого» не меняется.
> Примечание (2026-11-08, AC-03c и закрытие AC-03): write-инструменты принимают `fields` и
> `compact` (минимальный набор фиксирован в коде), ответ `tasks_create` с `fields:['id']` —
> 116 байт; без флагов ответ прежний. Все три подпункта AC-03 влиты, пункт AC-03 закрыт:
> «Итого» 426 без изменений, pending 109 → 108, done 287 → 288.
> Примечание (2026-11-08, AC-04a): `tools_run`/`tools_batch` больше не теряют конверт ошибки —
> `code`/`hint`/`details` доходят до клиента, у каждого вложенного вызова есть `requestId`,
> и он же пишется в лог. AC-04 разбит на a/b/c и остаётся `pending` до AC-04b/AC-04c,
> «Итого» не меняется.
> Примечание (2026-11-08, AC-04b): `tool_schema` публикует настоящую JSON Schema, а не сырой
> Zod-shape; заглушка `"example"` осталась только в примере. Осталось AC-04c (хвост лога).
> «Итого» не меняется: пункт вне счётчика.
> Примечание (2026-11-08, AC-04c и закрытие AC-04): файловый синк лога опционален (`LOG_FILE`),
> новый read-only инструмент `logs_tail` маскирует секреты; счёт инструментов 129/131/133.
> Все три подпункта AC-04 влиты, пункт AC-04 закрыт: «Итого» 426 без изменений,
> pending 108 → 107, done 288 → 289.
> Примечание (2026-11-08, AC-04d): доработка после приёмки AC-04 — `tools_run`/`tools_batch`
> валидируют `params` схемой инструмента (без `title` задача больше не создаётся, отказ несёт
> `VALIDATION_ERROR`, `requestId` и пути проблем), `logs_tail` закрывает Basic/URL-query/
> `user:pass@host`/env/AKIA/PEM/camelCase-классы. «Итого» не меняется: пункт вне счётчика.
> Примечание (2026-11-08, AC-04e): четыре кандидата по корреляции и границам `logs_tail`
> записаны как `pending` без реализации — они не воспроизведены; сначала живая проверка.
> Примечание (2026-11-08, SC-03a): добавлено хранилище FTS5-индекса; read-путь пока не тронут,
> поэтому поведение поиска не меняется. SC-03 разбит на a/b/c и остаётся `pending`,
> «Итого» не меняется.
> Примечание (2026-11-08, SC-03a2): в индексе появилось измерение `store` — проект умеет
> держать несколько хранилищ (`MCP_TASK_DIR`/`MCP_KNOWLEDGE_DIR`, legacy `DATA_DIR/mcp/*`),
> и ключ `(store, kind, id)` не даёт им смешаться. Схема FTS → v2; read-путь по-прежнему не
> тронут, SC-03 остаётся `pending`.
> Примечание (2026-11-08, Y-01): ADR-009 записан
> (`docs/adr/0009-pluggable-storage-and-embeddings.md`, статус Proposed, приёмка за владельцем),
> пункт переведён в `review` до мержа PR. Статус `review` не входит ни в один счётчик сводки,
> поэтому по этапу Y сумма столбцов на единицу меньше «всего», а pending уменьшился: 107 → 106.
> Примечание (2026-11-08, SC-03b): индекс FTS5 теперь пишется при мутациях storage-слоя
> (задачи, знания, удаление проекта), а `reindex`/`doctor` показывают расхождение и
> неполноту. Read-путь по-прежнему не тронут — SC-03 остаётся `pending` до SC-03c;
> «Итого» не меняется (подпункты вне счётчика).
> Примечание (2026-11-09, SC-03c): read-путь переключён на FTS5. Полнота доказывается тремя
> сторонами (metadata complete, `dirty`, равенство счётчиков без archived/trashed); иначе —
> файловый скан с `source: 'scan'` и фоновый fill. Попутно исправлен дефект SC-03a:
> `upsert` удалял строку FTS по UNINDEXED-колонкам и сканировал таблицу на каждую запись —
> 100k `reindex` шёл 26 мин без результата; теперь rowid-карта `search_fts_keys` (схема v4),
> rebuild 200k файлов за 119 с. SC-03 закрыт, «Итого» уменьшилось на единицу.
> Примечание (2026-11-09, Y-01/TS-02): ADR-009 принят владельцем 2026-11-09 — статус `Accepted`,
> решения по открытым пунктам записаны в самом ADR (7 суток удержания коллекции подтверждены,
> окно паузы записи отложено до замера Y-08). Y-01 → `done`; TS-02 смержен PR #318 → `done`.
> Оба пункта были в статусе `review`, который входит во «всего», но ни в один счётчик, поэтому
> total 428 без изменений, done 291 → 293. Y-02 остаётся `pending` и разблокирован: ADR принят.
> Примечание (2026-11-09, Y-02a): добавлены контракты задач и знаний и файловый профиль за
> ними; вызовы пока не переключены, поведение и wire-формат не менялись. Y-02 разбит на a/b/c
> и остаётся `pending`, «Итого» не меняется.
> Примечание (2026-11-09, Y-02b): за контрактами теперь метаданные проекта, журнал событий,
> история документов и замки; история задач — явный `CAPABILITY_UNAVAILABLE`. Остаток Y-02
> разбит на Y-02c (промпты и память) и Y-02d (переключение регистраторов), «Итого» не меняется.
> Примечание (2026-11-09, Y-02c): файловое чтение промптов вынесено из регистратора в
> `src/prompts/files.ts` и доступно через `PromptStore`; запись промптов переедет в Y-02e.
> Остаток Y-02: Y-02d (память) и Y-02e (переключение регистраторов), «Итого» не меняется.
> Примечание (2026-11-09, Y-02d): память (временной граф, профили, слои, сессии) доступна через
> `MemoryStore`; пути задаёт вызывающий. Остаётся Y-02e — переключение `AppContainer` и
> регистраторов, «Итого» не меняется.
> Примечание (2026-11-09, Y-02e1): профиль хранилища появился в контексте сервера
> (`createServerContext`, фабрика `AppContainer`), регистраторы пока не переключены;
> guard-тест `tests/storage-wiring.test.ts` фиксирует allowlist прямых импортов (11 файлов) и
> может только сокращаться. «Итого» не меняется.
> Примечание (2026-11-09, Y-02e2): задачи, знания, bulk и markdown-инструменты берут хранилище из
> контекста; allowlist guard-теста сокращён до 7 файлов. Остаётся Y-02e3 (`aliases`, `helpers`,
> `memory`, `prompts`, `resources`, `search-resources`, `search`) — allowlist → 0 и Y-02 закрыт.
> Примечание (2026-11-09, Y-02e3): регистраторы промптов, памяти, ресурсов и алиасов переведены на
> профиль; `mcp-prompts.ts` нашёлся транзитивно. Последний прямой импорт — `register/search.ts`,
> он уходит в Y-02e4 после Y-03a (`SearchProvider`); тогда allowlist → 0 и Y-02 закрыт.
> Примечание (2026-11-09, Y-03a): контракты эмбеддингов и чанкинга зафиксированы, файловый
> провайдер делегирует текущему адаптеру. Проводка в контекст — Y-03c, отпечаток с векторами и
> двойное чтение — Y-03b. Перед ними Y-02e4 переключает `search.ts` на `SearchProvider`.
> Примечание (2026-11-09, Y-02 закрыт): подпункты Y-02a–Y-02e4 выполнены — контракты Store,
> файловый профиль, проект/журнал/история/замки, промпты, память, точка сборки, регистраторы и
> поисковый индекс; guard-тест держит пустой allowlist прямых импортов хранилища в
> `src/register/**`. Остаток этапа Y: Y-03b/c, Y-04, Y-05, Y-06, Y-07, Y-08.
> Примечание (2026-11-09, Y-03b): коллекции векторов адресуются отпечатком, версией чанкинга и
> версией сборки текста; двойное чтение не сливает оценки и помечает источник хита; статус
> показывает обе коллекции. Остаётся Y-03c (`IndexingService`), после него Y-03 закрывается.
> Примечание (2026-11-09, Y-03 закрыт): провайдер эмбеддингов, файловое хранилище коллекций,
> двойное чтение и фоновый индексер — за контрактами; Y-03a/b/c закрыты. Остаток этапа Y:
> Y-04 (внешние провайдеры), Y-05 (SQLite), Y-06 (Postgres), Y-07 (BlobProvider), Y-08 (миграция).
> Примечание (2026-11-09, Y-04a): внешние провайдеры эмбеддингов включаются только флагом,
> исключения работают до постановки в очередь, ключи идут через SecretManager и не попадают в
> логи, статус показывает egress, декларация приватности обновлена. Остаётся Y-04b (HTTP-провайдер).
> Примечание (2026-11-09, Y-04 закрыт): внешние провайдеры эмбеддингов включаются флагом,
> исключения работают до выхода из машины, ключи — через SecretManager, HTTP-провайдер с
> таймаутами/ретраями и честной деградацией. Остаток этапа Y: Y-05 (SQLite), Y-06 (Postgres),
> Y-07 (BlobProvider), Y-08 (миграция).
> Примечание (2026-11-09, Y-05a1): SQLite-профиль поднят за теми же контрактами (задачи и документы);
> гейт sqlite-vec на Node 24 подтверждён, Docker-проверка вынесена в Y-05c. Остаток Y-05: a2 —
> остальные коллекции, b — поиск/векторы/история/замки, c — диагностика/бенчмарк.
> Примечание (2026-11-09, Y-05a2): SQLite-профиль получил проекты и историю версий; манифест
> честно объявляет `[tasks,docs,projects,history]`. Остаток Y-05: a3 — события/замки и решение по
> промптам/памяти, b — поиск/векторы/индексация, c — диагностика/бенчмарк/докер-гейт.
> Примечание (2026-11-10, Y-05a закрыт): SQLite-профиль обслуживает все коллекции Store — задачи,
> документы, проекты, историю, промпты, память, события и замки; промпты/память остаются
> файловыми по природе (ограничение записано в решении). Дальше Y-05b: SearchProvider на FTS5,
> VectorProvider на sqlite-vec, индексация; затем Y-05c — диагностика/бенчмарк/Docker-гейт.
> Примечание (2026-11-10, Y-05b1): поиск в SQLite-профиле — настоящий FTS5 в той же БД, тексты
> индекса общие с BM25-путём, индекс сопровождается живыми мутациями и пересобирается
> `ensureIndexed`. Остаток Y-05: b2 — `VectorProvider` на `sqlite-vec` (или объявленная недоступность
> с фолбэком) и проводка индексации; c — диагностика/бенчмарк/Docker-гейт.
> Примечание (2026-11-10, Y-05b2): векторы SQLite-профиля — нативные (`vector_rows` + vec0-таблицы
> на коллекцию), запрос пересчитывает точный косинус, при недоступном `sqlite-vec` — brute-force
> фолбэк; `IndexingService` подключён к SQLite через общую фабрику провайдера. Остаток Y-05: c —
> диагностика/бенчмарк/Docker-гейт.
> Примечание (2026-11-10, Y-05 закрыт): SQLite-профиль полностью за контрактами — коллекции,
> FTS5-поиск, sqlite-vec-векторы (с brute-force фолбэком), индексация, события/замки; добавлены
> `doctor`/`reindex` для профиля, бенчмарк и документация. Попутно найден и исправлен O(n²) при
> записи FTS (удаление по UNINDEXED-колонкам → карта rowid, схема v6). Docker-гейт sqlite-vec
> не выполнен из-за недоступного демона Docker — ограничение записано. Дальше этап Y: Y-07 (BlobProvider),
> Y-06 (Postgres), Y-08 (миграция).
> Примечание (2026-11-10, Y-07a): контракт `BlobProvider` (put/get/size/delete/list,
> адресация ключом, checksum, NOT_FOUND) и файловый провайдер с атомарной записью и защитой от
> выхода за root; коллекция `blobs` в манифестах обоих профилей. Остаток Y-07: b — S3/MinIO.
> Примечание (2026-11-10, Y-07 закрыт): BlobProvider — контракт + файловый провайдер (Y-07a) и
> S3/MinIO-адаптер с SigV4 без SDK (Y-07b); один контрактный набор для обоих бэкендов, MinIO-сервис в
> CI bulk-smoke, локально — документированный skip при недоступном Docker. Остаток этапа Y: Y-06
> (Postgres+pgvector) и Y-08 (migrate-storage).
>
> Примечание (2026-11-10, Y-06a1): Postgres-профиль Store-коллекций готов и проверен против
> настоящего PostgreSQL 18.6 (локальный embedded-postgres, Docker-демон недоступен). Поиск
> (tsvector+pg_trgm) вынесен в Y-06a2 из-за синхронного контракта `SearchProvider`; векторы —
> Y-06b (pgvector в окружении нет). CI-сервис Postgres не добавлен: токен без scope `workflow` —
> ограничение записано в решении.
>
> Примечание (2026-11-10, Y-06a2): Postgres `SearchProvider` — настоящий поиск на
> `tsvector`+GIN и `pg_trgm` с async-путём `candidatesAsync` (аддитивное расширение
> контракта); индекс ведётся на мутациях, `ensureIndexed` пересобирает проект; проверено на
> реальном PostgreSQL 18.6, 16/16, 126/126 затронутых. Остаток Y-06: b — pgvector/HNSW.
>
> Примечание (2026-11-10, Y-06 закрыт): Postgres-профиль полностью за контрактами — Store,
> SearchProvider (tsvector+pg_trgm), VectorProvider (pgvector/HNSW при наличии расширения, иначе
> точный cosine-фолбэк с честным `annAvailable()`). Гейт pgvector записан: расширения нет в
> локальной embedded-поставке, CI-сервис нельзя добавить без `workflow` scope; MU-02
> (оптимистичные версии) требует расширения контракта и вынесена отдельным пунктом. Остаток этапа Y:
> Y-08 (migrate-storage).
>
> Примечание (2026-11-10, Y-08a): движок миграции file↔SQLite по фазам ADR (dry-run →
> снимок цели → дельта в эксклюзивной секции → проверка контрольных сумм → отчёт), идемпотентный,
> с CLI `scripts/migrate-storage.mjs` и runbook; переносятся задачи/документы/проекты/версии/блобы.
> Замер окна паузы на 100k перенесён в Y-08b (не выдан за сделанный). Остаток Y-08: b — Postgres, runbook и 100k.
>
> Примечание (2026-11-10, Y-08 закрыт как пункт): миграция file↔sqlite↔postgres измерена на
> 100k (окно паузы 42.9 с, checksums equal), runbook обновлён. **Этап Y пока НЕ объявлен
> закрытым**: gate-условие плана §5 требует (1) один и тот же контрактный набор на трёх профилях,
> (2) `docs/benchmarks/` с hit@1/medianMs/RSS на 100k, (3) сервисные CI-прогоны Postgres/MinIO
> (заблокированы отсутствием `workflow` scope). Эти три пункта — открытый follow-up, а не
> сделанное.
>
> Примечание (2026-11-10, gate этапа Y): закрыты §5.2 (единый контрактный набор
> `tests/storage-contract-shared.test.ts` на file/sqlite/postgres, 18/18) и §5.3 (реальные
> Postgres и MinIO в CI, PR #350). Остался §5.5 — `docs/benchmarks/` с hit@1/medianMs/RSS на
> 100k для трёх профилей; после него этап Y можно закрывать. Этап пока НЕ закрыт.
>
> Примечание (2026-11-10, gate §5.5): `docs/benchmarks/` добавлены — 100k задач,
> hit@1=1.0 на всех трёх профилях; medianMs: file 213.4, sqlite 0.25, postgres 727.8; RSS:
> 355/265/99 MB. Postgres и file-латентность записаны как follow-up-оптимизации, а не спрятаны.
> Остался gate §5.6 — `doctor` должен показывать активный профиль, манифест и возможности;
> после него этап Y закрывается.
>
> Примечание (2026-11-10, **этап Y закрыт**): §5.1–§5.7 выполнены — общий контрактный набор
> на трёх профилях (#351), реальные Postgres/MinIO в CI (#350), миграция в обе стороны (Y-08a/b),
> benchmarks 100k (#352), секция профиля в doctor и обновлённая документация. Открытые follow-up'ы
> (не блокеры закрытия): производительность Postgres/file-поиска (727.8/213.4 мс), COPY/батчи
> миграции, MU-02 оптимистичные версии, pgvector/HNSW локально не проверен. Следующий этап — брать
> из очереди (high: TS-01).
>
> Примечание (2026-11-10, TS-01 done): потолок воркеров оставлен единственным источником истины
> в `vitest.config.ts`, из `npm test`/`test:coverage`/pre-push убраны CLI-переопределения;
> страж 5/5 + 3 мутации RED. Флейки: pagination 20/20, auth-session-stress 20/20 после build;
> executable-docs на Windows 20/20 красный (bash-блоки — ограничение среды, CI Linux зелёный).
> RSS без флагов: 1300/1677 МБ ≤ 8 ГБ. Полные зелёные прогоны — CI Linux (bulk-smoke #350–#353),
> локальный Windows baseline (symlink/unix/TLS/multicast/tar/devcycle) записан в решении.
>
> Примечание (2026-11-10, DX-11 done): `doctor` получил runtime health-gate — Node ≥20,
> DATA_DIR exists/writable, config (отсутствие файла = штатные env/дефолты, битый JSON = error),
> свободный порт для http/MCP_PORT, клиентские конфиги Claude Desktop/Cursor/.mcp.json (warning).
> 6/6 тестов, 3 мутации RED; интеграция в конец `setup` отложена до DX-10 (setup-команды пока нет) —
> записано в решении, а не выдано за сделанное.
>
> Примечание (2026-11-10, DX-16 закрыт): umbrella-пункт закрыт по evidence подпунктов DX-16a/DX-16b
> (`admin_backup`/`admin_restore`, формат/манифест/sha256, dry-run/applyToken/lock/prune, CLI
> `scripts/dev-cli.mjs backup|restore`, ADR-008). Нового кода не добавлялось. Локальный Windows-прогон
> DX-16 частично красный из-за системного tar без GNU `--transform` и symlink-привилегий — это
> записанный класс среды, решающий гейт — CI Linux.
>
> Примечание (2026-11-10, DX-10 done): `mcp-task-knowledge setup` детектит Claude Desktop/
> Cursor/Windsurf/VS Code/Claude Code, спрашивает transport/DATA_DIR (`--client X --yes` для CI),
> идемпотентно мержит `mcpServers` с бэкапом, делает stdio self-check (`initialize`→`tools/list`,
> live — 129 tools) и health-gate DX-11. 8/8 тестов, 4 мутации RED. Ограничение: self-check проверяет
> собранный dist, а не npx-доставку; интерактив минимален.
>
> Примечание (2026-11-10, CM-01 done): `tests/tools-run-batch-contract.test.ts` фиксирует текущее
> поведение — порядок = порядку items, default не останавливается на ошибке, `stopOnError`
> останавливает, `tools_batch` параллелен (барьер + счётчик активных, без sleep), без флага
> остановки и с лимитом 1..50. 5/5 тестов, 3 мутации RED; кода не менялось.
>
> Примечание (2026-11-10, AA-01 done): ADR `docs/adr/0010-agent-core-and-launch-modes.md`
> фиксирует модель «ядро vs клиенты» — режимы (stdio/http/tcp/unix/bridge), время жизни,
> владение DATA_DIR через `.server.lock` (MU-01), сигналы, Windows-границы и отказ от выбора
> лидера. DoD: 4 раздела `##`, lint зелёный; кода не менялось.
>
> Примечание (2026-11-10, Z-01 done): `src/skills/skill-package.ts` — `SKILL.md`+вложения,
> sha256/размеры/лимиты, безопасные относительные пути (без `..`, absolute, drive/ADS, Windows-reserved),
> symlink отклоняется, `SkillPackageStore` на файловом профиле. 12/12 тестов, 5 мутаций RED.
> Ограничение: модуль пока не подключён к SkillManager/MCP-инструментам — это следующий инкремент.
>
> Примечание (2026-11-10, CM-03a done): `instructions` генерируются из живого реестра (домены/числа),
> ≤15 строк, протокол `tools_list`→`tool_schema`→`tools_run`; выставляются в main/TCP/HTTP/bridge.
> 4/4 тестов, 3 мутации RED. CM-03 остаётся pending: живая проба Claude Code/OpenCode не получена
> (CLI зависает без рабочей agent-сессии) — вынесена в CM-03b, а не выдана за сделанную.
>
> Примечание (2026-11-10, AA-05 done): комплект OpenCode сведён в `extensions/opencode/` —
> `session-draft.ts`, сборщик драфтов, `end-session.md`, семь memory-плагинов; инвентаризация
> и все расхождения (live/ci-agent/repo) — в `docs/plugins/opencode.md`. `git ls-files` содержит
> `session-draft.ts`; 3/3 тестов, 2 мутации RED; живые копии не перезаписывались — установка описана.
>
> Примечание (2026-11-10, T-01a done): пользователи/пароли/токены в `DATA_DIR/auth.db` (scrypt,
> dummy-хеш для неизвестного, токены только sha256, revoke/expiry, bootstrap env-админа); `/auth/login`
> читает store с env-fallback. 8/8 + 11/11 тестов, 4 мутации RED. T-01 остаётся pending: админ-UI/
> MCP-инструменты и подключение токенов к `AuthManager` — T-01b.
>
> Примечание (2026-11-10, T-01b done): 8 admin-MCP-инструментов (пользователи/роли/пароль/
> disable/токены), personal-token `TokenValidator` композируется с JWT/static; 5/5 тестов,
> 3 мутации RED. T-01 остаётся pending: web-админка — T-01c (raw-токен только один раз).
>
> Примечание (2026-11-10, T-01 закрыт): T-01a (SQLite `auth.db`, scrypt+dummy, токены,
> login), T-01b (8 admin-MCP + TokenValidator), T-01c (страница `/access`: users/roles/password/
> disable, tokens create/list/revoke, raw один раз) — все сделаны. 8+11+5 тестов, 4+3 мутации RED;
> web-UI проверен tsc + design guards (33/33), браузерного e2e нет — записано. Брутфорс-лимит
> `/auth/login` сохранён (env-only и store-путь).
>
> Примечание (2026-11-10, UI-11a done): PageHeader — единственный `h1` на 12 маршрутах,
> Topbar без `h1`, skip-link/focusable main, Overview в навигации и короткая мобильная метка.
> 5/5 page-contract + 12/12 с design guards, 3 мутации RED. UI-11 остаётся pending: Playwright
> 12 маршрутов и скриншот-сравнение — UI-11b, в этом PR их нет.
>
> Примечание (2026-11-10, UI-12a done): app-level `loading.tsx` (скелетоны), `not-found.tsx`,
> `error.tsx` retry; `AppShell` → `/login?next=…&expired=1`, на `/login` баннер
> «Session expired». `states-contract` 5/5, 3 мутации RED. UI-12 остаётся pending: приоритет
> error > empty, «Сервер недоступен» + retry на 11 маршрутах и abort-сценарий — UI-12b.
>
> Примечание (2026-11-11, Z-10 done): реестр агентов в метаданных проекта (built-ins
> universal/claude/opencode + кастомные), `project_agents_get/set`; `target` у промптов и
> скиллов, missing = universal; list/search скалярный фильтр, удаление используемой цели требует
> `moveTo`/`moves`. 5/5 тестов, 3 мутации RED; api-reference 141 tools. UI и move скиллов —
> Z-12/дальше, записано.
>
> Примечание (2026-11-11, Z-02 done): `plugin.json` (name/version/components) + все файлы
> каталога; компоненты skills/commands/agents/hooks/.mcp.json проверяются по своим каталогам,
> undeclared attachments сохраняются как `other`; `exportPluginPackage` копирует staging→dest
> с sha256-сверкой, dest не перезаписывается. 5/5 тестов, 3 мутации RED. ZIP/UI/MCP-инструменты —
> отдельно (Z-03/транспорт), не выданы за сделанные.
>
> Примечание (2026-11-11, Z-04 done): все файлы пакета — `trustLevel external` и
> `enabled:false`; hooks/scripts/.mcp.json/сеть перечислены явно и по умолчанию выключены;
> активация требует именованных `allowHooks/allowScripts/allowMcp/allowNetwork`; лицензия и
> предупреждения `LICENSE_MISSING/UNDECLARED`. 5/5 тестов, 3 мутации RED. Это модель/API, не
> песочница исполнения; UI-показ — Z-03.
>
> Примечание (2026-11-11, Z-12 done): `previewAgentDeploy` (ничего не пишет, allowlist/roots,
> symlink lstat+realpath, external/delete gates) → `applyAgentDeploy` (confirm, snapshot всех
> файлов, атомарная запись) → `rollbackAgentDeploy`; MCP `agents_deploy`/rollback, apply только
> admin. 6/6 тестов, 3 мутации RED; api-reference 143 tools. Веб-админки деплоя нет, custom roots нет,
> конвертации форматов нет — записано.
>
> Примечание (2026-11-11, UI-15 done): `@playwright/test` + `@axe-core/playwright`, axe на
> 12 маршрутах (0 critical/serious) и Tab-обход /knowledge /tasks /graph; контраст — существующий
> theme.contrast 24 пары × 6. Найден и исправлен scrollable-region-focusable на /system (tabIndex+role).
> 15/15 e2e, 2 мутации RED (tabIndex off, lang off). CI web-ui запускает Playwright после build.
>
> Примечание (2026-11-11, UI-12 закрыт): AppShell gate error/Retry (11 маршрутов при abort MCP),
> error побеждает empty; expired JWT → `/login?next=…&expired=1`, после логина возврат на next.
> `states.spec.ts` 12/12, полный Playwright 27/27. До фикса offline падали 11/11, expired терял next.
> Shell-level контракт; собственные ошибки страниц отдельно не аудировались.
>
> Примечание (2026-11-11, UI-11 закрыт): `page-contract.spec.ts` — 12 маршрутов (один h1,
> активный nav, screenshot заголовка), skip-link → focused main, Overview из меню; 14/14, full
> Playwright 41/41. Baselines платформонезависимые, допуск 0.15; Linux-сравнение — CI. UI-11a + UI-11b
> закрывают DoD.
>
> Примечание (2026-11-11, UI-16 закрыт): Board/List вид (`mcp.tasksView`), таблица с сортировкой
> priority/title/status, выбор строк и массовое закрытие через `tasks_bulk_close`. 2/2 e2e,
> full Playwright 43/43; 2 мутации RED (localStorage, PRIORITY_RANK). Чипы «мои/без исполнителя/
> просроченные», сохранённые фильтры и агентские действия — после TK-01/TK-02/U-01/U-03.
>
> Примечание (2026-11-11, UI-37 закрыт + tracking fix): `/tasks/[id]` — прямой URL/reload,
> правка полей, V-02 ошибки с allowed/hint, claim/renew, destructive archive/trash, 404; 3/3 e2e,
> full Playwright 46/46; 2 мутации RED; скриншоты docs/ui/screens/ui-37. UI-11b/UI-12b помечены done
> (были влиты #374/#373, но висели pending). Ограничения: task history вне wire; SQLite-профиль не
> читает transition-граф в loadProjectWorkflow (pre-existing, на файловом/CI зелёный); DAG-страница ≤200.
>
> Примечание (2026-11-11, UI-36 закрыт): карточка открывает read-only `Dialog` (полное
> описание, тип/приоритет/теги/ссылки, dependsOn/blocks/subtasks, claim, timestamps), ноль контролов,
> Edit → `/tasks/<id>`, Esc/клик вне с возвратом фокуса. 1/1 e2e; 2 мутации RED; скриншоты
> docs/ui/screens/ui-36. Ограничения: SQLite не реализует claim и отдаёт 0 DAG-рёбер (file/CI зелёный);
> task history вне wire; глубокая цепочка — UI-38/39.
>
> Примечание (2026-11-11, UI-38 закрыт): зависимости со статусами и `isBlocked`, цепочка до
> корня, Add/Remove рёбер с серверным `DEPENDENCY_CYCLE`, отдельный `/tasks/dag` с tag/limit/
> onlyWithDeps. 1/1 e2e, full Playwright 48/48 (file). 2 мутации RED. SQLite не хранит dependsOn/DAG
> (file/CI зелёный); page-limited; поиск по загруженному списку.
>
> Примечание (2026-11-11, UI-39 закрыт): `includeGraphMetrics` на tasks_list/get —
> транзитивные `dependentsCount` (обратный BFS) и `onCriticalPath` из longest chain; UI-метки
> «Critical path»/«Blocks N» текстом+иконкой, тон N≥3 — blocked. 1/1 server-тест, component-тест
> 27/27, 2 мутации RED. SQLite не хранит dependsOn (file/CI зелёный); обычный список без флага.
>
> Примечание (2026-11-11, SC-04 закрыт): `tasks_list?groupByStatus` — 25/статус + точные
> total/typeCounts/offsets; знания — cursor-страницы 60 + Load more; 10k bench: tasks DOM
> 346 351→4 738, settled 1 308 ms; knowledge 85 869→838, 696 ms. Ограничения: bounded
> pagination, не windowing; Load more общий; facet-опции знаний/поиск ≤100.
>
> Примечание (2026-11-11, UI-25 закрыт): общий `TreeView` (role tree/group, aria-expanded),
> дерево задач в list-view с раскрытием/прогрессом/Add subtask и Parent select; Knowledge —
> List/Tree, parent select и breadcrumbs. 3/3 компонентных + 2/2 e2e; мутация aria-expanded RED.
> Ограничения: page-limited дети, parent options из загруженного, knowledge_tree читает все доки,
> поиск-путь неполный за страницей; клавиатура без roving tabindex.
>
> Примечание (2026-11-11, UI-30 закрыт): entity-панель с **Related work** (search_tasks/
> search_knowledge по 8), deep links `/graph?entity=` и `/knowledge?doc=`, кнопки Open in graph
> из задачи/документа. e2e 1/1 + 3 регрессионных; мутация substring-fallback RED. Ограничения:
> BM25-связи, по 8 результатов, только entity-узлы, неоднозначный title, текущий проект.
>
> Горячий фикс (2026-11-11, после UI-25/UI-30): `knowledge_list.rootsOnly` + ленивое дерево
> (дети по `parentId` при раскрытии, `TreeView.onExpand`) и одноразовый cross-tab auth handoff для
> редактора задачи в новой вкладке. e2e 2/2 + 3 регрессии; handoff/expired — unit 23/23.
>
> Примечание (2026-11-11, UI-31 закрыт): карточка задачи получила **Influence** — транзитивные
> блокеры/затронутые по `tasks_dag` с fallback на `tasks_get_deps`, critical path из метрик; reader
> документа — **Dependent documents** через `knowledge_list.parentId`. e2e 1/1 + документы.
> Ограничения: DAG-страница усечена, SQLite без рёбер (fallback direct), документы — один уровень.
>
> Примечание (2026-11-11, UI-17 закрыт): с `/` убрана сетка карточек-дублей меню, добавлены
> **Blocked / Claimed / Stale documents / Recent activity** с пустыми состояниями; KNOWLEDGE и теги —
> из одного `dashboard_stats`. Найден профильный баг: dashboard_stats/activity читали файловый store —
> переведены на `storageProfile(ctx)`. e2e 1/1. Виджет сроков не сделан: deadline нет (TK-01).
>
> Примечание (2026-11-11, Z-11 закрыт): промпты получили target-бейдж, серверный фильтр и
> одиночный редактор; реестр агентов — `/projects/settings/agents` (built-in/custom, save).
> e2e 1/1; prompt-edit/design guards 17/17. Z-03 остаётся: Z-01/02 не подключены к MCP read/write API.
>
> Примечание (2026-11-11, TR-33 закрыт): `connectorSignal` (`AbortSignal.timeout`, 10s,
> `CONNECTOR_TIMEOUT_MS`) подключён во все 8 коннекторов; контрактный тест 2/2, мутация RED.
