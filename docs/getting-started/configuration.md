# Configuration

## Environment Variables

### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_DIR` | `./data` | Root data directory for all projects |
| `CURRENT_PROJECT` | `mcp` | Default project name |
| `MCP_TRANSPORT` | `stdio` | Transport type: `stdio`, `http`, `tcp`, `unix` |
| `PORT` | `3001` | HTTP/TCP port |
| `HOST` | `0.0.0.0` | Bind address |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `LOG_FORMAT` | `json` | `json` or `pretty` |

### Search & Embeddings

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDINGS_MODE` | `none` | `none`, `onnx-cpu`, `onnx-gpu` |
| `EMBEDDINGS_MODEL` | `Xenova/LaBSE` | HuggingFace model ID |
| `EMBEDDINGS_CACHE_DIR` | `./data/.emb_cache` | Cache directory |
| `EMBEDDINGS_CACHE_SIZE` | `1000` | LRU cache size |
| `BM25_K1` | `1.2` | BM25 k1 parameter |
| `BM25_B` | `0.75` | BM25 b parameter |

### Auth & Security

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | — | JWT signing secret |
| `JWT_ISSUER` | `mcp-task-knowledge` | JWT issuer |
| `JWT_AUDIENCE` | `mcp-clients` | JWT audience |
| `TOKEN_TTL_MS` | `3600000` | Access token TTL (1h) |
| `REFRESH_TOKEN_TTL_MS` | `604800000` | Refresh token TTL (7d) |
| `RATE_LIMIT_RPM` | `60` | Requests per minute per session |
| `TLS_CERT` | — | TLS certificate path |
| `TLS_KEY` | — | TLS private key path |
| `TLS_CA` | — | TLS CA bundle path |

### Obsidian

| Variable | Default | Description |
|----------|---------|-------------|
| `OBSIDIAN_VAULT_ROOT` | — | Obsidian vault root for export/import |
| `OBSIDIAN_DEFAULT_PROJECT` | `mcp` | Default project for Obsidian sync |

### Service Catalog

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVICE_CATALOG_MODE` | `embedded` | `embedded`, `remote`, `hybrid` |
| `SERVICE_CATALOG_URL` | — | Remote catalog URL (for remote/hybrid) |

### Cluster

| Variable | Default | Description |
|----------|---------|-------------|
| `CLUSTER_NODE_ID` | auto | Node identifier |
| `CLUSTER_HEARTBEAT_MS` | `10000` | Heartbeat interval |
| `CLUSTER_MAX_SESSIONS` | `100` | Max sessions per node |
| `CLUSTER_AUTO_SCALE_MIN` | `1` | Min nodes for auto-scaling |
| `CLUSTER_AUTO_SCALE_MAX` | `10` | Max nodes for auto-scaling |

## JSON Configuration

Instead of env vars, use a JSON config file:

```bash
mcp-task-knowledge --config ./config.json
```

```json
{
  "dataDir": "./data",
  "currentProject": "mcp",
  "transport": "http",
  "port": 3001,
  "embeddings": {
    "mode": "onnx-cpu",
    "model": "Xenova/LaBSE"
  },
  "auth": {
    "jwtSecret": "your-secret",
    "tokenTtlMs": 3600000
  },
  "log": {
    "level": "info",
    "format": "json"
  }
}
```

## Data Directories

```
data/
  tasks/<project>/<uuid>.json       — tasks
  knowledge/<project>/<uuid>.md     — knowledge documents
  knowledge/<project>/.versions/    — document version snapshots
  prompts/<project>/sources/        — prompt sources (JSON)
  prompts/<project>/exports/        — prompt exports (markdown, catalog)
  .emb_cache/                       — embedding cache
  .behavioral/                      — behavioral memory data
  .sync-state.json                  — memory sync state
```
