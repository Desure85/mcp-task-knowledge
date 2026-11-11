# MCP Tools (131 with catalog; 129 by default)

All tools registered in the MCP server, grouped by category.

## Pagination, fields and payload caps (SC-01)

Every list/search tool returns pages instead of whole collections. The `data` field keeps its
old shape (array of items, or the same object as before), and pagination metadata rides next to it:

```json
{
  "ok": true,
  "data": [{ "id": "t-1", "title": "Example task" }],
  "total": 120,
  "totalExact": false,
  "count": 50,
  "hasMore": true,
  "nextCursor": "eyJ2IjoxLCJrIjoiMTc2MTk0ODAwMDAwMCIsImlkIjoiYWJjIn0",
  "truncated": false,
  "limit": 50
}
```

| Parameter | Default | Meaning |
|-----------|---------|---------|
| `limit` | 50 (max 500) | Page size |
| `cursor` | — | Opaque cursor from the previous response (`nextCursor`). Omit for the first page |
| `fields` | all | Subset of item fields (`["id","title"]`); unknown names are ignored |
| `compact` | `false` | Drop null/empty values and unsolicited long text (`content`, `description`, `body`, …); explicit `fields` still wins |
| `countOnly` | `false` | Return only `total`, no items |
| `maxBytes` | 1 MiB | Hard cap on the payload; extra items are dropped and `truncated: true` is set |

Rules that matter for clients:

- **`total`** is exact whenever filters force a full read (`totalExact: true`). On the unfiltered
  fast path it is the number of files in the project, including archived/trashed (`totalExact: false`),
  because those flags live inside the files and reading them all would defeat the fast path.
- **Cursor is stable across inserts**: items newer than the cursor belong to an earlier page, so a
  concurrent write never duplicates a record. Ordering is `(updatedAt desc, id asc)`; the server derives
  the position from file mtime, which every write updates together with `updatedAt`.
- **Search cursors are query-scoped**: reusing a cursor with a different `query`/filters returns
  `INVALID_CURSOR` instead of silently shifting the page window.
- **`maxBytes` points the cursor at the last kept item**, so truncation never skips records.
- `tasks_tree`/`knowledge_tree` paginate **root nodes**; children always travel with their root.
- `tasks_dag`, `briefing` and `dashboard_stats` are aggregations, not lists: they still compute over
  the full project internally (an index for that is SC-02).

Error codes: `INVALID_CURSOR` (malformed, tampered, or issued for another query).

### Search index status and channel scores (AC-05)

`search_tasks` / `search_knowledge` answer from the FTS index when its completeness is proven, and
say so in metadata next to `data`:

| Field | Meaning |
|-------|---------|
| `source` | `'fts'` — served from the index; `'scan'` — served from files |
| `indexing` | `true` when the answer came from a scan while the index is not ready |
| `retryAfterMs` | Set with `indexing` while a background fill is running: retry after this delay |
| `needsReindex` | Set with `indexing` when the index is `dirty` or a fill failed: retry will not help, run `reindex` |

Every hit carries both channel scores: `bm25Score` and `vectorScore` are always numbers, `0` when
the hit did not come from that channel. A field that is absent is never a substitute for `0`.
On a pure lexical scan (no vector adapter), `bm25Score` is the hit's lexical score and
`vectorScore` is `0`.

When the index is filling and the project holds more than `SEARCH_SCAN_MAX_TASKS` tasks (default
`2000`), `search_tasks` does not scan the corpus: it returns `ok: false`,
`error.code: 'INDEXING'` and `error.details.retryAfterMs`. The fill keeps running in the background,
so the same call succeeds from the index afterwards. This guard does not apply to a `type`-filtered
search (it stays on the file path by design), to a disabled index (`STORAGE_INDEX=off`) or to a
`dirty` index — those answer from files and are marked with `indexing` instead.

Error codes: `INDEXING` (index fill in progress on a large project; retry after `retryAfterMs`).

### Transport and progress

HTTP responses are `application/json` by default (SSE framing in the MCP SDK is quadratic in
payload size). A request that carries `params._meta.progressToken` is automatically served over
`text/event-stream`, so `notifications/progress` keeps working for the caller that asked for it.
`MCP_JSON_RESPONSES=0` forces SSE for all requests (`docs/adr/0007-json-responses-vs-sse.md`).

## Tasks (22 tools)

