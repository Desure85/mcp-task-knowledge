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

**Дата последнего обновления:** 2026-11-12
**Session ID:** S-20261109-night (Y, TS-01, DX-10, DX-11, DX-14, DX-16, DX-25, DX-28, DX-29, CM-01, CM-03, AA-01, AA-05, AA-07, AA-09, SC-06, Z-01, Z-02, Z-03, Z-04, Z-05, Z-06, Z-10, Z-11, Z-12, CM-03a, INT-007, T-01, T-02, TR-04d, TR-04e, TR-04f, TR-04h, TR-20, TR-21, TR-23, TR-24, TR-31, TR-32, TR-33, TR-34, TR-35, TR-36, TR-37, TR-38, SPEC-06, SPEC-07, SPEC-09, U-02, U-03, U-04, U-05, U-06, UI-11, UI-12, UI-15, UI-16, UI-17, UI-18, UI-19, UI-20, UI-21, UI-25, UI-30, UI-31, UI-32, UI-33a, UI-36, UI-37, UI-38, UI-39, UI-40, SC-04, SC-05 закрыты; UX-hotfix)
**Текущая ветка:** feat/sc-06-storage-sharding (от master d288ea8)
**Текущий этап:** SC-06 закрыт; CM-03b blocked; blocked — MU-07/TK-02/TK-01/MU-02/MU-03, AA-04
**Статус:** shard 0.67 ms/100k; 6/6; компакция ручная.

### Сессия S-20261109-night (SC-06 — storage sharding)

- `sharding.ts`: first-2 shard, root/shard/legacy read, dedupe, marker, compact.
- Tasks/knowledge create→shard after threshold; archive без удаления; 100k: 256 shard, 0.67 ms.
- Ограничения: file profile; ленивый счётчик; компакция без таймера.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-12-0455-sc-06.md`.

### Сессия S-20261109-night (AA-09 — backlog sync)

- `backlog-sync-check.mjs` + `backlog-tracker-map.json`: только mapped ID, status aliases.
- Read-only, JSON, exit 0/1/2; tests 5/5, mutation RED. Ограничение: /data и живой трекер недоступны.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-12-0430-aa-09.md`.

### Сессия S-20261109-night (DX-25 — client compatibility matrix)

- `docs/compatibility.md`: config/protocol/live, дата, честные ?/✗.
- README ссылка; Desktop/Cursor/Windsurf/VS Code — config-level; Claude Code/OpenCode live blocked.
- Ограничение: GUI/логин недоступны; обновление ручное при релизе.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-12-0035-dx-25.md`.

### Сессия S-20261109-night (DX-28 — contributor DX)

- PR/issue-шаблоны, devcontainer, Last verified в architecture.
- Ограничение: devcontainer не собран (нет Docker), диаграмма упрощена.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-12-0050-dx-28.md`.

### Сессия S-20261109-night (TR-21 — единый IP-ключ AuthProtection)

- `getClientKey` + `SecurityStackCall.clientKey`; auth-gate передаёт IP-ключ.
- Lockout общий для login/tool-calls; fallback sessionId сохранён.
- Tests 3/3, security-stack 10/10; мутация RED. Ограничение: IP за прокси — адрес прокси.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-12-0015-tr-21.md`.

### Сессия S-20261109-night (SPEC-07 — progressToken gating)

- `progressTokenFromExtra`; sender no-op без токена, params с `progressToken`.
- Tests 7/7; мутация RED. Ограничение: production-вызовов helper пока нет.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-2340-spec-07.md`.

### Сессия S-20261109-night (TR-32 — redaction/JIRA https/scopes)

- `LOG_REDACT_PATHS` в pino (root и destination); JIRA host только https/absolute.
- Docs scopes; tests 4/4; мутация RED. Ограничения: message не маскируется, init-only.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-2355-tr-32.md`.

### Сессия S-20261109-night (TR-36 — connector error envelope)

- `connectors/errors.ts` + обёртка регистрации в github/jira/slack.
- Ошибки API/валидации → `{ok:false,error:{message}}`; успех не изменён.
- Tests 4/4, timeout 2/2; мутация RED. Ограничения: только 3 коннектора, без кодов.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-2325-tr-36.md`.

### Сессия S-20261109-night (TR-35 — crawler errors)

- `fetchPage` discriminated union; `crawlSite` failed/errors[] и crawled только успешные.
- Docs connectors; tests 3/3 (404/network/success); мутация RED.
- Ограничения: all-failed crawl ok:true с failed, errors без cap.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-2310-tr-35.md`.

### Сессия S-20261109-night (TR-24 — shared package version)

- `utils/package-version.ts`; setup/schema-version/backup-archive используют его.
- Env → package.json → 0.0.0; tests 2/2; мутация env-guard RED; build чистый.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-2255-tr-24.md`.

### Сессия S-20261109-night (TR-23 — dead constant)

- Удалена `PROJECT_META_FILE`; grep ссылок нет; реальный путь `DATA_DIR/projects/<id>.json`.
- build + project ACL/e2e 4/4; поведение не менялось.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-2245-tr-23.md`.

### Сессия S-20261109-night (AA-07 — bundle/installer)

- `bundle.json` + `gen-bundle` + `bundle:check`; 11 компонентов, sha256, client roots.
- `install-agent`: dry-run, hash-before-write, config merge, backup/manifest, no changes, rollback.
- Setup-link Bundle section; publish files; Windows CI job; docs deployment/install-agent.
- Проверено: 8/8 installer, 10/10 setup-link, manual smoke, mutation RED.
- Ограничения: live plugin load/tracker draft не проверены, npx tarball, JSONC, non-transactional.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-2230-aa-07.md`.

### Сессия S-20261109-night (CM-03 — instructions close)

- CM-03a-код не менялся; live stdio Client.getInstructions 6 строк/25 доменов; 4/4.
- CLI: claude not logged in; opencode NONE без MCP; CM-03b blocked, видимость не заявляем.
- Мутация domainText RED; docs/features/server-instructions.md; откат docs-only.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-2218-cm-03.md`.

### Сессия S-20261109-night (UI-40 — палитра)

- `globals.css`: 12 hue + info × 6; `theme-tokens/theme-pairs/project-settings` расширены.
- `ColorTokenPicker` (radiogroup, labels, light/dark previews); `StatusesTab/TypesTab`.
- `board/board-lanes` новые классы; `/design` сетка; DESIGN §3.7/§4.7 + design:doc.
- Проверено: contrast 94×6, ui40 5/5, tabs 22/22, guards 12/12, мутация RED.
- Ограничения: сервер принимает любой string (hex fallback), fixed palette, details popover, old custom prepaint.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-2155-ui-40.md`.

### Сессия S-20261109-night (UI-33a — server themes)

- `profile_get/set` + `UserProfileStore` LWW/atomic; `theme-sync.ts` snapshot/pending.
- ThemeSync в AppShell; ThemesScreen persist/remove events; server-event фикс undefined.
- E2E: device A→B Petrol, offline Copper queue, newer server Indigo; unit 9/9, mutation RED.
- Ограничения: no live sync, single pending slot, client clock, local stdio shared, JSON unencrypted.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-2122-ui-33a.md`.

### Сессия S-20261109-night (Z-06 — prompt provenance)

- `provenance.ts`: manifest source/hash/snapshot/history, status modified, diff, update force, rollback.
- `tests/prompt-provenance.test.ts` 5/5; traversal/duplicate/overwrite; мутация RED.
- Ограничения: нет MCP/UI, path-level diff, strings, full snapshots, non-transactional.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-2104-z-06.md`.

### Сессия S-20261109-night (UI-20 — mobile)

- `MobileNav` → active label + Menu Dialog; Topbar mobile reduced; sticky PageHeader.
- CSS 44px targets (sr-only excluded), `table[data-mobile-cards]` for tasks.
- E2E 14/14 на 390, 768 overflow 0; screenshots `docs/ui/screens/ui-20`.
- Ограничения: cards только tasks list, topbar hides realtime/auth, sticky ~104px.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-2026-ui-20.md`.

### Сессия S-20261109-night (UI-32 — knowledge health)

- `KnowledgeHealth`: stale facts (memory_verify), invalidated facts, unlinked docs, top graph nodes.
- `api.memory.verify`; e2e создаёт stale-факт + unlinked doc, оба видны; мутация RED.
- Ограничения: repo=cwd, bulk 200, contradictions=invalidated, parent/child only, top-5.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-2003-ui-32.md`.

### Сессия S-20261109-night (UI-21 — connect agent)

- `setup-flow.ts`: parse snippet + redeem/check helpers; server routes redeem/check.
- 5 шагов в `/access`, copy config, проверка настоящим initialize, error alert.
- E2E 1/1 (clipboard, status, abort), unit 3/3; localhost origin normalization.
- Ограничения: MCP_API_URL origin, link consumed, best-effort session delete, clipboard permission.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1946-ui-21.md`.

### Сессия S-20261109-night (TR-04e — weak assertions)

- Усилены app-container, jwt-validator, bm25, bandits, embeddings.cache.
- K10b/K12/K13/K14/K16 RED по одной; восстановление 150/150.
- Ограничения: K12 без live JWKS refetch; K13 формула; K16 floor 8 MiB.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1927-tr-04e.md`.

### Сессия S-20261109-night (Z-05 — prompt sources)

- `src/prompts/sources.ts`: interface, LocalMarketplaceSource, GitHubPromptSource, 2 MiB, wx.
- `tests/prompt-sources.test.ts` 6/6: marketplace search/import/overwrite, path escape, GitHub fixture.
- Мутация `assertInside` RED. Ограничения: нет MCP/UI, import raw, GitHub rate limit.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1909-z-05.md`.

### Сессия S-20261109-night (SC-05 — graph LOD)

- `graph-viz.ts`: cap 300, static 4-ring layout >30, labels top-18 + collision, clusters/depth.
- Бенчмарк 5000: 207 ms long tasks, timedOut=false; screenshots 200/1000 + JSON.
- `tests/graph-viz.spec.ts` 25/25; мутация cap RED. Ограничения: synthetic, node-count cap.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1853-sc-05.md`.

### Сессия S-20261109-night (UI-19 — System admin)

