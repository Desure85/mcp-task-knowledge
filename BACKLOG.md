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
- [ ] S-004: MCP tool `session_info` — клиент может запросить своё состояние (rate limit remaining, TTL, idle timeout)
- [ ] S-005: Session metrics — Prometheus gauges для активных сессий, duration histogram, idle timer
- [ ] MW-001: Middleware pipeline для tool calls (pre/post hooks, logging, error handling)
- [ ] MW-002: Internal event bus (pub/sub внутри сервера)
- [ ] MW-003: Built-in logging middleware (request/response через MW-001)
- [ ] CFG-001: Unified configuration (env + config file + defaults + schema validation)

### Этап 4 — Авторизация, ACL, безопасность

- [ ] A-001: `mcp.authenticate` + pre-auth method window
- [ ] A-002: JWT/JWKS validation
- [ ] A-003: Привязка tokenClaims к session TTL
- [ ] ACL-001: Модель ACL и policy definitions
- [ ] ACL-002: Фильтрация списков инструментов/ресурсов по ACL
- [ ] ACL-003: Проверка авторизации при вызове инструментов
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

- [ ] SCALE-001: Health/readiness/drain endpoints
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

- [ ] SK-001: Skills CRUD (Markdown + YAML frontmatter)
- [ ] SK-002: Skill invocation pipeline
- [ ] SK-003: Skill discovery + импорт из awesome-cursorrules
- [ ] SK-004: Pre-built skill templates
- [ ] SK-005: Skill sharing + конвертеры форматов
- [ ] SK-006: Skill permissions (Agent Skills spec)
- [ ] RL-001: Rules storage (global → project → user)
- [ ] RL-002: Rules evaluation (runtime guard checks)
- [ ] RL-003: Policy-as-code (JSON/DSL)
- [ ] RL-004: Built-in rule packs
- [ ] RL-005: Rule enforcement hooks
- [ ] RL-006: Rule import (.cursorrules, CLAUDE.md, .clinerules)
- [ ] WF-001: Workflow DAG builder
- [ ] WF-002: Workflow executor
- [ ] WF-003: Workflow templates
- [ ] WF-004: Human-in-the-loop
- [ ] WF-005: Workflow state persistence
- [ ] WF-006: Workflow chaining (subflow)
- [ ] MEM-001: Session memory
- [ ] MEM-002: Entity graph
- [ ] MEM-003: Context distillation
- [ ] MEM-004: Memory import/export

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
| T-004 | Transport health check: метод `health()` на TransportAdapter — проверка что транспорт жив (socket listening, connection alive). Для SCALE-001 `/healthz`. Stdio всегда healthy | low | pending | — | T-001 |

---

## Cross-cutting: Middleware & Infrastructure

> Фундаментальные компоненты, от которых зависят ACL, Rules, Auth и другие подсистемы.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| MW-001 | Middleware pipeline: chain of pre/post interceptors для tool calls. Базовый интерфейс `ToolMiddleware { before(ctx), after(ctx, result), onError(ctx, err) }`. Порядок execution, short-circuit, error propagation | high | pending | — | T-001 |
| MW-002 | Internal event bus: pub/sub шина внутри сервера. Топики: `tool.called`, `task.created`, `session.opened`. Подписчики: logger, metrics, rules engine, connectors. Typed events, async dispatch | high | pending | 11.1 | T-001 |
| MW-003 | Built-in logging middleware: request/response logging для tool calls через MW-001 pipeline. Structured log: tool name, input, output (truncated), duration, sessionId, userId. Конфигурируемый verbosity | medium | pending | — | MW-001, S-002 |
| CFG-001 | Unified configuration: единая система конфигурации — env vars, config file (YAML/JSON), runtime defaults, schema validation (Zod). Иерархия: defaults → config file → env → CLI args. API: `config.get('server.port')` | high | pending | — | T-001 |

---

