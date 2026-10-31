# Web UI for mcp-task-knowledge (UI-001..007)

Next.js 16 App Router + TypeScript. Connects to MCP HTTP transport.

## Setup

```bash
cd web-ui
npm install
npm run dev
```

Set `NEXT_PUBLIC_MCP_API_URL` to point to the MCP server's HTTP transport:

```bash
NEXT_PUBLIC_MCP_API_URL=http://localhost:3001/mcp npm run dev
```

## Signing in

When the MCP server runs with `MCP_TRANSPORT=http` it requires authentication. Configure the server once:

```bash
export JWT_SECRET="$(openssl rand -hex 32)"
export MCP_LOGIN_USER=admin
export MCP_LOGIN_PASSWORD='a-long-random-password'
```

Open the UI: unauthenticated visits redirect to `/login`. The JWT (30 days, `admin` role) lives in
`sessionStorage` for the tab; **Sign out** revokes it on the server (`POST /auth/logout`, the token id goes into
`DATA_DIR/.jwt-revoked.json`, so a copied token stops working too) and drops it from the browser, and a rejected or expired token
sends you back to `/login` automatically. Without `MCP_LOGIN_*` the login endpoint answers 503
(fail-closed, there is no default password).

The **Projects** page manages project isolation; deleting requires a `Dialog` confirmation and purging also requires typing the project id. The **Access** page shows your session, lets you copy your token, and creates one-time
setup links: an agent opens the link once and receives the server URL plus a token limited to the
role and project you chose (default role `agent`, 15 min link lifetime). If agents connect from
another machine, set `NEXT_PUBLIC_MCP_PUBLIC_URL` (or fill the field on the page) to the address they can reach.

### Realtime (live updates)

`next start` proxies HTTP but **not WebSocket upgrades**, so the browser must reach the MCP server's `/ws`
directly. Set it at build time, e.g. `NEXT_PUBLIC_MCP_WS_URL=ws://localhost:3001/ws`. Without it the top bar
shows **Offline** after a few failed attempts and pages keep working without live updates.

When the server requires auth, the client exchanges the stored JWT for a single-use ticket
(`POST /auth/ws-ticket`, JWT in the `Authorization` header) and upgrades with `?ticket=…`. The JWT is never
placed in the WebSocket URL, so it cannot leak into proxy/server access logs or browser console errors.

### Theme and design tokens

The admin UI has two independent theme axes stored in `localStorage`:

- `mcp.mode`: `light`, `dark` or `system` (system follows the OS preference);
- `mcp.theme`: `indigo` (default), `petrol` or `copper`.

An inline script in `app/layout.tsx` applies `data-mode`/`data-theme` before first
paint, so reloads do not flash. Token-migrated pages (UI-24 parts 1–5):
**Tasks, Overview, Access, Login, Knowledge, Memory, Analytics, Graph, Prompts, Projects, System, Search** plus the shell. Tokens live in `app/globals.css`; components must
use semantic utilities (`bg-surface`, `text-ink`, `border-line`, `bg-accent`,
`text-st-done`, …) rather than raw colours. Add a palette to `lib/theme.ts` and
to all six `[data-theme][data-mode]` CSS blocks, then run
`npm run test -- lib/theme.contrast.test.ts` (WCAG AA gate). The dev-only
`/design` route shows every primitive in all six variants.

## Pages

- `/` — Home (overview + links)
- `/login` — Sign in
- `/access` — Session, token and agent setup links
- `/tasks` — Kanban board (4 columns: pending, in_progress, completed, closed)
- `/knowledge` — Knowledge list, read-first document view with TOC, Markdown editor
- `/memory` — Facts, temporal history, profiles and memory layers
- `/analytics` — Counters, task distribution and browser-local feedback
- `/graph` — Entities and temporal facts with legend and accessible node list
- `/prompts` — Prompt catalog, create form and A/B experiments
- `/projects` — Project isolation, current scope, delete and purge
- `/system` — Live sessions, embeddings and the tools catalog
- `/search` — Unified BM25 + vector search across tasks and knowledge

## API Client

`lib/api-client.ts` — typed wrapper around MCP HTTP transport:

- `api.tasks.list/create/get/update/close`
- `api.knowledge.list/get/exportSingle/bulkCreate/bulkUpdate/bulkTrash`
- `api.memory.factsList/temporalQuery/profileGet/layerList`
- `api.search.tasks/knowledge`
- `api.projects.list/getCurrent/setCurrent`

## Docker (UI-007)

```bash
cd web-ui
docker build -t mcp-task-knowledge-ui .
docker run -p 3000:3000 -e NEXT_PUBLIC_MCP_API_URL=http://host.docker.internal:3001/mcp mcp-task-knowledge-ui
```
