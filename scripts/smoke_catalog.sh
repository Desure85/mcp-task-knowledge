#!/usr/bin/env bash
set -euo pipefail

CATALOG_BASE_URL=${CATALOG_BASE_URL:-"http://localhost:3001"}

echo "[smoke] GET $CATALOG_BASE_URL/api/health"
code=$(curl -s -o /dev/null -w "%{http_code}" "$CATALOG_BASE_URL/api/health")
echo "status: $code"; test "$code" = "200"

echo "[smoke] GET $CATALOG_BASE_URL/api/services?limit=1"
resp=$(curl -s "$CATALOG_BASE_URL/api/services?page=1&pageSize=1")
echo "$resp" | head -c 400; echo

if command -v jq >/dev/null 2>&1; then
  total=$(echo "$resp" | jq -r '.total // 0')
  echo "total services: $total"
fi

echo "[smoke] GET $CATALOG_BASE_URL/openapi.json"
code=$(curl -s -o /dev/null -w "%{http_code}" "$CATALOG_BASE_URL/openapi.json")
echo "status: $code"; test "$code" = "200"

echo "[smoke] GET $CATALOG_BASE_URL/docs"
code=$(curl -s -o /dev/null -w "%{http_code}" "$CATALOG_BASE_URL/docs")
echo "status: $code"; test "$code" = "200"

echo "OK: service-catalog smoke passed"
