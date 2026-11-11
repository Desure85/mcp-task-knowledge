# Connectors

Integration hub for external services. Each connector registers MCP tools with a unified interface.

## Available Connectors

| Connector | Tools | Status |
|-----------|-------|--------|
| GitHub | `github_issue_*`, `github_pr_*`, `github_repo_*` | ✅ Production |
| Jira (read-only) | `jira_issue_list`, `jira_issue_get`, `jira_project_list` | ✅ Real (Jira REST v2) |\n| YouTrack (read-only) | `youtrack_issue_list`, `youtrack_issue_get`, `youtrack_project_list` | ✅ Real (YouTrack REST `/api`, query language pass-through, custom fields/comments; `YOUTRACK_URL` + `YOUTRACK_TOKEN`) |
| Slack/Discord | `slack_*` | ✅ Production |
| Google Drive | `gdrive_list_files`, `gdrive_get_file`, `gdrive_sync_folder` | ✅ Real (Drive v3, OAuth2 Bearer) |
| Gmail | `gmail_list_messages`, `gmail_get_message`, `gmail_sync_to_kb` | ✅ Real (Gmail v1, OAuth2 Bearer) |
| Notion | `notion_search_pages`, `notion_get_page`, `notion_sync_database` | ✅ Real (Notion v1) |
| OneDrive | `onedrive_list_files`, `onedrive_get_file`, `onedrive_sync_folder` | ✅ Real (Graph v1.0) |
| Linear | `linear_list_issues`, `linear_get_issue`, `linear_sync_to_kb` | ✅ Real (Linear GraphQL) |
| Web Crawler | `webcrawler_fetch_page`, `webcrawler_crawl_site` | ✅ Working |

All connectors return the same error envelope (TR-36):
`{ ok: false, error: { message } }` for HTTP, network, API-level and validation failures.
GitHub/Jira/Slack used to throw, which reached MCP clients as protocol `isError`; their tool
handlers are now wrapped by `src/connectors/errors.ts`. Successful responses keep their
`{ ok: true, data }` shape.

Web Crawler error semantics (TR-35): `webcrawler_fetch_page` returns
`{ ok: false, error: { message: "HTTP 404 Not Found" | "ECONNREFUSED" } }` for HTTP/network
failures instead of an empty successful page. `webcrawler_crawl_site` keeps the `ok: true`
envelope for a completed crawl but adds `failed` and `errors[]`; only successful pages increment
`crawled`, so callers can distinguish an empty page from an unreachable site.

## Connector Framework

<!-- doc-test: skip -->
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
    "github": { "enabled": true, "token": "ghp_..." },
    "jira": { "host": "https://my.atlassian.net", "token": "..." },
    "slack": { "token": "xoxb-..." },
    "gdrive": { "apiKey": "...", "refreshToken": "..." },
    "notion": { "apiKey": "..." },
    "linear": { "apiKey": "..." }
  }
}
```

Presence of a connector entry activates it — `"enabled": true` is optional
(shown above for clarity). Set `"enabled": false` to keep an entry in the
file while disabling the connector. Entries are merged over the connector's
env-based defaults (`*_CONNECTOR_ENABLED`), so a file entry wins on conflicts.

## Credential Resolution

Each connector resolves its API credential in this order (first non-empty wins):

1. **Connector config** — `config.token` / `config.apiKey` / `config.accessToken` from JSON config or factory arg.
2. **SecretManager** — `ctx.secrets.get(ENV_NAME)` via the configured `SECRET_BACKEND` (`env` default, `file` = AES-256-GCM encrypted store, `docker` = `/run/secrets/`).
3. **Environment variable** — direct `process.env[ENV_NAME]` fallback (kept for tests and embedded contexts without a SecretManager).

Relevant env vars: `SECRET_BACKEND` (`env`|`file`|`docker`|`vault`), `SECRET_MASTER_KEY` (file backend), `SECRET_FILE_PATH`, `DOCKER_SECRETS_DIR`.

## Health Checks

Each connector provides a health check:

```bash
curl http://localhost:3001/healthz
# {"healthy": true, "connectors": {"github": true, "jira": true, ...}}
```
