# BACKLOG.md — Бэклог задач

> **Назначение:** Приоритезированный список задач для развития проекта `mcp-task-knowledge`.
> Агент обновляет статусы после каждого этапа/подэтапа работы.
> Связь с ROADMAP.md: каждая задача ссылается на этап дорожной карты.
> **Приоритеты актуализированы на основе исследования рынка** (см. `MARKET-RESEARCH.md`).

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

## Sprint 1 — Foundation + Observability

> **Обоснование:** Решает топ-3 боли рынка (debugging, observability, token overhead). Без этого нельзя продвигаться в production. См. MARKET-RESEARCH.md §6.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости | Рынок |
|----|--------|-----------|--------|---------|-------------|-------|
| F-001 | Рефакторинг `src/index.ts`: вынести регистрацию инструментов в отдельные модули | **critical** | pending | 0.1 | — | Блокирует всё |
| F-004 | Добавить структурированное логирование (Pino или Winston) | **critical** | pending | 0.4 | — | #5 боль: debugging кошмар |
| F-007 | Lean tool schemas: уменьшить token overhead описаний инструментов | **high** | pending | 0.1 | F-001 | #3 боль: 244K tokens (Cloudflare) |
| F-006 | Убрать `any` типы в критических местах (vectorAdapter, toolRegistry) | **high** | pending | 0.1 | — | Качество кода |
| Q-001 | Unit-тесты для `src/search/bm25.ts` (покрытие edge-cases) | **critical** | pending | 7.1 | — | Regression safety |
| Q-002 | Unit-тесты для `src/storage/tasks.ts` | **critical** | pending | 7.1 | — | Regression safety |
| Q-003 | Unit-тесты для `src/storage/knowledge.ts` | **critical** | pending | 7.1 | — | Regression safety |
| F-008 | Graceful shutdown: cleanup при SIGTERM/SIGINT | **high** | pending | 1.1 | F-001 | Production readiness |
| F-009 | Streaming для больших результатов (tool responses) | medium | pending | 1.1 | F-001 | UX для больших данных |

---

## Sprint 2 — Auth + Rate Limiting

> **Обоснование:** #1 боль рынка — multi-user auth (GitHub proposal #234, 10+ обсуждений). Enterprise не рассматривает MCP без auth.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости | Рынок |
|----|--------|-----------|--------|---------|-------------|-------|
| F-002 | Создать абстракцию Transport Layer (подготовка к TCP/WS) | **high** | pending | 0.2 | F-001 | Основа multi-client |
| T-001 | AppContainer: композиция приложения с lifecycle | **high** | pending | 1.1 | F-001, F-002 | Multi-client prep |
| S-001 | SessionManager: TTL, idle timeout, lifecycle | **high** | pending | 2.1 | T-001 | Multi-user prep |
| S-003 | Per-session rate limiting (token bucket) | **high** | pending | 2.3 | S-001 | #8 боль + OWASP MCP-03 |
| A-002 | JWT/JWKS validation | **high** | pending | 3.2 | S-001 | **#1 боль рынка** |
| A-001 | `mcp.authenticate` + pre-auth method window | high | pending | 3.1 | S-001 | Auth flow |
| A-003 | Привязка tokenClaims к session TTL | medium | pending | 3.3 | A-002, S-001 | Security |

---

## Sprint 3 — Quality + UX

