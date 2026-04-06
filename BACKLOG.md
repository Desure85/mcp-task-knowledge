# BACKLOG.md — Бэклог задач

> **Назначение:** Приоритезированный список задач для развития проекта `mcp-task-knowledge`.
> Агент обновляет статусы после каждого этапа/подэтапа работы.
> Связь с ROADMAP.md: каждая задача ссылается на этап дорожной карты.

---

## Стратегия

### Этап 0 — Фундамент

- [x] F-001: Рефакторинг `src/index.ts` (4010 строк → модули)
- [x] F-002: Абстракция Transport Layer

### Этап 1 — Рыночная конкурентоспособность

- [x] MR-002: Task hierarchy (parentId, depth validation, cascade close)
- [x] MR-001: Streamable HTTP transport
- [x] MR-010: npm publish + MCPMarket listing
- [x] MR-005: Task dependency graph (DAG)
- [x] MR-003: Semantic search (BM25 + embeddings)
- [x] MR-004: REST API documentation (OpenAPI/Swagger)

### Этап 2 — Документация и распространение

- [x] MR-014: README overhaul
- [x] MR-013: Claude Code / Windsurf integration guides
- [x] MR-011: Claude Desktop / Cursor certified config
- [x] MR-006: VS Code extension

### Этап 3 — Качество и инфраструктура

- [x] Q-001–Q-003: Unit-тесты (search, tasks, knowledge)
- [ ] Q-004: E2E тесты MCP-инструментов
- [ ] TD-001: Рефакторинг монолитного index.ts
- [ ] TD-002: Типизация (убрать any)

### Критический путь

