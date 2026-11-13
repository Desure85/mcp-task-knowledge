# DX-20 single-binary PoC (2026-11-13)

## Environment

- Windows x64, Bun **1.3.13**, Node 24 used only to drive the MCP smoke client.
- Source entry `src/index.ts`; compiled with `bun build --compile`.
- Repo `master` at `8f06ec5` (after MU-06).

## Build

```bash
bun build --compile --outfile .tmp/dx20/mcp-task-knowledge.exe src/index.ts
```

Result (one run, this machine):

| Metric | Value |
|---|---|
| Modules bundled | 1003 |
| Bundle time | 6.4 s |
| Compile time | 1.3 s |
| Binary size | 117.8 MB |
| External runtime | none observed for startup |
| Files next to binary | none |

## Smoke test

Spawned the `.exe` with `MCP_TRANSPORT=stdio`, `EMBEDDINGS_MODE=none`, a fresh `DATA_DIR`,
and sent one `initialize` request (`protocolVersion: 2025-06-18`). The process answered:

- `serverInfo.name = mcp-task-knowledge`,
- capabilities: logging, resources (`list/read/subscribe`), tools, prompts,
- instructions text (30 domains, default tool count),
- exit code 0 after our client closed stdin.

No Node installation was used to **run** the binary; `bun` was only the build tool.

## Findings

1. **`serverInfo.version` is `0.0.0`.** `getPackageVersion()` falls back to `0.0.0` because
   the compiled binary cannot read `package.json` from the embedded filesystem (`import.meta.url`
   resolves inside `$bunfs`). A release binary must inject the version at build time
   (Bun `--define` or a generated constant) or embed `package.json`.
2. `better-sqlite3` was **not exercised**: this smoke used the default file profile and
   `EMBEDDINGS_MODE=none`. The 2026-09-12 PoC found its native binding fails under `$bunfs`;
   that path is still unverified and is currently dead code for this PoC.
3. ONNX was **not exercised**. `onnxruntime-node` ships a `.node` addon plus a platform
   `libonnxruntime.so`/`.dll`; the `.node` may be embedded but the shared library is not.
   `EMBEDDINGS_MODE=onnx-cpu` is not claimed to work.
4. No code signing, installer, auto-update or per-platform matrix was produced. The binary is
   a local PoC artifact only and is not committed.

## Verdict

Single-binary delivery is **technically feasible** for the narrow profile
`file storage + EMBEDDINGS_MODE=none`: it starts, speaks MCP and exits cleanly without Node.
It is **not a supported distribution**: version is wrong, SQLite/ONNX paths are unverified,
and only Windows x64 was measured. DX-21 (Homebrew/Scoop manifests) stays blocked until a real
release pipeline exists with injectable version, per-platform builds, checksums and signing.

## Reproduction

```bash
bun build --compile --outfile /tmp/mcp-task-knowledge src/index.ts
DATA_DIR=$(mktemp -d) EMBEDDINGS_MODE=none MCP_TRANSPORT=stdio /tmp/mcp-task-knowledge
# then send one MCP initialize JSON line (the repo's stdio tests show the shape)
```
