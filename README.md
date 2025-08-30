# MCP Task & Knowledge (file-backed)

Файловый MCP-сервер для таск-менеджмента и базы знаний по проектам.

- Хранилище: Markdown/JSON в `data/` по неймспейсам проектов (совместимо с Obsidian)
- Инструменты: `tasks_*`, `knowledge_*`, `search_*`
- Поиск: BM25 по умолчанию; предусмотрен интерфейс для векторного поиска (плагин)
- Запуск: Node.js или Docker

## Формат ответов MCP‑инструментов

Все инструменты возвращают ответы в едином JSON‑конверте:

```json
{
  "ok": true,
  "data": { /* полезные данные */ }
}
```

Ошибка при `mergeStrategy=fail` и наличии конфликтов (import):

```json
{ "ok": false, "error": { "message": "Import aborted due to conflicts (mergeStrategy=fail)." } }
```

CLI-конверт (obsidian_import_project):

```jsonc
// dryRun (merge)
{
  "ok": true,
  "data": {
    "project": "mcp",
    "strategy": "merge",
    "knowledge": true,
    "tasks": true,
    "plan": { "deletes": {"knowledge": 0, "tasks": 0}, "creates": {"knowledge": 3, "tasks": 2}, "updates": {"knowledge": 1, "tasks": 1} }
  }
}

// replace без confirm (ошибка безопасности на уровне CLI-инструмента)
{ "ok": false, "error": { "message": "Import replace not confirmed: pass confirm=true to proceed" } }

// replace c confirm (успех)
{ "ok": true, "data": { "project": "mcp", "strategy": "replace", "knowledgeImported": 4, "tasksImported": 2 } }
```

При ошибках:

```json
{
  "ok": false,
  "error": { "message": "Описание ошибки" }
}
```

Это касается всех `tasks_*`, `knowledge_*`, `search_*`, `embeddings_*`, а также `service_catalog_*`, `project_*`, `obsidian_*`.

### Ошибки инструментов и поведение SDK

В текущей версии SDK клиентские вызовы `client.callTool(...)` при ошибке инструмента возвращают УСПЕШНО-резолвленный ответ с флагом `isError: true`, а не «rejected promise».

Пример проверки в тестах (Vitest):

```ts
const res = await client.callTool({
  name: 'project_purge',
  arguments: { project: 'mcp', dryRun: false, confirm: false }
})
expect(res.isError).toBe(true)
expect(res.content?.[0]?.text).toContain('Refusing to proceed')
```

Это особенно важно для деструктивных операций с подтверждением (`confirm: true`). Например, `project_purge` без `confirm: true` в реальном режиме (не `dryRun`) вернёт ответ вида:

```json
{
  "isError": true,
  "content": [
    { "type": "text", "text": "Refusing to proceed: Project purge not confirmed" }
  ]
}
```

Поэтому использовать конструкции вида `await expect(client.callTool(...)).rejects.toThrow(...)` — некорректно; необходимо проверять `isError` и текст ошибки.

## Структура

```
./
  src/
    index.ts           # MCP-сервер: регистрация инструментов и stdio-транспорт
    config.ts          # переменные окружения и пути
    fs.ts              # утилиты для файловой системы
    types.ts           # типы задач и документов
    storage/
      tasks.ts         # JSON-задачи: create/list/update/close
      knowledge.ts     # Markdown-доки (frontmatter + content)
    search/
      bm25.ts          # простой BM25
      index.ts         # объединение BM25 и (опц.) векторного адаптера
  data/
    tasks/<project>/*.json
    knowledge/<project>/*.md
  Dockerfile
  package.json
  tsconfig.json
```

## Установка и запуск (Node.js)

1. Установка зависимостей

```bash
npm i
```

2. Сборка

```bash
npm run build
```

3. Запуск

```bash
# Параметры задаются через переменные окружения; OBSIDIAN_VAULT_ROOT имеет дефолт /data/obsidian
# Пример (PowerShell):
$env:DATA_DIR="$PWD/data"
$env:OBSIDIAN_VAULT_ROOT="$env:DATA_DIR/vault"
$env:EMBEDDINGS_MODE="none"            # none|onnx-cpu|onnx-gpu
# Если onnx-режимы, обязательно также:
# $env:EMBEDDINGS_MODEL_PATH="C:/models/multilingual-e5-small.onnx"
# $env:EMBEDDINGS_DIM="384"
# $env:EMBEDDINGS_CACHE_DIR="$env:DATA_DIR/.embeddings"
node dist/index.js
```

## Опубликованные Docker-образы (GHCR)

Сборка GitHub Actions публикует образы в GitHub Container Registry:

- Репозиторий образов: `ghcr.io/desure85/mcp-task-knowledge`
- Варианты (`variant`):
  - `bm25` — только BM25 (минимальный, без моделей ONNX)
  - `cpu` — BM25 + ONNX CPU (с предзагруженной моделью в `/app/models`)
  - `gpu` — BM25 + ONNX GPU (для хостов с CUDA)
  - `bm25-cat`, `cpu-cat`, `gpu-cat` — то же самое, но с вшитой библиотекой `service-catalog` во время сборки
- Теги (`tag`):
  - `latest` — для веток `main/master`
  - `<git-tag>` — если сборка по git‑тегу
  - `<short-sha>` — сокращённый SHA коммита (по умолчанию)

Примеры:

```bash
# Получить минимальный образ (BM25)
docker pull ghcr.io/desure85/mcp-task-knowledge:bm25-latest

# Образ с ONNX CPU
docker pull ghcr.io/desure85/mcp-task-knowledge:cpu-latest

# Образ с ONNX GPU
docker pull ghcr.io/desure85/mcp-task-knowledge:gpu-latest

# Вариант с вшитой библиотекой service-catalog (embedded)
docker pull ghcr.io/desure85/mcp-task-knowledge:cpu-cat-latest
```

Запуск (BM25):

```bash
docker run --rm -it \
  -e DATA_DIR=/data \
  -v "$PWD/.data":/data \
  ghcr.io/desure85/mcp-task-knowledge:bm25-latest
```

Запуск (ONNX CPU):

```bash
docker run --rm -it \
  -e DATA_DIR=/data \
  -e EMBEDDINGS_MODE=onnx-cpu \
  -e EMBEDDINGS_MODEL_PATH=/app/models/encoder.onnx \
  -v "$PWD/.data":/data \
  ghcr.io/desure85/mcp-task-knowledge:cpu-latest
```

> Примечание: GPU‑вариант требует доступного CUDA‑окружения на хосте и запуска с `--gpus all`.

### Compose (remote catalog) c опубликованным образом

Для режима каталога `remote` используйте готовый compose с опубликованным образом MCP (BM25‑вариант):

```yaml
services:
  service-catalog:
    image: node:20-alpine
    working_dir: /app
    environment:
      - NODE_ENV=development
      - PORT=3001
      - SERVICE_CATALOG_GIT=https://github.com/Desure85/service-catalog.git
      - SERVICE_CATALOG_REF=main
    command: >-
      sh -lc "set -euo pipefail; \
      apk add --no-cache git curl >/dev/null 2>&1 || true; \
      if [ ! -d .git ]; then \
        echo '[svc] cloning service-catalog'; \
        git clone --depth 1 -b \"${SERVICE_CATALOG_REF}\" \"${SERVICE_CATALOG_GIT}\" /app; \
      fi; \
      npm ci || npm i; \
      npm run dev"
    ports:
      - "42056:3001"
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:3001/api/health >/dev/null || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 10

  mcp:
    image: ghcr.io/desure85/mcp-task-knowledge:bm25-latest
    depends_on:
      service-catalog:
        condition: service_healthy
    environment:
      - DATA_DIR=/data
      - OBSIDIAN_VAULT_ROOT=/data/obsidian
      - EMBEDDINGS_MODE=none
      - DEBUG_VECTOR=false
      - CATALOG_ENABLED=1
      - CATALOG_READ_ENABLED=1
      - CATALOG_WRITE_ENABLED=0
      - CATALOG_MODE=remote
      - CATALOG_REMOTE_ENABLED=1
      - CATALOG_REMOTE_BASE_URL=http://service-catalog:3001
      - CATALOG_REMOTE_TIMEOUT_MS=2000
    volumes:
      - ./.data:/data:rw
```

Альтернатива: embedded‑вариант без отдельного сервиса каталога (встроенная библиотека) — используйте образ `*-cat` и исключите `service-catalog`:

```yaml
services:
  mcp:
    image: ghcr.io/desure85/mcp-task-knowledge:cpu-cat-latest
    environment:
      - DATA_DIR=/data
      - EMBEDDINGS_MODE=onnx-cpu
      - EMBEDDINGS_MODEL_PATH=/app/models/encoder.onnx
      - CATALOG_ENABLED=1
      - CATALOG_READ_ENABLED=1
      - CATALOG_WRITE_ENABLED=0
      - CATALOG_MODE=embedded
      - CATALOG_EMBEDDED_ENABLED=1
      - CATALOG_EMBEDDED_STORE=memory
    volumes:
      - ./.data:/data:rw
```

Рекомендуемая структура данных (будет создана автоматически при первых записях):

- `data/tasks/<project>/<uuid>.json`
- `data/knowledge/<project>/<uuid>.md`

## Переменные окружения

Сервер поддерживает следующие переменные окружения для настройки:

### Основные директории данных

| Переменная | Описание | Значение по умолчанию | Обязательная |
|------------|----------|----------------------|-------------|
| `DATA_DIR` | Корневая директория для всех данных | - | ✅ Да |
| `MCP_TASK_DIR` | Директория для хранения задач | `DATA_DIR/tasks` | ❌ Нет |
| `MCP_KNOWLEDGE_DIR` | Директория для хранения знаний | `DATA_DIR/knowledge` | ❌ Нет |
| `MCP_PROMPTS_DIR` | Директория для Prompts (если не задана — используется `DATA_DIR/prompts`, с легаси-фолбэком `DATA_DIR/mcp/prompts`) | `DATA_DIR/prompts` | ❌ Нет |
| `OBSIDIAN_VAULT_ROOT` | Корень Obsidian vault | `/data/obsidian` | ❌ Нет |

### Текущий проект

| Переменная | Описание | Значение по умолчанию |
|------------|----------|----------------------|
| `CURRENT_PROJECT` | Текущий активный проект | `mcp` |

### Конфигурация через JSON

- `MCP_CONFIG_JSON` — JSON-строка с конфигурацией (аналог `--config <path>`). Поля соответствуют структурам `loadConfig()` и `loadCatalogConfig()` из `src/config.ts`.
  - Пример:

    ```bash
    export MCP_CONFIG_JSON='{"dataDir":"/data","currentProject":"mcp","embeddings":{"mode":"none"},"catalog":{"enabled":true,"mode":"embedded"}}'
    ```

### Эмбеддинги и векторный поиск

| Переменная | Описание | Значение по умолчанию |
|------------|----------|----------------------|
| `EMBEDDINGS_MODE` | Режим эмбеддингов | `onnx-gpu` |
| `EMBEDDINGS_MODEL_PATH` | Путь к модели ONNX | - |
| `EMBEDDINGS_DIM` | Размерность векторов | Автоопределение из модели |
| `EMBEDDINGS_CACHE_DIR` | Директория кэша эмбеддингов | `DATA_DIR/.embeddings` |
| `EMBEDDINGS_MEM_LIMIT_MB` | Лимит памяти LRU кэша (MB) | `128` |
| `EMBEDDINGS_PERSIST` | Сохранять кэш на диск | `true` |
| `EMBEDDINGS_BATCH_SIZE` | Размер батча для обработки | `16` |
| `EMBEDDINGS_MAX_LEN` | Максимальная длина токенов | `256` |

— Рекомендуемые профили по вариантам образов:

| Вариант образа | Режим | Модель по умолчанию | Примечания |
|----------------|------|---------------------|------------|
| `bm25`         | `none`     | —                     | Векторные эмбеддинги отключены |
| `cpu`          | `onnx-cpu` | `/app/models/encoder.onnx` | Модель и токенайзер уже в образе |
| `gpu`          | `onnx-gpu` | `/app/models/encoder.onnx` | Требуется `--gpus all` и CUDA в хосте |

### Каталог сервисов

