# MCP Resources Documentation

В проект **mcp-task-knowledge** добавлена поддержка ресурсов (resources) в рамках протокола Model Context Protocol (MCP). Ресурсы позволяют предоставлять доступ к данным через стандартизированные URI.

## Доступные ресурсы

### 1. Ресурсы задач (Tasks)

- **Базовый URI**: `task://tasks`
- **Индивидуальные задачи**: `task://{project}/{task_id}`

**Описание**: Предоставляет доступ к задачам из всех проектов или к конкретной задаче по ID.

**Примеры использования**:

```
task://tasks                    # Список всех задач
task://mcp/task-123             # Конкретная задача с ID "task-123" в проекте "mcp"
task://my-project/urgent-fix    # Задача "urgent-fix" в проекте "my-project"
```

### 2. Ресурсы знаний (Knowledge)

- **Базовый URI**: `knowledge://docs`
- **Индивидуальные документы**: `knowledge://{project}/{doc_id}`

**Описание**: Предоставляет доступ к документам базы знаний из всех проектов или к конкретному документу по ID.

**Примеры использования**:

```
knowledge://docs                # Список всех документов знаний
knowledge://mcp/api-reference   # Документ "api-reference" в проекте "mcp"
knowledge://docs/user-guide     # Документ "user-guide" в проекте "docs"
```

### 3. Ресурсы промптов (Prompts)

- **Базовый URI**: `prompt://catalog`
- **Индивидуальные промпты**: `prompt://{project}/{prompt_id}@{version}`

**Описание**: Предоставляет доступ к каталогу промптов или к конкретному промпту по ID и версии.

**Примеры использования**:

```
prompt://catalog                           # Каталог всех промптов
prompt://mcp/code-review@v1.0             # Промпт "code-review" версии v1.0 в проекте "mcp"
prompt://templates/bug-report@latest      # Промпт "bug-report" последней версии
```

### 4. Ресурсы экспортов (Exports)

- **Базовый URI**: `export://files`
- **Индивидуальные файлы**: `export://{project}/{type}/{filename}`

**Описание**: Предоставляет доступ к экспортированным артефактам (builds, catalog, json, markdown).

**Примеры использования**:

```
export://files                              # Список всех экспортированных файлов
export://mcp/builds/workflow.json          # JSON-файл workflow в папке builds
export://templates/markdown/readme.md      # Markdown-файл readme
export://mcp/catalog/prompts.catalog.json  # Каталог промптов
```

### 5. Ресурсы инструментов (Tools)

- **Каталог инструментов**: `tool://catalog`
- **Схема (метаданные) инструмента**: `tool://schema/{name}` или `tool://{name}`

Важно: выполнение инструментов через ресурсы не поддерживается. Для «POST»-подобных операций используйте RPC-вызовы инструментов (tools.run). Для пакетного запуска доступен инструмент `tools_run`.

Примеры чтения ресурсов-интроспекции:

```
tool://catalog                # список всех tools с ключевыми полями
tool://schema/tasks_list      # метаданные и ключи параметров для инструмента tasks_list
tool://tasks_list             # короткий алиас на схему
```

Пример пакетного запуска через инструмент `tools_run` (RPC):

```json
{
  "name": "tools_run",
  "arguments": {
    "items": [
      { "name": "tasks_list", "params": { "project": "mcp" } },
      { "name": "knowledge_list", "params": { "project": "mcp" } }
    ],
    "stopOnError": false
  }
}
```

### 6. Ресурсы проекта (Project)

- **Текущий проект**: `project://current`
- **Быстрое переключение проекта**: `project://use/{projectId}`
- **Список проектов**: `project://projects`

**Описание**:

- `project://current` возвращает текущий активный проект в виде `{ "project": "<id>" }`.
- `project://use/{projectId}` при чтении переключает текущий проект на `{projectId}` и возвращает `{ "project": "{projectId}" }`.

**Примеры использования**:

```
project://current           # например {"project":"mcp"}
project://use/neirogen      # переключает текущий проект на "neirogen"
project://current           # теперь {"project":"neirogen"}
```

> Примечание: переключение проекта выполняется через шаблонный ресурс `project://use/{projectId}` (ResourceTemplate). Отдельный ресурс `project://refresh` удалён и больше не требуется. Если вы добавили новый проект на диске и хотите, чтобы он участвовал в сканировании данных (задачи/знания/промпты), перезапустите сервер MCP.

### 7. Задачи: алиасы и фильтры (Tasks)

- **Текущий проект**:
  - `tasks://current` — список задач текущего проекта
  - `tasks://current/tree` — дерево задач текущего проекта

- **По проекту**:
  - `tasks://project/{id}` — список задач проекта
  - `tasks://project/{id}/tree` — дерево задач проекта
  - `tasks://project/{id}/status/{pending|in_progress|completed|closed}` — фильтр по статусу
  - `tasks://project/{id}/tag/{tag}` — фильтр по тегу

**Описание**: Удобные URI без JSON‑параметров, по умолчанию скрывают архив и корзину (`includeArchived=false`, `includeTrashed=false`).

**Примеры**:

```
tasks://project/mcp
tasks://project/neirogen
tasks://project/neirogen/tree
tasks://project/neirogen/status/in_progress
tasks://project/neirogen/tag/infra
tasks://current
tasks://current/tree
```

#### Переходы статусов одной задачи (без bulk)

