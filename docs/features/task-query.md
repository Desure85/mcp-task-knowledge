# Task query language (TK-02)

`tasks_query` принимает строку:

```
project: mcp #bug status: Doing assignee: me "два слова"
project: mcp AND (type: bug OR priority: high) sort by: priority
```

## Поля

`project`, `assignee`, `status`, `type`, `priority`, `tag`, `text`, `id`.
`#tag` — сокращение для `tag: <tag>`. Голое слово ищется в title/description/tags.
Значения с пробелами — в кавычках; `\"` экранирует кавычку.

## Операторы

- пробел / несколько термов — неявный **AND**;
- `OR` (регистр не важен) — **OR**;
- `-term` или `NOT term` — отрицание;
- `( ... )` — группировка.

## Сортировка

`sort by: updated|created|priority|title`; по умолчанию `updated` (desc).
`priority` — high → medium → low; `title` — A→Z; `created`/`updated` — новые сначала.

## Ошибки

- `QUERY_SYNTAX` — незакрытая кавычка/скобка, лишний токен, неизвестный sort;
- `QUERY_UNKNOWN_FIELD` — поле вне списка.

## Сохранённые поиски

- `tasks_saved_search_list`
- `tasks_saved_search_save` (`name`, `query`, `project?`) — upsert по имени
- `tasks_saved_search_delete`

Хранятся в `DATA_DIR/saved-searches.json`.

## Ограничения

`assignee` фильтрует по `Task.assignee`; задачи без поля не совпадают. TK-01-поля (`fields`, `dueDate`)
появятся в запросах после реализации TK-01 в storage.