| Переменная | Описание | Значение по умолчанию |
|------------|----------|----------------------|
| `CATALOG_MODE` | Режим каталога | `embedded` |
| `CATALOG_PREFER` | Предпочитаемый источник | `embedded` |
| `CATALOG_ENABLED` | Глобально включить каталог и зарегистрировать команды | `false` |
| `CATALOG_REMOTE_BASE_URL` | URL удаленного каталога | - |
| `CATALOG_URL` | Алиас для `CATALOG_REMOTE_BASE_URL` (совместимость) | - |
| `CATALOG_REMOTE_ENABLED` | Включить удаленный каталог | Авто |
| `CATALOG_REMOTE_TIMEOUT_MS` | Таймаут запросов (мс) | `2000` |
| `CATALOG_EMBEDDED_ENABLED` | Включить встроенный каталог | Авто |
| `CATALOG_EMBEDDED_PREFIX` | Префикс API встроенного каталога | `/catalog` |
| `CATALOG_EMBEDDED_STORE` | Тип хранилища встроенного каталога | `memory` |
| `CATALOG_EMBEDDED_FILE_PATH` | Путь к файлу встроенного каталога | - |
| `CATALOG_EMBEDDED_SQLITE_DRIVER` | Драйвер sqlite для embedded‑хранилища (`auto`|`native`|`wasm`) | - |
| `CATALOG_SYNC_ENABLED` | Включить синхронизацию источников | `false` |
| `CATALOG_SYNC_INTERVAL_SEC` | Интервал синхронизации (сек) | `60` |
| `CATALOG_SYNC_DIRECTION` | Направление синхронизации | `remote_to_embedded` |

#### Доступ на чтение/запись и MCP-инструменты

- Флаги доступа (глобальный выключатель — `CATALOG_ENABLED`):
  - `CATALOG_READ_ENABLED` — включает регистрацию и работу read-инструментов каталога. По умолчанию: `true` при `CATALOG_ENABLED=1`.
  - `CATALOG_WRITE_ENABLED` — включает регистрацию write-инструментов каталога. По умолчанию: `false` (для безопасности).

- Зарегистрированные инструменты (при включении соответствующих флагов):
  - Read: `service_catalog_query`, `service_catalog_health` (требует `CATALOG_ENABLED=1` и `CATALOG_READ_ENABLED=1`).
  - Write: `service_catalog_upsert`, `service_catalog_delete` (требует `CATALOG_ENABLED=1` и `CATALOG_WRITE_ENABLED=1`).

- Примеры вызова write-инструментов:

```jsonc
// Upsert (создание/обновление)
{
  "name": "service_catalog_upsert",
  "arguments": {
    "items": [
      { "id": "svc-pay", "name": "Payments API", "component": "payments", "owners": ["team-pay"], "tags": ["api","critical"] }
    ]
  }
}

// Delete (удаление по id)
{
  "name": "service_catalog_delete",
  "arguments": { "ids": ["svc-pay"] }
}
```

Права записи поддерживаются только для embedded‑части (в режимах `embedded` и `hybrid`). В `hybrid` запись всегда идёт в embedded, даже если `CATALOG_PREFER=remote`.

#### Встроенный режим (embedded) через внешнюю библиотеку

Начиная с этой версии, embedded‑режим делегируется внешней библиотеке `service-catalog/lib`, если она доступна, с автоматическим откатом на локальную file/memory‑реализацию при отсутствии библиотеки.

— Включение каталога и подключение библиотеки:

```bash
# из папки mcp-task-knowledge
export CATALOG_ENABLED=1   # без этого команды каталога не регистрируются
npm i file:../service-catalog
npm run build
```

— Минимальная конфигурация для memory‑хранилища (без файла):

```bash
export DATA_DIR=./emb_cache
export CATALOG_MODE=embedded
export CATALOG_EMBEDDED_ENABLED=1
export CATALOG_EMBEDDED_STORE=memory
```

— Проверка работоспособности embedded (health):

```bash
DATA_DIR=./emb_cache \
CATALOG_MODE=embedded CATALOG_EMBEDDED_ENABLED=1 CATALOG_EMBEDDED_STORE=memory \
node --input-type=module -e "import('./dist/catalog/provider.js').then(async m=>{const {loadCatalogConfig}=await import('./dist/config.js');const p=m.createServiceCatalogProvider(loadCatalogConfig());const h=await p.health();console.log(JSON.stringify(h,null,2));process.exit(h.ok?0:1);}).catch(e=>{console.error(e);process.exit(2);})"
```

— Пробный запрос (пагинация/сортировка):

```bash
DATA_DIR=./emb_cache \
CATALOG_MODE=embedded CATALOG_EMBEDDED_ENABLED=1 CATALOG_EMBEDDED_STORE=memory \
node --input-type=module -e "import('./dist/catalog/provider.js').then(async m=>{const {loadCatalogConfig}=await import('./dist/config.js');const p=m.createServiceCatalogProvider(loadCatalogConfig());const r=await p.queryServices({page:1,pageSize:5,sort:'updatedAt:desc'});console.log(JSON.stringify(r,null,2));}).catch(e=>{console.error(e);process.exit(2);})"
```

— Использование file‑хранилища:

```bash
export CATALOG_EMBEDDED_STORE=file
export CATALOG_EMBEDDED_FILE_PATH=/absolute/path/to/catalog.json
```

— Использование sqlite‑хранилища:

```bash
export CATALOG_ENABLED=1
export CATALOG_MODE=embedded
export CATALOG_EMBEDDED_ENABLED=1
export CATALOG_EMBEDDED_STORE=sqlite
# Выбор драйвера: auto | native | wasm (зависит от окружения)
export CATALOG_EMBEDDED_SQLITE_DRIVER=auto

# Примечания:
# - Драйвер 'native' требует нативные зависимости среды выполнения.
# - Драйвер 'wasm' работает без нативных зависимостей, но может быть медленнее.
# - Конкретное расположение файла БД и дополнительные опции управляются библиотекой service-catalog.
```

Формат файла поддерживается в двух вариантах:

```jsonc
// Вариант 1: массив
[
  {
    "id": "svc-payments",
    "name": "Payments Service",
    "component": "payments",
    "domain": "billing",
    "status": "prod",
    "owners": ["team-billing"],
    "tags": ["backend","critical"],
    "annotations": { "repo": "git@..." },
    "updatedAt": "2025-08-20T12:00:00Z"
  }
]

// Вариант 2: объект с полем items
{ "items": [ { /* как выше */ } ] }

// Вариант 3: объект с полем items и дополнительными полями
{ 
  "items": [ 
    { 
      "id": "svc-payments",
      "name": "Payments Service",
      "component": "payments",
      "domain": "billing",
      "status": "prod",
      "owners": ["team-billing"],
      "tags": ["backend","critical"],
      "annotations": { "repo": "git@..." },
      "updatedAt": "2025-08-20T12:00:00Z"
    } 
  ],
  "metadata": {
    "total": 100,
    "page": 1,
    "pageSize": 10
  }
}
```

— Гибридный режим (hybrid):

- `CATALOG_MODE=hybrid`, порядок опроса источников определяется `CATALOG_PREFER` (`embedded`|`remote`).
- При недоступности предпочтительного источника идёт автоматическое переключение на альтернативный (embedded ↔ remote).

#### Миграция и синхронизация (remote ↔ embedded)

Цель — безопасно управлять embedded‑копией каталога при наличии удалённого сервиса.

- Варианты сценариев:
  - __One‑time миграция remote → embedded__: разовый экспорт remote в embedded‑файл для офлайн/локальной работы.
  - __Периодическая синхронизация__: регулярное обновление embedded из remote (read‑only с точки зрения embedded), с опциональной отправкой локальных изменений обратно (двусторонняя синхронизация — по договорённости политики).

- Рекомендуемая конфигурация для миграции remote → embedded:
  - `CATALOG_MODE=hybrid`
  - `CATALOG_PREFER=remote`
  - `CATALOG_REMOTE_ENABLED=1`, `CATALOG_REMOTE_BASE_URL=http://remote:3001`
  - `CATALOG_EMBEDDED_ENABLED=1`, `CATALOG_EMBEDDED_STORE=file`, `CATALOG_EMBEDDED_FILE_PATH=/data/catalog.json`
  - `CATALOG_ENABLED=1`, `CATALOG_READ_ENABLED=1`, `CATALOG_WRITE_ENABLED=1` (для возможности upsert/delete в embedded).

- Процедура миграции (пример):
  1) Выполнить `service_catalog_query` по страницам, собирая все элементы из remote (в `hybrid` с prefer=remote запросы пойдут в remote).
  2) Сохранить в embedded через `service_catalog_upsert` пачками (10–100 элементов) — данные будут записаны в файл (при `store=file`).
  3) Опционально переключить `CATALOG_PREFER=embedded` для офлайн‑режима.

- Периодическая синхронизация:
  - Включить планировщик вне MCP (cron/systemd/k8s CronJob) и периодически повторять шаги миграции (1→2).
  - Конфликтную политику определять по полю `updatedAt` (при upsert локально оно авто‑устанавливается, при наличии удалённого источника полагайтесь на источник истины).
  - Для однонаправленной sync `remote_to_embedded` избегайте записи обратно в remote из MCP.

Заметки по безопасности:

- По умолчанию `CATALOG_WRITE_ENABLED=0`. Включайте запись только там, где это целесообразно и контролируемо.
- В `embedded.store=file` содержимое записывается как массив или `{ items: [...] }`. Файл должен находиться в доступной для записи директории.

— Отладка и частые ошибки:

- Обязательно задайте `DATA_DIR` (иначе ошибка на старте конфигурации).
- Команды `service_catalog_*` регистрируются только при `CATALOG_ENABLED=1`.
- При работе из кода используйте `loadCatalogConfig()` (а не `loadConfig()`) для провайдера каталога.
- Если импорт `service-catalog/lib` невозможен, провайдер автоматически использует локальную реализацию (file/memory).

#### Сборка Docker с встраиванием service-catalog

По умолчанию `Dockerfile` пытается встроить библиотеку из Git:

```bash
docker build -t mcp-task-knowledge:with-catalog .
# эквивалентно: --build-arg SERVICE_CATALOG_GIT=https://github.com/Desure85/service-catalog.git --build-arg SERVICE_CATALOG_REF=main
```

Переопределить источник:

```bash
# tarball (npm pack артефакт)
docker build \
  --build-arg SERVICE_CATALOG_TARBALL=https://example.com/artifacts/service-catalog-1.2.3.tgz \
  -t mcp-task-knowledge:with-catalog .

# git с другой веткой/форком
docker build \
  --build-arg SERVICE_CATALOG_GIT=https://github.com/your-org/service-catalog.git \
  --build-arg SERVICE_CATALOG_REF=release/1.3 \
  -t mcp-task-knowledge:with-catalog .

# отключить встраивание (ни tarball, ни git)
docker build \
  --build-arg SERVICE_CATALOG_GIT= \
  -t mcp-task-knowledge:base .
```

### Docker Compose: сервис каталога из GitHub + MCP (remote mode)

В репозитории есть готовый `docker-compose.catalog.yml`, который поднимает два сервиса:

- `service-catalog` — клонирует `service-catalog` из GitHub при старте и запускает его на `:3001`.
- `mcp` — MCP‑сервер в режиме `remote`, указывающий на `service-catalog`.

Старт:

```bash
make compose-up
# или напрямую:
docker compose -f docker-compose.catalog.yml up --build -d
```

Остановка:

```bash
make compose-down
# или напрямую:
docker compose -f docker-compose.catalog.yml down
```

Ключевые настройки внутри compose:

- `service-catalog`:
  - `SERVICE_CATALOG_GIT=https://github.com/Desure85/service-catalog.git`
  - `SERVICE_CATALOG_REF=main`
  - при старте контейнер выполняет `git clone` и `npm run dev` (без локального маунта каталога).

- `mcp`:
  - `CATALOG_ENABLED=1`, `CATALOG_READ_ENABLED=1`, `CATALOG_WRITE_ENABLED=0` (по умолчанию запись отключена для безопасности)
  - `CATALOG_MODE=remote`, `CATALOG_REMOTE_BASE_URL=http://service-catalog:3001`
  - `EMBEDDINGS_MODE=none` (минимальный безопасный режим)
  - `DATA_DIR=/data` смонтирован в `./.data`

Подсказки:

