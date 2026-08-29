#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Collect CLI e2e tests explicitly: legacy cli-server pattern + core e2e (Q-004)
mapfile -t FILES < <(ls tests/*.cli-server.test.ts tests/*.e2e.test.ts 2>/dev/null || true)
if [ ${#FILES[@]} -eq 0 ]; then
  echo "No CLI e2e tests found (tests/*.cli-server.test.ts, tests/*.e2e.test.ts)" >&2
  exit 1
fi
printf 'Running %d CLI e2e files\n' "${#FILES[@]}"
# Run vitest with explicit file list
npx vitest run "${FILES[@]}"
