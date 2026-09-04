# Quickstart to Production

Full path from zero to a production deployment: Dockerized MCP server (HTTP
transport) + Web UI + authentication. Complements
[Getting Started](getting-started.md) (local install) and
[Docker](deployment/docker.md) (image reference).

## 1. Prerequisites

- Docker 24+ and Docker Compose v2
- A domain name (for TLS termination) or a private network
- A strong random value for `JWT_SECRET` (32+ bytes)

## 2. Configure

Copy `.env.example` to `.env` and set at minimum:

```bash
DATA_DIR=/data
MCP_TRANSPORT=http
MCP_PORT=3001
MCP_HOST=0.0.0.0
CURRENT_PROJECT=mcp
EMBEDDINGS_MODE=none        # none | onnx-cpu | onnx-gpu
JWT_SECRET=<32+ random bytes>
```

Notes:

- HTTP transport is fail-closed: unauthenticated `tools/call` requests are
  rejected unless explicitly configured otherwise (see SEC-003, `auth-gate.ts`).
- Start with `EMBEDDINGS_MODE=none` (BM25 + FTS5 only); switch to `onnx-cpu`
  when you need vector search.

## 3. Run (Compose: server + Web UI)

```bash
docker compose --profile prod up -d --build
# or, with the documented compose file:
docker compose up -d mcp-knowledge web-ui
```

This starts:

| Service         | Port | Purpose                              |
|-----------------|------|--------------------------------------|
| `mcp-knowledge` | 3001 | MCP server, Streamable HTTP `/mcp`   |
| `web-ui`        | 3000 | Next.js UI (tasks, knowledge, graph) |

Data persists in `./.data` (`DATA_DIR=/data` in the container).

## 4. Authenticate

1. Call `mcp.authenticate` over the HTTP transport to mint a JWT
   (`JWT_ISSUER`/`JWT_AUDIENCE` verified on every request).
2. Pass the token as `Authorization: Bearer <jwt>` on `tools/call`.
3. Without a token the server answers 401 — this is expected (fail-closed).

## 5. Point the Web UI at the server

```bash
NEXT_PUBLIC_MCP_API_URL=http://mcp-knowledge:3001/mcp
```

For browser access from outside Docker, use the public server URL instead,
e.g. `https://mcp.example.com/mcp` (terminate TLS in a reverse proxy —
Caddy/Traefik/nginx — in front of port 3001).

## 6. Smoke test

```bash
# Server is up (health endpoint)
curl -s http://localhost:3001/health | head -c 200; echo

# Tools list (authenticated)
curl -s -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  http://localhost:3001/mcp | head -c 300; echo

# Extract a fact, then find it in the Web UI (/memory) and graph (/graph)
```

Expected: health 200, 100+ tools listed, `/memory` page shows the fact.

## 7. Production checklist

- [ ] `JWT_SECRET` set, rotated on a schedule; no default secrets in images
- [ ] TLS in front of `:3001` (the server itself speaks plain HTTP)
- [ ] `./.data` on a persistent volume with backups
- [ ] `restart: unless-stopped` (already in the Compose file)
- [ ] Logs shipped (`docker logs mcp-knowledge` → your collector)
- [ ] `npm run benchmark` baselines recorded before/after upgrades
- [ ] Web UI `NEXT_PUBLIC_MCP_API_URL` points at the public `/mcp` URL

## Troubleshooting

| Symptom                        | Likely cause / fix                                  |
|--------------------------------|-----------------------------------------------------|
| 401 on every `tools/call`      | Missing/expired JWT — re-authenticate               |
| Empty search results           | `EMBEDDINGS_MODE=none` + fresh volume — ingest docs |
| Web UI cannot reach server     | `NEXT_PUBLIC_MCP_API_URL` unreachable from browser  |
| Slow cold start                | `onnx-cpu` model download on first boot — be patient|
