# API Reference

> Автогенерировано из live MCP-сервера (D-001). Пересборка: `npm run api:reference`.

Всего инструментов: **76**

## Инструменты

| Инструмент | Описание |
|------------|-----------|
| `dashboard_activity` | Get a chronological activity feed of recent task and knowledge changes. Useful for dashboards and st |
| `dashboard_project_summary` | Get a summary across all projects: task counts, knowledge counts, and top metrics per project. |
| `dashboard_stats` | Get project statistics: task counts by status/priority, knowledge counts, tag distribution, averages |
| `dashboard_trends` | Get task creation and completion trends over time. Returns daily or weekly buckets for burndown/burn |
| `embeddings_status` | Show current embeddings configuration and mode |
| `embeddings_try_init` | Force lazy initialization of vector adapter and return diagnostics |
| `graph_export_mermaid` | Build a Mermaid graph from tasks and knowledge (nodes + parent edges) |
| `knowledge_bulk_archive` | Archive many knowledge docs |
| `knowledge_bulk_create` | Create many knowledge docs at once (optionally hierarchical via parentId) |
| `knowledge_bulk_delete_permanent` | Permanently delete many knowledge docs (use with caution) |
| `knowledge_bulk_restore` | Restore many knowledge docs from archive/trash |
| `knowledge_bulk_trash` | Move many knowledge docs to trash |
| `knowledge_bulk_update` | Update fields of many knowledge docs at once |
| `knowledge_export_bundle` | Export knowledge docs as a single concatenated markdown string. Docs are separated by horizontal rul |
| `knowledge_export_markdown` | Export knowledge docs from a project to a directory as individual .md files with frontmatter. Each f |
| `knowledge_export_single` | Export a single knowledge document as a markdown string with YAML frontmatter. Returns the full mark |
| `knowledge_get` | Read a knowledge document by id |
| `knowledge_import_markdown` | Import .md files from a directory into the knowledge base. Files can have YAML frontmatter (title, t |
| `knowledge_import_single` | Import a single markdown document into the knowledge base. The markdown can contain YAML frontmatter |
| `knowledge_list` | List knowledge documents metadata |
| `knowledge_tree` | List knowledge documents as a hierarchical tree (by parentId) |
| `mcp1_search_knowledge_two_stage` | Two-stage search: Stage1 BM25 over docs (prefilter), Stage2 chunked hybrid within top-M long docs. C |
| `obsidian_export_project` | Export knowledge, tasks, and prompts to Obsidian vault (merge or replace). Use with caution in repla |
| `obsidian_import_project` | Import knowledge, tasks, and prompts from Obsidian vault. Replace strategy deletes existing content  |
| `project_create` | Create a new project with optional description. Creates task and knowledge directories automatically |
| `project_delete` | Delete a project and all its data. Requires force=true if project has tasks or knowledge entries. |
| `project_get_current` | Return the name of the current project context |
| `project_info` | Get detailed information about a project: task stats by status/priority, knowledge stats by type, re |
| `project_list` | List all available projects with task and knowledge counts, descriptions, and creation dates. |
| `project_purge` | Enumerate and permanently delete ALL tasks and/or knowledge in the project. Requires confirm=true un |
| `project_set_current` | Change the current project context used when project is omitted |
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
| `prompts_list` | List prompts from prompts catalog with optional filters |
| `prompts_metrics_log_bulk` | Append events and update aggregates for prompts (bulk) |
| `prompts_search` | Semantic/lexical search across prompt builds and markdown |
| `prompts_variants_list` | List available variants for a promptKey (experiment or builds) |
| `prompts_variants_stats` | Return aggregate metrics per variant for given promptKey |
| `search_knowledge` | BM25 (and optional vector) search over knowledge docs |
| `search_tasks` | BM25 (and optional vector) search over tasks |
| `service_catalog_health` | Check health of the configured service-catalog source (remote/embedded) |
| `service_catalog_query` | Query services from the service-catalog (supports filters, sort, pagination) |
| `session_info` | Query session state for a specific session ID. Returns rate limit info, TTL, idle timeout, session a |
| `session_list` | List all active sessions with their state. Returns session count, rate limiting status, and per-sess |
| `tasks_add_subtask` | Create a subtask under a parent task. Shorthand for tasks_create with parentId. Maximum nesting dept |
| `tasks_bulk_archive` | Archive many tasks |
| `tasks_bulk_close` | Mark many tasks as closed |
| `tasks_bulk_create` | Create many tasks at once (optionally hierarchical via parentId) |
| `tasks_bulk_delete_permanent` | Permanently delete many tasks (use with caution) |
| `tasks_bulk_restore` | Restore many tasks from archive/trash |
| `tasks_bulk_trash` | Move many tasks to trash |
| `tasks_bulk_update` | Update fields of many tasks at once |
| `tasks_close` | Close a task by setting its status to 'closed'. Optionally cascade the close to all descendants (sub |
| `tasks_create` | Create a single task. Optionally set parentId to create a subtask. Maximum nesting depth is 10 level |
| `tasks_dag` | Get the full dependency DAG for a project: topological sort, critical path, and edge list. |
| `tasks_get` | Get task by id |
| `tasks_get_children` | Get direct children of a task (one level deep, not recursive). |
| `tasks_get_deps` | Get the dependency graph for a specific task: what it depends on and what depends on it. |
| `tasks_get_subtree` | Get a specific task and all its descendants as a hierarchical tree. Useful for inspecting a branch o |
| `tasks_list` | List tasks with optional filters |
| `tasks_set_deps` | Set or replace dependency list for a task. Validates no cycles. Tasks with unmet dependencies are au |
| `tasks_tree` | List tasks as a hierarchical tree (by parentId) |
| `tasks_update` | Update a single task by id. Can change any field except id, project, createdAt. Setting parentId mov |
| `tool_help` | Short help for a tool with an example call |
| `tool_schema` | Return metadata and example payload for a tool name |
| `tools_list` | Return list of canonical tool names with metadata. Supports pagination, search filtering, ETag-based |
| `tools_run` | Execute one or many tools by name with params via RPC. |

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

- `project`
- `items`

**Пример вызова:**

```json
{
  "name": "knowledge_bulk_create",
  "arguments": {
    "project": "mcp",
    "items": "example"
  }
}
```

## knowledge_bulk_delete_permanent

**Bulk Delete Knowledge Docs Permanently**

Permanently delete many knowledge docs (use with caution)

**Параметры:**

- `project`
- `ids`

**Пример вызова:**

```json
{
  "name": "knowledge_bulk_delete_permanent",
  "arguments": {
    "project": "mcp",
    "ids": [
      "00000000-0000-0000-0000-000000000000"
    ]
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

- `project`
- `items`

**Пример вызова:**

```json
{
  "name": "knowledge_bulk_update",
  "arguments": {
    "project": "mcp",
    "items": "example"
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

**Пример вызова:**

```json
{
  "name": "knowledge_get",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000"
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
    "dryRun": false
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
    "parentId": null
  }
}
```

## knowledge_list

**List Knowledge Docs**

List knowledge documents metadata

**Параметры:**

- `project`
- `tag`

**Пример вызова:**

```json
{
  "name": "knowledge_list",
  "arguments": {
    "project": "mcp",
    "tag": "example"
  }
}
```

## knowledge_tree

**Knowledge Tree**

List knowledge documents as a hierarchical tree (by parentId)

**Параметры:**

- `project`
- `includeArchived`

**Пример вызова:**

```json
{
  "name": "knowledge_tree",
  "arguments": {
    "project": "mcp",
    "includeArchived": false
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

Return the name of the current project context

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

Change the current project context used when project is omitted

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

## project_update

**Update Project**

Update project metadata (description).

**Параметры:**

- `project`
- `description`

**Пример вызова:**

```json
{
  "name": "project_update",
  "arguments": {
    "project": "mcp",
    "description": "Example Description"
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
    "tag": "example"
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
    "kinds": "example"
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
- `limit`

**Пример вызова:**

```json
{
  "name": "search_knowledge",
  "arguments": {
    "project": "mcp",
    "query": "example",
    "limit": 10
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

**Пример вызова:**

```json
{
  "name": "search_tasks",
  "arguments": {
    "project": "mcp",
    "query": "example",
    "limit": 10
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

## tasks_add_subtask

**Add Subtask**

Create a subtask under a parent task. Shorthand for tasks_create with parentId. Maximum nesting depth is 10 levels.

**Параметры:**

- `project`
- `parentId`
- `title`
- `description`
- `priority`
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
    "tags": [
      "example"
    ],
    "links": [
      "https://example.com"
    ]
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

- `project`
- `items`

**Пример вызова:**

```json
{
  "name": "tasks_bulk_create",
  "arguments": {
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

- `project`
- `items`

**Пример вызова:**

```json
{
  "name": "tasks_bulk_update",
  "arguments": {
    "project": "mcp",
    "items": "example"
  }
}
```

## tasks_close

**Close Task**

Close a task by setting its status to 'closed'. Optionally cascade the close to all descendants (subtasks, sub-subtasks, etc.).

**Параметры:**

- `project`
- `id`
- `cascade`

**Пример вызова:**

```json
{
  "name": "tasks_close",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "cascade": "example"
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
- `tags`
- `links`
- `parentId`

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
    "tags": [
      "example"
    ],
    "links": [
      "https://example.com"
    ],
    "parentId": null
  }
}
```

## tasks_dag

**Get Project Dependency Graph**

Get the full dependency DAG for a project: topological sort, critical path, and edge list.

**Параметры:**

- `project`
- `includeArchived`

**Пример вызова:**

```json
{
  "name": "tasks_dag",
  "arguments": {
    "project": "mcp",
    "includeArchived": false
  }
}
```

## tasks_get

**Get Task**

Get task by id

**Параметры:**

- `project`
- `id`

**Пример вызова:**

```json
{
  "name": "tasks_get",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000"
  }
}
```

## tasks_get_children

**Get Task Children**

Get direct children of a task (one level deep, not recursive).

**Параметры:**

- `project`
- `id`

**Пример вызова:**

```json
{
  "name": "tasks_get_children",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000"
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

## tasks_list

**List Tasks**

List tasks with optional filters

**Параметры:**

- `project`
- `status`
- `tag`
- `includeArchived`

**Пример вызова:**

```json
{
  "name": "tasks_list",
  "arguments": {
    "project": "mcp",
    "status": "pending",
    "tag": "example",
    "includeArchived": false
  }
}
```

## tasks_set_deps

**Set Task Dependencies**

Set or replace dependency list for a task. Validates no cycles. Tasks with unmet dependencies are automatically marked as "blocked".

**Параметры:**

- `project`
- `id`
- `dependsOn`

**Пример вызова:**

```json
{
  "name": "tasks_set_deps",
  "arguments": {
    "project": "mcp",
    "id": "00000000-0000-0000-0000-000000000000",
    "dependsOn": "example"
  }
}
```

## tasks_tree

**List Tasks Tree**

List tasks as a hierarchical tree (by parentId)

**Параметры:**

- `project`
- `status`
- `tag`
- `includeArchived`

**Пример вызова:**

```json
{
  "name": "tasks_tree",
  "arguments": {
    "project": "mcp",
    "status": "pending",
    "tag": "example",
    "includeArchived": false
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
- `tags`
- `links`
- `parentId`

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
    "tags": [
      "example"
    ],
    "links": [
      "https://example.com"
    ],
    "parentId": null
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
