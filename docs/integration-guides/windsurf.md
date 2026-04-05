# Windsurf Integration Guide

Guide for connecting `mcp-task-knowledge` to [Windsurf](https://codeium.com/windsurf) (Codeium's AI-powered IDE).

## Prerequisites

- Windsurf IDE (latest version recommended)
- Node.js 18+
- `mcp-task-knowledge` installed globally: `npm install -g mcp-task-knowledge`

## Configuration

### Method 1: Windsurf MCP Settings (recommended)

1. Open Windsurf
2. Go to **Settings → MCP Servers** (or use `Ctrl+Shift+P` → "MCP: Manage Servers")
3. Click **Add Server**
4. Fill in the configuration:

**Server name:** `task-knowledge`

**Command:** `mcp-task-knowledge`

**Environment variables:**

| Key | Value |
|-----|-------|
| `DATA_DIR` | `~/.mcp-task-knowledge` |
| `CURRENT_PROJECT` | `default` |

5. Click **Save** and restart Windsurf

### Method 2: Windsurf config file

Windsurf stores MCP server configuration in `.windsurf/mcp.json` at the project level, or in the global Windsurf config directory.

Create `.windsurf/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "task-knowledge": {
      "command": "mcp-task-knowledge",
      "env": {
        "DATA_DIR": ".windsurf-data",
        "CURRENT_PROJECT": "my-project"
      }
    }
  }
}
```

Add `.windsurf-data/` to your `.gitignore`:

```gitignore
.windsurf-data/
```

### Method 3: npx without global install

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

### Method 4: HTTP transport (shared server)

For multi-agent scenarios where Windsurf and Claude Desktop share the same MCP server:

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

Start the server in a separate terminal:

```bash
MCP_TRANSPORT=http MCP_PORT=3001 \
  DATA_DIR=~/.mcp-task-knowledge \
  npx -y mcp-task-knowledge
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_DIR` | `~/.mcp-task-knowledge` | Storage directory for all data |
| `CURRENT_PROJECT` | `default` | Active project namespace |
| `EMBEDDINGS_MODE` | `none` | `none`, `openai`, `onnx-cpu`, `onnx-gpu` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

## Usage Examples

Windsurf's Cascade AI agent has access to all MCP tools once configured. Here are practical workflows:

### Task Management

**Create a task from chat:**

> "Create a task: redesign the dashboard layout. Priority high, tags: frontend, ui."

**View tasks:**

> "Show me all in-progress tasks."

**Update task status:**

> "Mark the 'database migration' task as completed."

### Task Hierarchy and Dependencies

**Subtasks:**

> "The 'refactor auth module' task needs subtasks: 'extract JWT logic', 'add refresh tokens', 'write tests'. Create them."

**Dependencies:**

> "The 'integration tests' task depends on 'API endpoints' and 'test fixtures'. Set that up."

**Full picture:**

> "Show me the task tree with dependencies. What's on the critical path?"

### Knowledge Base Integration

**Import documentation:**

> "Read `docs/architecture.md` from my project and save it as a knowledge entry with type 'overview'."

**Search:**

> "Search my knowledge base for 'authentication flow'. Show the top 3 results with content."

### Multi-project Workflow

**Project switching:**

> "Switch to project 'mobile-app' and list all tasks."

Windsurf handles project switching via `project_switch` tool automatically.

### Workflow: AI-Assisted Development Cycle

1. **Sprint planning** — "Look at the backlog. Create tasks for this week's sprint based on the roadmap."
2. **Implementation** — "Start the first task. Create subtasks for each file I need to modify."
3. **Context lookup** — "Search knowledge for 'database schema' — I need to check the table structure before coding."
4. **Progress tracking** — "Show me a summary: how many tasks are in_progress vs pending vs blocked?"
5. **Sprint close** — "Archive all completed tasks. Export the remaining as a Mermaid graph."

## Using with Windsurf Cascade

Windsurf Cascade is the built-in AI assistant. The MCP tools appear in Cascade's tool list once the server is connected. Cascade can:

- **Proactively suggest tasks** based on code analysis
- **Update task status** when code changes are committed
- **Reference knowledge entries** to understand project context
- **Generate dependency graphs** before starting complex refactors

Example Cascade prompt:

> "I'm about to refactor the payment module. First, create a task for it with subtasks for each service file. Then search the knowledge base for anything related to 'payment processing' so we have full context."

## Troubleshooting

### Server not appearing in Windsurf

1. Check that the server starts manually: `mcp-task-knowledge`
2. Verify the config file: `cat .windsurf/mcp.json`
3. Restart Windsurf completely (not just reload window)

### Connection drops

Windsurf sometimes respawns MCP servers. If the connection is unstable:

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

Check Windsurf's output panel (View → Output → MCP) for server logs.

### Data not persisting

Ensure `DATA_DIR` points to a writable directory:

```bash
mkdir -p ~/.mcp-task-knowledge
ls -la ~/.mcp-task-knowledge/
```

You should see `tasks/`, `knowledge/`, and `search-index/` directories.

### Performance with large knowledge bases

If you have 1000+ knowledge entries, consider:

```bash
# Use ONNX CPU embeddings for faster search
DATA_DIR=~/.mcp-task-knowledge \
EMBEDDINGS_MODE=onnx-cpu \
mcp-task-knowledge
```

Or configure via JSON:

```json
{
  "mcpServers": {
    "task-knowledge": {
      "command": "mcp-task-knowledge",
      "env": {
        "DATA_DIR": "~/.mcp-task-knowledge",
        "EMBEDDINGS_MODE": "onnx-cpu"
      }
    }
  }
}
```

## Tips

- **Per-repo data**: Use `"DATA_DIR": ".windsurf-data"` to keep task data in the repo (gitignored)
- **Shared data**: Use `"DATA_DIR": "~/.mcp-task-knowledge"` to share across all Windsurf projects
- **HTTP for teams**: Run one HTTP server and connect multiple Windsurf instances to the same endpoint
