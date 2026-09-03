# MCP Tools (76)

All tools registered in the MCP server, grouped by category.

## Tasks (19 tools)

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
| `tasks_dag` | Get DAG visualization data |
| `tasks_bulk_create` | Bulk create tasks |
| `tasks_bulk_update` | Bulk update tasks |
| `tasks_bulk_close` | Bulk close tasks |
| `tasks_bulk_archive` | Bulk archive tasks |
| `tasks_bulk_trash` | Bulk trash tasks |
| `tasks_bulk_restore` | Bulk restore tasks |
| `tasks_bulk_delete_permanent` | Bulk permanently delete tasks |

## Knowledge (14 tools)

| Tool | Description |
|------|-------------|
| `knowledge_list` | List documents with filters |
| `knowledge_get` | Get document by ID (with content) |
| `knowledge_tree` | Get document tree |
| `knowledge_import_markdown` | Import Markdown file as knowledge doc |
| `knowledge_import_single` | Import single Markdown file |
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

## Memory (24 tools)

See [Agent Memory](agent-memory.md) for full reference.

| Tool | Description |
|------|-------------|
| `memory_extract` | Extract facts from conversation transcript |
| `memory_facts_list` | List extracted memory facts |
| `memory_facts_search` | Search memory facts by keyword |
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

## Projects (8 tools)

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

## Sessions (2 tools)

| Tool | Description |
|------|-------------|
| `session_info` | Get current session info (rate limit, TTL, idle timeout) |
| `session_list` | List active sessions |

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

## Embeddings (2 tools)

| Tool | Description |
|------|-------------|
| `embeddings_status` | Get embeddings model status (loaded, mode, model) |
| `embeddings_try_init` | Attempt to initialize embeddings model |

## Graph (1 tool)

| Tool | Description |
|------|-------------|
| `graph_export_mermaid` | Export entity graph as Mermaid diagram |

## Introspection & Tools (7 tools)

| Tool | Description |
|------|-------------|
| `tools_list` | List all registered tools |
| `tool_schema` | Get tool JSON schema |
| `tool_help` | Get tool help text |
| `tools_run` | Run a single tool by name |
| `tools_batch` | Run multiple tools in parallel (batch) |
| `tools_register` | Hot-register a new tool at runtime |
| `tools_unregister` | Unregister a tool at runtime |

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

## Total: 101 tools + 6 resources
