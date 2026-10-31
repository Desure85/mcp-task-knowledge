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

Read [`../DESIGN.md`](../DESIGN.md) before changing anything under `web-ui/`; it is the single style guide
for people and agents. Short version: two independent axes (`mcp.mode`: `light`/`dark`/`system`,
`mcp.theme`: `indigo`/`petrol`/`copper`), values in `app/globals.css`, model in `lib/theme.ts`, primitives in
`components/ui`, WCAG AA gate in `lib/theme.contrast.test.ts`, dev-only showcase at `/design`.
`npm run design:doc` (repo root) refreshes the generated tables in `DESIGN.md`; guards live in
`lib/design-guards.test.ts` and `lib/no-hardcoded-colors.test.ts`.

## Pages

- `/` — Home (overview + links)
- `/login` — Sign in
- `/access` — Session, token and agent setup links
- `/tasks` — Kanban board by the project's statuses (scroll cues, collapsible/hideable columns, transition-aware drag & drop, keyboard “Move to…” menu)
- `/knowledge` — Knowledge list, read-first document view with TOC, Markdown editor
- `/memory` — Facts, temporal history, profiles and memory layers
- `/analytics` — Counters, task distribution and browser-local feedback
- `/graph` — Knowledge graph with two modes (Entities / Facts & entities), collision-free labels, `Show related facts`, focus and search dimming, zoom/pan, legend and an accessible node table
- `/prompts` — Prompt catalog, create form and A/B experiments
- `/projects` — Project isolation, current scope, delete and purge
- `/system` — Live sessions, embeddings and the tools catalog
- `/search` — Unified BM25 + vector search across tasks and knowledge

## API Client

`lib/api-client.ts` — typed wrapper around MCP HTTP transport:

- `api.tasks.list/create/get/update/close`
- `api.knowledge.list/get/exportSingle/bulkCreate/bulkUpdate/bulkTrash`
- `api.memory.factsList/temporalQuery/profileGet/layerList`
- `api.prompts.list/get/update/delete/bulkCreate`
- `api.search.tasks/knowledge`
- `api.projects.list/getCurrent/setCurrent/statuses/transitions`

## Docker (UI-007)

```bash
cd web-ui
docker build -t mcp-task-knowledge-ui .
docker run -p 3000:3000 -e NEXT_PUBLIC_MCP_API_URL=http://host.docker.internal:3001/mcp mcp-task-knowledge-ui
```
