# MCP Server Roadmap / Дорожная карта MCP-сервера

Дата: 2025-09-27 09:50 (+03)

---

## Overview (EN)

This document summarizes the roadmap for the MCP server evolution from a single stdio process to a production-grade, multi-user, networked platform with authorization, ACL, thin proxy, synchronization, and a Web UI for tasks/prompts/knowledge.

Key outcomes:
- Unified JSON‑RPC engine and transport abstractions (stdio/TCP/Unix/WS).
- Multi-user sessions with auth (Bearer/JWT) and ACL.
- Thin Proxy ↔ Thick Server architecture.
- Reliable catalog synchronization (delta/snapshot/ack, conflict‑resolution).
- Comprehensive testing (E2E, load, fuzz, chaos).
- Web UI (Next.js) for tasks/prompts/knowledge with realtime updates.

Export to Obsidian is configured in merge mode. See your vault under `/data/obsidian`.

## Обзор (RU)

Этот документ описывает дорожную карту развития MCP‑сервера: от процесса stdio к промышленной многопользовательской платформе с авторизацией, ACL, тонким прокси, синхронизацией и Web UI для задач/промптов/знаний.

Ключевые результаты:
- Единый JSON‑RPC движок и абстракции транспорта (stdio/TCP/Unix/WS).
- Многопользовательские сессии, авторизация (Bearer/JWT), ACL.
- Архитектура Thin Proxy ↔ Thick Server.
- Надёжная синхронизация каталога (delta/snapshot/ack, разрешение конфликтов).
- Полное тестирование (E2E, нагрузка, фаззинг, хаос‑тесты).
- Web UI (Next.js) для задач/промптов/знаний с realtime‑обновлениями.

---

## Phases (EN)

- **Stage 0 — Architectural foundation**: JSON‑RPC engine, transport layer, registry, configuration/logging/metrics.
- **Stage 1 — Transport**: stdio/TCP/Unix support, multi-client server.
- **Stage 2 — Sessions**: SessionManager, ToolExecutor/ToolContext, per-session rate limiting.
- **Stage 3 — Authorization**: Bearer/JWT flow, JWKS validation, pre-auth method window.
- **Stage 4 — ACL**: policy model, list filtering, execution checks.
- **Stage 5 — Thin proxy**: bootstrap, tool/resource mirroring, request/notification forwarding, resiliency.
- **Stage 6 — Synchronization**: delta/snapshot/ack protocol, conflict resolver, event sourcing, E2E stability.
- **Stage 7 — Testing & QA**: E2E, load, fuzzing, chaos, CI coverage.
- **Stage 8 — Security**: short-lived tokens, audit logging, TLS/mTLS, secret management, auth protection.
- **Stage 9 — Developer experience**: hot registration, namespaces/filters, proxy caching, Dev CLI, hot reload.
- **Stage 10 — Scalability**: load balancing, sticky sessions, sharding, cluster state sync, readiness/drain, autoscaling.
- **Stage 11 — Integrations**: Pub/Sub events, WebSocket transport, REST and gRPC wrappers.
- **Stage 12 — Smart features**: dynamic tools, policy-as-code, usage analytics, recommendations.
- **Stage 13 — Web UI**: Next.js foundation, Kanban board, MDX editor, prompt management, realtime updates, feedback, CI/Docker.

## Этапы (RU)

- **Этап 0 — Архитектурный каркас**: JSON‑RPC ядро, транспорт, реестр, конфигурация/логи/метрики.
- **Этап 1 — Транспорт**: поддержка stdio/TCP/Unix, многоклиентский сервер.
- **Этап 2 — Сессии**: SessionManager, ToolExecutor/ToolContext, пер-сессионные лимиты.
- **Этап 3 — Авторизация**: Bearer/JWT, проверка JWKS, окно разрешённых методов до входа.
- **Этап 4 — ACL**: модель политик, фильтрация списков, проверки при вызове инструментов.
- **Этап 5 — Тонкий прокси**: bootstrap, зеркалирование описаний, проброс запросов/уведомлений, устойчивость.
- **Этап 6 — Синхронизация**: протокол delta/snapshot/ack, разрешение конфликтов, event‑sourcing, E2E устойчивость.
- **Этап 7 — Тестирование и качество**: e2e, нагрузка, фаззинг, хаос‑тесты, CI-отчётность.
- **Этап 8 — Безопасность**: short‑lived токены, аудит, TLS/mTLS, управление секретами, защита аутентификации.
- **Этап 9 — DX**: горячая регистрация, namespaces/filters, кеш в прокси, Dev CLI, hot reload.
- **Этап 10 — Масштабируемость**: LB и sticky sessions, шардирование, синхронизация состояния кластера, readiness/drain, авто‑скейлинг.
- **Этап 11 — Интеграции**: Pub/Sub события, WebSocket транспорт, REST и gRPC-обёртки.
- **Этап 12 — Умные фичи**: Dynamic tools, policy-as-code, аналитика использования, рекомендации.
- **Этап 13 — Web UI**: базис на Next.js, доска Kanban, редактор MDX, управление промптами, realtime, обратная связь, CI/Docker.

