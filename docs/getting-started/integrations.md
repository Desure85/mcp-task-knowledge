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
claude mcp add mcp-task-knowledge node /absolute/path/to/mcp-task-knowledge/dist/index.js
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
2. Add server: `node /absolute/path/to/mcp-task-knowledge/dist/index.js`
3. Set `DATA_DIR` to your preferred data location

## OpenCode

Add to `opencode.json`:

```json
{
  "mcp": {
    "mcp-task-knowledge": {
      "type": "local",
      "command": ["node", "/absolute/path/to/mcp-task-knowledge/dist/index.js"],
      "environment": {
        "DATA_DIR": "/absolute/path/to/data",
        "EMBEDDINGS_MODEL_PATH": "/absolute/path/to/models/gemma-q4/onnx/model_q4.onnx",
        "EMBEDDINGS_DIM": "768",
        "EMBEDDINGS_QUERY_PREFIX": "task: search result | query:",
        "EMBEDDINGS_DOC_PREFIX": "title: none | text:"
      },
      "enabled": true,
      "timeout": 60000
    }
  }
}

> OpenCode uses `environment` (not `env`) and a single `command` array that contains
> both the binary and its arguments.
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

## Do I need an SDK

**No** if you use an existing MCP client — OpenCode, Claude Desktop/Code, Cursor, Windsurf,
VS Code. They speak MCP natively, so integration is a config entry (see above), not code.

**Yes** only when you build your own agent or script that calls the server directly.

### TypeScript

```bash
npm install @modelcontextprotocol/sdk
```

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['/absolute/path/to/mcp-task-knowledge/dist/index.js'],
  env: { ...process.env, DATA_DIR: '/absolute/path/to/data' },
});

const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
const res = await client.callTool({
  name: 'search_knowledge',
  arguments: { query: 'billing', project: 'mcp', limit: 5 },
});
console.log(res.content);

await client.close();
```

### Python

```bash
pip install mcp
```

```python
import asyncio

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main() -> None:
    params = StdioServerParameters(
        command="node",
        args=["/absolute/path/to/mcp-task-knowledge/dist/index.js"],
        env={"DATA_DIR": "/absolute/path/to/data"},
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(
                "search_knowledge", {"query": "billing", "project": "mcp"}
            )
            print(result.content)


asyncio.run(main())
```

### HTTP transport

For one shared server and many clients, start it with `MCP_TRANSPORT=http` and point the
SDK at `http://host:3001/mcp` instead of spawning a stdio process.

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
