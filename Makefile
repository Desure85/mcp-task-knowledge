# Makefile for mcp-task-knowledge
# Usage examples:
#   make install
#   make build
#   make dev
#   make start
#   make docker-build-bm25
#   make docker-build-cpu
#   make docker-build-gpu
#   make docker-run-bm25 DATA_DIR=$(CURDIR)/.data
#   make docker-run-cpu DATA_DIR=$(CURDIR)/.data
#   make docker-run-gpu DATA_DIR=$(CURDIR)/.data

SHELL := /bin/sh

# Project/image params
IMG          ?= mcp-task-knowledge
TAG          ?= latest
CURDIR       := $(abspath .)
DATA_DIR     ?= $(CURDIR)/.data
OBSIDIAN_DIR ?= $(DATA_DIR)/obsidian
# Compose params
COMPOSE      ?= docker compose
COMPOSE_FILE ?= docker-compose.catalog.yml
# Buildx cache (local directory). Speeds up heavy layers (pip/torch/ORT, npm)
BUILDX_CACHE_DIR ?= .buildx-cache
## Optional: configure upstreams for faster builds
## - NPM_REGISTRY: pass as --build-arg to use a custom npm registry mirror
## - CACHE_IMAGE:  registry-backed buildx cache (e.g. ghcr.io/org/mcp-tk/cache:buildx)
## - PIP_INDEX_URL: python mirror used in model-export stage (pip install)
# NPM_REGISTRY ?=
# CACHE_IMAGE  ?=
# PIP_INDEX_URL ?=
## Helper to safely insert comma in $(if ...) arguments
COMMA := ,

# Runtime defaults for local runs
EMBEDDINGS_MODE ?= none   # options: none | onnx-cpu | onnx-gpu
CATALOG_MODE ?= embedded  # options: embedded | remote | hybrid

.PHONY: help install build dev start clean clean-dist \
	docker-build-bm25 docker-build-cpu docker-build-gpu \
	docker-build-bm25-nc docker-build-cpu-nc docker-build-gpu-nc \
	docker-build-bm25-cat docker-build-cpu-cat docker-build-gpu-cat \
	docker-buildx-bm25 docker-buildx-cpu docker-buildx-gpu \
	docker-buildx-bm25-nc docker-buildx-cpu-nc docker-buildx-gpu-nc \
	docker-buildx-bm25-cat docker-buildx-cpu-cat docker-buildx-gpu-cat \
	docker-run-bm25 docker-run-cpu docker-run-gpu \
	compose-up compose-up-detach compose-rebuild compose-ps compose-logs compose-down \
	registry-up registry-down \
	up-cpu up-gpu smoke-embeddings-cpu smoke-embeddings-gpu \
	smoke-embeddings-cpu-nobuild smoke-embeddings-gpu-nobuild

