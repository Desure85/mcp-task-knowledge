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
- [x] INT-002: Jira/YouTrack connector
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
| INT-002 | Jira/YouTrack connector: синхронизация задач между mcp-task-knowledge и внешними таск-трекерами | medium | completed | #165 | INT-004 |
| INT-003 | Slack/Discord connector: уведомления, поиск, отправка сообщений из AI-агента | medium | completed | #165 | INT-004 |
| INT-005 | REST wrappers: генерация REST endpoints для MCP tools. Auto-generated OpenAPI spec. Поддержка GET/POST для tool invocation | low | completed | #170 | P-002 |
| INT-006 | gRPC wrappers: генерация gRPC service definitions для MCP tools. Protobuf schema. Streaming support | low | completed | #171 | P-002 |

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

### Фаза 5 — Расширенное покрытие (опционально)

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| PH-012 | Connector contract-тесты через mock-HTTP | low | pending | PH-006 | nock/msw-стабы GitHub/Jira/Slack API → реальные вызовы без credentials, проверка payload-маппинга и error-paths |
| PH-013 | ONNX/vector e2e job | low | pending | — | Отдельный nightly-job с `EMBEDDINGS_MODE=local`, кэш модели в CI; сейчас vector-пути только unit-спеками |
| PH-014 | WS realtime + MCP resources e2e | low | pending | PH-002 | WS relay с реальным пиром; `resources/list`, `resources/read`, `prompts/get` protocol surface |

### Фаза 6 — Web UI (GUI до ума)

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| PH-015a | CORS в http-transport | high | done | — | `MCP_CORS_ORIGIN` env (list/`*`), OPTIONS-preflight 204, `Access-Control-Expose-Headers: mcp-session-id`, foreign origin → 403. e2e в http-sessions.test.ts |
| PH-015b | api-client → SDK StreamableHTTP | high | done | PH-015a | `web-ui/lib/api-client.ts` переписан на `Client` + `StreamableHTTPClientTransport`: initialize → mcp-session-id reuse → опциональный `mcp.authenticate` (env `NEXT_PUBLIC_MCP_TOKEN` или runtime `setAuthToken` через sessionStorage). Singleton per tab, retry после failed connect |
| PH-015c | Полный MCP-стек в GUI | high | done | PH-015b | + `/projects` (list/create/set-current session-scoped), `/system` (sessions live, embeddings, tools catalog + auth token UI), tasks DAG (critical path/topo order/edges), knowledge edit-update fix (bulk_update вместо дубля create) + trash, prompts page на shared client + каталог (version/status/domain) + A/B (variants_stats + bandit_next), analytics через `dashboard_stats` с fallback, tool-имена/аргументы выверены по register-сигнатурам |
| PH-015d | web-ui тесты + CI | medium | review | PH-015b | vitest в web-ui: 35 тестов (18 realtime helpers + 14 api-client mock-SDK + 3 live env-gated `MCP_LIVE_URL`/`MCP_LIVE_JWT_SECRET` против реального сервера — проверены в docker). Workflow `web-ui.yml`: build server → web-ui typecheck → unit → live vs spawned `dist/index.js` http+JWT → next build |

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
| AUD-04 | Session hijack через session_list | high | pending | AUD-07 (admin-роль) | `session_list` отдаёт все живые session id любому аутентифицированному (register/session.ts:100); подстановка чужого `mcp-session-id` в header = имперсонация (http-transport.ts:164). Фикс: session_list/info — только своя сессия или admin-роль; биндинг session→remote при authenticate |
| AUD-05 | Expiry реально прекращает доступ | high | pending | — | `prune()` удаляет только запись SessionManager: SDK-транспорт в `adapter.sessions` жив + `authenticatedSessions` не чистится → TTL/idle/token-exp мёртвы, «закрытая» сессия работает дальше. Фикс: onClose → transport.close() + `authManager.revokeSession(id)`; гейт проверяет `sm.has(sessionId)` |
| AUD-06 | WS realtime: auth + фильтры | high | pending | — | `/ws` без auth (realtime.ts:46); клиентский `broadcast` принимает произвольные eventType/data → инъекция событий всем; клиент без project получает события всех проектов (фильтр :141). Фикс: токен при handshake, whitelist клиентских типов, no-subscription = no-events |
| AUD-07 | Завайрить security-стек | high | pending | — | Мёртвые модули (0 call sites): AuthProtection (SEC-005), InputSanitizer (SEC-006), ACLEngine (ACL-002/003, `ctx.acl` не создаётся), audit middleware (SEC-001), rule enforcement (RL-005), logging middleware (MW-003), RateLimiter.consume (S-003). Единая точка в wrapToolHandler/dispatch: protection.check → rateLimit.consume → acl.evaluate → audit. Каждая фича — e2e «реально срабатывает» |