- Для локальной разработки каталога вместо GitHub можно вернуть volume‑маунт `../service-catalog:/app:rw` в сервисе `service-catalog`.
- Для включения записи из MCP установите `CATALOG_WRITE_ENABLED=1` (рекомендуется только для контролируемых окружений).

### Obsidian интеграция

| Переменная | Описание | Значение по умолчанию |
|------------|----------|----------------------|
| `OBSIDIAN_VAULT_ROOT` | Корневая директория Obsidian vault | `/data/obsidian` |

#### Prompts: экспорт/импорт

- Структура в Obsidian Vault: `Vault/<project>/Prompts/`
  - `catalog/prompts.catalog.json`
  - `builds/**/*`
  - `markdown/**/*.md` (опционально)
  - `sources/` (опционально, сохраняется структура подтипов):
    - `prompts/**/*.json`
    - `rules/**/*.json`
    - `workflows/**/*.json`
    - `templates/**/*.json`
    - `policies/**/*.json`

- Структура в MCP data (`DATA_DIR/prompts/<project>`):
  - Источники: зеркально под `sources/*` (когда импортируются)
  - Экспортируемые артефакты: `exports/` с подпапками
    - `exports/catalog/prompts.catalog.json`
    - `exports/builds/**/*`
    - `exports/markdown/**/*.md`

#### Разрешение путей (приоритет директорий Prompts)

- Разрешение директорий Prompts:
  1) Если задан `MCP_PROMPTS_DIR` — он используется как корень Prompts.
  2) Иначе требуется `DATA_DIR`; используется `${DATA_DIR}/prompts` с легаси‑фолбэком `${DATA_DIR}/mcp/prompts`.
  3) Репозиторные фоллбэки `.data/` и `data/` больше не используются. При отсутствии указанных переменных будет выброшена ошибка (и сервер/скрипты не создадут артефакты в папке проекта).
- Проект выбирается переменной `CURRENT_PROJECT` (по умолчанию `mcp`). Итоговый путь: `${MCP_PROMPTS_DIR}/<CURRENT_PROJECT>` (если задан `MCP_PROMPTS_DIR`) или `${DATA_DIR}/prompts/<CURRENT_PROJECT>`.

- Импорт из Vault (инструмент `obsidian_import_project`):
  - Флаги
    - `prompts: boolean` — включить/отключить импорт Prompts (по умолчанию: включён)
    - `importPromptSourcesJson: boolean` — импортировать JSON‑источники (`sources/*`) в `DATA_DIR/prompts/<project>`
    - `importPromptMarkdown: boolean` — импортировать Markdown (`markdown/*`) в `exports/markdown`
  - Стратегии
    - `merge` — без удаления, только дозапись/перезапись по файлам
    - `replace` — очистка целевых директорий экспорта Prompts перед копированием:
      - всегда: `exports/catalog`, `exports/builds`, `exports/markdown`
      - при включённом `importPromptSourcesJson`: также дерево `sources/*`

Примеры:

```bash
# Dry‑run (merge) с включёнными источниками и markdown
mcp obsidian_import_project \
  --project mcp \
  --dryRun true \
  --prompts true \
  --importPromptSourcesJson true \
  --importPromptMarkdown true

# Импорт (merge)
mcp obsidian_import_project \
  --project mcp \
  --prompts true \
  --importPromptSourcesJson true \
  --importPromptMarkdown true

# Импорт (replace) с очисткой экспортных директорий Prompts
mcp obsidian_import_project \
  --project mcp \
  --strategy replace \
  --confirm true \
  --prompts true \
  --importPromptSourcesJson true \
  --importPromptMarkdown true
```

#### Prompts CLI (validate/index/export/catalog/build/list/ab:report)

- Запуск напрямую:

```bash
# Индексация и валидация
node scripts/prompts.mjs index
node scripts/prompts.mjs validate

# Экспорт артефактов
node scripts/prompts.mjs export-json
node scripts/prompts.mjs export-md
node scripts/prompts.mjs catalog
node scripts/prompts.mjs build

# Список промптов с фильтрами
node scripts/prompts.mjs list --latest --format=table
node scripts/prompts.mjs list --kind=workflow --tag=analytics,internal --status=published

# Отчёт A/B экспериментов
node scripts/prompts.mjs ab:report
```

#### MCP инструменты: Prompts (сервер)

- __prompts_catalog_get__ — вернуть `prompts.catalog.json` из `exports/catalog` (если есть).
- __prompts_list__ — список промптов (фильтры поверх каталога: id/kind/status/tags/domain/latest и т.д.).
- __prompts_search__ — гибридный поиск по билдам/markdown (лексический/семантический, при наличии векторов).
- __prompts_feedback_log__ — дозапись пассивной обратной связи (JSONL) в `data/prompts/<project>/metrics/feedback/`.
- __prompts_feedback_validate__ — быстрая проверка JSONL-файла обратной связи (сводка/образцы, ошибки парсинга).
- __prompts_ab_report__ — агрегированный отчёт: A/B метрики + пассивная обратная связь по всем ключам.
- __prompts_exports_get__ — список артефактов экспорта: `exports/catalog`, `exports/builds`, `exports/markdown`.
- __prompts_variants_list__ — доступные варианты для `promptKey` (из эксперимента или из билдов).
- __prompts_variants_stats__ — агрегированные метрики по вариантам для `promptKey`.
- __prompts_bandit_next__ — выбор следующего варианта для `promptKey` (epsilon-greedy по агрегатам).
- __prompts_metrics_log_bulk__ — пакетная запись событий метрик и обновление агрегатов.

Подсказки:

- Большинство инструментов поддерживает параметр `project` (по умолчанию `CURRENT_PROJECT`).
- Пути данных Prompts описаны выше в разделе «Prompts: экспорт/импорт» и «Артефакты CI…».

#### Артефакты CI и выходные директории Prompts

- При прогоне CI (см. `.github/workflows/prompts-ci.yml`) публикуются артефакты из:
  - `${DATA_DIR}/prompts/<project>/index.json`
  - `${DATA_DIR}/prompts/<project>/quality/validation.json`
  - `${DATA_DIR}/prompts/<project>/exports/json/**/*`
  - `${DATA_DIR}/prompts/<project>/exports/markdown/**/*`
  - `${DATA_DIR}/prompts/<project>/exports/catalog/**/*` (включая `prompts.catalog.json` и `experiments.report.json`)
  - `${DATA_DIR}/prompts/<project>/exports/builds/**/*`

### CI: безопасные дефолты переменных

- Для стабильной работы GitHub Actions без обязательной передачи переменных введены дефолты:
  - `APP_DIR` — `${{ github.workspace }}` (корень репозитория).
  - `DATA_DIR` — `${{ github.workspace }}/.data` (локальная папка данных в репозитории).
  - `CURRENT_PROJECT` — `mcp`.
  - `EMBEDDINGS_MODE` — `none` (минимальный безопасный режим для смок‑тестов).

- Применено в workflow `bulk-smoke.yml` на уровне job `env:`. Перед запуском сценариев создаётся директория данных:

```bash
mkdir -p "$DATA_DIR"
```

- Кросс‑ОС заметки:
  - GitHub хосты Linux/Windows/macOS нормально обрабатывают `${{ github.workspace }}`; path‑separator в shell шагах — POSIX (`/`).
  - Внутри bash‑шагов используйте кавычки вокруг переменных путей: `"$DATA_DIR"`.

### Отладка / низкоуровневые параметры

| Переменная | Описание | Значение по умолчанию |
|------------|----------|----------------------|
| `DEBUG_VECTOR` | Подробные логи инициализации векторного адаптера | `false` |
| `ONNXRUNTIME_NODE_EXECUTION_PROVIDERS` | Порядок провайдеров выполнения ORT (через запятую), например `cuda,cpu` | `cuda,cpu` |
| `ORT_SAFE_CUDA_PROBE` | Управление безопасной проверкой CUDA (установите `0` чтобы отключить пробу) | проба включена |

Примечание: для GPU‑окружения корректная настройка системного `LD_LIBRARY_PATH` (драйверы CUDA/ORT) может быть необходима; переменная не обрабатывается приложением, но выводится в debug‑логах для диагностики.

### Примеры использования

```bash
# Базовая настройка с разделенными директориями
export DATA_DIR=/app/data
export MCP_TASK_DIR=/data/tasks
export MCP_KNOWLEDGE_DIR=/data/knowledge
export EMBEDDINGS_MODE=onnx-cpu
export EMBEDDINGS_MODEL_PATH=/app/models/encoder.onnx
export OBSIDIAN_VAULT_ROOT=/data/vault

# Запуск сервера
node dist/index.js
```

```bash
# Docker с GPU поддержкой
docker run --rm -it \
  -e DATA_DIR=/data \
  -e MCP_TASK_DIR=/data/tasks \
  -e MCP_KNOWLEDGE_DIR=/data/knowledge \
  -e EMBEDDINGS_MODE=onnx-gpu \
  -e EMBEDDINGS_MODEL_PATH=/app/models/model.onnx \
  -e OBSIDIAN_VAULT_ROOT=/data/obsidian \
  -e DEBUG_VECTOR=1 \
  -v /host/data:/data \
  --gpus all \
  mcp-task-knowledge:gpu
```

### Примечания

- `DATA_DIR` является обязательной переменной
- `MCP_TASK_DIR` и `MCP_KNOWLEDGE_DIR` позволяют использовать нестандартную структуру директорий
- Переменные эмбеддингов игнорируются при `EMBEDDINGS_MODE=none`
- Каталог автоматически переключается на `embedded` режим, если `remote` режим настроен некорректно

## Запуск в Docker

> Важно
>
> - CPU-образ уже содержит предзагруженные артефакты модели и токенайзера в каталоге `/app/models`.
> - Для onnx-режимов указывайте `EMBEDDINGS_MODEL_PATH=/app/models/encoder.onnx` (или соответствующий `model.onnx`).
> - Размерность часто определяется автоматически из `/app/models/metadata.json`; при необходимости задайте `EMBEDDINGS_DIM` явно.

### Быстрый старт (рекомендуется)

- make-таргеты в `mcp-task-knowledge/Makefile`:
  - `make docker-buildx-cpu` — сборка образа CPU (runtime-onnx-cpu) с кэшем.
  - `make smoke-embeddings-cpu` — собрать образ и запустить оффлайн‑smoke эмбеддингов (CPU).
  - `make smoke-embeddings-cpu-nobuild` — запустить smoke без пересборки.
  - `make compose-up` / `make compose-down` — поднять/остановить compose (`docker-compose.catalog.yml`).
  - `make up-cpu` — переключить compose на onnx-cpu и пересобрать.

Подсказка: в CPU-образе путь к модели по умолчанию — `/app/models/encoder.onnx`. Пример: `-e EMBEDDINGS_MODEL_PATH=/app/models/encoder.onnx`.

- npm‑скрипты из `mcp-task-knowledge/package.json`:
  - `npm run compose:up` / `npm run compose:down`
  - `npm run compose:smoke` / `npm run compose:smoke:all`
  - `npm run onnx:selfcheck:cpu`

Примечания:

- В образе CPU присутствуют артефакты модели/токенайзера в `/app/models`; размерность часто берётся из `/app/models/metadata.json`. При необходимости установите `EMBEDDINGS_DIM` явно.
- Для детальных логов инициализации векторного адаптера задайте `DEBUG_VECTOR=1`.
- Реестр npm можно переопределить при сборке: `docker build --build-arg NPM_REGISTRY=https://registry.npmjs.org/ ...`

### Ускоренная сборка и кэш BuildKit

- __Локальный файловый кэш (по умолчанию)__
  - Сборки через `docker buildx` используют локальный кэш в каталоге `.buildx-cache/` в корне репозитория. Это ускоряет повторные сборки на этой машине.

- __Локальный registry‑кэш (персистентный)__
  - Можно поднять локальный Docker Registry и использовать его как источник/приёмник кэша.
  - Запустить реестр:

    ```bash
    docker run -d --restart=always -p 5000:5000 --name registry registry:2
    ```

  - Создать buildx‑builder с доступом к localhost (важно для доступа BuildKit к реестру на 127.0.0.1:5000):

    ```bash
    docker buildx create --name mcpbuilder --driver docker-container --use --driver-opt network=host
    ```

  - Собрать с использованием образа‑кэша:

    ```bash
    make docker-buildx-cpu \
      CACHE_IMAGE=127.0.0.1:5000/mcp-tk/cache:buildx
    ```

  - Примечание:
    - BuildKit запускается в отдельном контейнере и не видит «localhost» хоста, поэтому для доступа к локальному реестру нужен builder с `--driver-opt network=host`.
    - Используйте `127.0.0.1` вместо `localhost`, чтобы избежать разрешения в IPv6 (`::1`) и возможных ошибок подключения.
    - Без TLS это «insecure registry». При необходимости настройте доверие в Docker daemon или используйте реестр с TLS.

