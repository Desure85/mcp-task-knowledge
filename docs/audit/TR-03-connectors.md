# TR-03 — Connector & Credential Lifecycle Audit

**Date:** 2026-09-12
**Branch:** feat/tr-03-connector-audit
**Scope:** `src/connectors/*.ts`, `src/core/{oauth,secret-manager,token-manager,jwt-validator,auth,auth-gate}.ts`, `src/register/auth.ts`, `src/transport/*`, `src/memory/async-ops.ts` (webhook), `src/config.ts`, `src/core/app-container.ts` (wiring)
**Type:** Research-only audit — no code changes.

---

## 1. Summary Table

| Connector | Auth method | Token storage | Scope minimization | Revoke/rotation | Issues |
|-----------|-------------|---------------|--------------------|-----------------|--------|
| **github** | PAT (`Bearer`) | `process.env.GITHUB_TOKEN` or `config.token` | N/A — PAT scope set at GitHub UI, not requested | None — static token, fails on 401 | C-01, C-04 |
| **jira** | Bearer or Basic (email:token base64) | `process.env.JIRA_TOKEN` / `JIRA_HOST` / `JIRA_EMAIL` | N/A | None | C-01, C-04, C-07 |
| **slack** | Bot token (`Bearer xoxb-`) | `process.env.SLACK_BOT_TOKEN` | N/A — bot scopes at Slack app config | None | C-01, C-04 |
| **gdrive** | OAuth2 access token (`Bearer`) | `process.env.GDRIVE_ACCESS_TOKEN` or `config.accessToken` | N/A — token pre-minted externally | **Broken** — `refreshToken`/`clientId`/`clientSecret` read but never used | C-01, C-02, C-04 |
| **gmail** | OAuth2 access token (`Bearer`) | `process.env.GMAIL_ACCESS_TOKEN` or `config.accessToken` | N/A | None — no refresh flow | C-01, C-04 |
| **notion** | Integration token (`Bearer`) | `process.env.NOTION_API_KEY` or `config.apiKey` | N/A — capabilities set at Notion integration | None | C-01, C-04 |
| **onedrive** | OAuth2 access token (`Bearer`) | `process.env.ONEDRIVE_ACCESS_TOKEN` or `config.accessToken` | N/A | None | C-01, C-04 |
| **linear** | Personal API key (`Authorization: <key>` — no Bearer prefix) | `process.env.LINEAR_API_KEY` or `config.apiKey` | N/A | None | C-01, C-04 |
| **web-crawler** | None (unauthenticated fetch) | — | — | — | C-05 (SSRF-adjacent), C-06 |

---

## 2. Findings

### C-01 — Secrets in plaintext env vars, no SecretManager integration — **HIGH**

All connectors read credentials directly from `process.env` at `init()` time. `SecretManager` (`src/core/secret-manager.ts`) exists with AES-256-GCM file backend and Docker secrets support, but has **zero call sites** outside its own spec — it is dead code.

Evidence (one per connector, all identical pattern):

```ts
// src/connectors/github.ts:33
const token = cfg.token ?? process.env.GITHUB_TOKEN ?? '';

// src/connectors/jira.ts:33
const token = cfg.token ?? process.env.JIRA_TOKEN ?? '';

// src/connectors/slack.ts:36
const token = cfg.token ?? process.env.SLACK_BOT_TOKEN ?? '';

// src/connectors/gdrive.ts:63
this.accessToken = (ctx.config['accessToken'] as string | undefined) ?? process.env.GDRIVE_ACCESS_TOKEN ?? undefined;

// src/connectors/gmail.ts:76
this.accessToken = (ctx.config['accessToken'] as string | undefined) ?? process.env.GMAIL_ACCESS_TOKEN ?? undefined;

// src/connectors/notion.ts:88
this.apiKey = (ctx.config['apiKey'] as string | undefined) ?? process.env.NOTION_API_KEY ?? undefined;

// src/connectors/onedrive.ts:60
this.accessToken = (ctx.config['accessToken'] as string | undefined) ?? process.env.ONEDRIVE_ACCESS_TOKEN ?? undefined;

// src/connectors/linear.ts:73
this.apiKey = (ctx.config['apiKey'] as string | undefined) ?? process.env.LINEAR_API_KEY ?? undefined;
```

Impact: env vars are visible via `/proc/<pid>/environ`, crash dumps, `docker inspect`, and any accidental `process.env` serialization. `SecretManager.list()` even enumerates them by regex (`secret-manager.ts:134-141`) — confirming the project knows they are secrets, yet nothing routes through the manager.

