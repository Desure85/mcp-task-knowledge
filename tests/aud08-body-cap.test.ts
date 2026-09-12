/**
 * AUD-08: HTTP transport DoS hardening.
 *
 * 1. POST body cap — Content-Length fast-reject + streaming byte counter
 *    (env MCP_MAX_BODY_BYTES, default 10 MiB). Over-cap → 413, stream
 *    destroyed, no further buffering.
 * 2. Session cap bypass — when SessionManager.create() rejects (maxSessions),
 *    the freshly-created SDK transport must be closed and removed from the
 *    sessions map instead of leaking a live transport.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { request as httpRequest, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpTransportAdapter } from '../src/transport/http-transport.js';
import { SessionManager } from '../src/core/session-manager.js';
import { createMockServerContext } from './helpers.js';
import type { ServerContext } from '../src/register/context.js';

const PREV_ENV = process.env.MCP_MAX_BODY_BYTES;

function portOf(adapter: HttpTransportAdapter): number {
  const srv = (adapter as unknown as { httpServer?: HttpServer }).httpServer;
  if (!srv) throw new Error('httpServer not started');
  return (srv.address() as AddressInfo).port;
}

function postJson(
  port: number,
  body: string | Buffer,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const INIT_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'aud08-test', version: '0.0.0' },
  },
});

describe('AUD-08: POST body cap', () => {
  let adapter: HttpTransportAdapter;
  let ctx: ServerContext;

  beforeEach(() => {
    process.env.MCP_MAX_BODY_BYTES = '1024'; // 1 KiB for tests
  });

  afterEach(async () => {
    await adapter?.close().catch(() => undefined);
    if (PREV_ENV === undefined) delete process.env.MCP_MAX_BODY_BYTES;
    else process.env.MCP_MAX_BODY_BYTES = PREV_ENV;
  });

  it('rejects over-cap body via Content-Length with 413', async () => {
    adapter = new HttpTransportAdapter(0, '127.0.0.1');
    ctx = createMockServerContext();
    await adapter.connect(ctx);
    await new Promise((r) => setTimeout(r, 50));
    const port = portOf(adapter);

    const bigBody = Buffer.alloc(2048, 'x'); // declared + actual > 1024
    const res = await postJson(port, bigBody, { 'content-length': String(bigBody.length) });
    expect(res.status).toBe(413);
    const parsed = JSON.parse(res.body) as { error?: { code: number; message: string } };
    expect(parsed.error?.message).toContain('Payload Too Large');
  });

  it('rejects over-cap body when Content-Length lies (chunked streaming)', async () => {
    adapter = new HttpTransportAdapter(0, '127.0.0.1');
    ctx = createMockServerContext();
    await adapter.connect(ctx);
    await new Promise((r) => setTimeout(r, 50));
    const port = portOf(adapter);

    // No content-length header → chunked; stream 2 KiB > 1 KiB cap.
    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'transfer-encoding': 'chunked',
          },
        },
        (r) => {
          const chunks: Buffer[] = [];
          r.on('data', (c) => chunks.push(c as Buffer));
          r.on('end', () => resolve({ status: r.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }));
        },
      );
      req.on('error', reject);
      req.write(Buffer.alloc(1500, 'a'));
      req.write(Buffer.alloc(1000, 'b'));
      req.end();
    });
    expect(res.status).toBe(413);
  });

  it('accepts a normal body under the cap', async () => {
    process.env.MCP_MAX_BODY_BYTES = String(1024 * 1024);
    adapter = new HttpTransportAdapter(0, '127.0.0.1');
    ctx = createMockServerContext();
    await adapter.connect(ctx);
    await new Promise((r) => setTimeout(r, 50));
    const port = portOf(adapter);

    const res = await postJson(port, INIT_BODY);
    // initialize without auth configured → should succeed (200) or at least
    // not be a 413 — the body was read and dispatched.
    expect(res.status).not.toBe(413);
    expect([200, 400, 401]).toContain(res.status);
  });
});

describe('AUD-08: session cap bypass', () => {
  let adapter: HttpTransportAdapter;

  afterEach(async () => {
    await adapter?.close().catch(() => undefined);
  });

  it('sm.create() rejection closes the transport and removes it from sessions', async () => {
    const sm = new SessionManager({ maxSessions: 1 });
    // Occupy the single slot so the next create() throws.
    sm.create({ id: 'taken', remote: 'test' });

    adapter = new HttpTransportAdapter(0, '127.0.0.1');
    const ctx = createMockServerContext({ sessionManager: sm });
    await adapter.connect(ctx);
    await new Promise((r) => setTimeout(r, 50));
    const port = portOf(adapter);

    const res = await postJson(port, INIT_BODY);
    // SDK answers the initialize POST with a JSON-RPC error (400) because
    // onsessioninitialized rethrew the sm.create() rejection.
    expect(res.status).toBe(400);

    const sessions = (adapter as unknown as { sessions: Map<string, unknown> }).sessions;
    expect(sessions.size).toBe(0);

    sm.close();
  });

  it('sessions map stays empty across repeated rejected initializes', async () => {
    const sm = new SessionManager({ maxSessions: 1 });
    sm.create({ id: 'taken', remote: 'test' });

    adapter = new HttpTransportAdapter(0, '127.0.0.1');
    const ctx = createMockServerContext({ sessionManager: sm });
    await adapter.connect(ctx);
    await new Promise((r) => setTimeout(r, 50));
    const port = portOf(adapter);

    for (let i = 0; i < 3; i++) {
      const res = await postJson(port, INIT_BODY);
      expect(res.status).toBe(400);
    }
    const sessions = (adapter as unknown as { sessions: Map<string, unknown> }).sessions;
    expect(sessions.size).toBe(0);

    sm.close();
  });
});