- __NPM registry__
  - Чтобы уменьшить флейки/ретраи при установке пакетов, можно переопределить реестр npm:

    ```bash
    make docker-buildx-cpu NPM_REGISTRY=https://registry.npmjs.org/
    ```

### Быстрая кэшированная сборка (<60с)

- __Предусловия__
  - Создайте buildx-builder с доступом к локальному реестру и сети хоста (для опции registry-кэша, если будете использовать её). Впрочем, для локального файлового кэша достаточно стандартного builder.
  - Убедитесь, что `.dockerignore` исключает артефакты, тесты и лишние файлы (в репозитории уже настроено).

- __Инициализационная сборка (заполнить кэш)__

  ```bash
  docker buildx build \
    --progress=plain \
    --target runtime-onnx-cpu \
    -t mcp-task-knowledge:cpu \
    --cache-to type=local,dest=.buildx-cache,mode=max \
    --cache-from type=local,src=.buildx-cache \
    .
  ```

- __Повторная сборка и бенчмарк (<60с при кэше)__

  ```bash
  /usr/bin/time -f "real:%E user:%U sys:%S maxrss:%M" \
  docker buildx build \
    --load \
    --progress=plain \
    --target runtime-onnx-cpu \
    -t mcp-task-knowledge:cpu \
    --cache-from type=local,src=.buildx-cache \
    --cache-to type=local,dest=.buildx-cache,mode=max \
    .
  ```

- __Ожидаемое поведение__
  - При отсутствии изменений в `src/` и манифестах (`package.json`, `package-lock.json`, `tsconfig.json`) повторная сборка должна занимать <60 секунд на типичной машине разработчика.
  - Изменение исходников инвалидирует только слой `builder` (`COPY src` + `npm run build`), что даёт быстрый ребилд.
  - Зависимости фиксируются через `npm ci` и кэшируются с `--mount=type=cache,target=/root/.npm` в слое `deps`.

- __Подсказки__
  - Если корпоративный прокси/зеркало нестабильно — укажите реестр: `--build-arg NPM_REGISTRY=https://registry.npmjs.org/`.
  - Для более агрессивного/общего кэша используйте registry-кэш из раздела выше (образ кэша в локальном реестре).
  - Проверяйте, что build контекст мал: `docker buildx build --no-cache --progress=plain . | head -n 50` покажет ранние шаги и размер контекста.

### Debugging

Чтобы включить подробные логи по инициализации векторного адаптера, установите переменную окружения `DEBUG_VECTOR=1`.
Например, для Docker:

```bash
docker run --rm -it \
  -e DATA_DIR=/data \
  -e OBSIDIAN_VAULT_ROOT=/data/obsidian \
  -e HF_HUB_OFFLINE=1 \
  -e TRANSFORMERS_OFFLINE=1 \
  -e EMBEDDINGS_MODE=onnx-cpu \
  -e EMBEDDINGS_MODEL_PATH=/app/models/encoder.onnx \
  -e EMBEDDINGS_DIM=768 \
  -e EMBEDDINGS_CACHE_DIR=/data/.embeddings \
  -e DEBUG_VECTOR=1 \
  -v "$PWD/.data":/data \
  mcp-task-knowledge:cpu
```

### Логи старта и диагностика

- [startup] — базовая информация о запуске (timestamp, pid).
- [startup][catalog] — выбранный режим каталога (`mode`, `prefer`, флаги remote/embedded, baseUrl/store).
- [startup][embeddings] — режим эмбеддингов (`mode`, `dim`, `cacheDir`, наличие `modelPath`).
- [embeddings] ensureVectorAdapter — пред‑проверки конфигурации, успешная инициализация (`adapter initialized`) или подробная ошибка.
- Инструмент диагностики:
  - `embeddings_status` — текущее состояние/режим эмбеддингов.
  - `embeddings_try_init` — принудительная инициализация адаптера с диагностикой.

### Мини self-test эмбеддингов (CPU, оффлайн)

```bash
# 1) создайте локальный скрипт
cat > /tmp/emb-selftest.mjs <<'EOF'
import('/app/dist/search/vector.js').then(async m => {
  const adapter = await m.getVectorAdapter();
  if (!adapter) { console.error('no adapter'); process.exit(2); }
  const items = [
    { id: '1', text: 'Привет мир', item: { i: 1 } },
    { id: '2', text: 'Hello world', item: { i: 2 } },
    { id: '3', text: 'Добро пожаловать', item: { i: 3 } },
  ];
  const res = await adapter.search('мир', items, { limit: 3 });
  console.log(JSON.stringify(res, null, 2));
}).catch(e => { console.error(e?.stack || e); process.exit(1); });
EOF

# 2) запустите контейнер
timeout 60s docker run --rm \
  -e HF_HUB_OFFLINE=1 \
  -e TRANSFORMERS_OFFLINE=1 \
  -e EMBEDDINGS_MODE=onnx-cpu \
  -e EMBEDDINGS_MODEL_PATH=/app/models/encoder.onnx \
  -e EMBEDDINGS_DIM=768 \
  -e EMBEDDINGS_CACHE_DIR=/tmp/.emb \
  -e DATA_DIR=/tmp \
  -e OBSIDIAN_VAULT_ROOT=/tmp/obsidian \
  -v /tmp/emb-selftest.mjs:/tmp/emb-selftest.mjs:ro \
  mcp-task-knowledge:cpu \
  node /tmp/emb-selftest.mjs
```

Ожидаемый вывод — JSON со скорами cosine для трёх строк; «Привет мир» / «Hello world» должны иметь более высокие значения, чем «Добро пожаловать».

### GPU-вариант (опционально)

Если на хосте доступен GPU и поддерживается, соберите и запустите таргет GPU:

```bash
docker buildx build --load -t mcp-task-knowledge:gpu -f Dockerfile --target runtime-onnx-gpu .

docker run --rm -it \
  -e DATA_DIR=/data \
  -e OBSIDIAN_VAULT_ROOT=/data/obsidian \
  -e HF_HUB_OFFLINE=1 \
  -e TRANSFORMERS_OFFLINE=1 \
  -e EMBEDDINGS_MODE=onnx-gpu \
  -e EMBEDDINGS_MODEL_PATH=/app/models/model.onnx \
  -e EMBEDDINGS_CACHE_DIR=/data/.embeddings \
  -v "$PWD/data":/data \
  --gpus all \
  mcp-task-knowledge:gpu
```

Для PowerShell: замените `$PWD` на `%cd%`.

### ONNX CPU self-check (npm)

Быстрый оффлайн self-check пути ONNX (CPU) из готового Docker-образа и встроенной логики адаптера:

```bash
npm run onnx:selfcheck:cpu
```

Ожидаемый вывод (успех):

```text
SELF_CHECK_OK { results: 1 }
```

При ошибке инициализации/поиска будут строки вида:

```text
SELF_CHECK_FAIL: adapter unavailable
# или
SELF_CHECK_ERR: <сообщение об ошибке>
```

Скрипт собирает образ целевого таргета `runtime-onnx-cpu` и запускает однократную проверку внутри контейнера с переменными
окружения `DATA_DIR`, `OBSIDIAN_VAULT_ROOT`, `EMBEDDINGS_MODE=onnx-cpu`. Для подробных логов установите `DEBUG_VECTOR=1`.

## Тестирование

- Установка зависимостей:

```bash
npm install
```

- Запуск тестов (Vitest):

```bash
npm run test
```

### CLI (stdio) e2e: локальный запуск

Для проверки CLI-инструментов `obsidian_import_project` и `obsidian_export_project` через MCP stdio есть отдельные e2e-тесты.

- __ENV по умолчанию (локально)__:
  - `EMBEDDINGS_MODE=none`
  - `DATA_DIR=$(mktemp -d)` или путь к изолированному каталогу
  - `OBSIDIAN_VAULT_ROOT=<путь к временному vault>`, например `.tmp/obsidian`

- __Скрипт запуска только CLI e2e__:

```bash
npm run e2e:cli
```

- __Что покрыто__:
  - `dryRun` для экспорта/импорта
  - `replace` с `confirm: false` (ошибка) и `confirm: true` (успех)
  - `mergeStrategy`: `overwrite` (идемпотентен по состоянию), `append` (создаёт дубликаты), `skip` (ничего нового), `fail` (ошибка при конфликтах)

- __Ссылки на тесты__:
  - `tests/obsidian.export.e2e.cli-server.test.ts`
  - `tests/obsidian.import.e2e.cli-server.test.ts`
  - `tests/obsidian.import.idempotency.e2e.cli-server.test.ts`
  - `tests/obsidian.import.append.exec.e2e.cli-server.test.ts`
  - `tests/obsidian.import.skip.exec.e2e.cli-server.test.ts`

### Пример stdio‑клиента (Node.js)

Ниже приведён минимальный пример запуска stdio‑клиента MCP для вызова `obsidian_import_project` и `obsidian_export_project`.

```ts
// file: examples/stdio-client.ts
import { spawn } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio'

async function main() {
  const cwd = process.cwd()
  const env = {
    ...process.env,
    DATA_DIR: process.env.DATA_DIR || `${cwd}/data`,
    OBSIDIAN_VAULT_ROOT: process.env.OBSIDIAN_VAULT_ROOT || `${cwd}/data/obsidian`,
    EMBEDDINGS_MODE: process.env.EMBEDDINGS_MODE || 'none',
  }

  // 1) старт MCP‑сервера (stdio)
  const server = spawn('node', ['dist/index.js'], {
    cwd: `${cwd}/mcp-task-knowledge`,
    env,
    stdio: 'pipe',
  })

  server.on('exit', (code) => {
    if (code !== null) console.log(`[server] exited with code ${code}`)
  })

  // 2) создание транспорта и клиента
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    cwd: `${cwd}/mcp-task-knowledge`,
    env,
    // Используем уже поднятый процесс — переназначим stdio
    // (альтернатива — позволить транспорту самому запускать процесс командой/аргументами)
    stdio: server.stdio as any,
  })

  const client = new Client({
    name: 'example-stdio-client',
    version: '1.0.0',
    // Минимальные capabilities
    capabilities: {},
  }, transport)

  await client.connect()
  console.log('[client] connected')

  // 3) Вызов obsidian_import_project (dryRun merge)
  const importRes = await client.callTool({
    name: 'obsidian_import_project',
    arguments: {
      project: 'mcp',
      knowledge: true,
      tasks: true,
      dryRun: true,
      strategy: 'merge',
      mergeStrategy: 'overwrite',
    },
  })
  console.log('[import dryRun]', JSON.stringify(importRes, null, 2))

  // 4) Вызов obsidian_export_project (dryRun)
  const exportRes = await client.callTool({
    name: 'obsidian_export_project',
    arguments: {
      project: 'mcp',
      knowledge: true,
      tasks: true,
      dryRun: true,
    },
  })
  console.log('[export dryRun]', JSON.stringify(exportRes, null, 2))

  // 5) Закрытие
  await client.close()
  server.kill('SIGTERM')
}

main().catch((e) => {
  console.error(e?.stack || e)
  process.exit(1)
})
```

Примечания:

- Для деструктивных сценариев (стратегия `replace`) требуется явное подтверждение: `confirm: true`. Без него инструмент вернёт безопасную ошибку.
- Перед запуском убедитесь, что собрана папка `dist/` (`npm run build` в `mcp-task-knowledge/`), а переменные окружения (`DATA_DIR`, `OBSIDIAN_VAULT_ROOT`, `EMBEDDINGS_MODE`) корректно установлены.

## CI/CD (GitLab): self-check, compose-smoke, security

В `.gitlab-ci.yml` настроены две стадии и три ключевых джоба:

- Стадии:
  - `security` — аудит зависимостей.
  - `selfcheck` — проверка работоспособности образов и стенда.