- `session_kill` admin-only + `selfSessionId`; каталог 20/стр., фильтр/5 строк, mobile cards, auth 3 шага.
- `tests/session-tools.test.ts` 18/18; `web-ui/e2e/system.spec.ts` 1/1; guards 17/17.
- Мутация admin-check RED. Ограничения: process-local kill, UI e2e без фактического kill.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1833-ui-19.md`.

### Сессия S-20261109-night (SPEC-06 — resources/subscribe)

- `src/register/setup.ts`: subscribe/unsubscribe handlers, per-server Set, notify write-глаголов.
- `tests/resource-subscribe.test.ts` 2/2 на реальном stdio; capability subscribe true.
- Ограничения: tools_run не уведомляет, ok:false может уведомить, in-memory подписки.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1807-spec-06.md`.

### Сессия S-20261109-night (UI-18 — analytics trends)

- `web-ui/app/analytics/page.tsx`: parallel stats/trends/activity, CSS bars, day/week, 7/30/90, empty state.
- `web-ui/e2e/analytics.spec.ts` 1/1 на изолированных :3002/:3003; network calls и empty после trash.
- Ограничения: нет осей/библиотеки, фиксированные периоды, e2e чистит задачи проекта.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1752-ui-18.md`.

### Сессия S-20261109-night (U-04 — compact read responses)

- `src/utils/pagination.ts`: compactRecord + PageRequest.compact; `pageArgsSchema`.
- `tasks_get`/`knowledge_get` fields/compact; `memory_facts_search` compact.
- `tests/response-economy.test.ts` 4/4; related 136/136; мутация no-op RED.
- Ограничения: не все read tools, произвольные длинные ключи остаются, error envelope не расширен.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1731-u-04.md`.

### Сессия S-20261109-night (U-06 — graph_neighbors)

- `src/register/graph-neighbors.ts`: task deps/blocks/parent/child, doc parent/child, memory mentions.
- `limit`/fields; unknown id empty; temporal errors не скрывают task/doc.
- `tests/graph-neighbors.test.ts` 3/3; docs 6/6 (154); мутация direction RED.
- Ограничения: direct only, project-scoped, temporal ≤1000, короткие метки только exact.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1714-u-06.md`.

### Сессия S-20261109-night (U-02 — changes_since)

- `src/register/changes.ts`: tasks/docs/memory delta, `nextSince`, create/updated/closed/archived.
- `tests/changes-since.test.ts` 5/5; docs coverage 6/6 (153); мутация comparator RED.
- Ограничения: нет hard-delete tombstone, ms-коллизии, temporal ≤1000, nextSince — эвристика.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1659-u-02.md`.

### Сессия S-20261109-night (INT-007 — YouTrack connector)

- `src/connectors/youtrack.ts`: list/get/projects, query pass-through, custom fields/comments, real health.
- Регистрация `YOUTRACK_CONNECTOR_ENABLED=1`; docs connectors.
- `tests/youtrack-connector.test.ts` 5/5; связанные 23/23; мутация State RED.
- Ограничения: read-only, $top без пагинации, live YouTrack нет.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1644-int-007.md`.

### Сессия S-20261109-night (TR-04d — memory data assertions)

- `tests/e2e-full/memory-lifecycle.test.ts`: statement/count/history/current-slice после invalidate.
- Мутация K9 `facts: []` RED; восстановление 3/3.
- Ограничения: 4 из ~30 вызовов, facts list shape-only, Node 22 → fallback.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1628-tr-04d.md`.

### Сессия S-20261109-night (TR-04h — validate-schemas)

- `scripts/validate-schemas.mjs`: fixed `_obj` → `obj`; valid feedback row no longer false-invalid.
- `tests/schema-validation.test.ts`: spawn real script, rc 0 valid / rc 2 invalid; 15/15.
- Мутация N1 RED; подпункт TR-04h не входит в «Итого» (340/58).
- Ограничения: проверена feedback-ветка, legacy/mcp paths нет.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1611-tr-04h.md`.

### Сессия S-20261109-night (TR-04f — dashboard date range)

- `tests/dashboard.test.ts`: реальный `dashboard_stats` handler, since/until, 10/10.
- Мутация `filterByDateRange → []` RED; восстановление 10/10.
- Ограничения: file-profile, timezone-границы не проверены, activity без date-фильтра.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1556-tr-04f.md`.

### Сессия S-20261109-night (SPEC-09 — protocol conformance)

- `tests/protocol-version-e2e.test.ts`: supported echo, latest, unknown → latest.
- Реальный `dist/index.js`, unique DATA_DIR, cleanup через `terminateServer`.
- 3/3; assertion mutation RED. Ограничения: dist нужен, HTTP initialize не покрыт.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1545-spec-09.md`.

### Сессия S-20261109-night (TR-31 — health probes)

- `src/connectors/health-probe.ts`: authenticated read + timeout; 401/network → unhealthy.
- Пробы gdrive/gmail/notion/onedrive/linear; GDrive без access token unhealthy.
- `tests/connector-health-probes.test.ts` 5/5; связанные 27/27; мутация RED.
- Ограничения: проба на каждый health, refresh flow не проверен, error body ≤200.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1525-tr-31.md`.

### Сессия S-20261109-night (U-05 — memory_verify)

- `src/memory/verify.ts`: anchors/suffix/line/symbol + `loadRepoIndex`.
- `memory_verify`: memory_fact docs, verified/stale/no-anchor, read-only; `REPO_INVALID`.
- `tests/memory-verify.test.ts` 4/4; docs coverage 6/6 (152); мутация RED.
- Ограничения: pending-merge только CLI, PHP-символы, семантика вручную, read-only.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1510-u-05.md`.

### Сессия S-20261109-night (T-02 — проектные роли и ACL)

- `ProjectMetadata.members`, `project-access.ts`, стадия `project-acl` в SecurityStack.
- `project_list` фильтрует, `/ws` reject foreign project, UI Members card, 3 MCP tools.
- `tests/project-acl.test.ts` 4/4; docs coverage 6/6; web tsc/guards 12/12; мутация RED.
- Ограничения: legacy без members публичен; user id не FK; нет UI e2e; memory/system вне T-02.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1455-t-02.md`.

### Сессия S-20261109-night (TR-34 — circuit breaker коннекторов)

- `initAll` оборачивает connector tools в `ServiceAvailability`; fast-fail circuit open.
- `availabilityComponents()` → `HealthChecker` connector:<id>.
- `tests/connector-circuit-breaker.test.ts` 2/2; мутация guard RED.
- Ограничения: один circuit на коннектор, фиксированные тайминги, skip-init без health.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1430-tr-34.md`.

### Сессия S-20261109-night (DX-29 — закрытие)

- `SetupLinkStore` + `admin_setup_link` + `POST /admin/setup-links` + `GET /.well-known/mcp-setup/<otp>` + `/access`.
- `tests/setup-link.test.ts` 10/10; live create → 200 markdown, second GET → 410.
- Ограничения: OAuth DCR не оценён, store in-memory, UI e2e нет, npx не установлен.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1410-dx-29-close.md`.

### Сессия S-20261109-night (TR-20 — WS ticket rate-limit)

- `redeem(ticket, remote)` + `redeemRateLimit`; HTTP 30/60s; `rate_limited` не сжигает тикет.
- `RealtimeServer` передаёт `req.socket.remoteAddress`.
- `tests/ws-ticket.test.ts` 14/14; мутация проверки RED.
- Ограничения: in-memory per instance, shared IP за прокси, валидные reconnect считаются.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1235-tr-20.md`.

### Сессия S-20261109-night (U-03 — evidence при закрытии)

- `Task.evidence`, `tasks_close.evidence`, `project_update.requireEvidence`; `tasks_get` отдаёт evidence.
- Валидация sha/https/≤4096; `EVIDENCE_INVALID`/`EVIDENCE_REQUIRED`.
- `tests/task-evidence.test.ts` 3/3; мутация проверки requireEvidence RED.
- Ограничения: символы не байты; cascade — только root; byUserId не заполняется.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1220-u-03.md`.

### Сессия S-20261109-night (DX-14 — закрытие)

- `seedPromptsIfEmpty` уже вызывается из `AppContainer.init()`; 7 сидов, отказ при непустой библиотеке, идемпотентность.
- `tests/prompts-seed.spec.ts` 8/8; live stdio `prompts_list` на пустом DATA_DIR → 7.
- Ограничения: только полностью пустая библиотека; snapshot 1.0.0; без overwrite.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1205-dx-14-close.md`.

### Сессия S-20261109-night (TR-38 — drain admission)

- HTTP: новый initialize при draining → 503/Retry-After, существующие сессии идут раньше проверки.
- TCP/Unix: HealthChecker в StreamTransportAdapter, отказ в handleConnection до McpServer.
- `tests/transport-drain.test.ts` 2/2; мутация HTTP-гейта RED.
- Ограничения: без long-lived SSE e2e; TCP-ветка unit-level; WS не гейтится.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1135-tr-38.md`.

### Сессия S-20261109-night (Z-03 — package browser)

- `packages_list`/`package_get`/`package_create`/`package_write_file`/`package_toggle_component`; roots DATA_DIR/skill-packages|plugins.
- `/packages`: TreeView файлов, редактор skill-файла, component toggle плагина; nav.
- `e2e/packages.spec.ts` 1/1; API reference 148, docs table rows.
- Ограничения: plugin-файлы read-only, ZIP import нет, лимит файла 256 KiB.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-2350-z-03.md`.

### Сессия S-20261109-night (TR-37 — bulk per-item)

- `runBulkResults`: missing/throw изолированы, batch продолжается.
- `knowledge_bulk_update` + archive/trash/restore, tasks archive/trash/restore — `failed`; tasks create оставлен атомарным (V-03).
- `tests/bulk-per-item.test.ts` 3/3; RED: missing id исчезал.
- Ограничения: failed = `{id,error}`, не полная обёртка; create атомарный (V-03).
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-2340-tr-37.md`.

### Сессия S-20261109-night (TR-33 — fetch timeouts)

