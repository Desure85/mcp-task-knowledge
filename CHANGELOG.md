# Changelog

Все заметные изменения в этом проекте документируются здесь (D-004).
Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
версионирование — [SemVer](https://semver.org/lang/ru/).

## [Unreleased]

### Added

- UI-10 design system: semantic tokens for 3 palettes (Indigo/Petrol/Copper) × light/dark, two independent theme axes with a no-flash pre-paint script and a Topbar switcher, base primitives (`components/ui`), `/design` showcase, and a WCAG AA contrast test over all 6 variants
- npm publish pipeline (NEXT2-008): tag-triggered GitHub Actions workflow (`.github/workflows/publish.yml`) — build + tests → npm publish with provenance → GHCR Docker image; `publishConfig` (public access, provenance) in package.json; tag ↔ version match guard
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

- UI-24 (part 1): Tasks, Overview, Access, Login and the shell use design tokens and `components/ui` primitives only; the Live pill follows status tokens; a guard test (`lib/no-hardcoded-colors.test.ts`) blocks Tailwind palette colours/hex in migrated files
- UI-24 (part 2): Knowledge uses design tokens and `components/ui` primitives only (labelled fields, `Dialog` instead of `window.confirm`), with a read-first document view, metadata, table of contents, Export/Edit/Trash and tokenised prose for headings, lists, quotes, code and tables; the markdown renderer stays escape-first and keeps the link-scheme allowlist
- UI-24 (part 3): Memory and Analytics use design tokens and `components/ui` primitives only; Memory tabs expose `tablist`/`tab`/`tabpanel` roles with Arrow/Home/End navigation, Analytics bars use status/priority tokens with accessible `aria-valuetext`, all fields are labelled, and the contrast gate now covers bar colours on `surface-2`
- CI/Docker: `ONNXRUNTIME_NODE_INSTALL=skip` for CPU `npm ci`/`npm install`, so onnxruntime-node no longer downloads ~hundreds of MB of CUDA provider binaries from `api.nuget.org` (GPU stages still install them with `cuda12`)
- Security: WebSocket auth no longer puts the JWT in the URL. `POST /auth/ws-ticket` exchanges a Bearer JWT for a single-use 30 s ticket; `/ws` accepts only `?ticket=` (legacy `?token=` rejected), tickets are bound to `sub`/`jti` and die on JWT revocation; the web UI fetches a fresh ticket per connect/reconnect
- Node.js 24: `engines.node >=22.0.0`, `.nvmrc=24`; CI primary Node 24, compat-матрица 22.x/24.x; Docker-образы и compose на `node:24-bullseye|alpine` (`mcp-node:24-*`)
- GitHub Actions: checkout v7, setup-node v7, upload-artifact v7, docker/login-action 4.6.0, setup-buildx-action 4.3.0, build-push-action 7.3.0, setup-qemu-action 4.3.0 (Node 24 runtime; используемые inputs не изменились)
- Централизованная обработка ошибок (TD-010): ErrorCategory/ToolError/ErrorHandler
- Graceful degradation (TD-011): ServiceAvailability + circuit breaker в core
- Атомарная запись JSON (Q-013): tmp + rename, ENOSPC-safe
- `uuid` v9 → `crypto.randomUUID()` (TD-007), зависимость удалена
- ESM-совместимый импорт service-catalog (TD-008)
- Единый draft-07 для всех JSON-схем (AI-010)
- ESLint + Prettier (DX-008), coverage threshold 80% (Q-005)

### Fixed

- `/knowledge` P0 (UI-13, F-01/F-02): list items are typed without `content` and normalized, a document opens via `knowledge_get` with loading/error states, search uses server `search_knowledge` with an empty state, `renderMarkdown` tolerates `undefined`; route and global error boundaries offer Retry / Overview
- Flaky-тесты: fake timers в session-manager/rate-limiter/token-manager (TD-013), jwt nbf детерминизм, SQLite таймауты (P1)
- 61 strict-ошибка в тестах (Q-012): полный type-check через tsconfig.test.json
- `-0` edge case в JSON-RPC фаззинге (Q-008)

### Added (tests)

- Core MCP E2E (Q-004), BM25 load (Q-006), schema validation (Q-007), JSON-RPC fuzzing (Q-008), chaos/shutdown (Q-009), property-based core (Q-010), wire snapshots (Q-011), ENOSPC integrity (Q-013)

## [2026-09-03] — PROD hardening (аудит prod-ready)

### Fixed

- Deploy-доки: `PORT` → `MCP_PORT` (docker.md), сборка через `--target` (PROD-001)
- Dev compose volume: `/data:/data` → `./data:/data` (PROD-001, файл gitignored)
- RCE в workflow-условиях: `new Function` → безопасный эвалуатор грамматики (PROD-002)

### Added

- `HEALTHCHECK /healthz` + `EXPOSE 3001` в runtime-стейджах Dockerfile (PROD-001)
- `.env.example` для продакшн-деплоя (PROD-001)
- 6 коннекторов завайрены в registry: GDrive, Gmail, Notion, OneDrive, Linear, Web Crawler (WIRE-001)
- RealtimeServer `/ws` в HTTP transport (WIRE-002)
- Fail-closed дефолт `AuthManager`: requireAuth=true для http/tcp (PROD-002)
- BACKLOG-задача SEC-003: завайрить AuthManager в HTTP/TCP transport

### Changed

- `.gitignore`: `secrets.enc.json`, `*.db`, `*.sqlite*`, `*.pem`, `*.key` (PROD-002)
- BACKLOG-статистика: 221 всего / 22 pending / 193 done (WIRE-001/002 закрыты) (PROD-003)
- README/AGENTS: 76 tools (было 109+), 9 коннекторов, 7 плагинов; починена ссылка API Reference (PROD-003)
