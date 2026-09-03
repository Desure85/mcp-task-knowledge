/**
 * web-ui/lib/realtime.ts — Shared WebSocket realtime client (NEXT2-005)
 *
 * Client-side wiring for the RealtimeServer attached at `/ws` on the MCP
 * HTTP transport (see `src/transport/realtime.ts`, WIRE-002 wiring in
 * `src/transport/http-transport.ts`: `getRealtimeServer().attach(httpServer, '/ws')`).
 *
 * This module is CLIENT ONLY — it does not change any server code:
 * - `resolveRealtimeUrl()` — derives the WS endpoint from env / API URL.
 * - `RealtimeClient` — connect with exponential-backoff reconnect, heartbeat,
 *   project subscribe, typed event fan-out, graceful degradation when the
 *   WS endpoint is unreachable (TD-011: never throws, never crashes render).
 * - `useRealtime()` — React hook returning connection status, last event,
 *   and presence roster.
 * - `applyTaskEvent()` / `applyKnowledgeEvent()` — pure list-merge helpers
 *   used by pages for optimistic live-updates.
 * - `connectionBadgeClass()` — shared Tailwind classes for the status dot.
 *
 * NOTE (server gap, documented not fixed — out of scope for NEXT2-005):
 * the server currently broadcasts presence events itself, but task/knowledge
 * mutations made via MCP tools are NOT auto-broadcast. Live-updates flow via
 * the client `broadcast` relay: after each successful local mutation the page
 * calls `client.publish(...)` so every OTHER connected tab/client merges the
 * change instantly. A future server-side tool→realtime bridge would make
 * updates flow for MCP-tool mutations too; this client already handles those
 * event types when they arrive.
 */

'use client';

import { useEffect, useRef, useState } from 'react';

// ─── Event types (mirror of server RealtimeEvent + control frames) ──

export type RealtimeEventType =
  | 'task.created' | 'task.updated' | 'task.closed' | 'task.deleted'
  | 'knowledge.created' | 'knowledge.updated' | 'knowledge.deleted'
  | 'session.opened' | 'session.closed'
  | 'presence.join' | 'presence.leave' | 'presence.heartbeat'
  | 'memory.fact_added' | 'memory.fact_invalidated'
  | 'connected' | 'heartbeat_ack' | 'error';

export interface RealtimeEvent {
  type: RealtimeEventType;
  project?: string;
  data: Record<string, unknown>;
  timestamp?: string;
  clientId?: string;
}

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'unavailable'
  | 'closed';

export interface PresenceEntry {
  clientId: string;
  userId?: string;
}

// ─── URL resolution (pure — unit-testable) ──────────────────────────

export interface ResolveUrlOpts {
  /** Explicit override: NEXT_PUBLIC_MCP_WS_URL */
  wsUrl?: string;
  /** NEXT_PUBLIC_MCP_API_URL (absolute http(s) URL or relative path) */
  apiUrl?: string;
  /** window.location.origin equivalent (injected for tests/SSR safety) */
  locationOrigin?: string;
}

/**
 * Derive the realtime WS endpoint:
 * 1. explicit `wsUrl` wins as-is;
 * 2. absolute http(s) `apiUrl` → same origin + `/ws`;
 * 3. otherwise same-origin `/ws` (relative or missing apiUrl).
 */
export function resolveRealtimeUrl(opts: ResolveUrlOpts = {}): string {
  if (opts.wsUrl && opts.wsUrl.length > 0) return opts.wsUrl;
  const api = opts.apiUrl ?? '';
  const abs = /^https?:\/\//i.exec(api);
  if (abs) {
    try {
      const u = new URL(api);
      u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
      u.pathname = '/ws';
      u.search = '';
      u.hash = '';
      return u.toString();
    } catch {
      // fall through to same-origin default
    }
  }
  const origin = opts.locationOrigin ?? '';
  if (origin) {
    try {
      const u = new URL('/ws', origin);
      u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return u.toString();
    } catch {
      // fall through
    }
  }
  return '/ws';
}

/** Default URL for the browser: env-aware, SSR-safe. */
export function defaultRealtimeUrl(): string {
  if (typeof window === 'undefined') return '/ws';
  return resolveRealtimeUrl({
    wsUrl: process.env.NEXT_PUBLIC_MCP_WS_URL,
    apiUrl: process.env.NEXT_PUBLIC_MCP_API_URL,
    locationOrigin: window.location.origin,
  });
}

// ─── Backoff (pure helper — unit-testable) ──────────────────────────

/** Exponential backoff with cap: 1s, 2s, 4s, … capped at `maxMs`. */
export function backoffDelay(attempt: number, baseMs = 1000, maxMs = 30_000): number {
  const delay = baseMs * 2 ** Math.max(0, attempt);
  return Math.min(delay, maxMs);
}

