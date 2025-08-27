#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="mcp-task-knowledge:onnx-cpu-selfcheck"
TARGET_STAGE="runtime-onnx-cpu"
DATA_DIR_HOST="$(pwd)/.data"

mkdir -p "${DATA_DIR_HOST}/obsidian" || true

echo "[selfcheck] Building image (${IMAGE_TAG}) with target ${TARGET_STAGE} (buildx --load)"
BUILD_ARGS=()
if [[ -n "${NPM_REGISTRY:-}" ]]; then
  echo "[selfcheck] Using custom NPM_REGISTRY=${NPM_REGISTRY}"
  BUILD_ARGS+=(--build-arg "NPM_REGISTRY=${NPM_REGISTRY}")
fi
CACHE_FLAGS=()
if [[ -n "${CACHE_IMAGE:-}" ]]; then
  echo "[selfcheck] Using registry cache: ${CACHE_IMAGE}"
  CACHE_FLAGS+=(--cache-from "type=registry,ref=${CACHE_IMAGE}")
  CACHE_FLAGS+=(--cache-to "type=registry,ref=${CACHE_IMAGE},mode=max");
fi
docker buildx build --progress=plain --load -t "${IMAGE_TAG}" --target "${TARGET_STAGE}" "${CACHE_FLAGS[@]}" "${BUILD_ARGS[@]}" .

echo "[selfcheck] Running ONNX CPU self-check inside container"
set +e
OUT=$(timeout 300s docker run --rm \
  -e DATA_DIR=/data \
  -e OBSIDIAN_VAULT_ROOT=/data/obsidian \
  -e HF_HUB_OFFLINE=1 \
  -e TRANSFORMERS_OFFLINE=1 \
  -e EMBEDDINGS_MODE=onnx-cpu \
  -e EMBEDDINGS_MODEL_PATH=/app/models/encoder.onnx \
  -e EMBEDDINGS_DIM=768 \
  -e EMBEDDINGS_CACHE_DIR=/data/.embeddings \
  -e DEBUG_VECTOR=true \
  -v "${DATA_DIR_HOST}:/data:rw" \
  "${IMAGE_TAG}" \
  node -e "(async ()=>{try{const m=await import('/app/dist/search/vector.js');const ad=await m.getVectorAdapter();if(!ad){console.error('SELF_CHECK_FAIL: adapter unavailable');process.exit(2);}const res=await ad.search('ping',[{id:'1',text:'ping',item:1}]);console.log('SELF_CHECK_OK',{results:res.length});process.exit(0);}catch(e){console.error('SELF_CHECK_ERR:', (e&&e.message)?e.message:String(e));process.exit(3);}})();" 2>&1)
code=$?
set -e

echo "$OUT"
if [[ $code -ne 0 ]]; then
  echo "[selfcheck] FAILED with code $code" >&2
  exit $code
fi

echo "[selfcheck] ONNX CPU self-check passed"