help:
	@echo "Targets:"
	@echo "  install            - Install deps (prefers npm ci)"
	@echo "  build              - Compile TypeScript to dist/"
	@echo "  dev                - Run in dev mode with tsx (stdin/stdout MCP)"
	@echo "  start              - Run compiled server from dist/"
	@echo "  docker-build-bm25  - Build Docker image (bm25 only)"
	@echo "  docker-build-cpu   - Build Docker image with ONNX CPU"
	@echo "  docker-build-gpu   - Build Docker image with ONNX GPU"
	@echo "  docker-build-bm25-nc  - Build Docker image (bm25) with --no-cache"
	@echo "  docker-build-cpu-nc   - Build Docker image (ONNX CPU) with --no-cache"
	@echo "  docker-build-gpu-nc   - Build Docker image (ONNX GPU) with --no-cache"
	@echo "  docker-build-bm25-cat - Build bm25 image with embedded service-catalog"
	@echo "  docker-build-cpu-cat  - Build onnx-cpu image with embedded service-catalog"
	@echo "  docker-build-gpu-cat  - Build onnx-gpu image with embedded service-catalog"
	@echo "  docker-buildx-bm25 - Build with buildx (bm25, --load)"
	@echo "  docker-buildx-cpu  - Build with buildx (ONNX CPU, --load, with cache)"
	@echo "  docker-buildx-gpu  - Build with buildx (ONNX GPU, --load, with cache)"
	@echo "  docker-buildx-bm25-nc - Build with buildx (bm25, --no-cache, --load)"
	@echo "  docker-buildx-cpu-nc  - Build with buildx (ONNX CPU, --no-cache, --load)"
	@echo "  docker-buildx-gpu-nc  - Build with buildx (ONNX GPU, --no-cache, --load)"
	@echo "  docker-buildx-bm25-cat - Buildx bm25 with embedded service-catalog"
	@echo "  docker-buildx-cpu-cat  - Buildx onnx-cpu with embedded service-catalog"
	@echo "  docker-buildx-gpu-cat  - Buildx onnx-gpu with embedded service-catalog"
	@echo "  docker-run-bm25    - Run bm25 image with volume mount"
	@echo "  docker-run-cpu     - Run onnx-cpu image with volume mount"
	@echo "  docker-run-gpu     - Run onnx-gpu image with GPU access and volume mount"
	@echo "  compose-up         - docker compose up (foreground) using $(COMPOSE_FILE)"
	@echo "  compose-up-detach  - docker compose up -d --build using $(COMPOSE_FILE)"
	@echo "  compose-rebuild    - docker compose up -d --build && show ps+logs"
	@echo "  compose-ps         - docker compose ps"
	@echo "  compose-logs       - docker compose logs --tail=200 mcp"
	@echo "  compose-down       - docker compose down -v"
	@echo "  registry-up        - Start local Docker Registry on :5000 (container name: registry)"
	@echo "  registry-down      - Stop and remove local Docker Registry container"
	@echo "  up-cpu             - switch compose to EMBEDDINGS_MODE=onnx-cpu and rebuild"
	@echo "  up-gpu             - switch compose to EMBEDDINGS_MODE=onnx-gpu and rebuild"
	@echo "  smoke-embeddings-cpu - run offline embeddings smoke test in CPU image"
	@echo "  smoke-embeddings-gpu - run offline embeddings smoke test in GPU image (requires NVIDIA toolkit)"
	@echo "  smoke-embeddings-cpu-nobuild - run smoke in CPU image without rebuilding"
	@echo "  smoke-embeddings-gpu-nobuild - run smoke in GPU image without rebuilding"
	@echo "  clean              - Remove dist/"

install:
	@if command -v npm >/dev/null 2>&1; then \
	  (npm ci || npm i); \
	else \
	  echo "npm not found" && exit 1; \
	fi

build:
	npm run build

# Dev uses tsx, requires env vars for config.ts
# DATA_DIR and OBSIDIAN_VAULT_ROOT must exist/be set
# Example: make dev DATA_DIR=$(CURDIR)/.data OBSIDIAN_DIR=$(CURDIR)/.data/obsidian
# EMBEDDINGS_MODE defaults to 'none' to avoid ONNX requirement in dev

dev:
	mkdir -p "$(DATA_DIR)" "$(OBSIDIAN_DIR)"
	DATA_DIR="$(DATA_DIR)" \
	OBSIDIAN_VAULT_ROOT="$(OBSIDIAN_DIR)" \
	EMBEDDINGS_MODE="$(EMBEDDINGS_MODE)" \
	npm run dev

start: build
	mkdir -p "$(DATA_DIR)" "$(OBSIDIAN_DIR)"
	DATA_DIR="$(DATA_DIR)" \
	OBSIDIAN_VAULT_ROOT="$(OBSIDIAN_DIR)" \
	EMBEDDINGS_MODE="$(EMBEDDINGS_MODE)" \
	npm start

clean:
	rm -rf dist

clean-dist: clean

# ---------- Docker ----------
# Dockerfile has stages: runtime (bm25), runtime-onnx-cpu, runtime-onnx-gpu

docker-build-bm25:
	docker build --pull --progress=plain \
	  $(if $(NPM_REGISTRY),--build-arg NPM_REGISTRY=$(NPM_REGISTRY),) \
	  $(if $(PIP_INDEX_URL),--build-arg PIP_INDEX_URL=$(PIP_INDEX_URL),) \
	  --target runtime -t $(IMG):bm25 .

docker-build-cpu:
	docker build --pull --progress=plain \
	  $(if $(NPM_REGISTRY),--build-arg NPM_REGISTRY=$(NPM_REGISTRY),) \
	  $(if $(PIP_INDEX_URL),--build-arg PIP_INDEX_URL=$(PIP_INDEX_URL),) \
	  --target runtime-onnx-cpu -t $(IMG):cpu .