| Tool | Description |
|------|-------------|
| `tasks_create` | Create a task with title, priority, type, tags, parentId |
| `tasks_list` | List tasks with filters (project, status, type, tag, priority, parentId, updatedSince) + pagination |
| `tasks_get` | Get task by ID |
| `tasks_update` | Update task fields (title, status, type, priority, tags) |
| `tasks_close` | Close a task into the project `closeStatus` |
| `tasks_claim` | Take a lease on a task (TTL, default 30 min); foreign active claims are rejected with `TASK_CLAIMED` |
| `tasks_renew` | Extend your lease (heartbeat); does not change `updatedAt`/version, so no false MU-02 conflicts |
| `tasks_release` | Release your lease; idempotent when the task is already free |
| `tasks_add_subtask` | Add subtask (parentId) |
| `tasks_get_children` | Get direct children |
| `tasks_get_subtree` | Get full subtree |
| `tasks_tree` | Get task tree for project |
| `tasks_set_deps` | Set task dependencies (DAG) |
| `tasks_get_deps` | Get dependency graph |
| `tasks_dag` | Get DAG visualization data |
| `tasks_bulk_create` | Bulk create tasks |
| `tasks_bulk_update` | Bulk update tasks |
| `tasks_bulk_close` | Bulk close tasks |
| `tasks_bulk_archive` | Bulk archive tasks |
| `tasks_bulk_trash` | Bulk trash tasks |
| `tasks_bulk_restore` | Bulk restore tasks |
| `tasks_bulk_delete_permanent` | Bulk permanently delete tasks |

### Task claims (U-01)

`tasks_claim` marks a task as taken by the calling MCP session for `ttlSec`
(30 s – 24 h, default 1800). `tasks_get`/`tasks_list`/`briefing` show the
holder (`bySessionId`, `byUserId`, `client`) and `expiresAt`. Rules:

- re-claiming your own task renews it; another session gets `{ok:false, error:{code:"TASK_CLAIMED", hint, details:{holder, expiresAt}}}`;
- expired claims never block — they are hidden on read and removed on write plus a background sweep (`TASK_CLAIM_SWEEP_MS`, default 60000, `0` disables);
- renew/release are coordination writes: `updatedAt` is untouched, so the future optimistic-lock version (MU-02) is not disturbed;
- the lease is advisory for writes: it prevents double *claiming*, not content updates by a non-holder.

## Knowledge (15 tools)

| Tool | Description |
|------|-------------|
| `knowledge_list` | List documents with filters (tag, type, parentId) + pagination |
| `knowledge_get` | Get document by ID (with content) |
| `knowledge_tree` | Get document tree |
| `knowledge_import_markdown` | Import Markdown file as knowledge doc |
| `knowledge_import_single` | Import single Markdown file |
| `knowledge_import_multimodal` | Extract text chunks from a pdf/text/code/image/video/audio file inside `DATA_DIR` (extract-only) |
| `knowledge_export_markdown` | Export doc as Markdown |
| `knowledge_export_single` | Export single doc |
| `knowledge_export_bundle` | Export all docs as bundle |
| `knowledge_bulk_create` | Create multiple documents |
| `knowledge_bulk_update` | Update multiple documents |
| `knowledge_bulk_archive` | Bulk archive documents |
| `knowledge_bulk_trash` | Bulk trash documents |
| `knowledge_bulk_restore` | Bulk restore documents |
| `knowledge_bulk_delete_permanent` | Bulk permanently delete documents |

## Search (3 tools)

| Tool | Description |
|------|-------------|
| `search_tasks` | Search tasks (BM25 + vector hybrid) |
| `search_knowledge` | Search knowledge docs (BM25 + vector) |
| `mcp1_search_knowledge_two_stage` | Two-stage rerank search (BM25 → vector rerank) |

## Memory (30 tools)

See [Agent Memory](agent-memory.md) for full reference.

