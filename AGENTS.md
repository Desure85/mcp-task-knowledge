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

Файловый MCP-сервер для таск-менеджмента, базы знаний, библиотеки промптов и **памяти AI-агентов**. 129 MCP-инструментов (131 с включённым каталогом), 3189 тестов, 92.7% coverage.

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

### Дизайн и UI (web-ui)

- **Перед любой правкой `web-ui/` прочитай `DESIGN.md`** (в корне, рядом с этим файлом). Визуальные решения
  владельца фиксируются там, а не в переписке: токены, две оси темы, каталог примитивов, контракт страницы,
  список запретов и известный долг.
- Стиль меняется только через `DESIGN.md`: новый примитив — сначала в `web-ui/components/ui` и на `/design`,
  потом страница. Стражи `web-ui/lib/design-guards.test.ts` и `web-ui/lib/no-hardcoded-colors.test.ts` не
  обходятся allowlist'ом без причины и задачи-владельца.
- Сгенерированные блоки документа обновляет `npm run design:doc`; расхождение с кодом ловит
  `web-ui/lib/design-doc.test.ts`.
- Claude Code читает `CLAUDE.md`, который импортирует этот файл; правила `DESIGN.md` выше любых внешних
  скиллов вроде `frontend-design`.

---

## 8. Текущее состояние сессии

> Агент заполняет этот блок в начале и обновляет в конце каждой сессии.