- `fetch-timeout.ts`: `connectorSignal`, 10s default, `CONNECTOR_TIMEOUT_MS`.
- github/jira/slack + gdrive/gmail/onedrive/notion/linear передают signal.
- `tests/connector-timeouts.test.ts` 2/2, new-connectors 21/21; мутация github RED.
- Ограничения: один deadline, env без кеша, без connect/read разделения.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-2300-tr-33.md`.

### Сессия S-20261109-night (Z-11 — агенты в промптах)

- `PromptDraft.target`, серверный фильтр `prompts_list.target`, бейджи и селекты target.
- `api.agents` + `/projects/settings/agents`: built-in/custom, Save registry, nav.
- `e2e/prompt-agent-target.spec.ts` 1/1; prompt-edit/design guards 17/17.
- Ограничения: built-in не удаляются, moveTo/moves нет, registry — отдельная страница.
- Z-03 не начат: Z-01/02 не подключены к MCP read/write пакетов.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-2200-z-11.md`.

### Сессия S-20261109-night (UI-17 — Overview внимания)

- `OverviewAttention`: blocked/claimed/stale/activity, пустые состояния; сетка NAV_SECTIONS удалена.
- `dashboard_stats`/`dashboard_activity` переведены на `storageProfile(ctx)`; SQLite больше не отдаёт нули.
- `e2e/overview-attention.spec.ts` 1/1; RED до фикса профиля (0 documents / no activity).
- Ограничение: виджет сроков не сделан — deadline нет (TK-01); activity 8 записей, stale 90 дней.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-2100-ui-17.md`.

### Сессия S-20261109-night (UI-31 — блокировки и влияние)

- Задача: `Influence` — транзитивные блокеры/затронутые по `tasks_dag`, fallback `tasks_get_deps`; critical path/onCriticalPath.
- Документ: `Dependent documents` через `knowledge_list.parentId` (ленивый уровень).
- e2e A→B→C: B показывает A и C; документ-родитель показывает ребёнка. RED до fallback.
- Ограничения: DAG-страница усечена, SQLite без рёбер, документы — один уровень.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-2000-ui-31.md`.

### Сессия S-20261109-night (hotfix — ленивое дерево и логин в новой вкладке)

- `knowledge_list.rootsOnly` в file/sqlite/postgres; UI грузит корни и детей при раскрытии, `TreeView` onExpand/hasChildren/loadingIds.
- `prepareCrossTabAuth`: одноразовый `mcp.auth.handoff` с TTL 60s; новая вкладка потребляет в sessionStorage.
- e2e knowledge-tree 2/2 (ленивые запросы + логин в новой вкладке); api-client 23/23; регрессии 3/3.
- Ограничения: все корни постранично, шеврон у листьев, TTL при заблокированном popup.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1900-tree-lazy-login-handoff.md`.

### Сессия S-20261109-night (UI-30 — карточка узла)

- `NodePanel`: Related work через `search_tasks`/`search_knowledge` (8+8), ссылки на задачи/документы.
- `/graph?entity=`: точный label или самый длинный входящий; `/knowledge?doc=`; Open in graph из задачи и документа.
- `e2e/entity-card.spec.ts` 1/1; регрессии quick-view/task-tree/knowledge-tree; мутация substring RED.
- Ограничения: BM25-связи, 8 результатов, только entity, неоднозначный title, текущий проект.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1800-ui-30.md`.

### Сессия S-20261109-night (UI-25 — деревья)

- `components/ui/TreeView.tsx`, `lib/tree.ts`: role tree/group, aria-expanded, вложенные группы; тест 3/3.
- Tasks list: `tasks_get_children` по раскрытию, прогресс done/total, Add subtask, Parent select в создании.
- Knowledge: List/Tree через `knowledge_tree`, parent select/bulkUpdate, breadcrumbs, путь на карточках.
- e2e task-tree 1/1, knowledge-tree 1/1; мутация aria-expanded RED. Ограничения: page-limited дети, parent options loaded, tree читает все доки.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1700-ui-25.md`.

### Сессия S-20261109-night (related tasks in preview)

- `TaskQuickView`: Depends on/Blocks/Subtasks → `onOpenRelated(id)`, без `Link`.
- `TasksPage.openRelatedTask`: `tasks_get` + замена `viewTask`; при смене id сбрасываются details/children/deps.
- `task-quick-view.spec.ts`: подзадача внутри диалога, URL остаётся `/tasks`, заголовок меняется; 1/1 на SQLite.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1600-related-preview-links.md`.

### Сессия S-20261109-night (SC-04 — серверная пагинация)

- `tasks_list`: `groupByStatus`/`offsets`, точные `total`/`typeCounts`; доска делает один вызов + Load more.
- `knowledge_list`: `api.knowledge.page` 60, серверные tag/type, Load more; поиск серверный.
- `ui-bench.mjs`: MutationObserver как `domSettledMs`, `pollSettledMs` сохранён; детектор `/mcp`.
- 10k: tasks 346 351→4 738 DOM, 1 308 ms; knowledge 85 869→838, 696 ms; tests-board 1/1, e2e 4/4 на 10k.
- Ограничения: bounded pagination, не windowing; общий Load more; facet/поиск capped.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1500-sc-04.md`.

### Сессия S-20261109-night (task name → full editor in new tab)

- Удалены `editingTask`, `saveEdit` и inline-панель из `app/tasks/page.tsx`.
- `openTaskEditor`: `window.open('/tasks/<id>', '_blank', 'noopener,noreferrer')` для доски, списка и quick view Edit.
- Тесты: quick-view 1/1, list-row 1/1 на SQLite; свободная область по-прежнему открывает превью.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1400-task-open-editor-new-tab.md`.

### Сессия S-20261109-night (task UX hotfix)

- `TaskCard`/list row: имя → inline editor, свободная область → preview; article focusable.
- `tasks_get_deps`: `storageProfile(ctx).tasks`; quick view getDeps не фатален.
- Description: Markdown Edit/Preview; quick view рендерит Markdown через `lib/markdown`.
- Проверено: quick-view 1/1, list-row 1/1 на SQLite-демо; Markdown-preview в task-detail; tsc. SQLite transition/claim gap остаётся.
- Решение/откат: `docs/dev-cycle/decisions/2026-11-11-1200-task-ux-hotfix.md`.

### Сессия S-20261109-night (UI-39 — graph metrics)

- `src/register/graph-metrics.ts`: transitive `dependentsCount` + `onCriticalPath`; флаг `includeGraphMetrics` в list/get.
- UI: `TaskCard`/`TaskQuickView`/page — метки «Critical path»/«Blocks N», тон N≥3, приоритет отдельно.
- Тест `tests/task-critical-path.test.ts` 1/1 + component 27/27; 2 мутации RED. Ограничения: SQLite dependsOn/DAG gap; O(graph) при включённом флаге.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-11-1100-ui-39.md`.

### Сессия S-20261109-night (UI-38 — зависимости и DAG)

- `app/tasks/[id]`: статусы блокеров/зависимых, `isBlocked`, root chain, Add/Remove, `DEPENDENCY_CYCLE`.
- `TaskQuickView`: те же статусы/isBlocked/цепочка.
- `app/tasks/dag`: tag/limit/onlyWithDeps → `tasks_dag`; кнопка над доской ведёт туда.
- `src/storage/tasks.ts`: `WorkflowError('DEPENDENCY_CYCLE')` (аддитивный код ошибки).
- `e2e/task-dependencies.spec.ts`: 1/1; full 48/48; 2 мутации RED. Ограничения: SQLite не хранит dependsOn/DAG; page-limited.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-11-1000-ui-38.md`.

### Сессия S-20261109-night (UI-36 — быстрый просмотр)

- `components/board/TaskQuickView.tsx`: read-only Dialog, полное описание, тип/приоритет/теги/ссылки, deps/blocks/subtasks, claim, timestamps; ноль контролов.
- `TaskCard/StatusCell/tasks page`: `onView`; заголовок и свободная область карточки; Edit → `/tasks/<id>`.
- `e2e/task-quick-view.spec.ts`: 1/1; 2 мутации RED (onClick→onEdit, лишний input). Скриншоты `docs/ui/screens/ui-36`.
- Ограничения: SQLite не реализует claim и отдаёт 0 DAG-рёбер (file/CI зелёный); history вне wire; глубокая цепочка UI-38/39.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-11-0900-ui-36.md`.

### Сессия S-20261109-night (UI-37 — полная страница задачи)

- `app/tasks/[id]/page.tsx`: прямой URL/reload, правка полей, V-02 ошибка с кодом/hint, claim/renew/release, destructive Dialog archive/trash, 404.
- `api-client`: claim/renew/release, bulkArchive/Trash/Restore, getChildren `{parent,children}`, ToolCallError.allowed.
- `e2e/task-detail.spec.ts`: 3/3; full 46/46; 2 мутации RED (notFound off, trash dialog off). Скриншоты `docs/ui/screens/ui-37`.
- Ограничения: task history вне wire; SQLite-профиль не читает transition-граф в loadProjectWorkflow (pre-existing; file/CI зелёный); DAG ≤200.
- Tracking fix: UI-11b/UI-12b → done (были влиты #374/#373).
- Решение и откат: `docs/dev-cycle/decisions/2026-11-11-0800-ui-37.md`.

### Сессия S-20261109-night (UI-16 — список и bulk close)

- `app/tasks/page.tsx`: Board/List (`mcp.tasksView`), таблица с сортировкой/выбором, `tasks_bulk_close`.
- `web-ui/lib/api-client.ts`: `tasks.bulkClose`.
- `e2e/tasks-list.spec.ts`: персист вида + priority sort; 3 задачи закрыты, reload подтверждает. 2/2, full 43/43.
- Мутации RED: без localStorage; обратный PRIORITY_RANK.
- Ограничения: чипы TK-01/TK-02 и агентские действия U-01/U-03 не делались; сортировка клиентская.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-11-0700-ui-16.md`.

### Сессия S-20261109-night (UI-11b — Playwright-контракт; UI-11 закрыт)

