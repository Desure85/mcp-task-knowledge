# MCP Task & Knowledge — VS Code Extension

VS Code companion for the [mcp-task-knowledge](https://github.com/Desure85/mcp-task-knowledge) MCP server. Manage tasks, knowledge base, and prompts directly from the editor.

## Features

- **Task sidebar** — browse tasks grouped by status (pending, in_progress, blocked, completed)
- **Knowledge sidebar** — browse knowledge entries grouped by type
- **Task management** — create, update, close, add subtasks, set dependencies
- **Dependency graph** — visualize DAG with Mermaid, export to markdown
- **Search** — unified search across tasks and knowledge (BM25 + semantic)
- **Status bar** — connection indicator, auto-reconnect
- **Auto-refresh** — configurable polling interval

## Installation

### From Marketplace (when published)

```
ext install desure.mcp-task-knowledge
```

### From VSIX

```bash
cd extensions/vscode
npm run package
code --install-extension mcp-task-knowledge-0.1.0.vsix
```

### Development

```bash
cd extensions/vscode
npm install
npm run compile

# In VS Code:
# 1. Debug → Start Debugging (F5)
# 2. Open Extension Development Host
```

## Configuration

Open VS Code Settings → `mcpTaskKnowledge`:

| Setting | Default | Description |
|---------|---------|-------------|
| `transport` | `stdio` | Transport: `stdio` or `http` |
| `serverCommand` | `npx` | Command to spawn MCP server |
| `serverArgs` | `["-y", "mcp-task-knowledge"]` | Server command arguments |
| `httpUrl` | `http://localhost:3001` | HTTP transport URL |
| `project` | `default` | Default project name |
| `webUIUrl` | `http://localhost:3000` | Web UI dashboard URL |
| `autoRefresh` | `true` | Auto-refresh task list |
| `refreshInterval` | `30` | Refresh interval (seconds) |

## Commands

| Command | Description |
|---------|-------------|
| `MCP: Refresh Tasks` | Reload task list |
| `MCP: Refresh Knowledge` | Reload knowledge list |
| `MCP: Create Task` | Create a new task |
| `MCP: Change Task Status` | Update task status |
| `MCP: Add Subtask` | Add subtask to a task |
| `MCP: Set Task Dependencies` | Configure blocking dependencies |
| `MCP: Add Knowledge Entry` | Add new knowledge document |
| `MCP: Search Tasks & Knowledge` | Full-text search |
| `MCP: Show Dependency Graph` | Visualize DAG |
| `MCP: Export Task Graph (Mermaid)` | Export graph as markdown |
| `MCP: Archive Completed Tasks` | Bulk archive |
| `MCP: Open Web UI` | Open dashboard in browser |
| `MCP: Configure Server Connection` | Open settings |

## Transport Modes

### Stdio (default)

The extension spawns the MCP server as a child process. Requires `npx` and internet access (first run), or a locally installed `mcp-task-knowledge`.

```json
{
  "mcpTaskKnowledge.transport": "stdio",
  "mcpTaskKnowledge.serverCommand": "npx",
  "mcpTaskKnowledge.serverArgs": ["-y", "mcp-task-knowledge"]
}
```

### HTTP

Connect to a running MCP server instance via Streamable HTTP transport.

```json
{
  "mcpTaskKnowledge.transport": "http",
  "mcpTaskKnowledge.httpUrl": "http://localhost:3001"
}
```

Start the server:

```bash
MCP_TRANSPORT=http MCP_PORT=3001 npx -y mcp-task-knowledge
```

## Architecture

```
extensions/vscode/
├── src/
│   ├── extension.ts          # Entry point, activation
│   ├── mcpClient.ts          # MCP SDK client wrapper
│   ├── tasksTreeProvider.ts  # TreeDataProvider for tasks
│   ├── knowledgeTreeProvider.ts # TreeDataProvider for knowledge
│   └── commands.ts           # All command handlers
├── resources/
│   └── icon.svg              # Activity bar icon
├── package.json              # Extension manifest
└── tsconfig.json
```
