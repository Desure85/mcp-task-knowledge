# Setup links (DX-29) and the bundle

`admin_setup_link` creates a one-time (`~15 min`) link that reveals a markdown document with the
server URL/transport, a scoped token and client config snippets. The link is consumed by the first
`GET /.well-known/mcp-setup/<otp>`; it never installs anything by itself.

## Bundle section

The reveal document now includes a `## Bundle (AA-07)` section with the exact commands:

```bash
npx -y mcp-task-knowledge@1.0.20 install-agent --client opencode --dry-run
npx -y mcp-task-knowledge@1.0.20 install-agent --client opencode
```

The agent runs them explicitly; the link does not auto-apply the bundle. See
[install-agent](../deployment/install-agent.md) for targets, backups, rollback and limitations.
