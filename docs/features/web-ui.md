# Web UI

Next.js 16 App Router + TypeScript. Connects to MCP HTTP transport.

## Pages

| Route | Description |
|-------|-------------|
| `/` | Home — overview, links |
| `/tasks` | Kanban board — drag&drop, filters, search, edit |
| `/knowledge` | Knowledge list, read-first document view with TOC, Markdown editor, tags and types |
| `/memory` | Facts, temporal history, profiles and memory layers |
| `/prompts` | Prompt management — CRUD, A/B experiments, template editor |
| `/search` | Unified search — BM25 + vector across tasks and knowledge |
| `/analytics` | Analytics dashboard — counters, task distribution, feedback |
| `/projects` | Project isolation, current scope, delete/purge confirmation |
| `/system` | Live sessions, embeddings status and tools catalog |

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

### Memory (NEXT2-004, UI-24)

- Four accessible tabs: Facts, Temporal History, Profiles, Layers (`tablist`/`tab`/`tabpanel`, Arrow/Home/End)
- Fact search, category/tag filter, temporal point-in-time and entity filters
- Profile static/dynamic facts and system-prompt context block
- Layered memory view with reload

### Knowledge Graph (NEXT2-003, UI-24)

- SVG graph of entities and temporal facts, with mention/relationship edges
- Node and edge colours come from semantic tokens read at runtime; the palette is re-read on `data-theme`/`data-mode` changes
- Search and node-type filters, selected-node details and neighbor expansion
- Legend plus a collapsible node table as the accessible alternative

### Prompt Management (UI-004, UI-24, UI-26)

- Catalog cards open a read view with full template, metadata, variables and version list
- Edit writes only changed fields through `prompts_bulk_update`; unsaved changes use a confirm `Dialog`
- Delete is destructive with a confirm `Dialog`; `prompts_get` supplies the full prompt text
- Prompt CRUD with labelled fields
- Accessible Catalog / A/B Experiments tabs (`tablist`/`tab`/`tabpanel`, Arrow/Home/End)
- Status badges by role, neutral domain/tag badges, readable `latest`/version labels
- Template editor with `{{variables}}`
- Variant comparison and bandit-based selection info

### Analytics (UI-006, UI-24)

- Task, knowledge and feedback counters (tokens, no new charts)
- Status and priority distribution bars with accessible labels and values
- Feedback form with labelled fields and rating buttons
- localStorage feedback storage

### Projects (PH-015, UI-24)

- Project list with default/current badges and task/knowledge presence
- Create form with labelled fields and aligned hints/actions; set-current scope for this browser session
- Delete and purge are `Dialog`-confirmed; purge additionally requires typing the project id

### System (PH-015, UI-24)

- Authentication section keeps the sessionStorage/no-cookie/CSRF trade-off and XSS caveat in two short paragraphs
- Semantic sessions table with column headers and horizontally scrollable mobile layout
- Embeddings status and a labelled tools-catalog filter with an empty state

### Search (UI-001, UI-24)

- One labelled query across tasks and knowledge, submit by button or Enter
- Results in Cards with counts and scores, per-column empty states
- Initial and loading states use `EmptyState`/`Skeleton`

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
