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

## Pages

- `/` — Home (overview + links)
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