> **Обоснование:** Перед Web UI нужно качество, документация и простота входа (#19 боль — сложность конфигурации).

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости | Рынок |
|----|--------|-----------|--------|---------|-------------|-------|
| Q-004 | Интеграционные E2E тесты для основных MCP-инструментов | **medium** | pending | 7.1 | Q-001..Q-003 | Production confidence |
| Q-005 | Coverage threshold enforcement (минимум 80%) | **medium** | pending | 7.4 | Q-001..Q-004 | Regression safety |
| D-005 | Getting Started guide (быстрый старт для новичков) | **medium** | pending | — | — | #19 боль: сложность |
| D-001 | API reference для всех MCP-инструментов | **medium** | pending | — | — | Developer adoption |
| F-003 | Реестр инструментов: версионирование, etag, пагинация | **medium** | pending | 0.3 | F-001 | Tool discovery |
| F-005 | Метрики: Prometheus exporter (счётчики вызовов, latency) | **medium** | pending | 0.4 | F-004 | #7 боль: observability |

---

## Sprint 4 — Web UI MVP

> **Обоснование:** #9 боль — нужен визуальный интерфейс. Kanban для задач + просмотр знаний.

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости | Рынок |
|----|--------|-----------|--------|---------|-------------|-------|
| W-001 | Next.js + Auth foundation (OIDC/JWT) | **high** | pending | 13.1 | A-002 | Web UI базис |
| W-002 | Tasks board (Kanban/List view) | **high** | pending | 13.2 | W-001 | **#9 боль: visual tasks** |
| W-003 | Knowledge viewer (Markdown/MDX) | **medium** | pending | 13.3 | W-001 | Visual knowledge |
| W-004 | Prompt management UI (версии/варианты/A/B) | **medium** | pending | 13.4 | W-001 | Уникальная фича |
| W-005 | Realtime updates (WebSocket) | low | pending | 13.5 | W-001 | Enhancement |

---

## Отложенные этапы

> Эти этапы нужны, но рынок не требует их срочно. Реализовывать после стабилизации ядра.

### ACL (Этап 4)

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| ACL-001 | Модель ACL и policy definitions | medium | pending | 4.1 | A-002 |
| ACL-002 | Фильтрация списков инструментов/ресурсов по ACL | medium | pending | 4.2 | ACL-001 |
| ACL-003 | Проверка авторизации при вызове инструментов | medium | pending | 4.3 | ACL-001 |

### Thin Proxy (Этап 5)

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| P-001 | Proxy bootstrap и конфигурация | low | pending | 5.1 | A-002 |
| P-002 | Зеркалирование инструментов/ресурсов через прокси | low | pending | 5.2 | P-001 |
| P-003 | Проброс запросов/уведомлений, flow control | low | pending | 5.3 | P-002 |
| P-004 | Устойчивость и observability прокси | low | pending | 5.4 | P-003 |

### Синхронизация (Этап 6)

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| SYNC-001 | Протокол версионирования и курсоры | low | pending | 6.1 | — |
| SYNC-002 | RPC `mcp.sync.*` (delta/snapshot/ack) | low | pending | 6.2 | SYNC-001 |
| SYNC-003 | Conflict resolver (3-way merge) | medium | pending | 6.3 | SYNC-002 |
| SYNC-004 | Event sourcing и snapshots (GC) | low | pending | 6.4 | SYNC-002 |

### Безопасность+ (Этап 8)

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| SEC-001 | Short-lived токены и refresh flow | medium | pending | 8.1 | A-002 |
| SEC-002 | Audit logging | medium | pending | 8.2 | F-004 |
| SEC-003 | TLS/mTLS и ротация сертификатов | low | pending | 8.3 | A-002 |
| SEC-004 | Secret management (vault/KMS) | low | pending | 8.4 | A-002 |

### Transport+ (Этап 1 доп.)

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| T-002 | TCP/Unix multi-client сервер | low | pending | 1.2 | T-001 |
| T-003 | Stdio single-client сервер (вынести из main) | low | pending | 1.3 | T-001 |

### Масштабируемость (Этап 10) — отложено

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| SC-001 | Load balancer integration & sticky sessions | low | pending | 10.1 | T-002 |
| SC-002 | Tool sharding across nodes | low | pending | 10.2 | T-002 |
| SC-003 | Cluster state synchronization | low | pending | 10.3 | S-001 |

### Интеграции (Этап 11) — отложено

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| I-001 | Pub/Sub события и подписки | low | pending | 11.1 | T-002 |
| I-002 | WebSocket транспорт | low | pending | 11.2 | T-002 |
| I-003 | REST-обёртки вокруг инструментов | low | pending | 11.3 | T-002 |

### Умные фичи (Этап 12) — отложено

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| SM-001 | Dynamic tools | low | pending | 12.1 | F-003 |
| SM-002 | Policy-as-code (DSL/JSON, Git) | low | pending | 12.2 | ACL-001 |

---

## Технический долг и улучшения

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| TD-001 | Рефакторинг монолитного `src/index.ts` (разделение на модули) | **critical** | pending | F-001 | — |
| TD-002 | Типизация: заменить `any` на конкретные типы | high | pending | F-006 | — |
| TD-003 | Удалить legacy-поддержку путей знаний | low | deferred | — | — |
| TD-004 | Rate limiting на уровне инструментов | high | pending | S-003 | — |
| TD-005 | Версионирование документов знаний | medium | pending | — | — |
| TD-006 | Добавить JSDoc для публичных функций | medium | pending | — | — |
| TD-007 | Migration от `uuid` v9 к `crypto.randomUUID()` | low | pending | — | — |
| TD-008 | ESM-совместимый импорт service-catalog | medium | pending | — | — |

---

## Качество и тестирование (дополнительно)

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| Q-006 | Нагрузочные тесты для BM25 и vector search | low | pending | 7.2 | — |
| Q-007 | Schema validation tests (ajv для schemas/*.json) | low | pending | 7.1 | — |

---

## Документация

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
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
| AI-005 | Провести исследование рынка MCP | critical | done | — | — |
| AI-006 | Приоритизировать бэклог на основе исследования | critical | done | — | AI-005 |
| AI-004 | Автоматическое обновление трекинг-троек в CI | low | pending | — | AI-001..AI-003 |

---

## Статистика бэклога

> Агент обновляет после каждого изменения.

**Последнее обновление:** 2026-04-04 (приоритизация по результатам исследования)

| Категория | Всего | critical | high | medium | low | done | deferred |
|-----------|-------|----------|------|--------|-----|------|----------|
| Sprint 1: Foundation | 9 | 4 | 3 | 1 | 0 | 0 | 0 |
| Sprint 2: Auth | 7 | 0 | 5 | 2 | 0 | 0 | 0 |
| Sprint 3: Quality+UX | 6 | 0 | 0 | 6 | 0 | 0 | 0 |
| Sprint 4: Web UI | 5 | 0 | 2 | 2 | 1 | 0 | 0 |
| ACL (4) | 3 | 0 | 0 | 3 | 0 | 0 | 0 |
| Proxy (5) | 4 | 0 | 0 | 0 | 4 | 0 | 0 |
| Sync (6) | 4 | 0 | 1 | 0 | 3 | 0 | 0 |
| Security+ (8) | 4 | 0 | 0 | 2 | 2 | 0 | 0 |
| Transport+ | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| Scalability (10) | 3 | 0 | 0 | 0 | 3 | 0 | 0 |
| Integrations (11) | 3 | 0 | 0 | 0 | 3 | 0 | 0 |
| Smart (12) | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| Tech Debt | 8 | 1 | 2 | 3 | 1 | 0 | 1 |
| Quality (extra) | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| Docs | 3 | 0 | 0 | 0 | 3 | 0 | 0 |
| Agent Infra | 6 | 2 | 0 | 0 | 1 | 3 | 0 |
| **Итого** | **71** | **7** | **13** | **20** | **27** | **3** | **1** |
