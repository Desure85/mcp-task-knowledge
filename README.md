# MCP Task & Knowledge

> File-backed MCP server for task management, knowledge base, prompt library, and **agent memory** — for AI agents that need persistent, searchable context across sessions.

[![npm version](https://img.shields.io/npm/v/mcp-task-knowledge.svg)](https://www.npmjs.com/package/mcp-task-knowledge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-2000+-green.svg)](#stats)
[![Coverage](https://img.shields.io/badge/coverage-92%25-green.svg)](#stats)

## What is this

A Model Context Protocol (MCP) server that gives AI agents:

- **Task management** — create, update, close, prioritize, tag, nest, depend (DAG)
- **Knowledge base** — Markdown documents with frontmatter, full-text + vector search
- **Prompt library** — templates, A/B testing, bandit-based variant selection
- **Agent memory** — extraction, temporal graph, user profiles, context assembly, dreaming
- **Skills/Rules/Workflows** — reusable agent harness components
- **Behavioral memory** — intent capture, failure logging, auto-heal, guardrails
- **Web UI** — Kanban board, knowledge editor, analytics, realtime updates

Works with Claude Desktop, Cursor, Claude Code, Windsurf, VS Code, OpenCode, and any MCP-compatible client.

## Quick Start

`DATA_DIR` is required and must be a writable directory: all tasks, knowledge docs,
prompts and the vector cache live there as plain files.

### From source

```bash
git clone https://github.com/Desure85/mcp-task-knowledge.git
cd mcp-task-knowledge
npm install
npm run build

# optional — enables the vector channel; without it the server runs BM25-only
node scripts/fetch-model.mjs gemma-q4

DATA_DIR="$HOME/.mcp-task-knowledge" node dist/index.js
```

The model downloader knows two presets (`node scripts/fetch-model.mjs` lists them):

| Preset | Size | Languages | When |
|---|---:|---|---|
| `gemma-q4` | 198 MB | 100+ | recommended: RU/EN/code mix |
| `labse-int8` | ~120 MB | 100+ | legacy baseline |

The server finds a model placed in `~/.local/share/mcp-task-knowledge/models`,
`$DATA_DIR/models`, `<repo>/models` or `/app/models` without any env variables.

### Docker

```bash
docker run -i --rm -v /data:/data ghcr.io/desure85/mcp-task-knowledge:cpu-cat-latest
```

Images are published as `bm25-*`, `cpu-*` and `gpu-*` variants; the `-cat` suffix means
"catalog enabled".

> **npm:** the package is not published yet, so `npm install -g mcp-task-knowledge` and
> `npx mcp-task-knowledge` fail until a `v*` tag is pushed (see *Releasing* below).

### Releasing (maintainers)

Releases are fully automated via [`.github/workflows/publish.yml`](.github/workflows/publish.yml):

```bash
# 1. Bump version in package.json, commit, push to master
# 2. Cut a version tag matching package.json:
git tag v1.0.21 && git push origin v1.0.21
```

The workflow verifies tag ↔ `package.json` version match, runs build + tests,
publishes to npm with provenance, and pushes a Docker image to GHCR.
Requires the `NPM_TOKEN` repo secret. Never run `npm publish` manually.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mcp-task-knowledge": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-task-knowledge/dist/index.js"],
      "env": {
        "DATA_DIR": "/absolute/path/to/data",
        "EMBEDDINGS_MODEL_PATH": "/absolute/path/to/models/gemma-q4/onnx/model_q4.onnx",
        "EMBEDDINGS_DIM": "768",
        "EMBEDDINGS_QUERY_PREFIX": "task: search result | query:",
        "EMBEDDINGS_DOC_PREFIX": "title: none | text:"
      }
    }
  }
}
```

### Cursor / Windsurf / VS Code

See: [Integration Guides](docs/getting-started/integrations.md)

## Documentation

| Section | Description |
|---------|-------------|
| [Getting Started](docs/getting-started.md) | Installation, configuration, first steps |
| [Configuration](docs/getting-started/configuration.md) | Environment variables, JSON config, embeddings |
| [MCP Tools](docs/features/tools.md) | 116 tools: tasks, knowledge, search, memory, prompts |
| [Agent Memory](docs/features/agent-memory.md) | Extraction, temporal graph, profiles, context assembly |
| [Skills & Rules](docs/features/skills-rules.md) | Skills CRUD, rules engine, workflows |
| [Connectors](docs/features/connectors.md) | GitHub, Jira, Slack, Google Drive, Notion, Linear |
| [OpenCode Plugins](docs/plugins/opencode.md) | memory-recall, memory-sync, memory-extract, memory-dream |
| [Web UI](docs/features/web-ui.md) | Kanban, knowledge editor, prompts, analytics, realtime |
| [Docker & Deployment](docs/deployment/docker.md) | Docker images, compose, GHCR, Kubernetes |
| [API Reference](docs/api-reference.md) | All MCP tools with schemas (generated) |
| [Architecture](docs/architecture.md) | System design, ADRs, data flow |
| [Privacy](docs/privacy.md) | Local-first data manifest, egress points, PII masking |
| [Integration Guides](docs/getting-started/integrations.md) | Claude, Cursor, Windsurf, VS Code, OpenCode |

## Features

### Core

- 116 MCP tools by default (118 with catalog + dynamic tools enabled)
- BM25 + ONNX vector search + hybrid + two-stage rerank
- FTS5 full-text search (SQLite built-in)
- File-based storage (Markdown/JSON, no external DB)
- Obsidian-compatible (import/export)
- 2000+ tests, 92.7% coverage

### Agent Memory (vs Mem0/Zep/Letta/Supermemory)

- Memory extraction pipeline (conversation → facts)
- Temporal knowledge graph (bi-temporal, point-in-time queries)
- User profiles (auto-maintained, always-on context)
- Smart context assembly (RRF fusion, token-budget-aware)
- Entity-linking retrieval (third signal)
- Memory evolution, conflict resolution, automatic forgetting
- Sleep-time/dreaming agent (async refinement)
- Benchmark harness (LOCOMO, LongMemEval, BEAM, DMR)

### Infrastructure

- Multi-transport: stdio, HTTP (Streamable), TCP/Unix
- Auth: JWT, OAuth 2.1 PKCE, ACL, rate limiting
- Security: TLS/mTLS, audit logging, input sanitization
- Cluster: load balancer, sticky sessions, tool sharding, auto-scaling
- Sync: versioning, 3-way merge, event sourcing, E2E durability
- Realtime: WebSocket collaboration, presence, live updates
- Connectors: GitHub, Jira, Slack, Google Drive, Gmail, Notion, OneDrive, Linear, Web Crawler
- Framework adapters: LangGraph, AutoGen, CrewAI, LangChain

## Embeddings & search tuning

The vector channel is optional: without a model the server runs BM25-only and stays fully functional.

### Getting a model

```bash
node scripts/fetch-model.mjs gemma-q4          # into ~/.local/share/mcp-task-knowledge/models
node scripts/fetch-model.mjs gemma-q4 --dir /srv/models
```

The script prints the exact environment block to paste. Without a model the server starts in
BM25-only mode and says so in the log.

### Model choices (ONNX, CPU-friendly)

| Model | Size | Languages | Notes |
|---|---:|---|---|
| `google/embeddinggemma-2` (q4 ONNX) | 198 MB | 100+ | best on mixed RU/EN + code; exposes `sentence_embedding`, needs `image/audio/video_features` inputs fed empty |
| `sergeyzh/BERTA` (int8) | 124 MB | RU + EN | fastest RU-first option, mean pooling |
| `cointegrated/LaBSE-en-ru` | 515 MB | EN + RU | legacy baseline, GPU-safe |

The model file is auto-detected in `/app/models`, `<repo>/models`, `DATA_DIR/models` and
`~/.local/share/mcp-task-knowledge/models`, preferring an EmbeddingGemma bundle over BERTA
and a legacy `encoder.onnx` (LaBSE) — measured on the field/label sets with
`scripts/field-eval.mjs`: 74% vs 67% gold top-1, and 47–78% vs 47–57% per language outside
RU/EN. Set `EMBEDDINGS_AUTODETECT=0` to keep resolution explicit.

Instruction prefixes for EmbeddingGemma are applied automatically when
`EMBEDDINGS_QUERY_PREFIX` / `EMBEDDINGS_DOC_PREFIX` are not set, so an auto-detected model
does not silently run without the prefixes it was trained with. `EMBEDDINGS_DIM` is optional:
an encoder may project to a different width than its backbone config reports
(EmbeddingGemma: 512 → 768), so the adapter uses the real output width.

```bash
EMBEDDINGS_MODE=onnx-cpu
EMBEDDINGS_MODEL_PATH=/path/to/model.onnx
EMBEDDINGS_DIM=768
EMBEDDINGS_QUERY_PREFIX="task: search result | query:"
EMBEDDINGS_DOC_PREFIX="title: none | text:"
```

`EMBEDDINGS_QUERY_PREFIX` / `EMBEDDINGS_DOC_PREFIX` are for models trained with instruction
prefixes (Gemma, BERTA, E5); one trailing space is added automatically. Switching the model file
invalidates the vector cache by itself (keys include the model identity).

Pooling is read from the model's `1_Pooling/config.json` when present (Granite ships CLS
pooling; models with a `sentence_embedding` output use it, others fall back to masked mean).
Force it with `EMBEDDINGS_POOLING=cls|mean|model` if a model ships no pooling config.

### GPU

`EMBEDDINGS_MODE=onnx-gpu` uses onnxruntime-node's CUDA provider. Some GPU/driver combinations fail
on specific ops (known case: cuDNN `ReduceL2` on Pascal cards). The adapter runs a warm-up inference
and automatically falls back to CPU with a warning instead of leaving search without vectors.

### Background indexing

Knowledge docs are indexed in the background, not inside the first search: startup warms
the current project, knowledge writes trigger a debounced re-index, and
`project_set_current` warms the project it switches to. After warmup the first
`search_knowledge` is a normal query (~100 ms for 146 docs on CPU) instead of a full
indexing pass (~40 s).

| Variable | Default | Meaning |
|---|---|---|
| `EMBEDDINGS_WARMUP` | on | `0` disables background indexing |
| `EMBEDDINGS_WARMUP_BUDGET_MS` | `180000` | max warmup time per project; `0` = unlimited |
| `EMBEDDINGS_WARMUP_PROJECTS` | `current` | `all` warms every project |

Progress is visible in `embeddings_status.warmup` (`state`, `indexed`, `total`, `reason`).
When the budget runs out, the remainder is indexed on demand by the next search.

### Lexical channel

BM25 ignores stops words (built-in EN/RU list plus `DATA_DIR/stopwords.txt` and `BM25_STOPWORDS`),
splits camelCase/snake_case identifiers, and drops query terms whose IDF is below
`BM25_MIN_IDF_RATIO` (default `0.2`) of the strongest term. Lexical hits below
`BM25_MIN_CONFIDENCE` (default `0.05`) of the query's maximum achievable BM25 score do not participate
in fusion. Both channels are merged with Reciprocal Rank Fusion, so a document found only by the
semantic channel can outrank a weak lexical match.

## Stats

| Metric | Value |
|--------|-------|
| MCP tools | 100 |
| Tests | 2000+ |
| Coverage | 92.7% |
| Tasks done (BACKLOG) | 181/182 |
| OpenCode plugins | 7 |
| Connectors | 9 |
| Languages | TypeScript, Node.js 24 |

## License

MIT
