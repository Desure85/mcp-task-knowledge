# AGENTS.md — Инструкция для AI-агента

> **Назначение:** Единый источник контекста для AI-агента, работающего над проектом `mcp-task-knowledge`.
> Агент **обязан** читать этот файл в начале каждой сессии и обновлять после каждого этапа работы.
> Файлы AGENTS.md, BACKLOG.md и ROADMAP.md составляют **трекинг-тройку** — синхронное состояние проекта.

---

## 0. Песочница (КРИТИЧЕСКИ ВАЖНО)

### Проблема

Песочница (sandbox), где выполняется агент, **может в любой момент откатиться** на состояние,
которое было несколько сессий назад. Файлы в локальном репозитории окажутся **устаревшими** —
без последних коммитов, без новых веток, без последних изменений.

**Последствия незнания:** агент пишет код поверх старой версии, затирает чужие коммиты,
создаёт конфликты, тратит время впустую.

### Обязательный чек-лист при старте КАЖДОЙ сессии

Выполнять **до любого чтения/записи файлов проекта**:

```bash
# 1. Перейти в корень репозитория
cd /home/z/my-project/mcp-task-knowledge

# 2. Забрать актуальное состояние из origin
git fetch origin

# 3. Проверить, что локальная ветка не отстаёт
git status

# 4. Если «behind» — выровнять
git pull --ff-only

# 5. Если нужно переключиться на нужную ветку
git checkout <branch-name>
git pull --ff-only

# 6. Убедиться, что рабочее дерево чистое
git status  # должно быть «nothing to commit, working tree clean»
```

### Красные флаги

- `git status` показывает `Your branch is behind 'origin/...' by N commits` — **немедленно `git pull --ff-only`**.
- Файлы в проекте не содержат последних изменений, которые агент помнит из прошлой сессии — **песочница откатилась, синхронизируйся**.
- Локальных веток, которые агент создавал в прошлой сессии, нет — **`git fetch origin` и `git checkout <branch>`**.
- Если `git pull` даёт конфликты — **НЕ ПЫТАТЬСЯ разрешить вслепую**, спросить пользователя.

### Правило

> **НИКОГДА не пиши код, пока не убедился, что песочница синхронизирована с origin.**
> Это первая команда в каждой сессии, перед чтением файлов, перед анализом, перед всем.

---

## 1. Обзор проекта

**Название:** mcp-task-knowledge
**Версия:** 1.0.20
**Репозиторий:** <https://github.com/Desure85/mcp-task-knowledge>
**Основная ветка:** `master`
**Стек:** TypeScript, Node.js 20, MCP SDK (`@modelcontextprotocol/sdk`), Vitest, Zod, ONNX Runtime

Файловый MCP-сервер для таск-менеджмента, базы знаний и библиотеки промптов по проектам. Работает через stdio-транспорт, данные хранятся в Markdown/JSON-файлах (совместимо с Obsidian).

### Ключевые модули

| Модуль | Путь | Назначение |
|--------|------|------------|
| Точка входа | `src/index.ts` | MCP-сервер, регистрация инструментов и ресурсов |
| Конфигурация | `src/config.ts` | ENV/JSON конфигурация, флаги, каталог |
| Хранилище задач | `src/storage/tasks.ts` | CRUD JSON-задач по проектам |
| Хранилище знаний | `src/storage/knowledge.ts` | Markdown-документы с frontmatter |
| BM25 поиск | `src/search/bm25.ts` | Лексический поиск |
| Векторный поиск | `src/search/vector.ts` | ONNX-эмбеддинги (LaBSE/E5) |
| Поиск (обёртка) | `src/search/index.ts` | Гибридный поиск |
| Инструменты | `src/tools/*.ts` | MCP-инструменты (tasks, knowledge, search, prompts, catalog, other) |
| Obsidian экспорт | `src/obsidian/export.ts` | Экспорт в Obsidian Vault |
| Obsidian импорт | `src/obsidian/import.ts` | Импорт из Obsidian Vault |
| A/B тестирование | `src/ab-testing/*.ts` | Бандиты, хранилище метрик |
| Service Catalog | `src/catalog/provider.ts` | Провайдер каталога (embedded/remote/hybrid) |
| Prompts | `src/prompts/build.ts` | Сборка workflow-промптов |

### MCP-инструменты (основные)

- `tasks_*` — управление задачами (create, list, update, close, archive, trash, restore, delete, tree, bulk)
- `knowledge_*` — управление документами (create, get, list, update, tree, bulk, delete)
- `search_tasks`, `search_knowledge`, `mcp1_search_knowledge_two_stage` — поиск
- `prompts_*` — библиотека промптов (bulk_create/update/delete, list, search, build, A/B, feedback)
- `obsidian_export_project`, `obsidian_import_project` — интеграция с Obsidian
- `service_catalog_query/upsert/delete/health` — каталог сервисов
- `project_*` — управление проектами
- `tools_list`, `tool_schema`, `tool_help`, `tools_run` — интроспекция и пакетный запуск

