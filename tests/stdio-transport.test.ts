/**
 * Tests for Stdio Transport Adapter (T-003)
 *
 * Tests the stdio adapter's lifecycle, idempotency, and interface compliance.
 * Note: full end-to-end stdio tests (spawning a subprocess) are covered by
 * E2E test suites that require dist/index.js — these are unit-level.
 */

import { describe, it, expect } from 'vitest';
import {
  StdioTransportAdapter,
  StdioTransportFactory,
} from '../src/transport/stdio-transport.js';
import { TransportRegistry } from '../src/transport/registry.js';
import type { ServerContext } from '../src/register/context.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ─── Helpers ──────────────────────────────────────────────────────────

function createMockContext(): ServerContext {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  return {
    server,
    cfg: {
      embeddings: { mode: 'none' },
      obsidian: { vaultRoot: '/tmp/test-vault' },
    },
    catalogCfg: {
      mode: 'embedded',
      prefer: 'embedded',
      embedded: { enabled: false, prefix: '/catalog', store: 'memory' },
      remote: { enabled: false, timeoutMs: 2000 },
      sync: { enabled: false, intervalSec: 60, direction: 'none' },
    },
    catalogProvider: {} as any,
    vectorAdapter: undefined,
    vectorInitAttempted: false,
    ensureVectorAdapter: async () => undefined,
    toolRegistry: {
      get: () => undefined,
      has: () => false,
      set: () => {},
      all: () => [],
      size: 0,
    } as any,
    resourceRegistry: [],
    toolNames: new Set(),
    STRICT_TOOL_DEDUP: false,
    TOOLS_ENABLED: true,
    TOOL_RES_ENABLED: false,
    TOOL_RES_EXEC: false,
    REPO_ROOT: '/tmp',
    SERVER_CAPS: { resources: { list: true, read: true }, tools: { call: true } },
    normalizeBase64: (s) => s,
    makeResourceTemplate: (p: string) => ({} as any),
    registerToolAsResource: () => {},
  };
}

// ─── StdioTransportAdapter ───────────────────────────────────────────

describe('StdioTransportAdapter', () => {
  it('should expose type as "stdio"', () => {
    const adapter = new StdioTransportAdapter();
    expect(adapter.type).toBe('stdio');
  });

  it('should start disconnected', () => {
    const adapter = new StdioTransportAdapter();
    expect(adapter.connected).toBe(false);
  });

  it('should be idempotent on close (not connected)', async () => {
    const adapter = new StdioTransportAdapter();
    // close() when not connected should be a no-op, not throw
    await adapter.close();
    await adapter.close();
    expect(adapter.connected).toBe(false);
  });
});

// ─── StdioTransportFactory ──────────────────────────────────────────

describe('StdioTransportFactory', () => {
  it('should expose type as "stdio"', () => {
    const factory = new StdioTransportFactory();
    expect(factory.type).toBe('stdio');
  });

  it('should create adapter without config', () => {
    const factory = new StdioTransportFactory();
    const adapter = factory.create({ type: 'stdio' });
    expect(adapter.type).toBe('stdio');
    expect(adapter.connected).toBe(false);
  });
});

// ─── TransportRegistry ─────────────────────────────────────────────

describe('TransportRegistry — stdio', () => {
  it('should have stdio registered by default', () => {
    const registry = new TransportRegistry();
    expect(registry.has('stdio')).toBe(true);
  });

  it('should create stdio adapter via registry', () => {
    const registry = new TransportRegistry();
    const adapter = registry.createTransport({ type: 'stdio' });
    expect(adapter.type).toBe('stdio');
  });
});

// ─── Interface compliance ──────────────────────────────────────────

describe('TransportAdapter interface compliance', () => {
  const transports = [
    { name: 'stdio', create: () => new StdioTransportAdapter() },
  ];

  for (const { name, create } of transports) {
    describe(name, () => {
      it('should have type and connected getters', () => {
        const adapter = create();
        expect(typeof adapter.type).toBe('string');
        expect(typeof adapter.connected).toBe('boolean');
      });

      it('should have connect and close methods', () => {
        const adapter = create();
        expect(typeof adapter.connect).toBe('function');
        expect(typeof adapter.close).toBe('function');
      });
    });
  }
});
