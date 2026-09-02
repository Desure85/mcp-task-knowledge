/**
 * realtime.ts — WebSocket server for realtime collaboration (MR-012 + UI-005).
 *
 * Broadcasts task/knowledge/session changes to connected clients.
 * Presence indicators, optimistic UI updates, live notifications.
 */

/// <reference types="node" />
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

export interface RealtimeEvent {
  type: 'task.created' | 'task.updated' | 'task.closed' | 'task.deleted'
      | 'knowledge.created' | 'knowledge.updated' | 'knowledge.deleted'
      | 'session.opened' | 'session.closed'
      | 'presence.join' | 'presence.leave' | 'presence.heartbeat'
      | 'memory.fact_added' | 'memory.fact_invalidated';
  project?: string;
  data: Record<string, unknown>;
  timestamp: string;
  clientId: string;
}

export interface ClientInfo {
  id: string;
  ws: WebSocket;
  project?: string;
  userId?: string;
  joinedAt: string;
  lastHeartbeat: string;
}

export class RealtimeServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, ClientInfo>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatMs: number;

  constructor(opts?: { heartbeatMs?: number }) {
    super();
    this.heartbeatMs = opts?.heartbeatMs ?? 30_000;
  }

  attach(server: Server, path = '/ws'): void {
    this.wss = new WebSocketServer({ server, path });

    this.wss.on('connection', (ws, req) => {
      const clientId = `client_${createHash('sha256').update(Date.now() + Math.random().toString()).digest('hex').substring(0, 12)}`;
      const url = new URL(req.url ?? '', 'http://localhost');
      const project = url.searchParams.get('project') ?? undefined;
      const userId = url.searchParams.get('userId') ?? undefined;

      const info: ClientInfo = {
        id: clientId,
        ws,
        project,
        userId,
        joinedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
      };

      this.clients.set(clientId, info);
      this.emit('client:join', info);

      this.broadcast({
        type: 'presence.join',
        project,
        data: { clientId, userId },
        timestamp: new Date().toISOString(),
        clientId,
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          info.lastHeartbeat = new Date().toISOString();

          if (msg.type === 'heartbeat') {
            ws.send(JSON.stringify({ type: 'heartbeat_ack', timestamp: new Date().toISOString() }));
            return;
          }

          if (msg.type === 'subscribe' && msg.project) {
            info.project = msg.project;
            return;
          }

          if (msg.type === 'broadcast') {
            this.broadcast({
              type: msg.eventType ?? 'task.updated',
              project: msg.project ?? info.project,
              data: msg.data ?? {},
              timestamp: new Date().toISOString(),
              clientId,
            });
          }
        } catch {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        this.emit('client:leave', info);
        this.broadcast({
          type: 'presence.leave',
          project: info.project,
          data: { clientId: info.id, userId: info.userId },
          timestamp: new Date().toISOString(),
          clientId,
        });
      });

      ws.send(JSON.stringify({
        type: 'connected',
        clientId,
        timestamp: new Date().toISOString(),
      }));
    });

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, info] of this.clients) {
        const elapsed = now - new Date(info.lastHeartbeat).getTime();
        if (elapsed > this.heartbeatMs * 3) {
          info.ws.terminate();
          this.clients.delete(id);
          this.emit('client:timeout', info);
        } else {
          info.ws.ping();
        }
      }
    }, this.heartbeatMs);
  }

  broadcast(event: RealtimeEvent): void {
    const msg = JSON.stringify(event);
    for (const [, info] of this.clients) {
      if (event.project && info.project && info.project !== event.project) continue;
      if (info.ws.readyState === WebSocket.OPEN) {
        info.ws.send(msg);
      }
    }
    this.emit('event', event);
  }

  getConnectedClients(): Array<{ id: string; project?: string; userId?: string; joinedAt: string }> {
    return Array.from(this.clients.values()).map((c) => ({
      id: c.id,
      project: c.project,
      userId: c.userId,
      joinedAt: c.joinedAt,
    }));
  }

  getPresence(project?: string): Array<{ clientId: string; userId?: string }> {
    return Array.from(this.clients.values())
      .filter((c) => !project || c.project === project)
      .map((c) => ({ clientId: c.id, userId: c.userId }));
  }

  close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const [, info] of this.clients) {
      info.ws.terminate();
    }
    this.clients.clear();
    this.wss?.close();
    this.wss = null;
  }
}

let singleton: RealtimeServer | null = null;

export function getRealtimeServer(): RealtimeServer {
  if (!singleton) {
    singleton = new RealtimeServer();
  }
  return singleton;
}

export function resetRealtimeServer(): void {
  singleton?.close();
  singleton = null;
}
