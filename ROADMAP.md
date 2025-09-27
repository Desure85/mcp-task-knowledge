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

## Phases / Этапы

- **Stage 0 — Архитектурный каркас**: JSON‑RPC ядро, транспорт, реестр, конфиг/логи/метрики.
- **Stage 1 — Транспорт**: stdio/TCP/Unix, многоклиентский сервер.
- **Stage 2 — Сессии**: SessionManager, ToolExecutor/ToolContext, пер‑сессионный rate‑limit.
- **Stage 3 — Авторизация**: Bearer/JWT, JWKS, pre‑auth окно.
- **Stage 4 — ACL**: политика, фильтрация списков, проверка прав при вызове.
- **Stage 5 — Тонкий прокси**: bootstrap, зеркалирование описаний, проброс, резилиентность.
- **Stage 6 — Синхронизация**: delta/snapshot/ack, конфликт‑резолвер, event‑sourcing, E2E устойчивость.
- **Stage 7 — Тестирование**: e2e, нагрузка, фаззинг, хаос, CI.
- **Stage 8 — Безопасность**: short‑lived токены, аудит, TLS/mTLS, секреты.
- **Stage 9 — DX**: горячая регистрация, namespaces/filters, кэш в прокси, Dev CLI, hot‑reload.
- **Stage 10 — Масштабируемость**: LB/sticky, шардирование, кластерное состояние, readiness/drain, авто‑скейлинг.
- **Stage 11 — Интеграции**: Pub/Sub, WebSocket, REST/gRPC.
- **Stage 12 — Умные фичи**: Dynamic tools, Policy‑as‑code, аналитика.
- **Stage 13 — Web UI**: Next.js, Kanban, MDX‑редактор, промпты, realtime, feedback, CI/Docker.