- Джобы:
  - `npm_audit_mcp_task_knowledge` (stage: security)
    - Образ: `node:20-alpine`.
    - Выполняет `npm ci || npm i` и `npm audit --omit=dev --audit-level=critical --json` в `mcp-task-knowledge/`.
    - Пайплайн падает на `critical` уязвимостях.
    - Артефакт: `mcp-task-knowledge/audit.json`.
    - Поддержка `NPM_REGISTRY` (если задана в переменных CI/CD).
  - `trivy_scan_runtime_cpu` (stage: security)
    - Образ/сервис: `docker:27` + `docker:27-dind`.
    - Сборка таргета `runtime-onnx-cpu` через `docker buildx` с поддержкой кэша реестра (`CACHE_IMAGE`) и `NPM_REGISTRY`.
    - Скан: Trivy (`aquasec/trivy`) по Docker‑образу; `--severity CRITICAL --exit-code 1` — пайплайн падает на CRITICAL.
    - Артефакт: `mcp-task-knowledge/trivy-runtime-cpu.sarif` (формат SARIF), `expire_in: 1 week`.
  - `selfcheck_onnx_cpu` (stage: selfcheck)
    - Образ/сервис: `docker:27` + `docker:27-dind`, привилегированный режим.
    - Включён BuildKit: `DOCKER_BUILDKIT=1`, `BUILDKIT_PROGRESS=plain`.
    - Переменные: `CACHE_IMAGE="$CI_REGISTRY_IMAGE/mcp-task-knowledge:buildcache-onnx-cpu"` (registry cache).
    - Логин в `$CI_REGISTRY` выполняется автоматически.
    - Скрипт: `bash mcp-task-knowledge/scripts/onnx_cpu_selfcheck.sh` (сборка `runtime-onnx-cpu` + одноразовый self-check). Успех: `SELF_CHECK_OK`.
  - `compose_smoke` (stage: selfcheck, зависит от selfcheck_onnx_cpu)
    - Разогрев кэша: предварительная сборка `runtime-onnx-cpu` через `buildx` с `--cache-from/--cache-to`.
    - Запуск: `scripts/compose_smoke.sh --down` (поднимает `service-catalog + MCP`, ждёт health и гоняет `scripts/smoke_catalog.sh`).
    - Артефакты: `compose-logs.txt` с `docker compose logs --tail=300` при падении.

  - `e2e_cli_mcp_task_knowledge` (stage: selfcheck)
    - Образ: `node:20-alpine`.
    - ENV: `EMBEDDINGS_MODE=none` (по умолчанию в job), изолированные каталоги для `DATA_DIR` и `OBSIDIAN_VAULT_ROOT` создаются через `mktemp -d` в рантайме.
    - Шаги: `cd mcp-task-knowledge && npm ci || npm i && npm run build && npm run e2e:cli`.
    - Скрипт `npm run e2e:cli` выполняет `scripts/e2e_cli.sh`, который находит все `tests/*.cli-server.test.ts` и передаёт их Vitest (`vitest run`).
    - Покрытие: e2e сценарии для `obsidian_import_project`/`obsidian_export_project`, включая `dryRun`, `replace` с `confirm true/false` и `mergeStrategy` `overwrite|append|skip|fail`.

  - `bulk_smoke_local` (stage: selfcheck)
    - Образ: `node:20-alpine` (без Docker/DinD).
    - Переменные окружения:
      - `APP_DIR="$CI_PROJECT_DIR/mcp-task-knowledge"`
      - `CURRENT_PROJECT=mcp`
      - `EMBEDDINGS_MODE=none`
      - `DATA_DIR=$(mktemp -d)`
    - Шаги:
      - MCP:
        - `cd mcp-task-knowledge && npm ci || npm i && npm run build`
        - `node scripts/smoke_tasks.mjs`
        - `node scripts/smoke_knowledge.mjs`
        - `node scripts/smoke_tasks_aliases.mjs`
      - Service Catalog:
        - `cd ../service-catalog && npm ci || npm i && npm run build`
        - старт `node dist/server.js` в фоне, ожидание `GET /api/health == 200`
        - `bash scripts/smoke.sh`
        - остановка процесса по `server.pid`
    - Артефакты: `service-catalog/server.log` (сохраняется `when: always`).

- Глобальные переменные/настройки:
  - `DOCKER_HOST=tcp://docker:2375`, `DOCKER_TLS_CERTDIR=""`, `DOCKER_DRIVER=overlay2` (для DinD).
  - `DOCKER_BUILDKIT=1` и `BUILDKIT_PROGRESS=plain` для наглядных логов сборки.
  - `NPM_REGISTRY` (опционально) — переопределение реестра npm как для `npm audit`, так и для docker‑сборок (`--build-arg NPM_REGISTRY=...`).
  - `CACHE_IMAGE` — ссылка на образ‑кэш BuildKit в реестре (по умолчанию вычисляется от `$CI_REGISTRY_IMAGE`).

Запуск происходит на push/MR по правилам файла CI; все джобы доступны и вручную. В логах `selfcheck_onnx_cpu` должен быть `SELF_CHECK_OK { results: 1 }`.

## Кэш эмбеддингов (LRU + диск)

В рантайме используется кэш эмбеддингов `EmbeddingsCache`:

- В памяти: LRU с лимитом по памяти.
- На диске (опционально): бинарные `.bin` + метаданные `.json` на запись/чтение между рестартами.

Переменные/настройки:

- `EMBEDDINGS_CACHE_DIR` — директория для дискового кэша. По умолчанию `DATA_DIR/.embeddings`.
- `EMBEDDINGS_MEM_LIMIT_MB` — лимит памяти LRU (default: 128).
- `EMBEDDINGS_PERSIST` — вкл/выкл дисковую персистентность (`true` по умолчанию).

Механика:

- Ключ кэша — `id`, в метаданных хранится `hash` текста и `dims`.
- При чтении проверяется совпадение `hash` и размерности; иначе пропуск.
- `hash` строится от текста (стабильная djb2), что исключает рассинхронизацию при изменении контента.

Что покрыто базовыми тестами:

- Негативные сценарии конфигурации в `src/config.ts` и `loadCatalogConfig()`:
  - Ошибка при отсутствии `DATA_DIR`.
  - `OBSIDIAN_VAULT_ROOT` по умолчанию `/data/obsidian` (можно переопределить переменной или конфигом).
  - Fallback `EMBEDDINGS_MODE` на `none` при некорректных оннх‑параметрах.
  - Fallback каталога на `embedded`, если `remote` без `baseUrl`.

### MCP Tools: project_list

Перечисляет доступные проекты, сканируя каталоги `tasks/` и `knowledge/`.

Пример ответа:

```json
{
  "ok": true,
  "data": {
    "current": "mcp",
    "default": "mcp",
    "count": 1,
    "projects": [
      {
        "id": "mcp",
        "isDefault": true,
        "isCurrent": true,
        "paths": {
          "tasks": "/data/tasks/mcp",
          "knowledge": "/data/knowledge/mcp"
        },
        "hasTasks": true,
        "hasKnowledge": true
      }
    ]
  }
}
```

## Makefile: быстрые цели

Основные цели для сборки образов (включая buildx) и управления стендом через docker compose:

```bash
# buildx: загрузить образы в локальный docker
make docker-buildx-bm25
make docker-buildx-cpu
make docker-buildx-gpu

# compose: локальный стенд service-catalog + MCP и smoke-тесты
npm run compose:smoke              # поднимет стек, дождётся health и выполнит scripts/smoke_catalog.sh
CATALOG_BASE_URL=http://localhost:42056 npm run compose:smoke
npm run compose:smoke -- --down    # после smoke остановит и удалит контейнеры/тома

# docker compose helpers
make compose-up           # foreground
make compose-up-detach    # -d --build
make compose-rebuild      # rebuild + ps + tail logs
make compose-ps
make compose-logs
make compose-down

# быстрый переключатель режима эмбеддингов в compose
make up-cpu   # правит EMBEDDINGS_MODE на onnx-cpu и делает up -d --build
make up-gpu   # правит EMBEDDINGS_MODE на onnx-gpu и делает up -d --build

# оффлайн smoke‑тест эмбеддингов в CPU‑образе
make smoke-embeddings-cpu

### `scripts/purge_tracker.js`

CLI для массового удаления задач и знаний через MCP server stdio client с поддержкой фильтров:

```bash
# Dry-run с фильтрами
DATA_DIR=$(mktemp -d) EMBEDDINGS_MODE=none npm run -s project:purge:tracker -- \
  --project mcp --scope both --dry-run \
  --tasks-status pending,closed \
  --tasks-tags foo,bar \
  --knowledge-types note,spec

# Удалить всё под родителем и его потомков
DATA_DIR=$(mktemp -d) EMBEDDINGS_MODE=none npm run -s project:purge:tracker -- \
  --project mcp --scope tasks --confirm \
  --tasks-parent PARENT_ID --tasks-include-descendants

# Удалить архивные знания с тегом
DATA_DIR=$(mktemp -d) EMBEDDINGS_MODE=none npm run -s project:purge:tracker -- \
  --project mcp --scope knowledge --confirm \
  --include-archived \
  --knowledge-tag obsolete

# Полная очистка (требует подтверждения)
DATA_DIR=$(mktemp -d) EMBEDDINGS_MODE=none npm run -s project:purge:tracker -- \
  --project mcp --scope both --confirm
```

Примечание: начиная с этой версии, инструментарий полного очищения проекта включает в выборку и физическое удаление ЭЛЕМЕНТЫ В КОРЗИНЕ (trashed) по умолчанию. Отдельный флаг для этого не требуется.

#### Флаги фильтрации

- `--include-archived` — включать архивные элементы (по умолчанию `true`)
- `--tasks-status s1[,s2,...]` — фильтр по статусам задач
- `--tasks-tag <tag>` / `--tasks-tags t1[,t2,...]` — фильтр по меткам задач
- `--tasks-parent <id>` + `--tasks-include-descendants` — фильтр по родителю задач
- `--knowledge-tag <tag>` / `--knowledge-tags t1[,t2,...]` — фильтр по меткам знаний
- `--knowledge-type <type>` / `--knowledge-types t1[,t2,...]` — фильтр по типам знаний
- `--knowledge-parent <id>` + `--knowledge-include-descendants` — фильтр по родителю знаний
- Элементы со статусом «в корзине» (trashed) всегда включаются в очистку и будут удалены без дополнительного флага

## Подключение в Windsurf

- Settings → MCP Servers → Add
  - Command: `node`
  - Args: `["dist/index.js"]`
  - Cwd: путь к папке `mcp-task-knowledge`
  - Env: `DATA_DIR` указывает корневую папку данных (например, общий каталог для нескольких проектов)

Альтернатива (Docker):

- Command: `docker`
- Args: `["run","--rm","-i","-e","DATA_DIR=/data","-v","<HOST_DATA>:/data","mcp-task-knowledge"]`

## Инструменты

- tasks_list: `{ project?, status?, tag?, includeArchived? }` — по умолчанию архивные скрыты; укажите `includeArchived: true`, чтобы включить их
- tasks_tree: `{ project?, status?, tag?, includeArchived? }` — возврат иерархии задач по `parentId` (фильтры аналогичны `tasks_list`)
- tasks_get: `{ project, id }` — получить задачу по идентификатору
- tasks_bulk_create: `{ project, items: [{ title, description?, priority?, tags?, links?, parentId? }] }`
- tasks_bulk_update: `{ project, items: [{ id, title?, description?, status?, priority?, tags?, links?, parentId? }] }`
- tasks_bulk_close: `{ project, ids: string[] }`
- tasks_bulk_archive: `{ project, ids: string[] }`
- tasks_bulk_restore: `{ project, ids: string[] }`
- tasks_bulk_trash: `{ project, ids: string[] }`
- tasks_bulk_delete_permanent: `{ project, ids: string[], confirm?, dryRun? }`
- knowledge_bulk_create: `{ project, items: [{ title, content, tags?, source?, parentId?, type? }] }`
- knowledge_bulk_update: `{ project, items: [{ id, title?, content?, tags?, source?, parentId?, type? }] }`
- knowledge_list: `{ project?, tag? }`
- knowledge_tree: `{ project?, includeArchived? }` — иерархия знаний по `parentId`
- knowledge_get: `{ project, id }`
- knowledge_bulk_archive: `{ project, ids: string[] }`
- knowledge_bulk_restore: `{ project, ids: string[] }`
- knowledge_bulk_trash: `{ project, ids: string[] }`
- knowledge_bulk_delete_permanent: `{ project, ids: string[] }`
- project_purge: `{ project?, scope?: "both"|"tasks"|"knowledge", dryRun?, confirm? }` — перечисляет все элементы и удаляет их батчами (до 200). Деструктивно; без `confirm: true` (и если не `dryRun`) вернёт безопасную ошибку.
- search_tasks: `{ project?, query, limit? }`
- search_knowledge: `{ project?, query, limit? }`

#### Detach к корню через parentId: null

Оба bulk‑инструмента поддерживают отвязку элемента к корню, если передать `parentId: null`.

- __Задачи__: `tasks_bulk_update`

```json
{
  "project": "mcp",
  "items": [
    { "id": "task-123", "parentId": null }
  ]
}
```

Примечание: валидация выполняется на уровне стораджа задач. Учитывается существование нового родителя (если задан) и невозможность циклов в дереве.

- __Документы знаний__: `knowledge_bulk_update`

```json
{
  "project": "mcp",
  "items": [
    { "id": "doc-abc", "parentId": null }
  ]
}
```

 Это перемещает документ/задачу на верхний уровень соответствующего дерева.

 Семантика дерева: инструмент `knowledge_tree` трактует документ как корневой, если `parentId` имеет falsy‑значение (`null` или `undefined`). Это поведение покрыто тестами и согласовано со схемой `knowledge_bulk_update` (nullable `parentId`).

 См. покрывающие тесты:

- `tests/knowledge.detach_root.test.ts` — storage‑уровень: `updateDoc(..., { parentId: null })` приводит документ в корень.
- `tests/knowledge.bulk_update.detach.test.ts` — инструмент: `knowledge_bulk_update` с `parentId: null` и проверка через `knowledge_tree`.

### Интроспекция инструментов (tools_list, tool_schema, tool_help)

Интроспекционные инструменты помогают программно обнаруживать доступные инструменты MCP, их входные параметры и получать пример вызова. Все ответы возвращаются в стандартном JSON‑конверте `{ ok, data?, error? }`.

__tools_list__ — получить список зарегистрированных инструментов с метаданными

```
tools_list -> {}