## Этап 2 — Многопользовательские сессии

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| S-001 | SessionManager: TTL, idle timeout, lifecycle | medium | **done** ✅ | 2.1 | T-001 |
| S-002 | ToolExecutor и ToolContext (per-session) | medium | **done** ✅ | 2.2 | S-001 |
| S-003 | Per-session rate limiting (token bucket) | medium | **done** ✅ | 2.3 | S-001 |
| S-004 | MCP tool `session_info`: клиент запрашивает своё состояние — rate limit remaining, TTL, idle timeout, session age. Для multi-client (TCP/HTTP). Через ToolExecutor pre-hook для доступа к контексту | medium | pending | — | S-001, S-003, S-002 |
| S-005 | Session Prometheus metrics: gauges `mcp_sessions_active`, `mcp_sessions_total`, histogram `mcp_session_duration_seconds`, `mcp_session_idle_seconds`. Обновление через SessionManager callbacks | low | pending | — | S-001, F-005 |

---

## Этап 3 — Авторизация

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| A-001 | `mcp.authenticate` + pre-auth method window | medium | pending | 3.1 | S-001 |
| A-002 | JWT/JWKS validation | high | pending | 3.2 | A-001 |
| A-003 | Привязка tokenClaims к session TTL | medium | pending | 3.3 | A-002, S-001 |

---

## Этап 4 — ACL

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| ACL-001 | Модель ACL и policy definitions | medium | pending | 4.1 | A-002 |
| ACL-002 | Фильтрация списков инструментов/ресурсов по ACL | medium | pending | 4.2 | ACL-001 |
| ACL-003 | Проверка авторизации при вызове инструментов | medium | pending | 4.3 | ACL-001 |

---

## Этап 5 — Thin Proxy

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| P-001 | Proxy bootstrap и конфигурация | medium | pending | 5.1 | A-002 |
| P-002 | Зеркалирование инструментов/ресурсов через прокси | medium | pending | 5.2 | P-001 |
| P-003 | Проброс запросов/уведомлений, flow control | medium | pending | 5.3 | P-002 |
| P-004 | Устойчивость и observability прокси | low | pending | 5.4 | P-003 |

---

## Этап 8 — Безопасность (Security)

> Из ROADMAP stage 8. Системная безопасность — аутентификация, аудит, шифрование, секреты.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| SEC-001 | Audit logging: запись всех MCP-операций в structured audit trail — кто, что, когда, результат. Формат: JSON lines, ротация по размеру/времени. Хранение: файл + optional remote (Syslog/Loki). MCP tools: `audit.query`, `audit.export` | high | pending | 8.2 | A-002 |
| SEC-002 | TLS/mTLS поддержка: TLS для TCP/HTTP транспорта. mTLS для server-to-server (proxy ↔ server). Certificate rotation без downtime. Конфигурация через `CFG-001` | medium | pending | 8.3 | T-002, CFG-001 |
| SEC-003 | Token refresh flow: short-lived access tokens (15-30 min) + refresh tokens. Refresh endpoint, token revocation, token blacklist. Связь с `A-002` и `A-003` | high | pending | 8.1 | A-002 |
| SEC-004 | Secret management: хранение секретов (API keys, tokens) — env vars, Docker secrets, HashiCorp Vault integration (optional). Шифрование at-rest для конфиденциальных данных. API: `secrets.get`, `secrets.set` | medium | pending | 8.4 | CFG-001 |
| SEC-005 | Authentication protection: rate-limit на `mcp.authenticate` (5 attempts/min), lockout после N failures, exponential backoff. CAPTCHA integration (optional). IP-based blocking | medium | pending | 8.5 | A-001 |
| SEC-006 | Input sanitization: валидация и очистка всех tool input — XSS prevention, SQL injection, path traversal, command injection. Стандартный sanitizer перед вызовом handler. Часть MW-001 pipeline | medium | pending | — | MW-001 |

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
| DX-006 | Pre-push CI hooks: husky + lint-staged — `tsc --noEmit` + `vitest run` перед каждым push. Цель: не пускать в CI код с TS-ошибками или падающими тестами. Установить: `npx husky init`, добавить `pre-push` hook | high | pending | — | — |
| DX-007 | Shared test factories: вынести `createMockContext()`, `createMockAdapter()` и др. в `tests/helpers.ts`. Сейчас дублируется в 5 тестовых файлах (1764 строк). Единый источник правды для моков ServerContext, TransportAdapter | medium | pending | — | — |
| DX-008 | ESLint + Prettier: добавить ESLint (strict TS config) и Prettier. CI lint job. Pre-commit hook через husky. autofix на `npm run lint:fix` | medium | pending | — | DX-006 |

