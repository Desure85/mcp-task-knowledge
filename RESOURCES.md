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
- **Схема инструмента**: `tool://schema/{name}`
- **Запуск инструмента**: `tool://run/{name}/{paramsB64}`

Где `paramsB64` — это base64 от JSON-объекта параметров (соответствует `inputSchema` инструмента). Выполнение через ресурс отключено по умолчанию и включается переменной окружения:

```
MCP_TOOL_RESOURCES_EXEC=1
```

**Примеры использования**:

```
tool://catalog                       # список всех tools с ключевыми полями
tool://schema/prompts_list           # метаданные и ключи параметров для инструмента prompts_list

# подготовим JSON и закодируем в base64 (пример)
{
  "project": "mcp-sandbox",
  "kind": "prompt",
  "latest": true
}
# -> base64: eyJwcm9qZWN0IjoibWNwLXNhbmRib3giLCJraW5kIjoicHJvbXB0IiwibGF0ZXN0Ijp0cnVlfQ==

tool://run/prompts_list/eyJwcm9qZWN0IjoibWNwLXNhbmRib3giLCJraW5kIjoicHJvbXB0IiwibGF0ZXN0Ijp0cnVlfQ==
```

Ответ содержит JSON-результат вызова MCP-инструмента (такой же, как если бы вы вызывали `server.registerTool`).

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

Эти ресурсы автоматически доступны всем MCP клиентам, подключенным к серверу. Клиенты могут:

1. Запросить список доступных ресурсов
2. Читать содержимое ресурсов по URI
3. Использовать ресурсы в контексте работы с LLM

## Примеры интеграции

### С MCP Inspector

```bash
# Получить список ресурсов
{"method": "resources/list"}

# Прочитать ресурс
{"method": "resources/read", "params": {"uri": "task://tasks"}}
```

### С Claude Desktop

Ресурсы будут автоматически доступны в контексте разговора и могут использоваться LLM для получения актуальной информации о задачах, знаниях и промптах.