ответ -> {
  "ok": true,
  "data": [
    {
      "name": "tasks_list",
      "title": "List Tasks",
      "description": "List tasks with optional filters",
      "inputKeys": ["project", "status", "tag", "includeArchived"]
    }
  ]
}
```

__tool_schema__ — получить метаданные и пример payload по имени инструмента

```
tool_schema -> { "name": "tasks_list" }

ответ -> {
  "ok": true,
  "data": {
    "name": "tasks_list",
    "title": "List Tasks",
    "description": "List tasks with optional filters",
    "inputKeys": ["project", "status", "tag", "includeArchived"],
    "example": {
      "project": "mcp",
      "status": "pending",
      "tag": "example",
      "includeArchived": false
    }
  }
}
```

__tool_help__ — короткая справка по инструменту с примером вызова

```
tool_help -> { "name": "knowledge_bulk_create" }

ответ -> {
  "ok": true,
  "data": {
    "name": "knowledge_bulk_create",
    "title": "Bulk Create Knowledge Docs",
    "description": "Create many knowledge docs at once (optionally hierarchical via parentId)",
    "exampleCall": {
      "name": "knowledge_bulk_create",
      "params": {
        "project": "mcp",
        "items": [
          {
            "title": "Example Title",
            "content": "Example Content",
            "tags": ["example"],
            "source": "example",
            "parentId": null,
            "type": "note"
          }
        ]
      }
    }
  }
}
```

Замечания:

- __Канонические имена__: интроспекция возвращает только канонические имена инструментов, без алиасов.
- __Генерация примеров__: поля `project` подставляются из текущего контекста проекта, остальные — осмысленные значения по умолчанию.

### Embeddings / Векторный поиск

- embeddings_status: `{}` — показать текущую конфигурацию эмбеддингов (mode, dim, cache, включён ли адаптер)
- embeddings_compare: `{ query: string, texts: string[], limit?: number }` — вычислить косинусное сходство между запросом и списком текстов (используется текущий векторный адаптер)

Пример вызова `embeddings_compare`:

```
embeddings_compare -> {
  "query": "мир",
  "texts": ["Привет мир", "Hello world", "Добро пожаловать"],
  "limit": 3
}

ответ -> [
  { "index": 0, "text": "Привет мир", "score": 0.73 },
  { "index": 1, "text": "Hello world", "score": 0.72 },
  { "index": 2, "text": "Добро пожаловать", "score": 0.54 }
]
```

### Knowledge operations

### Bulk

Примечание: используйте `knowledge_bulk_delete_permanent` для перманентного удаления.

__Archive несколько документов__

```
knowledge_bulk_archive -> {
  "project": "mcp",
  "ids": ["doc-1", "doc-2", "doc-3"]
}
```

__Restore (из trash/архива)__

```
knowledge_bulk_restore -> {
  "project": "mcp",
  "ids": ["doc-1", "doc-2"]
}
```

__Trash (переместить в корзину)__

```
knowledge_bulk_trash -> {
  "project": "mcp",
  "ids": ["doc-4", "doc-5"]
}
```

__Delete (перманентно, осторожно)__

```
knowledge_bulk_delete_permanent -> {
  "project": "mcp",
  "ids": ["doc-z"],
  "confirm": true,
  "dryRun": false
}
```

Примечание: инструмент поддерживает `confirm`/`dryRun` (подтверждение и безопасный предпросмотр).

__Формат ответа (агрегированный)__

```json
{
  "ok": true,
  "data": {
    "count": 3,
    "results": [
      { "id": "doc-1", "ok": true, "data": { /* метаданные */ } },
      { "id": "doc-2", "ok": false, "error": { "message": "Doc not found: mcp/doc-2" } },
      { "id": "doc-3", "ok": true, "data": { /* метаданные */ } }
    ]
  }
}
```

### Embeddings / Векторный поиск

- embeddings_status: `{}` — показать текущую конфигурацию эмбеддингов (mode, dim, cache, включён ли адаптер)
- embeddings_compare: `{ query: string, texts: string[], limit?: number }` — вычислить косинусное сходство между запросом и списком текстов (используется текущий векторный адаптер)

Пример вызова `embeddings_compare`:

```
embeddings_compare -> {
  "query": "мир",
  "texts": ["Привет мир", "Hello world", "Добро пожаловать"],
  "limit": 3
}

ответ -> [
  { "index": 0, "text": "Привет мир", "score": 0.73 },
  { "index": 1, "text": "Hello world", "score": 0.72 },
  { "index": 2, "text": "Добро пожаловать", "score": 0.54 }
]
```

### Service Catalog интеграция (remote/embedded/hybrid)

Доступны инструменты MCP для работы с сервис‑каталогом:

- service_catalog_health: `{}` — проверка источника (remote/embedded) с учётом режима и fallback
- service_catalog_query: параметры запроса каталога:
  - `search?: string`
  - `component?: string`
  - `owner?: string | string[]`
  - `tag?: string | string[]`
  - `domain?: string`
  - `status?: string`
  - `updatedFrom?: string` (ISO)
  - `updatedTo?: string` (ISO)
  - `sort?: string` (например `updatedAt:desc`)
  - `page?: number`, `pageSize?: number (<=200)`

Переменные окружения (или конфиг через `MCP_CONFIG_JSON/--config`) для каталога:

- `CATALOG_MODE`: `embedded | remote | hybrid` (по умолчанию `remote`)
- `CATALOG_PREFER`: `embedded | remote` (при `hybrid`, что пробовать первым; по умолчанию `remote`)
- Embedded:
  - `CATALOG_EMBEDDED_ENABLED=1|0` (по умолчанию `mode===embedded`)
  - `CATALOG_EMBEDDED_PREFIX=/catalog`
  - `CATALOG_EMBEDDED_STORE=memory|file`
  - `CATALOG_EMBEDDED_FILE_PATH=/data/catalog.json` (если `store=file`)
- Remote:
  - `CATALOG_REMOTE_ENABLED=1|0` (по умолчанию `mode===remote`)
  - `CATALOG_REMOTE_BASEURL=http://service-catalog:3001`
  - `CATALOG_REMOTE_TIMEOUT_MS=2000`
- Sync (будущее расширение):
  - `CATALOG_SYNC_ENABLED=1|0`
  - `CATALOG_SYNC_INTERVAL_SEC=300`
  - `CATALOG_SYNC_DIRECTION=remote_to_embedded|embedded_to_remote|none`

Примеры вызовов инструментов:

```
service_catalog_health -> {}

service_catalog_query -> {
  "search": "payments",
  "owner": ["team-a", "team-b"],
  "tag": "critical",
  "status": "active",
  "sort": "updatedAt:desc",
  "page": 1,
  "pageSize": 20
}
```

Ответы возвращаются в JSON‑конверте MCP `{ ok, data?, error? }` в виде текстового контента.

## Экспорт в Obsidian Vault

Экспорт данных проекта в Obsidian vault поддерживается инструментом `obsidian_export_project`.

Требования:

- Переменные окружения:
  - `DATA_DIR` — корень данных (обязательно)
  - `OBSIDIAN_VAULT_ROOT` — папка vault (дефолт: `/data/obsidian`; можно переопределить)
- По умолчанию `project = mcp`, если не указан.

Примеры вызовов:

```
obsidian_export_project -> {}

obsidian_export_project -> {
  "project": "mcp"
}

obsidian_export_project -> {
  "project": "mcp",
  "knowledge": true,
  "tasks": true,
  "strategy": "merge",        // или "replace"
  "confirm": true,              // используется ТОЛЬКО при strategy=replace
  "dryRun": false               // если true — вернуть план без изменений
}
```

Примечания по UX:

- В режиме `merge` подтверждение не требуется.
- В режиме `replace` перед реальным удалением директорий будет проверяться `confirm`. Если `confirm: false`, вернётся ошибка подтверждения.
- `dryRun: true` вернёт план: какие директории будут удалены (в replace) и сколько сущностей будет записано, без каких‑либо изменений на диске.

Параметры и значения по умолчанию (export):

- `project?: string` — по умолчанию `mcp`.
- `knowledge?: boolean` — по умолчанию `true`.
- `tasks?: boolean` — по умолчанию `true`.
- `strategy?: "merge" | "replace"` — по умолчанию `"merge"`.
- `confirm?: boolean` — требуется `true` только при `strategy="replace"`.
- `dryRun?: boolean` — по умолчанию `false` (изменения применяются); `true` — только план без изменений.
- Фильтры (опционально): см. раздел ниже «Фильтры экспорта Obsidian».

Пример ответа dry-run (export):

```json
{
  "ok": true,
  "data": {
    "project": "mcp",
    "strategy": "replace",
    "knowledge": true,
    "tasks": true,
    "plan": {
      "willWrite": { "knowledgeCount": 12, "tasksCount": 7 },
      "willDeleteDirs": ["/data/obsidian/mcp/Knowledge", "/data/obsidian/mcp/Tasks"]
    }
  }
}
```

Ошибка безопасности при `replace` без подтверждения (export):

```json
{ "ok": false, "error": { "message": "Export replace not confirmed: pass confirm=true to proceed" } }
```

__Import project from Obsidian Vault__

```
obsidian_import_project -> {
  "project": "mcp",
  "knowledge": true,
  "tasks": true,
  "overwriteByTitle": true,     // для merge: обновлять по title (см. mergeStrategy)
  "mergeStrategy": "overwrite", // overwrite|append|skip|fail — стратегия для коллизий по title
  "strategy": "merge",         // или "replace"
  "confirm": true,              // используется ТОЛЬКО при strategy=replace
  "dryRun": true                // план: create/update/delete без изменений
}
```

Примечания по UX:

- `strategy=merge` не требует подтверждения; `overwriteByTitle` по умолчанию true.
- `mergeStrategy` определяет разрешение конфликтов по `title` при `strategy=merge`:
  - `overwrite` — обновлять существующие сущности (update), конфликт засчитывается, но операция разрешается как update.
  - `append` — создавать новые сущности при коллизии (`title` совпал) вместо обновления (create + конфликт учтён).
  - `skip` — пропускать коллизии, создавать/обновлять только неконфликтные элементы.
  - `fail` — при наличии конфликтов импорт аварийно завершается ошибкой (см. пример ниже).
