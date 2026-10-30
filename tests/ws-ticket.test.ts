/**
 * UI-22 / F-29 — WebSocket tickets.
 *
 * Covers the ticket store (single-use, TTL, revocation, token expiry) and the
 * live HTTP+WS path: POST /auth/ws-ticket with a Bearer JWT, then a WS upgrade
 * with ?ticket=; the JWT (and the old ?token= form) must be rejected.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { request as httpRequest, type Server as HttpServer } from 'node:http';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { WsTicketStore } from '../src/core/ws-ticket.js';
import { HttpTransportAdapter } from '../src/transport/http-transport.js';
import { JwtValidator, createTestToken } from '../src/core/jwt-validator.js';
import { AuthManager } from '../src/core/auth.js';
import { SessionManager } from '../src/core/session-manager.js';
import { createMockServerContext } from './helpers.js';

const SECRET = 'ws-ticket-test-secret-that-is-long-enough';

describe('WsTicketStore', () => {
  let now: number;
  const clock = () => now;

  beforeEach(() => {
    now = 1_000_000;
  });

  it('issues a random ticket that can be redeemed exactly once', () => {
    const store = new WsTicketStore({ now: clock });
    const { ticket, expiresInSec } = store.issue({ userId: 'u1', jti: 'j1' });
    expect(ticket.length).toBeGreaterThanOrEqual(40);
    expect(expiresInSec).toBe(30);

    expect(store.redeem(ticket)).toEqual({ ok: true, userId: 'u1', jti: 'j1' });
    expect(store.redeem(ticket)).toEqual({ ok: false, reason: 'unknown' });
  });

  it('rejects missing and unknown tickets', () => {
    const store = new WsTicketStore({ now: clock });
    expect(store.redeem(undefined)).toEqual({ ok: false, reason: 'missing' });
    expect(store.redeem('')).toEqual({ ok: false, reason: 'missing' });
    expect(store.redeem('nope')).toEqual({ ok: false, reason: 'unknown' });
  });

  it('expires after the TTL', () => {
    const store = new WsTicketStore({ now: clock, ttlMs: 30_000 });
    const { ticket } = store.issue({ userId: 'u1' });
    now += 30_001;
    expect(store.redeem(ticket)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a ticket whose JWT jti was revoked', () => {
    let revoked = false;
    const store = new WsTicketStore({ now: clock, isRevoked: () => revoked });
    const { ticket } = store.issue({ userId: 'u1', jti: 'j1' });
    revoked = true;
    expect(store.redeem(ticket)).toEqual({ ok: false, reason: 'revoked' });
  });

  it('rejects a ticket bound to an already-expired token', () => {
    const store = new WsTicketStore({ now: clock });
    const { ticket } = store.issue({ userId: 'u1', jti: 'j1', exp: Math.floor(now / 1000) - 1 });
    expect(store.redeem(ticket)).toEqual({ ok: false, reason: 'token_expired' });
  });

  it('caps the number of live tickets and sweeps expired ones', () => {
    const store = new WsTicketStore({ now: clock, maxTickets: 2, ttlMs: 1_000 });
    store.issue({ userId: 'a' });
    store.issue({ userId: 'b' });
    store.issue({ userId: 'c' });
    expect(store.size).toBe(2);
    now += 2_000;
    expect(store.sweep()).toBe(2);
    expect(store.size).toBe(0);
  });
});

// ─── Live route + upgrade ───────────────────────────────────────────

function portOf(adapter: HttpTransportAdapter): number {
  const srv = (adapter as unknown as { httpServer?: HttpServer }).httpServer;
  if (!srv) throw new Error('httpServer not started');
  return (srv.address() as AddressInfo).port;
}

async function waitListening(adapter: HttpTransportAdapter): Promise<number> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      const srv = (adapter as unknown as { httpServer?: HttpServer }).httpServer;
      if (srv?.address()) return (srv.address() as AddressInfo).port;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  return portOf(adapter);
}

function postJson(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method: 'POST', headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function wsOpen(port: number, query: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`);
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('ws timeout')); }, 4000);
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      if (msg.type === 'connected') { clearTimeout(timer); ws.close(); resolve(msg); }
    });
    ws.on('close', (code) => { clearTimeout(timer); resolve({ closeCode: code }); });
    ws.on('error', () => { /* close handles it */ });
  });
}

