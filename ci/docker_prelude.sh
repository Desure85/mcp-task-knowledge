#!/usr/bin/env bash
set -euo pipefail

# Common Docker-in-Docker prep for GitLab CI jobs
# - Installs basic tools
# - Logs in to CI registry if available
# - Enables buildx with a named builder

: "${BUILDER_NAME:=ci-builder}"

if command -v apk >/dev/null 2>&1; then
  apk add --no-cache bash coreutils >/dev/null
fi

if [ -n "${CI_REGISTRY:-}" ]; then
  echo "[ci] docker login to ${CI_REGISTRY}"
  docker login -u "${CI_REGISTRY_USER}" -p "${CI_REGISTRY_PASSWORD}" "${CI_REGISTRY}" || true
fi

docker version || true
(docker compose version || docker-compose version) 2>/dev/null || true

echo "[ci] enabling buildx (${BUILDER_NAME})"
docker buildx create --name "${BUILDER_NAME}" --use --driver docker-container 2>/dev/null || docker buildx use "${BUILDER_NAME}"
docker buildx inspect --bootstrap || true