- `strategy=replace` удаляет существующие сущности выбранных категорий — требуется `confirm=true`.
- `dryRun: true` вернёт план: сколько будет удалено (в replace), сколько создастся и обновится по разделам Knowledge/Tasks.

Параметры и значения по умолчанию (import):

- `project?: string` — по умолчанию `mcp`.
- `knowledge?: boolean` — по умолчанию `true`.
- `tasks?: boolean` — по умолчанию `true`.
- `strategy?: "merge" | "replace"` — по умолчанию `"merge"`.
- `overwriteByTitle?: boolean` — в режиме `merge` по умолчанию `true`; в режиме `replace` игнорируется (всегда перезапись, т.к. удаление перед импортом).
- `mergeStrategy?: "overwrite" | "append" | "skip" | "fail"` — по умолчанию `overwrite`.
- `confirm?: boolean` — требуется `true` только для `strategy="replace"`.
- `dryRun?: boolean` — по умолчанию `false` (изменения применяются); `true` — только план без изменений.
- Фильтры (опционально): см. раздел ниже «Фильтры импорта Obsidian».
- Корень vault: `OBSIDIAN_VAULT_ROOT` (по умолчанию `/data/obsidian`).

Структура vault для импорта:

- Knowledge: `OBSIDIAN_VAULT_ROOT/<project>/Knowledge/<type>/**`
  - Для каждой папки внутри `<type>/` импорт ищет `INDEX.md` как «родительский документ».
  - Остальные `*.md` в папке — «листовые» документы (child), их `parentId` указывает на документ из `INDEX.md` (если он есть).
- Tasks: `OBSIDIAN_VAULT_ROOT/<project>/Tasks/**`
  - Для каждой папки импорт ищет `INDEX.md` как «родительскую задачу».
  - Остальные `*.md` — подзадачи в этой папке.

Поддерживаемый фронтматтер (Obsidian → MCP):

- Knowledge (`Knowledge/**`):
  - `title: string` — заголовок (если отсутствует, берётся из имени файла/папки).
  - `type: string` — тип документа (если не указан — берётся из названия ближайшей папки `<type>` под `Knowledge/`).
  - `tags: string[]`
  - `source: string`
  - Содержимое файла (`.md`) импортируется в поле `content`.
- Tasks (`Tasks/**`):
  - `title: string`
  - `status: "pending" | "in_progress" | "completed" | "closed"` (если указан корректно)
  - `priority: "low" | "medium" | "high"` (если указана корректно)
  - `tags: string[]`
  - `links: string[]`
  - Текст из файла импортируется как `description`.

Поведение merge/replace и `overwriteByTitle`:

- `strategy: "merge"` — существующие сущности сохраняются; совпадения по `title` обрабатываются в соответствии с `mergeStrategy` (по умолчанию `overwrite`).
- `overwriteByTitle` (только для `merge`): по умолчанию `true`.
  - `true` — если сущность с таким `title` уже есть, выполняется `update`.
  - `false` — существующие по `title` не обновляются (будут пропущены), создаются только новые.
- `strategy: "replace"` — выбранные категории (`knowledge`/`tasks`) в проекте предварительно удаляются целиком и импортируются заново; флаг `overwriteByTitle` игнорируется. Требуется `confirm=true`.

Dry-run (предпросмотр плана, без изменений):

```json
{
  "ok": true,
  "data": {
    "project": "mcp",
    "strategy": "merge",
    "overwriteByTitle": true,
    "knowledge": true,
    "tasks": true,
    "plan": {
      "deletes": { "knowledge": 0, "tasks": 0 },
      "creates": { "knowledge": 3, "tasks": 2 },
      "updates": { "knowledge": 1, "tasks": 1 }
    }
  }
}
```

Ошибка безопасности при `replace` без подтверждения:

```json
{ "ok": false, "error": { "message": "Import replace not confirmed: pass confirm=true to proceed" } }
```

### Фильтры импорта Obsidian

Импорт поддерживает гибкую фильтрацию. Параметры фильтров передаются на ВЕРХНЕМ уровне входных данных инструмента (без вложенного объекта `filters`).

- `includePaths` / `excludePaths` — фильтрация по путям внутри vault (глоб‑маски/подстроки), например: `"Knowledge/ADR/**"`, `"Tasks/Project/**"`. Исключающие фильтры имеют приоритет.
- `includeTags` / `excludeTags` — массивы тегов. Исключающие имеют приоритет.
- `includeTypes` — типы документов знаний (`Knowledge/**`, frontmatter `type`). Применяется только к знаниям.
- `includeStatus` — статусы задач (только `Tasks/**`): `pending | in_progress | completed | closed`.
- `includePriority` — приоритеты задач (только `Tasks/**`): `low | medium | high`.

Примечания:

- Импорт НЕ поддерживает фильтры по датам (`updatedFrom`/`updatedTo`) и архиву (`includeArchived`). Эти параметры есть только у экспорта.
- При `strategy=replace` в dryRun‑плане для выбранных категорий ожидайте только `deletes` и `creates` (обновлений не будет, так как идет полная замена).

Ограничения импорта:

- Импорт не поддерживает фильтры по датам (`updatedFrom`/`updatedTo`) и архиву (`includeArchived`). Для подобных ограничений используйте экспорт (`obsidian_export_project`).
- Сопоставление выполняется по полю `title`. Несколько сущностей с одинаковым `title` приводят к обновлению первой совпавшей (по текущей реализации storе/индексов).
- Неизвестные поля фронтматтера игнорируются.

Дополнительные примеры вызовов:

```
obsidian_import_project -> {
  "project": "mcp",
  "knowledge": true,
  "tasks": false,
  "strategy": "merge",
  "dryRun": true
}

obsidian_import_project -> {
  "project": "mcp",
  "knowledge": false,
  "tasks": true,
  "strategy": "replace",
  "confirm": true
}

obsidian_import_project -> {
  "project": "mcp",
  "overwriteByTitle": false, // не обновлять существующие по title
  "strategy": "merge"
}
```

Примеры с фильтрами (import):

```
obsidian_import_project -> {
  "project": "mcp",
  "knowledge": true,
  "tasks": true,
  "strategy": "merge",
  "dryRun": true,
  "includePaths": ["Knowledge/ADR/**", "Tasks/Project/**"],
  "excludePaths": ["Knowledge/Drafts/**"]
}

obsidian_import_project -> {
  "project": "mcp",
  "knowledge": true,
  "tasks": false,
  "strategy": "merge",
  "includeTags": ["architecture", "design"],
  "excludeTags": ["secret"],
  "includeTypes": ["adr", "note"]
}

obsidian_import_project -> {
  "project": "mcp",
  "knowledge": false,
  "tasks": true,
  "strategy": "replace",
  "confirm": true,
  "dryRun": true,
  "includeStatus": ["pending", "in_progress"],
  "includePriority": ["high"]
}
```

Результат (импорт): Markdown‑файлы из vault считываются и записываются в внутреннее хранилище MCP (`DATA_DIR`),
с сохранением иерархий (через `INDEX.md`) и поддержкой фронтматтера, указанного выше.

### FAQ/Частые проблемы импорта Obsidian

- __Отсутствует `INDEX.md` в папке__: родительский узел не будет создан/обновлён, но «листовые» файлы `*.md` из папки импортируются как дочерние к верхнему родителю (если он есть).
- __Дублирующиеся `title`__: в `merge` при `overwriteByTitle=true` будет обновлён первый найденный элемент с таким заголовком (по текущей индексации). Рекомендуется уникализировать `title`.
- __Неверные `status`/`priority` у задач__: значения вне множества игнорируются. Поддерживаемые: `status` ∈ {`pending`,`in_progress`,`completed`,`closed`}, `priority` ∈ {`low`,`medium`,`high`}.
- __Пустой или отсутствующий `title`__: берётся из имени файла/папки, после санитаризации (замена недопустимых символов на `_`).
- __Не задан `OBSIDIAN_VAULT_ROOT`__: инструменты вернут ошибку запуска. По умолчанию ожидается `/data/obsidian`.
- __Кодировка__: используйте UTF‑8 без BOM. Неизвестные поля фронтматтера игнорируются.
- __Фильтры__: импорт поддерживает `includePaths`/`excludePaths`, `includeTags`/`excludeTags`, `includeTypes` (только для знаний), `includeStatus`/`includePriority` (только для задач). Фильтры по датам/архиву доступны только в экспорте.

### Шаблоны фронтматтера (готовые примеры)

Примеры полностью совместимы с импортом.

- `Knowledge/ADR/INDEX.md` (родительский документ в разделе ADR):

```markdown
---
title: Архитектурные решения (ADR)
type: adr
tags:
  - architecture
  - decisions
source: internal
---

Сводка архитектурных решений команды. Этот документ является корневым для раздела ADR.
```

- `Knowledge/ADR/record.md` (листовой документ ADR):

```markdown
---
title: ADR-001 Выбор механизма поиска
type: adr
tags:
  - search
  - bm25
source: design-review
---

Решение: на первом этапе используем BM25. При необходимости добавляем векторный адаптер.
Альтернативы: локальные эмбеддинги ONNX (CPU/GPU), внешние API.
Обоснование: простота, скорость, отсутствие внешних зависимостей.
```

- `Tasks/Project/INDEX.md` (родительская задача проекта):

```markdown
---
title: Проект MCP — организация работ
status: in_progress
priority: high
tags:
  - mcp
  - planning
links:
  - https://example.org/roadmap
---

Общая координация работ по проекту MCP: цели, этапы, риски, коммуникации.
```

- `Tasks/Feature/task.md` (конкретная задача):

```markdown
---
title: Добавить dry-run в импорт Obsidian
status: pending
priority: medium
tags:
  - obsidian
  - import
links:
  - kb://mcp/adr-search
---

Описание: реализовать безопасный предпросмотр плана импорта (создания/обновления/удаления) без изменений.
Критерии приёмки: корректные счётчики по Knowledge/Tasks; отсутствие побочных эффектов.
```

### Obsidian roundtrip smoke (npm)

Быстрая проверка экспорта→импорта в временный vault с изоляцией (пишет только в `.tmp/`):

```bash
npm run build
npm run obsidian:smoke
```

Скрипт `scripts/obsidian_roundtrip.mjs`:

- создаёт временные каталоги: `.tmp/obsidian` (vault) и `.tmp/store` (DATA_DIR);
- устанавливает `OBSIDIAN_VAULT_ROOT` и `DATA_DIR` в эти пути;
- сидирует минимальные данные (1 doc + иерархия из 2 задач);
- выполняет `exportProjectToVault(project='mcp', strategy='replace')`;
- проверяет наличие `Knowledge/`, `Tasks/` и `INDEX.md`;
- выполняет `importProjectFromVault(project='mcp', strategy='replace')`;
- валидирует, что в сторе есть документы и задачи.

Ожидаемый вывод при успехе:

```text
OBSIDIAN_ROUNDTRIP_OK {
  project: 'mcp',
  vaultRoot: '<repo>/.tmp/obsidian',
  knowledgeExported: 1,
  tasksExported: 2,
  knowledgeImported: 1,
  tasksImported: 2,
  docsInStore: 1,
  tasksInStore: 2
}
```

Примечания:

- По умолчанию `OBSIDIAN_VAULT_ROOT` = `/data/obsidian` (см. `src/config.ts`), но в smoke переопределяется на `.tmp/obsidian`.
- Для ускорения без эмбеддингов вывод может содержать предупреждение и fallback на `EMBEDDINGS_MODE=none` — это нормальное поведение.

### Фильтры экспорта Obsidian

Экспорт поддерживает гибкую фильтрацию. В `obsidian_export_project` можно задавать фильтры для знаний и задач. Ключевые параметры:

Важно: параметры фильтров передаются на верхнем уровне входных данных инструмента (без вложенного объекта `filters`).

- `includeTags` / `excludeTags` — массивы тегов. Исключающие фильтры имеют приоритет над включающими.
- `includeTypes` / `excludeTypes` — типы документов знаний (frontmatter `type`).
- `includeStatus` / `includePriority` — фильтры задач по статусу/приоритету.
- `updatedFrom` / `updatedTo` — ISO‑время для ограничения по обновлениям.
- `includeArchived` — включать архивные сущности.
- `keepOrphans` — сохранять «осиротевшие» узлы (без родителя) при фильтрации.
- `strategy` — `merge` или `replace`.
- `confirm` — обязательно `true` при `strategy=replace`.
- `dryRun` — вернуть план без изменений на диске, удобно для сравнения с фактическим экспортом.

