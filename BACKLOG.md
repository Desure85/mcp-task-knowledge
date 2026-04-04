# BACKLOG.md — Стратегия и бэклог

> **Назначение:** Одна точка правды для стратегии и задач проекта `mcp-task-knowledge`.
> Агент обновляет статусы после каждого этапа/подэтапа работы.
> **Приоритеты актуализированы на основе исследования рынка** (см. `MARKET-RESEARCH.md`).

---

## Стратегия

> Дорожная карта проекта. Чеклисты этапов с привязкой к задачам из «Очереди».

### Sprint 1 — Foundation + Observability

> **Обоснование:** Решает топ-3 боли рынка (debugging, observability, token overhead). Без этого нельзя продвигаться в production.

- [ ] Рефакторинг `src/index.ts`: вынести регистрацию инструментов (F-001)
- [ ] Структурированное логирование — Pino/Winston (F-004)
- [ ] Lean tool schemas: уменьшить token overhead (F-007)
- [ ] Unit-тесты: bm25, tasks, knowledge (Q-001, Q-002, Q-003)
- [ ] Graceful shutdown: cleanup при SIGTERM/SIGINT (F-008)
- [ ] Streaming для больших результатов (F-009)

### Sprint 2 — Auth + Rate Limiting

> **Обоснование:** #1 боль рынка — multi-user auth. Enterprise не рассматривает MCP без auth.

- [ ] Transport Layer абстракция (F-002)
- [ ] AppContainer: композиция приложения (T-001)
- [ ] SessionManager: TTL, idle timeout, lifecycle (S-001)
- [ ] Per-session rate limiting (S-003)
- [ ] JWT/JWKS validation (A-002)
- [ ] `mcp.authenticate` + pre-auth method window (A-001)
- [ ] Привязка tokenClaims к session TTL (A-003)

### Sprint 3 — Quality + UX

> **Обоснование:** Перед Web UI нужно качество, документация и простота входа.

- [ ] E2E тесты для основных MCP-инструментов (Q-004)
- [ ] Coverage threshold enforcement — 80% (Q-005)
- [ ] Getting Started guide (D-005)
- [ ] API reference для всех MCP-инструментов (D-001)
- [ ] Реестр инструментов: версионирование, etag, пагинация (F-003)
- [ ] Prometheus exporter (F-005)

### Sprint 4 — Web UI MVP

> **Обоснование:** #9 боль — нужен визуальный интерфейс.

- [ ] Next.js + Auth foundation (W-001)
- [ ] Tasks board — Kanban/List view (W-002)
- [ ] Knowledge viewer — Markdown/MDX (W-003)
- [ ] Prompt management UI (W-004)
- [ ] Realtime updates — WebSocket (W-005)

### Этап 4 — ACL (отложен)

- [ ] Модель ACL и policy definitions (ACL-001)
- [ ] Фильтрация списков инструментов/ресурсов (ACL-002)
- [ ] Проверка авторизации при вызове инструментов (ACL-003)

### Этап 5 — Thin Proxy (отложен)

- [ ] Proxy bootstrap и конфигурация (P-001)
- [ ] Зеркалирование инструментов/ресурсов (P-002)
- [ ] Проброс запросов/уведомлений, flow control (P-003)
- [ ] Устойчивость и observability прокси (P-004)

### Этап 6 — Синхронизация (отложен)

- [ ] Протокол версионирования и курсоры (SYNC-001)
- [ ] RPC `mcp.sync.*` (SYNC-002)
- [ ] Conflict resolver — 3-way merge (SYNC-003)
- [ ] Event sourcing и snapshots (SYNC-004)

### Этап 8 — Безопасность+ (отложен)

- [ ] Short-lived токены и refresh flow (SEC-001)
- [ ] Audit logging (SEC-002)
- [ ] TLS/mTLS и ротация сертификатов (SEC-003)
- [ ] Secret management (SEC-004)

### Этап 10 — Масштабируемость (отложен)

- [ ] Load balancer integration & sticky sessions (SC-001)
- [ ] Tool sharding across nodes (SC-002)
- [ ] Cluster state synchronization (SC-003)

### Этап 11 — Интеграции (отложен)

