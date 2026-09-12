/**
 * SPEC-01: notifications/cancelled must abort in-flight requests.
 *
 * Before the fix, transports fabricated `new AbortController().signal` that
 * was never triggered — a client cancel could not interrupt running work.
 * These tests drive a real TCP session end-to-end: initialize → tools/call
 * (handler parks on the signal) → notifications/cancelled → signal fires.
 */

import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { TcpTransportAdapter } from '../src/transport/stream-transport.js';
import type { ServerContext } from '../src/register/context.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AuthManager, createStaticValidator } from '../src/core/auth.js';

const TOKENS = { 'valid-token': { userId: 'user-1', roles: ['admin'] } };

function tcpAuth(): AuthManager {
  return new AuthManager({ transport: 'tcp', tokenValidator: createStaticValidator(TOKENS) });
}

function createMockContext(authManager?: AuthManager): ServerContext {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  return {
    server,
    authManager,
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
    catalogProvider: {} as never,
    vectorAdapter: undefined,
    vectorInitAttempted: false,
    ensureVectorAdapter: async () => undefined,
    toolRegistry: {
      get: () => undefined,
      has: () => false,
      set: () => {},
      all: () => [],
      size: 0,
    } as never,
    resourceRegistry: [],
    toolNames: new Set(),
    STRICT_TOOL_DEDUP: false,
    TOOLS_ENABLED: true,
    TOOL_RES_ENABLED: false,
    TOOL_RES_EXEC: false,
    REPO_ROOT: '/tmp',
    SERVER_CAPS: { resources: { list: true, read: true }, tools: { call: true } },
    normalizeBase64: (s) => s,
    makeResourceTemplate: () => ({}) as never,
    registerToolAsResource: () => {},
  };
}

function frame(msg: unknown): string {
  return JSON.stringify(msg) + '\n';
}

/** Collect newline-delimited JSON-RPC messages from a socket. */
function makeReader(socket: net.Socket) {
  let buf = '';
  const queue: Record<string, unknown>[] = [];
  const waiters: { pred: (m: Record<string, unknown>) => boolean; resolve: (m: Record<string, unknown>) => void }[] = [];
  socket.on('data', (d) => {
    buf += d.toString();
    for (;;) {
      const idx = buf.indexOf('\n');
      if (idx === -1) break;
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const wi = waiters.findIndex((w) => w.pred(parsed));
      if (wi >= 0) waiters.splice(wi, 1)[0].resolve(parsed);
      else queue.push(parsed);
    }
  });
  return {
    next(pred: (m: Record<string, unknown>) => boolean, timeoutMs = 5000): Promise<Record<string, unknown>> {
      const idx = queue.findIndex(pred);
      if (idx >= 0) return Promise.resolve(queue.splice(idx, 1)[0]);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('message timeout')), timeoutMs);
        waiters.push({
          pred,
          resolve: (m) => {
            clearTimeout(t);
            resolve(m);
          },
        });
      });
    },
  };
}

const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.0.0' },
  },
};

const INITIALIZED = { jsonrpc: '2.0', method: 'notifications/initialized' };

describe('SPEC-01 cancel propagation (tcp)', () => {
  it('notifications/cancelled aborts the in-flight request signal', async () => {
    const auth = tcpAuth();
    const ctx = createMockContext(auth);

    // Register a tools/call handler on the MAIN server that parks until its
    // signal aborts — this is what a long-running tool would do.
    let sawAbort = false;
    let abortReason: unknown;
    const mainBase = (ctx.server as unknown as Record<string, never>).server as {
      _requestHandlers: Map<string, (req: unknown, extra: { signal: AbortSignal }) => Promise<unknown>>;
      _requestHandlerAbortControllers?: Map<unknown, AbortController>;
    };
    mainBase._requestHandlers.set('tools/call', async (_req, extra) => {
      await new Promise<void>((resolve) => {
        if (extra.signal.aborted) return resolve();
        extra.signal.addEventListener('abort', () => {
          sawAbort = true;
          abortReason = extra.signal.reason;
          resolve();
        });
      });
      return { content: [{ type: 'text', text: 'finished-after-abort' }] };
    });

    const port = 13499;
    const adapter = new TcpTransportAdapter(port, '127.0.0.1');
    await adapter.connect(ctx);

    const socket = net.createConnection({ port, host: '127.0.0.1' });
    await new Promise((r) => socket.once('connect', r));
    const reader = makeReader(socket);

    socket.write(frame(INIT));
    await reader.next((m) => m.id === 1);
    socket.write(frame(INITIALIZED));

    // Authenticate the session so the SEC-003 gate lets tools/call through.
    const sessionId = adapter.getSessionInfo()[0].id;
    await auth.authenticate(sessionId, 'valid-token');

    // Fire a tools/call that will park on the signal.
    socket.write(
      frame({
        jsonrpc: '2.0',
        id: 42,
        method: 'tools/call',
        params: { name: 'any.tool', arguments: {} },
      }),
    );

    // Give the server a beat to dispatch, then cancel request 42.
    await new Promise((r) => setTimeout(r, 150));
    socket.write(
      frame({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 42, reason: 'client-cancelled' },
      }),
    );

    const resp = await reader.next((m) => m.id === 42);
    expect(sawAbort).toBe(true);
    expect(abortReason).toBe('client-cancelled');
    expect(resp.result).toBeDefined();

    socket.destroy();
    await adapter.close();
  });

  it('cancel for unknown requestId is a no-op (no crash)', async () => {
    const ctx = createMockContext();
    const port = 13498;
    const adapter = new TcpTransportAdapter(port, '127.0.0.1');
    await adapter.connect(ctx);

    const socket = net.createConnection({ port, host: '127.0.0.1' });
    await new Promise((r) => socket.once('connect', r));
    const reader = makeReader(socket);

    socket.write(frame(INIT));
    await reader.next((m) => m.id === 1);
    socket.write(frame(INITIALIZED));

    socket.write(
      frame({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 999 },
      }),
    );

    // Session still alive: ping through SDK path.
    socket.write(frame({ jsonrpc: '2.0', id: 7, method: 'ping' }));
    const pong = await reader.next((m) => m.id === 7);
    expect(pong.result).toBeDefined();

    socket.destroy();
    await adapter.close();
  });
});