docker-build-gpu:
	docker build --pull --progress=plain \
	  $(if $(NPM_REGISTRY),--build-arg NPM_REGISTRY=$(NPM_REGISTRY),) \
	  $(if $(PIP_INDEX_URL),--build-arg PIP_INDEX_URL=$(PIP_INDEX_URL),) \
	  --target runtime-onnx-gpu -t $(IMG):gpu .

# With catalog (uses alias stages; embedding controlled by SERVICE_CATALOG_* build args)
docker-build-bm25-cat:
	docker build --pull --progress=plain \
	  $(if $(NPM_REGISTRY),--build-arg NPM_REGISTRY=$(NPM_REGISTRY),) \
	  $(if $(SERVICE_CATALOG_TARBALL),--build-arg SERVICE_CATALOG_TARBALL=$(SERVICE_CATALOG_TARBALL),) \
	  $(if $(SERVICE_CATALOG_GIT),--build-arg SERVICE_CATALOG_GIT=$(SERVICE_CATALOG_GIT),) \
	  $(if $(SERVICE_CATALOG_REF),--build-arg SERVICE_CATALOG_REF=$(SERVICE_CATALOG_REF),) \
	  --target mcp-bm25-with-catalog -t $(IMG):bm25-cat .

docker-build-cpu-cat:
	docker build --pull --progress=plain \
	  $(if $(NPM_REGISTRY),--build-arg NPM_REGISTRY=$(NPM_REGISTRY),) \
	  $(if $(PIP_INDEX_URL),--build-arg PIP_INDEX_URL=$(PIP_INDEX_URL),) \
	  $(if $(SERVICE_CATALOG_TARBALL),--build-arg SERVICE_CATALOG_TARBALL=$(SERVICE_CATALOG_TARBALL),) \
	  $(if $(SERVICE_CATALOG_GIT),--build-arg SERVICE_CATALOG_GIT=$(SERVICE_CATALOG_GIT),) \
	  $(if $(SERVICE_CATALOG_REF),--build-arg SERVICE_CATALOG_REF=$(SERVICE_CATALOG_REF),) \
	  --target mcp-onnx-cpu-with-catalog -t $(IMG):cpu-cat .

docker-build-gpu-cat:
	docker build --pull --progress=plain \
	  $(if $(NPM_REGISTRY),--build-arg NPM_REGISTRY=$(NPM_REGISTRY),) \
	  $(if $(PIP_INDEX_URL),--build-arg PIP_INDEX_URL=$(PIP_INDEX_URL),) \
	  $(if $(SERVICE_CATALOG_TARBALL),--build-arg SERVICE_CATALOG_TARBALL=$(SERVICE_CATALOG_TARBALL),) \
	  $(if $(SERVICE_CATALOG_GIT),--build-arg SERVICE_CATALOG_GIT=$(SERVICE_CATALOG_GIT),) \
	  $(if $(SERVICE_CATALOG_REF),--build-arg SERVICE_CATALOG_REF=$(SERVICE_CATALOG_REF),) \
	  --target mcp-onnx-gpu-with-catalog -t $(IMG):gpu-cat .

# No-cache variants (classic docker build)
docker-build-bm25-nc:
	docker build --pull --no-cache --progress=plain \
	  $(if $(NPM_REGISTRY),--build-arg NPM_REGISTRY=$(NPM_REGISTRY),) \
	  $(if $(PIP_INDEX_URL),--build-arg PIP_INDEX_URL=$(PIP_INDEX_URL),) \
	  --target runtime -t $(IMG):bm25 .

docker-build-cpu-nc:
	docker build --pull --no-cache --progress=plain \
	  $(if $(NPM_REGISTRY),--build-arg NPM_REGISTRY=$(NPM_REGISTRY),) \
	  $(if $(PIP_INDEX_URL),--build-arg PIP_INDEX_URL=$(PIP_INDEX_URL),) \
	  --target runtime-onnx-cpu -t $(IMG):cpu .

docker-build-gpu-nc:
	docker build --pull --no-cache --progress=plain \
	  $(if $(NPM_REGISTRY),--build-arg NPM_REGISTRY=$(NPM_REGISTRY),) \
	  $(if $(PIP_INDEX_URL),--build-arg PIP_INDEX_URL=$(PIP_INDEX_URL),) \
	  --target runtime-onnx-gpu -t $(IMG):gpu .