- [ ] Pub/Sub события и подписки (I-001)
- [ ] WebSocket транспорт (I-002)
- [ ] REST-обёртки вокруг инструментов (I-003)

### Этап 12 — Умные фичи (отложен)

- [ ] Dynamic tools (SM-001)
- [ ] Policy-as-code (SM-002)

---

## Очередь

### Sprint 1 — Foundation + Observability

| ID | Задача | Приоритет | Статус | Зависимости | Рынок |
|----|--------|-----------|--------|-------------|-------|
| F-001 | Рефакторинг `src/index.ts`: вынести регистрацию инструментов в отдельные модули | **critical** | pending | — | Блокирует всё |
| F-004 | Добавить структурированное логирование (Pino или Winston) | **critical** | pending | — | #5 боль: debugging кошмар |
| F-007 | Lean tool schemas: уменьшить token overhead описаний инструментов | **high** | pending | F-001 | #3 боль: 244K tokens |
| F-006 | Убрать `any` типы в критических местах (vectorAdapter, toolRegistry) | **high** | pending | — | Качество кода |
| Q-001 | Unit-тесты для `src/search/bm25.ts` (edge-cases) | **critical** | pending | — | Regression safety |
| Q-002 | Unit-тесты для `src/storage/tasks.ts` | **critical** | pending | — | Regression safety |
| Q-003 | Unit-тесты для `src/storage/knowledge.ts` | **critical** | pending | — | Regression safety |
| F-008 | Graceful shutdown: cleanup при SIGTERM/SIGINT | **high** | pending | F-001 | Production readiness |
| F-009 | Streaming для больших результатов (tool responses) | medium | pending | F-001 | UX для больших данных |

### Sprint 2 — Auth + Rate Limiting

| ID | Задача | Приоритет | Статус | Зависимости | Рынок |
|----|--------|-----------|--------|-------------|-------|
| F-002 | Создать абстракцию Transport Layer (подготовка к TCP/WS) | **high** | pending | F-001 | Multi-client prep |
| T-001 | AppContainer: композиция приложения с lifecycle | **high** | pending | F-001, F-002 | Multi-client prep |
| S-001 | SessionManager: TTL, idle timeout, lifecycle | **high** | pending | T-001 | Multi-user prep |
| S-003 | Per-session rate limiting (token bucket) | **high** | pending | S-001 | #8 боль + OWASP |
| A-002 | JWT/JWKS validation | **high** | pending | S-001 | **#1 боль рынка** |
| A-001 | `mcp.authenticate` + pre-auth method window | high | pending | S-001 | Auth flow |
| A-003 | Привязка tokenClaims к session TTL | medium | pending | A-002, S-001 | Security |

### Sprint 3 — Quality + UX

| ID | Задача | Приоритет | Статус | Зависимости | Рынок |
|----|--------|-----------|--------|-------------|-------|
| Q-004 | Интеграционные E2E тесты для основных MCP-инструментов | medium | pending | Q-001..Q-003 | Production confidence |
| Q-005 | Coverage threshold enforcement (минимум 80%) | medium | pending | Q-001..Q-004 | Regression safety |
| D-005 | Getting Started guide (быстрый старт для новичков) | medium | pending | — | #19 боль: сложность |
| D-001 | API reference для всех MCP-инструментов | medium | pending | — | Developer adoption |
| F-003 | Реестр инструментов: версионирование, etag, пагинация | medium | pending | F-001 | Tool discovery |
| F-005 | Метрики: Prometheus exporter | medium | pending | F-004 | #7 боль: observability |

### Sprint 4 — Web UI MVP

| ID | Задача | Приоритет | Статус | Зависимости | Рынок |
|----|--------|-----------|--------|-------------|-------|
| W-001 | Next.js + Auth foundation (OIDC/JWT) | **high** | pending | A-002 | Web UI базис |
| W-002 | Tasks board (Kanban/List view) | **high** | pending | W-001 | **#9 боль: visual tasks** |
| W-003 | Knowledge viewer (Markdown/MDX) | medium | pending | W-001 | Visual knowledge |
| W-004 | Prompt management UI (версии/варианты/A/B) | medium | pending | W-001 | Уникальная фича |
| W-005 | Realtime updates (WebSocket) | low | pending | W-001 | Enhancement |

