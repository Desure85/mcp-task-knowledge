# Homebrew formula / Scoop manifest (DX-21, mock v1)

## Generator

`scripts/gen-package-managers.mjs` turns a release descriptor into:

- `mcp-task-knowledge.rb` — Homebrew formula for macOS arm64/x64 and Linux arm64/x64;
- `mcp-task-knowledge.json` — Scoop manifest for Windows x64.

```bash
node scripts/gen-package-managers.mjs --config release-assets.json --out dist-packages
# or: npm run packages:generate -- --config release-assets.json --out dist-packages
```

Descriptor:

```jsonc
{
  "version": "1.2.3",
  "repository": "https://github.com/Desure85/mcp-task-knowledge",
  "description": "Task and knowledge MCP server",
  "license": "MIT",
  "assets": {
    "darwin-arm64": { "url": "https://.../mcp-task-knowledge-darwin-arm64", "sha256": "..." },
    "darwin-x64":   { "url": "https://.../mcp-task-knowledge-darwin-x64",   "sha256": "..." },
    "linux-arm64":  { "url": "https://.../mcp-task-knowledge-linux-arm64",  "sha256": "..." },
    "linux-x64":    { "url": "https://.../mcp-task-knowledge-linux-x64",    "sha256": "..." },
    "win-x64":      { "url": "https://.../mcp-task-knowledge-win-x64.exe",  "sha256": "..." }
  }
}
```

Validation: semver, GitHub HTTPS repository, 64 lowercase hex SHA-256, HTTPS URLs,
macOS/Linux asset pairs, mandatory Windows asset, unknown asset keys rejected.

## What is not done

- **No release CI wiring**: the generator is not attached to `publish.yml`; it runs manually.
- No actual release assets exist for macOS/Linux/Windows; DX-20 produced only a Windows PoC.
- Formula is not tested with `brew audit`/`brew install`; Scoop manifest is not tested with
  `scoop install`.
- No autoupdate/checkver block, tap repository, code signing/notarization or checksums file.
- `version` comes from the descriptor, not from `package.json`; `0.0.0` binary version
  from DX-20 remains a known issue.
