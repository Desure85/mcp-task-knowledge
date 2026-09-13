# Privacy & Data Egress

`mcp-task-knowledge` is a **local-first** MCP server. By default, everything it
stores and computes stays on your machine. This document lists exactly what can
leave the machine, when, and where it goes — every claim below was verified
against the source code (see the "Verified against" column).

## What stays local (default)

| Data / computation | Where it lives |
|--------------------|----------------|
| Tasks, knowledge docs, memory facts, prompts, skills, rules, workflows | `DATA_DIR` on your filesystem (JSON + Markdown files) |
| Embeddings | Computed **locally** by ONNX Runtime (`onnxruntime-node` / `onnxruntime-web` + `@xenova/transformers`). Model files are local; there is **no remote embeddings API call** anywhere in `src/search/` |
| Search | BM25 + FTS5 + vector search — all run in-process against local indexes |
| Web UI | Served by the same server process you run; no external CDN or hosted backend |
| Session/auth data | Local session manager; JWT validation is local unless you configure remote JWKS (see below) |

## What CAN leave the machine

All network egress is **opt-in** — it happens only when you enable the feature
and/or call the tool. Nothing below is active in a default install.

| Egress point | Trigger | Destination | Data sent | Verified against |
|--------------|---------|-------------|-----------|------------------|
| GitHub connector | `GITHUB_CONNECTOR_ENABLED=1` (or config entry) + calling a `github_*` tool | `api.github.com` | Request path/params + **your** GitHub token | `src/connectors/github.ts`, `src/connectors/index.ts` |
| Jira connector | `JIRA_CONNECTOR_ENABLED=1` + calling a `jira_*` tool | Your configured Jira host | Request path/params + your Jira credentials | `src/connectors/jira.ts` |
| Slack connector | `SLACK_CONNECTOR_ENABLED=1` + calling a `slack_*` tool | `slack.com` API | Request params + your Slack token | `src/connectors/slack.ts` |
| Google Drive connector | `GDRIVE_CONNECTOR_ENABLED=1` + calling a `gdrive_*` tool | `www.googleapis.com` | Request params + your Google token | `src/connectors/gdrive.ts` |
| Gmail connector | `GMAIL_CONNECTOR_ENABLED=1` + calling a `gmail_*` tool | `gmail.googleapis.com` | Request params + your Google token | `src/connectors/gmail.ts` |
| OneDrive connector | `ONEDRIVE_CONNECTOR_ENABLED=1` + calling a `onedrive_*` tool | `graph.microsoft.com` | Request params + your Microsoft token | `src/connectors/onedrive.ts` |
| Notion connector | `NOTION_CONNECTOR_ENABLED=1` + calling a `notion_*` tool | `api.notion.com` | Request params + your Notion token | `src/connectors/notion.ts` |
| Linear connector | `LINEAR_CONNECTOR_ENABLED=1` + calling a `linear_*` tool | `api.linear.app` | Request params + your Linear token | `src/connectors/linear.ts` |
| Web crawler connector | `WEBCRAWLER_CONNECTOR_ENABLED=1` + calling its crawl tool | Whatever `startUrl` you pass (and same-origin links it discovers) | HTTP GET only; sends a `User-Agent: mcp-task-knowledge-crawler/1.0` header | `src/connectors/web-crawler.ts` |
| Async-job webhook | Passing `webhookUrl` to an async memory tool (e.g. `memory_extract_async`) | The URL **you** specify | Job status payload (`id`, `type`, `status`, `output`, `error`) POSTed as JSON. URL is validated by the SSRF guard (private/loopback/link-local hosts rejected) | `src/memory/async-ops.ts`, `src/utils/ssrf-guard.ts` |
| Remote JWKS | Configuring JWT auth with `jwksUri` (instead of a local `secret`) | Your configured issuer's JWKS endpoint | HTTP GET for public keys only; no user data sent | `src/core/jwt-validator.ts` (`jose.createRemoteJWKSet`) |
| Framework adapters | Configuring an `HttpMCPClient` adapter URL | The adapter URL you configure | JSON-RPC `tools/call` envelopes for the tools you invoke through the adapter | `src/memory/framework-adapters.ts` |
| Remote service catalog | `CATALOG_MODE=remote` / `CATALOG_PREFER=remote` + `CATALOG_URL` (or `CATALOG_REMOTE_BASE_URL`) | Your configured catalog base URL | `GET /api/services` query params and `GET /api/health` | `src/catalog/provider.ts`, `src/config.ts` |
| LAN relay | `RELAY_ENABLED=1` | Other `mcp-task-knowledge` peers on your **local network** | UDP multicast presence beacons + WebSocket messages (AES-256-GCM encrypted) containing shared rules/briefs | `src/relay/discovery.ts`, `src/relay/relay-manager.ts`, `src/core/app-container.ts` |

## What is NEVER sent

Verified by searching `src/` for telemetry/analytics/update code — none exists:

- **No telemetry or analytics** — no PostHog, Sentry, Mixpanel, Segment,
  Amplitude, Datadog, New Relic, Bugsnag, or any other tracking SDK/call.
- **No phone-home** — the server never contacts the maintainers, a licensing
  server, or any endpoint you did not configure.
- **No usage statistics** — nothing counts features, tools, or calls for
  reporting.
- **No auto-update** — the server never downloads or applies updates by itself.
- **No crash reporting** — errors are written to your local log only.

## PII masking in memory extraction (optional)

Memory facts extracted from transcripts may contain PII (emails, phone
numbers, card numbers, IPs, IBANs, SSNs). Set `MEMORY_MASK_PII=1` to mask
detected PII (`[EMAIL]`, `[PHONE]`, `[CREDIT_CARD]`, `[IPV4]`, `[IBAN]`,
`[SSN]`) in fact statements before they are persisted to the knowledge base.

- Default: **off** — no behavior change unless you opt in.
- Detection is regex + Luhn validation for card numbers; it is a heuristic
  screen, not a guarantee. Review extracted facts if PII handling is critical.
- Implementation: `src/memory/pii-masker.ts`, wired into
  `src/memory/extraction.ts` (`MemoryExtractor`).

## Practical recommendations

1. Keep connectors disabled unless you use them — they are all off by default.
2. Treat `webhookUrl` and adapter URLs as trusted destinations: job output and
   tool arguments are sent there verbatim.
3. `RELAY_ENABLED=1` broadcasts to your LAN segment — enable only on trusted
   networks.
4. If you expose the HTTP transport beyond localhost, configure JWT auth —
   remote JWKS mode is the only auth-related egress.
