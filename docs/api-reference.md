# API Reference

> Автогенерировано из live MCP-сервера (D-001). Пересборка: `npm run api:reference`.

Всего инструментов: **207** — 205 по умолчанию плюс 2 динамических `service_catalog_*` (запись каталога, `service_catalog_upsert` и `service_catalog_delete`, регистрируется только при `CATALOG_WRITE_ENABLED=true`).

## Инструменты

| Инструмент | Описание |
|------------|-----------|
| `admin_audit_query` | Query the audit log (admin only): filter by user, tool/target, project, status and time; paginated.  |
| `admin_backup` | Create a portable tar.gz archive of DATA_DIR (ADR-008): manifest.json with formatVersion/profile/sch |
| `admin_restore` | Restore DATA_DIR from a tar.gz archive created by admin_backup (ADR-008): validates every entry (pat |
| `admin_setup_link` | Create a one-time setup link (TTL ~15min) that reveals a markdown document with server URL, transpor |
| `admin_token_create` | Mint a personal access token for a user (admin only). The raw token is returned exactly once and nev |
| `admin_token_revoke` | Revoke one personal token by id (admin only). |
| `admin_tokens_list` | List a user personal tokens (prefix/metadata only; never the raw token). |
| `admin_user_create` | Create a user with a scrypt-hashed password (admin only). |
| `admin_user_disable` | Disable a user (blocks password login and personal tokens) or enable it again. |
| `admin_user_set_password` | Replace a user password (admin only); existing personal tokens are revoked. |
| `admin_user_set_roles` | Replace a user roles array (admin only). |
| `admin_users_list` | List users from DATA_DIR/auth.db (admin only; hashes and tokens are never returned). |
| `agent_bootstrap` | Return a compact self-integration block for an agent: how to call tools, project convention, ok/erro |
| `agents_deploy` | Preview or apply deployment of skills/prompts into their target agent directories. Preview writes no |
| `agents_deploy_rollback` | Restore the files captured in a deploy snapshot and remove files it created. |
| `briefing` | Get session-start context in one call: current project, open tasks sorted by priority, recently upda |
| `changes_since` | Delta feed: tasks, knowledge docs and temporal memory facts changed at/after a timestamp. Returns {i |
| `cluster_assign` | Assign a session to a cluster node (sticky affinity) and return the target node ID plus routing head |
| `cluster_nodes` | List all known cluster nodes with status and heartbeat info. |
| `cluster_status` | Cluster membership overview: self node ID, total/active node counts, session affinity and shard coun |
| `config_reload` | Hot-reload the file config (--config or MCP_CONFIG_JSON) without restarting. Runtime-read settings ( |
| `dashboard_activity` | Get a chronological activity feed of recent task and knowledge changes. Useful for dashboards and st |
| `dashboard_project_summary` | Get a summary across all projects: task counts, knowledge counts, and top metrics per project. |
| `dashboard_stats` | Get project statistics: task counts by status/priority, knowledge counts, tag distribution, averages |
| `dashboard_trends` | Get task creation and completion trends over time. Returns daily or weekly buckets for burndown/burn |
| `dashboard_widgets_get` | Read a user dashboard widget layout (per session by default). |
| `dashboard_widgets_render` | Render saved widgets for a user: list query, distribution by field, burndown; time is unsupported un |
| `dashboard_widgets_set` | Replace a user dashboard layout (≤20 widgets). Types: list, distribution, burndown, time. |
| `draft_append` | Append an idempotent draft record to the append-only journal. Repeating the same key returns the exi |
| `draft_pending` | List journal drafts that have not been acknowledged by a successful sync. |
| `draft_sync` | Upsert pending drafts into knowledge by externalKey, acking each one after success. Safe to retry. |
| `embeddings_status` | Show current embeddings configuration and mode |
| `embeddings_try_init` | Force lazy initialization of vector adapter and return diagnostics |
| `graph_export_mermaid` | Build a Mermaid graph from tasks and knowledge (nodes + parent edges) |
| `graph_neighbors` | Return neighbors of a task/document/entity with the reason for each edge: task dependency, parent/ch |
| `graph_visualize` | Render the entity-graph as a self-contained interactive HTML page (SVG + JS, zero dependencies). See |
| `knowledge_backlinks` | List documents that link to this document via [[wiki links]]. |
| `knowledge_bulk_archive` | Archive many knowledge docs |
| `knowledge_bulk_create` | Create many knowledge docs at once (optionally hierarchical via parentId) |
| `knowledge_bulk_delete_permanent` | Permanently delete many knowledge docs (use with caution). Requires confirm=true unless the client s |
| `knowledge_bulk_restore` | Restore many knowledge docs from archive/trash |
| `knowledge_bulk_trash` | Move many knowledge docs to trash |
| `knowledge_bulk_update` | Update fields of many knowledge docs at once |
| `knowledge_diff` | Show the diff of one commit for a document. |
| `knowledge_export_bundle` | Export knowledge docs as a single concatenated markdown string. Docs are separated by horizontal rul |
| `knowledge_export_markdown` | Export knowledge docs from a project to a directory as individual .md files with frontmatter. Each f |
| `knowledge_export_single` | Export a single knowledge document as a markdown string with YAML frontmatter. Returns the full mark |
| `knowledge_get` | Read a knowledge document by id |
| `knowledge_history` | List git commits that touched a document in DATA_DIR. |
| `knowledge_import_markdown` | Import .md files from a directory into the knowledge base. Files can have YAML frontmatter (title, t |
| `knowledge_import_multimodal` | Extract text chunks from a file (pdf/text/code/image/video/audio) via the multimodal ingestion pipel |
| `knowledge_import_single` | Import a single markdown document into the knowledge base. The markdown can contain YAML frontmatter |
| `knowledge_list` | List knowledge document metadata with cursor pagination and field selection. Returns `data` (array)  |
| `knowledge_publish` | Set a document status to draft or published (wiki lifecycle). |
| `knowledge_review` | Record human review (reviewedBy/reviewedAt) and optionally publish a document. |
| `knowledge_stale` | List documents not updated for N days (default 90), newest-oldest first. |
| `knowledge_template_apply` | Render a document template with {{title}}, {{project}}, {{date}}. Returns markdown; create the doc s |
| `knowledge_template_list` | List markdown document templates from DATA_DIR/knowledge-templates. |
| `knowledge_tree` | List knowledge documents as a hierarchical tree (by parentId) |
| `knowledge_upsert` | Create or update a knowledge document by stable externalKey (no duplicates on retry). |
| `knowledge_version_restore` | Restore a document from a commit as a new commit (history is not erased). |
| `knowledge_wikilinks` | List outgoing [[wiki links]] of a document and whether each resolves. |
| `logs_tail` | Read the newest records of the server JSON log (read-only). File logging is opt-in: set LOG_FILE to  |
| `mcp.authenticate` | Authenticate this session with a token. Required before calling any other tool on http/tcp transport |
| `mcp1_search_knowledge_two_stage` | Two-stage search: Stage1 BM25 over docs (prefilter), Stage2 chunked hybrid within top-M long docs. C |
| `memory_async_cancel` | Cancel a pending or processing async memory job. Completed/failed jobs cannot be cancelled. |
| `memory_async_status` | Poll an async memory job by ID. Returns state (pending/processing/completed/failed/cancelled), progr |
| `memory_async_submit` | Submit a long-running memory operation for background execution. Returns immediately with a jobId —  |
| `memory_benchmark_run` | Run the agent-memory benchmark harness (LOCOMO, LongMemEval, BEAM, DMR) against an ephemeral in-memo |
| `memory_check_conflicts` | Detect contradictions between a new fact and existing facts. Uses negation patterns, entity overlap, |
| `memory_context_assemble` | Smart context assembly with RRF fusion. Combines knowledge base (BM25+vector), temporal graph facts, |
| `memory_dream` | Run sleep-time memory refinement: dedup similar facts, merge related ones, promote conversation→sess |
| `memory_entity_search` | Search memory facts by entity matching. Extracts entities from query (capitalized words, CamelCase,  |
| `memory_evolve` | Check a newly added fact against existing memories for semantic overlap. Links related facts, merges |
| `memory_extract` | Extract structured facts from a conversation/session transcript. Facts are categorized (preference,  |
| `memory_extract_async` | Non-blocking variant of memory_extract for long-running extraction (large transcripts). Returns imme |
| `memory_facts_list` | List extracted memory facts from the knowledge base. Filters by type=memory_fact. Supports tag filte |
| `memory_facts_search` | Full-text search across extracted memory facts. Uses existing search_knowledge under the hood, filte |
| `memory_framework_adapter` | Describe how to use this server as a memory provider from an external framework (LangGraph, AutoGen, |
| `memory_gc` | Run forgetting GC on the temporal knowledge graph. Expires facts past their TTL (per category), prun |
| `memory_layer_add` | Add a fact to a specific memory layer. conversation=volatile (in-flight), session=run-scoped, user=p |
| `memory_layer_list` | List valid facts in a specific memory layer. |
| `memory_layer_promote` | Promote facts from one layer to another (e.g. conversation→session at end of turn, session→user at e |
| `memory_layer_stats` | Get statistics for all memory layers — total/valid counts per layer. |
| `memory_observations` | Detect patterns from the temporal knowledge graph: recurrences (entities appearing repeatedly), co-o |
| `memory_profile_context` | Build a compact context block from a user's profile for system prompt injection. Token-budget-aware: |
| `memory_profile_get` | Get a user's profile — static facts (role, name, preferences) + dynamic facts (current task, recent  |
| `memory_profile_update` | Create or update a user profile. Set static facts (role, name, timezone) and/or add dynamic facts (c |
| `memory_scope_filter` | Filter temporal graph facts by multi-tenancy scope dimensions (userId, agentId, appId, runId). Retur |
| `memory_scope_tags` | Generate scope tags for a given memory scope. Tags can be attached to knowledge base documents for s |
| `memory_temporal_add` | Add a fact to the temporal knowledge graph with bi-temporal tracking. Optionally supersedes an exist |
| `memory_temporal_history` | Get the full history chain of a fact — all facts that superseded it and all facts it superseded. Use |
| `memory_temporal_invalidate` | Mark a fact as no longer valid (without deleting it). Sets validTo to now and records the invalidati |
| `memory_temporal_query` | Query the temporal knowledge graph. Supports point-in-time queries ('what was true on 2026-06-01?'), |
| `memory_temporal_stats` | Get statistics about the temporal knowledge graph — total facts, valid/invalidated counts, categorie |
| `memory_verify` | Check whether memory facts still point at live files/symbols in a checkout. Same anchor rules as npm |
| `obsidian_export_project` | Export knowledge, tasks, and prompts to Obsidian vault (merge or replace). Use with caution in repla |
| `obsidian_import_project` | Import knowledge, tasks, and prompts from Obsidian vault. Replace strategy deletes existing content  |
| `package_create` | Create a skill package from relative files. Fails if the package already exists. |
| `package_get` | Read a skill package or plugin package file tree and text content (files >256 KiB return content:nul |
| `package_toggle_component` | Enable or disable one plugin component in plugin.json (disabledComponents); files are not deleted. |
| `package_write_file` | Replace one text file in a skill package. Path traversal is rejected by the package helper. |
| `packages_list` | List skill packages and plugin packages available to the package browser UI. |
| `profile_get` | Read the current user’s server-side preferences (theme, custom themes) and updatedAt. |
| `profile_set` | Write the current user’s preferences. Last write wins by updatedAt; an older write returns conflict  |
| `project_agents_get` | Get the project agent-target registry. Built-ins universal, claude and opencode are always present. |
| `project_agents_set` | Replace the project agent-target registry. A target still used by prompts cannot be removed without  |
| `project_board_get` | Read board config (saved query, columns, swimlane field). |
| `project_board_set` | Replace board config: saved query, 1..20 columns with query per column, optional swimlane field. |
| `project_create` | Create a new project with optional description. Creates task and knowledge directories automatically |
| `project_delete` | Delete a project and all its data. Requires force=true if project has tasks or knowledge entries. |
| `project_get_current` | Return the name of the current project context (session-scoped on multi-client transports) |
| `project_info` | Get detailed information about a project: task stats by status/priority, knowledge stats by type, re |
| `project_list` | List all available projects with task and knowledge counts, descriptions, and creation dates. |
| `project_members_list` | List project members and their roles (viewer/editor/admin). Legacy projects without members return a |
| `project_members_remove` | Remove one project member. Removing the last member makes the project legacy/public again. |
| `project_members_set` | Add or update one project member role. Requires a project admin (global admin bypasses). |
| `project_purge` | Enumerate and permanently delete ALL tasks and/or knowledge in the project. Requires confirm=true un |
| `project_set_current` | Change the current project context used when project is omitted (per-session on http/tcp, global on  |
| `project_sprint_delete` | Delete a sprint by id; tasks keep sprintId but it no longer resolves. |
| `project_sprint_list` | List sprints with dates. |
| `project_sprint_save` | Create or replace a sprint (id, name, startDate, endDate). |
| `project_statuses_get` | Get the project status set, close status and allowed initial statuses. New projects use the default  |
| `project_statuses_set` | Replace the project status set. Statuses used by tasks cannot be removed without moveTo or moves. At |
| `project_theme_delete` | Remove a team theme from project data. A member's locally copied theme is unaffected. |
| `project_theme_set` | Create or replace a team theme in project data. Editors and admins only; max 20 themes. |
| `project_themes_list` | List team themes stored in project data. Every project member sees them without local import. |
| `project_transitions_get` | Get the allowed status transition graph. A null graph means every transition is allowed. |
| `project_transitions_set` | Replace the allowed status transition graph. A missing from-key is unrestricted; use null to restore |
| `project_types_get` | Get the project task type set. New projects use task, bug and feature; legacy tasks without a type a |
| `project_types_set` | Replace the project task type set. A type used by tasks cannot be removed without moveTo or moves. |
| `project_update` | Update project metadata (description). |
| `prompts_ab_report` | Aggregate A/B metrics and passive feedback for all prompt keys |
| `prompts_bandit_next` | Pick next variant for a prompt using epsilon-greedy over aggregates |
| `prompts_bulk_create` | Create many prompts (writes JSON files under prompts/|rules/|workflows/|templates/|policies) |
| `prompts_bulk_delete` | Delete many prompts by id+version or by explicit path |
| `prompts_bulk_update` | Update many prompts found by id+version or explicit path |
| `prompts_catalog_get` | Return prompts catalog JSON if present |
| `prompts_experiments_upsert` | Create or update experiment manifest with variants to drive variants_list and bandit |
| `prompts_exports_get` | List exported prompt artifacts under exports/ |
| `prompts_feedback_log` | Append passive user feedback for prompts (JSONL store) |
| `prompts_feedback_validate` | Validate feedback JSONL file and return stats/samples |
| `prompts_get` | Read one prompt version with full template/compose and metadata; version defaults to the latest semv |
| `prompts_list` | List prompts from prompts catalog with optional filters |
| `prompts_merge_apply` | Apply a prepared merge draft to targetPath (relative to DATA_DIR). Conflicts require confirm=true. |
| `prompts_merge_prepare` | Three-way merge of base/local/remote prompt text; validates variables, !commands and allowed-tools.  |
| `prompts_metrics_log_bulk` | Append events and update aggregates for prompts (bulk) |
| `prompts_search` | Semantic/lexical search across prompt builds and markdown |
| `prompts_variants_list` | List available variants for a promptKey (experiment or builds) |
| `prompts_variants_stats` | Return aggregate metrics per variant for given promptKey |
| `search_knowledge` | BM25 (and optional vector) search over knowledge docs |
| `search_tasks` | BM25 (and optional vector) search over tasks |
| `service_catalog_health` | Check health of the configured service-catalog source (remote/embedded) |
| `service_catalog_query` | Query services from the service-catalog (supports filters, sort, pagination) |
| `session_info` | Query session state for a specific session ID. Returns rate limit info, TTL, idle timeout, session a |
| `session_kill` | Terminate another live MCP session (admin only). The session disappears from session_list; the calle |
| `session_list` | List all active sessions with their state. Returns session count, rate limiting status, and per-sess |
| `skills_diff` | Show the diff of one commit for a skill. |
| `skills_history` | List git commits that touched a skill in DATA_DIR. |
| `skills_version_restore` | Restore a skill from a commit as a new commit (history is not erased). |
| `task_document_links_get` | Read bidirectional links by task or document. |
| `task_document_links_set` | Set bidirectional links for one document and the listed tasks; removes stale doc links from other ta |
| `tasks_add_subtask` | Create a subtask under a parent task. Shorthand for tasks_create with parentId. Maximum nesting dept |
| `tasks_board` | Render the saved board: columns by query + swimlane counts. Falls back to one column per distinct st |
| `tasks_bulk_archive` | Archive many tasks |
| `tasks_bulk_close` | Mark many tasks as closed |
| `tasks_bulk_create` | Create many tasks at once (optionally hierarchical via parentId) |
| `tasks_bulk_delete_permanent` | Permanently delete many tasks (use with caution) |
| `tasks_bulk_restore` | Restore many tasks from archive/trash |
| `tasks_bulk_trash` | Move many tasks to trash |
| `tasks_bulk_update` | Update fields of many tasks at once |
| `tasks_claim` | Take a lease on a task so a second agent does not start the same work. The holder is visible to othe |
| `tasks_close` | Close a task by moving it to the project's close status. Optionally cascade the close to all descend |
| `tasks_create` | Create a single task. Optionally set parentId to create a subtask. Maximum nesting depth is 10 level |
| `tasks_dag` | Get the dependency DAG for a project: topological sort, critical path and edge list. Supports tag an |
| `tasks_diff` | Show the diff of one commit for a task. |
| `tasks_get` | Get task by id. Includes the active claim/lease holder when the task is claimed. |
| `tasks_get_children` | Get direct children of a task (one level deep, not recursive). |
| `tasks_get_deps` | Get the dependency graph for a specific task: what it depends on and what depends on it. |
| `tasks_get_subtree` | Get a specific task and all its descendants as a hierarchical tree. Useful for inspecting a branch o |
| `tasks_history` | List git commits that touched a task in DATA_DIR. |
| `tasks_list` | List tasks with optional filters, cursor pagination and field selection. Returns `data` (array) plus |
| `tasks_query` | Query tasks with the TK-02 language: `project: X #tag status: Doing assignee: me`, AND/OR/NOT, paren |
| `tasks_recurring_delete` | Delete a recurring definition. |
| `tasks_recurring_list` | List recurring definitions and next run. |
| `tasks_recurring_save` | Create or replace a recurring definition (daily/weekly/monthly, UTC time, optional templateId). |
| `tasks_recurring_tick` | Create due instances exactly once per occurrence (idempotent across restarts). Safe to call repeated |
| `tasks_release` | Release your lease so another agent can pick the task up. Only the holder may release before expiry; |
| `tasks_renew` | Extend your lease on a claimed task (heartbeat). Only the current holder may renew. Renewals do not  |
| `tasks_saved_search_delete` | Delete a saved query by name. |
| `tasks_saved_search_list` | List saved task queries. |
| `tasks_saved_search_save` | Create or replace a named saved query. |
| `tasks_set_deps` | Set or replace dependency list for a task. Validates no cycles. Returns task, statusChanged, blocked |
| `tasks_sprint_assign` | Assign tasks to a sprint; sprintId=null clears membership. |
| `tasks_template_delete` | Delete a template by id. |
| `tasks_template_list` | List task templates. |
| `tasks_template_save` | Create or replace a task template with default fields (priority/type/tags/description/links). |
| `tasks_tree` | List tasks as a hierarchical tree (by parentId). Pagination applies to ROOT nodes (children of a ret |
| `tasks_update` | Update a single task by id. Can change any field except id, project, createdAt. Setting parentId mov |
| `tasks_version_restore` | Restore a task from a commit as a new commit (history is not erased). |
| `tool_help` | Short help for a tool with an example call |
| `tool_schema` | Return metadata and example payload for a tool name |
| `tools_batch` | Execute multiple tools in parallel (Promise.all). Returns aggregated results. Unlike tools_run (sequ |
| `tools_list` | Return list of canonical tool names with metadata. Supports pagination, search filtering, ETag-based |
| `tools_register` | Hot-register a new tool at runtime without restarting the server. The handler is defined as a JSON e |
| `tools_run` | Execute one or many tools by name with params via RPC. |
| `tools_unregister` | Hot-remove a tool at runtime (DX-001). Experimental. |

## admin_audit_query

**Admin Audit Query**

Query the audit log (admin only): filter by user, tool/target, project, status and time; paginated. Sensitive fields are already redacted by the audit logger.

**Параметры:**

- `userId`
- `target`
- `project`
- `status`
- `since`
- `until`
- `limit`
- `offset`

**Пример вызова:**

```json
{
  "name": "admin_audit_query",
  "arguments": {
    "userId": "example",
    "target": "example",
    "project": "mcp",
    "status": "pending",
    "since": "example",
    "until": "example",
    "limit": 10,
    "offset": "example"
  }
}
```

## admin_backup

**Backup DATA_DIR**

Create a portable tar.gz archive of DATA_DIR (ADR-008): manifest.json with formatVersion/profile/schemaVersion/sha256 per entry, deterministic entry order, atomic write via .partial. Secrets (.jwt-revoked.json, auth.db) and caches are excluded unless includeSecrets is set. Requires admin role on authenticated transports. Returns the finished archive size; the manifest inside the archive does not carry archiveBytes.

**Параметры:**

- `out`
- `label`
- `includeSecrets`
- `excludeModels`

**Пример вызова:**

```json
{
  "name": "admin_backup",
  "arguments": {
    "out": "example",
    "label": "example",
    "includeSecrets": "example",
    "excludeModels": "example"
  }
}
```

## admin_restore

**Restore DATA_DIR from an archive**

Restore DATA_DIR from a tar.gz archive created by admin_backup (ADR-008): validates every entry (paths, types, sizes, sha256) before writing, reports a create/overwrite/delete plan by default (dryRun=true), and on dryRun=false with the applyToken from the dry run replaces the archived scope and prunes files that are not in the archive. Takes DATA_DIR/.restore.lock, refuses to write outside DATA_DIR or through symlinks, leaves .jwt-revoked.json/auth.db untouched unless includeSecrets is set, never touches .server.lock/.restore.lock, and snapshots DATA_DIR to .backups/<ts>-pre-restore before applying. Requires admin role on authenticated transports.

**Параметры:**

- `archive`
- `dryRun`
- `confirm`
- `prune`
- `includeSecrets`

**Пример вызова:**

```json
{
  "name": "admin_restore",
  "arguments": {
    "archive": "example",
    "dryRun": false,
    "confirm": true,
    "prune": "example",
    "includeSecrets": "example"
  }
}
```

## admin_setup_link

**Create Setup Link**

Create a one-time setup link (TTL ~15min) that reveals a markdown document with server URL, transport, a scoped access token, and self-config instructions for an AI agent. Requires admin role. The link can be redeemed exactly once via GET /.well-known/mcp-setup/<otp>.

**Параметры:**

- `project`
- `role`
- `ttlMs`
- `baseUrl`

**Пример вызова:**

```json
{
  "name": "admin_setup_link",
  "arguments": {
    "project": "mcp",
    "role": "example",
    "ttlMs": "example",
    "baseUrl": "example"
  }
}
```

## admin_token_create

**Create personal token**

Mint a personal access token for a user (admin only). The raw token is returned exactly once and never stored in plaintext.

**Параметры:**

- `userId`
- `name`
- `expiresAt`

**Пример вызова:**

```json
{
  "name": "admin_token_create",
  "arguments": {
    "userId": "example",
    "name": "example",
    "expiresAt": "example"
  }
}
```

## admin_token_revoke

**Revoke personal token**

Revoke one personal token by id (admin only).

**Параметры:**

- `userId`
- `tokenId`

**Пример вызова:**

```json
{
  "name": "admin_token_revoke",
  "arguments": {
    "userId": "example",
    "tokenId": "example"
  }
}
```

## admin_tokens_list

**List personal tokens**

List a user personal tokens (prefix/metadata only; never the raw token).

**Параметры:**

- `userId`

**Пример вызова:**

```json
{
  "name": "admin_tokens_list",
  "arguments": {
    "userId": "example"
  }
}
```

## admin_user_create

**Create user**

Create a user with a scrypt-hashed password (admin only).

**Параметры:**

- `username`
- `password`
- `roles`

**Пример вызова:**

```json
{
  "name": "admin_user_create",
  "arguments": {
    "username": "example",
    "password": "example",
    "roles": "example"
  }
}
```

## admin_user_disable

**Disable/enable user**

Disable a user (blocks password login and personal tokens) or enable it again.

**Параметры:**

- `userId`
- `disabled`

**Пример вызова:**

```json
{
  "name": "admin_user_disable",
  "arguments": {
    "userId": "example",
    "disabled": "example"
  }
}
```

## admin_user_set_password

**Set user password**

Replace a user password (admin only); existing personal tokens are revoked.

**Параметры:**

- `userId`
- `password`

**Пример вызова:**

```json
{
  "name": "admin_user_set_password",
  "arguments": {
    "userId": "example",
    "password": "example"
  }
}
```

## admin_user_set_roles

**Set user roles**

Replace a user roles array (admin only).

**Параметры:**

- `userId`
- `roles`

**Пример вызова:**

```json
{
  "name": "admin_user_set_roles",
  "arguments": {
    "userId": "example",
    "roles": "example"
  }
}
```

## admin_users_list

**List users**

List users from DATA_DIR/auth.db (admin only; hashes and tokens are never returned).

**Пример вызова:**

```json
{
  "name": "admin_users_list",
  "arguments": {}
}
```

## agent_bootstrap

**Agent Bootstrap**

Return a compact self-integration block for an agent: how to call tools, project convention, ok/error envelope, capability flags and recommended tools. Read-only; does not return task or document content.

**Параметры:**

- `project`

**Пример вызова:**

```json
{
  "name": "agent_bootstrap",
  "arguments": {
    "project": "mcp"
  }
}
```

## agents_deploy

**Deploy Agent Skills/Prompts**

Preview or apply deployment of skills/prompts into their target agent directories. Preview writes nothing; apply requires confirm (MCP elicitation when not supplied) and snapshots every touched file.

**Параметры:**

- `artifacts`
- `apply`
- `confirm`
- `previewToken`
- `allowExternal`
- `allowDelete`

**Пример вызова:**

```json
{
  "name": "agents_deploy",
  "arguments": {
    "artifacts": "example",
    "apply": "example",
    "confirm": true,
    "previewToken": "example",
    "allowExternal": "example",
    "allowDelete": "example"
  }
}
```

## agents_deploy_rollback

**Rollback Agent Deployment**

Restore the files captured in a deploy snapshot and remove files it created.

**Параметры:**

- `snapshotId`
- `confirm`

**Пример вызова:**

```json
{
  "name": "agents_deploy_rollback",
  "arguments": {
    "snapshotId": "example",
    "confirm": true
  }
}
```

## briefing

**Session Briefing**

Get session-start context in one call: current project, open tasks sorted by priority, recently updated knowledge docs, and blockers (blocked tasks + tasks with unmet dependencies). Use instead of separate tasks_list + knowledge_list + dashboard_stats calls.

**Параметры:**

- `project`
- `maxTasks`
- `maxDocs`

**Пример вызова:**

```json
{
  "name": "briefing",
  "arguments": {
    "project": "mcp",
    "maxTasks": "example",
    "maxDocs": "example"
  }
}
```

## changes_since

**Changes Since**

Delta feed: tasks, knowledge docs and temporal memory facts changed at/after a timestamp. Returns {items:[{kind,id,title,change,updatedAt}], nextSince}; newest first.

**Параметры:**

- `since`
- `project`
- `types`
- `includeDeleted`
- `limit`

**Пример вызова:**

```json
{
  "name": "changes_since",
  "arguments": {
    "since": "example",
    "project": "mcp",
    "types": "example",
    "includeDeleted": "example",
    "limit": 10
  }
}
```

## cluster_assign

**Cluster Assign Session**

Assign a session to a cluster node (sticky affinity) and return the target node ID plus routing headers.

**Параметры:**

- `sessionId`

**Пример вызова:**

```json
{
  "name": "cluster_assign",
  "arguments": {
    "sessionId": "example"
  }
}
```

## cluster_nodes

**Cluster Nodes**

List all known cluster nodes with status and heartbeat info.

**Пример вызова:**

```json
{
  "name": "cluster_nodes",
  "arguments": {}
}
```

## cluster_status

**Cluster Status**

Cluster membership overview: self node ID, total/active node counts, session affinity and shard counts. If ClusterManager is not available (e.g. stdio single-node mode), returns availability status only.

**Пример вызова:**

```json
{
  "name": "cluster_status",
  "arguments": {}
}
```

## config_reload

**Reload Config**

Hot-reload the file config (--config or MCP_CONFIG_JSON) without restarting. Runtime-read settings (embeddings, catalog, prompts, currentProject) pick up new values; DATA_DIR-resolved paths require a restart.

**Пример вызова:**

```json
{
  "name": "config_reload",
  "arguments": {}
}
```

## dashboard_activity

**Dashboard Activity Feed**

Get a chronological activity feed of recent task and knowledge changes. Useful for dashboards and status updates.

**Параметры:**

- `project`
- `limit`
- `type`

**Пример вызова:**

```json
{
  "name": "dashboard_activity",
  "arguments": {
    "project": "mcp",
    "limit": 10,
    "type": "note"
  }
}
```

## dashboard_project_summary

**Dashboard Project Summary**

Get a summary across all projects: task counts, knowledge counts, and top metrics per project.

**Пример вызова:**

```json
{
  "name": "dashboard_project_summary",
  "arguments": {}
}
```

## dashboard_stats

**Dashboard Statistics**

Get project statistics: task counts by status/priority, knowledge counts, tag distribution, averages. Supports date range filtering.

**Параметры:**

- `project`
- `since`
- `until`

**Пример вызова:**

```json
{
  "name": "dashboard_stats",
  "arguments": {
    "project": "mcp",
    "since": "example",
    "until": "example"
  }
}
```

## dashboard_trends

**Dashboard Trends**

Get task creation and completion trends over time. Returns daily or weekly buckets for burndown/burnup charts.

**Параметры:**

- `project`
- `granularity`
- `days`

**Пример вызова:**

```json
{
  "name": "dashboard_trends",
  "arguments": {
    "project": "mcp",
    "granularity": "example",
    "days": "example"
  }
}
```

## dashboard_widgets_get

**Dashboard Widgets**

Read a user dashboard widget layout (per session by default).

**Параметры:**

- `user`

**Пример вызова:**

```json
{
  "name": "dashboard_widgets_get",
  "arguments": {
    "user": "example"
  }
}
```

## dashboard_widgets_render

**Render Dashboard Widgets**

Render saved widgets for a user: list query, distribution by field, burndown; time is unsupported until TK-05.

**Параметры:**

- `user`
- `project`

**Пример вызова:**

```json
{
  "name": "dashboard_widgets_render",
  "arguments": {
    "user": "example",
    "project": "mcp"
  }
}
```

## dashboard_widgets_set

**Set Dashboard Widgets**

Replace a user dashboard layout (≤20 widgets). Types: list, distribution, burndown, time.

**Параметры:**

- `user`
- `widgets`

**Пример вызова:**

```json
{
  "name": "dashboard_widgets_set",
  "arguments": {
    "user": "example",
    "widgets": "example"
  }
}
```

## draft_append

**Append Draft**

Append an idempotent draft record to the append-only journal. Repeating the same key returns the existing draft.

**Параметры:**

- `key`
- `project`
- `title`
- `content`
- `tags`

**Пример вызова:**

```json
{
  "name": "draft_append",
  "arguments": {
    "key": "example",
    "project": "mcp",
    "title": "Example Title",
    "content": "Example Content",
    "tags": [
      "example"
    ]
  }
}
```

## draft_pending

**Pending Drafts**

List journal drafts that have not been acknowledged by a successful sync.

**Пример вызова:**

```json
{
  "name": "draft_pending",
  "arguments": {}
}
```

## draft_sync

**Sync Drafts**

Upsert pending drafts into knowledge by externalKey, acking each one after success. Safe to retry.

**Пример вызова:**

```json
{
  "name": "draft_sync",
  "arguments": {}
}
```

## embeddings_status

**Embeddings Status**

Show current embeddings configuration and mode

**Пример вызова:**

```json
{
  "name": "embeddings_status",
  "arguments": {}
}
```

## embeddings_try_init

**Embeddings Try Init**

Force lazy initialization of vector adapter and return diagnostics

**Пример вызова:**

```json
{
  "name": "embeddings_try_init",
  "arguments": {}
}
```

## graph_export_mermaid

**Export Graph (Mermaid)**

Build a Mermaid graph from tasks and knowledge (nodes + parent edges)

**Параметры:**

- `project`
- `includeArchived`

**Пример вызова:**

```json
{
  "name": "graph_export_mermaid",
  "arguments": {
    "project": "mcp",
    "includeArchived": false
  }
}
```

## graph_neighbors

**Graph Neighbors**

Return neighbors of a task/document/entity with the reason for each edge: task dependency, parent/child, or memory-fact mention. Existing stores only; no new graph format.

**Параметры:**

- `id`
- `project`
- `limit`
- `fields`

**Пример вызова:**

```json
{
  "name": "graph_neighbors",
  "arguments": {
    "id": "00000000-0000-0000-0000-000000000000",
    "project": "mcp",
    "limit": 10,
    "fields": "example"
  }
}
```

## graph_visualize

**Visualize Knowledge Graph**

Render the entity-graph as a self-contained interactive HTML page (SVG + JS, zero dependencies). Seed by node ID (subgraph) or lexical query; returns HTML plus node/edge counts.

**Параметры:**

- `nodeId`
- `query`
- `depth`
- `limit`
- `title`

**Пример вызова:**

```json
{
  "name": "graph_visualize",
  "arguments": {
    "nodeId": "example",
    "query": "example",
    "depth": "example",
    "limit": 10,
    "title": "Example Title"
  }
}
```

## knowledge_backlinks

**Knowledge Backlinks**

List documents that link to this document via [[wiki links]].

**Параметры:**

- `project`
- `id`

**Пример вызова:**

```json
{
  "name": "knowledge_backlinks",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000"
  }
}
```

## knowledge_bulk_archive

**Bulk Archive Knowledge Docs**

Archive many knowledge docs

**Параметры:**

- `project`
- `ids`

**Пример вызова:**

```json
{
  "name": "knowledge_bulk_archive",
  "arguments": {
    "project": "mcp",
    "ids": [
      "00000000-0000-0000-0000-000000000000"
    ]
  }
}
```

## knowledge_bulk_create

**Bulk Create Knowledge Docs**

Create many knowledge docs at once (optionally hierarchical via parentId)

**Параметры:**

- `fields`
- `compact`
- `project`
- `items`

**Пример вызова:**

```json
{
  "name": "knowledge_bulk_create",
  "arguments": {
    "fields": "example",
    "compact": "example",
    "project": "mcp",
    "items": "example"
  }
}
```

## knowledge_bulk_delete_permanent

**Bulk Delete Knowledge Docs Permanently**

Permanently delete many knowledge docs (use with caution). Requires confirm=true unless the client supports elicitation.

**Параметры:**

- `project`
- `ids`
- `confirm`

**Пример вызова:**

```json
{
  "name": "knowledge_bulk_delete_permanent",
  "arguments": {
    "project": "mcp",
    "ids": [
      "00000000-0000-0000-0000-000000000000"
    ],
    "confirm": true
  }
}
```

## knowledge_bulk_restore

**Bulk Restore Knowledge Docs**

Restore many knowledge docs from archive/trash

**Параметры:**

- `project`
- `ids`

**Пример вызова:**

```json
{
  "name": "knowledge_bulk_restore",
  "arguments": {
    "project": "mcp",
    "ids": [
      "00000000-0000-0000-0000-000000000000"
    ]
  }
}
```

## knowledge_bulk_trash

**Bulk Trash Knowledge Docs**

Move many knowledge docs to trash

**Параметры:**

- `project`
- `ids`

**Пример вызова:**

```json
{
  "name": "knowledge_bulk_trash",
  "arguments": {
    "project": "mcp",
    "ids": [
      "00000000-0000-0000-0000-000000000000"
    ]
  }
}
```

## knowledge_bulk_update

**Bulk Update Knowledge Docs**

Update fields of many knowledge docs at once

**Параметры:**

- `fields`
- `compact`
- `project`
- `items`

**Пример вызова:**

```json
{
  "name": "knowledge_bulk_update",
  "arguments": {
    "fields": "example",
    "compact": "example",
    "project": "mcp",
    "items": "example"
  }
}
```

## knowledge_diff

**Document Diff**

Show the diff of one commit for a document.

**Параметры:**

- `project`
- `id`
- `commit`

**Пример вызова:**

```json
{
  "name": "knowledge_diff",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "commit": "example"
  }
}
```

## knowledge_export_bundle

**Export Knowledge as Markdown Bundle**

Export knowledge docs as a single concatenated markdown string. Docs are separated by horizontal rules with metadata headers. Useful for LLM context windows, backups, or clipboard transfer.

**Параметры:**

- `project`
- `tag`
- `type`
- `parentId`
- `includeArchived`
- `includeFrontmatter`
- `headingLevel`

**Пример вызова:**

```json
{
  "name": "knowledge_export_bundle",
  "arguments": {
    "project": "mcp",
    "tag": "example",
    "type": "note",
    "parentId": null,
    "includeArchived": false,
    "includeFrontmatter": "example",
    "headingLevel": "example"
  }
}
```

## knowledge_export_markdown

**Export Knowledge as Markdown Files**

Export knowledge docs from a project to a directory as individual .md files with frontmatter. Each file is named by slugified title. Supports filtering by tag, type, and parentId.

**Параметры:**

- `project`
- `outputDir`
- `tag`
- `type`
- `parentId`
- `includeArchived`
- `dryRun`

**Пример вызова:**

```json
{
  "name": "knowledge_export_markdown",
  "arguments": {
    "project": "mcp",
    "outputDir": "example",
    "tag": "example",
    "type": "note",
    "parentId": null,
    "includeArchived": false,
    "dryRun": false
  }
}
```

## knowledge_export_single

**Export Single Knowledge Doc as Markdown**

Export a single knowledge document as a markdown string with YAML frontmatter. Returns the full markdown content ready for file writing or clipboard.

**Параметры:**

- `project`
- `id`
- `includeSystemFields`

**Пример вызова:**

```json
{
  "name": "knowledge_export_single",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "includeSystemFields": "example"
  }
}
```

## knowledge_get

**Get Knowledge Doc**

Read a knowledge document by id

**Параметры:**

- `project`
- `id`
- `fields`
- `compact`

**Пример вызова:**

```json
{
  "name": "knowledge_get",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "fields": "example",
    "compact": "example"
  }
}
```

## knowledge_history

**Document History**

List git commits that touched a document in DATA_DIR.

**Параметры:**

- `project`
- `id`
- `limit`

**Пример вызова:**

```json
{
  "name": "knowledge_history",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "limit": 10
  }
}
```

## knowledge_import_markdown

**Import Knowledge from Markdown Directory**

Import .md files from a directory into the knowledge base. Files can have YAML frontmatter (title, tags, type, source, parentId). Supports merge strategies: append (always create new), overwrite (update existing by title), skip (ignore duplicates).

**Параметры:**

- `project`
- `inputDir`
- `strategy`
- `includePaths`
- `excludePaths`
- `tag`
- `type`
- `trustLevel`
- `dryRun`

**Пример вызова:**

```json
{
  "name": "knowledge_import_markdown",
  "arguments": {
    "project": "mcp",
    "inputDir": "example",
    "strategy": "merge",
    "includePaths": [
      "Knowledge/**/*.md",
      "Tasks/**/*.md"
    ],
    "excludePaths": [
      "Knowledge/**/*.md",
      "Tasks/**/*.md"
    ],
    "tag": "example",
    "type": "note",
    "trustLevel": "example",
    "dryRun": false
  }
}
```

## knowledge_import_multimodal

**Import Multimodal File**

Extract text chunks from a file (pdf/text/code/image/video/audio) via the multimodal ingestion pipeline. Extract-only: returns chunks, the calling agent decides what to persist. File must live inside DATA_DIR.

**Параметры:**

- `filePath`
- `type`
- `language`
- `maxChunks`

**Пример вызова:**

```json
{
  "name": "knowledge_import_multimodal",
  "arguments": {
    "filePath": "example",
    "type": "note",
    "language": "example",
    "maxChunks": "example"
  }
}
```

## knowledge_import_single

**Import Single Markdown Document**

Import a single markdown document into the knowledge base. The markdown can contain YAML frontmatter (title, tags, type, source, parentId). If no title is provided in frontmatter, it must be passed as a parameter.

**Параметры:**

- `project`
- `markdown`
- `title`
- `tags`
- `type`
- `source`
- `parentId`
- `trustLevel`

**Пример вызова:**

```json
{
  "name": "knowledge_import_single",
  "arguments": {
    "project": "mcp",
    "markdown": "example",
    "title": "Example Title",
    "tags": [
      "example"
    ],
    "type": "note",
    "source": "example",
    "parentId": null,
    "trustLevel": "example"
  }
}
```

## knowledge_list

**List Knowledge Docs**

List knowledge document metadata with cursor pagination and field selection. Returns `data` (array) plus total/count/hasMore/nextCursor/truncated/limit.

**Параметры:**

- `project`
- `tag`
- `type`
- `parentId`
- `rootsOnly`
- `includeArchived`
- `limit`
- `cursor`
- `countOnly`
- `maxBytes`
- `fields`
- `compact`

**Пример вызова:**

```json
{
  "name": "knowledge_list",
  "arguments": {
    "project": "mcp",
    "tag": "example",
    "type": "note",
    "parentId": null,
    "rootsOnly": "example",
    "includeArchived": false,
    "limit": 10,
    "cursor": "example",
    "countOnly": "example",
    "maxBytes": "example",
    "fields": "example",
    "compact": "example"
  }
}
```

## knowledge_publish

**Knowledge Publish**

Set a document status to draft or published (wiki lifecycle).

**Параметры:**

- `project`
- `id`
- `status`

**Пример вызова:**

```json
{
  "name": "knowledge_publish",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "status": "pending"
  }
}
```

## knowledge_review

**Knowledge Review**

Record human review (reviewedBy/reviewedAt) and optionally publish a document.

**Параметры:**

- `project`
- `id`
- `reviewer`
- `publish`

**Пример вызова:**

```json
{
  "name": "knowledge_review",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "reviewer": "example",
    "publish": "example"
  }
}
```

## knowledge_stale

**Knowledge Stale**

List documents not updated for N days (default 90), newest-oldest first.

**Параметры:**

- `project`
- `days`
- `limit`

**Пример вызова:**

```json
{
  "name": "knowledge_stale",
  "arguments": {
    "project": "mcp",
    "days": "example",
    "limit": 10
  }
}
```

## knowledge_template_apply

**Knowledge Template Apply**

Render a document template with {{title}}, {{project}}, {{date}}. Returns markdown; create the doc separately.

**Параметры:**

- `templateId`
- `title`
- `project`

**Пример вызова:**

```json
{
  "name": "knowledge_template_apply",
  "arguments": {
    "templateId": "example",
    "title": "Example Title",
    "project": "mcp"
  }
}
```

## knowledge_template_list

**Knowledge Template List**

List markdown document templates from DATA_DIR/knowledge-templates.

**Пример вызова:**

```json
{
  "name": "knowledge_template_list",
  "arguments": {}
}
```

## knowledge_tree

**Knowledge Tree**

List knowledge documents as a hierarchical tree (by parentId)

**Параметры:**

- `project`
- `includeArchived`
- `limit`
- `cursor`
- `countOnly`
- `maxBytes`
- `fields`
- `compact`

**Пример вызова:**

```json
{
  "name": "knowledge_tree",
  "arguments": {
    "project": "mcp",
    "includeArchived": false,
    "limit": 10,
    "cursor": "example",
    "countOnly": "example",
    "maxBytes": "example",
    "fields": "example",
    "compact": "example"
  }
}
```

## knowledge_upsert

**Upsert Knowledge**

Create or update a knowledge document by stable externalKey (no duplicates on retry).

**Параметры:**

- `externalKey`
- `project`
- `title`
- `content`
- `tags`

**Пример вызова:**

```json
{
  "name": "knowledge_upsert",
  "arguments": {
    "externalKey": "example",
    "project": "mcp",
    "title": "Example Title",
    "content": "Example Content",
    "tags": [
      "example"
    ]
  }
}
```

## knowledge_version_restore

**Document Restore**

Restore a document from a commit as a new commit (history is not erased).

**Параметры:**

- `project`
- `id`
- `commit`

**Пример вызова:**

```json
{
  "name": "knowledge_version_restore",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "commit": "example"
  }
}
```

## knowledge_wikilinks

**Knowledge Wiki Links**

List outgoing [[wiki links]] of a document and whether each resolves.

**Параметры:**

- `project`
- `id`

**Пример вызова:**

```json
{
  "name": "knowledge_wikilinks",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000"
  }
}
```

## logs_tail

**Tail Server Log**

Read the newest records of the server JSON log (read-only). File logging is opt-in: set LOG_FILE to a path (relative paths resolve against DATA_DIR). Secrets — JWTs, bearer tokens, GitHub/OpenAI keys and password/token JSON fields — are masked before returning. Use the `requestId` from tools_run/tools_batch failures to find the matching line.

**Параметры:**

- `project`
- `lines`
- `level`
- `maxBytes`
- `requestId`

**Пример вызова:**

```json
{
  "name": "logs_tail",
  "arguments": {
    "project": "mcp",
    "lines": "example",
    "level": "example",
    "maxBytes": "example",
    "requestId": "example"
  }
}
```

## mcp.authenticate

**Authenticate**

Authenticate this session with a token. Required before calling any other tool on http/tcp transports. Returns the authenticated userId and roles.

**Параметры:**

- `token`

**Пример вызова:**

```json
{
  "name": "mcp.authenticate",
  "arguments": {
    "token": "example"
  }
}
```

## mcp1_search_knowledge_two_stage

**Search Knowledge (Two-Stage)**

Two-stage search: Stage1 BM25 over docs (prefilter), Stage2 chunked hybrid within top-M long docs. Controls for prefilterLimit/chunkSize/chunkOverlap.

**Параметры:**

- `project`
- `query`
- `prefilterLimit`
- `chunkSize`
- `chunkOverlap`
- `limit`

**Пример вызова:**

```json
{
  "name": "mcp1_search_knowledge_two_stage",
  "arguments": {
    "project": "mcp",
    "query": "example",
    "prefilterLimit": 20,
    "chunkSize": 1000,
    "chunkOverlap": 200,
    "limit": 10
  }
}
```

## memory_async_cancel

**Cancel Async Job**

Cancel a pending or processing async memory job. Completed/failed jobs cannot be cancelled.

**Параметры:**

- `jobId`

**Пример вызова:**

```json
{
  "name": "memory_async_cancel",
  "arguments": {
    "jobId": "example"
  }
}
```

## memory_async_status

**Async Job Status**

Poll an async memory job by ID. Returns state (pending/processing/completed/failed/cancelled), progress 0..1, result output on completion, or error on failure.

**Параметры:**

- `jobId`

**Пример вызова:**

```json
{
  "name": "memory_async_status",
  "arguments": {
    "jobId": "example"
  }
}
```

## memory_async_submit

**Submit Async Memory Job**

Submit a long-running memory operation for background execution. Returns immediately with a jobId — poll memory_async_status for the result or receive it via webhookUrl on completion. Operations: extract (NEXT-002 transcript→facts; input {transcript, maxFacts?, minConfidence?, scope?, project?, persist?}), search (input {query, project?, limit?}), bulk_import (input {project?, documents: [{title, content, tags?}]}), evolve (NEXT-003; input {factId}), dream (NEXT-006; input {}). Status lifecycle: pending (queued) → processing (running) → completed | failed | cancelled.

**Параметры:**

- `type`
- `input`
- `webhookUrl`
- `metadata`

**Пример вызова:**

```json
{
  "name": "memory_async_submit",
  "arguments": {
    "type": "note",
    "input": "example",
    "webhookUrl": "example",
    "metadata": "example"
  }
}
```

## memory_benchmark_run

**Run Memory Benchmarks**

Run the agent-memory benchmark harness (LOCOMO, LongMemEval, BEAM, DMR) against an ephemeral in-memory adapter and return structured scores. Synchronous and bounded by design: at most 4 suites × maxQuestions questions, in-memory retrieval, finishes in milliseconds — safe for CI. For real-instance runs against a live server use `npm run benchmark` (NEXT2-007 CLI). For long/async jobs use the WIRE-008 async processors when available.

**Параметры:**

- `suite`
- `maxQuestions`
- `includeDetails`

**Пример вызова:**

```json
{
  "name": "memory_benchmark_run",
  "arguments": {
    "suite": "example",
    "maxQuestions": "example",
    "includeDetails": "example"
  }
}
```

## memory_check_conflicts

**Check Memory Conflicts**

Detect contradictions between a new fact and existing facts. Uses negation patterns, entity overlap, and semantic similarity. High-confidence conflicts auto-supersede old facts; low-confidence flagged for review.

**Параметры:**

- `factId`
- `checkAll`

**Пример вызова:**

```json
{
  "name": "memory_check_conflicts",
  "arguments": {
    "factId": "example",
    "checkAll": "example"
  }
}
```

## memory_context_assemble

**Assemble Context**

Smart context assembly with RRF fusion. Combines knowledge base (BM25+vector), temporal graph facts, and user profile into a single token-budget-aware context block. Returns <context> XML block optimized for system prompt injection.

**Параметры:**

- `query`
- `project`
- `userId`
- `tokenBudget`
- `maxItems`
- `includeTemporal`
- `includeProfile`

**Пример вызова:**

```json
{
  "name": "memory_context_assemble",
  "arguments": {
    "query": "example",
    "project": "mcp",
    "userId": "example",
    "tokenBudget": "example",
    "maxItems": "example",
    "includeTemporal": "example",
    "includeProfile": "example"
  }
}
```

## memory_dream

**Run Dreaming Agent**

Run sleep-time memory refinement: dedup similar facts, merge related ones, promote conversation→session. Non-blocking background operation. Inspired by Letta sleep-time compute.

**Параметры:**

- `action`
- `intervalMs`

**Пример вызова:**

```json
{
  "name": "memory_dream",
  "arguments": {
    "action": "example",
    "intervalMs": "example"
  }
}
```

## memory_entity_search

**Entity-linking Search**

Search memory facts by entity matching. Extracts entities from query (capitalized words, CamelCase, snake_case, kebab-case, quoted strings) and matches against entities in temporal graph facts. Third retrieval signal alongside BM25 and vector search.

**Параметры:**

- `query`
- `limit`

**Пример вызова:**

```json
{
  "name": "memory_entity_search",
  "arguments": {
    "query": "example",
    "limit": 10
  }
}
```

## memory_evolve

**Evolve Memory**

Check a newly added fact against existing memories for semantic overlap. Links related facts, merges similar ones, and supersedes contradictions. Inspired by A-MEM (Zettelkasten) — new memories trigger updates to existing ones.

**Параметры:**

- `factId`

**Пример вызова:**

```json
{
  "name": "memory_evolve",
  "arguments": {
    "factId": "example"
  }
}
```

## memory_extract

**Extract Memory Facts**

Extract structured facts from a conversation/session transcript. Facts are categorized (preference, decision, convention, error, fix, etc.) with confidence scores and entity extraction. Optionally persists to knowledge base as memory_fact documents. ADD-only model — facts accumulate, never overwritten.

**Параметры:**

- `transcript`
- `project`
- `userId`
- `agentId`
- `appId`
- `runId`
- `maxFacts`
- `minConfidence`
- `persist`
- `trustLevel`

**Пример вызова:**

```json
{
  "name": "memory_extract",
  "arguments": {
    "transcript": "example",
    "project": "mcp",
    "userId": "example",
    "agentId": "example",
    "appId": "example",
    "runId": "example",
    "maxFacts": "example",
    "minConfidence": "example",
    "persist": "example",
    "trustLevel": "example"
  }
}
```

## memory_extract_async

**Extract Memory Facts (Async)**

Non-blocking variant of memory_extract for long-running extraction (large transcripts). Returns immediately with a jobId — poll memory_async_status for the result or receive it via webhookUrl on completion. Same params as memory_extract plus webhookUrl/metadata.

**Параметры:**

- `transcript`
- `project`
- `userId`
- `agentId`
- `appId`
- `runId`
- `maxFacts`
- `minConfidence`
- `persist`
- `trustLevel`
- `webhookUrl`
- `metadata`

**Пример вызова:**

```json
{
  "name": "memory_extract_async",
  "arguments": {
    "transcript": "example",
    "project": "mcp",
    "userId": "example",
    "agentId": "example",
    "appId": "example",
    "runId": "example",
    "maxFacts": "example",
    "minConfidence": "example",
    "persist": "example",
    "trustLevel": "example",
    "webhookUrl": "example",
    "metadata": "example"
  }
}
```

## memory_facts_list

**List Memory Facts**

List extracted memory facts from the knowledge base. Filters by type=memory_fact. Supports tag filtering and pagination.

**Параметры:**

- `project`
- `tag`
- `category`
- `limit`
- `cursor`
- `countOnly`
- `maxBytes`
- `fields`
- `compact`

**Пример вызова:**

```json
{
  "name": "memory_facts_list",
  "arguments": {
    "project": "mcp",
    "tag": "example",
    "category": "example",
    "limit": 10,
    "cursor": "example",
    "countOnly": "example",
    "maxBytes": "example",
    "fields": "example",
    "compact": "example"
  }
}
```

## memory_facts_search

**Search Memory Facts**

Full-text search across extracted memory facts. Uses existing search_knowledge under the hood, filtered to type=memory_fact.

**Параметры:**

- `project`
- `query`
- `limit`
- `compact`

**Пример вызова:**

```json
{
  "name": "memory_facts_search",
  "arguments": {
    "project": "mcp",
    "query": "example",
    "limit": 10,
    "compact": "example"
  }
}
```

## memory_framework_adapter

**Framework Adapter Descriptor**

Describe how to use this server as a memory provider from an external framework (LangGraph, AutoGen, CrewAI, LangChain). Returns the MCP endpoint, the adapter operations available for the framework, and a minimal TypeScript client snippet. The adapter itself runs client-side.

**Параметры:**

- `framework`
- `serverUrl`
- `project`

**Пример вызова:**

```json
{
  "name": "memory_framework_adapter",
  "arguments": {
    "framework": "example",
    "serverUrl": "example",
    "project": "mcp"
  }
}
```

## memory_gc

**Memory Garbage Collection**

Run forgetting GC on the temporal knowledge graph. Expires facts past their TTL (per category), prunes noise (low confidence, no entities), and identifies invalidated facts past retention for deletion. Preferences/decisions/conventions/skills are permanent (TTL=null).

**Пример вызова:**

```json
{
  "name": "memory_gc",
  "arguments": {}
}
```

## memory_layer_add

**Add to Memory Layer**

Add a fact to a specific memory layer. conversation=volatile (in-flight), session=run-scoped, user=persistent. Facts can be promoted between layers via memory_layer_promote.

**Параметры:**

- `layer`
- `statement`
- `category`
- `confidence`
- `tags`

**Пример вызова:**

```json
{
  "name": "memory_layer_add",
  "arguments": {
    "layer": "example",
    "statement": "example",
    "category": "example",
    "confidence": "example",
    "tags": [
      "example"
    ]
  }
}
```

## memory_layer_list

**List Memory Layer Facts**

List valid facts in a specific memory layer.

**Параметры:**

- `layer`

**Пример вызова:**

```json
{
  "name": "memory_layer_list",
  "arguments": {
    "layer": "example"
  }
}
```

## memory_layer_promote

**Promote Memory Layer Facts**

Promote facts from one layer to another (e.g. conversation→session at end of turn, session→user at end of run). Supports single fact or batch (promoteAll).

**Параметры:**

- `from`
- `to`
- `factId`

**Пример вызова:**

```json
{
  "name": "memory_layer_promote",
  "arguments": {
    "from": "example",
    "to": "example",
    "factId": "example"
  }
}
```

## memory_layer_stats

**Memory Layer Stats**

Get statistics for all memory layers — total/valid counts per layer.

**Пример вызова:**

```json
{
  "name": "memory_layer_stats",
  "arguments": {}
}
```

## memory_observations

**Detect Memory Observations**

Detect patterns from the temporal knowledge graph: recurrences (entities appearing repeatedly), co-occurrences (entities appearing together), temporal clusters (facts grouped in time), category trends. Inspired by Zep graph-based pattern surfacing.

**Пример вызова:**

```json
{
  "name": "memory_observations",
  "arguments": {}
}
```

## memory_profile_context

**Build Profile Context Block**

Build a compact context block from a user's profile for system prompt injection. Token-budget-aware: limits output to approximately maxTokens. Returns static + current dynamic facts in a <user-profile> XML block.

**Параметры:**

- `userId`
- `maxTokens`

**Пример вызова:**

```json
{
  "name": "memory_profile_context",
  "arguments": {
    "userId": "example",
    "maxTokens": "example"
  }
}
```

## memory_profile_get

**Get User Profile**

Get a user's profile — static facts (role, name, preferences) + dynamic facts (current task, recent decisions). Always-on context for agent personalization.

**Параметры:**

- `userId`

**Пример вызова:**

```json
{
  "name": "memory_profile_get",
  "arguments": {
    "userId": "example"
  }
}
```

## memory_profile_update

**Update User Profile**

Create or update a user profile. Set static facts (role, name, timezone) and/or add dynamic facts (current task, recent decision). Dynamic facts auto-invalidate previous facts of same category.

**Параметры:**

- `userId`
- `static`
- `dynamicStatement`
- `dynamicCategory`

**Пример вызова:**

```json
{
  "name": "memory_profile_update",
  "arguments": {
    "userId": "example",
    "static": "example",
    "dynamicStatement": "example",
    "dynamicCategory": "example"
  }
}
```

## memory_scope_filter

**Filter by Memory Scope**

Filter temporal graph facts by multi-tenancy scope dimensions (userId, agentId, appId, runId). Returns only facts matching all specified dimensions. Enables tenant isolation — different users/agents/apps see only their own memories.

**Параметры:**

- `userId`
- `agentId`
- `appId`
- `runId`
- `limit`

**Пример вызова:**

```json
{
  "name": "memory_scope_filter",
  "arguments": {
    "userId": "example",
    "agentId": "example",
    "appId": "example",
    "runId": "example",
    "limit": 10
  }
}
```

## memory_scope_tags

**Build Scope Tags**

Generate scope tags for a given memory scope. Tags can be attached to knowledge base documents for scope-based filtering. Format: scope:user:<id>, scope:agent:<id>, scope:app:<id>, scope:run:<id>.

**Параметры:**

- `userId`
- `agentId`
- `appId`
- `runId`

**Пример вызова:**

```json
{
  "name": "memory_scope_tags",
  "arguments": {
    "userId": "example",
    "agentId": "example",
    "appId": "example",
    "runId": "example"
  }
}
```

## memory_temporal_add

**Add Temporal Fact**

Add a fact to the temporal knowledge graph with bi-temporal tracking. Optionally supersedes an existing fact (marks old as invalid, links new→old). Point-in-time queries available via memory_temporal_query.

**Параметры:**

- `statement`
- `category`
- `confidence`
- `tags`
- `entities`
- `validFrom`
- `supersedesFactId`
- `invalidationReason`
- `trustLevel`
- `relations`
- `scope`

**Пример вызова:**

```json
{
  "name": "memory_temporal_add",
  "arguments": {
    "statement": "example",
    "category": "example",
    "confidence": "example",
    "tags": [
      "example"
    ],
    "entities": "example",
    "validFrom": "example",
    "supersedesFactId": "example",
    "invalidationReason": "example",
    "trustLevel": "example",
    "relations": "example",
    "scope": "example"
  }
}
```

## memory_temporal_history

**Fact History Chain**

Get the full history chain of a fact — all facts that superseded it and all facts it superseded. Useful for understanding how knowledge evolved.

**Параметры:**

- `factId`

**Пример вызова:**

```json
{
  "name": "memory_temporal_history",
  "arguments": {
    "factId": "example"
  }
}
```

## memory_temporal_invalidate

**Invalidate Temporal Fact**

Mark a fact as no longer valid (without deleting it). Sets validTo to now and records the invalidation reason. History is preserved — the fact can still be queried via point-in-time queries.

**Параметры:**

- `factId`
- `reason`

**Пример вызова:**

```json
{
  "name": "memory_temporal_invalidate",
  "arguments": {
    "factId": "example",
    "reason": "example"
  }
}
```

## memory_temporal_query

**Query Temporal Facts**

Query the temporal knowledge graph. Supports point-in-time queries ('what was true on 2026-06-01?'), entity/category/tag filters, and including/excluding invalidated facts.

**Параметры:**

- `atTime`
- `entity`
- `category`
- `tag`
- `includeInvalidated`
- `limit`

**Пример вызова:**

```json
{
  "name": "memory_temporal_query",
  "arguments": {
    "atTime": "example",
    "entity": "example",
    "category": "example",
    "tag": "example",
    "includeInvalidated": "example",
    "limit": 10
  }
}
```

## memory_temporal_stats

**Temporal Graph Stats**

Get statistics about the temporal knowledge graph — total facts, valid/invalidated counts, categories.

**Пример вызова:**

```json
{
  "name": "memory_temporal_stats",
  "arguments": {}
}
```

## memory_verify

**Verify Memory Facts**

Check whether memory facts still point at live files/symbols in a checkout. Same anchor rules as npm run memory:verify; read-only (no tag writes). Statuses: verified / stale / no-anchor; symbol-only facts without lookup support are reported honestly.

**Параметры:**

- `project`
- `repo`
- `limit`
- `status`

**Пример вызова:**

```json
{
  "name": "memory_verify",
  "arguments": {
    "project": "mcp",
    "repo": "example",
    "limit": 10,
    "status": "pending"
  }
}
```

## obsidian_export_project

**Export Project to Obsidian Vault**

Export knowledge, tasks, and prompts to Obsidian vault (merge or replace). Use with caution in replace mode.

**Параметры:**

- `project`
- `knowledge`
- `tasks`
- `prompts`
- `includePromptSourcesJson`
- `includePromptSourcesMd`
- `strategy`
- `includeArchived`
- `updatedFrom`
- `updatedTo`
- `includeTags`
- `excludeTags`
- `includeTypes`
- `excludeTypes`
- `includeStatus`
- `includePriority`
- `keepOrphans`
- `confirm`
- `dryRun`

**Пример вызова:**

```json
{
  "name": "obsidian_export_project",
  "arguments": {
    "project": "mcp",
    "knowledge": true,
    "tasks": true,
    "prompts": true,
    "includePromptSourcesJson": true,
    "includePromptSourcesMd": true,
    "strategy": "merge",
    "includeArchived": false,
    "updatedFrom": "2025-01-01T00:00:00Z",
    "updatedTo": "2025-12-31T23:59:59Z",
    "includeTags": [
      "tag1",
      "tag2"
    ],
    "excludeTags": [
      "tag1",
      "tag2"
    ],
    "includeTypes": [
      "note",
      "spec"
    ],
    "excludeTypes": "example",
    "includeStatus": [
      "pending",
      "in_progress"
    ],
    "includePriority": [
      "high",
      "medium"
    ],
    "keepOrphans": false,
    "confirm": true,
    "dryRun": false
  }
}
```

## obsidian_import_project

**Import Project from Obsidian Vault**

Import knowledge, tasks, and prompts from Obsidian vault. Replace strategy deletes existing content — use with caution.

**Параметры:**

- `project`
- `knowledge`
- `tasks`
- `prompts`
- `importPromptSourcesJson`
- `importPromptMarkdown`
- `overwriteByTitle`
- `strategy`
- `mergeStrategy`
- `includePaths`
- `excludePaths`
- `includeTags`
- `excludeTags`
- `includeTypes`
- `includeStatus`
- `includePriority`
- `confirm`
- `dryRun`

**Пример вызова:**

```json
{
  "name": "obsidian_import_project",
  "arguments": {
    "project": "mcp",
    "knowledge": true,
    "tasks": true,
    "prompts": true,
    "importPromptSourcesJson": true,
    "importPromptMarkdown": true,
    "overwriteByTitle": true,
    "strategy": "merge",
    "mergeStrategy": "overwrite",
    "includePaths": [
      "Knowledge/**/*.md",
      "Tasks/**/*.md"
    ],
    "excludePaths": [
      "Knowledge/**/*.md",
      "Tasks/**/*.md"
    ],
    "includeTags": [
      "tag1",
      "tag2"
    ],
    "excludeTags": [
      "tag1",
      "tag2"
    ],
    "includeTypes": [
      "note",
      "spec"
    ],
    "includeStatus": [
      "pending",
      "in_progress"
    ],
    "includePriority": [
      "high",
      "medium"
    ],
    "confirm": true,
    "dryRun": false
  }
}
```

## package_create

**Create Skill Package**

Create a skill package from relative files. Fails if the package already exists.

**Параметры:**

- `kind`
- `name`
- `files`
- `version`
- `description`

**Пример вызова:**

```json
{
  "name": "package_create",
  "arguments": {
    "kind": "example",
    "name": "example",
    "files": "example",
    "version": "example",
    "description": "Example Description"
  }
}
```

## package_get

**Get Package Files**

Read a skill package or plugin package file tree and text content (files >256 KiB return content:null).

**Параметры:**

- `kind`
- `name`

**Пример вызова:**

```json
{
  "name": "package_get",
  "arguments": {
    "kind": "example",
    "name": "example"
  }
}
```

## package_toggle_component

**Toggle Plugin Component**

Enable or disable one plugin component in plugin.json (disabledComponents); files are not deleted.

**Параметры:**

- `name`
- `component`
- `enabled`

**Пример вызова:**

```json
{
  "name": "package_toggle_component",
  "arguments": {
    "name": "example",
    "component": "example",
    "enabled": "example"
  }
}
```

## package_write_file

**Write Skill Package File**

Replace one text file in a skill package. Path traversal is rejected by the package helper.

**Параметры:**

- `name`
- `path`
- `content`

**Пример вызова:**

```json
{
  "name": "package_write_file",
  "arguments": {
    "name": "example",
    "path": "example",
    "content": "Example Content"
  }
}
```

## packages_list

**List Skill Packages and Plugins**

List skill packages and plugin packages available to the package browser UI.

**Пример вызова:**

```json
{
  "name": "packages_list",
  "arguments": {}
}
```

## profile_get

**Get User Profile**

Read the current user’s server-side preferences (theme, custom themes) and updatedAt.

**Пример вызова:**

```json
{
  "name": "profile_get",
  "arguments": {}
}
```

## profile_set

**Set User Profile**

Write the current user’s preferences. Last write wins by updatedAt; an older write returns conflict with the current profile; identical timestamps are idempotent duplicates.

**Параметры:**

- `preferences`
- `updatedAt`
- `clientId`

**Пример вызова:**

```json
{
  "name": "profile_set",
  "arguments": {
    "preferences": "example",
    "updatedAt": "example",
    "clientId": "example"
  }
}
```

## project_agents_get

**Get Project Agent Targets**

Get the project agent-target registry. Built-ins universal, claude and opencode are always present.

**Параметры:**

- `project`

**Пример вызова:**

```json
{
  "name": "project_agents_get",
  "arguments": {
    "project": "mcp"
  }
}
```

## project_agents_set

**Set Project Agent Targets**

Replace the project agent-target registry. A target still used by prompts cannot be removed without moveTo or moves.

**Параметры:**

- `project`
- `agents`
- `moveTo`
- `moves`

**Пример вызова:**

```json
{
  "name": "project_agents_set",
  "arguments": {
    "project": "mcp",
    "agents": "example",
    "moveTo": "example",
    "moves": "example"
  }
}
```

## project_board_get

**Project Board**

Read board config (saved query, columns, swimlane field).

**Параметры:**

- `project`

**Пример вызова:**

```json
{
  "name": "project_board_get",
  "arguments": {
    "project": "mcp"
  }
}
```

## project_board_set

**Set Project Board**

Replace board config: saved query, 1..20 columns with query per column, optional swimlane field.

**Параметры:**

- `project`
- `query`
- `columns`
- `swimlaneField`

**Пример вызова:**

```json
{
  "name": "project_board_set",
  "arguments": {
    "project": "mcp",
    "query": "example",
    "columns": "example",
    "swimlaneField": "example"
  }
}
```

## project_create

**Create Project**

Create a new project with optional description. Creates task and knowledge directories automatically.

**Параметры:**

- `id`
- `description`

**Пример вызова:**

```json
{
  "name": "project_create",
  "arguments": {
    "id": "00000000-0000-0000-0000-000000000000",
    "description": "Example Description"
  }
}
```

## project_delete

**Delete Project**

Delete a project and all its data. Requires force=true if project has tasks or knowledge entries.

**Параметры:**

- `project`
- `force`

**Пример вызова:**

```json
{
  "name": "project_delete",
  "arguments": {
    "project": "mcp",
    "force": "example"
  }
}
```

## project_get_current

**Get Current Project**

Return the name of the current project context (session-scoped on multi-client transports)

**Пример вызова:**

```json
{
  "name": "project_get_current",
  "arguments": {}
}
```

## project_info

**Project Info**

Get detailed information about a project: task stats by status/priority, knowledge stats by type, recent activity, and metadata.

**Параметры:**

- `project`

**Пример вызова:**

```json
{
  "name": "project_info",
  "arguments": {
    "project": "mcp"
  }
}
```

## project_list

**Project List**

List all available projects with task and knowledge counts, descriptions, and creation dates.

**Пример вызова:**

```json
{
  "name": "project_list",
  "arguments": {}
}
```

## project_members_list

**List Project Members**

List project members and their roles (viewer/editor/admin). Legacy projects without members return an empty map.

**Параметры:**

- `project`

**Пример вызова:**

```json
{
  "name": "project_members_list",
  "arguments": {
    "project": "mcp"
  }
}
```

## project_members_remove

**Remove Project Member**

Remove one project member. Removing the last member makes the project legacy/public again.

**Параметры:**

- `project`
- `userId`

**Пример вызова:**

```json
{
  "name": "project_members_remove",
  "arguments": {
    "project": "mcp",
    "userId": "example"
  }
}
```

## project_members_set

**Set Project Member**

Add or update one project member role. Requires a project admin (global admin bypasses).

**Параметры:**

- `project`
- `userId`
- `role`

**Пример вызова:**

```json
{
  "name": "project_members_set",
  "arguments": {
    "project": "mcp",
    "userId": "example",
    "role": "example"
  }
}
```

## project_purge

**Project Purge (Destructive)**

Enumerate and permanently delete ALL tasks and/or knowledge in the project. Requires confirm=true unless dryRun.

**Параметры:**

- `project`
- `scope`
- `dryRun`
- `confirm`
- `includeArchived`
- `tasksStatus`
- `tasksTags`
- `tasksParentId`
- `tasksIncludeDescendants`
- `knowledgeTags`
- `knowledgeTypes`
- `knowledgeParentId`
- `knowledgeIncludeDescendants`

**Пример вызова:**

```json
{
  "name": "project_purge",
  "arguments": {
    "project": "mcp",
    "scope": "example",
    "dryRun": false,
    "confirm": true,
    "includeArchived": false,
    "tasksStatus": "example",
    "tasksTags": "example",
    "tasksParentId": "example",
    "tasksIncludeDescendants": "example",
    "knowledgeTags": "example",
    "knowledgeTypes": "example",
    "knowledgeParentId": "example",
    "knowledgeIncludeDescendants": "example"
  }
}
```

## project_set_current

**Set Current Project**

Change the current project context used when project is omitted (per-session on http/tcp, global on stdio)

**Параметры:**

- `project`

**Пример вызова:**

```json
{
  "name": "project_set_current",
  "arguments": {
    "project": "mcp"
  }
}
```

## project_sprint_delete

**Delete Sprint**

Delete a sprint by id; tasks keep sprintId but it no longer resolves.

**Параметры:**

- `id`

**Пример вызова:**

```json
{
  "name": "project_sprint_delete",
  "arguments": {
    "id": "00000000-0000-0000-0000-000000000000"
  }
}
```

## project_sprint_list

**Sprint List**

List sprints with dates.

**Пример вызова:**

```json
{
  "name": "project_sprint_list",
  "arguments": {}
}
```

## project_sprint_save

**Save Sprint**

Create or replace a sprint (id, name, startDate, endDate).

**Параметры:**

- `id`
- `name`
- `startDate`
- `endDate`

**Пример вызова:**

```json
{
  "name": "project_sprint_save",
  "arguments": {
    "id": "00000000-0000-0000-0000-000000000000",
    "name": "example",
    "startDate": "example",
    "endDate": "example"
  }
}
```

## project_statuses_get

**Get Project Statuses**

Get the project status set, close status and allowed initial statuses. New projects use the default four statuses.

**Параметры:**

- `project`

**Пример вызова:**

```json
{
  "name": "project_statuses_get",
  "arguments": {
    "project": "mcp"
  }
}
```

## project_statuses_set

**Set Project Statuses**

Replace the project status set. Statuses used by tasks cannot be removed without moveTo or moves. At least one active todo and one active done status are required.

**Параметры:**

- `project`
- `statuses`
- `moveTo`
- `moves`
- `closeStatus`
- `initialStatuses`

**Пример вызова:**

```json
{
  "name": "project_statuses_set",
  "arguments": {
    "project": "mcp",
    "statuses": "example",
    "moveTo": "example",
    "moves": "example",
    "closeStatus": "example",
    "initialStatuses": "example"
  }
}
```

## project_theme_delete

**Delete Project Theme**

Remove a team theme from project data. A member's locally copied theme is unaffected.

**Параметры:**

- `project`
- `id`

**Пример вызова:**

```json
{
  "name": "project_theme_delete",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000"
  }
}
```

## project_theme_set

**Publish Project Theme**

Create or replace a team theme in project data. Editors and admins only; max 20 themes.

**Параметры:**

- `project`
- `id`
- `name`
- `theme`

**Пример вызова:**

```json
{
  "name": "project_theme_set",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "name": "example",
    "theme": "example"
  }
}
```

## project_themes_list

**List Project Themes**

List team themes stored in project data. Every project member sees them without local import.

**Параметры:**

- `project`

**Пример вызова:**

```json
{
  "name": "project_themes_list",
  "arguments": {
    "project": "mcp"
  }
}
```

## project_transitions_get

**Get Project Transitions**

Get the allowed status transition graph. A null graph means every transition is allowed.

**Параметры:**

- `project`

**Пример вызова:**

```json
{
  "name": "project_transitions_get",
  "arguments": {
    "project": "mcp"
  }
}
```

## project_transitions_set

**Set Project Transitions**

Replace the allowed status transition graph. A missing from-key is unrestricted; use null to restore any-to-any. The graph must not leave a done status unreachable from the initial statuses.

**Параметры:**

- `project`
- `transitions`

**Пример вызова:**

```json
{
  "name": "project_transitions_set",
  "arguments": {
    "project": "mcp",
    "transitions": "example"
  }
}
```

## project_types_get

**Get Project Types**

Get the project task type set. New projects use task, bug and feature; legacy tasks without a type are treated as task.

**Параметры:**

- `project`

**Пример вызова:**

```json
{
  "name": "project_types_get",
  "arguments": {
    "project": "mcp"
  }
}
```

## project_types_set

**Set Project Types**

Replace the project task type set. A type used by tasks cannot be removed without moveTo or moves.

**Параметры:**

- `project`
- `types`
- `moveTo`
- `moves`

**Пример вызова:**

```json
{
  "name": "project_types_set",
  "arguments": {
    "project": "mcp",
    "types": "example",
    "moveTo": "example",
    "moves": "example"
  }
}
```

## project_update

**Update Project**

Update project metadata (description).

**Параметры:**

- `project`
- `description`
- `requireEvidence`

**Пример вызова:**

```json
{
  "name": "project_update",
  "arguments": {
    "project": "mcp",
    "description": "Example Description",
    "requireEvidence": "example"
  }
}
```

## prompts_ab_report

**Prompts A/B Report**

Aggregate A/B metrics and passive feedback for all prompt keys

**Параметры:**

- `project`
- `writeToDisk`

**Пример вызова:**

```json
{
  "name": "prompts_ab_report",
  "arguments": {
    "project": "mcp",
    "writeToDisk": "example"
  }
}
```

## prompts_bandit_next

**Prompts Bandit Next**

Pick next variant for a prompt using epsilon-greedy over aggregates

**Параметры:**

- `project`
- `promptKey`
- `epsilon`
- `contextTags`

**Пример вызова:**

```json
{
  "name": "prompts_bandit_next",
  "arguments": {
    "project": "mcp",
    "promptKey": "example",
    "epsilon": "example",
    "contextTags": "example"
  }
}
```

## prompts_bulk_create

**Prompts Bulk Create**

Create many prompts (writes JSON files under prompts/|rules/|workflows/|templates/|policies)

**Параметры:**

- `project`
- `items`
- `overwrite`

**Пример вызова:**

```json
{
  "name": "prompts_bulk_create",
  "arguments": {
    "project": "mcp",
    "items": "example",
    "overwrite": "example"
  }
}
```

## prompts_bulk_delete

**Prompts Bulk Delete**

Delete many prompts by id+version or by explicit path

**Параметры:**

- `project`
- `items`
- `dryRun`

**Пример вызова:**

```json
{
  "name": "prompts_bulk_delete",
  "arguments": {
    "project": "mcp",
    "items": "example",
    "dryRun": false
  }
}
```

## prompts_bulk_update

**Prompts Bulk Update**

Update many prompts found by id+version or explicit path

**Параметры:**

- `project`
- `items`

**Пример вызова:**

```json
{
  "name": "prompts_bulk_update",
  "arguments": {
    "project": "mcp",
    "items": "example"
  }
}
```

## prompts_catalog_get

**Prompts Catalog Get**

Return prompts catalog JSON if present

**Параметры:**

- `project`

**Пример вызова:**

```json
{
  "name": "prompts_catalog_get",
  "arguments": {
    "project": "mcp"
  }
}
```

## prompts_experiments_upsert

**Prompts Experiments Upsert**

Create or update experiment manifest with variants to drive variants_list and bandit

**Параметры:**

- `project`
- `promptKey`
- `variants`
- `params`

**Пример вызова:**

```json
{
  "name": "prompts_experiments_upsert",
  "arguments": {
    "project": "mcp",
    "promptKey": "example",
    "variants": "example",
    "params": "example"
  }
}
```

## prompts_exports_get

**Prompts Exports Get**

List exported prompt artifacts under exports/

**Параметры:**

- `project`
- `type`

**Пример вызова:**

```json
{
  "name": "prompts_exports_get",
  "arguments": {
    "project": "mcp",
    "type": "note"
  }
}
```

## prompts_feedback_log

**Prompts Feedback Log**

Append passive user feedback for prompts (JSONL store)

**Параметры:**

- `project`
- `promptId`
- `version`
- `variant`
- `sessionId`
- `userId`
- `inputText`
- `modelOutput`
- `userMessage`
- `userEdits`
- `signals`
- `meta`

**Пример вызова:**

```json
{
  "name": "prompts_feedback_log",
  "arguments": {
    "project": "mcp",
    "promptId": "example",
    "version": "example",
    "variant": "example",
    "sessionId": "example",
    "userId": "example",
    "inputText": "example",
    "modelOutput": "example",
    "userMessage": "example",
    "userEdits": "example",
    "signals": "example",
    "meta": "example"
  }
}
```

## prompts_feedback_validate

**Prompts Feedback Validate**

Validate feedback JSONL file and return stats/samples

**Параметры:**

- `project`
- `strict`

**Пример вызова:**

```json
{
  "name": "prompts_feedback_validate",
  "arguments": {
    "project": "mcp",
    "strict": "example"
  }
}
```

## prompts_get

**Get Prompt**

Read one prompt version with full template/compose and metadata; version defaults to the latest semver.

**Параметры:**

- `project`
- `id`
- `version`

**Пример вызова:**

```json
{
  "name": "prompts_get",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "version": "example"
  }
}
```

## prompts_list

**Prompts List**

List prompts from prompts catalog with optional filters

**Параметры:**

- `project`
- `latest`
- `kind`
- `status`
- `domain`
- `tag`
- `target`
- `limit`
- `cursor`
- `countOnly`
- `maxBytes`
- `fields`
- `compact`

**Пример вызова:**

```json
{
  "name": "prompts_list",
  "arguments": {
    "project": "mcp",
    "latest": "example",
    "kind": "example",
    "status": "pending",
    "domain": "example",
    "tag": "example",
    "target": "example",
    "limit": 10,
    "cursor": "example",
    "countOnly": "example",
    "maxBytes": "example",
    "fields": "example",
    "compact": "example"
  }
}
```

## prompts_merge_apply

**Apply Prompt Merge**

Apply a prepared merge draft to targetPath (relative to DATA_DIR). Conflicts require confirm=true.

**Параметры:**

- `draftId`
- `targetPath`
- `confirm`

**Пример вызова:**

```json
{
  "name": "prompts_merge_apply",
  "arguments": {
    "draftId": "example",
    "targetPath": "example",
    "confirm": true
  }
}
```

## prompts_merge_prepare

**Prepare Prompt Merge**

Three-way merge of base/local/remote prompt text; validates variables, !commands and allowed-tools. Returns a draft id; conflicts require confirmation on apply.

**Параметры:**

- `base`
- `local`
- `remote`

**Пример вызова:**

```json
{
  "name": "prompts_merge_prepare",
  "arguments": {
    "base": "example",
    "local": "example",
    "remote": "example"
  }
}
```

## prompts_metrics_log_bulk

**Prompts Metrics Log (Bulk)**

Append events and update aggregates for prompts (bulk)

**Параметры:**

- `project`
- `promptKey`
- `items`

**Пример вызова:**

```json
{
  "name": "prompts_metrics_log_bulk",
  "arguments": {
    "project": "mcp",
    "promptKey": "example",
    "items": "example"
  }
}
```

## prompts_search

**Prompts Search (hybrid)**

Semantic/lexical search across prompt builds and markdown

**Параметры:**

- `project`
- `query`
- `limit`
- `tags`
- `kinds`
- `target`

**Пример вызова:**

```json
{
  "name": "prompts_search",
  "arguments": {
    "project": "mcp",
    "query": "example",
    "limit": 10,
    "tags": [
      "example"
    ],
    "kinds": "example",
    "target": "example"
  }
}
```

## prompts_variants_list

**Prompts Variants List**

List available variants for a promptKey (experiment or builds)

**Параметры:**

- `project`
- `promptKey`

**Пример вызова:**

```json
{
  "name": "prompts_variants_list",
  "arguments": {
    "project": "mcp",
    "promptKey": "example"
  }
}
```

## prompts_variants_stats

**Prompts Variants Stats**

Return aggregate metrics per variant for given promptKey

**Параметры:**

- `project`
- `promptKey`

**Пример вызова:**

```json
{
  "name": "prompts_variants_stats",
  "arguments": {
    "project": "mcp",
    "promptKey": "example"
  }
}
```

## search_knowledge

**Search Knowledge**

BM25 (and optional vector) search over knowledge docs

**Параметры:**

- `project`
- `query`
- `offset`
- `snippet`
- `limit`
- `cursor`
- `countOnly`
- `maxBytes`
- `fields`
- `compact`

**Пример вызова:**

```json
{
  "name": "search_knowledge",
  "arguments": {
    "project": "mcp",
    "query": "example",
    "offset": "example",
    "snippet": "example",
    "limit": 10,
    "cursor": "example",
    "countOnly": "example",
    "maxBytes": "example",
    "fields": "example",
    "compact": "example"
  }
}
```

## search_tasks

**Search Tasks**

BM25 (and optional vector) search over tasks

**Параметры:**

- `project`
- `query`
- `limit`
- `cursor`
- `countOnly`
- `maxBytes`
- `fields`
- `compact`
- `type`

**Пример вызова:**

```json
{
  "name": "search_tasks",
  "arguments": {
    "project": "mcp",
    "query": "example",
    "limit": 10,
    "cursor": "example",
    "countOnly": "example",
    "maxBytes": "example",
    "fields": "example",
    "compact": "example",
    "type": "note"
  }
}
```

## service_catalog_health

**Service Catalog Health**

Check health of the configured service-catalog source (remote/embedded)

**Пример вызова:**

```json
{
  "name": "service_catalog_health",
  "arguments": {}
}
```

## service_catalog_query

**Service Catalog Query**

Query services from the service-catalog (supports filters, sort, pagination)

**Параметры:**

- `search`
- `component`
- `owner`
- `tag`
- `domain`
- `status`
- `updatedFrom`
- `updatedTo`
- `sort`
- `page`
- `pageSize`

**Пример вызова:**

```json
{
  "name": "service_catalog_query",
  "arguments": {
    "search": "example",
    "component": "example",
    "owner": "example",
    "tag": "example",
    "domain": "example",
    "status": "pending",
    "updatedFrom": "2025-01-01T00:00:00Z",
    "updatedTo": "2025-12-31T23:59:59Z",
    "sort": "example",
    "page": "example",
    "pageSize": "example"
  }
}
```

## session_info

**Session Info**

Query session state for a specific session ID. Returns rate limit info, TTL, idle timeout, session age, and creation time. If SessionManager is not available (e.g. stdio mode), returns availability status only.

**Параметры:**

- `sessionId`

**Пример вызова:**

```json
{
  "name": "session_info",
  "arguments": {
    "sessionId": "example"
  }
}
```

## session_kill

**Terminate Session**

Terminate another live MCP session (admin only). The session disappears from session_list; the caller cannot terminate itself.

**Параметры:**

- `sessionId`

**Пример вызова:**

```json
{
  "name": "session_kill",
  "arguments": {
    "sessionId": "example"
  }
}
```

## session_list

**Session List**

List all active sessions with their state. Returns session count, rate limiting status, and per-session details (rate limit, TTL, idle, age). If SessionManager is not available, returns availability status only.

**Пример вызова:**

```json
{
  "name": "session_list",
  "arguments": {}
}
```

## skills_diff

**Skill Diff**

Show the diff of one commit for a skill.

**Параметры:**

- `project`
- `id`
- `commit`

**Пример вызова:**

```json
{
  "name": "skills_diff",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "commit": "example"
  }
}
```

## skills_history

**Skill History**

List git commits that touched a skill in DATA_DIR.

**Параметры:**

- `project`
- `id`
- `limit`

**Пример вызова:**

```json
{
  "name": "skills_history",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "limit": 10
  }
}
```

## skills_version_restore

**Skill Restore**

Restore a skill from a commit as a new commit (history is not erased).

**Параметры:**

- `project`
- `id`
- `commit`

**Пример вызова:**

```json
{
  "name": "skills_version_restore",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "commit": "example"
  }
}
```

## task_document_links_get

**Get Task/Document Links**

Read bidirectional links by task or document.

**Параметры:**

- `project`
- `taskId`
- `docId`

**Пример вызова:**

```json
{
  "name": "task_document_links_get",
  "arguments": {
    "project": "mcp",
    "taskId": "example",
    "docId": "example"
  }
}
```

## task_document_links_set

**Link Task/Document**

Set bidirectional links for one document and the listed tasks; removes stale doc links from other tasks.

**Параметры:**

- `project`
- `docId`
- `taskIds`

**Пример вызова:**

```json
{
  "name": "task_document_links_set",
  "arguments": {
    "project": "mcp",
    "docId": "example",
    "taskIds": "example"
  }
}
```

## tasks_add_subtask

**Add Subtask**

Create a subtask under a parent task. Shorthand for tasks_create with parentId. Maximum nesting depth is 10 levels.

**Параметры:**

- `project`
- `parentId`
- `title`
- `description`
- `priority`
- `type`
- `tags`
- `links`

**Пример вызова:**

```json
{
  "name": "tasks_add_subtask",
  "arguments": {
    "project": "mcp",
    "parentId": null,
    "title": "Example Title",
    "description": "Example Description",
    "priority": "medium",
    "type": "note",
    "tags": [
      "example"
    ],
    "links": [
      "https://example.com"
    ]
  }
}
```

## tasks_board

**Render Task Board**

Render the saved board: columns by query + swimlane counts. Falls back to one column per distinct status.

**Параметры:**

- `project`
- `includeArchived`

**Пример вызова:**

```json
{
  "name": "tasks_board",
  "arguments": {
    "project": "mcp",
    "includeArchived": false
  }
}
```

## tasks_bulk_archive

**Bulk Archive Tasks**

Archive many tasks

**Параметры:**

- `project`
- `ids`

**Пример вызова:**

```json
{
  "name": "tasks_bulk_archive",
  "arguments": {
    "project": "mcp",
    "ids": [
      "00000000-0000-0000-0000-000000000000"
    ]
  }
}
```

## tasks_bulk_close

**Bulk Close Tasks**

Mark many tasks as closed

**Параметры:**

- `project`
- `ids`

**Пример вызова:**

```json
{
  "name": "tasks_bulk_close",
  "arguments": {
    "project": "mcp",
    "ids": [
      "00000000-0000-0000-0000-000000000000"
    ]
  }
}
```

## tasks_bulk_create

**Bulk Create Tasks**

Create many tasks at once (optionally hierarchical via parentId)

**Параметры:**

- `fields`
- `compact`
- `project`
- `items`

**Пример вызова:**

```json
{
  "name": "tasks_bulk_create",
  "arguments": {
    "fields": "example",
    "compact": "example",
    "project": "mcp",
    "items": "example"
  }
}
```

## tasks_bulk_delete_permanent

**Bulk Delete Tasks Permanently**

Permanently delete many tasks (use with caution)

**Параметры:**

- `project`
- `ids`
- `confirm`
- `dryRun`

**Пример вызова:**

```json
{
  "name": "tasks_bulk_delete_permanent",
  "arguments": {
    "project": "mcp",
    "ids": [
      "00000000-0000-0000-0000-000000000000"
    ],
    "confirm": true,
    "dryRun": false
  }
}
```

## tasks_bulk_restore

**Bulk Restore Tasks**

Restore many tasks from archive/trash

**Параметры:**

- `project`
- `ids`

**Пример вызова:**

```json
{
  "name": "tasks_bulk_restore",
  "arguments": {
    "project": "mcp",
    "ids": [
      "00000000-0000-0000-0000-000000000000"
    ]
  }
}
```

## tasks_bulk_trash

**Bulk Trash Tasks**

Move many tasks to trash

**Параметры:**

- `project`
- `ids`

**Пример вызова:**

```json
{
  "name": "tasks_bulk_trash",
  "arguments": {
    "project": "mcp",
    "ids": [
      "00000000-0000-0000-0000-000000000000"
    ]
  }
}
```

## tasks_bulk_update

**Bulk Update Tasks**

Update fields of many tasks at once

**Параметры:**

- `fields`
- `compact`
- `project`
- `items`

**Пример вызова:**

```json
{
  "name": "tasks_bulk_update",
  "arguments": {
    "fields": "example",
    "compact": "example",
    "project": "mcp",
    "items": "example"
  }
}
```

## tasks_claim

**Claim Task**

Take a lease on a task so a second agent does not start the same work. The holder is visible to others (bySessionId/byUserId/client/expiresAt). Re-claiming your own task renews the lease; a foreign active claim is rejected with code TASK_CLAIMED. Expired claims never block. Renewals do not change the task content revision (updatedAt/version).

**Параметры:**

- `project`
- `id`
- `ttlSec`
- `client`

**Пример вызова:**

```json
{
  "name": "tasks_claim",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "ttlSec": "example",
    "client": "example"
  }
}
```

## tasks_close

**Close Task**

Close a task by moving it to the project's close status. Optionally cascade the close to all descendants (subtasks, sub-subtasks, etc.).

**Параметры:**

- `project`
- `id`
- `cascade`
- `evidence`

**Пример вызова:**

```json
{
  "name": "tasks_close",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "cascade": "example",
    "evidence": "example"
  }
}
```

## tasks_create

**Create Task**

Create a single task. Optionally set parentId to create a subtask. Maximum nesting depth is 10 levels.

**Параметры:**

- `project`
- `title`
- `description`
- `priority`
- `status`
- `type`
- `tags`
- `links`
- `parentId`
- `dependsOn`
- `fields`
- `compact`

**Пример вызова:**

```json
{
  "name": "tasks_create",
  "arguments": {
    "project": "mcp",
    "title": "Example Title",
    "description": "Example Description",
    "priority": "medium",
    "status": "pending",
    "type": "note",
    "tags": [
      "example"
    ],
    "links": [
      "https://example.com"
    ],
    "parentId": null,
    "dependsOn": "example",
    "fields": "example",
    "compact": "example"
  }
}
```

## tasks_dag

**Get Project Dependency Graph**

Get the dependency DAG for a project: topological sort, critical path and edge list. Supports tag and onlyWithDeps filters, a page over the topological order (default limit 200), field projection and a cursor; `truncated`/`nextCursor` describe what is missing, and edges/criticalPath only contain the nodes on the returned page.

**Параметры:**

- `project`
- `includeArchived`
- `tag`
- `onlyWithDeps`
- `limit`
- `cursor`
- `countOnly`
- `maxBytes`
- `fields`
- `compact`

**Пример вызова:**

```json
{
  "name": "tasks_dag",
  "arguments": {
    "project": "mcp",
    "includeArchived": false,
    "tag": "example",
    "onlyWithDeps": "example",
    "limit": 10,
    "cursor": "example",
    "countOnly": "example",
    "maxBytes": "example",
    "fields": "example",
    "compact": "example"
  }
}
```

## tasks_diff

**Task Diff**

Show the diff of one commit for a task.

**Параметры:**

- `project`
- `id`
- `commit`

**Пример вызова:**

```json
{
  "name": "tasks_diff",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "commit": "example"
  }
}
```

## tasks_get

**Get Task**

Get task by id. Includes the active claim/lease holder when the task is claimed.

**Параметры:**

- `project`
- `id`
- `includeGraphMetrics`
- `fields`
- `compact`

**Пример вызова:**

```json
{
  "name": "tasks_get",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "includeGraphMetrics": "example",
    "fields": "example",
    "compact": "example"
  }
}
```

## tasks_get_children

**Get Task Children**

Get direct children of a task (one level deep, not recursive).

**Параметры:**

- `project`
- `id`
- `limit`
- `cursor`
- `countOnly`
- `maxBytes`
- `fields`
- `compact`

**Пример вызова:**

```json
{
  "name": "tasks_get_children",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "limit": 10,
    "cursor": "example",
    "countOnly": "example",
    "maxBytes": "example",
    "fields": "example",
    "compact": "example"
  }
}
```

## tasks_get_deps

**Get Task Dependencies**

Get the dependency graph for a specific task: what it depends on and what depends on it.

**Параметры:**

- `project`
- `id`

**Пример вызова:**

```json
{
  "name": "tasks_get_deps",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000"
  }
}
```

## tasks_get_subtree

**Get Task Subtree**

Get a specific task and all its descendants as a hierarchical tree. Useful for inspecting a branch of the task hierarchy.

**Параметры:**

- `project`
- `id`
- `maxDepth`

**Пример вызова:**

```json
{
  "name": "tasks_get_subtree",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "maxDepth": "example"
  }
}
```

## tasks_history

**Task History**

List git commits that touched a task in DATA_DIR.

**Параметры:**

- `project`
- `id`
- `limit`

**Пример вызова:**

```json
{
  "name": "tasks_history",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "limit": 10
  }
}
```

## tasks_list

**List Tasks**

List tasks with optional filters, cursor pagination and field selection. Returns `data` (array) plus total/count/hasMore/nextCursor/truncated/limit. Includes the active claim/lease holder when a task is claimed.

**Параметры:**

- `project`
- `status`
- `type`
- `tag`
- `priority`
- `parentId`
- `updatedSince`
- `ids`
- `codes`
- `includeArchived`
- `includeGraphMetrics`
- `groupByStatus`
- `offsets`
- `limit`
- `cursor`
- `countOnly`
- `maxBytes`
- `fields`
- `compact`

**Пример вызова:**

```json
{
  "name": "tasks_list",
  "arguments": {
    "project": "mcp",
    "status": "pending",
    "type": "note",
    "tag": "example",
    "priority": "medium",
    "parentId": null,
    "updatedSince": "example",
    "ids": [
      "00000000-0000-0000-0000-000000000000"
    ],
    "codes": "example",
    "includeArchived": false,
    "includeGraphMetrics": "example",
    "groupByStatus": "example",
    "offsets": "example",
    "limit": 10,
    "cursor": "example",
    "countOnly": "example",
    "maxBytes": "example",
    "fields": "example",
    "compact": "example"
  }
}
```

## tasks_query

**Tasks Query**

Query tasks with the TK-02 language: `project: X #tag status: Doing assignee: me`, AND/OR/NOT, parentheses, quoted values, sort by: updated|created|priority|title.

**Параметры:**

- `query`
- `project`
- `includeArchived`
- `limit`

**Пример вызова:**

```json
{
  "name": "tasks_query",
  "arguments": {
    "query": "example",
    "project": "mcp",
    "includeArchived": false,
    "limit": 10
  }
}
```

## tasks_recurring_delete

**Delete Recurring Task**

Delete a recurring definition.

**Параметры:**

- `id`

**Пример вызова:**

```json
{
  "name": "tasks_recurring_delete",
  "arguments": {
    "id": "00000000-0000-0000-0000-000000000000"
  }
}
```

## tasks_recurring_list

**Recurring Tasks**

List recurring definitions and next run.

**Пример вызова:**

```json
{
  "name": "tasks_recurring_list",
  "arguments": {}
}
```

## tasks_recurring_save

**Save Recurring Task**

Create or replace a recurring definition (daily/weekly/monthly, UTC time, optional templateId).

**Параметры:**

- `id`
- `project`
- `title`
- `templateId`
- `schedule`
- `nextAt`

**Пример вызова:**

```json
{
  "name": "tasks_recurring_save",
  "arguments": {
    "id": "00000000-0000-0000-0000-000000000000",
    "project": "mcp",
    "title": "Example Title",
    "templateId": "example",
    "schedule": "example",
    "nextAt": "example"
  }
}
```

## tasks_recurring_tick

**Tick Recurring Tasks**

Create due instances exactly once per occurrence (idempotent across restarts). Safe to call repeatedly.

**Параметры:**

- `now`

**Пример вызова:**

```json
{
  "name": "tasks_recurring_tick",
  "arguments": {
    "now": "example"
  }
}
```

## tasks_release

**Release Task Claim**

Release your lease so another agent can pick the task up. Only the holder may release before expiry; an expired claim is cleaned up by anyone. Releasing a free task is idempotent (released:false, alreadyFree:true).

**Параметры:**

- `project`
- `id`

**Пример вызова:**

```json
{
  "name": "tasks_release",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000"
  }
}
```

## tasks_renew

**Renew Task Claim**

Extend your lease on a claimed task (heartbeat). Only the current holder may renew. Renewals do not change updatedAt/version, so they never invalidate another client's optimistic lock. Returns TASK_NOT_CLAIMED when the lease is absent or has expired, TASK_CLAIMED when held by someone else.

**Параметры:**

- `project`
- `id`
- `ttlSec`

**Пример вызова:**

```json
{
  "name": "tasks_renew",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "ttlSec": "example"
  }
}
```

## tasks_saved_search_delete

**Delete Saved Search**

Delete a saved query by name.

**Параметры:**

- `name`

**Пример вызова:**

```json
{
  "name": "tasks_saved_search_delete",
  "arguments": {
    "name": "example"
  }
}
```

## tasks_saved_search_list

**Saved Searches**

List saved task queries.

**Пример вызова:**

```json
{
  "name": "tasks_saved_search_list",
  "arguments": {}
}
```

## tasks_saved_search_save

**Save Search**

Create or replace a named saved query.

**Параметры:**

- `name`
- `query`
- `project`

**Пример вызова:**

```json
{
  "name": "tasks_saved_search_save",
  "arguments": {
    "name": "example",
    "query": "example",
    "project": "mcp"
  }
}
```

## tasks_set_deps

**Set Task Dependencies**

Set or replace dependency list for a task. Validates no cycles. Returns task, statusChanged, blockedByDeps and blockingDeps. Tasks in the todo category with unmet dependencies are marked "blocked" unless markBlocked is false.

**Параметры:**

- `project`
- `id`
- `dependsOn`
- `markBlocked`
- `fields`
- `compact`

**Пример вызова:**

```json
{
  "name": "tasks_set_deps",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "dependsOn": "example",
    "markBlocked": "example",
    "fields": "example",
    "compact": "example"
  }
}
```

## tasks_sprint_assign

**Assign Sprint**

Assign tasks to a sprint; sprintId=null clears membership.

**Параметры:**

- `project`
- `ids`
- `sprintId`

**Пример вызова:**

```json
{
  "name": "tasks_sprint_assign",
  "arguments": {
    "project": "mcp",
    "ids": [
      "00000000-0000-0000-0000-000000000000"
    ],
    "sprintId": "example"
  }
}
```

## tasks_template_delete

**Delete Task Template**

Delete a template by id.

**Параметры:**

- `id`

**Пример вызова:**

```json
{
  "name": "tasks_template_delete",
  "arguments": {
    "id": "00000000-0000-0000-0000-000000000000"
  }
}
```

## tasks_template_list

**Task Templates**

List task templates.

**Пример вызова:**

```json
{
  "name": "tasks_template_list",
  "arguments": {}
}
```

## tasks_template_save

**Save Task Template**

Create or replace a task template with default fields (priority/type/tags/description/links).

**Параметры:**

- `id`
- `name`
- `defaults`

**Пример вызова:**

```json
{
  "name": "tasks_template_save",
  "arguments": {
    "id": "00000000-0000-0000-0000-000000000000",
    "name": "example",
    "defaults": "example"
  }
}
```

## tasks_tree

**List Tasks Tree**

List tasks as a hierarchical tree (by parentId). Pagination applies to ROOT nodes (children of a returned root are always included).

**Параметры:**

- `project`
- `status`
- `type`
- `tag`
- `includeArchived`
- `limit`
- `cursor`
- `countOnly`
- `maxBytes`
- `fields`
- `compact`

**Пример вызова:**

```json
{
  "name": "tasks_tree",
  "arguments": {
    "project": "mcp",
    "status": "pending",
    "type": "note",
    "tag": "example",
    "includeArchived": false,
    "limit": 10,
    "cursor": "example",
    "countOnly": "example",
    "maxBytes": "example",
    "fields": "example",
    "compact": "example"
  }
}
```

## tasks_update

**Update Task**

Update a single task by id. Can change any field except id, project, createdAt. Setting parentId moves the task in the hierarchy (cycle and depth protected). Set parentId to null to detach from parent (make root).

**Параметры:**

- `project`
- `id`
- `title`
- `description`
- `priority`
- `status`
- `type`
- `tags`
- `links`
- `parentId`
- `dependsOn`
- `expectedVersion`
- `fields`
- `compact`

**Пример вызова:**

```json
{
  "name": "tasks_update",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "title": "Example Title",
    "description": "Example Description",
    "priority": "medium",
    "status": "pending",
    "type": "note",
    "tags": [
      "example"
    ],
    "links": [
      "https://example.com"
    ],
    "parentId": null,
    "dependsOn": "example",
    "expectedVersion": "example",
    "fields": "example",
    "compact": "example"
  }
}
```

## tasks_version_restore

**Task Restore**

Restore a task from a commit as a new commit (history is not erased).

**Параметры:**

- `project`
- `id`
- `commit`

**Пример вызова:**

```json
{
  "name": "tasks_version_restore",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "commit": "example"
  }
}
```

## tool_help

**Tool Help**

Short help for a tool with an example call

**Параметры:**

- `name`

**Пример вызова:**

```json
{
  "name": "tool_help",
  "arguments": {
    "name": "example"
  }
}
```

## tool_schema

**Tool Schema**

Return metadata and example payload for a tool name

**Параметры:**

- `name`

**Пример вызова:**

```json
{
  "name": "tool_schema",
  "arguments": {
    "name": "example"
  }
}
```

## tools_batch

**Tools Batch (Parallel)**

Execute multiple tools in parallel (Promise.all). Returns aggregated results. Unlike tools_run (sequential), all calls fire simultaneously. Use for independent read operations (e.g., tasks_list + knowledge_list + search).

**Параметры:**

- `items`

**Пример вызова:**

```json
{
  "name": "tools_batch",
  "arguments": {
    "items": "example"
  }
}
```

## tools_list

**List Registered Tools**

Return list of canonical tool names with metadata. Supports pagination, search filtering, ETag-based cache validation.

**Параметры:**

- `offset`
- `limit`
- `search`
- `ifNoneMatch`

**Пример вызова:**

```json
{
  "name": "tools_list",
  "arguments": {
    "offset": "example",
    "limit": 10,
    "search": "example",
    "ifNoneMatch": "example"
  }
}
```

## tools_register

**Register Tool**

Hot-register a new tool at runtime without restarting the server. The handler is defined as a JSON expression: for a simple echo tool use `handler: "echo"` (returns { input }). Experimental (DX-001).

**Параметры:**

- `name`
- `title`
- `description`
- `inputSchema`
- `handlerKind`

**Пример вызова:**

```json
{
  "name": "tools_register",
  "arguments": {
    "name": "example",
    "title": "Example Title",
    "description": "Example Description",
    "inputSchema": "example",
    "handlerKind": "example"
  }
}
```

## tools_run

**Tools Run (Bulk)**

Execute one or many tools by name with params via RPC.

**Параметры:**

- `name`
- `params`
- `items`
- `stopOnError`

**Пример вызова:**

```json
{
  "name": "tools_run",
  "arguments": {
    "name": "example",
    "params": "example",
    "items": "example",
    "stopOnError": "example"
  }
}
```

## tools_unregister

**Unregister Tool**

Hot-remove a tool at runtime (DX-001). Experimental.

**Параметры:**

- `name`

**Пример вызова:**

```json
{
  "name": "tools_unregister",
  "arguments": {
    "name": "example"
  }
}
```
