# Contributing to mcp-task-knowledge

Спасибо за интерес к проекту! Ниже — как устроен процесс разработки.

## Стек

TypeScript (strict), Node.js 20, ESM, Vitest, Zod. Данные — Markdown/JSON файлы.

## Начало работы

```bash
npm install
npm run build
npm test
```

Тесты: `npm test` (vitest), type-check тестов: `npm run test:types`,
покрытие: `npm run test:coverage` (порог 80% на src/).

## Процесс

1. **Feature-ветка от master**: `git checkout -b feat/<description>`
2. **WIP-коммит** перед началом работы: `git wip "BACKLOG-XXX — начал"` (TD-014)
3. **Session ID** в каждом коммите: `[S-<id>]` (например `S-20260829-a1b2`)
4. **Трёхфазный цикл**: research → plan → implement (каждый этап — коммит)
5. **Проверки перед PR**:
   - `npm run test:types` — type-check всех тестов
   - `npm test` — полный набор
   - `npm run test:coverage` — порог 80%
   - `npm run lint` — ESLint (0 errors)
6. **PR в master** — описание: что, почему, что не сделано, ссылка на BACKLOG

## Стандарты кода

- JSDoc только для «why», не «what»
- Типы через `interface`/`type`, без `any` без крайней необходимости
- Валидация входов — zod
- Ответы инструментов — `ok()`/`err()` из `src/utils/respond.ts`
- Новый код должен давать 0 ESLint warnings

## Структура

```
src/
  core/       # AppContainer, ToolExecutor, middleware, session, auth
  register/   # регистрация MCP-инструментов
  storage/    # tasks/knowledge (файловые)
  search/     # BM25 + vector (ONNX)
  rules/      # guard rules
  workflows/  # AI workflow execution
  skills/     # agent skills
  behavioral/ # memory: intents/failures/resolutions
  relay/      # LAN Relay (BM-012)
  proxy/      # thin proxy
docs/
  architecture.md  # Mermaid-диаграммы
  adr/             # Architecture Decision Records
  api-reference.md # автогенерируемый справочник (npm run api:reference)
```

## BACKLOG

Единственный источник правды по задачам: `BACKLOG.md`. Сводка «Итого»
внизу валидируется в CI (`npm run backlog:check`) — обновляйте её при
изменении статусов задач.
