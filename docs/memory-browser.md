# Memory Browser & Search (OC-007)

> Browse и search памяти mcp-task-knowledge через web UI.

## Текущее состояние

Obsidian export уже работает (`obsidian_export_project`) — данные можно
просматривать в Obsidian. Но для быстрого browse без Obsidian есть альтернативы:

## Вариант 1: Obsidian Export (уже работает)

```bash
# Экспорт проекта в Obsidian Vault
# Через MCP: obsidian_export_project({ project: 'mcp', strategy: 'merge' })
# Или CLI: npm run obsidian:smoke
```

Плюсы: Markdown + frontmatter, граф зависимостей, search.
Минусы: требует Obsidian installation.

## Вариант 2: HTTP Transport + Web UI

MCP-сервер уже поддерживает HTTP transport (`MCP_TRANSPORT=http`).
Web UI (UI-001..007) будет подключаться к нему напрямую.

```bash
MCP_TRANSPORT=http MCP_PORT=3001 DATA_DIR=~/mcpTrackerData node dist/index.js
```

Затем любой HTTP-клиент может вызывать инструменты:

```bash
# Search knowledge
curl -X POST http://localhost:3001/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"search_knowledge","arguments":{"query":"architecture"}},"id":1}'
```

## Вариант 3: Dev CLI (уже работает, DX-003)

```bash
npm run dev:cli tools     # список инструментов
npm run dev:cli diagnose  # состояние сервера
```

## Рекомендация

Для production — **UI-001 Web UI** (Next.js + HTTP transport).
Для quick browse — **Obsidian export** (уже работает).
Для CLI — **dev:cli** (уже работает).
