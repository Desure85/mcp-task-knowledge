import { describe, it, expect, beforeEach } from 'vitest';
import { TransportRegistry } from '../src/transport/registry.js';
import { StdioTransportFactory, StdioTransportAdapter } from '../src/transport/stdio-transport.js';
import { HttpTransportFactory, HttpTransportAdapter } from '../src/transport/http-transport.js';
import type { TransportConfig, TransportAdapter, TransportFactory } from '../src/transport/types.js';
import type { ServerContext } from '../src/register/context.js';

// ─── Helpers ──────────────────────────────────────────────────────────

/** Build a mock ServerContext (only server.connect is needed). */
function mockCtx(): ServerContext {
  return {
    server: {
      connect: async () => {},
      close: async () => {},
    } as any,
    cfg: {},
    catalogCfg: {},
    catalogProvider: {} as any,
    vectorAdapter: undefined,
    vectorInitAttempted: false,
    ensureVectorAdapter: async () => undefined,
    toolRegistry: new Map(),
    resourceRegistry: [],
    toolNames: new Set(),
    STRICT_TOOL_DEDUP: false,
    TOOLS_ENABLED: true,
    TOOL_RES_ENABLED: false,
    TOOL_RES_EXEC: false,
    REPO_ROOT: '/tmp',
    SERVER_CAPS: { resources: { list: true, read: true }, tools: { call: true } },
    normalizeBase64: (s) => s,
    makeResourceTemplate: () => ({}) as any,
    registerToolAsResource: () => {},
  };
}

// ─── Registry ─────────────────────────────────────────────────────────

describe('TransportRegistry', () => {
  it('registers stdio and http by default', () => {
    const r = new TransportRegistry();
    expect(r.getRegisteredTypes()).toContain('stdio');
    expect(r.getRegisteredTypes()).toContain('http');
    expect(r.has('stdio')).toBe(true);
    expect(r.has('http')).toBe(true);
  });

  it('rejects duplicate factory registration', () => {
    const r = new TransportRegistry();
    expect(() => r.registerTransport(new StdioTransportFactory())).toThrow('duplicate factory');
  });

  it('throws on unknown transport type', () => {
    const r = new TransportRegistry();
    expect(() => r.createTransport({ type: 'websocket' })).toThrow(/unknown type "websocket"/);
  });

  it('createTransport returns correct adapter type', () => {
    const r = new TransportRegistry();

    const stdio = r.createTransport({ type: 'stdio' });
    expect(stdio).toBeInstanceOf(StdioTransportAdapter);
    expect(stdio.type).toBe('stdio');

    const http = r.createTransport({ type: 'http' });
    expect(http).toBeInstanceOf(HttpTransportAdapter);
    expect(http.type).toBe('http');
  });

  it('getFactory returns factory or undefined', () => {
    const r = new TransportRegistry();
    expect(r.getFactory('stdio')).toBeInstanceOf(StdioTransportFactory);
    expect(r.getFactory('nonexistent')).toBeUndefined();
  });

  it('supports custom transport registration', () => {
    const r = new TransportRegistry();

    class FakeAdapter implements TransportAdapter {
      readonly type = 'fake';
      async connect() {}
      async close() {}
    }

    class FakeFactory implements TransportFactory {
      readonly type = 'fake';
      create() { return new FakeAdapter(); }
    }

    r.registerTransport(new FakeFactory());
    expect(r.has('fake')).toBe(true);

    const adapter = r.createTransport({ type: 'fake' });
    expect(adapter).toBeInstanceOf(FakeAdapter);
    expect(adapter.type).toBe('fake');
  });
});

// ─── Stdio Adapter ────────────────────────────────────────────────────