# Build with buildx (loads into local docker)
docker-buildx-bm25:
	mkdir -p "$(BUILDX_CACHE_DIR)"
	docker buildx build --load --progress=plain \
	  --cache-from type=local,src=$(BUILDX_CACHE_DIR) \
	  --cache-to type=local,dest=$(BUILDX_CACHE_DIR),mode=max \
	  $(if $(NPM_REGISTRY),--build-arg NPM_REGISTRY=$(NPM_REGISTRY),) \
	  $(if $(PIP_INDEX_URL),--build-arg PIP_INDEX_URL=$(PIP_INDEX_URL),) \
	  --target runtime -t $(IMG):bm25 .

docker-buildx-cpu:
	mkdir -p "$(BUILDX_CACHE_DIR)"
	docker buildx build --load --progress=plain \
	  --cache-from type=local,src=$(BUILDX_CACHE_DIR) \
	  --cache-to type=local,dest=$(BUILDX_CACHE_DIR),mode=max \
	  $(if $(NPM_REGISTRY),--build-arg NPM_REGISTRY=$(NPM_REGISTRY),) \
	  $(if $(PIP_INDEX_URL),--build-arg PIP_INDEX_URL=$(PIP_INDEX_URL),) \
	  --target runtime-onnx-cpu -t $(IMG):cpu .

docker-buildx-gpu:
	mkdir -p "$(BUILDX_CACHE_DIR)"
	docker buildx build --load --progress=plain \
	  --cache-from type=local,src=$(BUILDX_CACHE_DIR) \
	  --cache-to type=local,dest=$(BUILDX_CACHE_DIR),mode=max \
	  $(if $(NPM_REGISTRY),--build-arg NPM_REGISTRY=$(NPM_REGISTRY),) \
	  $(if $(PIP_INDEX_URL),--build-arg PIP_INDEX_URL=$(PIP_INDEX_URL),) \
	  --target runtime-onnx-gpu -t $(IMG):gpu .

# buildx with catalog (loads into docker)
docker-buildx-bm25-cat:
	mkdir -p "$(BUILDX_CACHE_DIR)"
	docker buildx build --load --progress=plain \
	  --cache-from type=local,src=$(BUILDX_CACHE_DIR) \
	  --cache-to type=local,dest=$(BUILDX_CACHE_DIR),mode=max \
	  $(if $(NPM_REGISTRY),--build-arg NPM_REGISTRY=$(NPM_REGISTRY),) \
	  $(if $(SERVICE_CATALOG_TARBALL),--build-arg SERVICE_CATALOG_TARBALL=$(SERVICE_CATALOG_TARBALL),) \
	  $(if $(SERVICE_CATALOG_GIT),--build-arg SERVICE_CATALOG_GIT=$(SERVICE_CATALOG_GIT),) \
	  $(if $(SERVICE_CATALOG_REF),--build-arg SERVICE_CATALOG_REF=$(SERVICE_CATALOG_REF),) \
	  --target mcp-bm25-with-catalog -t $(IMG):bm25-cat .

docker-buildx-cpu-cat:
	mkdir -p "$(BUILDX_CACHE_DIR)"
	docker buildx build --load --progress=plain \
	  --cache-from type=local,src=$(BUILDX_CACHE_DIR) \
	  --cache-to type=local,dest=$(BUILDX_CACHE_DIR),mode=max \
	  $(if $(NPM_REGISTRY),--build-arg NPM_REGISTRY=$(NPM_REGISTRY),) \
	  $(if $(PIP_INDEX_URL),--build-arg PIP_INDEX_URL=$(PIP_INDEX_URL),) \
	  $(if $(SERVICE_CATALOG_TARBALL),--build-arg SERVICE_CATALOG_TARBALL=$(SERVICE_CATALOG_TARBALL),) \
	  $(if $(SERVICE_CATALOG_GIT),--build-arg SERVICE_CATALOG_GIT=$(SERVICE_CATALOG_GIT),) \
	  $(if $(SERVICE_CATALOG_REF),--build-arg SERVICE_CATALOG_REF=$(SERVICE_CATALOG_REF),) \
	  --target mcp-onnx-cpu-with-catalog -t $(IMG):cpu-cat .

