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
- [ ] CFG-001: Unified configuration (env + config file + defaults + schema validation)

### Этап 4 — Авторизация, ACL, безопасность

- [x] A-001: `mcp.authenticate` + pre-auth method window (PR #60)
- [x] A-002: JWT/JWKS validation (PR #61)
- [x] A-003: Привязка tokenClaims к session TTL (PR #63)
- [x] ACL-001: Модель ACL и policy definitions (PR #64)
- [x] ACL-002: Фильтрация списков инструментов/ресурсов по ACL
- [x] ACL-003: Проверка авторизации при вызове инструментов
- [ ] SEC-001: Audit logging (все MCP-операции → structured audit trail)
- [ ] SEC-002: TLS/mTLS поддержка + certificate rotation
- [ ] SEC-003: Token refresh flow + short-lived tokens
- [ ] SEC-004: Secret management (env, vault, KMS integration)
- [ ] SEC-005: Authentication protection (rate-limit, lockout, brute-force prevention)
- [ ] SEC-006: Input sanitization (XSS, SQL injection, path traversal protection)

### Этап 5 — Инфраструктура качества

- [ ] Q-004: E2E тесты MCP-инструментов
- [ ] Q-005: Coverage threshold enforcement (минимум 80%)
- [ ] Q-006: Нагрузочные тесты для BM25 и vector search
- [ ] Q-007: Schema validation tests (ajv для schemas/*.json)
- [ ] Q-008: Фаззинг: JSON-RPC framing/parser/validator
- [ ] Q-009: Chaos/shutdown тесты (graceful degradation)
- [ ] Q-010: Property-based testing для core-модулей (fast-check)
- [ ] Q-011: Snapshot testing для transport adapters
- [ ] SYNC-005: E2E durability тесты (синхронизация)

### Этап 6 — Proxy, синхронизация, DX

- [ ] P-001: Proxy bootstrap и конфигурация
- [ ] P-002: Зеркалирование инструментов/ресурсов через прокси
- [ ] P-003: Проброс запросов/уведомлений, flow control
- [ ] P-004: Устойчивость и observability прокси
- [ ] SYNC-001: Протокол версионирования и курсоры
- [ ] SYNC-002: RPC `mcp.sync.*` (delta/snapshot/ack)
- [ ] SYNC-003: Conflict resolver (3-way merge)
- [ ] SYNC-004: Event sourcing и snapshots (GC)
- [ ] DX-001: Hot registration of tools (runtime add/remove)
- [ ] DX-002: Namespaces и wildcard фильтры для инструментов
- [ ] DX-003: Dev CLI (diagnostics, config validation, health check)
- [ ] DX-004: Hot reload конфигов/политик без перезапуска
- [ ] DX-005: Proxy response caching (ETag-based, TTL)

### Этап 7 — Масштабируемость

- [x] SCALE-001: Health/readiness/drain endpoints
- [ ] SCALE-002: Load balancer integration + sticky sessions
- [ ] SCALE-003: Cluster state synchronization (sessions/registry)
- [ ] SCALE-004: Tool sharding across nodes
- [ ] SCALE-005: Auto-scaling и resource limits

### Этап 8 — Интеграции

- [ ] INT-004: Connector framework (plug-in SDK + registry)
- [ ] INT-001: GitHub connector
- [ ] INT-002: Jira/YouTrack connector
- [ ] INT-003: Slack/Discord connector
- [ ] MR-012: Real-time collaboration (WebSocket)
- [ ] INT-005: REST wrappers для MCP tools
- [ ] INT-006: gRPC wrappers для MCP tools

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

- [ ] UI-001: Web UI foundation (Next.js + auth + API client)
- [ ] UI-002: Tasks board (Kanban/List view)
- [ ] UI-003: Knowledge editor (Markdown/MDX)
- [ ] UI-004: Prompt management (versions, variants, A/B)
- [ ] UI-005: Realtime updates (WebSocket)
- [ ] UI-006: Feedback loop & usage analytics
- [ ] UI-007: Docker/CI pipeline для Web UI

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
| MR-012 | Real-time collaboration (WebSocket) | medium | pending | — | — |
| MR-013 | Claude Code / Windsurf integration guides | high | done | — | — |
| MR-014 | README overhaul: install, features, demo GIF | high | done | — | — |

---

## Этап 6 — Синхронизация

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| SYNC-001 | Протокол версионирования и курсоры | medium | pending | 6.1 | — |
| SYNC-002 | RPC `mcp.sync.*` (delta/snapshot/ack) | medium | pending | 6.2 | SYNC-001 |
| SYNC-003 | Conflict resolver (3-way merge) | high | pending | 6.3 | SYNC-002 |
| SYNC-004 | Event sourcing и snapshots (GC) | low | pending | 6.4 | SYNC-002 |
| SYNC-005 | E2E durability тесты: проверка синхронизации при сбоях — disconnect, split-brain, concurrent writes. Восстановление после crash | medium | pending | 6.5 | SYNC-003 |

---

## Этап 9 — Developer Experience (DX)

> Из ROADMAP stage 9. Улучшения для разработчиков, использующих MCP сервер.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| DX-001 | Hot registration of tools: runtime добавление/удаление инструментов без перезапуска. API: `tools.register()`, `tools.unregister()`. Уведомления клиентам через MW-002 (event bus) | medium | pending | 9.1 | MW-002 |
| DX-002 | Namespaces и wildcard фильтры: группировка инструментов по namespace (`project.*`, `search.*`). Фильтрация при `tools/list` по паттерну (`search.*`, `*.create`). Поддержка в ACL | medium | pending | 9.2 | MW-001 |
| DX-003 | Dev CLI: CLI-утилита для локальной разработки — `mcp-tk diagnose` (health check, config validation), `mcp-tk tools` (list registered tools), `mcp-tk sessions` (active sessions), `mcp-tk export` (data backup) | medium | pending | 9.4 | CFG-001 |
| DX-004 | Hot reload конфигов/политик: watch на config files, reload без restart. Graceful transition (old connections continue, new connections use new config). Зависит от `CFG-001` | medium | pending | 9.5 | CFG-001, MW-002 |
| DX-005 | Proxy response caching: ETag-based кеширование ответов в прокси. TTL per-tool. Cache invalidation при write operations. API: `cache.stats`, `cache.invalidate` | low | pending | 9.3 | P-002 |
| DX-006 | Pre-push CI hooks: husky + lint-staged — `tsc --noEmit` + `vitest run` перед каждым push. Цель: не пускать в CI код с TS-ошибками или падающими тестами. Установить: `npx husky init`, добавить `pre-push` hook | high | done | PR #82 | — |
| DX-007 | Shared test factories: вынести `createMockContext()`, `createMockAdapter()` и др. в `tests/helpers.ts`. Сейчас дублируется в 5 тестовых файлах (1764 строк). Единый источник правды для моков ServerContext, TransportAdapter | medium | pending | — | — |
| DX-008 | ESLint + Prettier: добавить ESLint (strict TS config) и Prettier. CI lint job. Pre-commit hook через husky. autofix на `npm run lint:fix` | medium | pending | — | DX-006 |

---

## Этап 10 — Масштабируемость (Scalability)

> Из ROADMAP stage 10. Масштабирование от single-server к кластеру.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| SCALE-001 | Health/readiness/drain endpoints: `/healthz` (liveness), `/readyz` (readiness — deps check: DB, embeddings), `/drainz` (graceful shutdown — stop accepting new sessions). Standard Kubernetes probes | high | done | PR #83 | T-001 |
| SCALE-002 | Load balancer integration + sticky sessions: session affinity по session ID. Support для AWS ALB, Nginx, HAProxy. Docs по настройке. Health check integration | medium | pending | 10.1 | S-001, SCALE-001 |
| SCALE-003 | Cluster state synchronization: репликация session state и registry между нодами. Consensus protocol (Raft/etcd) или eventual consistency. Split-brain detection | low | pending | 10.3 | SYNC-002, S-001 |
| SCALE-004 | Tool sharding across nodes: распределение инструментов по нодам (по namespace/prefix). Routing layer в прокси. Tool discovery across cluster | low | pending | 10.2 | P-002, DX-002 |
| SCALE-005 | Auto-scaling и resource limits: HPA на основе метрик (active sessions, CPU, memory). Resource quotas per-session. Graceful degradation при нагрузке | low | pending | 10.5 | SCALE-001, S-003 |

---

## Технический долг и улучшения (не привязаны к этапу)

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| TD-001 | Рефакторинг монолитного `src/index.ts` (разделение на модули) | high | done | — | F-001 → done via F-001 |
| TD-002 | Типизация: заменить `any` на конкретные типы | medium | done | F-006 ✅ | — |
| TD-003 | Удалить legacy-поддержку путей знаний | low | deferred | — | — |
| TD-004 | Rate limiting на уровне инструментов | medium | done | S-003 | — | покрыто S-003 (PR #53) |
| TD-005 | Версионирование документов знаний | low | pending | — | — |
| TD-006 | Добавить JSDoc для публичных функций | medium | pending | — | — |
| TD-007 | Migration от `uuid` v9 к `crypto.randomUUID()` | low | pending | — | — |
| TD-008 | ESM-совместимый импорт service-catalog | medium | pending | — | — |
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
| Q-010 | Property-based testing для core-модулей: fast-check для SessionManager (TTL/idle edge cases), RateLimiter (burst/refill boundaries), ToolExecutor (hook ordering). Цель — найти неочевидные баги | medium | pending | — | S-001, S-003 |
| Q-011 | Snapshot testing для transport adapters: vitest snapshots для Content-Length framing, JSON-RPC messages, handshake. Обнаружение regression в wire format | low | pending | — | T-002, T-003 |

---

## Документация

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| D-001 | API reference для всех MCP-инструментов | medium | pending | — | — |
| D-002 | Architecture Decision Records (ADR) | low | pending | — | — |
| D-003 | CONTRIBUTING.md для контрибьюторов | low | pending | — | — |
| D-004 | CHANGELOG.md (автоматический из conventional commits) | low | pending | — | — |
| D-005 | Architecture diagram: Mermaid/PlantUML диаграмма — компоненты (AppContainer, SessionManager, ToolExecutor, Transport), связи, data flow. В README или /docs. Обновлять при изменении архитектуры | medium | pending | — | — |

---

## Агент-инфраструктура

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| AI-001 | Создать AGENTS.md | critical | done | — | — |
| AI-002 | Создать BACKLOG.md | critical | done | — | — |
| AI-003 | Актуализировать ROADMAP.md | critical | done | — | — |
| AI-004 | Автоматическое обновление трекинг-троек в CI | low | pending | — | AI-001..AI-003 |
| AI-005 | Market research отчёт (PDF) | high | done | — | — |
| AI-006 | ~~Web UI: Kanban, Knowledge, Search (Next.js)~~ → заменена на UI-001..UI-007 | high | done | — | — |
| AI-007 | Agent performance tracking: логирование времени на задачу, потреблённых токенов, количества PR. Автообновление в BACKLOG. Цель — анализировать velocity и оптимизировать процесс | low | pending | — | AI-001..AI-003 |

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
| INT-004 | Connector framework: plug-in architecture для добавления коннекторов. SDK + registry + lifecycle hooks | high | pending | — | MW-002 |
| INT-001 | GitHub connector: issues, PRs, commits, code search. MCP tools: github_issue_*, github_pr_*, github_repo_* | high | pending | — | INT-004 |
| INT-002 | Jira/YouTrack connector: синхронизация задач между mcp-task-knowledge и внешними таск-трекерами | medium | pending | — | INT-004 |
| INT-003 | Slack/Discord connector: уведомления, поиск, отправка сообщений из AI-агента | medium | pending | — | INT-004 |
| INT-005 | REST wrappers: генерация REST endpoints для MCP tools. Auto-generated OpenAPI spec. Поддержка GET/POST для tool invocation | low | pending | 11.3 | P-002 |
| INT-006 | gRPC wrappers: генерация gRPC service definitions для MCP tools. Protobuf schema. Streaming support | low | pending | 11.4 | P-002 |

---

## Этап 13 — Web UI

> Разбивка AI-006/MR-015 на конкретные задачи из ROADMAP stage 13.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| UI-001 | Web UI foundation: Next.js app, auth (OIDC/JWT), API client (typed SDK для MCP HTTP transport), layout/shell, responsive design | critical | pending | 13.1 | MR-001, A-002 |
| UI-002 | Tasks board: Kanban view (drag&drop), list view, filters, search. CRUD для задач. Зависимости визуализация (граф). Интеграция с MR-005 (DAG) | high | pending | 13.2 | UI-001 |
| UI-003 | Knowledge editor: Markdown/MDX редактор с preview. Синтаксис highlight, drag&drop для файлов. Связь с search (MR-003) | high | pending | 13.3 | UI-001 |
| UI-004 | Prompt management: версионирование промптов, A/B тестирование (связь с `ab-testing/`), variant comparison, template editor | medium | pending | 13.4 | UI-001 |
| UI-005 | Realtime updates: WebSocket подключение для live-updates задач, знаний, сессий. Presence indicators. Оптимистичные обновления UI | medium | pending | 13.5 | UI-002, MR-012 |
| UI-006 | Feedback loop & analytics: usage tracking (anon), feedback forms, analytics dashboard. Связь с MR-007 (dashboard) | low | pending | 13.6 | UI-002 |
| UI-007 | Docker/CI для Web UI: multi-stage Dockerfile, CI pipeline (build → test → deploy), preview environments (Vercel/Docker) | medium | pending | 13.7 | UI-001 |

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
| OC-001 | OpenCode плагин `memory-recall`: инжекция инструкции для авто-вызова `search_knowledge` в начале сессии (как session-draft.ts, но для recall). Плагин НЕ вызывает MCP сам — он инструктирует агента | high | in_progress | — | — |
| OC-002 | OpenCode плагин `memory-sync`: hook `tool.execute.after` на `/remember` → debounce 30с → sync facts.md в knowledge base. Прямой MCP-вызов через `ctx.client` (OpenCode Plugin API) | medium | in_progress | — | OC-001 |
| OC-003 | Дедупликация при sync: перед `knowledge_bulk_create` — `search_knowledge` по title, если найдено → `knowledge_bulk_update` вместо create. Избегает дублей при повторном sync | high | done | — | OC-002 |
| OC-004 | patterns.json sync: парсинг structured patterns в sync-скрипт/плагин. Каждая запись → knowledge item с тегами `[pattern, importance-N]` | medium | done | — | OC-002 |
| OC-005 | Авто-инъекция контекста: hook `experimental.chat.messages.transform` → extract query из last user message → `search_knowledge` top-5 → append compact results в system prompt. Бюджет ~2000 токенов, кэш по query hash (TTL 5 мин), min score threshold | medium | done | — | OC-001 |
| OC-006 | P2P sync Windows ↔ Linux: git sync facts.md + re-sync index после pull. Или Syncthing для `~/mcpTrackerData/`. Документация по настройке | low | pending | — | OC-002 |
| OC-007 | Web UI для browse/search памяти: начать с Obsidian export (уже работает), потом минимальный web UI (FastAPI/Express читающий SQLite) если Obsidian не устроит | low | pending | — | — |
| OC-008 | Cleanup конфига opencode.json: `--config` file вместо 20 env vars. Структурированный JSON-конфиг, git-trackable. Связано с CFG-001 | medium | pending | — | CFG-001 |

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
| BM-012 | LAN Relay: mDNS auto-discovery peers + AES-256-GCM encrypted WebSocket. `relay_status`, `share_brief`, `broadcast_rule`. Zero-config, no cloud. Collective guardrails — rule созданная одним dev → instant broadcast всем teammates | low | pending | — | BM-010, OC-006 |
| BM-013 | Migration framework: SQLite _migrations table + up/down migrations + transactional batch apply. Statement cache с LRU eviction. WAL mode, busy_timeout, wal_autocheckpoint. Закрывает TD-009 | high | completed | #117 | TD-009 |
| BM-014 | FTS5 search: SQLite built-in full-text search как fallback/дополнение к BM25+vector. Проще, без external deps, для small datasets. `query_memory` с FTS5 natural-language search + filtered query (file_path, status, since) + pagination | medium | completed | #118 | BM-001 |

---

## Блокированные

| ID | Задача | Причина | Статус |
|----|--------|---------|--------|
| MR-012 | Real-time collaboration (WebSocket) | Ждёт UI-005 | pending |

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

**Последнее обновление:** 2026-08-28

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
| Sync (6) | 5 | 5 | 0 | 0 | 0 | 0 |
| DX (9) | 8 | 7 | 0 | 1 | 0 | 0 |
| Scalability (10) | 5 | 4 | 0 | 1 | 0 | 0 |
| Market Research | 14 | 1 | 0 | 13 | 0 | 0 |
| Tech Debt | 14 | 10 | 0 | 3 | 0 | 1 |
| Quality | 11 | 8 | 0 | 3 | 0 | 0 |
| Docs | 5 | 5 | 0 | 0 | 0 | 0 |
| Agent Infra | 7 | 2 | 0 | 5 | 0 | 0 |
| Skills (A) | 6 | 0 | 0 | 6 | 0 | 0 |
| Rules (B) | 6 | 0 | 0 | 6 | 0 | 0 |
| Workflows (C) | 6 | 0 | 0 | 6 | 0 | 0 |
| Memory (D) | 4 | 0 | 0 | 4 | 0 | 0 |
| Integration Hub (E) | 6 | 6 | 0 | 0 | 0 | 0 |
| Web UI (13) | 7 | 7 | 0 | 0 | 0 | 0 |
| OpenCode Integration (F) | 8 | 4 | 2 | 2 | 0 | 0 |
| Behavioral Memory (G) | 14 | 4 | 0 | 10 | 0 | 0 |
| **Итого** | **161** | **75** | **2** | **94** | **0** | **1** |
