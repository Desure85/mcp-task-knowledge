#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="docker-compose.catalog.yml"
CATALOG_HOST_PORT=42056
CATALOG_BASE_URL="http://localhost:${CATALOG_HOST_PORT}"

usage() {
  cat <<EOF
Usage: $0 [--down]

Runs docker compose for service-catalog + MCP, waits for catalog health, then runs smoke tests.
Options:
  --down   After smoke, bring the stack down (docker compose down -v)

Environment:
  CATALOG_BASE_URL   Override base URL for smoke (default: ${CATALOG_BASE_URL})
EOF
}

BRING_DOWN=false
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage; exit 0
fi
if [[ "${1:-}" == "--down" ]]; then
  BRING_DOWN=true
fi

# Bring up in detached mode
echo "[compose] Up stack via ${COMPOSE_FILE}"
docker compose -f "${COMPOSE_FILE}" up -d --build

# Wait for health endpoint on published port
BASE_URL="${CATALOG_BASE_URL}"
if [[ -n "${CATALOG_BASE_URL:-}" ]]; then
  BASE_URL="${CATALOG_BASE_URL}"
fi

echo "[wait] Waiting for ${BASE_URL}/api/health ..."
for i in {1..60}; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/health" || true)
  if [[ "$code" == "200" ]]; then
    echo "[wait] Healthy (HTTP 200)"
    break
  fi
  echo "[wait] Not ready yet (code=$code), attempt $i/60"
  sleep 2
  if [[ "$i" == "60" ]]; then
    echo "[wait] Timeout waiting for health" >&2
    exit 1
  fi
done

# Run smoke
echo "[smoke] Running scripts/smoke_catalog.sh"
CATALOG_BASE_URL="${BASE_URL}" bash scripts/smoke_catalog.sh

if [[ "$BRING_DOWN" == "true" ]]; then
  echo "[compose] Bringing stack down"
  docker compose -f "${COMPOSE_FILE}" down -v
else
  echo "[compose] Stack left running. To stop: docker compose -f ${COMPOSE_FILE} down -v"
fi
