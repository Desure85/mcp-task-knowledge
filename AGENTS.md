# AGENTS.md — Инструкция для AI-агента

> **Назначение:** Единый источник контекста для AI-агента, работающего над проектом `mcp-task-knowledge`.
> Агент **обязан** читать этот файл в начале каждой сессии и обновлять после каждого этапа работы.

---

## 0. Песочница (КРИТИЧЕСКИ ВАЖНО)

### Проблема

Песочница, где выполняется агент, **может в любой момент откатиться** на состояние нескольких сессий назад. Файлы окажутся устаревшими — без последних коммитов, без новых веток.

**Последствия:** агент пишет код поверх старой версии, затирает коммиты, создаёт конфликты.

### Обязательный чек-лист при старте КАЖДОЙ сессии

Выполнять **до любого чтения/записи файлов проекта**:

```bash
cd <путь_к_репозиторию>
git fetch origin
git status
# Если «behind» — git pull --ff-only
# Если нужна другая ветка — git checkout <branch> && git pull --ff-only
# Итог: git status → «nothing to commit, working tree clean»
```

### Красные флаги

- `Your branch is behind 'origin/...' by N commits` — **немедленно `git pull --ff-only`**.
- Файлы не содержат последних изменений из прошлой сессии — **песочница откатилась, синхронизируйся**.
- Локальных веток из прошлой сессии нет — **`git fetch origin` и `git checkout <branch>`**.
- `git pull` даёт конфликты — **НЕ ПЫТАТЬСЯ разрешать вслепую**, спросить пользователя.

> **НИКОГДА не пиши код, пока не убедился, что песочница синхронизирована с origin.**

---

## 1. Git-воркфлоу

### Ветки

- `master` / `main` — стабильное состояние. PR сливаются сюда.
- `feat/<description>` — новая функциональность.
- `fix/<description>` — исправление бага.
- `refactor/<module>` — рефакторинг.
- `docs/<topic>` — документация.

### Правила

1. **Всегда** создавай feature-ветку от `master` для любой работы.
2. Коммит: `<type>: <description>` (feat, fix, refactor, docs, chore, test).
3. По готовности — push в origin и открой PR в `master`.
4. Дай ссылку на PR пользователю для ревью.

---

## 2. Трекинг-пара

Два файла в корне — **память агента между сессиями**. Обновлять после каждого завершённого шага.

### AGENTS.md — контекст агента

Секции:

- **Текущее состояние сессии** — что сделано, что дальше, ветка, Session ID.
- **Известные проблемы и технический долг** — что обнаружено.
- **Ключевые решения** — архитектурные решения с контекстом.

### BACKLOG.md — и стратегия, и задачи

Одна точка правды. Две секции:

**Стратегия** — чеклисты этапов, большая картина:

```markdown
## Стратегия

### Этап 1 — Поиск
- [x] BM25 оптимизация (B-010)
- [ ] Гибридный поиск (B-001)
- [ ] Двухэтапный реранк (B-005)

### Этап 2 — Производительность
- [ ] Rate-limit (B-002)
```

**Очередь** — конкретные задачи с приоритетами:

```markdown
## Очередь

| ID | Задача | Этап | Приоритет | Статус |
|----|--------|------|-----------|--------|
| B-001 | Гибридный поиск | 1 | high | in_progress |
| B-002 | Rate-limit | 2 | medium | pending |

## Блокированные

| ID | Задача | Причина | Статус |
|----|--------|---------|--------|
| B-004 | GPU-эмбеддинги | Ждём GPU в песочнице | blocked |

## Архив (последние 20)

| ID | Задача | Закрыто | PR |
|----|--------|---------|-----|
| B-010 | BM25 оптимизация | 2026-04-04 | #23 |
```

### CHANGELOG.md — история для человека

