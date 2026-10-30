/**
 * realtime-auth.test.ts — AUD-06 / UI-22: WS handshake auth via one-time ticket.
 *
 * The JWT is never accepted in the WebSocket URL. A ticket is issued by
 * POST /auth/ws-ticket (tested in tests/ws-ticket.test.ts) and redeemed once
 * at the upgrade; these tests cover the RealtimeServer side: no ticket,
 * invalid ticket, legacy ?token=, single-use and identity binding.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RealtimeServer, type RealtimeEvent } from '../src/transport/realtime.js';
import { WsTicketStore } from '../src/core/ws-ticket.js';
import { WebSocket } from 'ws';
import { createServer } from 'node:http';

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

describe('RealtimeServer AUD-06/UI-22 ticket auth', () => {
  let server: RealtimeServer;
  let httpServer: ReturnType<typeof createServer>;
  let port: number;
  let store: WsTicketStore;

  const issue = (userId = 'u1'): string => store.issue({ userId, jti: `jti-${userId}` }).ticket;
  const connectAuthed = (userId = 'u1'): WebSocket => connect(port, `?ticket=${encodeURIComponent(issue(userId))}`);

  beforeEach(async () => {
    server = new RealtimeServer({ heartbeatMs: 60000 });
    store = new WsTicketStore();
    httpServer = createServer();
    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
    server.attach(httpServer, '/ws', { ticketStore: store });
  });

  afterEach(() => {
    server.close();
    return new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it('rejects a connection without a ticket (4001)', async () => {
    const ws = connect(port);
    const { code } = await waitClose(ws);
    expect(code).toBe(4001);
    expect(server.getConnectedClients()).toHaveLength(0);
  });

  it('rejects an unknown ticket (4001)', async () => {
    const ws = connect(port, '?ticket=not-a-real-ticket');
    const { code, reason } = await waitClose(ws);
    expect(code).toBe(4001);
    expect(reason).toBe('unauthorized');
  });

  it('rejects the legacy ?token= form even with a valid-looking value (4001)', async () => {
    const ws = connect(port, '?token=jwt-looking-value');
    expect((await waitClose(ws)).code).toBe(4001);
  });

  it('accepts a valid ticket and sends connected', async () => {
    const ws = connectAuthed('alice');
    const msg = await waitConnected(ws);
    expect(msg).toHaveProperty('clientId');
    ws.close();
  });

  it('burns the ticket on first use (second connection rejected)', async () => {
    const ticket = issue('u1');
    const first = connect(port, `?ticket=${encodeURIComponent(ticket)}`);
    await waitConnected(first);

    const second = connect(port, `?ticket=${encodeURIComponent(ticket)}`);
    expect((await waitClose(second)).code).toBe(4001);
    first.close();
  });

  it('binds the connection to the ticket subject, not a client query param', async () => {
    const ticket = issue('alice');
    const ws = connect(port, `?ticket=${encodeURIComponent(ticket)}&userId=mallory`);
    await waitConnected(ws);
    const client = server.getConnectedClients().find((c) => c.userId === 'alice');
    expect(client, 'identity comes from the ticket').toBeTruthy();
    ws.close();
  });

  it('broadcast from client with disallowed eventType → error, no broadcast', async () => {
    const ws1 = connectAuthed();
    const ws2 = connectAuthed();
    await Promise.all([waitOpen(ws1), waitOpen(ws2)]);

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
    const ws1 = connectAuthed();
    const ws2 = connectAuthed();
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
    const ws1 = connectAuthed();
    const ws2 = connectAuthed();
    await Promise.all([waitOpen(ws1), waitOpen(ws2)]);

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

  it('no ticket store configured → open access (backwards compat)', async () => {
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
