# Claude Code Integration Guide

Guide for connecting `mcp-task-knowledge` to [Claude Code](https://claude.ai/claude-code) (Anthropic's CLI coding agent).

## Prerequisites

- Node.js 18+
- `mcp-task-knowledge` installed globally: `npm install -g mcp-task-knowledge`

## Configuration

### Method 1: `~/.claude/settings.json` (recommended)

Add the MCP server to Claude Code's global settings:

```json
{
  "mcpServers": {
    "task-knowledge": {
      "command": "mcp-task-knowledge",
      "env": {
        "DATA_DIR": "~/.mcp-task-knowledge",
        "CURRENT_PROJECT": "default"
      }
    }
  }
}
```

Claude Code reads `~/.claude/settings.json` automatically on startup. The server will be available in all Claude Code sessions.

### Method 2: Project-level `.claude/settings.json`

For project-specific configuration, create `.claude/settings.json` in your project root:

```json
{
  "mcpServers": {
    "task-knowledge": {
      "command": "mcp-task-knowledge",
      "env": {
        "DATA_DIR": ".claude-data",
        "CURRENT_PROJECT": "my-project"
      }
    }
  }
}
```

This stores task data inside the project directory (add `.claude-data/` to `.gitignore`).

### Method 3: npx without global install

If you prefer not to install globally:

```json
{
  "mcpServers": {
    "task-knowledge": {
      "command": "npx",
      "args": ["-y", "mcp-task-knowledge"],
      "env": {
        "DATA_DIR": "~/.mcp-task-knowledge",
        "CURRENT_PROJECT": "default"
      }
    }
  }
}
```

> **Note:** `npx` adds ~1-2 seconds to startup on first run while resolving the package.

### Method 4: HTTP transport (shared server)

For scenarios where multiple Claude Code instances need to share the same server, use HTTP transport:

```json
{
  "mcpServers": {
    "task-knowledge": {
      "type": "sse",
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

Start the server separately:

```bash
MCP_TRANSPORT=http MCP_PORT=3001 \
  DATA_DIR=~/.mcp-task-knowledge \
  npx -y mcp-task-knowledge
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_DIR` | `~/.mcp-task-knowledge` | Directory for storing tasks, knowledge, and index files |
| `CURRENT_PROJECT` | `default` | Active project namespace |
| `EMBEDDINGS_MODE` | `none` | Embedding mode: `none`, `openai`, `onnx-cpu`, `onnx-gpu` |
| `LOG_LEVEL` | `info` | Verbosity: `debug`, `info`, `warn`, `error` |

## Usage Examples

### Task Management in Claude Code

Once connected, Claude Code has access to 60+ MCP tools. Here are example prompts:

**Create a task:**

> "Create a task: implement user authentication with JWT. Set priority to high and tag it as backend, security."

**View and manage tasks:**

> "Show me all pending tasks in my-project. Group them by priority."

**Task hierarchy:**

> "Add a subtask 'set up password hashing' under the authentication task. Then show the full task tree."

**Search across tasks and knowledge:**

> "Search for everything related to 'database connection pooling'. Show tasks and knowledge entries."

**Dependency management:**

> "The 'API endpoints' task depends on 'database schema'. Set that up and show me the dependency graph."

### Project Switching

> "Switch to project 'client-portal' and list all tasks there."

Claude Code will call `project_switch` automatically, and subsequent operations target the new project.

### Knowledge Base

> "I have a markdown file `docs/api-reference.md`. Read it and create a knowledge entry with type 'api'."
>
> "Search the knowledge base for 'rate limiting' and show me the most relevant entries."

### Workflow: Claude Code as Project Manager

Claude Code can act as an intelligent project manager using the task tools:

1. **Planning phase** — "Analyze my codebase and create tasks for the refactor I described."
2. **Execution phase** — "Start the first high-priority task. Create subtasks for the implementation steps."
3. **Review phase** — "Show me the DAG. What's the critical path? What's blocking?"
4. **Cleanup** — "Archive all completed tasks."

## Troubleshooting

### Server not connecting

```bash
# Test the server manually
mcp-task-knowledge

# Should output: MCP server running on stdio
# Press Ctrl+C to stop
```

### Check Claude Code settings

```bash
cat ~/.claude/settings.json | python3 -m json.tool
```

### Permission issues on DATA_DIR

```bash
mkdir -p ~/.mcp-task-knowledge
chmod 700 ~/.mcp-task-knowledge
```

### Enable debug logging

```json
{
  "mcpServers": {
    "task-knowledge": {
      "command": "mcp-task-knowledge",
      "env": {
        "DATA_DIR": "~/.mcp-task-knowledge",
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

Debug output appears in Claude Code's log panel.
