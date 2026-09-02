# Connectors

Integration hub for external services. Each connector registers MCP tools with a unified interface.

## Available Connectors

| Connector | Tools | Status |
|-----------|-------|--------|
| GitHub | `github_issue_*`, `github_pr_*`, `github_repo_*` | ✅ Production |
| Jira/YouTrack | `jira_issue_*` | ✅ Production |
| Slack/Discord | `slack_*` | ✅ Production |
| Google Drive | `gdrive_list_files`, `gdrive_get_file`, `gdrive_sync_folder` | ✅ Stub |
| Gmail | `gmail_list_messages`, `gmail_get_message`, `gmail_sync_to_kb` | ✅ Stub |
| Notion | `notion_search_pages`, `notion_get_page`, `notion_sync_database` | ✅ Stub |
| OneDrive | `onedrive_list_files`, `onedrive_get_file`, `onedrive_sync_folder` | ✅ Stub |
| Linear | `linear_list_issues`, `linear_get_issue`, `linear_sync_to_kb` | ✅ Stub |
| Web Crawler | `webcrawler_fetch_page`, `webcrawler_crawl_site` | ✅ Working |

## Connector Framework

```typescript
import type { Connector } from './connectors/types.js';

class MyConnector implements Connector {
  readonly id = 'my-service';
  readonly name = 'My Service';
  readonly version = '1.0.0';

  async init(ctx: ConnectorContext): Promise<void> {
    ctx.registerTool('my_service_action', {
      title: 'My Service: Action',
      description: 'Do something',
      inputSchema: { type: 'object', properties: { ... } },
    }, async (input) => {
      return { ok: true, data: await doSomething(input) };
    });
  }

  async health(): Promise<ConnectorHealth> {
    return { healthy: true, message: 'Ready' };
  }
}
```

## Configuration

Connectors are configured via env vars or JSON config:

```json
{
  "connectors": {
    "github": { "token": "ghp_..." },
    "jira": { "host": "https://my.atlassian.net", "token": "..." },
    "slack": { "token": "xoxb-..." },
    "gdrive": { "apiKey": "...", "refreshToken": "..." },
    "notion": { "apiKey": "..." },
    "linear": { "apiKey": "..." }
  }
}
```

## Health Checks

Each connector provides a health check:

```bash
curl http://localhost:3001/healthz
# {"healthy": true, "connectors": {"github": true, "jira": true, ...}}
```
