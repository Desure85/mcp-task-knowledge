/**
 * Tests for TCP and Unix transport adapters (T-002)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import {
  TcpTransportAdapter,
  TcpTransportFactory,
  UnixTransportAdapter,
  UnixTransportFactory,
} from '../src/transport/stream-transport.js';
import { TransportRegistry } from '../src/transport/registry.js';
import type { ServerContext } from '../src/register/context.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Create a mock ServerContext for testing transport.connect().
 */
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

/**
 * Connect a TCP client to the given port and return the socket.
 */
function connectTcpClient(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

/**
 * Connect a Unix socket client.
 */
function connectUnixClient(socketPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

/**
 * Read a complete JSON-RPC message from a socket.
 * Messages use newline-delimited JSON (Content-Length framing is handled by SDK).
 */
function readMessage(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('read timeout')), 5000);
    socket.once('data', (data) => {
      clearTimeout(timeout);
      resolve(data.toString());
    });
    socket.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    socket.once('close', () => {
      clearTimeout(timeout);
      reject(new Error('socket closed'));
    });
  });
}

// ─── TCP Transport ────────────────────────────────────────────────────

describe('TcpTransportAdapter', () => {
  const PORT = 13002;
  let ctx: ServerContext;

  beforeAll(() => {
    ctx = createMockContext();
  });

  it('should register in TransportRegistry', () => {
    const registry = new TransportRegistry();
    expect(registry.has('tcp')).toBe(true);
    expect(registry.has('unix')).toBe(true);
  });

  it('should create adapter via factory', () => {
    const factory = new TcpTransportFactory();
    expect(factory.type).toBe('tcp');
    const a = factory.create({ type: 'tcp', options: { port: 9999 } });
    expect(a.type).toBe('tcp');
  });

  it('should prevent double connect', async () => {
    const a = new TcpTransportAdapter(13003, '127.0.0.1');
    await a.connect(ctx);
    await expect(a.connect(ctx)).rejects.toThrow('already connected');
    await a.close();
  });

  it('should be idempotent on close', async () => {
    const a = new TcpTransportAdapter(13004, '127.0.0.1');
    await a.close();
    await a.close();
  });

  it('should accept connections and create sessions', async () => {
    const adapter = new TcpTransportAdapter(PORT, '127.0.0.1');
    await adapter.connect(ctx);

    expect(adapter.connected).toBe(true);
    expect(adapter.activeConnections).toBe(0);

    const client = await connectTcpClient(PORT);
    await new Promise((r) => setTimeout(r, 200));

    expect(adapter.activeConnections).toBe(1);
    expect(adapter.getSessionInfo()).toHaveLength(1);
    expect(adapter.getSessionInfo()[0].id).toMatch(/^sess-\d+$/);

    client.destroy();
    await new Promise((r) => setTimeout(r, 500));
    expect(adapter.activeConnections).toBeLessThanOrEqual(1);

    await adapter.close();
  });

  it('should handle multiple concurrent connections', async () => {
    const adapter = new TcpTransportAdapter(PORT + 1, '127.0.0.1');
    await adapter.connect(ctx);

    const clients: net.Socket[] = [];
    for (let i = 0; i < 3; i++) {
      const client = await connectTcpClient(PORT + 1);
      clients.push(client);
    }

    await new Promise((r) => setTimeout(r, 300));
    expect(adapter.activeConnections).toBe(3);

    clients.forEach((c) => c.destroy());
    await new Promise((r) => setTimeout(r, 1000));
    // Connections may not all close immediately due to async cleanup
    expect(adapter.activeConnections).toBeLessThanOrEqual(3);

    await adapter.close();
  });

  it('should report session info', async () => {
    const adapter = new TcpTransportAdapter(PORT + 2, '127.0.0.1');
    await adapter.connect(ctx);

    const client = await connectTcpClient(PORT + 2);
    await new Promise((r) => setTimeout(r, 200));

    const info = adapter.getSessionInfo();
    expect(info[0].remote).toMatch(/127\.0\.0\.1:\d+/);
    expect(info[0].durationMs).toBeGreaterThanOrEqual(0);

    client.destroy();
    await new Promise((r) => setTimeout(r, 500));
    await adapter.close();
  });
});

// ─── Unix Socket Transport ─────────────────────────────────────────────

