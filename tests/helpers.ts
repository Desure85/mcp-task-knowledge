/**
 * tests/helpers.ts — Shared test factories (DX-007)
 *
 * Single source of truth for mock ServerContext / ToolContext used across
 * test files. Keeps mocks in sync with the real interfaces (TD-012) and
 * avoids 1700+ lines of duplication.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../src/register/context.js';
import type { ToolContext } from '../src/core/tool-executor.js';
import type { ServerConfig, CatalogConfig } from '../src/config.js';

/** Minimal valid ServerConfig for tests (embeddings off). */
export function mockServerConfig(): ServerConfig {
  return {
    embeddings: { mode: 'none' },
    obsidian: { vaultRoot: '/tmp/test-vault' },
  } as ServerConfig;
}

/** Minimal valid CatalogConfig (embedded, memory, disabled by default). */
export function mockCatalogConfig(): CatalogConfig {
  return {
    mode: 'embedded',
    prefer: 'embedded',
    embedded: { enabled: false, prefix: '/catalog', store: 'memory' },
    remote: { enabled: false, timeoutMs: 2000 },
    sync: { enabled: false, intervalSec: 60, direction: 'none' },
  } as CatalogConfig;
}

/**
 * Build a mock ServerContext with a real McpServer and inert registries.
 * Overrides let tests customize specific fields.
 */
export function createMockServerContext(overrides: Partial<ServerContext> = {}): ServerContext {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  return {
    server,
    cfg: mockServerConfig(),
    catalogCfg: mockCatalogConfig(),
    catalogProvider: {} as never,
    vectorAdapter: undefined,
    vectorInitAttempted: false,
    ensureVectorAdapter: async () => undefined,
    toolRegistry: { get: () => undefined, has: () => false, set: () => {}, all: () => [], size: 0 } as never,
    resourceRegistry: [],
    toolNames: new Set(),
    STRICT_TOOL_DEDUP: false,
    TOOLS_ENABLED: true,
    TOOL_RES_ENABLED: false,
    TOOL_RES_EXEC: false,
    REPO_ROOT: '/tmp',
    SERVER_CAPS: { resources: { list: true, read: true }, tools: { call: true } },
    normalizeBase64: (s: string) => s,
    makeResourceTemplate: () => ({}) as never,
    registerToolAsResource: () => {},
    ...overrides,
  };
}

/** Build a minimal ToolContext for executor/middleware tests. */
export function createMockToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    sessionId: 'test-session',
    roles: [],
    remote: '127.0.0.1:1',
    createdAt: Date.now(),
    metadata: {},
    server: createMockServerContext(),
    ...overrides,
  };
}
