# Docker & Deployment

## Quick Start

```bash
docker run -d \
  -e DATA_DIR=/data \
  -e MCP_TRANSPORT=http \
  -e MCP_PORT=3001 \
  -p 3001:3001 \
  -v "$PWD/.data":/data \
  ghcr.io/desure85/mcp-task-knowledge:latest
```

## Docker Images

### Minimal (BM25 search only)

```bash
docker pull ghcr.io/desure85/mcp-task-knowledge:latest
```

### With ONNX CPU embeddings

```bash
docker pull ghcr.io/desure85/mcp-task-knowledge:onnx-cpu
```

### With ONNX GPU embeddings

```bash
docker pull ghcr.io/desure85/mcp-task-knowledge:onnx-gpu
```

## Docker Compose

```yaml
version: '3.8'
services:
  mcp-knowledge:
    image: ghcr.io/desure85/mcp-task-knowledge:latest
    ports:
      - "3001:3001"
    environment:
      DATA_DIR: /data
      MCP_TRANSPORT: http
      MCP_PORT: 3001
      EMBEDDINGS_MODE: onnx-cpu
      CURRENT_PROJECT: mcp
    volumes:
      - ./.data:/data
    restart: unless-stopped

  web-ui:
    build:
      context: .
      dockerfile: web-ui/Dockerfile
    ports:
      - "3000:3000"
    environment:
      NEXT_PUBLIC_MCP_API_URL: http://mcp-knowledge:3001/mcp
    depends_on:
      - mcp-knowledge
    restart: unless-stopped
```

## Kubernetes

### Health Checks

```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 3001
readinessProbe:
  httpGet:
    path: /readyz
    port: 3001
```

### Cluster Scaling

The cluster manager (SCALE-002..005) provides:

- Load balancer with sticky sessions (session affinity by session ID)
- Cluster state synchronization (node registry, session affinity, shard assignments)
- Tool sharding across nodes (by namespace/prefix)
- Auto-scaling (CPU + sessions per node metrics, cooldown-based)

See [Cluster Configuration](../getting-started/configuration.md#cluster) for env vars.

## Building from Source

```bash
docker build -t mcp-task-knowledge .
# ONNX CPU/GPU выбираются target'ом, не build-arg:
docker build --target runtime-onnx-cpu -t mcp-task-knowledge:onnx-cpu .
docker build --target runtime-onnx-gpu -t mcp-task-knowledge:onnx-gpu .
# Холодная сборка с нуля требует предсобранных GHCR-баз
# (mcp-node:20-bullseye и др.); без кеша используйте
# docker compose --profile prod up (pull готового образа).
```

### With embedded service-catalog

```bash
docker build \
  --build-arg SERVICE_CATALOG_GIT=https://github.com/Desure85/service-catalog.git \
  --build-arg SERVICE_CATALOG_REF=main \
  -t mcp-task-knowledge:embedded .
```