docker-buildx-gpu-cat:
	mkdir -p "$(BUILDX_CACHE_DIR)"
	docker buildx build --load --progress=plain \
	  --cache-from type=local,src=$(BUILDX_CACHE_DIR) \
	  --cache-to type=local,dest=$(BUILDX_CACHE_DIR),mode=max \
	  $(if $(NPM_REGISTRY),--build-arg NPM_REGISTRY=$(NPM_REGISTRY),) \
	  $(if $(PIP_INDEX_URL),--build-arg PIP_INDEX_URL=$(PIP_INDEX_URL),) \
	  $(if $(SERVICE_CATALOG_TARBALL),--build-arg SERVICE_CATALOG_TARBALL=$(SERVICE_CATALOG_TARBALL),) \
	  $(if $(SERVICE_CATALOG_GIT),--build-arg SERVICE_CATALOG_GIT=$(SERVICE_CATALOG_GIT),) \
	  $(if $(SERVICE_CATALOG_REF),--build-arg SERVICE_CATALOG_REF=$(SERVICE_CATALOG_REF),) \
	  --target mcp-onnx-gpu-with-catalog -t $(IMG):gpu-cat .

# No-cache variants (buildx)
docker-buildx-bm25-nc:
	docker buildx build --load --no-cache --progress=plain \
	  $(if $(NPM_REGISTRY),--build-arg NPM_REGISTRY=$(NPM_REGISTRY),) \
	  --target runtime -t $(IMG):bm25 .

docker-buildx-cpu-nc:
	docker buildx build --load --no-cache --progress=plain \
	  $(if $(NPM_REGISTRY),--build-arg NPM_REGISTRY=$(NPM_REGISTRY),) \
	  --target runtime-onnx-cpu -t $(IMG):cpu .

docker-buildx-gpu-nc:
	mkdir -p "$(BUILDX_CACHE_DIR)"
	docker buildx build --load --no-cache --progress=plain \
	  --cache-to type=local,dest=$(BUILDX_CACHE_DIR),mode=max \
	  $(if $(NPM_REGISTRY),--build-arg NPM_REGISTRY=$(NPM_REGISTRY),) \
	  $(if $(PIP_INDEX_URL),--build-arg PIP_INDEX_URL=$(PIP_INDEX_URL),) \
	  --target runtime-onnx-gpu -t $(IMG):gpu .

# Run containers (stdin/stdout MCP). Mount DATA_DIR to /data
# Ensure your client connects via stdio or adjust to expose ports if needed.

docker-run-bm25:
	mkdir -p "$(DATA_DIR)" "$(OBSIDIAN_DIR)"
	docker run --rm -it \
	  -e DATA_DIR=/data \
	  -e OBSIDIAN_VAULT_ROOT=/data/obsidian \
	  -e EMBEDDINGS_MODE=none \
	  -e CATALOG_MODE=$(CATALOG_MODE) \
	  -v "$(DATA_DIR)":/data \
	  $(IMG):bm25

# For CPU ONNX runtime; model files are baked into the image (from model-export stage)
docker-run-cpu:
	mkdir -p "$(DATA_DIR)" "$(OBSIDIAN_DIR)"
	docker run --rm -it \
	  -e DATA_DIR=/data \
	  -e OBSIDIAN_VAULT_ROOT=/data/obsidian \
	  -e EMBEDDINGS_MODE=onnx-cpu \
	  -e CATALOG_MODE=$(CATALOG_MODE) \
	  -v "$(DATA_DIR)":/data \
	  $(IMG):cpu

# For GPU ONNX runtime; requires NVIDIA Container Toolkit on host
docker-run-gpu:
	mkdir -p "$(DATA_DIR)" "$(OBSIDIAN_DIR)"
	docker run --rm -it \
	  --gpus all \
	  -e DATA_DIR=/data \
	  -e OBSIDIAN_VAULT_ROOT=/data/obsidian \
	  -e EMBEDDINGS_MODE=onnx-gpu \
	  -e CATALOG_MODE=$(CATALOG_MODE) \
	  -v "$(DATA_DIR)":/data \
	  $(IMG):gpu

# ---------- docker compose helpers ----------
compose-up:
	$(COMPOSE) -f $(COMPOSE_FILE) up --build

compose-up-detach:
	$(COMPOSE) -f $(COMPOSE_FILE) up -d --build

compose-rebuild:
	$(COMPOSE) -f $(COMPOSE_FILE) up -d --build
	$(COMPOSE) -f $(COMPOSE_FILE) ps
	$(COMPOSE) -f $(COMPOSE_FILE) logs --tail=200 mcp || true

compose-ps:
	$(COMPOSE) -f $(COMPOSE_FILE) ps

compose-logs:
	$(COMPOSE) -f $(COMPOSE_FILE) logs --tail=200 mcp