Обновляется **только при релизе или закрытии PR**. Формат — [Keep a Changelog](https://keepachangelog.com/). Не трогается при каждом шаге.

---

## 3. Улучшения флоу

### 3.1 Правило последовательных инкрементов (КРИТИЧЕСКОЕ)

> **НЕЛЬЗЯ начинать следующий инкремент, пока предыдущий не замержен в `master`.**

Инкремент — одна задача из BACKLOG, одна feature-ветка, один PR.

**Почему:** параллельные ветки отстающей от `master` базы гарантированно приведут к конфликтам при мердже. Решение конфликтов = переработка кода = потеря времени и риск сломать что-то.

**Красные флаги:**

- Открыто два и более PR одновременно — **заверши первый, дождись мерджа**.
- Хочется начать новую задачу, а старый PR ещё не смержен — **не начинал**.
- «Это маленькая задачка, можно параллельно» — **нельзя**. Маленькая тоже даст конфликт.

**Исключение:** горячий фикс (`fix/`), который не касается тех же файлов что текущий PR. Но и его — через отдельную ветку от свежего `master`, а не от текущей feature-ветки.

**Проверка перед стартом новой задачи:**

```bash
# Нет ли незамерженных PR?
git fetch origin
git branch -r | grep feat/ | while read b; do
  echo "$b: $(git log origin/master..$b --oneline 2>/dev/null | wc -l) commits ahead of master"
done
# Если есть ahead — завершить или закрыть прежде чем начинать новое
```

**Статус в BACKLOG:** если задача ждёт мерджа — статус `review`, не `in_progress`. Новая задача не берётся в работу пока в BACKLOG нет ни одной задачи со статусом `review`.

### 3.2 Обработка правок по PR (фидбек-цикл)

Если пользователь присылает ошибки, замечания или запросы на доработку к открытому PR:

1. Перейти в ветку этого PR: `git checkout <branch> && git pull --ff-only`.
2. Внести исправления согласно фидбеку.
3. Закоммитить правки: `fix: правки по ревью — <что именно исправлено> [S-<id>]`.
4. Запушить в **ту же самую ветку**: `git push origin <branch>`.
5. **Обязательно** дать ссылку на **этот же PR** пользователю.

**Запрещено:** создавать новую ветку или новый PR для доработок. Правки — это часть текущего инкремента. Статус в BACKLOG остаётся `review`.

### 3.3 Session ID — подпись сессии в каждом коммите

Генерировать ID сессии (например, `S-20260404-a3f1`) и добавлять в конец каждого коммита:

```
feat: добавил поиск по задачам [S-20260404-a3f1]
```

Позволяет найти всё, что сделано в сессии:

```bash
git log --all --grep="S-20260404-a3f1" --oneline
```

Session ID фиксировать в AGENTS.md в секции «Текущее состояние сессии».

### 3.4 Checkpoint-коммиты — защита от отката песочницы

Делать промежуточный коммит **каждые 10–15 минут** или после каждого осмысленного шага, даже если работа не завершена:

```
wip: checkpoint — реализован парсинг frontmatter, следующий шаг: валидация [S-20260404-a3f1]
```

> **Если работа не закоммичена — она не существует.**

**TD-014 — WIP commit strategy:** перед началом каждой BACKLOG-задачи (после checkout ветки) делать защитный WIP-коммит через alias:

```bash
git wip "BACKLOG-XXX — начал задачу"   # или просто: git wip
```

Alias (уже установлен глобально): `git add -A` + `git commit -m "wip: <msg>"`. Безопасен: при пустом tree не создаёт пустой коммит. Это страховка от потери staged/unstaged изменений при крэше или откате песочницы — WIP-коммит можно переписать (soft reset) или откатить (revert) без потери работы.

### 3.5 Трёхфазный цикл: Исследование → План → Реализация

Каждая задача проходит три фазы, каждая заканчивается коммитом:

1. **Исследование** — читать код, понимать контекст. Коммит: `research: анализ модуля X для задачи Y [S-<id>]`
2. **План** — написать план изменений (в комментарий к коммиту или в трекинг-паре). Коммит: `plan: план рефакторинга модуля X [S-<id>]`
3. **Реализация** — писать код. Обычные коммиты.

Не писать код, пока не понятна полная картина. Если план оказался неверным — вернуться к фазе 1, не тащить вперёд.

### 3.6 Правило одной задачи

В одной feature-ветке — **только одна задача из BACKLOG**.

- Мелкая (≤15 мин) — можно в той же ветке, отдельным коммитом.
- Крупная — записать в BACKLOG, закончить текущую, открыть отдельную ветку.

Не переключаться между задачами — агент теряет контекст.

### 3.7 Pre-PR чеклист

Перед открытием PR:

```bash
# Все изменения закоммичены
git status

# Ветка не отстаёт от master, видны все коммиты
git fetch origin && git log master..HEAD --oneline

# Трекинг-пара обновлена
git diff master -- AGENTS.md BACKLOG.md

# Нет отладочного кода
grep -r "console\.log\|debugger\|HACK\|FIXME" src/ || echo "clean"

# Коммиты читаемы
git log master..HEAD --oneline
```

### 3.8 Rollback-протокол

Если что-то пошло не так:

1. **Остановиться.** Не чинить наугад.
2. **Определить последнее стабильное состояние** — `git log --oneline -10`.
3. **Сломал код** — `git reset --soft <последний_хороший_коммит>`, посмотреть diff, решить что оставить.
4. **Песочница откатилась** — `git pull --ff-only`, `git log` чтобы понять что потерялось.
5. **Потерялись незакоммиченные изменения** — признать потерю, восстановить по трекинг-паре.
6. **Записать инцидент** в AGENTS.md §«Известные проблемы».

### 3.9 Handoff через коммиты

Каждый коммит — **самодостаточен**. Читающий `git log` без доступа к AGENTS.md понимает что и зачем.

Плохо: `fix: исправил баг`
Хорошо: `fix: валидация uuid в knowledge_get — filename содержал произвольные символы, ломавшие glob [S-<id>]`

PR description: что сделано, почему, что не сделано и почему, ссылка на задачу в BACKLOG.

### 3.10 Правило 30 минут

Если агент **застрял** больше 30 минут:

1. Checkpoint-коммит.
2. Записать проблему в BACKLOG со статусом `blocked` и описанием что пробовал.
3. Обновить AGENTS.md.
4. **Спросить пользователя.**

### 3.11 Журнал сессии

Создать `.session/<session-id>.md` в начале сессии:

```markdown
# S-20260404-a3f1

**Начало:** 2026-04-04 10:00
**Ветка:** feat/search-refactor
**Цель:** B-001 — гибридный поиск

## Хроника
- 10:00 — синхронизация, checkout ветки
- 10:05 — исследование: анализ bm25.ts и vector.ts
- 10:20 — план: вынести общую логику в search/index.ts
- 10:25 — реализация: создал adapter interface

## Блокеры
- 10:45 — не удалось воспроизвести баг → запрос к пользователю

**Конец:** 2026-04-04 11:30
**Итог:** B-001 → review, PR #24, жду мерджа
```

Коммитить в конце сессии. `.session/` добавить в `.gitignore` или оставить для аудита.

---

## 4. Итоговая последовательность сессии

```
 1. Синхронизация песочницы
 2. Чтение AGENTS.md — где остановились?
 3. Проверить: есть ли незамерженный PR?
    ├─ ДА, и прислали правки → перейти к ветке PR, внести правки, push, дать ссылку на PR
    └─ ДА, но жду ревью/мержа → СТОП. Не начинать новую задачу.
    └─ НЕТ → перейти к п.4
 4. Генерация Session ID, запись в AGENTS.md
 5. Определить задачу из BACKLOG
 6. Исследование → коммит
 7. План → коммит
 8. Реализация → checkpoint-коммиты каждые 10-15 мин
 9. Застрял >30 мин → чекпоинт + спросить пользователя
10. Pre-PR чеклист
11. Открыть PR
12. BACKLOG: статус задачи → review
13. AGENTS.md: «жду ревью/мержа PR #X»
14. Журнал сессии → коммит
15. СТОП. Не начинать новую задачу.
```

---

## 5. Обзор проекта

**Название:** mcp-task-knowledge
**Версия:** 1.0.20
**Репозиторий:** <https://github.com/Desure85/mcp-task-knowledge>
**Основная ветка:** `master`
**Стек:** TypeScript, Node.js 24 (engines >=22), MCP SDK, Vitest, Zod, ONNX Runtime

> **Полная документация:** `docs/` — [Getting Started](docs/getting-started.md), [Tools](docs/features/tools.md), [Agent Memory](docs/features/agent-memory.md), [Configuration](docs/getting-started/configuration.md), [Docker](docs/deployment/docker.md), [API Reference](docs/api-reference.md)

Файловый MCP-сервер для таск-менеджмента, базы знаний, библиотеки промптов и **памяти AI-агентов**. 116 MCP-инструментов, 2900+ тестов, 92.7% coverage.

### Ключевые модули

| Модуль | Путь | Назначение |
|--------|------|------------|
| Точка входа | `src/index.ts` | MCP-сервер |
| Конфигурация | `src/config.ts` | ENV/JSON конфигурация |
| Хранилище | `src/storage/*.ts` | Tasks (JSON) + Knowledge (Markdown) |
| Поиск | `src/search/*.ts` | BM25 + ONNX vector + hybrid + FTS5 |
| Память агента | `src/memory/*.ts` | Extraction, temporal graph, profiles, context assembly, dreaming |
| Инструменты | `src/tools/*.ts`, `src/register/*.ts` | MCP tool registration |
| Skills/Rules/Workflows | `src/skills/`, `src/rules/`, `src/workflows/` | Agent harness |
| Behavioral | `src/behavioral/*.ts` | Intent, failure, auto-heal, guardrails |
| Connectors | `src/connectors/*.ts` | GitHub, Jira, Slack, GDrive, Notion, Linear, Web Crawler |
| Transport | `src/transport/*.ts` | stdio, HTTP, TCP, WebSocket realtime |
| Cluster | `src/core/cluster.ts` | Load balancer, sharding, auto-scaling |
| Web UI | `web-ui/` | Next.js 16 (Kanban, Knowledge, Prompts, Analytics) |
| OpenCode plugins | `extensions/opencode/` | memory-recall, memory-sync, memory-extract, etc |

---

## 6. Команды для разработки

### Сборка и запуск

```bash
npm install              # установка зависимостей
npm run build            # TypeScript → dist/
npm run dev              # tsx src/index.ts
npm test                 # vitest run
npm run lint:md          # markdownlint
```

### Переменные окружения для локального запуска

```bash
export DATA_DIR=./data
export EMBEDDINGS_MODE=none          # none | onnx-cpu | onnx-gpu
export CURRENT_PROJECT=mcp
export OBSIDIAN_VAULT_ROOT=./data/vault
```

### Docker

```bash
docker build -t mcp-task-knowledge .
docker run --rm -it -e DATA_DIR=/data -v "$PWD/.data":/data mcp-task-knowledge
```

---

## 7. Стандарты кода

### TypeScript

- Strict mode (`tsconfig.json`).
- Импорты — ESM (`import/export`).
- Типы — через `interface` или `type`, без `any` без крайней необходимости.
- Валидация входных данных — через `zod`.
- Ошибки инструментов — через `ok()` / `err()` из `src/utils/respond.ts`.

### Стили ответов MCP

```jsonc
// Успех
{ "ok": true, "data": { /* ... */ } }

// Ошибка
{ "ok": false, "error": { "message": "Описание ошибки" } }
```

### Тесты

- Фреймворк: Vitest.
- **config.ts резолвит пути при module load** (DATA_DIR обязателен, иначе throw) — тестируемый код принимает пути параметром, не импортирует config-константы напрямую (паттерн DX-17).
- **gray-matter stringify падает на undefined** — перед записью frontmatter удаляй undefined-ключи (паттерн cleanMeta из storage/knowledge.ts).
- Расположение: `tests/` и `src/__tests__/`.
- Запуск: `npm test`.
- Для интеграционных: `npm run e2e:cli`.

---

## 8. Текущее состояние сессии

> Агент заполняет этот блок в начале и обновляет в конце каждой сессии.

**Дата последнего обновления:** 2026-10-31
**Session ID:** ses_e72dfcc40ffezuSMVsJt9RRyXI (V-01/V-02 statuses and transitions)
**Текущая ветка:** feat/project-statuses-transitions (worktree `/home/dm/work/mcp-tk-v01`, от origin/master 3672e2e)
**Текущий этап:** Stage V — project statuses and transition graph (server + web-ui client).
**Статус:** V-01/V-02 done, V-03/V-04/V-05 pending. Default four statuses + legacy `blocked`, `project_statuses_get/set`, `project_transitions_get/set`, category-based dashboard/briefing/DAG, transition errors and bulk failures, API reference regenerated.

### Сессия ses_e72dfcc40ffezuSMVsJt9RRyXI (V-01/V-02 statuses and transitions, 2026-10-31)

- `src/workflow.ts`: `ProjectStatus`/`ProjectWorkflow`, default four statuses, legacy `blocked`, validation of status ids/categories/transitions and done reachability.
- `src/workflow-service.ts`: `project_statuses_get/set` and `project_transitions_get/set`; status removal is atomic under `withFileLock`, supports `moveTo`/`moves` and reports up to 20 task ids.
- `src/projects.ts`: workflow fields in `.project.json`, `updateProjectMeta` serialized; `src/storage/tasks.ts`: status/transition checks on create/update/close and per-project close target.
- Dashboard/briefing/DAG count by category; bulk update/close return per-task `failed` entries. Client adds `api.projects.statuses/transitions` and `ToolCallError.code`.
- Tests: `tests/project-statuses.test.ts` (5), `tests/task-transitions.test.ts` (5), `tests/project-statuses-concurrency.test.ts` (1); live web-ui client test 5 passed. API reference regenerated.

### Сессия ses_e72dfcc40ffezuSMVsJt9RRyXI (Node.js 24 + CI hygiene, 2026-10-30)

- Node 20 EOL: обновлены все workflow (12 файлов), Dockerfile (базовые образы, NodeSource 24.x, proxy-stages), web-ui/Dockerfile, compose-файлы, docs/README/CONTRIBUTING/AGENTS; `engines.node >=22.0.0`, добавлен `.nvmrc=24`.
- Версии Actions перенесены из dependabot-PR (#194/#195/#199/#200/#202/#203/#210) единым изменением: checkout v7, setup-node v7, upload-artifact v7, docker/login 4.6.0, setup-buildx 4.3.0, build-push 7.3.0, setup-qemu 4.3.0. Inputs сверены по `action.yml` — используемые не изменились; checkout v7 ломает только `pull_request_target`/`workflow_run` (в репозитории их нет).
- Проверка нативных модулей на Node 24 (ABI 137): better-sqlite3 12.11.1 и onnxruntime-node 1.30.0 загружаются; полный `npm test` зелёный (259/3026), web-ui tsc — 0 ошибок, docker build проходит (в образе Node 24).
- Гейт для CI: `mcp-node:24-bullseye|alpine` ещё не опубликованы в GHCR (20-е есть) — перед мержем нужно вручную запустить `docker-build-base` (workflow_dispatch), иначе push-сборка баз упадёт на отсутствующем BASE_NODE_IMAGE.
- Флейк окружения: `chaos-shutdown` падает по таймауту SIGTERM, если порт 4001 занят чужим/осиротевшим процессом; при свободном порте и `--maxWorkers=4` полный прогон зелёный. Это не регрессия Node 24 (ручной SIGTERM — exit 0 за 14 мс).

### Сессия ses_e72dfcc40ffezuSMVsJt9RRyXI (остаток аудита AUD-11..16 + TR-16, 2026-10-30)

- AUD-11..16 в BACKLOG числились `pending`, хотя код фиксов и тесты уже были в master. Для каждого пункта сделан revert-check (откат именно фикса → тест падает): AUD-11 (4 теста), AUD-12 (2), AUD-13 (4), AUD-14 (leak после failed init), AUD-15 (phantom WS-сессия), AUD-16 (eviction и persist по отдельности). Статусы → done со ссылками на тесты.
- **Вакуумные тесты найдены и исправлены** (тест зелёный без фикса = ложное покрытие): AUD-14 проверял только `remote` truthy — FIFO-очередь его проходила; переписан на два loopback-IP (`127.0.0.1`/`127.0.0.2`) + сценарий «failed init с чужого IP → следующий init не наследует remote». AUD-15 тестировал `validateToken()` на собственной проводке; добавлен реальный `/ws` handshake через `HttpTransportAdapter` с проверкой `authenticatedCount === 0`. AUD-16 тест «not FIFO» имел порядок вставки == порядку exp; переставлен (long-lived вставляется первым).
- TR-16: `trustLevel` (`system`|`user`|`external`) в frontmatter knowledge-доков и memory-фактов (createDoc, import_single/import_markdown, bulk_create/update, extraction, temporal graph, async bulk_import). Egress: для `external` дополнительно применяются `EXTERNAL_PATTERNS` (active HTML, `javascript:`/`data:text/html`, fetch/curl, beacon-image); annotate-блок помечается `[EXTERNAL UNTRUSTED CONTENT]`, исходный JSON-блок не меняется. Тесты: `tests/tr16-trust-level.test.ts` (15).
- Решение владельца требуется: несколько админов (хранилище пользователей, хеши, UI) — НЕ реализовано, только предложение в отчёте сессии.

### Сессия S-20261030-prodaudit (аудит production-readiness, ветка audit/prod-readiness)

- Baseline master: build ok, 2957 тестов зелёные. Найдено и закрыто: AUD-18a (path traversal `userId` в ProfileManager, в т.ч. delete), AUD-18b (неатомарная запись memory/sync-хранилищ), AUD-18f (`writeText`). Попутно: `deleteProfile` использовал `require` в ESM и всегда возвращал false.
- Расхождения доки с кодом: живой `tools/list` = 116 (118 с catalog + dynamic tools), доки говорили 100/101/76/114; `scripts/api-reference.mjs` обрезал список на 100 (нет пагинации) — исправлено; битая ссылка на `docs/api/reference.md`; в BACKLOG AUD-08/09/17 числились pending при реализованном коде.
- Продолжение (ветка feat/admin-login-prod = web-ui WIP + аудит): живые пробы AUD-04/05/06/07 зелёные (tests/e2e-full/aud-high-security.test.ts); AUD-18c закрыт (`withFileLock`; tmp-имя writeJson коллидировало в одну мс → ENOENT); AUD-18d латентен (EventLog не подключён). Админка: `/login`, гард маршрутов (AppShell), выход, `/access` (claims, токен, одноразовые setup-ссылки); баг `serverInfo.version = 0.0.0` (читался несуществующий `_implementation`).
- BREAKING (клиентов нет, 2026-10-30): `SECURITY_STACK` теперь включён по умолчанию (выкл. `0|false|off`); санитайзер и egress-скан остаются opt-in (`SECURITY_SANITIZER_MODE`, `SECURITY_EGRESS_MODE`) — при включении по умолчанию они портили frontmatter и ломали JSON-ответы.
- BREAKING (клиентов нет, 2026-10-30): память агента (`temporal-graph.json`, `profiles/`, `layers.json`) переехала из `~/.local/share/mcp-task-knowledge/` в `$DATA_DIR/memory/` — раньше `DATA_DIR` игнорировался: в Docker с томом память терялась при пересоздании контейнера, разные `DATA_DIR` делили одну память, e2e-тесты писали в `$HOME`. Автомиграции нет (она тащила бы тестовый мусор в каждый свежий каталог): перенос вручную `mkdir -p $DATA_DIR/memory && cp -r ~/.local/share/mcp-task-knowledge/{temporal-graph.json,profiles,layers.json} $DATA_DIR/memory/`.
- web-ui: выбор проекта переживает перезагрузку (localStorage + повторный `project_set_current` на новой сессии) и переключается из шапки; realtime показывает Offline после 3 неудач; `next start` не проксирует WebSocket → нужен `NEXT_PUBLIC_MCP_WS_URL`.
- Выход из админки отзывает JWT на сервере: токены входа несут `jti`, `POST /auth/logout` проверяет подпись и вызывает `revokeByJti` (персист в `DATA_DIR/.jwt-revoked.json`); подделанный токен ничего не отзывает. Несколько админов по-прежнему нет — один пользователь из `MCP_LOGIN_*`.
- Egress-скан включён по умолчанию в режиме `annotate` (TR-14): текст результата не меняется, при находках добавляется отдельный блок `⚠️ [UNTRUSTED CONTENT]`; `SECURITY_EGRESS_MODE=off|redact|block|warn`. Санитайзер по-прежнему opt-in.
- Флейк-источник: e2e-тесты с фиксированными счётчиками портов (chaos-shutdown берёт 4001) падают, если на порту завис чужой сервер; новые живые тесты используют порты от ОС.
- Не проверено и остаётся открытым: AUD-05/06/11/12/13/14/15/16, AUD-18c/d/e, TR-01/04/14/16/17. Статусы AUD-04/07 в таблице не менялись — нужна проверка e2e.

### Сессия ses_ea99b2472ffeIU0Jd5H493qwWg (Этап Q — KB hardening, 2026-10-20)

- Индексация выведена из запроса: `src/search/warmup.ts` (фоновый per-project прогрев, debounce, бюджет 180 с, `EMBEDDINGS_WARMUP=0` off) + `adapter.warmup()` + инкрементальный reindex по событиям `storage/knowledge-events.ts` + `project_set_current` прогревает проект. Первый `search_knowledge` после прогрева: 100 мс вместо 40 427 мс; ingest → indexed 453 мс.
- `ensureVectorAdapter` теперь делит один init-promise: поиск во время фонового прогрева не теряет vector-канал (иначе видел `vectorInitAttempted=true` без адаптера).
- **Найденные баги дефолтов:** авто-детект выбирал LaBSE `encoder.onnx` вместо Gemma (gold 52/78 vs 58/78, вне RU/EN 47–57% vs 69–78%); Gemma не получала instruction-префиксы; dim не выводился, т.к. `hidden_size` лежит в `text_config` (512), а реальный выход 768 — авто-конфиг молча падал в `EMBEDDINGS_MODE=none`. Всё трое исправлено, `EMBEDDINGS_DIM` стал опциональным (адаптер берёт длину реального вектора).
- Лексический floor по умолчанию 0.15 → 0.05: floor выбрасывал реальный RU-хит (confidence 0.06), docs hit@1 83.3% → 88.9%, RU 50% → 66.7%.
- Отклонено по замерам: RRF_K 5..60 (порядок не меняется), maxLen 512 (+0.005 MRR, 2.1× индексация, +1 ГБ RSS), чанкинг 1000/100 (та же точность при +64% чанков), mean-pooling (= sentence_embedding).
- `scripts/verify-memory.mjs` (`npm run memory:verify`): статусы verified/pending-merge/stale/no-anchor в теги, strong/weak анкоры (имена файлов в прозе и `/tmp/*` не делают факт stale), ветки тикета по префиксу, бюджеты `--limit`/`--budget-ms`. 120 фактов agent-memory против ALB: 27/2/0/91 за 6.7 с.
- Честный гэп: 40 с прогрева на 146 доках CPU; при базе больше бюджета остаток индексируется по требованию (первый поиск после частичного прогрева может быть медленным). CUDA-библиотек в песочнице нет — проверен только CPU-fallback.

### Сессия S-20260911-msec (Этап M фаза 1)

- PR #184 замерджен вручную в master (`5d64bc3`) — вся серия PH-001..015 на мастере
- AUD-01: `decideMethodCall` — общий method-level гейт; раньше resources/prompts/completion шли мимо auth на http+tcp
- AUD-02: все мутации из resources/read убраны; action-URI → `{ok:false,hint}` стабы
- AUD-03: `src/fs.ts` path-guards; permissive charset на storage (legacy id с пробелами/точками читаются), строгий regex — только на новых project_create

### Сессия S-20260911-e2ec (Q-014: добить e2e)

- Построена карта покрытия: до сессии e2e дёргал 45/114 инструментов; добавлены слайсы:
  - 15 `projects.test.ts` — project lifecycle (create→set_current→purge dryRun/confirm→delete force/идемпотентность)
  - 16 `tasks-bulk-dag.test.ts` — tasks_bulk_update/archive/trash/restore/delete_permanent + set_deps/get_deps/dag
  - 17 `knowledge-lifecycle.test.ts` — knowledge bulk lifecycle, tree, export_single/bundle/markdown, import_single, multimodal import, two-stage search
  - 18 `memory-extended.test.ts` — profiles, layers, scope_filter/tags, context_assemble, entity_search, temporal history/stats, evolve, conflicts, gc, observations, dream, async jobs (submit/status/cancel, extract_async), framework_adapter, benchmark
  - 19 `prompts-experiments.test.ts` — experiments/variants/bandit/metrics/feedback/ab_report/exports/catalog + bulk_update/delete
  - 20 `misc-surface.test.ts` — session_info/cluster degraded shapes, embeddings status/try_init, tool_help, graph_export_mermaid/graph_visualize, dashboard_trends, tools_run, relay share_brief/broadcast_rule
  - 21 `connectors-all.test.ts` — все 9 семейств коннекторов: регистрация по env-флагам (github/jira/slack требуют creds на init)
- **Баги, найденные e2e и исправлены:**
  - `src/register/setup.ts` — `REPO_ROOT` указывал на `dist/` в prod-сборке → prompts reindex (scripts/prompts.mjs) молча никогда не работал в prod; версия из package.json тоже не читалась
  - `src/register/memory.ts` — `memory_scope_filter` затирал `fact.scope` перед фильтрацией → любой dimension-фильтр всегда возвращал 0
  - `scripts/prompts.mjs` — `exportCatalog` не писал `metadata.status/domain/tags` → `prompts_list` по status/domain/tag никогда не матчился в prod-режиме
- harness: retry-обёртка rm в close() — orphan-подпроцессы реиндекса догоняли cleanup (ENOTEMPTY)
- Задокументированные гэпы: StreamableHTTP-сессии не трекаются SessionManager (session_list пуст после authenticate → session_info по живой сессии недостижим); scripts/ не входит в npm `files` (reindex не работает в установленном пакете)

### Последние действия (ночная сессия 2026-08-28/29, PR #119-#136)

- 2026-08-28: PR #119 — TD-010 Centralized error handling (ErrorCategory/ToolError/ErrorHandler/middleware)
- 2026-08-28: PR #120 — TD-011 Graceful degradation (CircuitBreaker→core, ServiceAvailability, withFallback, health-checks embeddings/catalog)
- 2026-08-28: PR #121 — TD-013 Test timing safety (session-manager 11 + rate-limiter 3 → vi.useFakeTimers)
- 2026-08-28: TD-014 WIP commit strategy (git wip alias + AGENTS.md 3.4)
- 2026-08-29: PR #122 — TD-012 Mock interface sync (tsconfig.test.json + tests/type-check.test.ts satisfies, fixed drift)
- 2026-08-29: PR #123 — Q-004 Core MCP E2E (tests/mcp-core-e2e.test.ts, stdio client)
- 2026-08-29: PR #124 — Q-005 Coverage threshold 80% (92.7% фактически)
- 2026-08-29: PR #125 — Q-008 JSON-RPC fuzzing (fast-check, нашёл -0 edge case в CI)
- 2026-08-29: PR #126 — Q-009 Chaos/shutdown (SIGTERM/SIGINT/SIGKILL, data integrity)
- 2026-08-29: PR #127 — Q-006 BM25 load tests (10k/50k, no-blowup)
- 2026-08-29: PR #128 — Q-007 Schema validation (ajv, draft-07+2020-12)
- 2026-08-29: PR #129 — BM-011 Behavioral dashboard (zero-dep HTML)
- 2026-08-29: PR #130 — P2 token-manager+a003 fake timers
- 2026-08-29: PR #131 — P1 flaky fixes (jwt nbf deterministic, SQLite таймауты 20s)
- 2026-08-29: PR #132 — AI-009 Wire ServiceAvailability (onVectorError + singleton registry)
- 2026-08-29: PR #133 — AI-008 Dashboard CLI (npm run dashboard)
- 2026-08-29: PR #134 — Q-012 Full test type-check (tsconfig.test.json → tests/**, 61 errors fixed)
- 2026-08-29: PR #135 — Q-013 Atomic writeJson (tmp+rename, ENOSPC-safe)
- 2026-08-29: PR #136 — AI-010 Schema drafts unified (draft-07)
- 2026-08-29: PR #137 — Q-010 Property-based core testing (fast-check)
- 2026-08-29: PR #138 — TD-008 ESM service-catalog import (ambient types)
- 2026-08-29: PR #139 — BM-012 LAN Relay (WS + AES-256-GCM + UDP multicast)
- 2026-08-29: PR #140 — TD-007 crypto.randomUUID (uuid dep dropped)
- 2026-08-29: PR #141 — Q-011 Wire format snapshots
- 2026-08-29: PR #142 — TD-006 JSDoc public functions
- 2026-08-29: PR #143 — D-005 Architecture diagram (Mermaid)
- 2026-08-29: PR #144 — D-001 API reference (76 tools, auto-gen)
- 2026-08-29: PR #145 — AI-004 BACKLOG CI validation
- 2026-08-29: PR #146 — AI-007 Agent performance tracking
- 2026-08-29: PR #147 — DX-007 Shared test factories
- 2026-08-29: PR #148 — DX-003 Dev CLI (diagnose/tools/sessions/export)
- 2026-08-29: PR #149 — DX-008 ESLint + Prettier
- 2026-08-29: PR #150 — DX-001 Hot tool registration
- 2026-08-29: PR #151 — DX-002 Wildcard filters
- 2026-08-29: PR #152 — DX-004 Hot config reload
- 2026-08-29: PR #153 — DX-005 ETag response cache
- 2026-08-29: PR #154 — TD-005 Knowledge versioning
- 2026-08-29: PR #155 — D-002 ADR (5 records)
- 2026-08-29: PR #156 — D-003 CONTRIBUTING + D-004 CHANGELOG
- 2026-08-29: PR #157 — AI-011 Claude Code plugin export (ADR-006)
- 2026-08-29: PR #158 — AI-012 Claude Code plugin import
- 2026-08-30: PR #159 — AI-013 Streaming progress notifications
- 2026-08-30: PR #160 — AI-015 Parallel tool batching
- 2026-08-30: PR #161 — AI-016 Rate-limit dashboard
- 2026-08-30: PR #162 — AI-014 OAuth 2.1 PKCE provider
- 2026-08-30: PR #163 — INT-004 Connector framework
- 2026-08-30: PR #164 — INT-001 GitHub connector
- 2026-08-30: PR #165 — INT-002 Jira + INT-003 Slack connectors
- 2026-08-30: PR #166 — SYNC-001/002 Protocol + SyncManager
- 2026-08-30: PR #167 — SYNC-003 3-way merge conflict resolver
- 2026-08-30: PR #168 — SYNC-004 Event sourcing + GC
- 2026-08-30: PR #169 — SYNC-005 E2E durability tests
- 2026-08-30: PR #170 — INT-005 REST wrappers + OpenAPI
- 2026-08-30: PR #171 — INT-006 gRPC wrappers
- 2026-08-30: PR #172 — OC-006 P2P sync setup
- 2026-08-30: PR #173 — OC-007 + OC-008 memory browser + config cleanup

### Что дальше

- **2026-09-11 (S-20260911-aud1):** аудит request-path (баги+секьюрити) → 17 находок в BACKLOG как Этап M (AUD-01..17) + AUD-18 (data-path аудит не проведён). Плюс Этап N — DX/Onboarding (DX-10..26): setup-wizard с идемпотентным merge клиентских конфигов, doctor, backup/restore DATA_DIR, agent_bootstrap/briefing/capabilities tools (только после design review — не регистрировать сырые), single-binary PoC, MCP Inspector CI. DX-ядро — после crit-фазы Этапа M. Плюс Этап O — Trust/Hardening (TR-01..13): аудиты prompt-injection через stored content, Web UI (уже подтверждён XSS в markdown-ссылках, TR-02), коннекторов/кредов, качества тестов; hardening: Docker root→non-root, dependabot+npm audit CI, privacy-декларация; governance: API-политика, MCP elicitation для confirm-флоу. Критичное: resources/read без auth + мутации через task://action (AUD-01/02), path traversal project/id (AUD-03), мёртвый security-стек — ACL/sanitizer/audit/auth-protection/rate-limit имеют 0 call sites (AUD-07), session expiry не прекращает доступ (AUD-05). Порядок: AUD-01+02+03 связанным инкрементом, затем AUD-07.
- BM-012 (LAN Relay, low, большая — mDNS+AES WebSocket, отдельный заход)
- Sync (5 pending), Tech Debt (3 pending: TD-005, TD-007, TD-008), Quality (3: Q-010, Q-011 + Q-012/013 done), Docs (5), Integration Hub (6), Web UI (7), OpenCode Integration (4+2)
- LoopX-цель: mcp-task-knowledge-goal (16 todo, 15 done)
- 2026-08-28: PR #100-#104 — SK-003..RL-005 (discovery, templates, policy, guardrails, enforcement)
- 2026-08-28: PR #105 — WF-005 state persistence; PR #106 — fix flaky knowledge test (monotonic updatedAt)
- 2026-08-28: PR #107 — WF-006 subflows (этап Workflows done 6/6)
- 2026-08-28: PR #108-#109 — SK-005 converters, SK-006 permissions (этап Skills done 6/6)
- 2026-08-28: PR #110-#111 — RL-004 rule packs, RL-006 rule import (этап Rules done 6/6)
- 2026-08-28: PR #112-#114 — MEM-002 entity graph, MEM-003 distillation, MEM-004 memory IO (этап Memory done 4/4)
- 2026-08-28: PR #115-#116 — BM-009 cross-project search, BM-010 guard rules auto-learning

### Что дальше

- BM-011 (Behavioral dashboard, low), BM-012 (LAN relay, low), BM-013 (Migration framework, high), BM-014 (FTS5 search, medium)
- Sync (5 pending), Tech Debt (10 pending), Quality (8), Docs (5), Integration Hub (6), Web UI (7), OpenCode Integration (4+2)
- WF-005..MEM-004 закрыли критический путь "SK-001 → WF-001 → WF-002"

---

## 9. Известные проблемы и технический долг

> Агент обновляет при обнаружении новых проблем.

| ID | Описание | Приоритет | Статус |
|----|----------|-----------|--------|
| TD-001 | `src/index.ts` — был монолит (~4010 строк до F-001/PR #31), сейчас 22 строки-делегата в app-container + register/setup | high | done | F-001 |
| TD-002 | Тип `any` в нескольких местах (vectorAdapter, toolRegistry) | medium | done | F-006 |
| TD-003 | Legacy-поддержка путей знаний (`DATA_DIR/knowledge/<id>.md`) | low | deferred | — |
| TD-004 | Отсутствие rate-limit на уровне инструментов | medium | done | S-003 (#53) |
| TD-005 | Нет версионирования документов знаний | low | pending | — |

---

## 10. Ключевые решения

> Агент фиксирует важные архитектурные и технические решения.

| Дата | Решение | Контекст |
|------|---------|----------|
| 2026-04-04 | Создана трекинг-тройка (AGENTS.md, BACKLOG.md, ROADMAP.md) для персистентности между сессиями | Инициализация агент-ориентированного воркфлоу |
| 2026-04-04 | Песочница откатилась — добавлен чек-лист синхронизации в AGENTS.md §0 | Обнаружено при повторном заходе в сессию |
| 2026-04-04 | AGENTS.md переписан по единому шаблону: песочница + git + трекинг-пара + улучшения флоу + проектная информация | Унификация воркфлоу |

---

## 11. Зависимости проекта

### Production

- `@modelcontextprotocol/sdk` ^1.17.3 — MCP SDK
- `@xenova/transformers` ^2.17.2 — ONNX-эмбеддинги
- `onnxruntime-node` 1.20.0 — CPU ONNX
- `onnxruntime-web` ^1.22.0 — Web ONNX
- `gray-matter` ^4.0.3 — Frontmatter парсер
- `markdown-it` ^14.1.0 — Markdown рендерер
- `fast-glob` ^3.3.2 — Glob по файлам
- `uuid` ^9.0.1 — UUID генерация
- `zod` ^3.23.8 — Валидация схем
- `service-catalog` file: — Каталог сервисов (локальная зависимость)

### Dev

- `tsx` ^4.17.0 — TypeScript execution
- `typescript` ^5.5.4 — TypeScript compiler
- `vitest` ^3.2.4 — Test runner
- `@vitest/coverage-v8` ^3.2.4 — Coverage
- `ajv` ^8.17.1 — JSON Schema validation
- `markdownlint-cli` ^0.39.0 — Markdown lint

---

## 12. Дополнительная документация

| Файл | Содержание |
|------|------------|
| `README.md` | Описание MCP-сервера, установка, конфигурация, инструменты |
| `ROADMAP.md` | Дорожная карта развития (14 этапов, 0-13) |
| `BACKLOG.md` | Бэклог задач с приоритетами и статусами |
| `RESOURCES.md` | MCP Resources: URI, схемы, примеры |
| `prompt_rules.md` | Правила для LLM-агента (Cascade) |
| `prompt_flow_guide.md` | Флоу работы с MCP-инструментами |
| `schemas/*.json` | JSON-схемы для валидации |
