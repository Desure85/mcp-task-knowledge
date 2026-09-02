# ROADMAP

**Последнее обновление:** 2026-09-02
**Статус:** 181/182 задачи завершены (99.5%)

> Полная документация: `docs/` — [Getting Started](docs/getting-started.md), [Tools](docs/features/tools.md), [Agent Memory](docs/features/agent-memory.md)

---

## Прогресс

| Этап | Название | Задач | Готово | Прогресс |
|------|----------|-------|--------|----------|
| 0 | Архитектурный каркас | 6 | 6 | ✅ 100% |
| 1 | Транспорт | 4 | 4 | ✅ 100% |
| 2 | Сессии | 5 | 5 | ✅ 100% |
| 3 | Авторизация | 3 | 3 | ✅ 100% |
| 4 | ACL | 3 | 3 | ✅ 100% |
| 5 | Thin Proxy | 4 | 4 | ✅ 100% |
| 6 | Синхронизация | 5 | 5 | ✅ 100% |
| 7 | Тестирование и качество | 13 | 13 | ✅ 100% |
| 8 | Безопасность | 6 | 6 | ✅ 100% |
| 9 | DX | 8 | 8 | ✅ 100% |
| 10 | Масштабируемость | 5 | 5 | ✅ 100% |
| 11 | Интеграции | 6 | 6 | ✅ 100% |
| 12 | Умные фичи (Skills/Rules/Workflows/Memory) | 20 | 20 | ✅ 100% |
| 13 | Web UI | 7 | 7 | ✅ 100% |
| A-G | Agent Infra, Behavioral, OpenCode | 38 | 38 | ✅ 100% |
| H | Competitive Edge (vs Mem0/Zep/Letta) | 22 | 22 | ✅ 100% |
| — | Тех. долг | 14 | 13 | 93% (TD-003 deferred) |
| | **Итого** | **182** | **181** | **99.5%** |

---

## Что реализовано

### Stage 0-5: Foundation ✅
JSON-RPC engine, transport (stdio/HTTP/TCP/Unix), tool registry, sessions, auth (JWT/OAuth 2.1 PKCE), ACL, thin proxy, sync (versioning, 3-way merge, event sourcing).

### Stage 6-9: Quality, Security, DX ✅
E2E tests, load tests, fuzzing (fast-check), chaos/shutdown, coverage 92.7%, TLS/mTLS, audit logging, secret management, hot tool registration, namespaces, Dev CLI, hot reload, ESLint+Prettier.

### Stage 10: Scalability ✅
Health endpoints, load balancer with sticky sessions, cluster state sync, tool sharding, auto-scaling with cooldowns.

### Stage 11: Integrations ✅
Connector framework, GitHub, Jira/YouTrack, Slack/Discord, REST wrappers, gRPC wrappers, Google Drive, Gmail, Notion, OneDrive, Linear, Web Crawler.

### Stage 12: Smart Features ✅
Skills CRUD + invocation + discovery + templates + sharing + permissions. Rules engine + evaluation + policy-as-code + rule packs + enforcement + import. Workflows DAG + executor + templates + human-in-loop + state persistence + subflows.

### Stage 13: Web UI ✅
Next.js 16 foundation, Kanban board (drag&drop), Knowledge editor (Markdown + live preview), Prompt management (A/B experiments), Realtime WebSocket, Analytics dashboard, Docker/CI.

### Agent Memory (Etap H) ✅
Memory extraction pipeline, temporal knowledge graph, user profiles, smart context assembly, entity-linking retrieval, memory evolution, conflict resolution, automatic forgetting, memory scoping, memory layers, dreaming agent, observations, benchmark harness (LOCOMO/LongMemEval/BEAM/DMR), async operations, cross-framework adapters (LangGraph/AutoGen/CrewAI/LangChain), multimodal ingestion, graph visualization, 4 OpenCode plugins.

### Behavioral Memory ✅
Intent capture, runtime observation, failure logging, resolution logging, repair brief, code lineage, auto-heal, proactive guardrails, cross-project search, guard rules auto-learning, behavioral dashboard, LAN relay, migration framework, FTS5 search.

### OpenCode Integration ✅
memory-recall, memory-sync, memory-context, memory-extract, memory-context-v2, memory-profile, memory-dream, session-draft, P2P sync, memory browser, config cleanup.

---

## Что осталось

| ID | Задача | Приоритет | Статус |
|----|--------|-----------|--------|
| TD-003 | Удалить legacy-поддержку путей знаний | low | deferred |

---

## Метрики

| Метрика | Значение |
|---------|----------|
| MCP tools | 101+ |
| MCP resources | 6 |
| Tests | 2325 |
| Coverage | 92.7% |
| OpenCode plugins | 8 |
| Connectors | 12 |
| Framework adapters | 4 |
| Benchmark suites | 4 |
| PRs merged | 183+ |
| Tasks done | 181/182 |

---

## История обновлений

| Дата | Обновление | Автор |
|------|-----------|-------|
| 2026-09-02 | Полный rewrite: все этапы отмечены как done, добавлены Etap H и метрики | Sisyphus |
| 2026-04-04 | Добавлена трекинг-тройка, прогресс-таблица | agent |
| 2025-09-27 | Первичная версия с чек-листами EN/RU | Desure85 |