### Checklist (EN)

- [ ] **Stage 0 — Architectural foundation**
  - [ ] 0.1 JSON-RPC engine: validation, batches, errors
  - [ ] 0.2 Transport abstraction & Content-Length framing
  - [ ] 0.3 Registry of tools/resources (version/etag, pagination)
  - [ ] 0.4 Configuration/logging/metrics (Prometheus)
  - [ ] 0.5 Catalog abstraction in thick client (built-in/external)
- [ ] **Stage 1 — Transport (stdio + TCP/Unix)**
  - [ ] 1.1 App composition (AppContainer, main, handler)
  - [ ] 1.2 TCP/Unix multi-client server
  - [ ] 1.3 Stdio single-client server
- [ ] **Stage 2 — Multi-user sessions**
  - [ ] 2.1 SessionManager (TTL/idle lifecycle)
  - [ ] 2.2 ToolExecutor & ToolContext
  - [ ] 2.3 Per-session rate limiting
- [ ] **Stage 3 — Authorization (Bearer/JWT)**
  - [ ] 3.1 `mcp.authenticate` + pre-auth window
  - [ ] 3.2 JWT/JWKS validation
  - [ ] 3.3 Binding `tokenClaims` to session TTL
- [ ] **Stage 4 — ACL**
  - [ ] 4.1 ACL model and policy definitions
  - [ ] 4.2 Filtering lists & call authorization
  - [ ] 4.3 Roles and ACL testing
- [ ] **Stage 5 — Thin proxy**
  - [ ] 5.1 Proxy bootstrap and configuration
  - [ ] 5.2 Tool/resource mirroring and wrappers
  - [ ] 5.3 Forwarding calls and events, flow control
  - [ ] 5.4 Resiliency & observability of proxy
- [ ] **Stage 6 — Synchronization of resources**
  - [ ] 6.1 Versioning protocol & cursors
  - [ ] 6.2 `mcp.sync.*` delta/snapshot/ack RPC
  - [ ] 6.3 Conflict resolver (3-way merge, policies)
  - [ ] 6.4 Event sourcing & snapshots (GC)
  - [ ] 6.5 E2E durability tests
- [ ] **Stage 7 — Testing & quality**
  - [ ] 7.1 Protocol E2E scenarios
  - [ ] 7.2 Load testing & SLA validation
  - [ ] 7.3 Fuzzing (framing/parser/validator)
  - [ ] 7.4 CI matrix, coverage, reports
  - [ ] 7.5 Chaos/shutdown testing
- [ ] **Stage 8 — Security**
  - [ ] 8.1 Short-lived tokens & refresh flow
  - [ ] 8.2 Audit logging
  - [ ] 8.3 TLS/mTLS & certificate rotation
  - [ ] 8.4 Secret management (vault/KMS)
  - [ ] 8.5 Authentication protection (rate-limit/lockout)
- [ ] **Stage 9 — Developer experience**
  - [ ] 9.1 Hot registration of tools
  - [ ] 9.2 Namespaces & wildcard filters
  - [ ] 9.3 Proxy response caching
  - [ ] 9.4 Dev CLI (local run/diagnostics)
  - [ ] 9.5 Hot reload of configs/policies
- [ ] **Stage 10 — Scalability**
  - [ ] 10.1 Load balancer integration & sticky sessions
  - [ ] 10.2 Tool sharding across nodes
  - [ ] 10.3 Cluster state synchronization (sessions/registry)
  - [ ] 10.4 Health/readiness/drain endpoints
  - [ ] 10.5 Auto-scaling and resource limits
- [ ] **Stage 11 — Integrations**
  - [ ] 11.1 Pub/Sub events and subscriptions
  - [ ] 11.2 WebSocket transport
  - [ ] 11.3 REST wrappers around tools
  - [ ] 11.4 gRPC wrappers around tools
- [ ] **Stage 12 — Smart features**
  - [ ] 12.1 Dynamic tools
  - [ ] 12.2 Policy-as-code (DSL/JSON, Git)
  - [ ] 12.3 Usage analytics (metrics/dashboards)
  - [ ] 12.4 Recommendations & cleanup (optional)
- [ ] **Stage 13 — Web UI (tasks/prompts/knowledge)**
  - [ ] 13.1 Foundation: Next.js + Auth (OIDC/JWT)
  - [ ] 13.2 Tasks board (Kanban/List)
  - [ ] 13.3 Knowledge editor (Markdown/MDX)
  - [ ] 13.4 Prompt management (versions/variants/A/B)
  - [ ] 13.5 Realtime updates (WebSocket)
  - [ ] 13.6 Feedback loop & analytics
  - [ ] 13.7 Docker/CI for Web UI

### Чек-лист (RU)