### Фаза 3 — Medium

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| AUD-08 | HTTP body cap + session cap | medium | pending | — | POST body без лимита (http-transport.ts:167) → memory DoS; SM maxSessions обходится — transport попадает в `sessions` до `sm.create` (reject ловится, транспорт живёт). Фикс: Content-Length/maxBytes лимит; при SM-reject — transport.close() |
| AUD-09 | Unix socket: права + опциональный auth | medium | pending | — | Сокет без chmod + requireAuth=false → любой локальный юзер = полный доступ (stream-transport.ts:478, auth-gate.ts:60). Фикс: chmod 600; опционально requireAuth для unix |
| AUD-10 | tools_run/tools_batch: gated handler + scope | medium | done | — | Registry хранил raw handler → вызов без requestScope/auth/SecurityStack; исполнял tools при TOOLS_ENABLED=0. Фикс: registry хранит gated handler (setup.ts ×4 + app-container connector path через ctx.gateToolHandler), tools_run/tools_batch форвардят SDK extra (sessionId) и рефузят non-whitelist при TOOLS_ENABLED=0. Закрывает и TR-15. Тесты: tests/aud10-tools-run-gate.test.ts |
| AUD-11 | JWKS: kid-selection + cache TTL | medium | pending | — | `resolveKey()` вызывает `jwksResolver()` без (protectedHeader, token) → kid не участвует → мульти-ключевой JWKS ломает валидацию (jwt-validator.ts:398). `jwksCacheTtl` — мёртвая опция. Фикс: `jwtVerify(token, jwksResolver, opts)`, передать cacheMaxAge |
| AUD-12 | Гигиена error-сообщений | medium | pending | — | `e.message` уходит клиенту (auth-gate.ts:180, http-transport.ts:354, register/auth.ts:51) — внутренние пути/детали наружу. Фикс: наружу generic message, детали в server log |
| AUD-13 | Rate-limit на mcp.authenticate | medium | pending | AUD-07 | Брутфорс токена не ограничен; identity=sessionId → новый initialize = чистый счётчик. Фикс: AuthProtection по remote IP |

### Фаза 4 — Low

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| AUD-14 | pendingInitRemotes — per-request map | low | pending | — | FIFO-очередь мисатрибутит remote при параллельных initialize и течёт при неудачных init (http-transport.ts:60,202,265) |
| AUD-15 | revokeSession на close/prune | low | pending | AUD-05 | `authenticatedSessions` растёт бесконечно, stale marks (auth.ts:160) |
| AUD-16 | JWT blacklist: eviction по exp + persist | low | pending | — | Count-based eviction де-ревокает старые jti после 10k; рестарт снимает все ревокации (jwt-validator.ts:311) |
| AUD-17 | TLS: завайрить или дропнуть | low | pending | — | `createTlsContext`/`TlsContext` — ноль вызовов (SEC-002 мёртв, транспорты plaintext). Либо wire в http/tcp adapters, либо честно пометить deferred |

