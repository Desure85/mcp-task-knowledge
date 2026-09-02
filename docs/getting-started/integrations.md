# Integration Guides

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

With HTTP transport:

```json
{
  "mcpServers": {
    "mcp-task-knowledge": {
      "command": "npx",
      "args": ["mcp-task-knowledge"],
      "env": {
        "MCP_TRANSPORT": "http",
        "PORT": "3001"
      }
    }
  }
}
```

## Cursor

Add to `.cursor/mcp.json` in your project:

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

## Claude Code

```bash
claude mcp add mcp-task-knowledge npx mcp-task-knowledge
```

Or use the Claude Code plugin export:

```bash
# Export skills/rules as Claude Code plugin
# Via MCP tool: exportClaudeCodePlugin
```

## Windsurf

Add to Windsurf MCP settings:

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

## VS Code

Install the VS Code extension from the marketplace, or:

1. Open Settings → MCP
2. Add server: `npx mcp-task-knowledge`
3. Set `DATA_DIR` to your preferred data location

## OpenCode

Add to `opencode.json`:

```json
{
  "mcp": {
    "mcp-task-knowledge": {
      "type": "local",
      "command": ["npx", "mcp-task-knowledge"],
      "enabled": true
    }
  }
}
```

### OpenCode Plugins

Install plugins for automatic memory recall and sync:

```bash
cp extensions/opencode/memory-recall.ts ~/.config/opencode/plugins/
cp extensions/opencode/memory-sync.ts ~/.config/opencode/plugins/
cp extensions/opencode/memory-extract.ts ~/.config/opencode/plugins/
cp extensions/opencode/memory-context-v2.ts ~/.config/opencode/plugins/
cp extensions/opencode/memory-profile.ts ~/.config/opencode/plugins/
cp extensions/opencode/memory-dream.ts ~/.config/opencode/plugins/
```

See [OpenCode Plugins](../plugins/opencode.md) for details.

## Docker

```bash
docker run -d \
  -e DATA_DIR=/data \
  -e MCP_TRANSPORT=http \
  -e PORT=3001 \
  -p 3001:3001 \
  -v "$PWD/.data":/data \
  ghcr.io/desure85/mcp-task-knowledge:latest
```

Connect clients to `http://localhost:3001/mcp`.