### ACL (отложен)

| ID | Задача | Приоритет | Статус | Зависимости |
|----|--------|-----------|--------|-------------|
| ACL-001 | Модель ACL и policy definitions | medium | pending | A-002 |
| ACL-002 | Фильтрация списков инструментов/ресурсов по ACL | medium | pending | ACL-001 |
| ACL-003 | Проверка авторизации при вызове инструментов | medium | pending | ACL-001 |

### Thin Proxy (отложен)

| ID | Задача | Приоритет | Статус | Зависимости |
|----|--------|-----------|--------|-------------|
| P-001 | Proxy bootstrap и конфигурация | low | pending | A-002 |
| P-002 | Зеркалирование инструментов/ресурсов через прокси | low | pending | P-001 |
| P-003 | Проброс запросов/уведомлений, flow control | low | pending | P-002 |
| P-004 | Устойчивость и observability прокси | low | pending | P-003 |

### Синхронизация (отложен)

| ID | Задача | Приоритет | Статус | Зависимости |
|----|--------|-----------|--------|-------------|
| SYNC-001 | Протокол версионирования и курсоры | low | pending | — |
| SYNC-002 | RPC `mcp.sync.*` (delta/snapshot/ack) | low | pending | SYNC-001 |
| SYNC-003 | Conflict resolver (3-way merge) | medium | pending | SYNC-002 |
| SYNC-004 | Event sourcing и snapshots (GC) | low | pending | SYNC-002 |

### Безопасность+ (отложен)

| ID | Задача | Приоритет | Статус | Зависимости |
|----|--------|-----------|--------|-------------|
| SEC-001 | Short-lived токены и refresh flow | medium | pending | A-002 |
| SEC-002 | Audit logging | medium | pending | F-004 |
| SEC-003 | TLS/mTLS и ротация сертификатов | low | pending | A-002 |
| SEC-004 | Secret management (vault/KMS) | low | pending | A-002 |

### Transport+ (отложен)

| ID | Задача | Приоритет | Статус | Зависимости |
|----|--------|-----------|--------|-------------|
| T-002 | TCP/Unix multi-client сервер | low | pending | T-001 |
| T-003 | Stdio single-client сервер (вынести из main) | low | pending | T-001 |

### Масштабируемость (отложен)

| ID | Задача | Приоритет | Статус | Зависимости |
|----|--------|-----------|--------|-------------|
| SC-001 | Load balancer integration & sticky sessions | low | pending | T-002 |
| SC-002 | Tool sharding across nodes | low | pending | T-002 |
| SC-003 | Cluster state synchronization | low | pending | S-001 |

### Интеграции (отложен)

| ID | Задача | Приоритет | Статус | Зависимости |
|----|--------|-----------|--------|-------------|
| I-001 | Pub/Sub события и подписки | low | pending | T-002 |
| I-002 | WebSocket транспорт | low | pending | T-002 |
| I-003 | REST-обёртки вокруг инструментов | low | pending | T-002 |

### Умные фичи (отложен)

| ID | Задача | Приоритет | Статус | Зависимости |
|----|--------|-----------|--------|-------------|
| SM-001 | Dynamic tools | low | pending | F-003 |
| SM-002 | Policy-as-code (DSL/JSON, Git) | low | pending | ACL-001 |

### Технический долг

| ID | Задача | Приоритет | Статус | Зависимости |
|----|--------|-----------|--------|-------------|
| TD-001 | Рефакторинг монолитного `src/index.ts` | **critical** | pending | F-001 |
| TD-002 | Типизация: заменить `any` на конкретные типы | high | pending | F-006 |
| TD-003 | Удалить legacy-поддержку путей знаний | low | deferred | — |
| TD-004 | Rate limiting на уровне инструментов | high | pending | S-003 |
| TD-005 | Версионирование документов знаний | medium | pending | — |
| TD-006 | Добавить JSDoc для публичных функций | medium | pending | — |
| TD-007 | Migration от `uuid` v9 к `crypto.randomUUID()` | low | pending | — |
| TD-008 | ESM-совместимый импорт service-catalog | medium | pending | — |