- `web-ui/e2e/page-contract.spec.ts`: 12 маршрутов (один h1, активный nav, screenshot заголовка), skip-link → main, Overview из меню.
- `snapshotPathTemplate` без платформенного суффикса, 12 PNG в `e2e/__screenshots__`, допуск 0.15.
- Проверено: 14/14, full Playwright 41/41; baseline переснят и сравнён; Linux — CI.
- Ограничения: сравнивается только заголовок; Linux-допуск может потребовать калибровки.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-11-0600-ui-11b.md`.

### Сессия S-20261109-night (UI-12b — offline/empty и next)

- `AppShell`: `GateState` + `error`, «Server unavailable» + Retry, children скрыты; guard на `AUTH_EXPIRED_EVENT` сохраняет `next`.
- `web-ui/e2e/states.spec.ts`: 11 abort-маршрутов + expired JWT → логин → `/tasks`; full suite 27/27.
- Проверено: 12/12 states; revert-check итераций (без error 11 fail, без guard next терялся); tsc чистый.
- Ограничения: shell-level контракт; page-specific empty/error после ready не аудированы; abort-паттерн зависит от API URL.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-11-0500-ui-12b.md`.

### Сессия S-20261109-night (UI-15 — доступность)

- `web-ui/playwright.config.ts` + `e2e/accessibility.spec.ts`: login, axe 12 routes, Tab /knowledge /tasks /graph; `test:e2e`.
- `/system`: scroll-регион списка инструментов получил `role="region"`, `aria-label`, `tabIndex={0}`.
- Проверено: 15/15 Playwright, 24/24 unit (contrast/guards/page/states); 2 мутации RED (tabIndex, lang); CI web-ui шаг добавлен.
- Ограничения: axe ≠ ручная WCAG-сертификация; CI полагается на Chrome runner'а; e2e требует MCP login.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-11-0400-ui-15.md`.

### Сессия S-20261109-night (Z-12 — деплой по агентам)

- `src/skills/agent-deploy.ts`: built-in roots universal/claude/opencode, preview (no writes), apply (confirm+token+snapshot), rollback; symlink lstat+realpath, external/delete gates.
- `src/register/agent-deploy.ts`: `agents_deploy` (dry-run, elicitation, admin-only apply) и `agents_deploy_rollback`; api-reference 143, tools.md 141/143/145.
- Проверено: 6/6 agent-deploy, 3 мутации RED; build/tsc/docs-coverage чистые.
- Ограничения: веб-админки нет; custom deploy roots не реализованы; конвертации форматов нет (вопрос открыт).
- Решение и откат: `docs/dev-cycle/decisions/2026-11-11-0300-z-12.md`.

### Сессия S-20261109-night (Z-04 — безопасность пакетов)

- `src/skills/plugin-security.ts`: `inspectPluginSecurity` (external/disabled, hooks/mcp/executables/network/license), `activatePluginPackage` с именованными allow-флагами.
- `PluginManifest.license`; экспорт из `src/skills/index.ts`; UI/MCP-инструменты не добавлялись.
- Проверено: 5/5 plugin-security, 3 мутации RED; build/tsc чистые.
- Ограничения: политика/API, не sandbox; эвристика сети по тексту ≤256 KiB; UI — Z-03.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-11-0200-z-04.md`.

### Сессия S-20261109-night (Z-02 — плагин-контейнер)

- `src/skills/plugin-container.ts`: манифест, проверка компонентов по каталогам, undeclared → `other`, лимиты/пути Z-01.
- `exportPluginPackage`: staging→dest, sha256+count сверка, отказ перезаписи; бинарные байты.
- Проверено: 5/5 plugin-container, 3 мутации RED; build/tsc чистые.
- Ограничения: directory→directory, ZIP/UI/MCP-инструменты — Z-03/транспорт; манифест обязателен.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-11-0100-z-02.md`.

### Сессия S-20261109-night (Z-10 — target и реестр агентов)

- `src/agents.ts`: built-ins universal/claude/opencode, нормализация, реестр в .project.json, moveTo/moves с перезаписью prompt metadata, `AGENT_TARGET_IN_USE`.
- `prompts_list`/`prompts_search`: скалярный `target`, universal виден всем; list объединяет каталог и исходники.
- `Skill.target` + frontmatter; `schemas/prompt.schema.json`; `docs/api-reference.md` 141, tools.md 139/141/143.
- Проверено: 5/5 prompt-targets, 3 мутации RED; build/tsc/docs-coverage чистые.
- Ограничения: move скиллов и UI — Z-12/дальше; list читает исходники (доп. get).
- Решение и откат: `docs/dev-cycle/decisions/2026-11-11-0000-z-10.md`.

### Сессия S-20261109-night (UI-12a — route states)

