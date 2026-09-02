# MCP Tools (109+)

All tools are available via MCP protocol. Categories:

## Tasks (15 tools)

| Tool | Description |
|------|-------------|
| `tasks_create` | Create a task with title, priority, tags, parentId |
| `tasks_list` | List tasks with filters (project, status, tag) |
| `tasks_get` | Get task by ID |
| `tasks_update` | Update task fields (title, status, priority, tags) |
| `tasks_close` | Close a task |
| `tasks_add_subtask` | Add subtask (parentId) |
| `tasks_get_children` | Get direct children |
| `tasks_get_subtree` | Get full subtree |
| `tasks_tree` | Get task tree for project |
| `tasks_set_deps` | Set task dependencies (DAG) |
| `tasks_get_deps` | Get dependency graph |
| `tasks_bulk_*` | Bulk create/update/close/archive/trash/restore/delete |
| `tasks_delete_permanent` | Permanently delete a task |

## Knowledge (12 tools)

| Tool | Description |
|------|-------------|
| `knowledge_list` | List documents with filters |
| `knowledge_get` | Get document by ID (with content) |
| `knowledge_bulk_create` | Create multiple documents |
| `knowledge_bulk_update` | Update multiple documents |
| `knowledge_bulk_*` | Bulk archive/trash/restore/delete |
| `knowledge_tree` | Get document tree |
| `knowledge_import_markdown` | Import Markdown file as knowledge doc |
| `knowledge_export_markdown` | Export doc as Markdown |
| `knowledge_export_bundle` | Export all docs as bundle |

## Search (4 tools)

| Tool | Description |
|------|-------------|
| `search_tasks` | Search tasks (BM25 + vector hybrid) |
| `search_knowledge` | Search knowledge docs (BM25 + vector) |
| `mcp1_search_knowledge_two_stage` | Two-stage rerank search |
| `query_memory` | FTS5 full-text search (SQLite) |

## Memory (33 tools)

See [Agent Memory](agent-memory.md) for full reference.

| Tool | Description |
|------|-------------|
| `memory_extract` | Extract facts from conversation transcript |
| `memory_facts_list` | List extracted memory facts |
| `memory_facts_search` | Search memory facts by keyword |
| `memory_temporal_add` | Add fact to temporal graph |
| `memory_temporal_query` | Query facts at point in time |
| `memory_temporal_invalidate` | Invalidate a fact |
| `memory_temporal_history` | Get fact history chain |
| `memory_temporal_stats` | Graph statistics |
| `memory_profile_get` | Get user profile |
| `memory_profile_update` | Update user profile |
| `memory_profile_context` | Get always-on profile context |
| `memory_context_assemble` | Assemble token-budget-aware context |
| `memory_entity_search` | Entity-linking retrieval |
| `memory_evolve` | Evolve existing memories (A-MEM) |
| `memory_check_conflicts` | Detect contradictions |
| `memory_gc` | Garbage collect expired facts |
| `memory_scope_filter` | Filter by scope (user/agent/app/run) |
| `memory_scope_tags` | Get scope tags |
| `memory_layer_add` | Add to memory layer (conversation/session/user) |
| `memory_layer_list` | List memory layer items |
| `memory_layer_promote` | Promote between layers |
| `memory_layer_stats` | Layer statistics |
| `memory_dream` | Run dreaming agent (dedup/merge/summarise) |
| `memory_observations` | Detect patterns from graph |

## Prompts (14 tools)

| Tool | Description |
|------|-------------|
| `prompts_list` | List prompts |
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

## Projects (9 tools)

| Tool | Description |
|------|-------------|
| `project_list` | List all projects |
| `project_create` | Create a project |
| `project_update` | Update project settings |
| `project_delete` | Delete a project |
| `project_get_current` | Get current project |
| `project_set_current` | Set current project |
| `project_info` | Get project info |
| `project_purge` | Purge project data |

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

## Introspection (4 tools)

| Tool | Description |
|------|-------------|
| `tools_list` | List all registered tools |
| `tool_schema` | Get tool JSON schema |
| `tool_help` | Get tool help text |
| `tools_run` | Run multiple tools in batch |
| `tools_catalog` | Get full tool catalog |

## Connectors (18+ tools)

| Tool | Description |
|------|-------------|
| `github_*` | GitHub issues, PRs, commits, code search |
| `jira_*` | Jira/YouTrack issue sync |
| `slack_*` | Slack messages, search, notifications |
| `gdrive_*` | Google Drive files, sync |
| `gmail_*` | Gmail messages, sync |
| `notion_*` | Notion pages, databases |
| `onedrive_*` | OneDrive files, sync |
| `linear_*` | Linear issues, sync |
| `webcrawler_*` | Web page fetch, site crawl |
