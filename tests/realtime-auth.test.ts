/**
 * realtime-auth.test.ts — AUD-06: WS handshake auth + broadcast gating.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RealtimeServer, type RealtimeEvent } from '../src/transport/realtime.js';
import { WebSocket } from 'ws';
import { createServer } from 'node:http';

const VALID_TOKEN = 'good-token';

function connect(port: number, query = ''): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}/ws${query}`);
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
}

function waitConnected(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      if (msg.type === 'connected') resolve(msg);
    });
    ws.on('error', reject);
  });
}

function waitClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

function nextMessage(ws: WebSocket, pred: (m: Record<string, unknown>) => boolean, timeoutMs = 2000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for message')), timeoutMs);
    const handler = (raw: unknown): void => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      if (pred(msg)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

describe('RealtimeServer AUD-06 auth', () => {
  let server: RealtimeServer;
  let httpServer: ReturnType<typeof createServer>;
  let port: number;

  beforeEach(async () => {
    server = new RealtimeServer({ heartbeatMs: 60000 });
    httpServer = createServer();
    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
    server.attach(httpServer, '/ws', {
      tokenValidator: (token) => token === VALID_TOKEN,
    });
  });

  afterEach(() => {
    server.close();
    return new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it('rejects unauthenticated WS (no token) with close 4001', async () => {
    const ws = connect(port);
    const { code } = await waitClose(ws);
    expect(code).toBe(4001);
    expect(server.getConnectedClients()).toHaveLength(0);
  });

  it('rejects invalid token with close 4001', async () => {
    const ws = connect(port, '?token=wrong');
    const { code, reason } = await waitClose(ws);
    expect(code).toBe(4001);
    expect(reason).toBe('unauthorized');
  });

  it('accepts valid token and sends connected', async () => {
    const ws = connect(port, `?token=${VALID_TOKEN}`);
    const msg = await waitConnected(ws);
    expect(msg).toHaveProperty('clientId');
    ws.close();
  });

  it('supports async tokenValidator', async () => {
    server.close();
    httpServer.close();
    httpServer = createServer();
    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
    server = new RealtimeServer({ heartbeatMs: 60000 });
    server.attach(httpServer, '/ws', {
      tokenValidator: async (token) => token === VALID_TOKEN,
    });

    const bad = connect(port, '?token=nope');
    expect((await waitClose(bad)).code).toBe(4001);

    const good = connect(port, `?token=${VALID_TOKEN}`);
    await waitOpen(good);
    good.close();
  });

  it('broadcast from client with disallowed eventType → error, no broadcast', async () => {
    const ws1 = connect(port, `?token=${VALID_TOKEN}`);
    const ws2 = connect(port, `?token=${VALID_TOKEN}`);
    await Promise.all([waitOpen(ws1), waitOpen(ws2)]);

    // subscribe both so they would receive broadcasts
    ws1.send(JSON.stringify({ type: 'subscribe' }));
    ws2.send(JSON.stringify({ type: 'subscribe' }));
    await new Promise((r) => setTimeout(r, 100));

    const errPromise = nextMessage(ws1, (m) => m.type === 'error');
    let ws2Got = false;
    ws2.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === 'session.opened') ws2Got = true;
    });

    ws1.send(JSON.stringify({ type: 'broadcast', eventType: 'session.opened', data: {} }));

    const err = await errPromise;
    expect(err.message).toBe('unknown eventType');
    await new Promise((r) => setTimeout(r, 200));
    expect(ws2Got).toBe(false);

    ws1.close();
    ws2.close();
  });

  it('broadcast from client with allowed eventType → received by subscribed peer', async () => {
    const ws1 = connect(port, `?token=${VALID_TOKEN}`);
    const ws2 = connect(port, `?token=${VALID_TOKEN}`);
    await Promise.all([waitOpen(ws1), waitOpen(ws2)]);

    ws1.send(JSON.stringify({ type: 'subscribe' }));
    ws2.send(JSON.stringify({ type: 'subscribe' }));
    await new Promise((r) => setTimeout(r, 100));

    const gotPromise = nextMessage(ws2, (m) => m.type === 'task.updated');
    ws1.send(JSON.stringify({ type: 'broadcast', eventType: 'task.updated', data: { id: 't1' } }));

    const got = await gotPromise;
    expect(got).toHaveProperty('type', 'task.updated');
    expect((got.data as Record<string, unknown>).id).toBe('t1');

    ws1.close();
    ws2.close();
  });

  it('client without subscribe receives no events', async () => {
    const ws1 = connect(port, `?token=${VALID_TOKEN}`);
    const ws2 = connect(port, `?token=${VALID_TOKEN}`);
    await Promise.all([waitOpen(ws1), waitOpen(ws2)]);

    // only ws1 subscribes
    ws1.send(JSON.stringify({ type: 'subscribe' }));
    await new Promise((r) => setTimeout(r, 100));

    let ws2Got = false;
    ws2.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === 'task.created') ws2Got = true;
    });

    const event: RealtimeEvent = {
      type: 'task.created',
      data: { id: 'x' },
      timestamp: new Date().toISOString(),
      clientId: 'srv',
    };
    server.broadcast(event);

    const ws1Got = await nextMessage(ws1, (m) => m.type === 'task.created');
    expect(ws1Got.type).toBe('task.created');

    await new Promise((r) => setTimeout(r, 200));
    expect(ws2Got).toBe(false);

    ws1.close();
    ws2.close();
  });

  it('no validator configured → open access (backwards compat)', async () => {
    server.close();
    httpServer.close();
    httpServer = createServer();
    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
    server = new RealtimeServer({ heartbeatMs: 60000 });
    server.attach(httpServer, '/ws');

    const ws = connect(port);
    const msg = await waitConnected(ws);
    expect(msg).toHaveProperty('clientId');
    ws.close();
  });
});