---

## Этап 10 — Масштабируемость (Scalability)

> Из ROADMAP stage 10. Масштабирование от single-server к кластеру.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| SCALE-001 | Health/readiness/drain endpoints: `/healthz` (liveness), `/readyz` (readiness — deps check: DB, embeddings), `/drainz` (graceful shutdown — stop accepting new sessions). Standard Kubernetes probes | high | pending | 10.4 | T-001 |
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
| TD-004 | Rate limiting на уровне инструментов | medium | pending | S-003 | — |
| TD-005 | Версионирование документов знаний | low | pending | — | — |
| TD-006 | Добавить JSDoc для публичных функций | medium | pending | — | — |
| TD-007 | Migration от `uuid` v9 к `crypto.randomUUID()` | low | pending | — | — |
| TD-008 | ESM-совместимый импорт service-catalog | medium | pending | — | — |
| TD-009 | Data migration framework: версия схемы данных, миграции up/down, rollback. CLI: `mcp-tk migrate [up\|down\|status]`. Применяется при запуске. Защита от одновременных миграций | medium | pending | — | CFG-001 |
| TD-010 | Centralized error handling: единый error handler для tool calls — классификация ошибок (validation, not found, internal, permission), consistent error responses, error context для logging | medium | pending | — | MW-001 |
| TD-011 | Graceful degradation: при недоступности optional сервисов (embeddings, AI models) — fallback к базовому функционалу. Circuit breaker pattern. Health status indicators | medium | pending | — | MW-001, SCALE-001 |
| TD-012 | Mock interface sync: при изменении TransportAdapter/ServerContext/etc — автоматически проверять что моки в тестах соответствуют реальным интерфейсам. Утилита `tests/type-check.ts` или tsd | medium | pending | — | DX-007 |
| TD-013 | Test timing safety: заменить `sleep()` на `vi.useFakeTimers()` в тестах session-manager, rate-limiter. Текущие timing-тесты flaky при высокой нагрузке CI | medium | pending | — | Q-009 |
| TD-014 | WIP commit strategy для агента: автоматический `git commit -m "WIP"` перед началом каждой BACKLOG задачи. Восстановление после крэша без потери staged changes | low | pending | — | — |

---

## Качество и тестирование

