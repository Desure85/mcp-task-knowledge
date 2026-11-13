# ADR-2026-11-13: agent_bootstrap contract (DX-12)

- **Status:** Accepted (design review completed with implementation)
- **Date:** 2026-11-13
- **Related:** DX-13 `briefing`, AA-08 tool profiles, CM-03 server instructions, DX-15 `server_capabilities`

## Context

An agent connecting for the first time sees ~207 tools and a server `instructions` string. It
still has to discover: pass `project`, check `ok`, use CAS, confirm destructive calls, and which
tools are relevant. `briefing` returns **data**; it does not explain **how to use the server**.
DX-15 (`server_capabilities`) is a separate manifest for feature flags/limits.

## Decision

Register one read-only tool `agent_bootstrap({ project? })`.

### Response (additive; names stable)

<!-- doc-test: skip -->

```jsonc
{
  "ok": true,
  "data": {
    "server": {
      "name": "mcp-task-knowledge",
      "version": "1.0.20",
      "toolCount": 207,
      "registryVersion": 42,
      "capabilities": {}
    },
    "project": "mcp",
    "instructions": {
      "format": "markdown",
      "text": "... <= 4096 chars ...",
      "maxChars": 4096
    },
    "tools": {
      "total": 207,
      "recommended": ["briefing", "tasks_list", "..."],
      "disabled": ["memory_temporal_query"]   // recommended but not registered
    },
    "envelope": {
      "ok": "{ok:true,data}",
      "error": "{ok:false,error:{message,code?,hint?}}"
    }
  }
}
```

### Rules

1. **No data.** No task/document/memory content, no counts of user data, no secrets or tokens.
2. **Project-scoped report only**: `project` argument defaults to `CURRENT_PROJECT`; it does not
   read that project's entities.
3. **Static text** describes conventions (project, `ok`, `tools_list`/`tool_schema`, CAS,
   confirmation, no sampling/elicitation). It must stay ≤4096 chars.
4. `recommended` is filtered by actual registry membership; missing entries go to `disabled`
   (profile/feature-flag reality, not an error).
5. Read-only, no side effects, safe pre-auth in an open local deployment; under requireAuth it
   is gated like other data tools.
6. `server_capabilities` (DX-15) is the place for env-flag matrix and limits; `agent_bootstrap`
   only embeds the MCP `SERVER_CAPS` and points to that manifest once it exists.

## Relationship to existing tools

| Tool | Returns |
|---|---|
| `briefing` | current project's open tasks, docs, blockers, counts |
| `agent_bootstrap` | static integration instructions + capability/tool manifest |
| `tools_list` / `tool_schema` | registry catalogue and one tool's schema |
| server `instructions` | short protocol/domain text set at initialize |

## Consequences

- Adds one tool: full count 207, default 205 (+2 dynamic catalog tools).
- Agents can self-configure without copying a wiki page; the text is versioned with the server.
- The tool can go stale if conventions change; the contract test asserts key phrases and limits.
- No model call, no network, no prompt injection surface beyond static text.

## Verification

- `tests/agent-bootstrap.test.ts` — envelope, project override, capability echo, recommended
  filtered by registry, no task-data markers, ≤4096 chars.
- `docs/api-reference.md` regenerated (207 tools).