- [ ] **Этап 0 — Архитектурный каркас**
  - [ ] 0.1 JSON-RPC движок: валидация, батчи, ошибки
  - [ ] 0.2 Абстракция транспорта и Content-Length фрейминг
  - [ ] 0.3 Реестр инструментов/ресурсов (version/etag, пагинация)
  - [ ] 0.4 Конфигурация/логирование/метрики (Prometheus)
  - [ ] 0.5 Абстракция каталога в thick client (встроенный/внешний)
- [ ] **Этап 1 — Транспорт (stdio + TCP/Unix)**
  - [ ] 1.1 Композиция приложения (AppContainer, main, обработчик)
  - [ ] 1.2 TCP/Unix сервер для нескольких клиентов
  - [ ] 1.3 Stdio сервер для одного клиента
- [ ] **Этап 2 — Многопользовательские сессии**
  - [ ] 2.1 SessionManager (TTL/idle, жизненный цикл)
  - [ ] 2.2 ToolExecutor и ToolContext
  - [ ] 2.3 Пер-сессионный rate-limit
- [ ] **Этап 3 — Авторизация (Bearer/JWT)**
  - [ ] 3.1 `mcp.authenticate` и окно до авторизации
  - [ ] 3.2 Проверка JWT/JWKS
  - [ ] 3.3 Привязка `tokenClaims` к TTL сессии
- [ ] **Этап 4 — ACL**
  - [ ] 4.1 Модель ACL и описание политик
  - [ ] 4.2 Фильтрация списков и проверка вызовов
  - [ ] 4.3 Роли и тестирование ACL
- [ ] **Этап 5 — Тонкий прокси**
  - [ ] 5.1 Bootstrap и конфигурация прокси
  - [ ] 5.2 Зеркалирование инструментов/ресурсов и обёртки
  - [ ] 5.3 Проброс запросов/уведомлений, управление потоком
  - [ ] 5.4 Устойчивость и наблюдаемость прокси
- [ ] **Этап 6 — Синхронизация ресурсов**
  - [ ] 6.1 Протокол версионирования и курсоры
  - [ ] 6.2 RPC `mcp.sync.*` (delta/snapshot/ack)
  - [ ] 6.3 Разрешение конфликтов (3-way merge, политики)
  - [ ] 6.4 Event-sourcing и снапшоты (GC)
  - [ ] 6.5 E2E-тесты на устойчивость
- [ ] **Этап 7 — Тестирование и качество**
  - [ ] 7.1 E2E сценарии протокола
  - [ ] 7.2 Нагрузочные тесты и SLA
  - [ ] 7.3 Фаззинг (фрейминг/валидатор)
  - [ ] 7.4 CI-матрица, покрытие, отчёты
  - [ ] 7.5 Chaos/shutdown тесты
- [ ] **Этап 8 — Безопасность**
  - [ ] 8.1 Short-lived токены и refresh flow
  - [ ] 8.2 Аудит действий
  - [ ] 8.3 TLS/mTLS и ротация сертификатов
  - [ ] 8.4 Управление секретами (vault/KMS)
  - [ ] 8.5 Защита аутентификации (rate-limit/lockout)
- [ ] **Этап 9 — Удобство для разработчиков (DX)**
  - [ ] 9.1 Горячая регистрация инструментов
  - [ ] 9.2 Namespaces и wildcard-фильтры
  - [ ] 9.3 Кеширование ответов в прокси
  - [ ] 9.4 Dev CLI (локальный запуск/диагностика)
  - [ ] 9.5 Hot reload конфигов/политик
- [ ] **Этап 10 — Масштабируемость**
  - [ ] 10.1 Интеграция с балансировщиком и sticky sessions
  - [ ] 10.2 Шардирование инструментов по нодам
  - [ ] 10.3 Синхронизация состояния кластера (sessions/registry)
  - [ ] 10.4 Health/readiness/drain эндпоинты
  - [ ] 10.5 Авто-скейлинг и лимиты ресурсов
- [ ] **Этап 11 — Интеграции**
  - [ ] 11.1 Pub/Sub события и подписки
  - [ ] 11.2 WebSocket транспорт
  - [ ] 11.3 REST-обёртки вокруг инструментов
  - [ ] 11.4 gRPC-обёртки вокруг инструментов
- [ ] **Этап 12 — Умные фичи**
  - [ ] 12.1 Dynamic tools
  - [ ] 12.2 Policy-as-code (DSL/JSON, Git)
  - [ ] 12.3 Аналитика использования (метрики/дашборды)
  - [ ] 12.4 Рекомендации и чистка (опционально)
- [ ] **Этап 13 — Web UI (задачи/промпты/знания)**
  - [ ] 13.1 Фундамент: Next.js + Auth (OIDC/JWT)
  - [ ] 13.2 Доска задач (Kanban/List)
  - [ ] 13.3 Редактор знаний (Markdown/MDX)
  - [ ] 13.4 Управление промптами (версии/варианты/A/B)
  - [ ] 13.5 Realtime-обновления (WebSocket)
  - [ ] 13.6 Обратная связь и аналитика
  - [ ] 13.7 Docker/CI для Web UI