describe('POST /auth/ws-ticket + WS upgrade (live)', () => {
  let adapter: HttpTransportAdapter;
  let sm: SessionManager;
  let validator: JwtValidator;
  let auth: AuthManager;
  let port: number;

  const tokenFor = (sub: string, jti: string, ttlSec = 3600) =>
    createTestToken({ sub, jti, exp: Math.floor(Date.now() / 1000) + ttlSec }, SECRET);
  // createTestToken is async — await it before putting it in the header.

  const issueTicket = async (token: string) => {
    const res = await postJson(port, '/auth/ws-ticket', { Authorization: `Bearer ${token}` });
    const body = JSON.parse(res.body) as { ok?: boolean; ticket?: string; expiresInSec?: number };
    return { res, body };
  };

  beforeEach(async () => {
    sm = new SessionManager();
    validator = new JwtValidator({ secret: SECRET });
    auth = new AuthManager({
      requireAuth: true,
      transport: 'http',
      tokenValidator: validator.asTokenValidator(),
      sessionManager: sm,
    });
    adapter = new HttpTransportAdapter(0, '127.0.0.1');
    await adapter.connect(createMockServerContext({
      sessionManager: sm,
      authManager: auth,
      isJwtRevoked: (jti) => validator.isRevoked(jti),
    }));
    port = await waitListening(adapter);
  });

  afterEach(async () => {
    await adapter?.close().catch(() => undefined);
    await sm?.closeAll().catch(() => undefined);
  });

  it('issues a ticket for a valid Bearer JWT and accepts the WS upgrade', async () => {
    const token = await tokenFor('u1', 'jti-1');
    const { res, body } = await issueTicket(token);
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.expiresInSec).toBe(30);
    expect(typeof body.ticket).toBe('string');

    const opened = await wsOpen(port, `?ticket=${encodeURIComponent(body.ticket!)}`);
    expect(opened).toHaveProperty('clientId');
  });

  it('burns the ticket: a replayed ticket is rejected with 4001', async () => {
    const { body } = await issueTicket(await tokenFor('u1', 'jti-2'));
    const first = await wsOpen(port, `?ticket=${encodeURIComponent(body.ticket!)}`);
    expect(first).toHaveProperty('clientId');
    const replay = await wsOpen(port, `?ticket=${encodeURIComponent(body.ticket!)}`);
    expect(replay.closeCode).toBe(4001);
  });

  it('rejects the old JWT-in-query form and a missing ticket', async () => {
    const token = await tokenFor('u1', 'jti-3');
    expect((await wsOpen(port, `?token=${encodeURIComponent(token)}`)).closeCode).toBe(4001);
    expect((await wsOpen(port, '')).closeCode).toBe(4001);
  });

  it('rejects ticket requests without a valid Bearer token', async () => {
    const none = await postJson(port, '/auth/ws-ticket');
    expect(none.status).toBe(401);
    const bad = await postJson(port, '/auth/ws-ticket', { Authorization: 'Bearer garbage' });
    expect(bad.status).toBe(401);
  });

  it('does not issue a ticket for a revoked JWT', async () => {
    const token = await tokenFor('u1', 'jti-revoked');
    validator.revokeByJti('jti-revoked', Math.floor(Date.now() / 1000) + 3600);
    const { res } = await issueTicket(token);
    expect(res.status).toBe(401);
  });

  it('rejects a ticket issued before the JWT was revoked', async () => {
    const token = await tokenFor('u1', 'jti-late-revoke');
    const { body } = await issueTicket(token);
    validator.revokeByJti('jti-late-revoke', Math.floor(Date.now() / 1000) + 3600);
    const opened = await wsOpen(port, `?ticket=${encodeURIComponent(body.ticket!)}`);
    expect(opened.closeCode).toBe(4001);
  });

  it('returns 405 for non-POST', async () => {
    const res = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: '/auth/ws-ticket', method: 'GET' }, (r) => {
        r.resume();
        resolve(r.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(res).toBe(405);
  });
});
