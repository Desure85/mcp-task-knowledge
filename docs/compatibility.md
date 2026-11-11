# Client compatibility matrix

> **Updated:** 2026-11-11 (DX-25). Re-check and update this table before every release.

MCP clients differ in transport defaults, config-file layout and UI. This table records what this
repository can actually claim. "Config" means `npx mcp-task-knowledge setup` or
`install-agent` can write the client entry; "Protocol" means a real MCP `initialize` / `tools/list`
was exercised; "Live" means the client UI was opened, connected and used in this environment.

| Client | Config | Protocol | Live | Last checked | Notes |
|--------|--------|----------|------|--------------|-------|
| Claude Desktop | ✓ `setup` | ? | ? | 2026-11-11 | `claude_desktop_config.json` merge is covered by setup tests; GUI not available here |
| Cursor | ✓ `setup` | ? | ? | 2026-11-11 | `.cursor/mcp.json` merge covered by setup tests; GUI not available here |
| Windsurf | ✓ `setup` | ? | ? | 2026-11-11 | `~/.codeium/windsurf/mcp_config.json`; GUI not available here |
| VS Code | ✓ `setup` | ? | ? | 2026-11-11 | `.vscode/mcp.json` (`servers`); GUI not available here |
| Claude Code | ✓ `install-agent --client claude-code` | ? | ✗ | 2026-11-11 | CLI present but session was not logged in (`Not logged in · Please run /login`) |
| OpenCode | ✓ `install-agent --client opencode` | ? | ✗ | 2026-11-11 | Bundle/plugin files installed and hash-verified; no MCP config in the live profile, live plugin load not exercised |

Legend: ✓ verified, ✗ attempted and blocked, ? not exercised in this environment.

## What is verified by tests

- `tests/setup.test.ts` — config merge, backup and idempotence for the setup targets.
- `tests/install-agent.test.ts` — bundle hashes, dry-run, config merge for `opencode`/`claude-code`,
  rollback.
- `tests/protocol-version-e2e.test.ts`, `tests/resource-subscribe.test.ts` — real stdio protocol
  smoke against `dist/index.js`, not a specific GUI.
- `web-ui/e2e/*` — browser UI against the web build; unrelated to third-party MCP clients.

## Honest limit

A client can move from `?` to `✓` only after a real connection from that client's UI/CLI in a
usable authenticated session. File placement and hash checks alone are not marked as protocol or
live support. Re-run this matrix when a client changes its config format; see also
`docs/deployment/install-agent.md` and `docs/getting-started/integrations.md`.
