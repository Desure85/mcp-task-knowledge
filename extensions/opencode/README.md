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

### memory-sync.ts (OC-002) — implemented

Hook on `tool.execute.after` for `/remember` command → debounced sync (30s) of
`facts.md` into mcp-task-knowledge knowledge base. Direct MCP call via `input.client`.

**Installation:**

```bash
cp extensions/opencode/memory-sync.ts ~/.config/opencode/plugins/
```

**Configuration:**

```jsonc
{
  "plugin": [
    ["@mcp-task-knowledge/memory-sync", {
      "project": "agent-memory",
      "factsPath": "~/.omo/memory/facts.md",
      "debounceMs": 30000,
      "enabled": true
    }]
  ]
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `project` | `"agent-memory"` | MCP project name to sync to |
| `factsPath` | `~/.omo/memory/facts.md` | Path to facts.md |
| `statePath` | `~/.omo/memory/.sync-state.json` | Sync state (hashes) |
| `debounceMs` | `30000` | Debounce delay before sync |
| `enabled` | `true` | Enable/disable plugin |

**How it works:**

1. Agent runs `/remember` → writes fact to `facts.md`
2. Plugin hook `tool.execute.after` fires
3. Debounce 30s (multiple /remember in 30s → one sync)
4. Parse `facts.md` into entries (## headings)
5. Hash each entry (title + content)
6. Compare with state file (`.sync-state.json`)
7. New/changed entries → `knowledge_bulk_create` via MCP
8. Update state file with synced hashes

**State file:** `~/.omo/memory/.sync-state.json` tracks which entries have been
synced (by hash). If state is lost, re-sync creates duplicates (OC-003 will fix
this with dedup).

### memory-context.ts (OC-005)

Hook on `experimental.chat.messages.transform` → extract query from last user message
→ `search_knowledge` top-5 → append compact results to system prompt. Token budget
~2000, query hash cache (TTL 5 min).
