# Multi-stage Dockerfile for mcp-task-knowledge Web UI (UI-007)

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
ENV NEXT_PUBLIC_MCP_API_URL=http://localhost:3001/mcp

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000

CMD ["npm", "start"]
