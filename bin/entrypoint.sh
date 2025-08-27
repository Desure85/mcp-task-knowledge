#!/usr/bin/env bash
set -euo pipefail

# Set sane defaults for cache locations to avoid CUDA/ORT segfaults under arbitrary --user
# Some runtimes pass HOME='/' or an unwritable path when using --user. Normalize to writable base.
if [[ -z "${HOME:-}" || "${HOME}" == "/" ]]; then
  HOME="/tmp"
fi

# If HOME exists but is not writable, fallback to /tmp
if ! mkdir -p "${HOME}/.entrypoint-check" 2>/dev/null; then
  HOME="/tmp"
else
  rmdir "${HOME}/.entrypoint-check" 2>/dev/null || true
fi
export HOME

# Derive cache dirs if not provided
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-${HOME}/.cache}"
export CUDA_CACHE_PATH="${CUDA_CACHE_PATH:-${HOME}/.nv/ComputeCache}"

mkdir -p "${XDG_CACHE_HOME}" "${CUDA_CACHE_PATH}"

# Sensible NVIDIA defaults to improve compatibility in minimal runtimes
export NVIDIA_VISIBLE_DEVICES="${NVIDIA_VISIBLE_DEVICES:-all}"
export NVIDIA_DRIVER_CAPABILITIES="${NVIDIA_DRIVER_CAPABILITIES:-compute,utility}"
export CUDA_MODULE_LOADING="${CUDA_MODULE_LOADING:-LAZY}"

exec "$@"