### Фаза 5 — Следующий аудит

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| AUD-18 | Аудит data-path (storage → sync → search → memory) | high | pending | — | Request-path проаудирован, data-path — нет. Тем же промптом: гонки read-modify-write в `writeJson`, crash-окна, 3-way merge в `src/sync/`, GC event-log не съедает живое, FTS5/BM25 injection, изоляция scope (tenant A vs B). Находки → новый этап задач |

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
| DX-10 | `mcp-task-knowledge setup` — интерактивный установщик | high | pending | AUD-01, AUD-03 | Бинарь в `dist/` (работает из npx): детект клиентов по конфиг-путям (Claude Desktop, Cursor, Windsurf, VS Code, Claude Code), вопросы (транспорт/DATA_DIR/auth), идемпотентный merge в `mcpServers` с бэкапом, финал — self-check: спавн stdio → `tools/list` → «✓ 114 tools» + cheatsheet. Флаг `--client X --yes` для CI |
| DX-11 | `mcp-task-knowledge doctor` — диагностика | high | pending | — | Node ≥20, DATA_DIR существует/writable, конфиг валиден, порт свободен, клиентский конфиг ссылается на живой бинарь. Это же health-gate в конце setup |
| DX-26 | CLI surface polish | low | pending | DX-10 | `--help`, `ui` (http + open browser), `config show` (эффективный конфиг: env > file > defaults), `init --demo` (seed sample-проект), `uninstall` (вычистить клиентские конфиги), actionable errors («порт занят → --port», «DATA_DIR не writable → …») |
| DX-29 | Setup-link: одноразовая ссылка самонастройки агента | high | pending | AUD-07, AUD-05, DX-12 | Web UI: «Сгенерировать ссылку» → scope (project, role, TTL токена). Backend: `POST /admin/setup-links` → `{url, expiresAt}`; `GET /.well-known/mcp-setup/<otp>` → one-time reveal markdown-док для агента: server URL, transport, выданный scoped JWT, инструкции самонастройки (агент знает формат своего клиента), capabilities, default project. Security: TTL ссылки ~15мин, one-time reveal, rate-limit redemption, audit-log на create+redeem, токен scoped (project+role+exp). Stdio-вариант: doc отдаёт npx-snippet + env. Дублировать как MCP-tool `admin_setup_link` для админов без Web UI. Спековая альтернатива — OAuth DCR, оценить при дизайне |

### Фаза 2 — Первые 5 минут после подключения

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| DX-13 | `briefing` tool — контекст одним вызовом | medium | review | — | Один вызов вместо пяти в начале сессии: текущий проект, открытые задачи по приоритету, последние knowledge-доки, блокеры. Собрано из listTasks/listDocs/isTaskBlocked. Реализовано в src/register/briefing.ts, 11 тестов green |
| DX-14 | Seed workflow-промптов в поставку | medium | pending | — | Prompts-library пуста. Шипить 5-7 готовых (`plan_sprint`, `capture_decision`, `standup`, `postmortem`, `daily_review`) — видимая ценность через `prompts/list` сразу + учит агента паттернам |
| DX-12 | `agent_bootstrap` tool — самоинтеграция агента | medium | pending | — | Tool возвращает готовый блок инструкций для AGENTS.md/system prompt («всегда передавай project, контракт ok/error, ключевые tools»). Design review до регистрации |
| DX-15 | `server_capabilities` manifest | low | pending | — | Какие домены включены/выключены env-флагами, версия, лимиты — агент не гадает и не ловит `tool not found` на выключенных фичах. Design review до регистрации |

### Фаза 3 — Данные как актив (backup/restore/integrity)

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| DX-16 | `admin_backup`/`admin_restore` — tar.gz DATA_DIR | high | pending | — | Tool + CLI-обёртка; `dev-cli export` умеет 80% — зашипить в bin, завернуть в tool. Ответ на «где мой бэкап» и «как переехать на другую машину» |
| DX-17 | `doctor --data` — скан целостности DATA_DIR | medium | pending | DX-11 | Все `*.json`/`*.md`: битый JSON, missing required fields, knowledge-сироты без проекта. Read-only отчёт + `--fix` для тривиального |
| DX-18 | Schema-version манифест + миграции | medium | pending | — | `DATA_DIR/.schema-version`; при смене формата task JSON / frontmatter — миграция при старте или явная ошибка. Иначе апгрейд пакета молча криво читает старые данные |
| DX-19 | Auto-backup перед деструктивными операциями | medium | pending | DX-16 | `project_purge`, bulk-ops, GC event-log → снапшот в `DATA_DIR/.backups/` перед выполнением. Copy дёшево, «oops» превращается в откат |

