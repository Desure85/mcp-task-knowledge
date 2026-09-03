/**
 * SEC-003 — AuthManager wired into HTTP/TCP transports, fail-closed gate.
 *
 * Covers: unauthenticated tools/call rejected on http+tcp, authenticated
 * calls pass, pre-auth mcp.authenticate stays reachable, fail-closed when
 * AuthManager is missing/misconfigured, stdio stays open.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AuthManager, createStaticValidator } from '../src/core/auth.js';
import {
  decideToolCall,
  wrapToolHandler,
  extractHttpCall,
  deniedJsonRpcBody,
} from '../src/core/auth-gate.js';
import { registerAuthTools, resolveGateSessionId } from '../src/register/auth.js';
import { HttpTransportAdapter } from '../src/transport/http-transport.js';
import { TcpTransportAdapter } from '../src/transport/stream-transport.js';
import { AppContainer } from '../src/core/app-container.js';
import { TokenManager } from '../src/core/token-manager.js';
import { createServerContext } from '../src/register/setup.js';
import { createMockServerContext } from './helpers.js';
import type { ServerContext } from '../src/register/context.js';

// ─── Helpers ──────────────────────────────────────────────────────────

const TOKENS = {
  'valid-token': { userId: 'user-1', roles: ['admin'] },
};

function httpAuth(): AuthManager {
  return new AuthManager({
    transport: 'http',
    tokenValidator: createStaticValidator(TOKENS),
  });
}

function fakeReq(headers: Record<string, string | string[]> = {}): {
  headers: Record<string, string | string[]>;
} {
  return { headers };
}

// ─── decideToolCall ───────────────────────────────────────────────────

describe('decideToolCall — fail-closed matrix', () => {
  it('denies unauthenticated tools/call on http', () => {
    const d = decideToolCall(httpAuth(), 'http', { toolName: 'tasks_list', sessionId: 's-1' });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toMatch(/authentication required/);
  });

  it('denies unauthenticated tools/call on tcp', () => {
    const auth = new AuthManager({ transport: 'tcp', tokenValidator: createStaticValidator(TOKENS) });
    const d = decideToolCall(auth, 'tcp', { toolName: 'tasks_list', sessionId: 's-1' });
    expect(d.allowed).toBe(false);
  });

  it('denies when session id is unknown (fail-closed)', () => {
    const d = decideToolCall(httpAuth(), 'http', { toolName: 'tasks_list' });
    expect(d.allowed).toBe(false);
  });

  it('allows authenticated session on http and tcp', async () => {
    const auth = httpAuth();
    await auth.authenticate('s-1', 'valid-token');
    expect(decideToolCall(auth, 'http', { toolName: 'tasks_list', sessionId: 's-1' })).toEqual({ allowed: true });
    expect(decideToolCall(auth, 'tcp', { toolName: 'tasks_list', sessionId: 's-1' })).toEqual({ allowed: true });
  });

  it('keeps pre-auth mcp.authenticate reachable on http/tcp', () => {
    const auth = httpAuth();
    for (const t of ['http', 'tcp']) {
      expect(decideToolCall(auth, t, { toolName: 'mcp.authenticate' })).toEqual({ allowed: true });
      expect(decideToolCall(auth, t, { toolName: 'mcp.authenticate', sessionId: 'anon' })).toEqual({ allowed: true });
    }
  });

  it('fail-closed when AuthManager missing on http/tcp (misconfigured)', () => {
    for (const t of ['http', 'tcp']) {
      const d = decideToolCall(undefined, t, { toolName: 'tasks_list', sessionId: 's-1' });
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.reason).toMatch(/fail-closed/);
    }
  });

  it('fail-closed when AuthManager has no validator (can never authenticate)', async () => {
    const auth = new AuthManager({ transport: 'http' });
    const d = decideToolCall(auth, 'http', { toolName: 'tasks_list', sessionId: 's-1' });
    expect(d.allowed).toBe(false);
    await expect(auth.authenticate('s-1', 'anything')).rejects.toThrow(/no token validator/);
    expect(decideToolCall(auth, 'http', { toolName: 'mcp.authenticate', sessionId: 's-1' })).toEqual({ allowed: true });
  });

  it('leaves stdio/unix open without a gate', () => {
    expect(decideToolCall(undefined, 'stdio', { toolName: 'tasks_list' })).toEqual({ allowed: true });
    expect(decideToolCall(undefined, 'unix', { toolName: 'tasks_list' })).toEqual({ allowed: true });
    expect(decideToolCall(undefined, undefined, { toolName: 'tasks_list' })).toEqual({ allowed: true });
  });

  it('allows everything when requireAuth is false', () => {
    const auth = new AuthManager({ requireAuth: false });
    expect(decideToolCall(auth, 'http', { toolName: 'tasks_list' })).toEqual({ allowed: true });
  });
});

// ─── wrapToolHandler ──────────────────────────────────────────────────

describe('wrapToolHandler', () => {
  it('denies with isError envelope when unauthenticated', async () => {
    const auth = httpAuth();
    const wrapped = wrapToolHandler('tasks_list', async () => ({ content: [] }), () => ({
      auth,
      transport: 'http',
    }));
    const res = (await wrapped({}, { sessionId: 'anon' })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text)).toMatchObject({ ok: false });
  });

  it('delegates to the handler once authenticated', async () => {
    const auth = httpAuth();
    await auth.authenticate('s-9', 'valid-token');
    const wrapped = wrapToolHandler('tasks_list', async (args: unknown) => ({ echo: args }), () => ({
      auth,
      transport: 'http',
    }));
    await expect(wrapped({ a: 1 }, { sessionId: 's-9' })).resolves.toEqual({ echo: { a: 1 } });
  });
});

// ─── HTTP body helpers ────────────────────────────────────────────────

describe('extractHttpCall / deniedJsonRpcBody', () => {
  it('extracts tool name from tools/call', () => {
    expect(
      extractHttpCall({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'tasks_list' } }),
    ).toEqual({ method: 'tools/call', toolName: 'tasks_list', id: 3 });
  });

  it('passes non-tools/call through with method only', () => {
    expect(extractHttpCall({ jsonrpc: '2.0', id: 1, method: 'initialize' })).toEqual({ method: 'initialize' });
  });

  it('returns null for arrays and garbage', () => {
    expect(extractHttpCall([])).toBeNull();
    expect(extractHttpCall('nope')).toBeNull();
    expect(extractHttpCall(null)).toBeNull();
  });

  it('builds a -32001 JSON-RPC error preserving id', () => {
    const parsed = JSON.parse(deniedJsonRpcBody(7, 'nope')) as {
      jsonrpc: string;
      id: number;
      error: { code: number; message: string };
    };
    expect(parsed).toMatchObject({ jsonrpc: '2.0', id: 7, error: { code: -32001, message: 'nope' } });
  });
});

// ─── HttpTransportAdapter.authorizeHttpCall ───────────────────────────

describe('HttpTransportAdapter — transport-level gate', () => {
  it('rejects unauthenticated tools/call, allows pre-auth + passthrough', async () => {
    const auth = httpAuth();
    const adapter = new HttpTransportAdapter(0, '127.0.0.1');
    (adapter as unknown as { serverCtx: ServerContext }).serverCtx = createMockServerContext({ authManager: auth });

    const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'tasks_list' } };
    const denied = adapter.authorizeHttpCall(fakeReq() as never, call);
    expect(denied?.status).toBe(401);

    const preAuth = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'mcp.authenticate' } };
    expect(adapter.authorizeHttpCall(fakeReq() as never, preAuth)).toBeUndefined();

    expect(
      adapter.authorizeHttpCall(fakeReq() as never, { jsonrpc: '2.0', id: 3, method: 'initialize' }),
    ).toBeUndefined();

    await auth.authenticate('sess-1', 'valid-token');
    const authed = adapter.authorizeHttpCall(
      fakeReq({ 'mcp-session-id': 'sess-1' }) as never,
      call,
    );
    expect(authed).toBeUndefined();
  });

  it('fail-closed without AuthManager', () => {
    const adapter = new HttpTransportAdapter(0, '127.0.0.1');
    (adapter as unknown as { serverCtx: ServerContext }).serverCtx = createMockServerContext();
    const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'tasks_list' } };
    expect(adapter.authorizeHttpCall(fakeReq() as never, call)?.status).toBe(401);
  });
});

// ─── TcpTransportAdapter.authorizeToolCall ────────────────────────────

describe('TcpTransportAdapter — transport-level gate', () => {
  const apps: TcpTransportAdapter[] = [];
  afterEach(async () => {
    await Promise.all(apps.map((a) => a.close().catch(() => {})));
    apps.length = 0;
  });

  it('rejects unauthenticated, passes authenticated + pre-auth', async () => {
    const auth = new AuthManager({ transport: 'tcp', tokenValidator: createStaticValidator(TOKENS) });
    const adapter = new TcpTransportAdapter(0, '127.0.0.1');
    await adapter.connect(createMockServerContext({ authManager: auth }));
    apps.push(adapter);

    expect(adapter.authorizeToolCall({ toolName: 'tasks_list', sessionId: 'c-1' }).allowed).toBe(false);
    expect(adapter.authorizeToolCall({ toolName: 'mcp.authenticate', sessionId: 'c-1' })).toEqual({ allowed: true });

    await auth.authenticate('c-1', 'valid-token');
    expect(adapter.authorizeToolCall({ toolName: 'tasks_list', sessionId: 'c-1' })).toEqual({ allowed: true });
  });

  it('fail-closed without AuthManager', async () => {
    const adapter = new TcpTransportAdapter(0, '127.0.0.1');
    await adapter.connect(createMockServerContext());
    apps.push(adapter);
    const d = adapter.authorizeToolCall({ toolName: 'tasks_list', sessionId: 'c-1' });
    expect(d.allowed).toBe(false);
  });
});

// ─── mcp.authenticate tool ────────────────────────────────────────────

describe('mcp.authenticate tool', () => {
  it('authenticates with a valid token and rejects bad ones', async () => {
    const auth = httpAuth();
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const ctx = createMockServerContext({ authManager: auth });
    (ctx as { server: McpServer }).server = server;
    registerAuthTools(ctx);

    const tools = (server as unknown as { _registeredTools: Record<string, { callback: (a: unknown, e: unknown) => Promise<unknown> }> })._registeredTools;
    expect(tools['mcp.authenticate']).toBeDefined();

    const okRes = (await tools['mcp.authenticate'].callback({ token: 'valid-token' }, { sessionId: 's-1' })) as {
      content: Array<{ text: string }>;
    };
    expect(JSON.parse(okRes.content[0].text)).toMatchObject({ ok: true, data: { authenticated: true, userId: 'user-1' } });
    expect(auth.isAuthenticated('s-1')).toBe(true);

    const badRes = (await tools['mcp.authenticate'].callback({ token: 'wrong' }, { sessionId: 's-2' })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(badRes.isError).toBe(true);
    expect(auth.isAuthenticated('s-2')).toBe(false);
  });

  it('fails closed when no AuthManager is installed', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerAuthTools(createMockServerContext({ server } as Partial<ServerContext>));
    const tools = (server as unknown as { _registeredTools: Record<string, { callback: (a: unknown, e: unknown) => Promise<unknown> }> })._registeredTools;
    const res = (await tools['mcp.authenticate'].callback({ token: 'x' }, {})) as {
      isError?: boolean;
    };
    expect(res.isError).toBe(true);
  });

  it('falls back to local session without SDK session id', () => {
    expect(resolveGateSessionId(undefined)).toBe('local');
    expect(resolveGateSessionId('abc')).toBe('abc');
  });
});

// ─── AppContainer wiring ──────────────────────────────────────────────

describe('AppContainer — SEC-003 wiring', () => {
  const containers: AppContainer[] = [];
  afterEach(async () => {
    await Promise.all(containers.map((a) => a.stop().catch(() => {})));
    containers.length = 0;
  });

  it('creates a fail-closed AuthManager for http', async () => {
    const app = new AppContainer({
      transportType: 'http',
      sessionManager: false,
      cluster: false,
      handleSignals: false,
    });
    containers.push(app);
    await app.init();

    const auth = app.getAuthManager();
    expect(auth.isAuthRequired()).toBe(true);
    expect(app.getContext().authManager).toBe(auth);
    expect(app.getContext().transportType).toBe('http');
    expect(app.getContext().toolNames.has('mcp.authenticate')).toBe(true);
  });

  it('leaves stdio open (requireAuth false)', async () => {
    const app = new AppContainer({
      transportType: 'stdio',
      sessionManager: false,
      cluster: false,
      handleSignals: false,
    });
    containers.push(app);
    await app.init();
    expect(app.getAuthManager().isAuthRequired()).toBe(false);
  });
});

// ─── Live HTTP end-to-end ─────────────────────────────────────────────

describe('live HTTP — deny, authenticate, allow', () => {
  it('full cycle over real Streamable HTTP', async () => {
    const ctx = await createServerContext();
    ctx.transportType = 'http';
    const tm = new TokenManager({ cleanupIntervalMs: 0 });
    const auth = new AuthManager({ transport: 'http', tokenValidator: tm.createValidator() });
    ctx.authManager = auth;
    registerAuthTools(ctx);
    ctx.server.registerTool(
      'sec003_probe',
      { title: 'Probe', description: 'SEC-003 probe tool', inputSchema: {} },
      async () => ({ content: [{ type: 'text' as const, text: 'probe-ok' }] }),
    );

    const adapter = new HttpTransportAdapter(0, '127.0.0.1');
    await adapter.connect(ctx);
    const srv = (adapter as unknown as { httpServer: { address: () => { port: number } | null; listening: boolean } }).httpServer;
    await vi.waitFor(() => {
      if (!srv.listening) throw new Error('http not listening yet');
    });
    const port = srv.address()?.port ?? 0;
    expect(port).toBeGreaterThan(0);

    const client = new Client({ name: 'sec003-e2e', version: '0.0.0' });
    const ct = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
    await client.connect(ct);
    try {
      let denied = false;
      try {
        const res = await client.callTool({ name: 'sec003_probe', arguments: {} });
        denied = res.isError === true;
      } catch {
        denied = true;
      }
      expect(denied).toBe(true);

      const pair = tm.issue('user-1', ['admin']);
      const authRes = await client.callTool({ name: 'mcp.authenticate', arguments: { token: pair.accessToken } });
      expect(authRes.isError).toBeFalsy();

      const probe = await client.callTool({ name: 'sec003_probe', arguments: {} });
      expect(probe.isError).toBeFalsy();
    } finally {
      await client.close().catch(() => {});
      await adapter.close().catch(() => {});
      tm.close();
    }
  }, 30000);
});