Пример вызова с фильтрами:

```
obsidian_export_project -> {
  "project": "mcp",
  "knowledge": true,
  "tasks": true,
  "strategy": "replace",
  "confirm": true,
  "dryRun": false,
  "includeTags": ["alpha"],
  "excludeTags": ["secret"],
  "includeTypes": ["note", "adr"],
  "excludeTypes": ["draft"],
  "includeStatus": ["pending", "in_progress"],
  "includePriority": ["high"],
  "updatedFrom": "2025-01-01T00:00:00.000Z",
  "updatedTo": "2025-12-31T23:59:59.999Z",
  "includeArchived": false,
  "keepOrphans": true
}
```

См. также live‑скрипт матрицы фильтров и сравнение dryRun vs export:

```bash
npm run obsidian:matrix
```

Ожидаемо, при одинаковых фильтрах количество экспортированных сущностей в dryRun‑плане и фактическом экспорте совпадает. В режиме `replace` всегда требуйте `confirm: true`.

## Smoke‑тесты через MCP‑клиент

Проверить доступность инструментов embeddings можно из любого MCP‑клиента (stdin/stdout):

```text
embeddings_status -> {}

embeddings_compare -> {
  "query": "мир",
  "texts": ["Привет мир", "Hello world", "Добро пожаловать"],
  "limit": 3
}
```

Ожидаемо вернётся JSON с упорядоченными совпадениями и score (cosine similarity).

## Troubleshooting

### GPU

- Требуется NVIDIA Container Toolkit на хосте: nvidia‑драйверы и рабочая команда `nvidia-smi`.
- При запуске контейнера используйте `--gpus all` (для compose это прописано в сервисе при необходимости).
- В `mcp` выставьте `EMBEDDINGS_MODE=onnx-gpu`. Для быстрого переключения: `make up-gpu`.
- Ожидаемые логи при старте MCP: `ORT backend: onnxruntime-node (GPU)` и `Tokenizer ready`.
- Если видите `onnxruntime-web (WASM/CPU)` в GPU‑режиме — GPU не доступен контейнеру:
  - Проверьте версии драйвера/CUDA/`nvidia-container-toolkit`.
  - Убедитесь, что compose/CLI реально пробрасывает GPU (`docker run --gpus all ...`).
  - Проверьте права на `/dev/nvidia*` и профиль seccomp/apparmor.
- Для диагностики внутри контейнера:
  - `node -e "console.log(require('onnxruntime-node').version);"`
  - `ls -l /dev/nvidia*` (должны присутствовать устройства)

### CPU

- При первом запуске возможны загрузки/экспорт моделей — подождите завершения инициализации.
- Если токенайзер не инициализируется — очистите кэш модели и перезапустите: удалите `emb_cache/` и `~/.cache/huggingface/` в контейнере.
- Для ускорения повторных стартов используйте постоянный volume под `DATA_DIR`.

### Compose/ENV (частые ошибки)

- `EMBEDDINGS_MODE` не совпадает с ожидаемым в образе/режиме.
  - В compose переключайте через `make up-cpu` / `make up-gpu`.
  - Проверьте, что строка env в `docker-compose.catalog.yml` действительно изменилась.
- `CATALOG_REMOTE_BASE_URL` неверный: должен указывать на сервис `service-catalog` внутри сети compose, например `http://service-catalog:3001`.
- `DATA_DIR`/`OBSIDIAN_VAULT_ROOT` не смонтированы или указывают на несуществующие папки.
  - Проверьте `-v $(PWD)/.data:/data` и что внутри есть `/data/obsidian`.
- Healthcheck у `service-catalog` падает: убедитесь, что в образе есть `curl` и порт соответствует `app.ts`.
- Конфликт портов на хосте: остановите другой процесс или измените публикацию портов.
- `make up-*` не сработал: цель правит compose-файл `sed`-ом, убедитесь, что формат строки `- EMBEDDINGS_MODE=...` не был изменён вручную.

#### Включение GPU в docker-compose

Добавьте к сервису MCP (пример):

```yaml
services:
  mcp:
    environment:
      - EMBEDDINGS_MODE=onnx-gpu
    deploy:
      resources:
        reservations:
          devices:
            - capabilities: [gpu]
```

Альтернатива (Compose 2.24+):

```yaml
services:
  mcp:
    gpus: all
```

Проверьте на хосте:

```bash
nvidia-smi
docker info | grep -i runtimes
docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu22.04 nvidia-smi
```

Если любой из шагов падает — проблема вне контейнера (драйвер/Toolkit).

## Проекты и сбор данных по разным репозиториям

- Используйте единый `DATA_DIR` для нескольких проектов.
- Для каждого проекта задавайте `project` (неймспейс) — файлы разложатся по папкам.
- Совместимо с Obsidian: содержимое знаний — Markdown с фронтматтером.

По умолчанию проект (неймспейс) — `mcp`. Если параметр `project` не указан, инструменты используют `mcp`.

## Эмбеддинги и разные ИИ-агенты

По умолчанию — BM25 (быстро, без внешних зависимостей). Для улучшения семантического поиска предусмотрен интерфейс адаптера:

- `VectorSearchAdapter` в `src/search/index.ts`
- Можно реализовать плагин, который вычисляет эмбеддинги (локально или через API) и хранит их рядом в `data/`.
- Разные агенты могут использовать общий `DATA_DIR` (и общий кэш эмбеддингов), сохраняя совместимость.

```
embeddings_compare -> {
  "query": "мир",
  "texts": ["Привет мир", "Hello world", "Добро пожаловать"],
  "limit": 3
}

ответ -> [
  { "index": 0, "text": "Привет мир", "score": 0.73 },
  { "index": 1, "text": "Hello world", "score": 0.72 },
  { "index": 2, "text": "Добро пожаловать", "score": 0.54 }
]
```

По умолчанию проект (неймспейс) — `mcp`. Если параметр `project` не указан, инструменты используют `mcp`.

## Переменные окружения

- Обязательные:
  - `DATA_DIR`: путь к каталогу данных.
  - `OBSIDIAN_VAULT_ROOT`: корень Obsidian vault для экспорта.
  - `EMBEDDINGS_MODE`: `none | onnx-cpu | onnx-gpu`.
- Обязательные при `EMBEDDINGS_MODE != 'none'`:
  - `EMBEDDINGS_MODEL_PATH`: путь к `.onnx` модели.
  - `EMBEDDINGS_DIM`: размерность эмбеддинга (число, например `384`).
  - `EMBEDDINGS_CACHE_DIR`: каталог кэша эмбеддингов.
Примечание: Значения по умолчанию не используются. Незаполненные обязательные переменные приводят к ошибке запуска.

## Совместный запуск MCP + Service Catalog (docker-compose)

Файл `docker-compose.catalog.yml` поднимает два сервиса: `service-catalog` (порт 3001) и `mcp`.

Быстрый старт (из директории `mcp-task-knowledge/`):

```bash
docker compose -f docker-compose.catalog.yml up --build
# После поднятия каталог доступен на http://localhost:3001
# MCP общается по stdio (без порта); подключайте его как MCP-сервер в IDE.
```

Проверка каталога локально:

```bash
chmod +x scripts/smoke_catalog.sh
CATALOG_BASE_URL=http://localhost:3001 scripts/smoke_catalog.sh
```

## Частые ошибки и решения

- Bash history expansion: символ `!` внутри инлайновых скриптов в `bash -lc "..."` вызывает ошибку `event not found`.
  - Решение: экранировать `!` как `\!`, либо предварить команду `set +H` (отключить histexpand), либо вынести скрипт в файл и примонтировать в контейнер (`-v /tmp/script.mjs:/tmp/script.mjs:ro`).

- Отсутствует обязательная переменная `OBSIDIAN_VAULT_ROOT`.
  - Решение: задайте `OBSIDIAN_VAULT_ROOT` (например, `/data/obsidian` или `/tmp/obsidian` в self-test).

- Для `EMBEDDINGS_MODE != 'none'` не заданы `EMBEDDINGS_MODEL_PATH`, `EMBEDDINGS_DIM`, `EMBEDDINGS_CACHE_DIR`.
  - Решение: выставить все три переменные; модель `.onnx` доступна в образе по пути `/app/models/encoder.onnx`, размерность можно указать явно (например, `768`).

- Трудно диагностировать инициализацию векторного адаптера.
  - Решение: включите подробные логи `DEBUG_VECTOR=1` и проверьте сообщения о выбранном ORT backend и путях модели/токенизатора.

## Ускоренные extbase-сборки (внешние базовые образы)

Этот репозиторий поддерживает «extbase»-паттерн для быстрых кэшированных пересборок (<60s):

- Для ONNX CPU: базовый образ с node_modules и моделями.
- Для BM25: базовый образ только с production node_modules.

### Шаг 1. Локальный Docker Registry (рекомендуется)

```bash
make registry-up
# при необходимости создайте builder с доступом к 127.0.0.1
make buildx-create-host
```

### Шаг 2. Сборка и публикация базовых образов

- ONNX CPU base (с моделями):

```bash
make docker-buildx-base-onnx-push
# публикуется как localhost:5000/mcp-base-onnx:latest
```

- BM25 base (node_modules):

```bash
make docker-buildx-base-bm25-push
# публикуется как localhost:5000/mcp-base-bm25:latest
```

- GPU base (onnx-gpu с моделями и ORT GPU libs):

```bash
make docker-buildx-base-gpu-push
# публикуется как localhost:5000/mcp-base-onnx-gpu:latest
```

### Шаг 3. Быстрые extbase‑пересборки и бенчмарки

- CPU extbase (без каталога):

```bash
make docker-bench-cpu-extbase \
  NPM_REGISTRY=https://registry.npmjs.org/
```

- CPU extbase (с каталогом):

```bash
make docker-bench-cpu-extbase-cat \
  NPM_REGISTRY=https://registry.npmjs.org/
```

- BM25 extbase (без каталога):

```bash
make docker-bench-bm25-extbase \
  NPM_REGISTRY=https://registry.npmjs.org/
```

- BM25 extbase (с каталогом):

```bash
make docker-bench-bm25-extbase-cat \
  NPM_REGISTRY=https://registry.npmjs.org/
```

- GPU cached (без каталога):

```bash
make docker-bench-gpu-cached \
  NPM_REGISTRY=https://registry.npmjs.org/
```

- GPU extbase (без каталога):

```bash
make docker-bench-gpu-extbase \
  NPM_REGISTRY=https://registry.npmjs.org/
```

- GPU cached (с каталогом):

```bash
make docker-bench-gpu-cached-cat \
  NPM_REGISTRY=https://registry.npmjs.org/
```

- GPU extbase (с каталогом):

```bash
make docker-bench-gpu-extbase-cat \
  NPM_REGISTRY=https://registry.npmjs.org/
```

### Классические cached‑сборки для сравнения

- CPU cached (с каталогом):

```bash
make docker-bench-cpu-cached-cat
```

- BM25 cached (без каталога):

```bash
make docker-bench-bm25-cached-noload
```

- BM25 cached (с каталогом):

```bash
make docker-bench-bm25-cached-cat
```

### Наблюдаемые времена (пример)

- __BM25 cached (no catalog)__: ~35.5s `real`
- __BM25 extbase (no catalog)__: ~0.84s `real`
- __BM25 cached (with catalog)__: ~6.3s `real`
- __CPU cached (with catalog)__: ~28.1s `real`
- __CPU extbase (with catalog)__: ожидается <60s (зависит от кэша и сети)

Подсказки:

- Все цели используют локальный файловый кэш BuildKit: `$(BUILDX_CACHE_DIR)=.buildx-cache`.
- Для extbase‑сборок важны аргументы `BASE_MODELS_IMAGE` (CPU) и `BASE_DEPS_IMAGE` (BM25), в Makefile уже прокинуты на локальный реестр.
- Для воспроизводимости указывайте `NPM_REGISTRY` и держите builder с `network=host` (см. `make buildx-create-host`).

## Лицензия

MIT