```
F-001 (refactor) ✅ → MR-001 (HTTP transport) ✅ → MR-010 (npm publish)
                                        → MR-011 (certified configs)
                                        → MR-006 (VS Code extension)
MR-002 (task hierarchy) ✅ → MR-005 (task dependency graph)
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
| F-006 | Убрать `any` типы в критических местах (vectorAdapter, toolRegistry) | medium | pending | 0.1 | — |

---

## Этап 1 — Транспорт

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| T-001 | AppContainer: композиция приложения с lifecycle | medium | pending | 1.1 | F-002 ✅ |
| T-002 | TCP/Unix multi-client сервер | medium | pending | 1.2 | T-001 |
| T-003 | Stdio single-client сервер (вынести из main) | low | pending | 1.3 | T-001 |

---

## Этап 2 — Многопользовательские сессии

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| S-001 | SessionManager: TTL, idle timeout, lifecycle | medium | pending | 2.1 | T-001 |
| S-002 | ToolExecutor и ToolContext (per-session) | medium | pending | 2.2 | S-001 |
| S-003 | Per-session rate limiting (token bucket) | medium | pending | 2.3 | S-001 |

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
| MR-015 | Web UI push: feat/ui → PR (Kanban, Knowledge, Search, Next.js) | critical | pending | — | — |

---

## Этап 6 — Синхронизация

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| SYNC-001 | Протокол версионирования и курсоры | medium | pending | 6.1 | — |
| SYNC-002 | RPC `mcp.sync.*` (delta/snapshot/ack) | medium | pending | 6.2 | SYNC-001 |
| SYNC-003 | Conflict resolver (3-way merge) | high | pending | 6.3 | SYNC-002 |
| SYNC-004 | Event sourcing и snapshots (GC) | low | pending | 6.4 | SYNC-002 |

---

## Технический долг и улучшения (не привязаны к этапу)

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| TD-001 | Рефакторинг монолитного `src/index.ts` (разделение на модули) | high | done | — | F-001 → done via F-001 |
| TD-002 | Типизация: заменить `any` на конкретные типы | medium | pending | F-006 | — |
| TD-003 | Удалить legacy-поддержку путей знаний | low | deferred | — | — |
| TD-004 | Rate limiting на уровне инструментов | medium | pending | S-003 | — |
| TD-005 | Версионирование документов знаний | low | pending | — | — |
| TD-006 | Добавить JSDoc для публичных функций | medium | pending | — | — |
| TD-007 | Migration от `uuid` v9 к `crypto.randomUUID()` | low | pending | — | — |
| TD-008 | ESM-совместимый импорт service-catalog | medium | pending | — | — |

---

## Качество и тестирование

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| Q-001 | Unit-тесты для `src/search/bm25.ts` (покрытие edge-cases) | high | done | 7.1 | — |
| Q-002 | Unit-тесты для `src/storage/tasks.ts` | high | done | 7.1 | — |
| Q-003 | Unit-тесты для `src/storage/knowledge.ts` | high | done | 7.1 | — |
| Q-004 | Интеграционные E2E тесты для основных MCP-инструментов | medium | pending | 7.1 | — |
| Q-005 | Coverage threshold enforcement (минимум 80%) | medium | pending | 7.4 | Q-001..Q-004 |
| Q-006 | Нагрузочные тесты для BM25 и vector search | low | pending | 7.2 | — |
| Q-007 | Schema validation tests (ajv для schemas/*.json) | low | pending | 7.1 | — |

---

## Документация

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| D-001 | API reference для всех MCP-инструментов | medium | pending | — | — |
| D-002 | Architecture Decision Records (ADR) | low | pending | — | — |
| D-003 | CONTRIBUTING.md для контрибьюторов | low | pending | — | — |
| D-004 | CHANGELOG.md (автоматический из conventional commits) | low | pending | — | — |

---

## Агент-инфраструктура

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| AI-001 | Создать AGENTS.md | critical | done | — | — |
| AI-002 | Создать BACKLOG.md | critical | done | — | — |
| AI-003 | Актуализировать ROADMAP.md | critical | done | — | — |
| AI-004 | Автоматическое обновление трекинг-троек в CI | low | pending | — | AI-001..AI-003 |
| AI-005 | Market research отчёт (PDF) | high | done | — | — |
| AI-006 | Web UI: Kanban, Knowledge, Search (Next.js) | high | pending | — | — |

---

## Блокированные

| ID | Задача | Причина | Статус |
|----|--------|---------|--------|
| MR-001 | Streamable HTTP transport | Завершён | done |
| MR-010 | npm publish + MCPMarket listing | — | done |
| MR-011 | Claude Desktop / Cursor certified config | — | done |
| MR-006 | VS Code extension | — | done |
| MR-012 | Real-time collaboration (WebSocket) | — | pending |
| T-001 | AppContainer: композиция с lifecycle | F-002 ✅, разблокирован | pending |
| T-002 | TCP/Unix multi-client сервер | Ждёт T-001 | blocked |
| S-001 | SessionManager: TTL, idle timeout | Ждёт T-001 | blocked |
| A-001 | mcp.authenticate + pre-auth | Ждёт S-001 | blocked |
| F-005 | Prometheus exporter | — | done |

---

## Архив (последние 20)

| ID | Задача | Закрыто | PR |
|----|--------|---------|-----|
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
| Q-001 | Unit-тесты для src/search/bm25.ts | 2026-04-05 | #41 |
| Q-002 | Unit-тесты для src/storage/tasks.ts | 2026-04-05 | #41 |
| Q-003 | Unit-тесты для src/storage/knowledge.ts | 2026-04-05 | #41 |
| MR-008 | Multi-project workspace: create, info, update, delete | 2026-04-05 | #39 |
| F-002 | Transport Layer абстракция (registry, stdio, http) | 2026-04-06 | #42 |
| F-003 | ToolRegistry: версионирование, ETag, пагинация | 2026-04-06 | #43 |
| F-004 | Structured logging with Pino (child loggers, LOG_LEVEL, LOG_FORMAT) | 2026-04-07 | #44 |
| F-005 | Prometheus exporter (tool calls, duration, resource reads, /metrics) | 2026-04-07 | #45 |

---

## Статистика бэклога

> Агент обновляет после каждого изменения.

**Последнее обновление:** 2026-04-07

| Категория | Всего | pending | in_progress | done | blocked | deferred |
|-----------|-------|---------|-------------|------|---------|----------|
| Foundation (0) | 6 | 1 | 0 | 5 | 0 | 0 |
| Transport (1) | 3 | 3 | 0 | 0 | 0 | 0 |
| Sessions (2) | 3 | 3 | 0 | 0 | 0 | 0 |
| Auth (3) | 3 | 3 | 0 | 0 | 0 | 0 |
| ACL (4) | 3 | 3 | 0 | 0 | 0 | 0 |
| Proxy (5) | 4 | 4 | 0 | 0 | 0 | 0 |
| Sync (6) | 4 | 4 | 0 | 0 | 0 | 0 |
| Market Research | 15 | 2 | 0 | 13 | 0 | 0 |
| Tech Debt | 8 | 6 | 0 | 1 | 0 | 1 |
| Quality | 7 | 4 | 0 | 3 | 0 | 0 |
| Docs | 4 | 4 | 0 | 0 | 0 | 0 |
| Agent Infra | 6 | 2 | 0 | 4 | 0 | 0 |
| **Итого** | **66** | **41** | **0** | **26** | **0** | **1** |