> Из ROADMAP stage 7 + дополнительные.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| Q-001 | Unit-тесты для `src/search/bm25.ts` (покрытие edge-cases) | high | done | 7.1 | — |
| Q-002 | Unit-тесты для `src/storage/tasks.ts` | high | done | 7.1 | — |
| Q-003 | Unit-тесты для `src/storage/knowledge.ts` | high | done | 7.1 | — |
| Q-004 | Интеграционные E2E тесты для основных MCP-инструментов | medium | pending | 7.1 | — |
| Q-005 | Coverage threshold enforcement (минимум 80%) | medium | pending | 7.4 | Q-001..Q-004 |
| Q-006 | Нагрузочные тесты для BM25 и vector search | low | pending | 7.2 | — |
| Q-007 | Schema validation tests (ajv для schemas/*.json) | low | pending | 7.1 | — |
| Q-008 | Фаззинг JSON-RPC: random payloads для framing, parser, validator. Инструменты: fast-check / property-based testing. Цель — найти краш-баги и undefined behavior | medium | pending | 7.3 | — |
| Q-009 | Chaos/shutdown тесты: SIGTERM/SIGKILL во время обработки,OOM simulation, disk full. Проверка graceful shutdown (T-001), data integrity, session recovery | medium | pending | 7.5 | T-001, Q-004 |
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
| SK-001 | Skills CRUD: создание, редактирование, версионирование скиллов. Markdown + YAML frontmatter, поддержка `$ARGUMENTS`, `${VARS}` | critical | pending | — | — |
| SK-002 | Skill invocation pipeline: триггер → контекст → выполнение → результат. `context: fork` для сабагентов, shell injection `!command`` | critical | pending | — | SK-001 |
| SK-003 | Skill discovery: каталог с тегами, поиск, категории. Импорт из awesome-cursorrules и других источников | high | pending | — | SK-001 |
| SK-004 | Skill templates: pre-built скиллы из коробки — code-review, deploy, test-gen, refactor, debug, architecture-review | high | pending | — | SK-001 |
| SK-005 | Skill sharing: экспорт/импорт. Конвертеры: .cursorrules ↔ SKILL.md ↔ .clinerules ↔ наш формат. Git-native хранение | medium | pending | — | SK-001 |
| SK-006 | Skill permissions: `allowed-tools`, `disable-model-invocation`, scope (project/user/global) по Agent Skills spec | medium | pending | — | SK-001, SK-002 |

---

## Этап B — Rules & Policies Engine

> Концепция: Guardrails и правила для AI-агента — аналог .cursorrules, CLAUDE.md, .clinerules, policy-as-code.
> Уровни: global → project → user. Наследование и переопределение на каждом уровне.
> Runtime: guard checks перед вызовом MCP-инструментов, input/output validation.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| RL-001 | Rules storage: иерархия правил (global → project → user). Формат Markdown + YAML frontmatter. Наследование, переопределение | critical | pending | — | — |
| RL-002 | Rules evaluation: runtime guard checks перед вызовом MCP-инструментов. Input/output validation, schema checks | critical | pending | — | RL-001 |
| RL-003 | Policy-as-code: JSON/DSL описание политик. Git-native, версонируются с кодом. Условные правила (if file=*.ts then...) | high | pending | — | RL-001 |
| RL-004 | Built-in rule packs: предустановленные наборы — security-rules, ts-strict, react-conventions, python-style, team-standards | medium | pending | — | RL-001 |
| RL-005 | Rule enforcement hooks: pre/post hooks на MCP tool calls. Блокировка, предупреждение, логирование, auto-fix. Реализуется через `MW-001` (middleware pipeline) | high | pending | — | RL-002, MW-001 |
| RL-006 | Rule import: импорт из .cursorrules, CLAUDE.md, .clinerules, .windsurfrules. Конвертеры в наш формат | medium | pending | — | RL-001 |

---

## Этап C — Workflows (AI Agent Flows)

> Концепция: Последовательности AI-действий — аналог Windsurf Flows, Cursor rules chaining, Claude Code skill flows.
> Пример: research → plan → implement → review. Переиспользуемые шаблоны для агента.
> Уровень абстракции: AI Agent Flows (high-level) + tool orchestration (low-level), с вложенностью.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| WF-001 | Workflow DAG builder: определение графа — nodes (tools/skills/rules), edges (dependencies), conditions, triggers | critical | pending | — | SK-001 |
| WF-002 | Workflow executor: выполнение — sequential, parallel, conditional branching, error recovery, retry logic | critical | pending | — | WF-001 |
| WF-003 | Workflow templates: pre-built flows — code-review-pipeline, feature-dev-flow, bug-triage, release-checklist, research-and-plan | high | pending | — | WF-001 |
| WF-004 | Human-in-the-loop: точки останова для подтверждения пользователем. Approve/reject/modify перед критическими шагами | high | pending | — | WF-002 |
| WF-005 | Workflow state persistence: чекпоинты, возобновление после сбоев. Resume с места остановки. Session linkage | medium | pending | — | WF-002 |
| WF-006 | Workflow chaining: вложенные workflows (subflow), composability. Workflow как step внутри другого workflow | medium | pending | — | WF-002 |

---

## Этап D — Developer Memory & Context

> Концепция: Персистентная память для AI-агента между сессиями. Архитектурные решения, конвенции, lesson learned.
> Расширение текущего knowledge-base модуля специализации под AI context management.
> Аналоги: PersistMemory MCP, Beam, CASS (310 ⭐), .claude/ project memory.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| MEM-001 | Session memory: персистентная память между сессиями AI-агента. Автосохранение контекста, архитектурные решения, конвенции | high | pending | — | — |
| MEM-002 | Entity graph: граф сущностей проекта — файлы→модули→зависимости. Semantic search по графу, auto-discovery | medium | pending | — | MEM-001 |
| MEM-003 | Context distillation: авто-суммаризация сырого контекста в actionable knowledge. Compress old sessions | medium | pending | — | MEM-001 |
| MEM-004 | Memory import/export: импорт из .claude/, .cursor/, Obsidian vault. Экспорт в стандартные форматы | medium | pending | — | MEM-001 |

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

## Блокированные

| ID | Задача | Причина | Статус |
|----|--------|---------|--------|
| MR-012 | Real-time collaboration (WebSocket) | Ждёт UI-005 | pending |

---

## Архив (последние 20)

| ID | Задача | Закрыто | PR |
|----|--------|---------|-----|
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

**Последнее обновление:** 2026-04-07

| Категория | Всего | pending | in_progress | done | blocked | deferred |
|-----------|-------|---------|-------------|------|---------|----------|
| Foundation (0) | 6 | 0 | 0 | 6 | 0 | 0 |
| Transport (1) | 4 | 1 | 0 | 3 | 0 | 0 |
| Middleware & Infra | 4 | 4 | 0 | 0 | 0 | 0 |
| Sessions (2) | 5 | 2 | 0 | 3 | 0 | 0 |
| Auth (3) | 3 | 3 | 0 | 0 | 0 | 0 |
| ACL (4) | 3 | 3 | 0 | 0 | 0 | 0 |
| Proxy (5) | 4 | 4 | 0 | 0 | 0 | 0 |
| Security (8) | 6 | 6 | 0 | 0 | 0 | 0 |
| Sync (6) | 5 | 5 | 0 | 0 | 0 | 0 |
| DX (9) | 8 | 8 | 0 | 0 | 0 | 0 |
| Scalability (10) | 5 | 5 | 0 | 0 | 0 | 0 |
| Market Research | 14 | 1 | 0 | 13 | 0 | 0 |
| Tech Debt | 14 | 11 | 0 | 2 | 0 | 0 |
| Quality | 11 | 8 | 0 | 3 | 0 | 0 |
| Docs | 5 | 5 | 0 | 0 | 0 | 0 |
| Agent Infra | 7 | 2 | 0 | 5 | 0 | 0 |
| Skills (A) | 6 | 6 | 0 | 0 | 0 | 0 |
| Rules (B) | 6 | 6 | 0 | 0 | 0 | 0 |
| Workflows (C) | 6 | 6 | 0 | 0 | 0 | 0 |
| Memory (D) | 4 | 4 | 0 | 0 | 0 | 0 |
| Integration Hub (E) | 6 | 6 | 0 | 0 | 0 | 0 |
| Web UI (13) | 7 | 7 | 0 | 0 | 0 | 0 |
| **Итого** | **139** | **111** | **0** | **35** | **0** | **0** |
