# ADR-2026-11-12: профили инструментов и серверная инструкция

- **Статус:** accepted (AA-08, design gate)
- **Контекст:** 206 MCP-инструментов; `instructions` у `McpServer` не задан; агент видит весь зоопарк
  и не понимает, с чего начать.

## 1. Проблема

Один плоский каталог из 206 tools:

- перегружает контекст и выбор модели;
- не объясняет порядок работы (сначала проект/задачи, потом знания/память);
- скрывает, какие домены выключены env-флагами;
- не даёт владельцу ограничить поверхность без пересборки.

## 2. Решение: три профиля

Профиль — **фильтр видимости** (`tools/list` + отклонение прямого вызова скрытого tool), не security boundary.
Выбирается `MCP_TOOL_PROFILE`:

| Профиль | Лимит | Для кого | Состав |
|---|---|---|---|
| `core` | ≤ 28 | повседневная работа с задачами/знаниями | tasks CRUD/дерево/DAG/поиск, knowledge CRUD/поиск, memory recall/remember, project_list, session_info, tools_help |
| `agent` (default в следующем major) | ≤ 60 | AI-агент с памятью/промптами | `core` + prompts/skills/rules/workflows, memory graph/profile/context, dashboard/briefing, changes_since, graph_neighbors, saved searches |
| `full` | 206 | администратор/отладка | всё, включая admin/audit/connectors/cluster/history/webhooks |

Правила отбора:

- всё, что нужно для цикла «прочитать → создать → обновить → закрыть → найти», входит в `core`;
- write-инструменты входят вместе с их read-парой;
- admin/audit/connectors/session_kill/cluster/history — только `full`;
- инструменты с env-флагом (коннекторы, history) не попадают в `core/agent` даже при включённом флаге;
- профиль не меняет wire-формат ответов, только видимость и `-32601` для скрытого вызова.

## 3. Текст серверной инструкции

Устанавливается в `McpServer({ instructions })` **до** connect; ≤ 4 КиБ, 12 строк:

```
mcp-task-knowledge: файловый трекер задач, знаний, промптов и памяти агента.

1. Начни с project_list; проект по умолчанию — CURRENT_PROJECT.
2. Задачи: tasks_list/tasks_query → tasks_get → tasks_create/tasks_update → tasks_close.
   Связи: tasks_dag/tasks_deps; подзадачи: tasks_tree/tasks_get_children.
3. Знания: knowledge_list/knowledge_search → knowledge_get → knowledge_create/knowledge_update.
   Wiki-ссылки: knowledge_wikilinks; обратные ссылки: knowledge_backlinks.
4. Память: memory_recall перед работой; memory_remember после значимого факта.
5. Промпты/скиллы: prompts_list, skills_list; не угадывай имена.
6. Если инструмент не виден — проверь MCP_TOOL_PROFILE; не вызывай скрытые tools напрямую.
7. Большие списки — limit/cursor; не запрашивай всё сразу.
8. Ошибки: смотри code/hint; CONFLICT означает конкурентную правку, перечитай сущность.
9. Все пути — внутри DATA_DIR; не предлагай обходить ACL проекта.
```

Инструкция не дублирует описания полей: они остаются в JSON Schema каждого tool.

## 4. Конфигурация

- `MCP_TOOL_PROFILE=core|agent|full` (default `full` до следующего major, затем `agent`).
- `MCP_SERVER_INSTRUCTIONS=auto|off|custom`; `custom` требует `MCP_SERVER_INSTRUCTIONS_TEXT` (≤4 КиБ).
- `off` — не отправлять instructions (совместимость со старыми клиентами).
- Неизвестный профиль → fallback `full` + WARN, сервер не падает.

## 5. Реализация (следующий инкремент AA-08b)

- После регистрации всех tools: `filterToolsByProfile(profile)` поверх `ToolRegistry`;
- allowlist-константы в `src/tools/profiles.ts` (списки имён, не префиксов — явно);
- `tools_list` учитывает профиль, `tools_call`/прямой вызов скрытого → `TOOL_NOT_FOUND`;
- `initialize.instructions` формируется один раз;
- тест: `core ≤ 28`, `agent ≤ 60`, каждый allowlist-имя существует, скрытый вызов отклонён.

## 6. Проверка и метрики

- CI-тест количества и существования имён;
- smoke: `initialize` отдаёт instructions, `tools/list` = профиль;
- метрика: доля успешных вызовов из `core` без переключения на `full` (после релиза).

## 7. Открытые вопросы

- Нужен ли `MCP_TOOL_PROFILE=readonly` (все read + поиск)? Пока нет.
- Инструкция на русском или английском? В MVP — английский текст (совместимость клиентов), локализация позже.
- Профиль не защищает от прямого `tools_call`, если клиент его игнорирует; это документируется.

## 8. Последствия

- Меньше контекста и неоднозначности для агента.
- Владелец может сузить поверхность без пересборки.
- Появляется обязанность поддерживать allowlist при добавлении tools (тест падает, если имя исчезло).
