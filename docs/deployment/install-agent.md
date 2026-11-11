# Installing the agent bundle (AA-07)

`bundle.json` is the manifest for the agent-side components: the MCP server entry (`core`), the
proxy shim, OpenCode plugins, the consolidation command, the draft collector script, and the sync
plugin. Every file entry carries its version, sha256 and client target.

## Commands

```bash
# preview — no writes, no directories
npx -y mcp-task-knowledge@1.0.20 install-agent --client opencode --dry-run

# install into the current home (or --home DIR)
npx -y mcp-task-knowledge@1.0.20 install-agent --client opencode

# Claude Code instead
npx -y mcp-task-knowledge@1.0.20 install-agent --client claude-code

# restore exactly what existed before the install
npx -y mcp-task-knowledge@1.0.20 install-agent --client opencode --rollback
```

The installer is plain Node: no bash, no shelling out, no `npm install` inside the client home.
It requires `--client` (`opencode` or `claude-code`) and accepts `--home`, `--bundle`, `--dry-run`
and `--rollback`.

## Targets

| Client | Config | Components |
|--------|--------|------------|
| OpenCode | `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` → `mcp.mcp-task-knowledge` | `plugins/*.ts`, `command/end-session.md`, `scripts/collect-subagent-drafts.sh`, `~/.local/share/mcp-task-knowledge/proxy/shim.js` |
| Claude Code | `~/.claude.json` → `mcpServers.mcp-task-knowledge` | `~/.claude/commands/end-session.md`, `~/.claude/scripts/collect-subagent-drafts.sh`, shared proxy shim |

The MCP entry uses `npx -y mcp-task-knowledge@<bundle version>`; the package ships `bundle.json` and
`extensions/opencode/`, so an installed npm package contains its own sources.

## Safety

- Every source is hashed before the first write; a mismatch aborts with no target touched.
- Only relative `bundle.json` paths are accepted; `..`, absolute paths and drive letters are rejected.
- Existing files and the client config are backed up under `~/.mcp-task-knowledge/backups/<client>/`.
- A second run discovers identical hashes and prints `no changes`; it does not rewrite files.
- `--rollback` restores every backed-up file and removes files that did not exist.
- The installer copies plugin sources but **does not execute them**. OpenCode/Claude run them as
  the user; review `bundle.json` and the plugins before installing (Z-04 policy applies).

## Limitations

- MCP server resolution/network fetch is delegated to `npx`; the installer does not download or
  verify a tarball.
- The client config is JSON (`opencode.json` / `.claude.json`); an existing JSONC-only OpenCode
  config is not edited.
- Writes are not a single transaction. A crash between file writes leaves a partial install without
  a manifest; re-run the installer to converge.
- Live OpenCode/Claude plugin loading and tracker draft search are not exercised by the unit tests
  (no authenticated agent session in the sandbox); Windows path handling is covered by CI
  `windows-latest` (`install-agent-windows`).
