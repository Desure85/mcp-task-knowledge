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

```bash
npm install -g mcp-task-knowledge
mcp-task-knowledge
```

Or via npx:

```bash
npx mcp-task-knowledge
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mcp-task-knowledge": {
      "command": "npx",
      "args": ["mcp-task-knowledge"]
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
| [MCP Tools](docs/features/tools.md) | 100 tools: tasks, knowledge, search, memory, prompts |
| [Agent Memory](docs/features/agent-memory.md) | Extraction, temporal graph, profiles, context assembly |
| [Skills & Rules](docs/features/skills-rules.md) | Skills CRUD, rules engine, workflows |
| [Connectors](docs/features/connectors.md) | GitHub, Jira, Slack, Google Drive, Notion, Linear |
| [OpenCode Plugins](docs/plugins/opencode.md) | memory-recall, memory-sync, memory-extract, memory-dream |
| [Web UI](docs/features/web-ui.md) | Kanban, knowledge editor, prompts, analytics, realtime |
| [Docker & Deployment](docs/deployment/docker.md) | Docker images, compose, GHCR, Kubernetes |
| [API Reference](docs/api-reference.md) | All 100 MCP tools with schemas |
| [Architecture](docs/architecture.md) | System design, ADRs, data flow |
| [Integration Guides](docs/getting-started/integrations.md) | Claude, Cursor, Windsurf, VS Code, OpenCode |

## Features

### Core

- 100 MCP tools across 12 categories
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

## Stats

| Metric | Value |
|--------|-------|
| MCP tools | 100 |
| Tests | 2000+ |
| Coverage | 92.7% |
| Tasks done (BACKLOG) | 181/182 |
| OpenCode plugins | 7 |
| Connectors | 9 |
| Languages | TypeScript, Node.js 20 |

## License

MIT
