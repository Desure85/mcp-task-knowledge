#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="docker-compose.catalog.yml"

usage() {
  cat <<EOF
Usage: $0 [--down]

Runs docker compose for service-catalog + MCP, waits for catalog health,
then runs smoke tests for catalog, knowledge, tasks, and alias tools.
Options:
  --down   After smoke, bring the stack down (docker compose down -v)
EOF
}

BRING_DOWN=false
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage; exit 0
fi
if [[ "${1:-}" == "--down" ]]; then
  BRING_DOWN=true
fi

echo "[compose] Up stack via ${COMPOSE_FILE}"
docker compose -f "${COMPOSE_FILE}" up -d --build

echo "[compose] Services:"
docker compose -f "${COMPOSE_FILE}" ps

SC_ID=$(docker compose -f "${COMPOSE_FILE}" ps -q service-catalog)
MCP_ID=$(docker compose -f "${COMPOSE_FILE}" ps -q mcp)

# Wait for service-catalog healthy
echo "[wait] Waiting for service-catalog to become healthy..."
for i in $(seq 1 60); do
  HS=$(docker inspect -f '{{json .State.Health.Status}}' "$SC_ID" 2>/dev/null || echo '"starting"')
  echo "health: $HS"
  if [ "$HS" = '"healthy"' ]; then break; fi
  sleep 2
  if [ "$i" = "60" ]; then
    echo "[wait] Timeout waiting for service-catalog health" >&2
    docker logs "$SC_ID" --tail=200 || true
    exit 1
  fi
done

# Run smokes inside containers
set -x
# catalog
docker exec -i "$SC_ID" sh -lc 'apk add --no-cache bash jq >/dev/null 2>&1 || true; bash /app/scripts/smoke.sh'
# knowledge
docker exec -i "$MCP_ID" sh -lc 'node /app/scripts/smoke_knowledge.mjs'
# tasks
docker exec -i "$MCP_ID" sh -lc 'node /app/scripts/smoke_tasks.mjs'
# aliases
docker exec -i "$MCP_ID" sh -lc 'node /app/scripts/smoke_tasks_aliases.mjs'
set +x

echo "[smoke] All smoke tests finished successfully"

if [[ "$BRING_DOWN" == "true" ]]; then
  echo "[compose] Bringing stack down"
  docker compose -f "${COMPOSE_FILE}" down -v
else
  echo "[compose] Stack left running. To stop: docker compose -f ${COMPOSE_FILE} down -v"
fi