- `task://action/{project}/{id}/start` → `status: in_progress`
- `task://action/{project}/{id}/complete` → `status: completed`
- `task://action/{project}/{id}/close` → `status: closed`
- `task://action/{project}/{id}/trash` → пометить как удалённую
- `task://action/{project}/{id}/restore` → восстановить из архива/корзины
- `task://action/{project}/{id}/archive` → пометить как архив

Ответ: `{ ok: true, project, id, action, data }` либо `{ ok: false, error }`.

### 8. Знания: алисы и фильтры (Knowledge)

- **Текущий проект**:
  - `knowledge://current` — список документов
  - `knowledge://current/tree` — простое дерево по первой метке (tag)

- **По проекту**:
  - `knowledge://project/{id}` — список документов
  - `knowledge://project/{id}/tree` — дерево по первой метке
  - `knowledge://project/{id}/tag/{tag}` — фильтр по тегу
  - `knowledge://project/{id}/type/{type}` — фильтр по типу (`note`, `spec`, ...)

### 9. Поиск (алиасы)

- `search://tasks/{project}/recent` — последние задачи (по updatedAt desc, top‑20) — реализовано как шаблон ресурса
- `search://tasks/{project}/{paramsB64}` — гибридный поиск по задачам (динамический роутер)
- `search://knowledge/{project}/recent` — последние документы (top‑20) — реализовано как шаблон ресурса
- `search://knowledge/{project}/{paramsB64}` — двухстадийный гибридный поиск по знаниям (динамический роутер)

Примеры recent:

```
search://tasks/neirogen/recent
search://knowledge/mcp/recent
```

Где `paramsB64` — base64url или URL‑encoded JSON, например:

```
{ "query": "health endpoint", "limit": 20 }
```

Пример кодирования в URL (base64url): `eyJxdWVyeSI6ImhlYWx0aCBlbmRwb2ludCIsImxpbWl0IjoyMH0`

## Формат ответов

Все ресурсы возвращают данные в формате JSON с следующей структурой:

```json
{
  "contents": [
    {
      "uri": "resource://uri",
      "text": "content as JSON string",
      "mimeType": "application/json"
    }
  ]
}
```

### Базовые ресурсы (списки)

Возвращают массив объектов с дополнительными метаданными:

```json
{
  "contents": [
    {
      "uri": "task://tasks",
      "text": "[{\"uri\": \"task://project/id\", \"name\": \"Task Name\", \"project\": \"project\", ...taskData}]",
      "mimeType": "application/json"
    }
  ]
}
```

### Индивидуальные ресурсы

Возвращают конкретный объект:

```json
{
  "contents": [
    {
      "uri": "task://project/id",
      "text": "{\"id\": \"task-id\", \"title\": \"Task Title\", \"status\": \"pending\", ...}",
      "mimeType": "application/json"
    }
  ]
}
```

## Обработка ошибок

При неправильном формате URI или отсутствии ресурса будет возвращена соответствующая ошибка:

- `Invalid {type} URI format. Expected: {expected_format}`
- `{Resource} not found: {id} in project {project}`
- `Failed to read export file: {error_message}`

## Типы MIME

- **JSON данные**: `application/json`
- **Markdown файлы**: `text/markdown`
- **Текстовые файлы**: `text/plain`

## Безопасность

- Все ресурсы работают только с не архивированными данными (includeArchived: false)
- При ошибках чтения проектов операция продолжается с оставшимися проектами
- Файлы экспорта читаются только из санкционированных директорий

## Интеграция с MCP клиентами

Сервер объявляет capabilities для ресурсов и инструментов:

```
{"resources": {"list": true, "read": true}, "tools": {"call": true}}
```

Эти ресурсы автоматически доступны всем MCP клиентам, подключенным к серверу. Клиенты могут:

1. Запросить список доступных ресурсов
2. Читать содержимое ресурсов по URI
3. Использовать ресурсы в контексте работы с LLM

Если ваш клиент временно не показывает панель ресурсов, откройте `resource://catalog` — это внутренний каталог, который вернет полный список зарегистрированных ресурсов (включая шаблоны) с возможностью фильтрации и сортировки (см. ниже).

## Примеры интеграции

### С MCP Inspector

```bash
# Получить список ресурсов
{"method": "resources/list"}

# Прочитать ресурс
{"method": "resources/read", "params": {"uri": "task://tasks"}}
```

### Интроспекция и отладка

- `mcp://capabilities` — возвращает объявленные сервером возможности (capabilities):

```
{"resources": {"list": true, "read": true}, "tools": {"call": true}}
```

- `resource://catalog` — каталог зарегистрированных ресурсов (как статических, так и шаблонов). Поддерживает фильтры и пагинацию:

Параметры запроса:

- `q` — полнотекстовый поиск по `id`, `uri`, `title`, `description`
- `scheme` — фильтр по схеме (`task`, `knowledge`, `prompt`, `export`, `tool`, `project`, `tasks`, `search`, ...)
- `kind` — тип ресурса: `static` или `template`
- `sort` — поле сортировки: `id` | `uri` | `scheme` | `title` (по умолчанию `uri`)
- `order` — порядок: `asc` или `desc` (по умолчанию `asc`)
- `offset` — смещение (по умолчанию 0)
- `limit` — размер страницы (по умолчанию 1000, максимум 5000)

Примеры:

```
resource://catalog?q=project%2F%7Bid%7D
resource://catalog?scheme=tasks&kind=template&sort=title
resource://catalog?scheme=tool&kind=static&sort=uri&order=desc&limit=50
```

### С Claude Desktop

Ресурсы будут автоматически доступны в контексте разговора и могут использоваться LLM для получения актуальной информации о задачах, знаниях и промптах.