### Качество и тестирование (дополнительно)

| ID | Задача | Приоритет | Статус | Зависимости |
|----|--------|-----------|--------|-------------|
| Q-006 | Нагрузочные тесты для BM25 и vector search | low | pending | — |
| Q-007 | Schema validation tests (ajv для schemas/*.json) | low | pending | — |

### Документация

| ID | Задача | Приоритет | Статус | Зависимости |
|----|--------|-----------|--------|-------------|
| D-002 | Architecture Decision Records (ADR) | low | pending | — |
| D-003 | CONTRIBUTING.md для контрибьюторов | low | pending | — |
| D-004 | CHANGELOG.md (автоматический из conventional commits) | low | pending | — |

### Агент-инфраструктура

| ID | Задача | Приоритет | Статус | Зависимости |
|----|--------|-----------|--------|-------------|
| AI-001 | Создать AGENTS.md | critical | done | — |
| AI-002 | Создать BACKLOG.md | critical | done | — |
| AI-003 | Актуализировать ROADMAP.md | critical | done | — |
| AI-005 | Провести исследование рынка MCP | critical | done | — |
| AI-006 | Приоритизировать бэклог на основе исследования | critical | done | AI-005 |
| AI-007 | Переписать AGENTS.md по правилам воркфлоу | critical | done | — |
| AI-008 | Переструктурировать BACKLOG.md (Стратегия + Очередь) | critical | done | — |
| AI-009 | Создать CHANGELOG.md | medium | done | — |
| AI-004 | Автоматическое обновление трекинг-пары в CI | low | pending | AI-001..AI-003 |

---

## Блокированные

| ID | Задача | Причина | Статус |
|----|--------|---------|--------|
| — | — | — | — |

> Пока нет заблокированных задач. При появлении — добавлять сюда с описанием блокера.

---

## Архив (последние 20)

| ID | Задача | Закрыто | PR |
|----|--------|---------|-----|
| AI-001 | Создать AGENTS.md | 2026-04-04 | #23 |
| AI-002 | Создать BACKLOG.md | 2026-04-04 | #23 |
| AI-003 | Актуализировать ROADMAP.md | 2026-04-04 | #23 |
| AI-005 | Провести исследование рынка MCP | 2026-04-04 | #23 |
| AI-006 | Приоритизировать бэклог на основе исследования | 2026-04-04 | #23 |

---

## Статистика бэклога

> Агент обновляет после каждого изменения.

**Последнее обновление:** 2026-04-04 (переструктурировано: трекинг-тройка → трекинг-пара)

| Категория | Всего | critical | high | medium | low | done | blocked |
|-----------|-------|----------|------|--------|-----|------|---------|
| Sprint 1: Foundation | 9 | 4 | 3 | 1 | 0 | 0 | 0 |
| Sprint 2: Auth | 7 | 0 | 5 | 2 | 0 | 0 | 0 |
| Sprint 3: Quality+UX | 6 | 0 | 0 | 6 | 0 | 0 | 0 |
| Sprint 4: Web UI | 5 | 0 | 2 | 2 | 1 | 0 | 0 |
| ACL | 3 | 0 | 0 | 3 | 0 | 0 | 0 |
| Proxy | 4 | 0 | 0 | 0 | 4 | 0 | 0 |
| Sync | 4 | 0 | 1 | 0 | 3 | 0 | 0 |
| Security+ | 4 | 0 | 0 | 2 | 2 | 0 | 0 |
| Transport+ | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| Scalability | 3 | 0 | 0 | 0 | 3 | 0 | 0 |
| Integrations | 3 | 0 | 0 | 0 | 3 | 0 | 0 |
| Smart | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| Tech Debt | 8 | 1 | 2 | 3 | 1 | 0 | 0 |
| Quality (extra) | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| Docs | 3 | 0 | 0 | 0 | 3 | 0 | 0 |
| Agent Infra | 10 | 3 | 0 | 1 | 1 | 5 | 0 |
| **Итого** | **75** | **8** | **13** | **21** | **27** | **5** | **0** |