// ─── Client ─────────────────────────────────────────────────────────

export interface RealtimeClientOpts {
  url?: string;
  project?: string;
  userId?: string;
  /** Heartbeat interval ms (default 25s, below server 30s timeout window). */
  heartbeatMs?: number;
}

type Listener = (event: RealtimeEvent) => void;
type StatusListener = (status: ConnectionStatus) => void;

export class RealtimeClient {
  private url: string;
  private project?: string;
  private userId?: string;
  private heartbeatMs: number;
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private status: ConnectionStatus = 'closed';
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private manualClose = false;
  private clientId: string | null = null;

  constructor(opts: RealtimeClientOpts = {}) {
    this.url = opts.url ?? defaultRealtimeUrl();
    this.project = opts.project;
    this.userId = opts.userId;
    this.heartbeatMs = opts.heartbeatMs ?? 25_000;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getClientId(): string | null {
    return this.clientId;
  }

  onEvent(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  onStatusChange(cb: StatusListener): () => void {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  private setStatus(next: ConnectionStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const cb of this.statusListeners) {
      try {
        cb(next);
      } catch {
        // listener errors must never break the client (TD-011)
      }
    }
  }

  /** Open the connection (idempotent). Never throws — degrades to `unavailable`. */
  connect(): void {
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') {
      this.setStatus('unavailable');
      return;
    }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.manualClose = false;
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    let ws: WebSocket;
    try {
      const url = this.buildUrl();
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus('connected');
      this.startHeartbeat();
      if (this.project) {
        this.send({ type: 'subscribe', project: this.project } as unknown as Record<string, unknown>);
      }
    };

    ws.onmessage = (ev) => {
      let msg: RealtimeEvent;
      try {
        msg = JSON.parse(String(ev.data)) as RealtimeEvent;
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'connected' && typeof (msg as unknown as { clientId?: string }).clientId === 'string') {
        this.clientId = (msg as unknown as { clientId: string }).clientId;
      }
      if (msg.type === 'heartbeat_ack') return;
      // Skip our own relayed broadcasts to avoid double-applying local mutations.
      if (msg.clientId && this.clientId && msg.clientId === this.clientId) return;
      for (const cb of this.listeners) {
        try {
          cb(msg);
        } catch {
          // listener errors must never break the client (TD-011)
        }
      }
    };

    ws.onerror = () => {
      // onclose follows — reconnect is scheduled there; keep this quiet.
      try {
        ws.close();
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      this.stopHeartbeat();
      if (this.ws === ws) this.ws = null;
      if (!this.manualClose) this.scheduleReconnect();
      else this.setStatus('closed');
    };
  }

  /** Relay an event to other connected clients via the server broadcast relay. */
  publish(eventType: RealtimeEventType, data: Record<string, unknown>, project?: string): void {
    this.send({
      type: 'broadcast',
      eventType,
      data,
      project: project ?? this.project,
    });
  }

  /** Permanently close; cancels reconnect + heartbeat timers. */
  disconnect(): void {
    this.manualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = null;
    this.setStatus('closed');
  }

  private buildUrl(): string {
    const url = new URL(this.url, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
    if (!url.searchParams.get('project') && this.project) url.searchParams.set('project', this.project);
    if (!url.searchParams.get('userId') && this.userId) url.searchParams.set('userId', this.userId);
    return url.toString();
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload));
      } catch {
        // ignore — next heartbeat/reconnect recovers
      }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'heartbeat' });
    }, this.heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.manualClose) return;
    this.setStatus('reconnecting');
    const delay = backoffDelay(this.attempt);
    this.attempt += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

// ─── Hook ───────────────────────────────────────────────────────────

export interface UseRealtimeOpts {
  project?: string;
  userId?: string;
  url?: string;
  /** If provided, only matching event types reach `onEvent`. */
  eventTypes?: RealtimeEventType[];
  onEvent?: (event: RealtimeEvent) => void;
}

export interface UseRealtimeResult {
  status: ConnectionStatus;
  lastEvent: RealtimeEvent | null;
  presence: PresenceEntry[];
  /** Publish to other clients (stable ref). */
  publish: (eventType: RealtimeEventType, data: Record<string, unknown>) => void;
}

