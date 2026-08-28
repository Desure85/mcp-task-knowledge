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
| `patternsPath` | `~/.omo/memory/patterns.json` | Path to patterns.json (OC-004) |
| `statePath` | `~/.omo/memory/.sync-state.json` | Sync state (hashes) |
| `debounceMs` | `30000` | Debounce delay before sync |
| `enabled` | `true` | Enable/disable plugin |

**How it works:**

1. Agent runs `/remember` → writes fact to `facts.md` (or `patterns.json`)
2. Plugin hook `tool.execute.after` fires
3. Debounce 30s (multiple /remember in 30s → one sync)
4. Parse `facts.md` (## headings) + `patterns.json` (JSON array, OC-004)
5. Hash each entry (title + content)
6. Dedup: search by title, update if exists (OC-003)
7. New/changed entries → `knowledge_bulk_create` via MCP
8. Existing entries → `knowledge_bulk_update` via MCP
9. Update state file with synced hashes

**State file:** `~/.omo/memory/.sync-state.json` tracks which entries have been
synced (by hash). If state is lost, re-sync creates duplicates (OC-003 will fix
this with dedup).

### memory-context.ts (OC-005) — implemented (hybrid mode)

Auto-injects context from memory into each prompt. Uses a hybrid approach:

- `experimental.chat.messages.transform` — extracts query from last user message
- `experimental.chat.system.transform` — injects instruction for agent to search
  and use results as context

**Note:** Full auto-context (plugin calls MCP directly and injects results) requires
either a shared closure between hooks (fragile) or a single hook with access to both
messages and system (not available in current OpenCode Plugin API). Current impl
injects an instruction similar to memory-recall but more specific (per-message vs
per-session).

**Installation:**

```bash
cp extensions/opencode/memory-context.ts ~/.config/opencode/plugins/
```

**Configuration:**

```jsonc
{
  "plugin": [
    ["@mcp-task-knowledge/memory-context", {
      "project": "agent-memory",
      "topK": 5,
      "minScore": 1.0,
      "maxTokensPerEntry": 400,
      "cacheTtlMs": 300000,
      "enabled": true
    }]
  ]
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `project` | `"agent-memory"` | MCP project name |
| `topK` | `5` | Results to retrieve |
| `minScore` | `1.0` | Min relevance score |
| `maxTokensPerEntry` | `400` | Token budget per entry |
| `cacheTtlMs` | `300000` | Cache TTL (5 min) |
| `enabled` | `true` | Enable/disable |