### Фаза 4 — Дистрибуция без Node.js

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| DX-20 | Single-binary PoC (Node SEA / pkg-форк) | low | pending | — | Research+PoC: `mcp-task-knowledge.exe` без требования Node ≥20. Убирает класс проблем «npm не найден / старый node / медленный npx». Риск: ONNX нативные зависимости — оценить в PoC, не обещать |
| DX-21 | Homebrew formula / Scoop manifest | low | pending | DX-20 | Если бинарь получился — генератор формулы в release CI |
| DX-22 | Cold-start stdio: lazy-load тяжёлых подсистем | medium | pending | — | Замерить время до первого ответа; ONNX/vector не тянуть на старте при `EMBEDDINGS_MODE=none`. Для stdio старт = UX каждой сессии агента; цель <500мс |
| DX-27 | Публикация в official MCP registry | medium | pending | DX-10 | `server.json` + publish в `modelcontextprotocol/servers` → установка из UI клиента без конфиг-файлов вообще. Высшая форма DX |

### Фаза 5 — Доверие и проверяемость

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| DX-23 | MCP Inspector в CI | medium | pending | — | Автоматизировать `npx @modelcontextprotocol/inspector`: handshake, tools/list, протокольные ошибки. Ловит «наши тесты зелёные, но не по спеке» |
| DX-24 | Executable docs | medium | pending | — | Скрипт прогоняет каждый bash/json-сниппет README/getting-started против реального пакета. README с враньём убивает первое впечатление |
| DX-25 | Клиентская compat-матрица | low | pending | — | Таблица «Claude Desktop ✓ / Cursor ✓ / Windsurf ?» + дата последней ручной проверки, обновляется при релизе |
| DX-28 | Contributor DX | low | pending | — | CONTRIBUTING.md, PR/issue-шаблоны, актуализация docs/architecture.md (после WIRE-находок может расходиться с кодом), опционально devcontainer |

---

## Этап O — Trust/Hardening: вторая волна аудитов и выдержка (2026-09-11)

> Вторая половина поверхности: request-path проаудирован (Этап M), но остались
> контент-агентная граница, Web UI, коннекторы, контейнер, supply chain и качество
> самих тестов. Тот же метод: находки только с file:line доказательствами,
> «подтверждено» vs «гипотеза».

### Фаза 1 — Аудиты

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| TR-01 | Аудит: indirect prompt injection через stored content | high | pending | — | Stored knowledge/tasks/prompts/memory-факты → контекст агента. Враждебный документ = инструкция агенту. Аудит: какие поля попадают в tool output, маркировка «untrusted content», рекомендации (delimiters, правило в agent_bootstrap). Выход: threat-model + находки |
| TR-02 | Аудит Web UI | high | done | 724059a | — | Подтверждённый вход: `renderMarkdown` экранирует `<>&` но НЕ `"` → `[x](" onclick="alert(1))` = attribute-injection XSS, `javascript:` URL тоже проходит (web-ui/app/knowledge/page.tsx:261,308-325, `dangerouslySetInnerHTML`). Плюс: CSRF на мутации, sessionStorage-токен, отсутствие sanitize-библиотеки |
| TR-03 | Аудит коннекторов и lifecycle кредов | medium | pending | — | Токены plaintext в env/config (github.ts:33, gdrive.ts:64, linear.ts:47): где лежит конфиг, кто читает; OAuth-флоу, webhook-валидация, scope-минимизация, поведение при revoke/ротации |
| TR-04 | Аудит качества тестов («тесты, которые врут») | high | pending | — | 92.7% coverage при массовой AI-генерации: tautological asserts, mock-drift, зелёные при сломанной impl. Тот же паттерн «done ≠ работает», но для тестов. Выход: список модулей с фейковым покрытием → дешёвый агент переписывает |