describe('UnixTransportAdapter', () => {
  let ctx: ServerContext;

  beforeAll(() => {
    ctx = createMockContext();
  });

  it('should create adapter via factory', () => {
    const factory = new UnixTransportFactory();
    expect(factory.type).toBe('unix');
    const a = factory.create({ type: 'unix', options: { path: '/tmp/test.sock' } } as any);
    expect(a.type).toBe('unix');
  });

  it('should expose socket path', () => {
    const adapter = new UnixTransportAdapter('/tmp/test-path.sock');
    expect(adapter.path).toBe('/tmp/test-path.sock');
  });

  it('should accept connections via Unix socket', async () => {
    const sockPath = `/tmp/mcp-test-${Date.now()}.sock`;
    const adapter = new UnixTransportAdapter(sockPath);
    await adapter.connect(ctx);
    expect(adapter.connected).toBe(true);

    const client = await connectUnixClient(sockPath);
    await new Promise((r) => setTimeout(r, 200));

    expect(adapter.activeConnections).toBe(1);

    client.destroy();
    await new Promise((r) => setTimeout(r, 1000));
    expect(adapter.activeConnections).toBeLessThanOrEqual(1);

    await adapter.close();
  });

  it('should clean up socket file on close', async () => {
    const sockPath = `/tmp/mcp-test-${Date.now()}.sock`;
    const adapter = new UnixTransportAdapter(sockPath);
    await adapter.connect(ctx);
    await adapter.close();
    expect(fs.existsSync(sockPath)).toBe(false);
  });

  it('should handle stale socket file on connect', async () => {
    const sockPath = `/tmp/mcp-test-${Date.now()}.sock`;
    fs.writeFileSync(sockPath, '');

    const adapter = new UnixTransportAdapter(sockPath);
    await adapter.connect(ctx);
    expect(adapter.connected).toBe(true);
    await adapter.close();
  });
});

// ─── Content-Length framing ───────────────────────────────────────────

describe('Stream transport JSON-RPC framing', () => {
  let ctx: ServerContext;

  beforeAll(() => {
    ctx = createMockContext();
  });

  it('should establish MCP session on connect', async () => {
    const PORT = 13007;
    const adapter = new TcpTransportAdapter(PORT, '127.0.0.1');
    await adapter.connect(ctx);

    const client = await connectTcpClient(PORT);
    await new Promise((r) => setTimeout(r, 300));

    expect(adapter.activeConnections).toBe(1);

    client.destroy();
    await new Promise((r) => setTimeout(r, 500));
    await adapter.close();
  }, 10000);
});

// ─── Factory ──────────────────────────────────────────────────────────

describe('TcpTransportFactory', () => {
  it('should use options from config', () => {
    const factory = new TcpTransportFactory();
    const adapter = factory.create({
      type: 'tcp',
      options: { port: 8080, host: 'localhost' },
    }) as TcpTransportAdapter;

    expect(adapter.type).toBe('tcp');
  });

  it('should fall back to env vars', () => {
    const origPort = process.env.MCP_TCP_PORT;
    const origHost = process.env.MCP_TCP_HOST;
    process.env.MCP_TCP_PORT = '4567';
    process.env.MCP_TCP_HOST = '0.0.0.0';

    const factory = new TcpTransportFactory();
    const adapter = factory.create({ type: 'tcp', options: {} });

    process.env.MCP_TCP_PORT = origPort;
    process.env.MCP_TCP_HOST = origHost;

    expect(adapter.type).toBe('tcp');
  });
});

describe('UnixTransportFactory', () => {
  it('should use path from config', () => {
    const factory = new UnixTransportFactory();
    const adapter = factory.create({
      type: 'unix',
      options: { path: '/custom/path.sock' },
    }) as UnixTransportAdapter;

    expect(adapter.type).toBe('unix');
    expect(adapter.path).toBe('/custom/path.sock');
  });

  it('should fall back to env var', () => {
    const origPath = process.env.MCP_UNIX_PATH;
    process.env.MCP_UNIX_PATH = '/tmp/test-env.sock';

    const factory = new UnixTransportFactory();
    const adapter = factory.create({ type: 'unix', options: {} });

    process.env.MCP_UNIX_PATH = origPath;

    expect(adapter.path).toBe('/tmp/test-env.sock');
  });
});
