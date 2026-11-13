# ADR-2026-11-13: server_capabilities manifest (DX-15)

- **Status:** Accepted
- **Date:** 2026-11-13
- **Related:** DX-12 `agent_bootstrap`, AA-08 tool profiles, CM-03 server instructions

## Context

Feature domains are switched by env/config (`CATALOG_ENABLED`, `MCP_TOOLS_ENABLED`,
`HISTORY_ENABLED`, `STORAGE_INDEX`, …), but an agent only discovers a disabled domain by
calling a tool and getting `tool not found`. `agent_bootstrap` reports MCP capabilities and
recommended tools, not the env-flag matrix or numeric limits.

## Decision

Register one read-only, no-argument tool `server_capabilities`.

### Response

<!-- doc-test: skip -->

```jsonc
{
  "ok": true,
  "data": {
    "server": { "name": "mcp-task-knowledge", "version": "1.0.20", "toolCount": 208, "registryVersion": 13 },
    "capabilities": { /* MCP SERVER_CAPS */ },
    "features": [
      { "id": "tools", "enabled": true },
      { "id": "tool_resources", "enabled": true, "execEnabled": true },
      { "id": "catalog", "enabled": false, "readEnabled": false, "writeEnabled": false },
      { "id": "prompts_build", "enabled": false },
      { "id": "git_history", "enabled": false },
      { "id": "storage_index", "enabled": true, "mode": "auto" }
    ],
    "limits": { "maxPageLimit": 500, "toolsListMax": 300, "agentBootstrapTextMaxChars": 4096 },
    "errorEnvelope": { "ok": "{ok:true,data}", "error": "{ok:false,error:{message,code?,hint?}}" }
  }
}
```

### Rules

1. **No secrets, no paths, no data.** Flag names/values only; never include tokens or DATA_DIR.
2. Every feature entry has `id` + `enabled`; extra flags are domain-specific but stable.
3. Values come from the same config functions the tools use; no duplicated env parsing.
4. `features` is a fixed list, not the full tool catalogue. Unknown future domains are added
   additively; clients must ignore unknown ids.
5. Read-only; no side effects; gated like other data tools under requireAuth.
6. `limits` contains only constants enforced in code (`MAX_LIMIT`, tools page cap, bootstrap
   text cap). If a limit moves, the constant and test move together.

## Why not fold into agent_bootstrap

`agent_bootstrap` is instructions + recommended tools and is cached as text. The flag matrix is
operational state that changes with env and must be inspectable on its own; mixing it would make
the bootstrap text stale more often.

## Verification

- `tests/server-capabilities.test.ts` — version/caps/limits, catalog default off, env flags
  reflected (`CATALOG_ENABLED=1`, `CATALOG_READ_ENABLED=0`, `HISTORY_ENABLED=0`), tools enabled.
- `docs/api-reference.md` regenerated; a row is added to `docs/features/tools.md`.

## Consequences

- One more read tool: 208 total / 206 default.
- Agents can skip disabled domains instead of probing them.
- Only domains wired to an exported config function are reported; auth/cluster/connectors are
  not guessed here.