### C-02 — GDrive refresh-token fields are dead code — **MEDIUM**

```ts
// src/connectors/gdrive.ts:39-42
private refreshToken?: string;
private clientId?: string;
private clientSecret?: string;

// src/connectors/gdrive.ts:65-67 — read from config, then never used
this.refreshToken = ctx.config['refreshToken'] as string | undefined;
this.clientId = ctx.config['clientId'] as string | undefined;
this.clientSecret = ctx.config['clientSecret'] as string | undefined;
```

No `refresh_token` grant call to `https://oauth2.googleapis.com/token` exists anywhere. When `accessToken` expires (Google OAuth tokens live ~1h), every tool returns `{ok:false}` until the process is restarted with a fresh env var. The fields mislead operators into thinking refresh works.

### C-03 — Connector config-file path is dead code — **HIGH**

```ts
// src/core/app-container.ts:387
const connectorConfigs: Record<string, Record<string, unknown>> = {};
```

Always empty. `FileConfig` (`src/config.ts:10-52`) has no `connectors` key, and nothing populates `connectorConfigs` from file config. Yet `docs/features/connectors.md:52-62` documents JSON config as working:

```json
{ "connectors": { "github": { "token": "ghp_..." } } }
```

Reality: only `defaultConfig` (the `*_CONNECTOR_ENABLED` flag) reaches the factory; credentials come exclusively from `process.env` fallbacks inside each connector. Doc drift + dead parameter.

### C-04 — No token lifecycle: no expiry tracking, no rotation, no graceful revoke — **HIGH**

- Tokens are captured once at `init()` into closure/instance fields. No expiry timestamp, no `expiresAt`, no proactive refresh.
- On 401 the connector throws `GitHub API 401: ...` / returns `{ok:false}` — no retry, no re-auth hook, no circuit-breaker integration despite `CircuitBreaker` existing in `src/core/circuit-breaker.ts`.
- `Connector.destroy?()` is optional and none of the 9 connectors implement it — no credential zeroization on shutdown.
- `health()` for github/jira/slack does a live API call (`/user`, `/myself`, `auth.test`) — good — but for gdrive/gmail/notion/onedrive/linear it only checks `!!token` presence, so a revoked token still reports `healthy: true`.

```ts
// src/connectors/gdrive.ts:122 — presence check only
if (!this.accessToken && !this.apiKey && !this.refreshToken) return { healthy: false, message: 'No credentials' };
return { healthy: true, message: 'Google Drive connector ready' };
```

### C-05 — `memory_extract_async` / `memory_dream_async` webhookUrl = unvalidated SSRF — **HIGH**

```ts
// src/register/memory.ts:413, 1311
webhookUrl: z.string().url().optional()

// src/memory/async-ops.ts:277 — POSTs job output to arbitrary URL
const resp = await fetch(job.webhookUrl, { method: 'POST', ... });
```

No host allowlist, no private-IP/loopback block (RFC-1918, 169.254.169.254 metadata endpoint), no scheme restriction beyond `url()` (allows `file://`? — zod `.url()` accepts any scheme parseable by `new URL`). An authenticated MCP client can exfiltrate job output to `http://169.254.169.254/latest/meta-data/` or internal services. Payload includes `job.output` — potentially sensitive extracted facts.

### C-06 — Web crawler fetches arbitrary URLs — **MEDIUM**

```ts
// src/connectors/web-crawler.ts:62
const resp = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs), ... });
```

`webcrawler_fetch_page` / `webcrawler_crawl_site` accept any `url`/`startUrl` with no scheme check (allows `file://`, `ftp://`?), no private-IP block, no redirect limit. `sameOrigin()` gates *link following* but not the initial URL. Combined with `crawl_site` syncing content into the knowledge base, this is both an SSRF vector and a prompt-injection ingestion path (already flagged in TR-01 audit).

### C-07 — Jira Basic-auth fallback sends base64 credentials — **LOW**

```ts
// src/connectors/jira.ts:24-27
if (email) {
  headers.Authorization = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}
```

Correct for Jira Cloud, but `host` is user-controlled env — if pointed at a non-TLS or attacker host, credentials leak in a decodable header. No scheme enforcement (`https://` only) on `JIRA_HOST`.

### C-08 — No webhook *receiving* validation (connectors don't accept webhooks) — **INFO**

No connector exposes inbound webhook endpoints — all are outbound-only fetch clients. The only webhook surface is the outbound `fireWebhook` in async-ops (C-05). If inbound webhooks are ever added (Slack events, GitHub webhooks), there is currently **no** signature-verification helper (no `x-hub-signature-256` / `x-slack-signature` HMAC code anywhere).

