# Getting Started

## Installation

### npm (global)

```bash
npm install -g mcp-task-knowledge
mcp-task-knowledge
```

### npx (no install)

```bash
npx mcp-task-knowledge
```

### Docker

```bash
docker run --rm -it -e DATA_DIR=/data -v "$PWD/.data":/data ghcr.io/desure85/mcp-task-knowledge:latest
```

See [Docker & Deployment](deployment/docker.md) for full options.

### From source

```bash
git clone https://github.com/Desure85/mcp-task-knowledge.git
cd mcp-task-knowledge
npm install
npm run build
npm start
```

## Configuration

See [Configuration](getting-started/configuration.md) for all options.

Minimal setup:

```bash
export DATA_DIR=./data
export CURRENT_PROJECT=mcp
```

## Client Setup

See [Integration Guides](getting-started/integrations.md) for:
- Claude Desktop
- Cursor
- Claude Code
- Windsurf
- VS Code
- OpenCode

## First Steps

1. **Create a project**: `project_set_current` with your project name
2. **Add tasks**: `tasks_create` with title, priority, tags
3. **Add knowledge**: `knowledge_create` with Markdown content
4. **Search**: `search_tasks` or `search_knowledge` (BM25 + vector)
5. **Extract memory**: `memory_extract` from conversation transcripts

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_DIR` | `./data` | Root data directory |
| `CURRENT_PROJECT` | `mcp` | Default project name |
| `MCP_TRANSPORT` | `stdio` | Transport: `stdio` or `http` |
| `EMBEDDINGS_MODE` | `none` | `none`, `onnx-cpu`, `onnx-gpu` |
| `OBSIDIAN_VAULT_ROOT` | — | Obsidian vault path for export |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `LOG_FORMAT` | `json` | `json` or `pretty` |

Full config: [Configuration](getting-started/configuration.md)
