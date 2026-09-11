# Multi-stage Dockerfile for mcp-task-knowledge Web UI (UI-007, PH-015)

# ─── Builder ──────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY web-ui/package.json web-ui/package-lock.json* ./
RUN npm ci || npm install

COPY web-ui/ ./
RUN npm run build

# ─── Runtime ──────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Runtime env (read by next.config.ts rewrites — NOT baked into the build):
#   MCP_API_URL — upstream MCP server base URL (default http://localhost:3001).
#     In compose, point at the service name: MCP_API_URL=http://mcp:3001
#   NEXT_PUBLIC_MCP_API_URL — optional browser override; leave unset so the
#     client defaults to the same-origin `/api/mcp` rewrite (no CORS needed).
#   NEXT_PUBLIC_MCP_TOKEN — optional JWT when the server enforces SEC-003 auth.

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
# next start loads next.config.ts at runtime — required for the /api/mcp
# rewrite proxy; without it the GUI cannot reach the MCP server.
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

EXPOSE 3000

CMD ["npm", "start"]