### C-09 — No scope minimization mechanism — **INFO**

Connectors accept pre-minted tokens; scopes are fixed at the provider's app/integration config, not requested by code. There is no documentation of *recommended minimal scopes* per connector (e.g., GitHub `repo:read` vs full `repo`, Slack `chat:write`+`search:read` only). Operators will over-provision by default.

### C-10 — Secrets not logged (verified clean) — **OK**

- `src/connectors/registry.ts` logs only `{id}` and error messages — no config dump.
- `LoggingMiddleware` (`src/core/logging-middleware.ts`) can log tool input/output at `verbose`/`debug` — but it is **never instantiated** (`new LoggingMiddleware` has zero call sites outside its own file/spec). If wired later at `verbose`, connector tool *outputs* (issue bodies, file contents) would be logged — acceptable, but inputs containing e.g. `webhookUrl` would too.
- Pino logger has no redaction paths configured (`src/core/logger.ts` — no `redact` option). If a token ever lands in a logged object, it ships plaintext to stderr.

### C-11 — No hardcoded secrets in source — **OK**

Grep for `ghp_`, `xoxb-`, `sk-`, `ya29`, `secret_`, literal `Bearer <token>` across `src/connectors/` — clean. `.env.example` contains only `JWT_SECRET=change-me` placeholder.

---

## 3. OAuth & Token Infrastructure (context)

| Component | Purpose | Used by connectors? |
|-----------|---------|---------------------|
| `src/core/oauth.ts` — `OAuthProvider` | OAuth 2.1 PKCE **server** for MCP HTTP transport clients | ❌ No — unrelated to external APIs |
| `src/core/token-manager.ts` — `TokenManager` | Internal access/refresh token pairs for MCP sessions | ❌ No |
| `src/core/jwt-validator.ts` — `JwtValidator` | Validates inbound MCP client JWTs (HMAC/JWKS) | ❌ No |
| `src/core/secret-manager.ts` — `SecretManager` | env/file(AES-GCM)/docker/vault secret backends | ❌ **Dead code — 0 call sites** |

The project has a full credential-management stack that connectors simply don't use.

---

## 4. Recommendations (priority order)

1. **R1 (HIGH):** Wire `SecretManager` into `ConnectorContext` — replace direct `process.env.X` reads with `await ctx.secrets.get('GITHUB_TOKEN')`. Enables file/docker backends without connector changes.
2. **R2 (HIGH):** Fix or remove `connectorConfigs` dead path — either populate from `FileConfig.connectors` (matching docs) or delete the parameter and fix `docs/features/connectors.md`.
3. **R3 (HIGH):** Validate `webhookUrl` — scheme allowlist (`https:` only), block private/loopback/link-local IPs (resolve DNS), optional `WEBHOOK_ALLOWED_HOSTS` env allowlist.
4. **R4 (MEDIUM):** Implement GDrive/Gmail/OneDrive token refresh — use the already-read `refreshToken`/`clientId`/`clientSecret` against `oauth2.googleapis.com/token` / `login.microsoftonline.com`, or delete the dead fields and document "token must be refreshed externally".
5. **R5 (MEDIUM):** Web-crawler egress policy — scheme allowlist (`http/https`), private-IP block, max redirects, per-domain rate limit.
6. **R6 (MEDIUM):** Real `health()` probes for gdrive/gmail/notion/onedrive/linear (cheap `GET /about`/`/me` equivalents) so revoked tokens report unhealthy.
7. **R7 (LOW):** Enforce `https://` on `JIRA_HOST`; document minimal scopes per connector in `docs/features/connectors.md`.
8. **R8 (LOW):** Add pino `redact: ['*.token','*.apiKey','*.accessToken','req.headers.authorization']` to `createLogger()` as defense-in-depth before LoggingMiddleware is ever wired.

---

## 5. BACKLOG items (to append)

| ID | Title | Severity |
|----|-------|----------|
| TR-14 | Wire SecretManager into ConnectorContext (kill direct env reads) | high |
| TR-15 | Fix dead connectorConfigs path / doc drift in connectors.md | high |
| TR-16 | webhookUrl SSRF guard (scheme+IP allowlist) in async-ops | high |
| TR-17 | OAuth refresh flow for gdrive/gmail/onedrive (or remove dead fields) | medium |
| TR-18 | Web-crawler egress policy (scheme/IP/redirects) | medium |
| TR-19 | Real health probes for OAuth connectors | medium |
| TR-20 | Logger redaction paths + JIRA_HOST https enforcement + scope docs | low |