### Структура данных

```
data/
  tasks/<project>/<uuid>.json       — задачи
  knowledge/<project>/<uuid>.md     — документы знаний
  prompts/<project>/                — промпты
    sources/                        — JSON-источники (rules, workflows, templates, policies)
    exports/                        — артефакты (catalog, builds, markdown)
```

---

## 2. Git-воркфлоу

### Ветки

- `master` — основная ветка, стабильное состояние. PR сливаются сюда.
- `staging` — промежуточная ветка для PR (если используется).
- `feat/<description>` — ветки функций.
- `review-*` — ветки ревью (автоматические).

### Правила работы

1. **Всегда** создавай feature-ветку от `master` для любой работы.
2. Коммит с понятным сообщением: `<type>: <description>` (feat, fix, refactor, docs, chore, test).
3. По готовности — push в origin и открой PR в `master`.
4. Дай ссылку на PR пользователю для ревью.

### Именование веток

- `feat/<feature-name>` — новая функциональность
- `fix/<bug-description>` — исправление бага
- `refactor/<module>` — рефакторинг
- `docs/<topic>` — документация

---

## 3. Протокол обновления трекинг-троек

После **каждого** завершённого этапа, подэтапа или исследовательской задачи агент **обязан** обновить:

### AGENTS.md

- Секцию «Текущее состояние сессии» (раздел 5).
- Секцию «Известные проблемы и технический долг» (раздел 7) — если найдены новые.
- Секцию «Ключевые решения» (раздел 8) — если принято архитектурное решение.

### BACKLOG.md

- Статус задач: `pending` → `in_progress` → `done` / `blocked`.
- Добавить новые задачи, обнаруженные в процессе работы.
- Обновить приоритеты, если изменилась оценка.

### ROADMAP.md

- Отметить завершённые подэтапы: `[ ]` → `[x]`.
- Обновить «Последнее обновление» датой текущей работы.
- Добавить заметки к этапам, если нужны уточнения.

---

## 4. Команды для разработки

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

## 5. Текущее состояние сессии

> Агент заполняет этот блок в начале и обновляет в конце каждой сессии.

**Дата последнего обновления:** 2026-04-04
**Текущая feature-ветка:** feat/agent-tracking-files
**Текущий этап ROADMAP:** Исследование рынка (pre-stage-0)
**Статус:** in_progress

### Последние действия

- Создана трекинг-тройка (AGENTS.md, BACKLOG.md, ROADMAP.md)
- Открыт PR #23: https://github.com/Desure85/mcp-task-knowledge/pull/23
- Проведено конкурентное исследование рынка MCP-серверов
- Задан вопрос о востребованности (исследование в процессе)

### Что дальше

- Завершить анализ востребованности и приоритизацию бэклога
- Сравнить найденное с ROADMAP
- Обновить BACKLOG.md с приоритетами на основе исследования
- Закоммитить результаты исследования и открыть PR

---

## 6. Стандарты кода

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
- Расположение: `tests/` и `src/__tests__/`.
- Запуск: `npm test`.
- Для интеграционных: `npm run e2e:cli`.

---

## 7. Известные проблемы и технический долг

> Агент обновляет при обнаружении новых проблем.

| ID | Описание | Приоритет | Статус |
|----|----------|-----------|--------|
| TD-001 | `src/index.ts` — монолитный файл (~2000+ строк), инструмент registration и resources в одном месте | high | pending |
| TD-002 | Тип `any` в нескольких местах (vectorAdapter, toolRegistry) | medium | pending |
| TD-003 | Legacy-поддержка путей знаний (`DATA_DIR/knowledge/<id>.md`) | low | pending |
| TD-004 | Отсутствие_rate-limit на уровне инструментов | medium | pending |
| TD-005 | Нет версионирования документов знаний | low | pending |

---

## 8. Ключевые решения

> Агент фиксирует важные архитектурные и технические решения.

| Дата | Решение | Контекст |
|------|---------|----------|
| 2026-04-04 | Создана трекинг-тройка (AGENTS.md, BACKLOG.md, ROADMAP.md) для персистентности между сессиями | Инициализация агент-ориентированного воркфлоу |
| 2026-04-04 | Песочница откатилась на 1 коммит (780ad35 vs 339ea21) — добавлен чек-лист синхронизации в AGENTS.md §0 | Обнаружено при повторном заходе в сессию |

---

## 9. Зависимости проекта

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

## 10. Дополнительная документация

| Файл | Содержание |
|------|------------|
| `README.md` | Описание MCP-сервера, установка, конфигурация, инструменты |
| `ROADMAP.md` | Дорожная карта развития (14 этапов, 0-13) |
| `BACKLOG.md` | Бэклог задач с приоритетами и статусами |
| `RESOURCES.md` | MCP Resources: URI, схемы, примеры |
| `prompt_rules.md` | Правила для LLM-агента (Cascade) |
| `prompt_flow_guide.md` | Флоу работы с MCP-инструментами |
| `schemas/*.json` | JSON-схемы для валидации |
