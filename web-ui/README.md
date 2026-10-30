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
`sessionStorage` for the tab; **Sign out** in the top bar drops it, and a rejected or expired token
sends you back to `/login` automatically. Without `MCP_LOGIN_*` the login endpoint answers 503
(fail-closed, there is no default password).

The **Access** page shows your session, lets you copy your token, and creates one-time
setup links: an agent opens the link once and receives the server URL plus a token limited to the
role and project you chose (default role `agent`, 15 min link lifetime). If agents connect from
another machine, set `NEXT_PUBLIC_MCP_PUBLIC_URL` (or fill the field on the page) to the address they can reach.

## Pages

- `/` — Home (overview + links)
- `/login` — Sign in
- `/access` — Session, token and agent setup links
- `/tasks` — Kanban board (4 columns: pending, in_progress, completed, closed)
- `/knowledge` — Knowledge document list with tags
- `/search` — Unified BM25 + vector search across tasks and knowledge

## API Client

`lib/api-client.ts` — typed wrapper around MCP HTTP transport:

- `api.tasks.list/create/get/update/close`
- `api.knowledge.list/get/bulkCreate`
- `api.search.tasks/knowledge`
- `api.projects.list/getCurrent/setCurrent`

## Docker (UI-007)

```bash
cd web-ui
docker build -t mcp-task-knowledge-ui .
docker run -p 3000:3000 -e NEXT_PUBLIC_MCP_API_URL=http://host.docker.internal:3001/mcp mcp-task-knowledge-ui
```
