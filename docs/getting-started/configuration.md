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
| `TLS_CERT_PATH` | — | TLS certificate path (enables HTTPS/TLS TCP when set with `TLS_KEY_PATH`) |
| `TLS_KEY_PATH` | — | TLS private key path |
| `TLS_CA_PATH` | — | TLS CA bundle path (client cert verification / mTLS) |
| `TLS_REQUEST_CERT` | `false` | Request client certificate (mTLS) |
| `TLS_REJECT_UNAUTHORIZED` | `true` | Reject unauthorized client certs |
| `TLS_MIN_VERSION` | `TLSv1.2` | Minimum TLS version |
| `TLS_HOT_RELOAD` | `false` | Watch cert/key files and reload on change |

### Webhooks (async jobs)

`memory_extract_async` and other async-job tools accept a `webhookUrl` that is
POSTed with the job result on completion. To prevent SSRF (e.g. posting job
output to `http://169.254.169.254/latest/meta-data/`), the URL is validated
before fetching:

- Only `http:`/`https:` schemes are allowed (`https:` recommended).
- Private/loopback/link-local hosts are blocked: `localhost`, `*.localhost`,
  `*.local`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`,
  `169.254.0.0/16`, `0.0.0.0/8`, `100.64.0.0/10`, IPv6 `::1`, `fc00::/7`,
  `fe80::/10`, and `::ffff:`-mapped private IPv4. Obfuscated IPv4 forms
  (integer/hex/octal) are normalized and blocked.
- At fetch time the hostname is resolved via DNS and blocked if ANY resolved
  address is private (DNS-rebinding defense).

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBHOOK_ALLOWED_HOSTS` | — | Comma-separated exact hostnames that bypass the private-IP block (scheme rules still apply) |
| `WEBHOOK_ALLOW_PRIVATE` | — | Set to `1` to disable private-IP blocking entirely (dev only) |

### Obsidian

| Variable | Default | Description |
|----------|---------|-------------|
| `OBSIDIAN_VAULT_ROOT` | — | Obsidian vault root for export/import |
| `OBSIDIAN_DEFAULT_PROJECT` | `mcp` | Default project for Obsidian sync |

### Backups

Destructive tools (`project_purge`, `tasks_bulk_delete_permanent`,
`knowledge_bulk_delete_permanent`) snapshot the affected scope into
`DATA_DIR/.backups/<timestamp>-<label>/` before executing. Each backup
contains a `manifest.json` with the copied paths, file count and bytes.

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKUP_MAX_MB` | `512` | Size bound per backup; oversized backups still proceed but are flagged `oversized` in the manifest |
| `BACKUP_KEEP` | `20` | How many backups to retain; oldest are rotated out on each new backup |
| `BACKUP_REQUIRED` | `false` | When `1`/`true`, a failed backup aborts the destructive operation instead of only logging a warning |

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
  .backups/<ts>-<label>/            — pre-destructive-op snapshots (DX-19)
  .sync-state.json                  — memory sync state
```