### Фаза 2 — Hardening (конкретные фиксы)

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| TR-05 | Docker: non-root + hardening | medium | pending | — | Dockerfile: 0 `USER`-директив = root-контейнер. Добавить non-root user, read-only fs где можно, ревизия .dockerignore, trivy-скан образа в CI |
| TR-06 | Supply chain базовый комплект | medium | pending | — | Нет dependabot/renovate, `npm audit` не в CI. Добавить: dependabot.yml (npm+actions, weekly), `npm audit --omit=dev` gate, SHA-pinning для actions, политика minimumReleaseAge для новых deps |
| TR-07 | Privacy-декларация + PII-scrubbing | medium | pending | — | Local-first манифест: честный список того, что уходит наружу (embeddings API, JWKS-fetch, коннекторы). Memory extraction — опция маскировать PII в фактах о пользователях. Selling point для agent-memory продукта |
| TR-08 | Reliability: деградация и partial failure | medium | pending | — | Недокументировано/нетестировано: поведение при downed-коннекторе (hang vs fail-fast), retry/backoff, partial-failure семантика batch-tools, drain endpoint под нагрузкой. Сначала контракт, потом тесты |
| TR-09 | Perf-ёмкость: бюджеты и пределы | low | pending | — | benchmarks/ не подключены к CI (0 hits в workflows). Регрессионные бюджеты, макс. датасет до деградации, memory ceiling. Задокументировать пределы |

### Фаза 3 — Governance и spec-frontier

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| TR-10 | API governance doc | low | pending | — | Политика breaking changes для ~114 tools, таксономия error-кодов, нейминг-конвенция (tasks_*/memory_*/tools_*), deprecation-путь. ToolRegistry версионирует — политики нет |
| TR-11 | MCP spec frontier tracking | low | pending | — | Политика отслеживания спеки + оценка неиспользуемых фич: elicitation, sampling, roots, subscriptions. Выход: что брать, что осознанно нет |
| TR-12 | Elicitation для confirm-флоу | medium | pending | TR-11, DX-19 | Деструктивные ops (project_purge, bulk-delete) → elicitation-запрос юзеру вместо слепого выполнения. Синергия с auto-backup DX-19 |
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
| SPEC-01 | Cancel-propagation: реальный AbortSignal на запрос | high | pending | — | `notifications/cancelled` не может прервать работу: транспорты фабрикуют `new AbortController().signal` (stream-transport.ts:~389, http аналогично). Привязать AbortController к requestId, cancelled → abort |
| SPEC-02 | Capabilities по спеке | high | pending | — | `SERVER_CAPS = {resources:{list,read}, tools:{call}}` (setup.ts:38) — нестандартная форма; спека ждёт `{subscribe,listChanged}`-флаги. Декларировать только реально обрабатываемое |

### Фаза 2 — Непокрытая поверхность

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| SPEC-03 | MCP prompts surface | medium | pending | — | `registerPrompt` — 0 вызовов: prompts только как tools, `prompts/list` → -32601, в UI клиентов пусто. Выставить prompt-library через registerPrompt, решить маппинг с prompts_*-tools |
| SPEC-04 | `listChanged` notifications | medium | pending | SPEC-02 | 0 `sendToolListChanged`/`sendResourceListChanged`: клиент кэширует список навсегда, хотя registry динамический (connectors, TOOLS_ENABLED). Эмитить при register/unregister и смене флагов |
| SPEC-05 | `completion/complete` | low | pending | — | В MAIN_DISPATCH_METHODS (http-transport.ts:45), handler'а нет → -32601. Либо autocomplete (project names, prompt args), либо убрать из dispatch |
| SPEC-06 | `resources/subscribe` + `resources/updated` | medium | pending | SPEC-02 | Event-bus уже есть → мост: подписка на uri → `notifications/resources/updated` при изменении |
| SPEC-07 | `progressToken` gating | low | pending | — | `streaming.ts` шлёт progress без проверки токена; спека — только если клиент прислал `progressToken` в `_meta` |
| SPEC-08 | `logging/setLevel` | low | pending | — | Принять → прокинуть в pino level. Полезно для отладки удалённых подключений |

