/**
 * realtime.spec.ts — Tests for WebSocket realtime server (MR-012 + UI-005).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RealtimeServer, getRealtimeServer, resetRealtimeServer, type RealtimeEvent } from '../src/transport/realtime.js';
import { WebSocket } from 'ws';
import { createServer } from 'node:http';

describe('RealtimeServer', () => {
  let server: RealtimeServer;
  let httpServer: ReturnType<typeof createServer>;
  let port: number;

  beforeEach(async () => {
    resetRealtimeServer();
    server = new RealtimeServer({ heartbeatMs: 60000 });
    httpServer = createServer();
    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
    server.attach(httpServer, '/ws');
  });

  afterEach(() => {
    server.close();
    return new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it('creates a server instance', () => {
    expect(server).toBeInstanceOf(RealtimeServer);
  });

  it('starts with no connected clients', () => {
    expect(server.getConnectedClients()).toHaveLength(0);
  });

  it('accepts WebSocket connections', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });

    await vi.waitFor(() => {
      expect(server.getConnectedClients()).toHaveLength(1);
    }, { timeout: 2000 });

    ws.close();
  });

  it('sends connected message on join', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const connected = await new Promise<unknown>((resolve, reject) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'connected') resolve(msg);
      });
      ws.on('error', reject);
    });

    expect(connected).toHaveProperty('type', 'connected');
    expect(connected).toHaveProperty('clientId');
    ws.close();
  });

  it('broadcasts events to connected clients', async () => {
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    await Promise.all([
      new Promise<void>((r) => ws1.on('open', () => r())),
      new Promise<void>((r) => ws2.on('open', () => r())),
    ]);

    await vi.waitFor(() => {
      expect(server.getConnectedClients()).toHaveLength(2);
    }, { timeout: 2000 });

    const event: RealtimeEvent = {
      type: 'task.created',
      data: { id: 'task-1', title: 'Test Task' },
      timestamp: new Date().toISOString(),
      clientId: 'test',
    };

    const received: unknown[] = [];
    const waitPromise = new Promise<void>((resolve) => {
      ws2.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'task.created') {
          received.push(msg);
          resolve();
        }
      });
    });

    server.broadcast(event);

    await vi.waitFor(() => {
      expect(received.length).toBeGreaterThan(0);
    }, { timeout: 2000 });

    expect(received[0]).toHaveProperty('type', 'task.created');
    expect(received[0]).toHaveProperty('data.id', 'task-1');

    ws1.close();
    ws2.close();
  });

  it('handles heartbeat messages', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    await new Promise<void>((r) => ws.on('open', () => r()));

    ws.send(JSON.stringify({ type: 'heartbeat' }));

    const ack = await new Promise<unknown>((resolve) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'heartbeat_ack') resolve(msg);
      });
    });

    expect(ack).toHaveProperty('type', 'heartbeat_ack');
    ws.close();
  });

  it('removes clients on disconnect', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    await new Promise<void>((r) => ws.on('open', () => r()));

    await vi.waitFor(() => {
      expect(server.getConnectedClients()).toHaveLength(1);
    }, { timeout: 2000 });

    ws.close();

    await vi.waitFor(() => {
      expect(server.getConnectedClients()).toHaveLength(0);
    }, { timeout: 2000 });
  });

  it('filters broadcast by project', async () => {
    const wsProjectA = new WebSocket(`ws://127.0.0.1:${port}/ws?project=alpha`);
    const wsProjectB = new WebSocket(`ws://127.0.0.1:${port}/ws?project=beta`);

    await Promise.all([
      new Promise<void>((r) => wsProjectA.on('open', () => r())),
      new Promise<void>((r) => wsProjectB.on('open', () => r())),
    ]);

    await vi.waitFor(() => {
      expect(server.getConnectedClients()).toHaveLength(2);
    }, { timeout: 2000 });

    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];

    wsProjectA.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'task.created') receivedA.push(msg);
    });
    wsProjectB.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'task.created') receivedB.push(msg);
    });

    server.broadcast({
      type: 'task.created',
      project: 'alpha',
      data: { id: '1' },
      timestamp: new Date().toISOString(),
      clientId: 'test',
    });

    await vi.waitFor(() => {
      expect(receivedA.length).toBe(1);
    }, { timeout: 2000 });

    expect(receivedB.length).toBe(0);

    wsProjectA.close();
    wsProjectB.close();
  });

  it('getPresence returns connected clients', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?project=test&userId=alice`);

    await new Promise<void>((r) => ws.on('open', () => r()));

    await vi.waitFor(() => {
      expect(server.getPresence('test')).toHaveLength(1);
    }, { timeout: 2000 });

    const presence = server.getPresence('test');
    expect(presence[0].userId).toBe('alice');

    ws.close();
  });

  it('emits client:join event', async () => {
    const joinPromise = new Promise<void>((resolve) => {
      server.once('client:join', () => resolve());
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => ws.on('open', () => r()));

    await vi.waitFor(() => joinPromise, { timeout: 2000 });

    ws.close();
  });

  it('handles subscribe message to change project', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    await new Promise<void>((r) => ws.on('open', () => r()));

    ws.send(JSON.stringify({ type: 'subscribe', project: 'new-project' }));

    await vi.waitFor(() => {
      const clients = server.getConnectedClients();
      expect(clients[0]?.project).toBe('new-project');
    }, { timeout: 2000 });

    ws.close();
  });

  it('broadcasts presence.join on new connection', async () => {
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => ws1.on('open', () => r()));

    const joinPromise = new Promise<unknown>((resolve) => {
      ws1.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'presence.join') resolve(msg);
      });
    });

    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => ws2.on('open', () => r()));

    const joinMsg = await vi.waitFor(() => joinPromise, { timeout: 2000 });
    expect(joinMsg).toHaveProperty('type', 'presence.join');

    ws1.close();
    ws2.close();
  });

  it('close() cleans up all clients', async () => {
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    await Promise.all([
      new Promise<void>((r) => ws1.on('open', () => r())),
      new Promise<void>((r) => ws2.on('open', () => r())),
    ]);

    await vi.waitFor(() => {
      expect(server.getConnectedClients()).toHaveLength(2);
    }, { timeout: 2000 });

    server.close();

    expect(server.getConnectedClients()).toHaveLength(0);
  });
});

describe('getRealtimeServer', () => {
  afterEach(() => {
    resetRealtimeServer();
  });

  it('returns singleton', () => {
    const a = getRealtimeServer();
    const b = getRealtimeServer();
    expect(a).toBe(b);
  });

  it('reset creates new instance', () => {
    const a = getRealtimeServer();
    resetRealtimeServer();
    const b = getRealtimeServer();
    expect(a).not.toBe(b);
  });
});