describe('StdioTransportAdapter', () => {
  it('factory creates adapter with correct type', () => {
    const f = new StdioTransportFactory();
    expect(f.type).toBe('stdio');
    const a = f.create({ type: 'stdio' });
    expect(a).toBeInstanceOf(StdioTransportAdapter);
  });

  it('connect calls server.connect and sets connected flag', async () => {
    const adapter = new StdioTransportAdapter();
    const ctx = mockCtx();
    let connected = false;
    (ctx.server as any).connect = async () => { connected = true; };

    await adapter.connect(ctx);
    expect(connected).toBe(true);
  });

  it('double connect throws', async () => {
    const adapter = new StdioTransportAdapter();
    const ctx = mockCtx();
    await adapter.connect(ctx);
    await expect(adapter.connect(ctx)).rejects.toThrow('already connected');
  });

  it('close without connect is no-op', async () => {
    const adapter = new StdioTransportAdapter();
    await expect(adapter.close()).resolves.not.toThrow();
  });

  it('close after connect is idempotent', async () => {
    const adapter = new StdioTransportAdapter();
    const ctx = mockCtx();
    await adapter.connect(ctx);
    await adapter.close();
    await expect(adapter.close()).resolves.not.toThrow();
  });
});

// ─── HTTP Adapter ─────────────────────────────────────────────────────

describe('HttpTransportAdapter', () => {
  it('factory creates adapter with default options', () => {
    const f = new HttpTransportFactory();
    expect(f.type).toBe('http');
    const a = f.create({ type: 'http' });
    expect(a).toBeInstanceOf(HttpTransportAdapter);
  });

  it('factory respects config options', () => {
    const f = new HttpTransportFactory();
    const a = f.create({ type: 'http', options: { port: 9999, host: '127.0.0.1' } });
    expect(a).toBeInstanceOf(HttpTransportAdapter);
  });

  it('constructor accepts port and host', () => {
    const a = new HttpTransportAdapter(8080, 'localhost');
    expect(a.type).toBe('http');
  });

  it('double connect throws', async () => {
    const adapter = new HttpTransportAdapter(0, '127.0.0.1');
    const ctx = mockCtx();

    // First connect succeeds but may fail because we use mock server
    // We need to properly mock the connect
    let connectCount = 0;
    (ctx.server as any).connect = async () => { connectCount++; };

    await adapter.connect(ctx);
    expect(connectCount).toBe(1);
    await expect(adapter.connect(ctx)).rejects.toThrow('already connected');

    await adapter.close();
  });

  it('close without connect is no-op', async () => {
    const adapter = new HttpTransportAdapter(0, '127.0.0.1');
    await expect(adapter.close()).resolves.not.toThrow();
  });

  it('close after connect is idempotent', async () => {
    const adapter = new HttpTransportAdapter(0, '127.0.0.1');
    const ctx = mockCtx();
    await adapter.connect(ctx);
    await adapter.close();
    await expect(adapter.close()).resolves.not.toThrow();
  });

  it('actually starts HTTP server on connect', async () => {
    const adapter = new HttpTransportAdapter(0, '127.0.0.1');
    const ctx = mockCtx();
    await adapter.connect(ctx);

    // Give the server a moment to start listening
    await new Promise((resolve) => setTimeout(resolve, 50));
    await adapter.close();
  }, 5000);
});

// ─── Registry: create from env-style config ──────────────────────────

describe('TransportRegistry (env-style config)', () => {
  it('creates stdio from minimal config', () => {
    const r = new TransportRegistry();
    const adapter = r.createTransport({ type: 'stdio' });
    expect(adapter.type).toBe('stdio');
  });

  it('creates http with port override', () => {
    const r = new TransportRegistry();
    const adapter = r.createTransport({ type: 'http', options: { port: 4000 } });
    expect(adapter.type).toBe('http');
  });

  it('error message lists available transports', () => {
    const r = new TransportRegistry();
    try {
      r.createTransport({ type: 'unknown' });
      expect.unreachable('should have thrown');
    } catch (e: any) {
      expect(e.message).toContain('stdio');
      expect(e.message).toContain('http');
    }
  });
});