### Фаза 3 — Политика

| ID | Задача | Приоритет | Статус | Зависимости | Что делать |
|----|--------|-----------|--------|-------------|------------|
| SPEC-09 | Protocol-version conformance e2e | medium | pending | DX-23 | Зафиксировать negotiated `protocolVersion` в e2e; Inspector-гейт частично покроет |
| SPEC-10 | SDK upgrade policy | low | pending | — | Периодический bump `@modelcontextprotocol/sdk` + ревью changelog на новые методы спеки |
| TR-14 | Egress prompt-injection scanner в ToolMiddleware.after() | high | pending | TR-01 | Сканировать output всех tools на паттерны: "ignore previous", role markers, zero-width, base64 payload >50 chars. Отдельный Sanitizer-instance на egress. |
| TR-15 | tools_run/tools_batch — пропускает auth-gate+SecurityStack | critical | done | TR-01 | Закрыто вместе с AUD-10: registry хранит gated handler (wrapToolHandler) → auth/ACL/audit/egress-scan применяются на dispatch через tools_run/tools_batch. Тесты: tests/aud10-tools-run-gate.test.ts |
| TR-16 | Trust/provenance metadata на stored docs | medium | pending | TR-01 | Добавить trust_level: 'system'|'user'|'external' в frontmatter knowledge+memory; egress фильтр агрессивнее для external. |
| TR-17 | XML/context escaping в memory_context_assemble | high | pending | TR-01 | buildBlock() интерполирует контент без escaping — stored </context> ломает boundary. Эскейпить или валидировать. |
| DX-30 | web-ui realtime client: ?token= + unconditional subscribe | medium | pending | AUD-06 | web-ui/lib/realtime.ts не шлёт token и subscribe только при project — на requireAuth deployment будет 4001. |
| AUD-18a | Path traversal userId в ProfileManager | critical | pending | AUD-18 | memory/user-profile.ts:95 join(storageDir, userId+'.json') без resolveUnder — arbitrary read/write |
| AUD-18b | Non-atomic JSON stores в memory/sync | critical | pending | AUD-18 | TemporalGraph/EntityGraph/ProfileManager пишут writeFileSync без tmp+rename — crash = silent data loss |
| AUD-18c | Lost-update RMW races в stores | high | pending | AUD-18 | In-memory copy→mutate→rewrite без lock; concurrent updates теряются |
| AUD-18d | EventLog unbounded growth + no compaction | high | pending | AUD-18 | persist() переписывает весь лог на каждый append; compactThreshold не используется |
| AUD-18e | threeWayMerge LWW no tiebreaker + manual writes null | medium | pending | AUD-18 | src/sync/ — merge bugs; whole sync stack is dead code (not wired) |
| AUD-18f | writeText не атомарный для .md knowledge docs | medium | pending | AUD-18 | writeJson атомарный (Q-013), writeText — нет |
| TR-04a | Delete lying tests: tasks_dag, obsidian.*.smoke (×2), confirm.replace.e2e | high | pending | TR-04 | Тесты ре-имплементируют SUT — реальный код может сломаться, тесты зелёные |
| TR-04b | Rewrite openapi.test.ts + markdown.test.ts на реальные модули | high | pending | TR-04 | zodToOpenApi определён в тесте; _getToolHandler→null |
| TR-04c | Rewrite cli.tools_list.contract + jsonrpc-fuzz (real imports) | high | pending | TR-04 | Regex по 22-строчному делегату; normalizeEnvelope клон |
| TR-04d | Rewrite e2e-full/memory-lifecycle — assert data, not shape | medium | pending | TR-04 | 30 вызовов env.ok===true, temporal_query не проверяет данные |
| TR-04e | Line-fixes batch: 12 файлов слабых ассертов | medium | pending | TR-04 | jwt-validator:787, memory-extended:304/328, chaos-shutdown:134, fts-search:124 и др. |
| TR-04f | Coverage gaps: dashboard_*, confirm-gate, bandit epsilon>0, bm25 params | medium | pending | TR-04 | Реальные дыры покрытия при 92.7% total |
| TR-04g | Test hygiene: DATA_DIR isolation + shared e2e http harness | low | pending | TR-04 | /tmp/mcp-data гонки; ~200 строк дублей в 6 e2e файлах |
| TR-18 | tests/security-stack.test.ts:197,209 — `lockoutMs` → `maxLockoutMs` (pre-existing tsc error) | low | pending | AUD-10 | AuthProtectionOptions нет `lockoutMs` |
| TR-19 | Битые `_X` импорты в 4+ тест-файлах (event-bus, tool-executor, async-ops, multimodal) | medium | pending | AUD-10 | tsconfig.test.json красный — экспорты удалены при рефакторинге, импорты остались |
| TR-20 | WS tokenValidator: rate-limit по IP — realtime.ts не имеет req.socket.remoteAddress | medium | pending | AUD-13 | brute-force по /ws endpoint не ограничен — validator closure не видит req; прокидывать remote в RealtimeAttachOptions |
| TR-21 | AuthProtection дублирует ключи: sessionId в SecurityStack + IP в AuthManager | low | pending | AUD-13 | Два инстанса пишут разные ключи — не баг, но шум; унифицировать на IP-keyed |

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

