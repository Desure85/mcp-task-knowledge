# UI-13 — Knowledge P0: before / after

Reproduced on the pre-fix `master` code and re-shot on the `fix/knowledge-p0` branch.
Viewport 1280×800, Chrome headless (playwright-core).

| File | Scenario | Result before | Result after |
|------|----------|---------------|--------------|
| `before-open-crash.png` | `/knowledge` → click a document | `TypeError: Cannot read properties of undefined (reading 'replace')`, full-page "This page couldn't load" | — |
| `before-search-crash.png` | `/knowledge` → search `zzz` | `TypeError: Cannot read properties of undefined (reading 'toLowerCase')`, same broken page | — |
| `after-open.png` | `/knowledge` → click a document | — | editor opens with the body loaded via `knowledge_get`, no `pageerror` |
| `after-search-empty.png` | `/knowledge` → search `zzz` | — | empty state "Nothing found for “zzz”." with **Clear search**, page stays functional |

Local setup used for the shots (dedicated ports, no dev-stand interference):
server `MCP_TRANSPORT=http MCP_PORT=3411 JWT_SECRET=… node dist/index.js`,
UI `npx next dev --webpack -p 3410` with `MCP_API_URL=http://127.0.0.1:3411`.
