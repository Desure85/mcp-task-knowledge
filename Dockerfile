# syntax=docker/dockerfile:1.7

# Global ARG usable in any FROM (supported since Docker 17.05)
Runtime bases (our GHCR images)
ARG BASE_MODELS_IMAGE=mcp-base-onnx:latest
ARG BASE_DEPS_IMAGE=mcp-base-bm25:latest
ARG BASE_GPU_IMAGE=mcp-base-onnx-gpu:latest
ARG BASE_MODELS_IMAGE_CAT=mcp-base-onnx-cat:latest
ARG BASE_DEPS_IMAGE_CAT=mcp-base-bm25-cat:latest
ARG BASE_GPU_IMAGE_CAT=mcp-base-onnx-gpu-cat:latest
# Toolchain bases (to avoid docker.io pulls in app builds)
ARG BASE_NODE_IMAGE=ghcr.io/OWNER_PLACEHOLDER/mcp-node:20-bullseye
ARG BASE_NODE_ALPINE_IMAGE=ghcr.io/OWNER_PLACEHOLDER/mcp-node:20-alpine
ARG BASE_PY_IMAGE=ghcr.io/OWNER_PLACEHOLDER/mcp-python:3.11-slim
ARG BASE_CUDA_IMAGE=ghcr.io/OWNER_PLACEHOLDER/mcp-cuda:12.4.1-cudnn-runtime-ubuntu22.04

# ---------- base deps (cacheable) ----------
FROM ${BASE_NODE_IMAGE} AS deps
WORKDIR /app
COPY .npmrc package.json package-lock.json ./
# Use configurable npm registry (default: npmjs). Can be overridden via --build-arg NPM_REGISTRY...
ARG NPM_REGISTRY=https://registry.npmjs.org/
# Export both to environment so shell and npm see consistent value
ENV NPM_REGISTRY=${NPM_REGISTRY}
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
ENV ONNXRUNTIME_NODE_EXECUTION_PROVIDERS=cpu
# Optional: embed external service-catalog library
#  - SERVICE_CATALOG_TARBALL: URL to .tgz (npm pack output) to install
#  - SERVICE_CATALOG_GIT: git URL (https) to clone and install from folder
#  - SERVICE_CATALOG_REF: git ref/branch (default: main)
ARG SERVICE_CATALOG_TARBALL=
ARG SERVICE_CATALOG_GIT=
ARG SERVICE_CATALOG_REF=master
RUN printf "registry=${NPM_REGISTRY}\n@modelcontextprotocol:registry=${NPM_REGISTRY}\n@huggingface:registry=${NPM_REGISTRY}\n" > .npmrc \
 && npm config set fetch-retries 5 \
 && npm config set fetch-retry-factor 2 \
 && npm config set fetch-timeout 600000
# Prepare dummy local dependency if embedding is disabled, so npm can resolve file:service-catalog
# Use a version that matches package-lock.json (expected 0.1.0)
RUN set -eux; \
    if [ -z "${SERVICE_CATALOG_TARBALL}" ] && [ -z "${SERVICE_CATALOG_GIT}" ]; then \
      mkdir -p service-catalog; \
      printf '{"name":"service-catalog","version":"0.1.0"}\n' > service-catalog/package.json; \
    fi
# Use BuildKit cache for npm to speed up repeat installs
# Prefer deterministic `npm ci`; if lock is out of sync (e.g., first-time base build),
# fall back to `npm install` to generate a consistent lock inside the image.
RUN --mount=type=cache,target=/root/.npm \
    (npm ci --ignore-scripts --registry=${NPM_CONFIG_REGISTRY} \
     || (echo "[deps] npm ci failed, falling back to npm install to sync lock" \
         && npm install --ignore-scripts --registry=${NPM_CONFIG_REGISTRY}))