**Дата последнего обновления:** 2026-11-09
**Session ID:** S-20261109-y02c (Y-02c — промпты за контрактом)
**Текущая ветка:** feat/y02c-prompt-contract (от origin/master dd49ca9, PR #321 влит)
**Текущий этап:** Подключаемое хранилище и эмбеддинги (Y): Y-02 идёт, за контрактами 5 из 6 коллекций
**Статус:** `Y-02c` → done: файловый доступ к промптам вынесен из `src/register/helpers.ts` в `src/prompts/files.ts` (код перенесён без изменений, helpers реэкспортирует — проверено сравнением функций по ссылке); в контрактах появились `PromptStore` (list/get/versions/catalog/buildItems) и `profile.prompts`. `tests/storage-contract.test.ts` — 24 теста. Вызовы не переключены. **Дальше: Y-02d** — память (temporal graph, профили, слоистая и сессионная память); затем **Y-02e** — профиль в `AppContainer`, регистраторы без прямых импортов.

### Сессия S-20261109-y02c (Y-02c — промпты за контрактом)

- Новый `src/prompts/files.ts`: `readPromptsCatalog`, `readPromptBuildItems`, `listSourceJsonFiles`, `listPromptVersions`, `findFileByIdVersion`, `PromptVersionInfo` — перенос из `src/register/helpers.ts` (регистратор) без изменения путей и форматов; `helpers.ts` реэкспортирует их, инструменты не трогали.
- `PromptStore` в `src/storage/contracts.ts`: `list` (id+version+kind+path), `get` (версия или последняя), `versions`, `catalog`, `buildItems`; `StorageProfile.prompts`, коллекция `prompts` в манифесте. Запись промптов (`prompts_bulk_create/update/delete` с валидацией и неймингом) осознанно осталась в инструментах до Y-02e — это часть переключения регистраторов, а не read-контракта.
- Контрактные тесты проверяют не только паритет с прямыми функциями, но и то, что `register/helpers` отдаёт **те же ссылки** на функции — иначе перенос развёл бы две реализации.
- Проверено: `npx vitest run tests/storage-contract.test.ts --maxWorkers=2` — 24/24 (5 новых); revert-check 3 мутации RED; build/type/lint/markdownlint/backlog — зелёные.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-09-1310-y-02c.md`.

### Сессия S-20261109-y02b (Y-02b — метаданные проекта, журнал, история и замки)

- `ProjectStore` (list/detail/create/remove/readMetadata/updateMetadata/workflow) — делегирование `src/projects.ts` и `loadProjectWorkflow`; `EventLogStore` — фабрика `events(storagePath)` поверх `EventLog` (путь задаёт вызывающий, правило 1 ADR-009); `HistoryProvider` — версии документов, для `kind: 'task'` бросает `StoreError('CAPABILITY_UNAVAILABLE')` (история задач — git этапа R, пустой список врал бы); `LockProvider` — `withLock` поверх `withFileLock`.
- Границы: wire-формат не менялся, поэтому `ProjectInfo`/`ProjectDetail` по-прежнему содержат `paths` (type-only импорт из `src/projects.ts`); удаление путей из ответов — отдельное изменение контракта инструментов после Y-02, записано в решении.
- Остаток Y-02 разбит на три: Y-02c — промпты и память; Y-02d — `AppContainer` и регистраторы без прямых импортов.
- Проверено: `npx vitest run tests/storage-contract.test.ts --maxWorkers=2` — 19/19 (6 новых: проект, замки, история, журнал); revert-check 4 мутации RED; build/type/lint/markdownlint/backlog — зелёные.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-09-1105-y-02b.md`.

### Сессия S-20261109-y02a (Y-02a — контракты хранилища и файловый профиль)

- ADR-009 §«Интерфейсы» реализован для двух самых больших коллекций: `TaskStore` (list/page/get/create/update/close/lifecycle/tree/claim) и `DocStore` (list/page/read/create/update/lifecycle/versions/restoreVersion), плюс `StorageProfile`/`StoreManifest` с возможностями профиля и `StoreError` (`NOT_FOUND | CONFLICT | CAPABILITY_UNAVAILABLE | CONFIG_MISMATCH`).
- Файловый профиль — тонкое делегирование текущим функциям `src/storage/tasks.ts`/`knowledge.ts`: контрактный тест сравнивает ответы профиля с прямыми вызовами, поэтому «поведение не меняется» проверено, а не заявлено.
- Корень передаёт вызывающий (правило 1 ADR-009); пока модули не принимают корень параметром (Y-02c), профиль сверяет его с конфигурацией и падает `CONFIG_MISMATCH` вместо обслуживания чужого каталога.
- `metadata-index` по-прежнему знает один `DATA_DIR`, а FTS ключуется `(store, kind, id)` — это расхождение скоупов из ADR-009 остаётся до Y-02c; в Y-02a его не трогали.
- Проверено: `npx vitest run tests/storage-contract.test.ts --maxWorkers=2` — 13/13; revert-check 3 мутации RED (`list` теряет фильтр, `page` теряет `countOnly`, нет сверки корня).
- Решение и откат: `docs/dev-cycle/decisions/2026-11-09-1030-y-02a.md`; границы Y-02a: ни регистраторы, ни схемы инструментов, ни layout файлов, ни схема `search_fts`/metadata-индекса не менялись.
- Локальный воркфлоу: полный прогон только `npx vitest run --maxWorkers=4` (AGENTS, TS-01); точечные файлы — `--maxWorkers=2`.

### Сессия ses_e4044f656ffecPUZcC6pQJAQRa (ADR-009 — приёмка владельцем)

- ADR-009 (`docs/adr/0009-pluggable-storage-and-embeddings.md`): статус `Accepted` (2026-11-09, «принят владельцем»); раздел приёмки переписан в «Решения владельца при приёмке» — профили и интерфейсы приняты целиком, 7 суток удержания старой коллекции векторов подтверждены как предложено, окно паузы записи не решено и отложено до замера Y-08 (измерение, а не вопрос к владельцу). Остальной текст ADR не менялся.
- BACKLOG: `Y-01` → done (ADR принят 2026-11-09), `TS-02` → done (смержен PR #318), `Y-02` pending с пометкой «ADR-009 принят, можно стартовать»; сводка: строка Y done 1 → 2, строка Quality 18/1/3/14 вместо 16/0/3/13 (не учитывала TS-01/TS-02), «Итого» done 291 → 293.
- Проверено: `npm run lint:md` и `npm run backlog:check` — exit 0. Кода нет: только `docs/`, `BACKLOG.md`, `CHANGELOG.md`, `AGENTS.md`.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-09-1257-y-01-accepted.md`.

### Сессия ses_e406f618fffek9DzuqwSAGs2ks (TS-02 — изоляция каталога данных между сьютами)

- `tests/setup.ts`: `DATA_DIR` и `OBSIDIAN_VAULT_ROOT` — `mkdtemp` на тест-файл (vitest исполняет `setupFiles` на каждый файл; проверено тремя пробными файлами с `--maxWorkers=1`: три исполнения setup, три pid), снятие каталога в `afterAll`, свип осиротевших каталогов и registry-файлов по своему префиксу старше 2 ч.
- `tests/setup.ts` пишет `(pid → DATA_DIR)` в `<tmp>/mcp-vitest-registry-<ppid>.jsonl`; `tests/data-isolation.test.ts` проверяет приватность каталога и отсутствие повторов. Revert-check: старый `setup.ts` → 2 упавших проверки; мутация `mkdtemp` → `expected 1 to be 2`.
- Прогоны (Node 24.22.2, `timeout 600`, только `npx vitest run`): 3 полных прогона при грязном `.tmp-vitest` — 293 файла / 3417 тестов, 132.6 / 133.4 / 132.6 с; серия `search-fts` + `sec003-auth-gate` 10/10 до и 10/10 после; `npm run test:types` и `npm run backlog:check` зелёные.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-09-1233-ts02-test-data-isolation.md`; BACKLOG `TS-02` (high), CHANGELOG.

### Сессия ses_e409dcc90ffeTgBbDcJ59Fohq9 (AC-05 — честный статус search_tasks)

- `src/search/index.ts`: `fuseRankings` подставляет `bm25Score`/`vectorScore` = `0` для канала без вклада (`undefined` выпадал из JSON).
- `src/register/search.ts`: `toRanked` доводит оба поля числом на границе инструмента (`bm25Score ?? score`, `vectorScore ?? 0`), поэтому чисто лексический скан без векторного адаптера тоже отдаёт `bm25Score`, а не теряет ключ; `hybridSearch` не менялся — отсутствие поля у внутреннего помощника пинует `src/__tests__/hybrid_rrf.spec.ts:65`.
- `src/register/search.ts`: `scanDeferral` — при идущем fill и корпусе больше `SEARCH_SCAN_MAX_TASKS` (2000, ленивое чтение env) возвращается `errWith({code:'INDEXING', details:{retryAfterMs:1000}})`, иначе `candidateMeta` размечает скан: fill → `indexing` + `retryAfterMs`, dirty/ошибка fill → `indexing` + `needsReindex`, нет индекса/полный индекс → без маркеров. `type`-фильтр по-прежнему на файлах и без `INDEXING`.
- `tests/search-tasks-warmup.test.ts` (6): отдельный `mkdtemp` для metadata-индекса, иначе параллельные сьюты на общем `.tmp-vitest/.index/metadata.db` дают SQLITE_BUSY и ложные падения SC-03c.
- Решение: `docs/dev-cycle/decisions/2026-11-09-1135-ac05-search-status.md`; контракт в `docs/features/tools.md`, запись в `CHANGELOG.md`, статус AC-05 в `BACKLOG.md`.
- Флейк: при грязном `.tmp-vitest` от предыдущих прогонов пара `search-fts` + новый файл падала; на чистом каталоге и на полном прогоне зелёные. Полный прогон запускать после `rm -rf .tmp-vitest`.

### Сессия ses_e410a56d8ffeVJlqKeRhjidayR (SC-03c — поиск читает FTS5)

- `src/register/search.ts`: `search_tasks`/`search_knowledge` берут до 500 id из `search_fts`, затем прогоняют существующие `hybridSearch`/`promoteExactMatches` по кандидатам; `type`-фильтр остаётся на файловом пути (фильтр корпуса до ранжирования). Meta: `source: 'fts'|'scan'`, `indexing: true` при фоновом fill, `totalExact: false` + `candidates` при упёртом пуле.
- `src/search/fts-indexer.ts`: `isProjectFtsComplete` (metadata complete + `!dirty` + равенство счётчиков без archived/trashed), `ensureProjectFtsIndexed`/`awaitProjectFtsIndexed`/`getProjectFtsFillState` — один inflight на проект; грязный индекс не дозаполняется.
- `src/core/app-container.ts` + `src/cli/reindex.ts`: `reindex --data` применяет миграции DATA_DIR, boot после миграций не перестраивает индекс; сама перестройка помечает проекты complete и пересобирает FTS.
- **Найдено владельцем:** `FtsSearchIndex.upsert` удалял строку по UNINDEXED-колонкам → полный скан на запись, 100k reindex 26 мин без результата. Исправлено `search_fts_keys(store,kind,id,project,rowid)` + индекс `(store,kind,project)`, удаление по rowid, `rebuild` — очистка один раз; схема v4. Масштабный тест: rebuild 20k за 0.5 с, revert-check RED.
- `scripts/kb-bench.mjs`: `retrieval --via-tool` — реальный MCP-тул, reindex фикстуры, exit 2 если хоть один запрос ушёл в скан. 530 чанков, embeddings off: via-tool 77.8/0.838 против старого 77.8/0.830.

### Сессия TS-01 (стабильность тестов и безопасный прогон)

### Сессия TS-01 (стабильность тестов и безопасный прогон)

- `vitest.config.ts`: `resolveMaxWorkers(cores, VITEST_MAX_WORKERS)` = `min(4, cores/2)`, значение попадает в `test.maxWorkers`; `tests/vitest-limits.test.ts` (4 теста) падает, если потолок убрать из конфига.
- `package.json` (`test`, `test:coverage`) и `.husky/pre-push` передают `--maxWorkers=${VITEST_MAX_WORKERS:-4}`; CI-воркфлоу не менялись — конфиг применяется в любом `vitest run`.
- Причины флейков: `executable-docs` запускал скрипт 5 раз на файл (60-с exec-бюджет под нагрузкой), `mcp-inspector` поднимал 5 серверов внутри дефолтного 5-с таймаута, `auth-session-stress` терял stderr ребёнка, `pagination` полагался на разницу mtime от `setTimeout(2)` (при равных mtime вставленная задача дублировалась в 6/10 обходов курсора).
- Замер: полный прогон на 72-ядерной машине — пик 2352 МБ по сумме RSS дерева процессов, наблюдаемый максимум 3 воркера из 4; 3/3 прогона по 144/145/136 с.

### Сессия S-20261108-sc03b (SC-03b — запись FTS5-индекса при мутациях)

- `src/search/fts-indexer.ts`: `setActiveFtsIndex`, `noteTaskWritten`/`noteDocWritten`, `noteTaskRemoved`/`noteDocRemoved`, `noteProjectRemoved`, `rebuildFtsIndex` (полная и проектная пересборка). Текст — `buildTextForTask`/`buildTextForDoc` (паритет с BM25), store — `resolveStoreId(TASKS_DIR|KNOWLEDGE_DIR)`.
- Хуки в storage-слое рядом с metadata-индексом: `tasks.ts` (create/update/move/delete), `knowledge.ts` (create/update/delete), `projects.ts` (удаление проекта). Bulk-инструменты и `project_purge` идут через те же функции, поэтому покрыты без отдельных хуков.
- archived/trashed удаляют строку, restore возвращает. Сбой записи индекса не валит мутацию: лог + `search_meta.dirty`, снимается `reindex`.
- `AppContainer` открывает FTS вторым соединением к `DATA_DIR/.index/metadata.db` под тем же `STORAGE_INDEX`; после миграций схемы ставит dirty.
- `index-inspect` считает строки по `(store, kind)` против metadata-индекса и перепроверяет термы на выборке; `reindex --verify` → exit 1 при расхождении, обычный `reindex` чинит вместо пропуска; `doctor` предупреждает `fts-unavailable|dirty|drift|stale-terms`.
- Тесты: 8 новых в `tests/search-fts.test.ts` (28 в файле), фикстура `metadata-index-doctor` строит и FTS. Revert-check 4 мутации RED. Живая проба на копии `/data` (597 задач/570 доков): 978 строк, ±1 на create/trash/restore/delete.
- **Полный прогон на этой машине — только `npx vitest run --maxWorkers=4`**: без лимита 72 ядра поднимают ~70 воркеров по ~0,9 ГБ и машина уходит в перезагрузку (инцидент 2026-11-08/09).

### Сессия S-20261108-y01 (Y-01 — ADR хранилища и эмбеддингов)

- ADR-009 в `docs/adr/0009-pluggable-storage-and-embeddings.md`, статус Proposed: решение Y-09 от 2026-11-03 записано дословно, ADR целиком не принят — `Accepted` ставит владелец.
- Номер взят по факту: `docs/adr/0008-admin-backup-restore.md` уже занят (DX-16), поэтому ожидание `0008` в AA-01 устарело. При старте AA-01 брать следующий свободный номер, а не номер из текста задачи.
- Индекс ADR в `docs/architecture.md` отставал на три записи (в списке были 0001–0005) — дописаны 0006, 0007, 0008 вместе с 0009; в PR это названо долгом, а не работой Y-01.
- Проверено исполнением: FTS5 в `better-sqlite3` (SQLite 3.53.2) доступен; `sqlite-vec` не подключён (`vec_version()` отсутствует) — совместимость вынесена в гейт Y-05, установка в Y-01 не выполнялась.
- Сопоставление с кодом: `MetadataIndex` (`src/storage/metadata-index.ts:126`) и `search_fts` (`src/search/fts-index.ts:83`) остаются производными индексами файлового профиля; Y-02 не меняет их схемы и ключи, SC-03b/03c идут до и после Y-02. Расхождение скоупов (metadata-index знает один `DATA_DIR`, FTS ключуется по `store`) записано как ограничение, которое снимает Y-02.
- Граница Y-02 в ADR: меняется точка сборки, контрактные тесты и способ доступа модулей; wire-формат, layout, схемы индексов и ранжирование не меняются.

### Сессия S-20261108-ac04d (AC-04d)

- Причина пункта 1: SDK валидирует аргументы на транспорте, а `tools_run`/`tools_batch` зовут `meta.handler(params)` напрямую — валидации нет. Строгая схема в обходе сломала бы AC-01 (`UNKNOWN_PARAM` не дошёл бы), поэтому разбор идёт `looseInputSchema` (v3 `passthrough`/v4 `looseObject`), как у SDK.
- Причина пункта 2: старые паттерны покрывали JWT/bearer/`ghp_`/`sk-` и JSON-поля по точным именам. Новые классы закрыты якорями: Basic — только после `authorization`; JSON-ключи — по суффиксу секретного слова (поэтому `tokenCount` не маскируется); query — по точному списку имён.
- `resolveProject(project)` в `logs_tail` по-прежнему только валидирует проект, но не фильтрует лог (серверный лог общий) — это записано в AC-04e, не чинилось.
- Тесты: `tests/tools-run-errors.test.ts` (+4), `tests/log-tail.test.ts` (+19: 12 положительных и 7 негативных строк таблицы). Полный прогон — 290 файлов / 3388 тестов; `tsc -p tsconfig.test.json --noEmit` — 0 ошибок.
- Живая проба: копия `/data` в `/tmp/ac04d-live`, `tools_run{tasks_create,{project:'mcp'}}` → `VALIDATION_ERROR`, `paths:["title"]`, файлов задач 426 → 426.

### Найдено в сессии SC-03a2 (для следующих инкрементов)

- **Хранилищ несколько и они не обязаны лежать в `DATA_DIR`:** `MCP_TASK_DIR`/`MCP_KNOWLEDGE_DIR` могут указывать на другой том, legacy-раскладка `DATA_DIR/mcp/*` учитывается `pickDir`. Всё, что хранит путь или идентичность (индекс, кэши, бэкапы), должно это учитывать.
- Legacy-задачи получают id из имени файла (`tasks.ts`), поэтому id не UUID-уникален глобально — идентичность только `(store, kind, id)`.
- `resolveStoreId` нормализует регистр на Windows: ФС регистронезависима, иначе `C:\Tasks` и `c:/tasks` дали бы два «хранилища».
- `metadata-index` хранит `relPath` относительно `DATA_DIR` и читает `path.resolve(dataDir, relPath)`; для внешних каталогов он вырождается в `../../...`. В SC-03b не тащить это в FTS: `store` — корень каталога задач/знаний, а не `DATA_DIR`.

### Контракт счёта инструментов (2026-11-07)

| Режим | env | `tools_list` (реестр) | протокольный `tools/list` |
|---|---|---|---|
| по умолчанию | — | 129 | 129 |
| каталог, чтение | `CATALOG_ENABLED=true` | 131 | 131 |
| каталог, запись | плюс `CATALOG_WRITE_ENABLED=true` | 133 | 133 |
| компактный | `MCP_TOOLS_ENABLED=false` | 129 (реестр полный) | 4 |

- Источник истины — живая регистрация, а не grep по `src/`: число зависит от env, а вызовы `registerTool` многострочные.
- `docs/api-reference.md` генерируется: `npm run api:reference`. Шапка выводит total, core и число динамических инструментов из live-списка — руками не править.
- `docs/features/tools.md` описывает каждый инструмент строкой таблицы; упоминание в прозе страж не засчитывает.
- Новый инструмент: строка в `docs/features/tools.md` плюс `npm run api:reference`; иначе `npm test` красный.

### Хроника прошлых сессий

Сессии 2026-08-28 … 2026-10-31, список PR #100-#173 и прежние планы вынесены в
[`docs/history/agents-session-log.md`](docs/history/agents-session-log.md) — перенос без потери текста.

### Что дальше

Очередь и приоритеты — в `BACKLOG.md` (сводная таблица «Итого»); этот блок их не дублирует.

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

Список сверен с `package.json` 2026-11-07; при обновлении зависимостей правится вместе с ним.

### Production

- `@huggingface/transformers` ^4.3.1 — ONNX-эмбеддинги (модели, токенизация)
- `@modelcontextprotocol/sdk` ^1.32.0 — MCP SDK
- `better-sqlite3` ^12.11.1 — SQLite: FTS5, auth/ACL-хранилище
- `fast-glob` ^3.3.2 — Glob по файлам
- `gray-matter` ^4.0.3 — Frontmatter парсер
- `jose` ^6.2.2 — JWT
- `markdown-it` ^14.3.3 — Markdown рендерер
- `onnxruntime-node` 1.30.0 — CPU/GPU ONNX
- `onnxruntime-web` ^1.22.0 — Web ONNX
- `pino` ^10.3.1 — структурированное логирование
- `prom-client` ^15.1.3 — Prometheus-метрики
- `ws` ^8.21.3 — WebSocket realtime
- `zod` ^4.6.7 — валидация входных данных

### Dev

- `typescript` ^5.5.4, `tsx` ^4.17.0 — компиляция и запуск
- `vitest` ^3.2.4, `@vitest/coverage-v8` ^3.2.4, `fast-check` ^4.9.0 — тесты, coverage, фаззинг
- `ajv` ^8.18.0, `ajv-formats` ^3.0.1 — JSON Schema валидация
- `eslint` ^10.9.1, `@eslint/js` ^10.0.1, `typescript-eslint` ^8.68.0, `eslint-config-prettier` ^10.1.8, `globals` ^17.11.0, `prettier` ^3.9.6 — линт и формат
- `markdownlint-cli` ^0.39.0 — markdownlint
- `husky` ^9.1.7, `lint-staged` ^16.4.0 — git-хуки
- `pino-pretty` ^13.1.3 — читаемый лог в dev
- `@types/node` ^20.14.12, `@types/better-sqlite3` ^9.6.0, `@types/pino` ^7.0.4, `@types/ws` ^8.18.1, `@types/uuid` ^9.0.7 — типы

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
