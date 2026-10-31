# Web UI

Next.js 16 App Router + TypeScript. Connects to MCP HTTP transport.

## Pages

| Route | Description |
|-------|-------------|
| `/` | Home — overview, links |
| `/tasks` | Kanban board — drag&drop, filters, search, edit |
| `/knowledge` | Knowledge list, read-first document view with TOC, Markdown editor, tags and types |
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

### Knowledge (UI-003, UI-13, UI-24)

- Server-side search and tag/type filters over frontmatter-only list items
- Read-first document view: title, metadata, table of contents, Export/Edit/Trash
- Markdown editor with live preview and `Dialog`-based trash confirmation
- Tokenised prose for headings, lists, quotes, fenced code, tables and rules;
  links stay scheme-allowlisted and HTML is escaped first
- Document type selector, including legacy types already stored on a document
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

- WebSocket server at `/ws`, authenticated by a one-time ticket
  (`POST /auth/ws-ticket` with a Bearer JWT → upgrade with `?ticket=`); the JWT is never put in the URL
- Live updates for task/knowledge changes
- Presence indicators
- Project-scoped broadcasting
- Heartbeat with timeout

## Design system (UI-10)

The admin shell uses a token-based design system in `web-ui/app/globals.css`:

- geometry, type and density come from direction A (Registry) and are shared by
  every palette: IBM Plex Sans/Mono (via `next/font`), 3/4 px radii, 1 px lines,
  11–24 px type scale, `tabular-nums`, 48 px top bar, 236 px navigation;
- colour has **two independent axes**: `data-mode` (`light` | `dark`) and
  `data-theme` (`indigo` | `petrol` | `copper`). Users choose light/dark/system;
  `system` resolves through `prefers-color-scheme`. Choices live in
  `localStorage` (`mcp.mode`, `mcp.theme`) and are applied by an inline script in
  `app/layout.tsx` before first paint (no flash). The Topbar switcher is
  keyboard-accessible;
- components use semantic tokens only (`bg-canvas`, `text-ink`, `border-line`,
  `bg-accent`, `text-st-doing`, …). Add a token to all six `[data-theme][data-mode]`
  blocks, then extend `THEMES`/labels in `web-ui/lib/theme.ts` if it is a new palette;
- `npm --prefix web-ui run test -- lib/theme.contrast.test.ts` parses those six
  blocks and enforces WCAG AA (text pairs ≥ 4.5:1, non-text line/focus ≥ 3:1).
  A palette that fails does not pass CI. `/design` is a dev-only showcase of all
  primitives in all six variants (404 in production).

## API Client

`web-ui/lib/api-client.ts` — typed wrapper around MCP HTTP transport:

<!-- doc-test: skip -->
```typescript
api.tasks.list()                    // → Task[]
api.tasks.create({ title, ... })    // → Task
api.knowledge.list()                // → KnowledgeListItem[]
api.search.knowledge(query)         // → SearchResult[]
api.projects.list()                 // → { projects, current }
```
