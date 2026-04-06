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

### Этап A — Skills System

- [ ] SK-001: Skills CRUD (Markdown + YAML frontmatter)
- [ ] SK-002: Skill invocation pipeline
- [ ] SK-003: Skill discovery + импорт из awesome-cursorrules
- [ ] SK-004: Pre-built skill templates
- [ ] SK-005: Skill sharing + конвертеры форматов
- [ ] SK-006: Skill permissions (Agent Skills spec)

### Этап B — Rules & Policies Engine

- [ ] RL-001: Rules storage (global → project → user)
- [ ] RL-002: Rules evaluation (runtime guard checks)
- [ ] RL-003: Policy-as-code (JSON/DSL)
- [ ] RL-004: Built-in rule packs
- [ ] RL-005: Rule enforcement hooks
- [ ] RL-006: Rule import (.cursorrules, CLAUDE.md, .clinerules)

### Этап C — Workflows (AI Agent Flows)

- [ ] WF-001: Workflow DAG builder
- [ ] WF-002: Workflow executor
- [ ] WF-003: Workflow templates
- [ ] WF-004: Human-in-the-loop
- [ ] WF-005: Workflow state persistence
- [ ] WF-006: Workflow chaining (subflow)

### Этап D — Developer Memory & Context

- [ ] MEM-001: Session memory
- [ ] MEM-002: Entity graph
- [ ] MEM-003: Context distillation
- [ ] MEM-004: Memory import/export

### Этап E — Integration Hub

- [ ] INT-001: GitHub connector
- [ ] INT-002: Jira/YouTrack connector
- [ ] INT-003: Slack/Discord connector
- [ ] INT-004: Connector framework (plug-in SDK)

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
| F-006 | Убрать `any` типы в критических местах (vectorAdapter, toolRegistry) | medium | done | 0.1 | — |

---

## Этап 1 — Транспорт

| ID | Задача | Приоритет | Статус | ROADMAP | Зависимости |
|----|--------|-----------|--------|---------|-------------|
| T-001 | AppContainer: композиция приложения с lifecycle | medium | done | 1.1 | F-002 ✅ |
| T-002 | TCP/Unix multi-client сервер | medium | pending | 1.2 | T-001 ✅ |
| T-003 | Stdio single-client сервер (вынести из main) | low | pending | 1.3 | T-001 ✅ |

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
| TD-002 | Типизация: заменить `any` на конкретные типы | medium | done | F-006 ✅ | — |
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
| RL-005 | Rule enforcement hooks: pre/post hooks на MCP tool calls. Блокировка, предупреждение, логирование, auto-fix | high | pending | — | RL-002 |
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
| INT-001 | GitHub connector: issues, PRs, commits, code search. MCP tools: github_issue_*, github_pr_*, github_repo_* | high | pending | — | — |
| INT-002 | Jira/YouTrack connector: синхронизация задач между mcp-task-knowledge и внешними таск-трекерами | medium | pending | — | INT-004 |
| INT-003 | Slack/Discord connector: уведомления, поиск, отправка сообщений из AI-агента | medium | pending | — | INT-004 |
| INT-004 | Connector framework: plug-in architecture для добавления коннекторов. SDK + registry + lifecycle hooks | high | pending | — | — |

---

## Блокированные

| ID | Задача | Причина | Статус |
|----|--------|---------|--------|
| MR-001 | Streamable HTTP transport | Завершён | done |
| MR-010 | npm publish + MCPMarket listing | — | done |
| MR-011 | Claude Desktop / Cursor certified config | — | done |
| MR-006 | VS Code extension | — | done |
| MR-012 | Real-time collaboration (WebSocket) | — | pending |
| T-001 | AppContainer: композиция с lifecycle | Завершён | done |
| T-002 | TCP/Unix multi-client сервер | Ждёт T-001 ✅ | pending |
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
| F-006 | Type safety: replace any with concrete types (context, tool-registry, vector, config, metrics) | 2026-04-07 | #46 |
| T-001 | AppContainer: lifecycle manager with state machine, cleanup, signal handling | 2026-04-07 | #47 |

---

## Статистика бэклога

> Агент обновляет после каждого изменения.

**Последнее обновление:** 2026-04-07

| Категория | Всего | pending | in_progress | done | blocked | deferred |
|-----------|-------|---------|-------------|------|---------|----------|
| Foundation (0) | 6 | 0 | 0 | 6 | 0 | 0 |
| Transport (1) | 3 | 2 | 0 | 1 | 0 | 0 |
| Sessions (2) | 3 | 3 | 0 | 0 | 0 | 0 |
| Auth (3) | 3 | 3 | 0 | 0 | 0 | 0 |
| ACL (4) | 3 | 3 | 0 | 0 | 0 | 0 |
| Proxy (5) | 4 | 4 | 0 | 0 | 0 | 0 |
| Sync (6) | 4 | 4 | 0 | 0 | 0 | 0 |
| Market Research | 15 | 2 | 0 | 13 | 0 | 0 |
| Tech Debt | 8 | 5 | 0 | 2 | 0 | 1 |
| Quality | 7 | 4 | 0 | 3 | 0 | 0 |
| Docs | 4 | 4 | 0 | 0 | 0 | 0 |
| Agent Infra | 6 | 2 | 0 | 4 | 0 | 0 |
| **Skills (A)** | **6** | **6** | **0** | **0** | **0** | **0** |
| **Rules (B)** | **6** | **6** | **0** | **0** | **0** | **0** |
| **Workflows (C)** | **6** | **6** | **0** | **0** | **0** | **0** |
| **Memory (D)** | **4** | **4** | **0** | **0** | **0** | **0** |
| **Integration Hub (E)** | **4** | **4** | **0** | **0** | **0** | **0** |
| **Итого** | **94** | **68** | **0** | **28** | **0** | **1** |
