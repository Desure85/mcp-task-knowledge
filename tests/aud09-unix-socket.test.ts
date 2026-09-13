/**
 * AUD-09: Unix socket security — chmod 600 + optional requireAuth.
 *
 * Covers:
 *   - socket file is created with mode 0600 (owner-only)
 *   - stale socket file is removed before bind
 *   - live listener on the same path → connect() fails with a clear error
 *   - MCP_UNIX_REQUIRE_AUTH=1 → AuthManager.requireAuth=true for unix transport
 *   - default (env unset) → requireAuth stays false for unix
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UnixTransportAdapter } from '../src/transport/stream-transport.js';
import { AuthManager } from '../src/core/auth.js';
import { decideToolCall } from '../src/core/auth-gate.js';
import type { ServerContext } from '../src/register/context.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

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
    SERVER_CAPS: { resources: { subscribe: false, listChanged: false }, tools: { listChanged: false }, prompts: { listChanged: false }, completion: {} },
    normalizeBase64: (s) => s,
    makeResourceTemplate: (_p: string) => ({} as any),
    registerToolAsResource: () => {},
  };
}

function tmpSock(): string {
  return path.join(os.tmpdir(), `aud09-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
}

describe('AUD-09 unix socket security', () => {
  let ctx: ServerContext;
  const adapters: UnixTransportAdapter[] = [];

  beforeAll(() => {
    ctx = createMockContext();
  });

  afterEach(async () => {
    for (const a of adapters.splice(0)) {
      await a.close().catch(() => {});
    }
  });

  it('creates the socket file with mode 0600 (owner-only)', async () => {
    const sock = tmpSock();
    const adapter = new UnixTransportAdapter(sock);
    adapters.push(adapter);
    await adapter.connect(ctx);

    const stat = fs.statSync(sock);
    // eslint-disable-next-line no-bitwise
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('removes a stale socket file before bind', async () => {
    const sock = tmpSock();
    fs.writeFileSync(sock, 'stale');
    expect(fs.existsSync(sock)).toBe(true);

    const adapter = new UnixTransportAdapter(sock);
    adapters.push(adapter);
    await adapter.connect(ctx);
    expect(adapter.connected).toBe(true);
  });

  it('fails with a clear error when a live listener owns the socket', async () => {
    const sock = tmpSock();
    const first = new UnixTransportAdapter(sock);
    adapters.push(first);
    await first.connect(ctx);
    expect(first.connected).toBe(true);

    const second = new UnixTransportAdapter(sock);
    await expect(second.connect(ctx)).rejects.toThrow(/already in use by a live listener/);
  });

  it('MCP_UNIX_REQUIRE_AUTH=1 → requireAuth=true for unix transport', () => {
    const prev = process.env.MCP_UNIX_REQUIRE_AUTH;
    process.env.MCP_UNIX_REQUIRE_AUTH = '1';
    try {
      const unixRequireAuth = ['1', 'true', 'yes', 'on'].includes(
        (process.env.MCP_UNIX_REQUIRE_AUTH ?? '').toLowerCase(),
      );
      const auth = new AuthManager({
        requireAuth: unixRequireAuth,
        transport: 'unix',
      });
      expect(auth.isAuthRequired()).toBe(true);

      // Gate denies unauthenticated tool call on unix when auth is required.
      const decision = decideToolCall(auth, 'unix', { toolName: 'tasks_list' });
      expect(decision.allowed).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.MCP_UNIX_REQUIRE_AUTH;
      else process.env.MCP_UNIX_REQUIRE_AUTH = prev;
    }
  });

  it('default (env unset) → requireAuth=false for unix transport', () => {
    const prev = process.env.MCP_UNIX_REQUIRE_AUTH;
    delete process.env.MCP_UNIX_REQUIRE_AUTH;
    try {
      const unixRequireAuth = ['1', 'true', 'yes', 'on'].includes(
        (process.env.MCP_UNIX_REQUIRE_AUTH ?? '').toLowerCase(),
      );
      const auth = new AuthManager({
        requireAuth: unixRequireAuth,
        transport: 'unix',
      });
      expect(auth.isAuthRequired()).toBe(false);

      const decision = decideToolCall(auth, 'unix', { toolName: 'tasks_list' });
      expect(decision.allowed).toBe(true);
    } finally {
      if (prev !== undefined) process.env.MCP_UNIX_REQUIRE_AUTH = prev;
    }
  });

  it('explicit requireAuth=false overrides MCP_UNIX_REQUIRE_AUTH=1', () => {
    const prev = process.env.MCP_UNIX_REQUIRE_AUTH;
    process.env.MCP_UNIX_REQUIRE_AUTH = '1';
    try {
      const unixRequireAuth = ['1', 'true', 'yes', 'on'].includes(
        (process.env.MCP_UNIX_REQUIRE_AUTH ?? '').toLowerCase(),
      );
      const auth = new AuthManager({
        requireAuth: false,
        transport: 'unix',
      });
      expect(auth.isAuthRequired()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.MCP_UNIX_REQUIRE_AUTH;
      else process.env.MCP_UNIX_REQUIRE_AUTH = prev;
    }
  });
});
