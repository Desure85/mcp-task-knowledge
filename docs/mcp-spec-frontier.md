# MCP spec frontier (TR-11)

Status: **policy**. Which parts of the MCP specification the server takes, which it
deliberately does not, and how a new feature gets in.

## Matrix

| Feature | State | Why |
|---|---|---|
| `tools/list` / `tools/call` | **taken** | core product surface |
| `resources/list` / `read` / `templates/list` | **taken** | task/knowledge resources |
| `resources/subscribe` + `notifications/resources/updated` | **taken** | SPEC-06; emitted after mutating tool calls |
| `prompts/list` / `prompts/get` | **taken** (startup snapshot) | prompt library; no runtime list-changed emission |
| `logging/setLevel` | **taken** | maps MCP levels to pino |
| `completion/complete` | **not taken** | removed from both dispatch sets and from `SERVER_CAPS` in SPEC-05: no handler existed, so the server must not intercept or advertise it. Clients get the protocol's method-not-found, not a fake empty completion. |
| `elicitation` | **not taken** | a server-initiated prompt can block/hijack an agent session and has uneven client support. Inputs stay explicit tool arguments; destructive actions use `CONFIRM_REQUIRED`. |
| `sampling` | **not taken** | this server does not call an LLM on the client's behalf; cost, latency and determinism belong to the caller. |
| `roots` | **not taken** | data paths are owned by `DATA_DIR`/env and the storage profile, not by a client-supplied root. Allowing roots would bypass path validation and multi-tenant boundaries. |
| `notifications/tools/list_changed` | **taken** | hot registration and connector init |
| `notifications/prompts/list_changed` | **not advertised as emitted** | prompts are a startup snapshot; SDK may still force `listChanged=true` when the handler is registered (documented caveat in `setup.ts`). |

## Rules for adopting a frontier feature

1. **Capability only with a handler.** Never advertise a capability the server cannot serve.
   The SDK sometimes derives flags from handler registration; verify the actual wire value.
2. **ADR first** for anything that changes the trust boundary (server-initiated prompts,
   client-supplied paths, model calls, background push).
3. **Additive client story**: old clients must keep working with the feature absent. The
   feature is opt-in by client capability, not by a version bump.
4. **Tests**: a live stdio/HTTP test that the capability is advertised, the request is
   handled, and the fallback path works when the client does not support it.
5. **Tracking cadence**: review the MCP changelog at every SDK bump (see SPEC-10); record
   accepted/rejected features in this matrix and the decision file.
6. **No speculative stubs**: an empty handler that returns `{}` is worse than no capability.

## Current known gaps

- `resources/subscribe` is in-memory per server and only notifies tool-driven mutations;
  external file writes do not notify.
- Prompts are a startup snapshot; dynamic prompts need a restart.
- `elicitation`, `sampling`, `roots` are rejected by policy above, not by missing plumbing.

## Why not take everything

Every frontier feature expands what a remote client can make this server do. The product is a
local-first task/knowledge server: predictable files, explicit tool calls, no surprise
prompts or model spend. Rejecting a feature is a decision, not a backlog debt.
