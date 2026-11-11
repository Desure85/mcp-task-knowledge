# Server instructions in `initialize` (CM-03)

The MCP server advertises a short generated `instructions` string in `initialize`. It is built from the
live tool registry (domains and counts), never from a hardcoded list, and is capped at 15 lines.

## What is generated

```text
mcp-task-knowledge: 155 tools across 25 domains.
Workflow: tools_list {search:"..."} to find a name; tool_schema {name} for its input; tools_run {name, params} to call it.
Batch independent calls with tools_batch {items:[{name,params}]} (parallel, no stop flag); tools_run is sequential and supports stopOnError.
Domains: memory 31, tasks 22, project 19, prompts 16, knowledge 15, admin 11, tools 5, dashboard 4, package 4, cluster 3, graph 3, session 3, agents 2, embeddings 2, obsidian 2, profile 2, search 2, tool 2, changes 1, config 1, logs 1, mcp 1, mcp1 1, other 1, packages 1.
Prefer a domain tool when you already know its name; tools_run is for nested or discovered calls.
Search before guessing a tool name; do not invent tools, read the schema first.
```

Counts reflect the stdio registry without catalog tools; the exact text is covered by
`tests/server-instructions.test.ts`, which compares domains against `ctx.toolRegistry`.

## Wiring

- `src/core/server-instructions.ts`: `toolDomains`, `buildServerInstructions`, `setServerInstructions`.
- `src/core/app-container.ts`: generated after registration in `defaultRegistration`.
- Per-session transports (`src/transport/http-transport.ts`, `stream-transport.ts`) and the bridge
  attach the same text to their low-level server.
- The SDK has no public instruction setter, so `setServerInstructions` writes the low-level
  `_instructions` field; covered by a setter test and visible through a real `Client.getInstructions()`.

## Client visibility

Protocol-level visibility is verified with the real SDK client over stdio (155-tool registry,
6 lines). CLI probes in a clean home were not able to reach a configured MCP server:

- `claude -p …` → exit 1, `Not logged in · Please run /login`.
- `opencode run …` → exit 0, `NONE`; it read `.config/opencode/opencode.jsonc` but no server was
  configured, so the model had no instructions to repeat.

CM-03b remains blocked on an authenticated, MCP-connected agent session; CM-03 itself closes on the
protocol contract and records the client limitation rather than claiming model visibility.