# If requested, fetch and install external service-catalog as a local dependency
RUN set -eux; \
  if [ -n "${SERVICE_CATALOG_TARBALL}" ]; then \
    apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*; \
    echo "[deps] installing service-catalog from tarball: ${SERVICE_CATALOG_TARBALL}"; \
    curl -fsSL -o /tmp/service-catalog.tgz "${SERVICE_CATALOG_TARBALL}"; \
    npm i --ignore-scripts --include=dev /tmp/service-catalog.tgz; \
  elif [ -n "${SERVICE_CATALOG_GIT}" ]; then \
    apt-get update && apt-get install -y --no-install-recommends ca-certificates git && rm -rf /var/lib/apt/lists/*; \
    echo "[deps] cloning service-catalog from git: ${SERVICE_CATALOG_GIT} @ ${SERVICE_CATALOG_REF}"; \
    git clone --depth 1 -b "${SERVICE_CATALOG_REF}" "${SERVICE_CATALOG_GIT}" /tmp/service-catalog; \
    npm i --ignore-scripts --include=dev file:/tmp/service-catalog; \
  else \
    echo "[deps] service-catalog not embedded during build (set SERVICE_CATALOG_TARBALL or SERVICE_CATALOG_GIT)"; \
  fi

# ---------- deps (production only) ----------
FROM deps AS deps-prod
WORKDIR /app
RUN npm prune --omit=dev

# ---------- builder (typescript -> dist) ----------
FROM ${BASE_NODE_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- model export (CPU) ----------
FROM ${BASE_PY_IMAGE} AS model-export
WORKDIR /work
# Configure pip mirror (configurable) and enable cache mounts
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ENV PIP_INDEX_URL=${PIP_INDEX_URL}
# Upgrade pip using cached wheels
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip
# Pin versions to improve Docker layer cache stability. Bump via build args when needed
ARG OPTIMUM_VER=1.27.0
ARG SENTENCEPIECE_VER=0.2.1
# Install Python deps with pip cache
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install "optimum[onnxruntime]==${OPTIMUM_VER}" "sentencepiece==${SENTENCEPIECE_VER}"
COPY scripts ./scripts
# Cache HuggingFace model/tokenizer downloads during export
ENV HF_HOME=/root/.cache/huggingface
RUN --mount=type=cache,target=/root/.cache/huggingface \
    python -u scripts/export_labse.py --model cointegrated/LaBSE-en-ru --out /models --opset 14 --max_len 256

# ---------- runtime (bm25 only) ----------
FROM ${BASE_NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV EMBEDDINGS_MODE=none
COPY package.json ./
# Use pre-installed production node_modules
COPY --from=deps-prod /app/node_modules ./node_modules

# Copy compiled dist
COPY --from=builder /app/dist ./dist

# Default data dir inside container; mount a volume to override
ENV DATA_DIR=/data
VOLUME ["/data"]
CMD ["node", "dist/index.js"]

# ---------- runtime-bm25-cat-extbase (external base with embedded catalog) ----------
FROM ${BASE_DEPS_IMAGE_CAT} AS runtime-bm25-cat-extbase
WORKDIR /app
COPY --from=builder /app/dist ./dist
ENV DATA_DIR=/data
VOLUME ["/data"]
CMD ["node", "dist/index.js"]

# ---------- base with deps for bm25 (no models) ----------
FROM ${BASE_NODE_IMAGE} AS base-bm25-with-deps
WORKDIR /app
ENV NODE_ENV=production
ENV EMBEDDINGS_MODE=none
COPY package.json ./
COPY --from=deps-prod /app/node_modules ./node_modules

# ---------- runtime-bm25-extbase (external base image with node_modules) ----------
FROM ${BASE_DEPS_IMAGE} AS runtime-bm25-extbase
WORKDIR /app
COPY --from=builder /app/dist ./dist
ENV DATA_DIR=/data
VOLUME ["/data"]
CMD ["node", "dist/index.js"]

# ---------- base with models for onnx-cpu ----------
FROM node:20-bullseye AS base-onnx-cpu-with-models
WORKDIR /app
ENV NODE_ENV=production
ENV EMBEDDINGS_MODE=onnx-cpu
COPY package.json ./
# Use pre-installed production node_modules
COPY --from=deps-prod /app/node_modules ./node_modules
# Include model files and prepare native deps once in base
COPY --from=model-export /models ./models
RUN npm rebuild sharp --unsafe-perm --foreground-scripts || true

# ---------- runtime-onnx-cpu (bm25 + onnx cpu) ----------
FROM base-onnx-cpu-with-models AS runtime-onnx-cpu
WORKDIR /app
COPY --from=builder /app/dist ./dist
ENV DATA_DIR=/data
VOLUME ["/data"]
CMD ["node", "dist/index.js"]

# ---------- runtime-onnx-cpu-extbase (external base image with models) ----------
# Allows super-fast rebuilds by reusing a prebuilt base image that already contains
# production node_modules and ONNX models. Only the small dist layer is added.
FROM ${BASE_MODELS_IMAGE} AS runtime-onnx-cpu-extbase
WORKDIR /app
COPY --from=builder /app/dist ./dist
ENV DATA_DIR=/data
VOLUME ["/data"]
CMD ["node", "dist/index.js"]

# ---------- base-onnx-gpu-with-models (shared GPU base) ----------
# Contains Node.js, production node_modules, ONNX models and ORT GPU libs.
FROM ${BASE_CUDA_IMAGE} AS base-onnx-gpu-with-models
WORKDIR /app

# Install Node.js 20.x (NodeSource)
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg unzip \
  && mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
  && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends nodejs \
  && apt-get purge -y gnupg \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV EMBEDDINGS_MODE=onnx-gpu
ENV ONNXRUNTIME_NODE_EXECUTION_PROVIDERS=cuda,cpu

# App files
COPY package.json ./
# Use pre-built production node_modules from deps-prod (contains onnxruntime-node)
COPY --from=deps-prod /app/node_modules ./node_modules
# Local ONNX model & tokenizer
COPY --from=model-export /models ./models

# Install ORT GPU shared libraries and ensure onnxruntime-node postinstall
ARG ORT_VER=1.20.0
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /tmp/ort.tgz https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VER}/onnxruntime-linux-x64-gpu-${ORT_VER}.tgz \
 && mkdir -p /opt/ort-gpu-libs \
 && tar -xzf /tmp/ort.tgz -C /opt \
 && mv /opt/onnxruntime-linux-x64-gpu-${ORT_VER}/lib/* /opt/ort-gpu-libs/ \
 && rm -rf /opt/onnxruntime-linux-x64-gpu-${ORT_VER} /tmp/ort.tgz
ENV LD_LIBRARY_PATH=/opt/ort-gpu-libs:/usr/local/lib:/usr/lib
RUN npm rebuild onnxruntime-node --foreground-scripts || (echo "[warn] onnxruntime-node postinstall failed; will fall back to CPU provider at runtime" && true)
RUN npm rebuild sharp --unsafe-perm --foreground-scripts || true

# ---------- runtime-onnx-gpu (from base) ----------
FROM base-onnx-gpu-with-models AS runtime-onnx-gpu
WORKDIR /app
# Compiled JS only
COPY --from=builder /app/dist ./dist
# Ensure data dir volume
VOLUME ["/data"]
# Lightweight entrypoint to configure cache dirs for arbitrary --user and avoid CUDA/ORT segfaults
COPY bin/entrypoint.sh ./bin/entrypoint.sh
RUN chmod +x ./bin/entrypoint.sh
ENTRYPOINT ["/app/bin/entrypoint.sh"]
CMD ["node", "/app/dist/index.js"]

# ---------- runtime-onnx-gpu-cat-extbase (external GPU base with embedded catalog) ----------
FROM ${BASE_GPU_IMAGE_CAT} AS runtime-onnx-gpu-cat-extbase
WORKDIR /app
COPY --from=builder /app/dist ./dist
VOLUME ["/data"]
COPY bin/entrypoint.sh ./bin/entrypoint.sh
RUN chmod +x ./bin/entrypoint.sh
ENTRYPOINT ["/app/bin/entrypoint.sh"]
CMD ["node", "/app/dist/index.js"]

# ---------- runtime-onnx-gpu-extbase (external GPU base) ----------
FROM ${BASE_GPU_IMAGE} AS runtime-onnx-gpu-extbase
WORKDIR /app
COPY --from=builder /app/dist ./dist
VOLUME ["/data"]
COPY bin/entrypoint.sh ./bin/entrypoint.sh
RUN chmod +x ./bin/entrypoint.sh
ENTRYPOINT ["/app/bin/entrypoint.sh"]
CMD ["node", "/app/dist/index.js"]

# ---------- aliases: with-catalog convenience targets ----------
# These aliases simply re-tag existing stages. Actual inclusion of the catalog
# is controlled in the deps stage via SERVICE_CATALOG_* build args.
FROM runtime AS mcp-bm25-with-catalog
FROM runtime-onnx-cpu AS mcp-onnx-cpu-with-catalog
FROM runtime-onnx-gpu AS mcp-onnx-gpu-with-catalog

# ---------- dev target (optional) ----------
FROM ${BASE_NODE_ALPINE_IMAGE} AS dev

# ---------- proxy stages to bake toolchain bases into GHCR ----------
# These are used by the base workflow to publish GHCR images that mirror
# upstream docker.io images, so app builds never contact docker.io directly.
FROM docker.io/library/node:20-bullseye AS proxy-node20-bullseye
FROM docker.io/library/node:20-alpine AS proxy-node20-alpine
FROM docker.io/library/python:3.11-slim AS proxy-python311-slim
FROM docker.io/nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04 AS proxy-cuda-12-4-1
WORKDIR /app
ENV NODE_ENV=development
COPY package.json ./
ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
ENV ONNXRUNTIME_NODE_EXECUTION_PROVIDERS=cpu
RUN printf "registry=${NPM_REGISTRY}\n@modelcontextprotocol:registry=${NPM_REGISTRY}\n" > .npmrc \
 && npm config set fetch-retries 5 \
 && npm config set fetch-retry-factor 2 \
 && npm config set fetch-timeout 600000 \
 && npm i --include=dev --registry=${NPM_REGISTRY} --@modelcontextprotocol:registry=${NPM_REGISTRY}
COPY tsconfig.json ./
COPY src ./src
CMD ["npx", "tsx", "src/index.ts"]
