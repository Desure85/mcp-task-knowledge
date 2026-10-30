/**
 * Unit tests for pure helpers in lib/realtime.ts (PH-015d).
 * No WebSocket / React rendering — only pure functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveRealtimeUrl,
  backoffDelay,
  applyTaskEvent,
  applyKnowledgeEvent,
  connectionBadgeClass,
  connectionBadgeLabel,
  RealtimeClient,
  fetchWsTicket,
  WsTicketAuthError,
  type RealtimeEvent,
} from './realtime';
import { AUTH_EXPIRED_EVENT } from './auth';

describe('resolveRealtimeUrl', () => {
  it('explicit wsUrl wins as-is', () => {
    expect(resolveRealtimeUrl({ wsUrl: 'wss://x.test/custom' })).toBe('wss://x.test/custom');
  });

  it('absolute http apiUrl → ws://same-origin/ws', () => {
    expect(resolveRealtimeUrl({ apiUrl: 'http://localhost:3001/mcp' }))
      .toBe('ws://localhost:3001/ws');
  });

  it('absolute https apiUrl → wss://same-origin/ws', () => {
    expect(resolveRealtimeUrl({ apiUrl: 'https://mcp.example.com/api' }))
      .toBe('wss://mcp.example.com/ws');
  });

  it('relative apiUrl + origin → same-origin /ws', () => {
    expect(resolveRealtimeUrl({ apiUrl: '/api/mcp', locationOrigin: 'https://ui.example.com' }))
      .toBe('wss://ui.example.com/ws');
  });

  it('no inputs → /ws fallback', () => {
    expect(resolveRealtimeUrl({})).toBe('/ws');
  });
});

describe('backoffDelay', () => {
  it('grows exponentially from base', () => {
    expect(backoffDelay(0)).toBe(1000);
    expect(backoffDelay(1)).toBe(2000);
    expect(backoffDelay(2)).toBe(4000);
  });

  it('caps at maxMs', () => {
    expect(backoffDelay(20)).toBe(30_000);
  });
});

describe('applyTaskEvent', () => {
  const base = [{ id: 't1', title: 'A' }, { id: 't2', title: 'B' }];

  it('task.created appends new task', () => {
    const ev: RealtimeEvent = { type: 'task.created', data: { id: 't3', title: 'C' } };
    const next = applyTaskEvent(base, ev);
    expect(next).toHaveLength(3);
    expect(next[2].id).toBe('t3');
  });

  it('task.updated merges fields into existing task', () => {
    const ev: RealtimeEvent = { type: 'task.updated', data: { id: 't1', status: 'completed' } };
    const next = applyTaskEvent(base, ev);
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ id: 't1', title: 'A', status: 'completed' });
  });

  it('task.deleted removes task', () => {
    const ev: RealtimeEvent = { type: 'task.deleted', data: { id: 't1' } };
    expect(applyTaskEvent(base, ev).map((t) => t.id)).toEqual(['t2']);
  });

  it('task.deleted on unknown id returns same array (no-op)', () => {
    const ev: RealtimeEvent = { type: 'task.deleted', data: { id: 'nope' } };
    expect(applyTaskEvent(base, ev)).toBe(base);
  });

  it('ignores unrelated event types', () => {
    const ev: RealtimeEvent = { type: 'knowledge.created', data: { id: 'k1' } };
    expect(applyTaskEvent(base, ev)).toBe(base);
  });

  it('accepts nested payload under data.task', () => {
    const ev: RealtimeEvent = { type: 'task.created', data: { task: { id: 't9', title: 'nested' } } };
    const next = applyTaskEvent(base, ev);
    expect(next[2].id).toBe('t9');
  });
});

describe('applyKnowledgeEvent', () => {
  const base = [{ id: 'k1', title: 'Doc' }];

  it('knowledge.created appends', () => {
    const ev: RealtimeEvent = { type: 'knowledge.created', data: { id: 'k2' } };
    expect(applyTaskEvent.length).toBeGreaterThan(0); // sanity
    expect(applyKnowledgeEvent(base, ev)).toHaveLength(2);
  });

  it('knowledge.deleted removes', () => {
    const ev: RealtimeEvent = { type: 'knowledge.deleted', data: { id: 'k1' } };
    expect(applyKnowledgeEvent(base, ev)).toHaveLength(0);
  });

  it('ignores task.* events', () => {
    const ev: RealtimeEvent = { type: 'task.created', data: { id: 't1' } };
    expect(applyKnowledgeEvent(base, ev)).toBe(base);
  });
});

describe('connectionBadge', () => {
  it('maps statuses to distinct classes', () => {
    expect(connectionBadgeClass('connected')).toContain('green');
    expect(connectionBadgeClass('reconnecting')).toContain('yellow');
    expect(connectionBadgeClass('unavailable')).toContain('gray');
  });

  it('label includes presence count when connected', () => {
    expect(connectionBadgeLabel('connected', 3)).toBe('● Live (3 online)');
    expect(connectionBadgeLabel('connected')).toBe('● Live');
    expect(connectionBadgeLabel('unavailable')).toBe('○ Offline');
  });
});


// ─── UI-22: ticket-based WS auth ────────────────────────────────────

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev?: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send(): void {}
  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({});
  }
  triggerOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({});
  }
  triggerClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({});
  }
}

describe('UI-22: WebSocket auth ticket', () => {
  let dispatchEvent: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    dispatchEvent = vi.fn();
    fetchMock = vi.fn();
    vi.stubGlobal('window', {
      location: { href: 'http://localhost:3410/tasks' },
      dispatchEvent,
      sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('fetch', fetchMock);
    process.env.NEXT_PUBLIC_MCP_TOKEN = 'jwt-token';
    process.env.NEXT_PUBLIC_MCP_API_URL = 'http://127.0.0.1:3411/mcp';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env.NEXT_PUBLIC_MCP_TOKEN;
    delete process.env.NEXT_PUBLIC_MCP_API_URL;
  });

  it('fetches a ticket and puts it in the URL instead of the JWT', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ticket: 'ticket-1' }) });
    const client = new RealtimeClient({ url: 'ws://127.0.0.1:3411/ws' });
    client.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(endpoint).toContain('/auth/ws-ticket');
    expect(init.headers.Authorization).toBe('Bearer jwt-token');

    expect(MockWebSocket.instances).toHaveLength(1);
    const socketUrl = new URL(MockWebSocket.instances[0].url);
    expect(socketUrl.searchParams.get('ticket')).toBe('ticket-1');
    expect(socketUrl.searchParams.get('token')).toBeNull();
    expect(MockWebSocket.instances[0].url).not.toContain('jwt-token');
  });

  it('requests a fresh ticket before every reconnect', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ticket: 'ticket-1' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ticket: 'ticket-2' }) });
    const client = new RealtimeClient({ url: 'ws://127.0.0.1:3411/ws' });
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    MockWebSocket.instances[0].triggerOpen();
    expect(client.getStatus()).toBe('connected');

    MockWebSocket.instances[0].triggerClose();
    await vi.advanceTimersByTimeAsync(1000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(new URL(MockWebSocket.instances[1].url).searchParams.get('ticket')).toBe('ticket-2');
  });

  it('treats a 401 ticket response as an auth failure and stops retrying', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const client = new RealtimeClient({ url: 'ws://127.0.0.1:3411/ws' });
    client.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(client.getStatus()).toBe('unavailable');
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect((dispatchEvent.mock.calls[0][0] as Event).type).toBe(AUTH_EXPIRED_EVENT);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('schedules a normal retry when the ticket request fails at the network level', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const client = new RealtimeClient({ url: 'ws://127.0.0.1:3411/ws' });
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getStatus()).toBe('reconnecting');

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ticket: 'ticket-later' }) });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('connects without a ticket when no token is configured (open realtime)', async () => {
    delete process.env.NEXT_PUBLIC_MCP_TOKEN;
    const client = new RealtimeClient({ url: 'ws://127.0.0.1:3411/ws' });
    client.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(new URL(MockWebSocket.instances[0].url).searchParams.get('ticket')).toBeNull();
  });

  it('fetchWsTicket rejects an invalid ticket response shape', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await expect(fetchWsTicket()).rejects.toThrow(/missing ticket/);
  });

  it('fetchWsTicket surfaces 401 as WsTicketAuthError', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    await expect(fetchWsTicket()).rejects.toBeInstanceOf(WsTicketAuthError);
  });
});
