# Official MCP registry manifest (DX-27)

## Status

`server.json` is prepared and validated locally. **It has not been published** to
`registry.modelcontextprotocol.io`; publishing needs the `mcp-publisher` CLI and a GitHub
login that owns the `io.github.desure85` namespace.

## Files

- `server.json` — schema `2025-12-11`, name `io.github.desure85/mcp-task-knowledge`,
  npm package `mcp-task-knowledge`, stdio transport.
- `package.json` — `mcpName` must equal the manifest name (registry ownership check).
- `scripts/validate-server-json.mjs` / `npm run registry:validate` — offline identity checks:
  schema URL, name shape, description ≤100 chars, semver, version/package drift, `mcpName`,
  GitHub repository, npm/stdin transport.

## Publish (not executed)

```bash
mcp-publisher init                 # or keep the checked-in server.json
mcp-publisher validate
mcp-publisher login github
mcp-publisher publish
```

Prerequisites outside this repo:

1. npm package must be published with the same version **and** carry `mcpName`; the current
   1.0.20 tarball predates this field, so a new patch release is required before publish.
2. GitHub account must own `io.github.desure85`.
3. Registry is in preview; its schema/API may change.

## Limitations

- No live publish, no namespace ownership check, no registry HTTP validation.
- `mcp-publisher validate` may enforce more than the local script; the local script is a
  pre-flight, not a replacement.
- No remote/HTTP transport entry: this manifest advertises stdio only.
- Version stays manually synced with `package.json`; `registry:validate` fails on drift.
