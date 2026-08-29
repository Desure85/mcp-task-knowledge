# Changelog

Все заметные изменения в этом проекте документируются здесь (D-004).
Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
версионирование — [SemVer](https://semver.org/lang/ru/).

## [Unreleased]

### Added

- LAN Relay (BM-012): WebSocket + AES-256-GCM + UDP multicast discovery, инструменты `relay_status`/`share_brief`/`broadcast_rule`
- Hot tool registration (DX-001): `tools_register`/`tools_unregister` без рестарта
- Hot config reload (DX-004): `config_reload`
- ETag response cache (DX-005) в proxy
- Wildcard-фильтры в `tools_list` (DX-002): `search_*`, `*_create`
- Версионирование документов знаний (TD-005): снапшоты, `listDocVersions`/`restoreDocVersion`
- Behavioral dashboard (BM-011): zero-dep HTML + CLI (`npm run dashboard`)
- Dev CLI (DX-003): `npm run dev:cli` (diagnose/tools/sessions/export)
- API reference (D-001): автогенерация 76 инструментов (`npm run api:reference`)
- Architecture diagram (D-005) + ADR (D-002)
- Agent performance tracking (AI-007): `npm run agent:stats`
- BACKLOG CI validation (AI-004): `npm run backlog:check`

### Changed

- Централизованная обработка ошибок (TD-010): ErrorCategory/ToolError/ErrorHandler
- Graceful degradation (TD-011): ServiceAvailability + circuit breaker в core
- Атомарная запись JSON (Q-013): tmp + rename, ENOSPC-safe
- `uuid` v9 → `crypto.randomUUID()` (TD-007), зависимость удалена
- ESM-совместимый импорт service-catalog (TD-008)
- Единый draft-07 для всех JSON-схем (AI-010)
- ESLint + Prettier (DX-008), coverage threshold 80% (Q-005)

### Fixed

- Flaky-тесты: fake timers в session-manager/rate-limiter/token-manager (TD-013), jwt nbf детерминизм, SQLite таймауты (P1)
- 61 strict-ошибка в тестах (Q-012): полный type-check через tsconfig.test.json
- `-0` edge case в JSON-RPC фаззинге (Q-008)

### Added (tests)

- Core MCP E2E (Q-004), BM25 load (Q-006), schema validation (Q-007), JSON-RPC fuzzing (Q-008), chaos/shutdown (Q-009), property-based core (Q-010), wire snapshots (Q-011), ENOSPC integrity (Q-013)