export function useRealtime(opts: UseRealtimeOpts = {}): UseRealtimeResult {
  const { project, userId, url, eventTypes, onEvent } = opts;
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null);
  const [presence, setPresence] = useState<PresenceEntry[]>([]);
  const clientRef = useRef<RealtimeClient | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const typesRef = useRef(eventTypes);
  typesRef.current = eventTypes;

  useEffect(() => {
    const client = new RealtimeClient({ url, project, userId });
    clientRef.current = client;
    const offStatus = client.onStatusChange(setStatus);
    const offEvent = client.onEvent((event) => {
      const types = typesRef.current;
      if (event.type === 'presence.join') {
        const clientId = String(event.data?.clientId ?? event.clientId ?? '');
        if (clientId) {
          setPresence((prev) =>
            prev.some((p) => p.clientId === clientId)
              ? prev
              : [...prev, { clientId, userId: event.data?.userId as string | undefined }],
          );
        }
      } else if (event.type === 'presence.leave') {
        const clientId = String(event.data?.clientId ?? event.clientId ?? '');
        if (clientId) setPresence((prev) => prev.filter((p) => p.clientId !== clientId));
      }
      setLastEvent(event);
      if (!types || types.includes(event.type)) {
        try {
          onEventRef.current?.(event);
        } catch {
          // page handler errors must never break the hook (TD-011)
        }
      }
    });
    // SSR-safe initial status (no WebSocket on server / unsupported env).
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') {
      setStatus('unavailable');
    } else {
      client.connect();
      setStatus(client.getStatus());
    }
    return () => {
      offStatus();
      offEvent();
      client.disconnect();
      clientRef.current = null;
    };
    // Reconnect only when identity changes — not on every handler change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, userId, url]);

  const publishRef = useRef((eventType: RealtimeEventType, data: Record<string, unknown>) => {
    try {
      clientRef.current?.publish(eventType, data);
    } catch {
      // ignore — publishing is best-effort
    }
  });

  return { status, lastEvent, presence, publish: publishRef.current };
}

// ─── List-merge helpers (pure — unit-testable) ──────────────────────

interface WithId {
  id: string;
  [key: string]: unknown;
}

function eventPayload(event: RealtimeEvent): WithId | null {
  const d = event.data ?? {};
  // Our own `publish()` sends the full entity as `data`; a future
  // server bridge may nest it under `data.task` / `data.document`.
  const nested = (d.task ?? d.document ?? d.item) as unknown;
  const candidate = (nested && typeof nested === 'object' ? nested : d) as Record<string, unknown>;
  if (typeof candidate.id === 'string' && candidate.id.length > 0) {
    return candidate as WithId;
  }
  return null;
}

/** Merge a task.* event into a task list. Returns the original array when no-op. */
export function applyTaskEvent<T extends WithId>(tasks: T[], event: RealtimeEvent): T[] {
  switch (event.type) {
    case 'task.deleted': {
      const id = String(event.data?.id ?? '');
      if (!id || !tasks.some((t) => t.id === id)) return tasks;
      return tasks.filter((t) => t.id !== id);
    }
    case 'task.created':
    case 'task.updated':
    case 'task.closed': {
      const payload = eventPayload(event);
      if (!payload) return tasks;
      const idx = tasks.findIndex((t) => t.id === payload.id);
      if (idx === -1) return [...tasks, payload as T];
      if (tasks[idx] === payload) return tasks;
      const next = tasks.slice();
      next[idx] = { ...tasks[idx], ...payload };
      return next;
    }
    default:
      return tasks;
  }
}

/** Merge a knowledge.* event into a document list. Returns the original array when no-op. */
export function applyKnowledgeEvent<T extends WithId>(docs: T[], event: RealtimeEvent): T[] {
  switch (event.type) {
    case 'knowledge.deleted': {
      const id = String(event.data?.id ?? '');
      if (!id || !docs.some((d) => d.id === id)) return docs;
      return docs.filter((d) => d.id !== id);
    }
    case 'knowledge.created':
    case 'knowledge.updated': {
      const payload = eventPayload(event);
      if (!payload) return docs;
      const idx = docs.findIndex((d) => d.id === payload.id);
      if (idx === -1) return [...docs, payload as T];
      const next = docs.slice();
      next[idx] = { ...docs[idx], ...payload };
      return next;
    }
    default:
      return docs;
  }
}

// ─── Status badge styling (shared by pages) ─────────────────────────

export function connectionBadgeClass(status: ConnectionStatus): string {
  switch (status) {
    case 'connected':
      return 'bg-green-100 text-green-700 border-green-200';
    case 'connecting':
    case 'reconnecting':
      return 'bg-yellow-100 text-yellow-700 border-yellow-200';
    case 'unavailable':
      return 'bg-gray-100 text-gray-500 border-gray-200';
    case 'closed':
      return 'bg-gray-100 text-gray-500 border-gray-200';
  }
}

export function connectionBadgeLabel(status: ConnectionStatus, presenceCount?: number): string {
  switch (status) {
    case 'connected':
      return presenceCount && presenceCount > 0 ? `● Live (${presenceCount} online)` : '● Live';
    case 'connecting':
      return '○ Connecting…';
    case 'reconnecting':
      return '○ Reconnecting…';
    case 'unavailable':
      return '○ Offline';
    case 'closed':
      return '○ Closed';
  }
}
