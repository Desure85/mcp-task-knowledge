# OpenCode Plugins

Plugins that integrate mcp-task-knowledge as a memory backend for OpenCode AI agents.

## Installation

```bash
cp extensions/opencode/*.ts ~/.config/opencode/plugins/
```

Plugins auto-load on OpenCode startup. No `opencode.json` registration needed.

## Plugins

### session-draft.ts

Injects self-reflection instructions into system prompt. Agent writes draft entries to `draft-<sessionID>.md` with facts, patterns, warnings, and retrospective.

**Scope:** Project (`<project>/.omo/memory/`) + Global (`~/.omo/memory/`)

### memory-recall.ts

Injects knowledge about the project wiki. Agent knows it can search `facts.md` and `patterns.json` via MCP `search_knowledge` or grep fallback.

**Config:**
```json
{
  "plugin": [["memory-recall", { "project": "agent-memory", "topK": 5, "minScore": 1.0 }]]
}
```

### memory-sync.ts

Auto-syncs `facts.md` → MCP knowledge base after `/remember`. Debounce 30s, dedup by title, dual-scope (project + global).

**Config:**
```json
{
  "plugin": [["memory-sync", { "project": "agent-memory", "debounceMs": 30000 }]]
}
```

### memory-context-v2.ts

Full auto-context injection: extracts query from last user message, calls `search_knowledge` via MCP, injects results into system prompt.

**Config:**
```json
{
  "plugin": [["memory-context-v2", { "topK": 5, "maxTokensPerEntry": 400, "cacheTtlMs": 300000 }]]
}
```

### memory-extract.ts

Auto conversation → fact extraction at end of session. LLM extracts structured facts from transcript → `facts.md` → MCP sync.

### memory-profile.ts

Auto-maintained user profile. On `/remember`, extracts user-specific facts → profile → always-on context injection.

### memory-dream.ts

Background memory refinement (sleep-time compute). Idle detection → dedup/merge/summarise facts → MCP sync.

### session-draft.ts (original)

Injects self-reflection instructions. Agent writes to `draft-<sessionID>.md`.

## collect-subagent-drafts.sh

Script to collect drafts from all subagents of a session:

```bash
~/.config/opencode/scripts/collect-subagent-drafts.sh [session_id] [--list]
```

Searches `opencode.db` for child sessions, finds their draft files, outputs consolidated report.

## Data Flow

```
Agent session
    ↓
session-draft.ts → draft-<sessionID>.md (facts, patterns, warnings)
    ↓
/remember → facts.md, patterns.json
    ↓
memory-sync.ts → MCP knowledge_bulk_create/update (debounced 30s)
    ↓
memory-recall.ts → search_knowledge at session start (instruction)
memory-context-v2.ts → search_knowledge per message (auto-inject)
memory-profile.ts → profile_get/update (always-on context)
memory-dream.ts → background dedup/merge/summarise
    ↓
Next session: agent has accumulated knowledge
```