| Tool | Description |
|------|-------------|
| `memory_extract` | Extract facts from conversation transcript |
| `memory_extract_async` | Non-blocking `memory_extract` for long transcripts; returns a jobId |
| `memory_async_submit` | Submit a long memory operation (extract/search/bulk_import/evolve/dream) |
| `memory_async_status` | Poll an async job: state, progress 0..1, result or error |
| `memory_async_cancel` | Cancel a pending or processing async job |
| `memory_facts_list` | List extracted memory facts |
| `memory_facts_search` | Search memory facts by keyword |
| `memory_verify` | Check memory-fact anchors against a git checkout (verified/stale/no-anchor) |
| `memory_temporal_add` | Add fact to temporal graph |
| `memory_temporal_query` | Query facts at point in time |
| `memory_temporal_invalidate` | Invalidate a fact (marks old, doesn't delete) |
| `memory_temporal_history` | Get fact history chain |
| `memory_temporal_stats` | Temporal graph statistics |
| `memory_profile_get` | Get user profile |
| `memory_profile_update` | Update user profile |
| `memory_profile_context` | Get always-on profile context block |
| `memory_context_assemble` | Assemble token-budget-aware context (RRF fusion) |
| `memory_entity_search` | Entity-linking retrieval (third signal) |
| `memory_evolve` | Evolve existing memories (A-MEM style) |
| `memory_check_conflicts` | Detect contradictions between facts |
| `memory_gc` | Garbage collect expired/noise facts |
| `memory_scope_filter` | Filter facts by scope (user/agent/app/run) |
| `memory_scope_tags` | Get scope tags for a fact |
| `memory_layer_add` | Add to memory layer (conversation/session/user) |
| `memory_layer_list` | List items in a memory layer |
| `memory_layer_promote` | Promote fact between layers |
| `memory_layer_stats` | Memory layer statistics |
| `memory_dream` | Run dreaming agent (dedup/merge/summarise) |
| `memory_observations` | Detect patterns from graph structure |
| `memory_benchmark_run` | Run LOCOMO/LongMemEval/BEAM/DMR suites on an ephemeral in-memory adapter |
| `memory_framework_adapter` | Descriptor for using the server as a LangGraph/AutoGen/CrewAI/LangChain memory provider |

## Prompts (16 tools)

| Tool | Description |
|------|-------------|
| `prompts_list` | List prompts |
| `packages_list` | List skill packages and plugin packages for the package browser |
| `package_get` | Read a package file tree and text content (files >256 KiB return null) |
| `package_create` | Create a skill package or plugin package from relative files |
| `package_write_file` | Replace one text file in a skill package |
| `package_toggle_component` | Enable/disable a plugin component in plugin.json without deleting files |
| `prompts_get` | Read one full prompt version (template/compose + metadata + version list) |
| `prompts_search` | Search prompts |
| `prompts_bulk_create` | Create multiple prompts |
| `prompts_bulk_update` | Update prompts |
| `prompts_bulk_delete` | Delete prompts |
| `prompts_catalog_get` | Get prompt catalog |
| `prompts_exports_get` | Get prompt exports |
| `prompts_variants_list` | List A/B variants |
| `prompts_variants_stats` | Variant statistics |
| `prompts_bandit_next` | Bandit-based variant selection |
| `prompts_experiments_upsert` | Create/update experiment |
| `prompts_ab_report` | A/B test report |
| `prompts_feedback_log` | Log feedback |
| `prompts_feedback_validate` | Validate feedback |
| `prompts_metrics_log_bulk` | Log metrics in bulk |

`prompts_bulk_*` failures return `PROMPTS_BULK_FAILED` with a per-item `details.results` array; successful items still apply. `prompts_get` returns the selected version, the full prompt JSON and all source versions (version omitted → latest semver).

### MCP prompts surface (SPEC-03)

The prompt library is also exposed natively via the MCP prompts capability, so
client UIs (Claude Desktop, IDEs, inspectors) render it under "Prompts":

- `prompts/list` — one entry per cataloged prompt (name = prompt `id`, e.g. `bug_triage`)
- `prompts/get` — renders the prompt template, substituting `{{variable}}` placeholders

Rules, workflows, templates and policies stay tool-only (they are composition
building blocks, not end-user prompt templates). Registration happens at startup
from the catalog — new prompts appear after a server restart (`listChanged` is
SPEC-04). When the library is empty, `prompts/list` answers with an empty list
(never `-32601`).

## Projects (14 tools)

| Tool | Description |
|------|-------------|
| `project_list` | List all projects |
| `project_create` | Create a project |
| `project_update` | Update project settings |
| `project_members_list` | List project members and their viewer/editor/admin roles |
| `project_members_set` | Add or update one project member role (project admin) |
| `project_members_remove` | Remove one project member (project admin) |
| `project_delete` | Delete a project |
| `project_get_current` | Get current project |
| `project_set_current` | Set current project |
| `project_info` | Get project info |
| `project_purge` | Purge project data |
| `project_statuses_get` | Get the project status set, close status and initial statuses |
| `project_statuses_set` | Replace the status set; moving/removing used statuses requires `moveTo` or `moves` |
| `project_transitions_get` | Get the status transition graph (`null` = any-to-any) |
| `project_transitions_set` | Replace the transition graph; validates references and done-status reachability |
| `project_types_get` | Get the project task type set (default task, bug, feature) |
| `project_types_set` | Replace the type set; removing a used type requires `moveTo` or `moves` |
| `project_agents_get` | Get the project agent-target registry (built-ins universal, claude, opencode) |
| `project_agents_set` | Replace the agent targets; removing a used target requires `moveTo` or `moves` |
| `agents_deploy` | Preview or apply deployment of skills/prompts into target agent directories; apply requires confirm and snapshots touched files |
| `agents_deploy_rollback` | Restore files from a deployment snapshot and remove files it created |

### Project statuses and transitions (V-01/V-02)

The default project workflow is `pending → in_progress → completed|closed` (four statuses, `blocked` remains a legacy task status for dependency automation).

- `project_statuses_set` validates unique lowercase slug ids, at least one active `todo` and one active `done` status, and returns `STATUS_IN_USE` with up to 20 task ids when a used status is removed without a move target.
- `closeStatus` selects the `tasks_close` target (default `closed`, otherwise the first done status). `initialStatuses` limits statuses accepted by `tasks_create` (default every active todo status).
- `project_transitions_set` accepts `{from: [to...]}`, `null` restores any-to-any, rejects unknown ids and returns `TRANSITIONS_UNREACHABLE_DONE` when the initial statuses cannot reach every done status.
- Task status changes return `{ok:false, error:{code:"TRANSITION_NOT_ALLOWED", message, from, to, allowed, hint, details}}`. Bulk update/close return `failed` entries per task while allowed tasks still run.
- `tasks_list`/`tasks_tree` reject an unknown status filter with `STATUS_NOT_ALLOWED`; task creation returns `INITIAL_STATUS_NOT_ALLOWED` when the requested status is not in `initialStatuses`.

### Task types (V-03)

- Default project types are `task`, `bug`, `feature`; legacy tasks without `type` are treated as `task` and are not rewritten.
- `project_types_set` validates unique lowercase slug ids and rejects removing a type used by tasks with `TYPE_IN_USE` (up to 20 task ids), unless `moveTo` or `moves` names a type in the new set.
- `tasks_create`, `tasks_update`, `tasks_bulk_create` and `tasks_bulk_update` reject an unknown type with `TYPE_NOT_ALLOWED` and an `allowed` list.
- `tasks_list`, `tasks_tree` and `search_tasks` accept `type`; `briefing` returns `counts.byType` and each open task carries `type`; `dashboard_stats` returns `tasks.byType`.

## Sessions (2 tools)

| Tool | Description |
|------|-------------|
| `session_info` | Get current session info (rate limit, TTL, idle timeout) |
| `session_list` | List active sessions |

## Dashboard & Briefing (5 tools)

| Tool | Description |
|------|-------------|
| `briefing` | Session-start context in one call: current project, open tasks by priority, recent docs, blockers |
| `dashboard_stats` | Project statistics: task counts by status/priority, knowledge counts, tag distribution, averages |
| `dashboard_activity` | Chronological activity feed of recent task and knowledge changes |
| `changes_since` | Delta feed of tasks/knowledge/memory changes since a timestamp (`nextSince` for polling) |
| `graph_neighbors` | Neighbors of a task/document/entity with the reason (dependency, parent/child, mention) |
| `dashboard_trends` | Task creation and completion trends over time (daily or weekly buckets) |
| `dashboard_project_summary` | Cross-project summary: task and knowledge counts plus top metrics per project |

## Cluster (3 tools)

| Tool | Description |
|------|-------------|
| `cluster_status` | Cluster membership overview: self node, node counts, session affinity, shard counts |
| `cluster_nodes` | Known cluster nodes with status and heartbeat info |
| `cluster_assign` | Sticky session affinity: assign a session to a node and return routing headers |

## Admin (3 tools)

| Tool | Description |
|------|-------------|
| `admin_backup` | Create a portable `tar.gz` archive of `DATA_DIR` (ADR-008) |
| `admin_restore` | Restore `DATA_DIR` from an archive: dry-run plan by default, apply with `confirm` (ADR-008) |
| `admin_setup_link` | Create a one-time (~15 min) setup link with server URL, transport, scoped token and agent instructions |
| `admin_users_list` | List users from DATA_DIR/auth.db (admin only) |
| `admin_user_create` | Create a user with scrypt-hashed password (admin only) |
| `admin_user_set_password` | Replace a user password; revokes personal tokens (admin only) |
| `admin_user_set_roles` | Replace user roles (admin only) |
| `admin_user_disable` | Disable or enable a user (admin only) |
| `admin_tokens_list` | List personal tokens (prefix/metadata only) |
| `admin_token_create` | Mint a personal token; raw value returned once (admin only) |
| `admin_token_revoke` | Revoke a personal token by id (admin only) |

`admin_backup` writes `backup-<timestamp>[-<label>].tar.gz` to `out` (default `DATA_DIR/.backups/`)
through a `.partial` file and an atomic rename. The archive is a standard `tar.gz` (`tar -tzf`
lists it, `gzip -t` validates it); `manifest.json` at the archive root records `formatVersion`,
`profile`, `schemaVersion`, `excluded` and every entry with `sha256`, and only relative paths are
stored. `.jwt-revoked.json`, `auth.db`, `audit.log`, `.embeddings/`, `.emb_cache/`, `.index/` and
`.backups/` never enter the archive; `includeSecrets` adds the two secret files and sets
`containsSecrets: true`, `excludeModels` skips `models/`. Symlinks are skipped and reported in
`manifest.warnings`. The finished archive size is returned in the tool response; the in-archive
manifest does not carry `archiveBytes` (ADR-008 «Поправка»). Requires the admin role on
authenticated transports; stdio/unix callers are trusted local operators.

`admin_restore` reads the archive with the same reader (every header, path, type, size and
`sha256` is validated before anything is written) and answers with a plan by default:
`{ dryRun: true, applyToken, creates, overwrites, deletes, warnings }`. Passing that exact
`applyToken` as `confirm` with `dryRun: false` replaces the archived scope and prunes files
under the archived roots that are not in the archive (`prune: false` keeps them). Before
writing it snapshots `DATA_DIR` to `.backups/<ts>-pre-restore/`; if a write fails halfway the
snapshot is restored and the error says `rolled back from the pre-restore snapshot`. A
`.restore.lock` (pid, startedAt, host) keeps a second process out — a live lock returns
`RESTORE_TARGET_BUSY`, a lock whose process is gone is reclaimed. `.server.lock` and
`.restore.lock` are never archived, overwritten or pruned; `.jwt-revoked.json` and `auth.db`
are only restored with `includeSecrets`, so a revocation made after the backup survives a
restore.

## Auth (1 tool)

| Tool | Description |
|------|-------------|
| `mcp.authenticate` | Authenticate the session with a token on http/tcp transports; returns userId and roles |

## Obsidian (2 tools)

| Tool | Description |
|------|-------------|
| `obsidian_export_project` | Export project to Obsidian vault |
| `obsidian_import_project` | Import from Obsidian vault |

## Service Catalog (4 tools)

| Tool | Description |
|------|-------------|
| `service_catalog_query` | Query service catalog |
| `service_catalog_upsert` | Add/update service |
| `service_catalog_delete` | Delete service |
| `service_catalog_health` | Catalog health check |

Registration depends on the switches: `service_catalog_query` and `service_catalog_health` appear with
`CATALOG_ENABLED=true`; `service_catalog_upsert` and `service_catalog_delete` additionally require
`CATALOG_WRITE_ENABLED=true` (off by default).

## Embeddings (2 tools)

| Tool | Description |
|------|-------------|
| `embeddings_status` | Get embeddings model status (loaded, mode, model) |
| `embeddings_try_init` | Attempt to initialize embeddings model |

## Graph (2 tools)

| Tool | Description |
|------|-------------|
| `graph_export_mermaid` | Export entity graph as Mermaid diagram |
| `graph_visualize` | Render the entity graph as a self-contained interactive HTML page (subgraph or lexical query) |

## Introspection & Tools (9 tools)

| Tool | Description |
|------|-------------|
| `tools_list` | List all registered tools |
| `tool_schema` | Get tool JSON schema |
| `tool_help` | Get tool help text |
| `tools_run` | Run a single tool by name |
| `tools_batch` | Run multiple tools in parallel (batch) |
| `logs_tail` | Read-only tail of the server JSON log (`LOG_FILE`) with secrets masked |
| `tools_register` | Hot-register a new tool at runtime |
| `tools_unregister` | Unregister a tool at runtime |
| `config_reload` | Hot-reload the file config without a restart (paths resolved from `DATA_DIR` need one) |

### `listChanged` notifications (SPEC-04)

The tool surface is dynamic, so the server emits MCP `list_changed`
notifications when it mutates:

- `tools_register` / `tools_unregister` → `notifications/tools/list_changed`
- connector initialization at boot → `notifications/tools/list_changed`
  (no-op on stdio where the client connects after init; relevant on HTTP/TCP
  where a client may already be attached)
- when `MCP_TOOL_RESOURCES_ENABLED` is on (default), each tool also appears as
  a `tool://<name>` resource → `notifications/resources/list_changed` is
  emitted alongside

`tools_unregister` removes the SDK-level registration too — the tool
disappears from the native `tools/list` and is no longer callable, not just
hidden from `tools_list`. Prompts stay a startup snapshot: the advertised
`prompts.listChanged` flag is set by the SDK but no
`notifications/prompts/list_changed` is ever emitted.

## Compact mode: `MCP_TOOLS_ENABLED=false`

For clients with a small tool budget the server can expose only the introspection surface:

| Kept on the wire | Purpose |
|------------------|---------|
| `tools_list` | Browse the full registry and filter it with `search` |
| `tool_schema` | Read one tool's JSON schema |
| `tool_help` | Short help plus an example call |
| `tools_run` | Execute any registered tool by name |

What this mode does and does not change:

- the protocol-level `tools/list` returns exactly these four names, while every other tool stays in
  the internal registry — `tools_list` still lists the whole surface and `tools_run` still executes it,
  so a client that sees four tools can reach all of them through `tools_run`;
- `tools_batch` is **not** registered in this mode, so batch execution becomes one `tools_run` call
  per tool;
- tool resources (`tool://<name>`) follow the same gate, and `admin_*`/connector tools are unavailable
  on the wire.

Budget (estimate, not a benchmark; measured on commit 28e45a1 in direct stdio mode with the MCP SDK
client, serializing the `client.listTools()` result as UTF-8 JSON): the full surface serializes to
roughly 88 KB (≈24k tokens), the compact surface to roughly 2 KB (≈530 tokens). Treat both as an
order of magnitude, not as measured limits.

The contract is enforced by `tests/docs-tools-coverage.test.ts`, which builds the real registration
in both modes and fails if these four names, the documentation rows or the generated counter drift.

## Connectors (20+ tools)

| Tool | Description |
|------|-------------|
| `github_*` | GitHub issues, PRs, commits, code search |
| `jira_*` | Jira/YouTrack issue sync |
| `slack_*` | Slack messages, search, notifications |
| `gdrive_list_files` | Google Drive: list files in folder |
| `gdrive_get_file` | Google Drive: get file content |
| `gdrive_sync_folder` | Google Drive: sync folder to knowledge base |
| `gmail_list_messages` | Gmail: list recent messages |
| `gmail_get_message` | Gmail: get full message content |
| `gmail_sync_to_kb` | Gmail: sync messages to knowledge base |
| `notion_search_pages` | Notion: search pages |
| `notion_get_page` | Notion: get page content |
| `notion_sync_database` | Notion: sync database to knowledge base |
| `onedrive_list_files` | OneDrive: list files |
| `onedrive_get_file` | OneDrive: get file content |
| `onedrive_sync_folder` | OneDrive: sync folder to knowledge base |
| `linear_list_issues` | Linear: list issues |
| `linear_get_issue` | Linear: get issue details |
| `linear_sync_to_kb` | Linear: sync issues to knowledge base |
| `webcrawler_fetch_page` | Web Crawler: fetch single page |
| `webcrawler_crawl_site` | Web Crawler: crawl site up to N pages |

## MCP Resources

Resources are read-only data endpoints (not tools):

| Resource URI | Description |
|--------------|-------------|
| `tool://catalog` | Full tool catalog (JSON) |
| `project://list` | Project list |
| `project://current` | Current project info |
| `session://active` | Active sessions |
| `knowledge://project/<id>` | Knowledge docs for project |
| `tasks://project/<id>` | Tasks for project |

## Total: 141 tools by default (143 with catalog; 145 when catalog writes are enabled) + 6 resources