compose-down:
	$(COMPOSE) -f $(COMPOSE_FILE) down -v

# ---------- local Docker Registry helpers ----------
registry-up:
	@docker rm -f registry >/dev/null 2>&1 || true
	docker run -d --restart=always -p 5000:5000 --name registry registry:2
	@echo "Local registry is up at http://127.0.0.1:5000"

registry-down:
	@docker rm -f registry >/dev/null 2>&1 || true
	@echo "Local registry stopped and removed"

# ---------- convenience: switch compose embeddings mode and rebuild ----------
# NOTE: this edits EMBEDDINGS_MODE line in the compose file in-place
up-cpu:
	sed -i 's/^\s*- EMBEDDINGS_MODE=.*/      - EMBEDDINGS_MODE=onnx-cpu/' $(COMPOSE_FILE)
	sed -i 's/^\s*target:\s*runtime-onnx-.*/      target: runtime-onnx-cpu/' $(COMPOSE_FILE)
	$(COMPOSE) -f $(COMPOSE_FILE) up -d --build
	$(COMPOSE) -f $(COMPOSE_FILE) ps
	$(COMPOSE) -f $(COMPOSE_FILE) logs --tail=120 mcp || true

up-gpu:
	sed -i 's/^\s*- EMBEDDINGS_MODE=.*/      - EMBEDDINGS_MODE=onnx-gpu/' $(COMPOSE_FILE)
	sed -i 's/^\s*target:\s*runtime-onnx-.*/      target: runtime-onnx-gpu/' $(COMPOSE_FILE)
	$(COMPOSE) -f $(COMPOSE_FILE) up -d --build
	$(COMPOSE) -f $(COMPOSE_FILE) ps
	$(COMPOSE) -f $(COMPOSE_FILE) logs --tail=120 mcp || true

# ---------- smoke test for embeddings (CPU image) ----------
smoke-embeddings-cpu: docker-buildx-cpu
	mkdir -p "$(DATA_DIR)" "$(OBSIDIAN_DIR)"
	docker run --rm \
	  -e DATA_DIR=/data \
	  -e OBSIDIAN_VAULT_ROOT=/data/obsidian \
	  -e EMBEDDINGS_MODE=onnx-cpu \
	  -v "$(DATA_DIR)":/data \
	  -v "$(CURDIR)/scripts/smoke_embeddings.mjs":/tmp/smoke_embeddings.mjs:ro \
	  $(IMG):cpu \
	  node /tmp/smoke_embeddings.mjs

smoke-embeddings-gpu: docker-buildx-gpu
	mkdir -p "$(DATA_DIR)" "$(OBSIDIAN_DIR)"
	docker run --rm --gpus all \
	  -e DATA_DIR=/data \
	  -e OBSIDIAN_VAULT_ROOT=/data/obsidian \
	  -e EMBEDDINGS_MODE=onnx-gpu \
	  -v "$(DATA_DIR)":/data \
	  -v "$(CURDIR)/scripts/smoke_embeddings.mjs":/tmp/smoke_embeddings.mjs:ro \
	  $(IMG):gpu \
	  node /tmp/smoke_embeddings.mjs

# No-build variants: run smoke against existing images (avoid rebuild if not needed)
smoke-embeddings-cpu-nobuild:
	mkdir -p "$(DATA_DIR)" "$(OBSIDIAN_DIR)"
	docker run --rm \
	  -e DATA_DIR=/data \
	  -e OBSIDIAN_VAULT_ROOT=/data/obsidian \
	  -e EMBEDDINGS_MODE=onnx-cpu \
	  -v "$(DATA_DIR)":/data \
	  -v "$(CURDIR)/scripts/smoke_embeddings.mjs":/tmp/smoke_embeddings.mjs:ro \
	  $(IMG):cpu \
	  node /tmp/smoke_embeddings.mjs

smoke-embeddings-gpu-nobuild:
	mkdir -p "$(DATA_DIR)" "$(OBSIDIAN_DIR)"
	docker run --rm --gpus all \
	  -e DATA_DIR=/data \
	  -e OBSIDIAN_VAULT_ROOT=/data/obsidian \
	  -e EMBEDDINGS_MODE=onnx-gpu \
	  -v "$(DATA_DIR)":/data \
	  -v "$(CURDIR)/scripts/smoke_embeddings.mjs":/tmp/smoke_embeddings.mjs:ro \
	  $(IMG):gpu \
	  node /tmp/smoke_embeddings.mjs
