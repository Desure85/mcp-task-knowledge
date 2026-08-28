# OpenCode Plugins for mcp-task-knowledge

OpenCode plugins that integrate `mcp-task-knowledge` as a memory backend for AI agents.

## Plugins

### memory-recall.ts

Auto-injects a system prompt instruction that tells the agent to call `search_knowledge`
(via MCP) at the start of each session — without an explicit `/recall` command.

**Architecture:** Same pattern as `session-draft.ts` — the plugin injects an instruction
into the system prompt; the agent performs the actual MCP call. The plugin does NOT
call MCP directly (OpenCode Plugin API does not expose `ctx.mcp.call`).

**Installation (local file):**

```bash
cp extensions/opencode/memory-recall.ts ~/.config/opencode/plugins/
```

Files in `~/.config/opencode/plugins/` are auto-discovered by OpenCode at startup.
No `opencode.json` registration needed.

**Installation (npm, future):**

```jsonc
// opencode.json
{
  "plugin": ["@mcp-task-knowledge/memory-recall"]
}
```

**Configuration (via opencode.json plugin options):**

```jsonc
{
  "plugin": [
    ["@mcp-task-knowledge/memory-recall", {
      "project": "agent-memory",
      "topK": 5,
      "minScore": 1.0,
      "enabled": true
    }]
  ]
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `project` | `"agent-memory"` | MCP project name to search in |
| `topK` | `5` | Number of results to retrieve |
| `minScore` | `1.0` | Minimum relevance score for injection |
| `enabled` | `true` | Enable/disable plugin |

**Prerequisites:**

- `mcp-task-knowledge` MCP server must be configured in `opencode.json` under `mcp`
- The `search_knowledge` / `mcp1_search_knowledge` tool must be available

**How it works:**

1. Plugin hooks into `experimental.chat.system.transform`
2. On first message of a session, injects `<memory-recall-instructions>` block
3. Agent reads instruction, calls `search_knowledge` with query from user message
4. Results with `score > minScore` are used as context
5. If MCP server is unavailable, agent continues without memory (graceful degradation)

## Planned Plugins

### memory-sync.ts (OC-002)

Hook on `tool.execute.after` for `/remember` command → debounced sync of `facts.md`
into mcp-task-knowledge knowledge base. Direct MCP call via `ctx.client`.

### memory-context.ts (OC-005)

Hook on `experimental.chat.messages.transform` → extract query from last user message
→ `search_knowledge` top-5 → append compact results to system prompt. Token budget
~2000, query hash cache (TTL 5 min).
