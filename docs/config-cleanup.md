# Config Cleanup (OC-008)

> Структурированный JSON-конфиг вместо 20+ env vars.

## Текущее состояние

MCP-сервер поддерживает `--config <path>` и `MCP_CONFIG_JSON` (уже реализовано в `src/config.ts`).
Все env vars могут быть заменены одним JSON-файлом.

## Пример mcp-config.json

```json
{
  "dataDir": "/home/user/mcpTrackerData",
  "currentProject": "mcp",
  "embeddings": {
    "mode": "onnx-cpu",
    "modelPath": "/app/models/encoder.onnx",
    "dim": 768,
    "cacheDir": "/home/user/mcpTrackerData/.embeddings",
    "cacheMemLimitMb": 128,
    "persist": true
  },
  "obsidian": {
    "vaultRoot": "/home/user/obsidian-vault"
  },
  "catalog": {
    "enabled": true,
    "mode": "embedded",
    "prefer": "embedded",
    "readEnabled": true,
    "writeEnabled": false,
    "embedded": {
      "store": "memory",
      "prefix": "/catalog"
    }
  },
  "prompts": {
    "buildEnabled": true
  },
  "transport": {
    "type": "stdio",
    "port": 3001,
    "host": "127.0.0.1"
  },
  "metrics": {
    "enabled": true
  },
  "relay": {
    "enabled": false,
    "sharedKey": ""
  }
}
```

## Использование

```bash
# Через --config
node dist/index.js --config ./mcp-config.json

# Через env (для Docker/CI)
MCP_CONFIG_JSON='{"dataDir":"/data","embeddings":{"mode":"none"}}' node dist/index.js

# Hot reload (DX-004, уже реализовано)
# Через MCP: config_reload({}) — перечитывает конфиг без рестарта
```

## Маппинг env → JSON

| Env var | JSON path |
|---------|-----------|
| `DATA_DIR` | `dataDir` |
| `CURRENT_PROJECT` | `currentProject` |
| `EMBEDDINGS_MODE` | `embeddings.mode` |
| `EMBEDDINGS_MODEL_PATH` | `embeddings.modelPath` |
| `EMBEDDINGS_DIM` | `embeddings.dim` |
| `OBSIDIAN_VAULT_ROOT` | `obsidian.vaultRoot` |
| `CATALOG_ENABLED` | `catalog.enabled` |
| `CATALOG_MODE` | `catalog.mode` |
| `MCP_TRANSPORT` | `transport.type` |
| `MCP_PORT` | `transport.port` |
| `METRICS_ENABLED` | `metrics.enabled` |
| `RELAY_ENABLED` | `relay.enabled` |

## Рекомендация

Использовать `mcp-config.json` для production (git-trackable, структурированный).
Env vars — для Docker/CI (переопределяют JSON).
