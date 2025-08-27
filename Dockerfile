# syntax=docker/dockerfile:1.7

# ---------- base deps (cacheable) ----------
FROM node:20-bullseye AS deps
WORKDIR /app
COPY .npmrc package.json ./
# Use configurable npm registry (default: npmjs). Can be overridden via --build-arg NPM_REGISTRY=...
ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}
ENV ONNXRUNTIME_NODE_EXECUTION_PROVIDERS=cpu
# Optional: embed external service-catalog library
#  - SERVICE_CATALOG_TARBALL: URL to .tgz (npm pack output) to install
#  - SERVICE_CATALOG_GIT: git URL (https) to clone and install from folder
#  - SERVICE_CATALOG_REF: git ref/branch (default: main)
ARG SERVICE_CATALOG_TARBALL=
ARG SERVICE_CATALOG_GIT=https://github.com/Desure85/service-catalog.git
ARG SERVICE_CATALOG_REF=master
RUN printf "registry=${NPM_REGISTRY}\n" > .npmrc \
 && npm config set fetch-retries 5 \
 && npm config set fetch-retry-factor 2 \
 && npm config set fetch-timeout 600000 \
 && npm i --ignore-scripts --include=dev --registry=${NPM_REGISTRY}

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
FROM node:20-bullseye AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY .npmrc ./
COPY src ./src
RUN npm run build

# ---------- model export (CPU) ----------
FROM python:3.11-slim AS model-export
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
FROM node:20-bullseye AS runtime
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

# ---------- runtime-onnx-cpu (bm25 + onnx cpu) ----------
FROM node:20-bullseye AS runtime-onnx-cpu
WORKDIR /app
ENV NODE_ENV=production
ENV EMBEDDINGS_MODE=onnx-cpu
COPY package.json ./
COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# include model files
COPY --from=model-export /models ./models
## Ensure optional native deps like sharp fetch prebuilt binaries in final image
RUN npm rebuild sharp --unsafe-perm --foreground-scripts || true
ENV DATA_DIR=/data
VOLUME ["/data"]
CMD ["node", "dist/index.js"]

# ---------- runtime-onnx-gpu (bm25 + onnx gpu) ----------
# Note: requires GPU runner and NVIDIA runtime on host.
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04 AS runtime-onnx-gpu
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
# Compiled JS
COPY --from=builder /app/dist ./dist
# Local ONNX model & tokenizer
COPY --from=model-export /models ./models

# Re-run onnxruntime-node-gpu postinstall to fetch CUDA provider binaries inside GPU image
# Install matching ORT GPU shared libraries into the image (avoid host mounts)
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
# Ensure optional native deps like sharp fetch prebuilt binaries (no-op if not present)
RUN npm rebuild sharp --unsafe-perm --foreground-scripts || true

# Copy dist and models
COPY --from=builder /app/dist ./dist
COPY --from=model-export /models ./models

# Lightweight entrypoint to configure cache dirs for arbitrary --user and avoid CUDA/ORT segfaults
COPY bin/entrypoint.sh ./bin/entrypoint.sh
RUN chmod +x ./bin/entrypoint.sh

# Default entrypoint/cmd; can be overridden at runtime
ENTRYPOINT ["/app/bin/entrypoint.sh"]
CMD ["node", "/app/dist/index.js"]
VOLUME ["/data"]

# ---------- aliases: with-catalog convenience targets ----------
# These aliases simply re-tag existing stages. Actual inclusion of the catalog
# is controlled in the deps stage via SERVICE_CATALOG_* build args.
FROM runtime AS mcp-bm25-with-catalog
FROM runtime-onnx-cpu AS mcp-onnx-cpu-with-catalog
FROM runtime-onnx-gpu AS mcp-onnx-gpu-with-catalog

# ---------- dev target (optional) ----------
FROM node:20-alpine AS dev
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