- `app/loading.tsx` — SkeletonCard ×3, без «Loading...»; `app/not-found.tsx` — «Page not found» и ссылка на `/`.
- `AppShell` → `/login?next=…&expired=1`; `/login` — `role="status"` баннер «Session expired».
- Проверено: 5/5 states-contract, 22/22 с page-contract/guards; 3 мутации RED (нет expired, баннер off, Loading...); tsc чистый.
- Не сделано: error > empty, «Сервер недоступен» + retry на 11 маршрутах, Playwright abort — UI-12b; UI-12 pending.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-2300-ui-12a.md`.

### Сессия S-20261109-night (UI-11a — контракт страницы)

- `PageHeader` → `h1`; `Topbar` без `h1`; знания/промпты внутренние `h1` → `h2`; allowlist очищен.
- `AppShell`: skip-link + `main#main-content tabIndex=-1`; `nav-config`: Overview и `shortLabel`.
- Проверено: 5/5 page-contract, 12/12 с guards; 3 мутации RED (PageHeader h2, Overview убран, skip #missing); tsc чистый.
- Не сделано: Playwright 12 маршрутов и скриншот-сравнение — UI-11b; UI-11 pending.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-2200-ui-11a.md`.

### Сессия S-20261109-night (T-01c — web-админка; T-01 закрыт)

- `web-ui/lib/api-client.ts`: AdminUser/AdminToken + методы users/tokens поверх `callTool`.
- `web-ui/app/access/page.tsx`: Users (list/create/disable/password/roles) + Personal tokens (list/create/revoke, expiry, raw один раз); только примитивы UI.
- Проверено: web tsc чистый; design guards + no-hardcoded + api-client 33/33; design-doc локально не парсится (не связано) — CI гейт.
- Ограничения: браузерного e2e нет; роли free-form; expiry — локальный datetime-local.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-2100-t01c.md`.

### Сессия S-20261109-night (T-01b — админ-MCP и TokenValidator)

- `src/register/users.ts`: list/create users, password, roles, disable, list/create/revoke tokens; admin role на authenticated-транспортах, local stdio доверенный; raw-токен один раз.
- `src/auth/user-token-validator.ts`: personal-first + fallback; `AppContainer` оборачивает JWT/static/TokenManager.
- Проверено: 5/5, 3 мутации RED (admin-check off, fallback skipped, token not returned); build/tsc чистые.
- Не сделано: web-админка — T-01c; T-01 pending.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-2000-t01b.md`.

### Сессия S-20261109-night (T-01a — UserStore, scrypt, личные токены)

- `src/auth/user-store.ts`: интерфейс+SQLite, scrypt N=16384/r8/p1, dummy-хеш для неизвестного, роли/disabled, смена пароля отзывает токены, токены только sha256+prefix, revoke/expiry, `ensureBootstrapAdmin`.
- `login-route`: `userStore` primary + env fallback; fail-closed env-only сохранён; HTTP-транспорт передаёт store; `setup` открывает `auth.db` только при JWT/LOGIN env.
- Проверено: 8/8 store, 11/11 login-route, 25/25 transport; 4 мутации RED (revoked/expired/disabled/plaintext).
- Не сделано: админ-MCP/UI и валидатор личных токенов в `AuthManager` — T-01b; T-01 pending.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-1900-t01a.md`.

### Сессия S-20261109-night (AA-05 — OpenCode suite в репозитории)

- Перенесены `session-draft.ts`, `scripts/collect-subagent-drafts.sh`, `commands/end-session.md` из `~/work/ci-agent`; семь memory-плагинов остаются каноном repo.
- `docs/plugins/opencode.md`: инвентаризация (size/date/sha256), таблица расхождений live/ci-agent/repo, причины и решения; README дополнен.
- Проверено: `git ls-files` содержит `session-draft.ts`; `diff` объяснён для всех; `bash -n` exit 0; 3/3 тестов, 2 мутации RED; markdownlint чист.
- Ограничения: живые копии не обновлялись; отдельного каталога `draft-consolidation` нет — консолидация в `end-session.md`; `loopx-goal.js` вне комплекта.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-1800-aa-05.md`.

### Сессия S-20261109-night (CM-03a — server instructions)

- `src/core/server-instructions.ts`: `toolDomains`/`buildServerInstructions`/`setServerInstructions`; домены и числа из живого реестра, ≤15 строк, протокол `tools_list search`→`tool_schema`→`tools_run`, `tools_batch`.
- Wiring: `defaultRegistration` (после регистрации), TCP/Unix и HTTP per-session из `serverCtx`, bridge — forwarding-текст.
- Проверено: 4/4, 3 мутации RED (домен выпадает, инструкция не выставляется, >15 строк); tsc/build чистые.
- Не сделано: живая проба Claude Code/OpenCode — CLI зависает без рабочей сессии; CM-03 pending, добавлен CM-03b.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-1700-cm-03a.md`.

### Сессия S-20261109-night (Z-01 — модель скилл-пакета)

- `src/skills/skill-package.ts`: read/write skill package, безопасные относительные пути (traversal/absolute/drive/ADS/Windows-reserved), symlink reject, лимиты 1 MiB/файл, 10 MiB/пакет, 200 файлов; sha256/детерминированный порядок; `SkillPackageStore` (staging+rename, list/read/remove, explicit overwrite).
- Проверено: 12/12, 5 мутаций RED (traversal, per-file и total лимиты, дубликаты, усечённый хэш); tsc/build чистые; wire-формат не менялся.
- Ограничение: модуль не подключён к SkillManager/MCP-инструментам; symlink-тест на Windows без привилегии пропускается.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-1600-z-01.md`.

### Сессия S-20261109-night (AA-01 — ADR общего ядра)

- `docs/adr/0010-agent-core-and-launch-modes.md`: режимы stdio/http/tcp/unix/bridge, время жизни, владение `DATA_DIR` (`.server.lock`, MU-01) как ownership, а не leader election; сигналы/graceful shutdown; Windows: сокеты нет, named pipe не реализован (записано).
- Проверено: 4 раздела `##` (DoD ≥4), markdownlint exit 0, ссылки на реальные тесты; кода не менялось.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-1500-aa-01.md`.

### Сессия S-20261109-night (CM-01 — контракт tools_run/tools_batch)

- `tests/tools-run-batch-contract.test.ts`: фейковый ServerContext, порядок = items, default продолжает после ошибки, `stopOnError` останавливает; batch — `Promise.all` (барьер, maxActive=2), порядок, `parallel:true`, без stop-флага, лимит 1..50.
- Проверено: 5/5, 3 мутации RED (stopOnError игнорируется, batch последовательный, stopOnError в схеме); кода не менялось.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-1400-cm-01.md`.

### Сессия S-20261109-night (DX-10 — setup-установщик)

- `src/cli/setup.ts`: детект Claude Desktop/Cursor/Windsurf/VS Code/Claude Code; merge в `mcpServers`/`servers` с сохранением чужих записей, бэкапом и атомарной записью; повторный запуск `unchanged`.
- Self-check: спавн stdio, `initialize`→`initialized`→`tools/list`, live 129 tools; probe в temp-DATA_DIR (нет .server.lock), корректное завершение по EOF; health-gate DX-11 в конце.
- `index.ts`: диспетчер `setup`; `health.ts`: динамический импорт config, чтобы setup работал без DATA_DIR.
- Проверено: 8/8 тестов, 4 мутации RED, live `✓ 129 tools` + `Health: ok`, повтор — unchanged; tsc/build чистые.
- Ограничение: self-check проверяет собранный dist, не npx-доставку; интерактив минимален.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-1300-dx-10.md`.

### Сессия S-20261109-night (DX-16 — закрытие umbrella)

- Umbrella DX-16 закрыт по evidence DX-16a/b: `admin_backup`/`admin_restore`, формат/манифест/sha256, dry-run/applyToken/lock/prune, CLI `backup|restore`.
- Нового кода нет; локально 31/50 DX-16 тестов зелёные, 19 красных на Windows (GNU tar `--transform`, symlink-привилегии) — записано как ограничение среды, решающий гейт — CI Linux.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-1200-dx-16-close.md`.

### Сессия S-20261109-night (DX-11 — runtime health-gate в doctor)

- `src/cli/health.ts`: `runHealthGate` с инъекцией версии/каталога/конфига/порта/путей клиентов; отсутствие клиентского конфига — warning, отсутствие файла конфигурации — штатные дефолты.
- `doctor`: секция `health` в JSON, строка `Health:` в тексте, issues с уровнями; живой смоук `doctor --data` даёт `Health: ok`.
- Проверено: 6/6 тестов, 3 мутации RED; build/tsc чистые.
- Ограничение: setup (DX-10) пока нет — гейт экспортирован, вызов в конце setup записан follow-up'ом.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-1130-dx-11.md`.

### Сессия S-20261109-night (TS-01 — потолок воркеров, флейки, RSS)

- `vitest.config.ts`: `resolveMaxWorkers` (env override / min(4, cores/2)); `package.json` и `.husky/pre-push` больше не передают `--maxWorkers`.
- `tests/vitest-limits.test.ts`: 5 тестов, включая запрет CLI-переопределений; 3 мутации RED.
- Флейки: pagination 20/20 (mtime-фикстура), auth-session 20/20 после build (dist-guard/stderr), executable-docs — Windows 20/20 red по среде; CI Linux зелёный.
- RSS без флагов: 1300/1677 МБ; полный Windows-прогон красный по платформенным классам (19 файлов), зелёные полные — CI bulk-smoke #350–#353.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-1100-ts-01.md`.

### Сессия S-20261109-night (Y-gate §5.6 + закрытие этапа Y)

- `src/cli/storage-profile-inspect.ts`: реальный профиль по `STORAGE_PROFILE` (file/sqlite/postgres), манифест/возможности, честные ошибки (нет БД/URL/неизвестный профиль).
- `doctor`: секция `storage` в JSON и тексте; предупреждение `storage-profile` при ошибке; exit-код не меняется.
- Документация: `configuration.md` (postgres/POSTGRES_URL), `architecture.md` (раздел профилей), CHANGELOG/AGENTS/BACKLOG; gate §5.1–§5.7 со evidence в решении.
- Проверено: 4/4 doctor-теста, 3 мутации RED; build/tsc/eslint/markdownlint/backlog зелёные.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-1000-y-gate-doctor-stage-close.md`.

### Сессия S-20261109-night (Y-gate §5.5 — benchmarks 100k)

- `scripts/profile-bench.mjs`: parent/child по профилям, 100k задач с уникальными токенами, 50 запросов, hit@1/median/p95/RSS; file-child поднимает metadata+FTS индексы как сервер.
- Факт: hit@1 1.0 везде; medianMs file 213.4, sqlite 0.25, postgres 727.8; RSS 355/265/99 MB; seed/index отдельно.
- Артефакты: `docs/benchmarks/profiles-100k.{json,md}` + README с методикой; медленные пути — записанный follow-up, не спрятаны.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-0915-y-gate-benchmarks.md`.

### Сессия S-20261109-night (Y-gate: §5.2 shared contract suite)

- `tests/storage-contract-shared.test.ts`: один runner × file/sqlite/postgres — манифест, задачи+paging, документы/версии/history, проекты/метаданные, locks, events (compact/snapshot); postgres по `POSTGRES_URL`, иначе документированный skip.
- Найдено расхождение: sqlite/postgres close возвращали `'done'`, файловый — `workflowFor(...).closeStatus` (`'closed'`); оба DB-профиля исправлены, postgres-тест обновлён.
- CI: файл добавлен в шаг «Storage contracts against real Postgres»; 18/18 на реальном PostgreSQL 18.6 + file/sqlite; 108/108 затронутых; 3 мутации RED.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-0810-y-gate-shared-contract.md`.

### Сессия S-20261109-night (Y-gate: §5.3 CI services)

- `bulk-smoke.yml`: service `postgres:16` + отдельный шаг контрактов; MinIO через `docker run bitnamilegacy/minio` (образы minio/minio удалены из Docker Hub, quay отдаёт 401) с healthcheck и blob-контрактом.
- Сервисный прогон поймал реальный баг: S3 `delete()` возвращал true для отсутствующего ключа (MinIO DELETE идемпотентен) — добавлен HEAD перед DELETE; blob-контракт на MinIO 25/25.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-0710-y-gate-ci-services.md`.

### Сессия S-20261109-night (Y-08b — миграция в/из Postgres, 100k)

- `migrate.ts`: направления file/sqlite ↔ postgres, `connectionString`, чтение JSONB-снимков, запись одним транзакционным upsert-батчем, `postgres-snapshot.json` как снимок отката; блобы сравниваются только при локальных корнях у обеих сторон.
- `scripts/migrate-bench.mjs`: 100k SQLite-фикстура + реальный `sqlite→postgres`; локальный PostgreSQL 18.6 — fixture 1.0 с, **pause window 42.9 с**, checksums equal; COPY/батчи — записанный follow-up.
- Runbook `docs/features/migrate-storage.md`: Postgres-направления, `POSTGRES_URL`, backup/rollback, caveats, бенчмарк.
- Проверено: `tests/storage-migrate.test.ts` 5/5 (Postgres-кейс skip без `POSTGRES_URL`), затронутые 90/90, tsc чистый.
- Gate этапа Y: §5.2/§5.3/§5.5 не выполнены — записано; следующий шаг — shared cross-profile contract suite и benchmarks, CI services по возможности scope.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-0600-y-08b.md`.

### Сессия S-20261109-night (Y-08a — migrate-storage file↔SQLite)

- `src/storage/migrate.ts`: фазы план → снимок цели (`.backups/migrate-*`) → дельта (`withFileLock`) → проверка (checksums по коллекциям+блобам, пост-состояние) → отчёт; `dryRun`/`verifyOnly` без записи.
- Идемпотентность по каноническому JSON (created/updated/skipped); перенос задач/документов/проектов/версий/блобов; нормализация тела документа и сохранение `history` в frontmatter для round-trip; события/замки и промпты/память — осознанно вне переноса (записано).
- CLI `scripts/migrate-storage.mjs`; runbook `docs/features/migrate-storage.md`.
- Проверено: `tests/storage-migrate.test.ts` 4/4 (dry-run, перенос+идемпотентность, update+verify-only порча, обратный перенос); затронутые `storage-sqlite`/`storage-contract`/`storage-wiring` — 71/71; tsc чистый; 5 мутаций RED.
- Ограничение: 100k пауза не замерена — перенесено в Y-08b; межпроцессный lock сервера — Y-08b.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-0510-y-08a.md`.

### Сессия S-20261109-night (Y-06b — Postgres VectorProvider; Y-06 закрыт)

- Схема v2: `vector_collections` (адрес/размерность/active), `vector_rows` (канонический JSONB-вектор), `vector_keys` (rowid ANN); проброс `pgvector/pgvectorVersion` из `db.ts` (`create extension vector` + `pg_extension`).
- `vector-store.ts`: HNSW через `vec_<sha1>` + `vector_cosine_ops`, кандидаты `<=>` и точный косинус по каноническим строкам; без расширения — brute-force по JSONB; `annAvailable/annVersion` честные; `CONFLICT` на размерность; delete/clear/stats/collections.
- Индексация: `PostgresProfileOptions.embeddingProvider/indexingManifestPath/externalPolicy` → `profile.indexing` на общем `IndexingService`; `setup` передаёт ту же фабрику провайдера.
- Проверено: `tests/storage-postgres.test.ts` 18/18 против реального PostgreSQL 18.6 (fallback, фильтры, размерность, индексация); затронутые 108/108; tsc чистый; 6 мутаций RED.
- Ограничения: pgvector/HNSW локально не проверен (нет расширения; CI-сервис без `workflow` scope) — записано; MU-02 вынесен отдельным пунктом, а не замаскирован.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-0440-y-06b.md`.

### Сессия S-20261109-night (Y-06a2 — Postgres SearchProvider; Y-06a закрыт)

- Контракт: необязательный `SearchProvider.candidatesAsync` (аддитивно); `register/search.ts` helper `candidateHits` предпочитает async-путь, файловый/SQLite — по-прежнему sync.
- Postgres: `search_index` с generated `tsvector`+GIN и `pg_trgm` fallback (`similarity > 0.15`), score `ts_rank + 0.5*similarity`; `search_state` и in-process `searchStates/taskCounts` для синхронных методов; `ensureIndexed` пересобирает проект, мутации обновляют индекс write-behind (ошибка → dirty, не валит запись); `fullText=true`.
- Проверено: `tests/storage-postgres.test.ts` 16/16 против реального PostgreSQL 18.6 (включая pg_trgm fallback `postgre→postgres`); затронутые `storage-postgres`/`storage-sqlite`/`storage-wiring`/`storage-contract`/`search-fts`/`search-tasks-warmup` — 126/126; tsc чистый; 6 мутаций RED.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-0420-y-06a2.md`.

### Сессия S-20261109-night (Y-06a1 — Postgres Store-коллекции)

- `db.ts`: пул + схема (JSONB задачи/доки, doc_versions, projects, events/snapshots, locks, search_index tsvector+GIN, search_state), pg_trgm при наличии прав; зависимости pg/@types/pg точными версиями.
- `index.ts`: `createPostgresProfile` — TaskStore/DocStore/ProjectStore/History/EventLog(write-behind с flush)/LockProvider(pg_advisory_xact_lock), prompts/memory/blobs — общие файловые реализации; search/vectors — честные заглушки (`fullText=false`, `vectors=false`).
- `profile-select`/`setup`: `STORAGE_PROFILE=postgres`, обязательный `POSTGRES_URL`, `CONFIG_MISMATCH` с подсказкой; файловый — по умолчанию.
- Проверено: `tests/storage-postgres.test.ts` 12/12 против реального PostgreSQL 18.6 (embedded-postgres в scratch, не зависимость проекта); затронутые `storage-sqlite`/`storage-wiring`/`storage-contract`/`blob-provider` — 97/97 (+1 skip); tsc чистый; 6 мутаций RED.
- Среда: CI-сервис Postgres добавить не удалось (нет scope `workflow`) — записано; проверка выполнена на настоящей СУБД локально.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-0340-y-06a1.md`; документация `docs/features/storage-profile-postgres.md`.

### Сессия S-20261109-night (Y-07b — S3/MinIO BlobProvider; Y-07 закрыт)

- `s3-blob-provider.ts`: собственный SigV4 (canonical request/string to sign/signing key/Authorization), fetch-транспорт, lazy `createBucket`, path-style MinIO, prefix, `x-amz-meta-sha256` как checksum, `list-type=2` + HEAD-метаданные, NOT_FOUND/idempotent delete, та же валидация ключей, `presign=false`; `s3BlobProviderConfigFromEnv()` для `BLOB_S3_*`.
- Тесты: общий `runBlobProviderContract` прогнан через fake S3 (протокол, SigV4-заголовки, bucket/prefix) и опционально через MinIO; локально MinIO-часть — задокументированный skip (Docker-демон недоступен).
- Среда: CI-сервис MinIO добавить не удалось (push workflow отклонён без scope `workflow`) — ограничение записано; MinIO-контракт запускается через `BLOB_S3_*` вручную/в инфраструктуре с workflow-scope, fake-S3 покрывает протокол локально.
- Документация `docs/features/blob-storage.md` (бэкенды, env, ручной MinIO-прогон).
- Проверено: 18 passed + 1 skip локально, 51/51 затронутых, tsc-test чистый; 6 мутаций RED (checksum, 404→пустые байты, delete отсутствующего, prefix в URL, bucket, валидация ключа).
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-0330-y-07b.md`.

### Сессия S-20261109-night (Y-07a — контракт BlobProvider и файловый провайдер)

- `contracts.ts`: `BlobProvider`/BlobMetadata/BlobPutOptions, `StorageProfile.blobs?`, коллекция `blobs`; отсутствующий ключ → `NOT_FOUND`, put/delete идемпотентны, checksum = sha256.
- `storage/blobs/file-blob-provider.ts`: root от вызывающего, валидация ключа (`[A-Za-z0-9._-]` по сегментам, без `..`/абсолютных путей), containment-проверка резолва, атомарная запись, скрытые метаданные, `list(prefix)`, `maxBytes`.
- Проводка: file-профиль (`DATA_DIR/blobs` или `blobsDir`), sqlite-профиль (`<db dir>/blobs`); манифесты обоих содержат `blobs`; обновлены ожидания в `storage-wiring`/`storage-contract`/`storage-sqlite`.
- `tests/blob-provider.test.ts`: экспортируемый `runBlobProviderContract` (для Y-07b) + 7 кейсов файлового провайдера + проводка в оба профиля; 8/8.
- Проверено: 75/75 затронутых, tsc-test чистый; 5 мутаций RED (пустые байты вместо NOT_FOUND, без валидации ключа, list без префикса, delete отсутствующего true, maxBytes игнорируется).
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-0300-y-07a.md`.

### Сессия S-20261109-night (Y-05c — диагностика, бенчмарк, закрытие Y-05)

- `diagnostics.ts`: `inspectSqliteStorage` (read-only снимок: schema/node/sqlite/fts5/vec, счётчики коллекций и FTS, состояние индекса, размер, предупреждения `sqlite-fts5-unavailable`/`sqlite-fts-dirty`/`sqlite-fts-drift`/`sqlite-vec-unavailable`) и `rebuildSqliteStorageIndexes` (FTS по всем проектам, снятие dirty, `wal_checkpoint(TRUNCATE)`, метрики до/после).
- `doctor` при `STORAGE_PROFILE=sqlite` добавляет секцию SQLite и issues из предупреждений; `reindex` обслуживает БД профиля (`--verify` → exit 1 при предупреждениях), печатает метрики/JSON.
- Бенчмарк `scripts/storage-bench.mjs` (`npm run bench:storage`): 10k — create 22 720/5 455 ms, list 687/30, page 230/22, get 64/3, update 223/92; 100k — create 231 267/99 747 ms, SQLite list 302 ms. До фикса 10k create sqlite = 35.9 с, 100k не завершался за бюджет.
- **O(n²) FTS:** удаление строк по UNINDEXED-колонкам сканировало весь индекс; добавлена карта `search_fts_keys(store,kind,project,id,rowid)` (schema v6), удаление по rowid, карта сопровождается при upsert/delete/удалении проекта.
- Документация профиля + строка `STORAGE_PROFILE` в configuration.md; Docker-гейт `sqlite-vec` не выполнен (демон недоступен) — записано как ограничение, не как проверка.
- Проверено: 7/7 диагностических тестов (40 с SQLite-сьютом), 72/72 затронутых, tsc-test чистый; 6 мутаций RED.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-0230-y-05c.md`.

### Сессия S-20261109-night (Y-05b2 — векторы на sqlite-vec и индексация; Y-05b закрыт)

- `vector-store.ts`: `vector_collections`/`vector_rows`/`vector_keys`; upsert помечает коллекцию активной, старые — read-only; смена размерности → `CONFLICT`; delete/clear/stats/collections по контракту.
- ANN через `sqlite-vec` на коллекцию (`vec0`): top-`max(limit*8,32)` кандидатов, затем точный косинус по каноническим векторам и фильтры project/kind/minScore; при недоступном расширении (нет пакета/ошибка/явный `vecAvailable:false`) — brute-force по `vector_rows`; `annAvailable()` честно сообщает путь, `capabilities.vectors=true`.
- `SqliteProfileOptions.embeddingProvider/indexingManifestPath/externalPolicy` создают `profile.indexing` поверх того же `IndexingService`: collect из SQLite-таблиц через общие `buildTextForTask/Doc`, `trustLevel` документа доходит до политики Y-04a, манифест в каталоге БД; `setup` делит одну фабрику провайдера между профилями.
- Проверено: 33/33 SQLite-тестов, 78/78 затронутых, tsc-test чистый; 6 мутаций RED (без сортировки, minScore, размерность, delete, фолбэк, документы в индексации).
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-0110-y-05b2.md`.

### Сессия S-20261109-night (Y-05b1 — FTS5 SearchProvider на SQLite)

- Таблица `search_fts` в той же БД: `unicode61`, id UNINDEXED, title+body из `buildTextForTask/Doc` (общий текст с BM25-путём); `search_index_state(project, complete, dirty)`.
- Живое сопровождение: create/update/restore/delete и lifecycle-переходы обновляют строки; ошибка записи не валит мутацию, а помечает проект dirty. `ensureIndexed` пересобирает проект и ставит complete; `isIndexComplete/fillState/available/dirty` честные.
- Кандидаты: `bm25(search_fts)` с фильтрами store/kind/project, положительный score; пользовательский запрос токенизируется и цитируется (синтаксис FTS5 из ввода не ломает поиск). `taskStoreId/docStoreId` — `sqlite:tasks`/`sqlite:docs`; `countTasks(project)` для AC-05.
- Манифест: `capabilities.fullText=true`; векторы/индексация — Y-05b2.
- Проверено: 28/28 SQLite-тестов, 62/62 затронутых, tsc-test чистый; 5 мутаций RED.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-0050-y-05b1.md`.

### Сессия S-20261109-night (правка DX-24 executable-docs)

- `tests/executable-docs.test.ts`: бюджет `execFile` для реального скана docs поднят с 60 с до 180 с, `beforeAll` — с 120 с до 240 с (именованные константы + комментарий). Причина падений: под 4 воркерами + coverage скан превышал 60 с, `execFile` убивал процесс и не отдавал exit code → `code=1`.
- Revert-check: test-only; решающая проверка — `bulk-smoke` на Linux CI (файл входит в известный Windows-baseline).
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-0030-fix-executable-docs-timeout.md`.

### Сессия S-20261109-night (Y-05a3 — события, замки, промпты/память; Y-05a закрыт)

- Таблицы `events`/`snapshots`: `EventLogStore` повторяет семантику файлового журнала (монотонный id на путь, снапшот последнего события, GC до последнего снапшота), счётчик id учитывает снапшоты — после компакции идентификаторы не переиспользуются.
- Таблица `locks`: `LockProvider` через условный UPSERT (свободен/истёк lease), ограниченное ожидание `lockTimeoutMs` (по умолчанию 10 с), освобождение в `finally`, таймаут → `CONFLICT`; сериализация конкурентных секций проверена, в т.ч. через второе соединение к той же БД.
- Промпты/память: экспортированы `FilePromptStore`/`FileMemoryStore` и подключены к SQLite-профилю — осознанно, с записанным ограничением (промпты файловые по wire-контракту, память принимает путь от вызывающего); нативный SQLite для них — отдельный ADR.
- Манифест: `[tasks,docs,projects,history,prompts,memory,events,locks]`; `search`/`vectors` — заглушки Y-05b.
- Проверено: 25/25 SQLite-тестов, 63/63 затронутых, tsc-test чистый; 5 мутаций RED.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-10-0010-y-05a3.md`.

### Сессия S-20261109-night (Y-05a2 — проекты и история на SQLite)

- `profiles/sqlite`: таблицы `projects` и `doc_versions`; `ProjectStore` (create/list/detail/updateMetadata/remove с force, workflow из метаданных через общие нормализаторы `src/workflow.ts`) и `HistoryProvider`/верversions документов; версия пишется на create и update, restore восстанавливает снапшот и фиксируется новой версией.
- Манифест: `collections: [tasks, docs, projects, history]`, `capabilities.history = true`; промпты/память/события/замки/поиск/векторы — по-прежнему `CAPABILITY_UNAVAILABLE`, вынесены в Y-05a3/Y-05b.
- `ProjectInfo.paths` в SQLite — пустые строки: путей нет физически, выдумывать их нельзя; удаление поля — отдельное изменение wire-контракта (ADR-009 цель).
- Проверено: 19/19 SQLite-тестов, 51/51 затронутых, tsc-test чистый; 6 мутаций RED.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-09-2345-y-05a2.md`.

### Сессия S-20261109-night (Y-05a1 — SQLite-профиль и гейт sqlite-vec)

- `src/storage/profiles/sqlite/{db,index,vec-gate}.ts`: SQLite-профиль (задачи/документы за контрактами, JSON-записи по `(project, id)`, пагинация с keys/cursor, жизненный цикл, дерево/cascade, персистентность); гейт лениво грузит `sqlite-vec` и честно возвращает `{node, sqlite, fts5, vec}`; заглушки нереализованных коллекций — `CAPABILITY_UNAVAILABLE`.
- `src/storage/profile-select.ts` + выбор профиля в `setup.ts`: `STORAGE_PROFILE=file|sqlite`, неизвестное значение — `CONFIG_MISMATCH`, путь БД передаёт точка сборки; файловый профиль по умолчанию и его wiring внешних эмбеддингов не менялись.
- `sqlite-vec@0.1.9` добавлен точной версией; замер гейта: Node v24.22.2, SQLite 3.53.2, FTS5 есть, sqlite-vec загружается и vec0-таблица ищет. Docker-проверка вынесена в Y-05c, а не выдана за сделанную.
- Guard allowlist: `setup.ts` — точка сборки, исключена по имени (ADR-009 rule 1); остальные регистраторы по-прежнему без storage-импортов.
- Проверено: 18/18 в двух новых файлах, 69/69 затронутых, tsc-test чистый; 6 мутаций RED (после усиления теста пагинации).
- Решение и откат: `docs/dev-cycle/decisions/2026-11-09-2135-y-05a1.md`.

### Сессия S-20261109-night (правка Q-006)

- `tests/search-perf.test.ts`: последовательные замеры малого и большого корпуса заменены на чередующиеся раунды (small → yield → large → yield, 5 раундов), сравнивается медиана отношений per-doc cost; порог 3x сохранён, поэтому квадратичный рост по-прежнему ловится.
- Причина: `bulk-smoke` падал на PR #328 и #333 с `0.083 < 0.068` при зелёном перезапуске — дрейф контеншена на CI, а не регресс.
- Revert-check: мутация «константное отношение 10» — RED; 3 локальных прогона `search-perf` — 7/7.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-09-2110-fix-q006-perf-noise.md`.

### Сессия S-20261109-night (ночная сессия — Y-04b, Y-04 закрыт)

- `src/search/external-http-provider.ts`: `POST {baseUrl}/embeddings` с Bearer-токеном, батчи по `maxTextsPerRequest`, таймаут через `AbortController`, ретраи на 429/5xx/сетевые ошибки с backoff, строгая проверка формы ответа (число векторов, конечные значения, неизменная размерность); ошибки бросаются — пустая выдача не подменяет деградацию.
- `src/search/external-provider.ts`: `createInner(secret)` — внутренний провайдер создаётся только после резолва секрета (и не создаётся при выключенном флаге); `inner` оставлен для тестов/локальных моков; fingerprint/isReady учитывают ленивое создание.
- `src/register/setup.ts`: при `EMBEDDINGS_EXTERNAL_ENABLED=1` профиль получает обёртку вокруг HTTP-провайдера (SecretManager + гейт Y-04a); неполная конфигурация → предупреждение и `undefined`; локальный путь по умолчанию не менялся.
- `src/search/external-policy.ts`: `externalEmbeddingConfigProblem()` — «включено, но не настроено» не превращается в молчаливый сбой.
- Проверено: 9/9 в `tests/embedding-external-http.test.ts` (локальный `node:http`, без внешней сети), 12/12 policy-регресс, 95/95 затронутых, tsc-test чистый; 6 мутаций RED (без Authorization, без ретраев, без таймаута, без батчей, конфиг без baseUrl, обёртка падает не PROVIDER_ERROR).
- Итог Y-04: a — политика внешних провайдеров (флаг, предупреждение, приватность, ключи, лимиты, стоимость, исключения); b — HTTP-провайдер за флагом. Y-04 закрыт 2026-11-09.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-09-2010-y-04b.md`.

### Сессия S-20261109-night (ночная сессия — Y-04a)

- `src/search/external-policy.ts`: конфигурация из env (ленивое чтение), `externalEmbeddingStartupWarning`, `externalEmbeddingPrivacyEntry` (строка для `docs/privacy.md` генерируется из кода), `createExternalEmbeddingGate` (проект + trustLevel), `ExternalEmbeddingError` с кодами DISABLED/MISSING_KEY/POLICY_DENIED/RATE_LIMITED/PROVIDER_ERROR.
- `src/search/external-provider.ts`: обёртка `EmbeddingProvider` — без флага `DISABLED` и нулевые внешние вызовы; ленивый ключ из `SecretManager` (только имя ключа в событиях); лимит текстов/минуту; учёт запросов/текстов/токенов/стоимости; `fingerprint().modelId = external:provider:model`; ошибка провайдера → `PROVIDER_ERROR` + событие деградации.
- Гейт встроен в `IndexingServiceOptions.externalPolicy`/`FileProfileOptions.externalPolicy` — заблокированные элементы не попадают в очередь (`blocked` в статусе), а не фильтруются после; в `setup` гейт строится из конфигурации, предупреждение логируется при старте; `embeddings_status` получил секцию `external`.
- `docs/privacy.md`: строка про external embeddings (триггер, адресат, данные, исключения), декларация не расходится с кодом.
- Проверено: 12/12 в `tests/embedding-external-policy.test.ts`, 108/108 затронутых, tsc-test чистый; 7 мутаций RED (включая утечку ключа в событие и политику без фильтра).
- Решение и откат: `docs/dev-cycle/decisions/2026-11-09-1945-y-04a.md`.

### Сессия S-20261109-night (ночная сессия — Y-03c, Y-03 закрыт)

- `src/search/indexing-service.ts`: очередь с батчами, манифест `(collection|identity) → sha1(collection|text)` на диске, ленивый провайдер (холодный старт не грузит модель и не блокирует), пауза/резюме без потери очереди, статус `state/total/done/queued/skipped/ratePerSec`, `drain()` для тестов и graceful shutdown.
- `StorageProfile.indexing` + `FileProfileOptions.embeddingProvider/indexingManifestPath`; `createServerContext` передаёт ленивую фабрику через `ensureVectorAdapter` → `createFileEmbeddingProvider`; `embeddings_status` отдаёт `indexing`.
- Идемпотентность учитывает коллекцию: смена модели/чанкинга/сборки текста — новая коллекция и переиндексация, повторный запуск в той же — ни одного эмбеддинга.
- Проверено: 11/11 в `tests/indexing-service.test.ts` (включая 10k в памяти, ~1 с); 133/133 затронутых; tsc-test чистый; 6 мутаций RED (хэш без текста, манифест не пропускает, пауза no-op, холодный старт блокирует, скорость 0, профиль без indexing).
- Ограничение среды записано: 10k — in-memory store, файловое хранилище на 10k JSON — замер для Y-05.
- Итог Y-03: a — контракты провайдера/хранилища/чанкинга и файловый провайдер; b — коллекции, отпечаток с вектором, двойное чтение без слияния; c — очередь индексации. Y-03 закрыт 2026-11-09.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-09-1925-y-03c.md`.

### Сессия S-20261109-night (ночная сессия — Y-03b)

- `src/search/contracts.ts`: `BUILD_TEXT_VERSION`, `collectionId()`, `VectorCollectionInfo`; `VectorRecord.collection` + `collectionMeta`; `VectorQueryOptions.collection`.
- `src/search/vector-store-file.ts`: `createFileVectorStore({root})` — upsert/delete/query/stats/clear/collections; каталог коллекции хешируется (id содержит недопустимые в Windows символы), настоящий id — в `collection.json`; brute-force cosine как простое решение для файлового профиля (ANN — Y-05/Y-06).
- `src/search/dual-read.ts`: активные хиты первыми, старая коллекция добирает только отсутствующие, без кросс-коллекционного сортирования и дублей; `coverage.activeCoversAll`.
- `StorageProfile.vectors` + `FileProfileOptions.vectorsDir` (по умолчанию `EMBEDDINGS_DIR`), `embedding_status` собирается `buildEmbeddingsStatus` и показывает `activeCollection`, `collections` с `active`/`readOnly`.
- Проверено: 11/11 в `tests/embedding-collections.test.ts`, 12/12 в `tests/embedding-contract.test.ts`, 132/132 затронутых, tsc-test чистый; 5 мутаций RED.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-09-1910-y-03b.md`.

### Сессия S-20261109-night (ночная сессия — Y-02e4, Y-02 закрыт)

- `SearchProvider` в `src/storage/contracts.ts`: available/dirty/isIndexComplete/fillState/ensureIndexed/candidates/taskStoreId/docStoreId/countTasks; `StorageProfile.search`.
- `FileSearchProvider` в файловом профиле делегирует `search/fts-indexer` (кандидаты, полнота, fill-состояние, store id) и `storage/metadata-index` (счётчик задач для AC-05); логика не переписана, ответы поиска не менялись.
- `register/search.ts` читает коллекции и индекс из `storageProfile(ctx)`; helper'ы получили `ctx`; **allowlist guard-теста пуст** — инварианта «регистраторы не импортируют хранилище» теперь проверяется жёстко.
- Проверено: guard 3/3, контракт 31/31, затронутые наборы 117/117; 4 мутации RED (прямой импорт, пустые кандидаты, всегда недоступный индекс, нулевой счётчик); build/tsc-test/eslint/markdownlint/backlog зелёные.
- Итог Y-02: a — контракты Store и файловый профиль; b — проект/журнал/история/замки; c — промпты; d — память; e1 — профиль в контексте + guard; e2 — задачи/знания/bulk/markdown; e3 — промпты/память/ресурсы/алиасы/helpers/mcp-prompts; e4 — поисковый индекс. Y-02 закрыт 2026-11-09.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-09-1855-y-02e4.md`.

### Сессия S-20261109-night (ночная сессия — Y-03a)

### Сессия S-20261109-night (ночная сессия — Y-03a)

- `src/search/contracts.ts`: отпечаток модели (`modelId` = basename:size, размерность, пулинг, query/doc-префиксы), `fingerprintKey()` — единый ключ коллекции для Y-03b/Y-05/Y-06; `EmbeddingProvider`, `ChunkingStrategy`, `VectorStore`, `IndexingService`, `EmbeddingError(CAPABILITY_UNAVAILABLE)`.
- `src/search/embeddings-file.ts`: файловый провайдер делегирует новому публичному `OnnxVectorAdapter.embed(texts, kind)` (query-кэш для запросов, embeddings-кэш по `cacheSalt|docPrefix+text` для документов — прогревает тот же кэш, что поиск); чанкинг делегирует `chunkText`/`buildChunksForDoc`, версия включает параметры окна.
- Адаптер расширен аддитивно (`isReady`/`fingerprint`/`embed`), `search`/`warmup` не тронуты; поведение сервера не менялось.
- Паритет с реальной ONNX-моделью не проверяется (модели нет в CI) — вместо этого честный `CAPABILITY_UNAVAILABLE` на незагруженном адаптере и fake-адаптер для делегирования; ограничение записано в решении.
- Проверено: 12/12 в `tests/embedding-contract.test.ts`; 4 мутации RED (усечённый `fingerprintKey`, пустой вектор вместо ошибки, версия чанкинга без опций, обратный порядок документов); связанные наборы зелёные (один известный флейк search-fts под параллелью, отдельно 36/36); tsc test-проекта чистый.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-09-1840-y-03a.md`.

### Сессия S-20261109-night (ночная сессия — Y-02e3)

- Переключены 6 регистраторов + `mcp-prompts.ts` (нашёлся транзитивно через реэкспорт helpers — пример того, что guard видит не всё); `PromptStore` (`catalog`/`buildItems`/`versions`/`get(...).path`) заменил файловый доступ к промптам, `register/helpers` больше не реэкспортирует его.
- `register/search.ts` осознанно оставлен последним прямым импортом: его зависимости — индексный слой (`search/fts-indexer`, `storage/metadata-index`), для них в ADR-009 предусмотрен `SearchProvider`, который появится в Y-03a. Заводить временную прокладку ради нулевого allowlist — хуже, чем один честный файл.
- Добавлен wiring-тест: перехват обработчиков `registerAliases(ctx)` и проверка `tasks://current` на задаче, созданной через профиль. Мутация «aliases читает доки» до него была зелёной — тест закрыл реальную дыру.
- Guard: 1 файл / 4 импорта (было 7/12); мутации «helpers снова импортирует prompts/files», «aliases читает доки» — RED. Известный пробел: fallback-путь `ContextAssembler.searchFn` в memory не покрыт тестом (записано в решении).
- Затронутые наборы: 43 + 84 + 33 теста зелёные; полный локальный прогон — упавшие 17 файлов идентичны базовой линии master (Windows-среда).
- Решение и откат: `docs/dev-cycle/decisions/2026-11-09-1825-y-02e3.md`.

### Сессия S-20261109-night (ночная сессия — Y-02e2)

- `src/core/storage-context.ts`: `storageProfile(ctx)` — единый аксессор профиля; для собранных руками тест-моков лениво прикрепляет файловый профиль (продакшн-контекст всегда с профилем — проверяет guard), чтобы 30+ тестов не переписывать.
- `src/storage/contracts.ts`: `TaskStore.closeWithCascade/subtree/children`, константы `DEFAULT_CLAIM_TTL_SEC`/`MIN_CLAIM_TTL_SEC`/`MAX_CLAIM_TTL_SEC`/`MAX_TASK_DEPTH`; `storage/tasks.ts` реэкспортирует значения — единственный источник истины теперь контракт.
- Файловый профиль реализует три операции делегированием; контрактные тесты: cascade с потомками и без, subtree/children-паритет с функциями хранилища (31/31).
- Переключены 4 регистратора (задачи, знания, bulk, markdown) — 60 замен в скрипте; поведение не менялось.
- Guard: 7 файлов / 12 импортов (было 11/20); мутации «новый прямой импорт», «не та коллекция», «TTL сломан», «cascade игнорируется» — RED.
- Полный локальный прогон: 277/295 зелёные; 17 упавших файлов идентичны базовой линии master (Windows-среда: openssl/tls, unix-сокеты, спавн, `C:\tmp`); CI — Linux-гейт.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-09-1815-y-02e2.md`.

### Сессия S-20261109-y02e1 (Y-02e1 — профиль хранилища в контексте)

- `src/register/setup.ts`: в `createServerContext()` создаётся `createFileProfile()` и кладётся в контекст; так же видят профиль `AppContainer.init()` (он вызывает эту фабрику) и тесты. `ServerContext.storage` — опциональное поле с комментарием, почему: 34 тест-мока собирают контекст руками, обязательное поле ломало бы их без пользы; наличие на реальном контексте проверяет guard-тест.
- `tests/storage-wiring.test.ts`: (а) профиль в контексте, манифест честный (`profile: 'file'`, 8 коллекций, возможности), roots = `resolveStoreId(TASKS_DIR|KNOWLEDGE_DIR)`, smoke-чтение через профиль; (б) allowlist прямых импортов data-access модулей в `src/register/**` — ровно 11 файлов / 20 импортов; `storage/contracts.js` не учитывается (типы контракта регистраторам нужны).
- Revert-check: 3 мутации RED — профиль не публикуется; манифест врёт о профиле; новый прямой импорт в регистраторе (guard реально ловит рост).
- Проверено: `npx vitest run tests/storage-wiring.test.ts --maxWorkers=2` — 2/2; build/type/lint/markdownlint/backlog — зелёные.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-09-1415-y-02e1.md`.

### Сессия S-20261109-yplan (план закрытия этапа Y)

- План этапа: `docs/dev-cycle/plans/2026-11-09-y-stage.md` — исходное состояние (Y-01/Y-09 done, Y-02 4/5 подпунктов), порядок Y-02e → Y-03 → Y-04 → Y-05 → Y-07 → Y-06 → Y-08 с обоснованием, 24 инкремента с DoD, 7 гейтов/рисков, условие закрытия этапа (7 пунктов), откат плана.
- Порядок выбран так: точка сборки раньше профилей; контракт и отпечаток эмбеддингов раньше VectorProvider профилей; SQLite раньше Postgres (дешёвая проверка контрактов); MinIO раньше Postgres (независимый сервис в CI); миграция последней (нужны два готовых профиля).
- Y-02e дробится на три инкремента с guard-тестом allowlist'а (11 файлов → 7 → 0) — механизм, который делает переезд регистраторов проверяемым, а не заявленным.
- BACKLOG: подпункты остатка Y записаны таблицами (Y-02e, Y-03…Y-08) вне счётчика «Итого»; статусы обновляются в PR каждого подпункта.
- Проверено: `npm run backlog:check`, `npm run lint:md` — зелёные; кода нет, поведение сервера не затрагивалось.

### Сессия S-20261109-y02d (Y-02d — память за контрактами)

- `MemoryStore` в `src/storage/contracts.ts`: фабрики `temporal`/`profiles`/`layered`/`session` (путь задаёт вызывающий — правило 1 ADR-009), плюс интерфейсы `TemporalMemoryStore`, `ProfileMemoryStore`, `LayeredMemoryStore`, `SessionMemoryStore` с операциями хранилища, а не полным списком методов классов. Методы синхронные: файловая реализация синхронна, `better-sqlite3` тоже — async-вариант останется решением профиля Y-05.
- Файловый профиль (`FileMemoryStore`) создаёт существующие классы памяти; TypeScript проверяет структурную совместимость, поэтому будущая SQLite-реализация проходит те же интерфейсы без обёрток.
- Тесты проверяют **персистентность**: после операций через профиль второй экземпляр класса на том же пути читает то же состояние (temporal, profiles, layered, session). Мутации «пишем в другой файл» и «игнорируем `filePath`» — RED.
- Проверено: `npx vitest run tests/storage-contract.test.ts --maxWorkers=2` — 28/28 (4 новых); revert-check 3 мутации RED; build/type/lint/markdownlint/backlog — зелёные.
- Решение и откат: `docs/dev-cycle/decisions/2026-11-09-1325-y-02d.md`.

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