## Статистика бэклога

> Агент обновляет после каждого изменения.

**Последнее обновление:** 2026-09-11 (Этапы M/N/O/P: 18 аудит + 20 DX + 13 Trust + 10 spec-compliance)

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
| Quality | 13 | 0 | 0 | 13 | 0 | 0 |
| Docs | 5 | 0 | 0 | 5 | 0 | 0 |
| Agent Infra | 16 | 0 | 0 | 16 | 0 | 0 |
| Skills (A) | 6 | 0 | 0 | 6 | 0 | 0 |
| Rules (B) | 6 | 0 | 0 | 6 | 0 | 0 |
| Workflows (C) | 6 | 0 | 0 | 6 | 0 | 0 |
| Memory (D) | 4 | 0 | 0 | 4 | 0 | 0 |
| Integration Hub (E) | 6 | 0 | 0 | 6 | 0 | 0 |
| Web UI (13) | 7 | 0 | 0 | 7 | 0 | 0 |
| OpenCode Integration (F) | 8 | 0 | 0 | 8 | 0 | 0 |
| Behavioral Memory (G) | 14 | 0 | 0 | 14 | 0 | 0 |
| Competitive Edge (H) | 22 | 0 | 0 | 22 | 0 | 0 |
| Wire-in (I) | 10 | 0 | 0 | 10 | 0 | 0 |
| NEXT2 (J) | 8 | 0 | 0 | 8 | 0 | 0 |
| Full-server E2E (K) | 1 | 0 | 0 | 1 | 0 | 0 |
| Prod Hardening (L) | 14 | 3 | 0 | 11 | 0 | 0 |
| Audit request-path (M) | 18 | 18 | 0 | 0 | 0 | 0 |
| DX/Onboarding (N) | 20 | 20 | 0 | 0 | 0 | 0 |
| Trust/Hardening (O) | 13 | 13 | 0 | 0 | 0 | 0 |
| MCP spec compliance (P) | 10 | 10 | 0 | 0 | 0 | 0 |
| **Итого** | **266** | **64** | **0** | **201** | **0** | **1** |

> Примечание (2026-09-04): сводка приведена к фактическим строкам.
> Примечание (2026-09-11): Этап M (AUD-01..18), Этап N (DX-10..29), Этап O
> (TR-01..13) и Этап P (SPEC-01..10) добавлены постфактум — 64 pending.
> `npm run backlog:check` green.
> Массовые мержи 2026-09-04: WIRE-007/008/009, SEC-003, NEXT2-003/004/005/007/008,
> NEXT-011/012/013/015/016, NEXT2-009/010/012, Q-014 слайсы 1-14.
