# Web UI

Next.js 16 App Router + TypeScript. Connects to MCP HTTP transport.

## Pages

| Route | Description |
|-------|-------------|
| `/` | Home — overview, links |
| `/tasks` | Kanban board — drag&drop, filters, search, edit |
| `/knowledge` | Knowledge editor — Markdown with live preview, tags, types |
| `/prompts` | Prompt management — CRUD, A/B experiments, template editor |
| `/search` | Unified search — BM25 + vector across tasks and knowledge |
| `/analytics` | Analytics dashboard — stats, feedback, charts |

## Setup

```bash
cd web-ui
npm install
NEXT_PUBLIC_MCP_API_URL=http://localhost:3001/mcp npm run dev
```

## Docker

```bash
cd web-ui
docker build -t mcp-task-knowledge-ui .
docker run -p 3000:3000 -e NEXT_PUBLIC_MCP_API_URL=http://host.docker.internal:3001/mcp mcp-task-knowledge-ui
```

## Features

### Tasks Board (UI-002)
- 4-column Kanban (pending → in_progress → completed → closed)
- Drag & drop between columns
- Search by title
- Filter by priority and tags
- Create with priority + tags
- Inline edit (title, priority, tags)
- Priority badges, tag chips
- Subtask indicator
- Task count per column
- Responsive grid

### Knowledge Editor (UI-003)
- Markdown editor with live preview
- Search/filter by title, tags, type
- Create, edit documents
- Tag management
- Document type selector (note, fact, decision, pattern, warning, memory_fact)
- Syntax-aware content area
- Toggle preview

### Prompt Management (UI-004)
- Prompt CRUD
- A/B experiments tab
- Template editor with `{{variables}}`
- Variant comparison
- Bandit-based selection info

### Analytics (UI-006)
- Task stats (by status, by priority)
- Knowledge doc count
- Feedback form with star ratings
- Bar charts
- localStorage feedback storage

### Realtime (UI-005 + MR-012)
- WebSocket server at `/ws`
- Live updates for task/knowledge changes
- Presence indicators
- Project-scoped broadcasting
- Heartbeat with timeout

## API Client

`web-ui/lib/api-client.ts` — typed wrapper around MCP HTTP transport:

```typescript
api.tasks.list()                    // → Task[]
api.tasks.create({ title, ... })    // → Task
api.knowledge.list()                // → KnowledgeDoc[]
api.search.knowledge(query)         // → SearchResult[]
api.projects.list()                 // → { projects, current }
```
