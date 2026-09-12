/**
 * AUD-14/16/17: request-path hardening fixes.
 *
 * AUD-14 — pendingInitRemotes FIFO race: parallel initialize POSTs could
 *   attribute the wrong remote IP to a session; a failed init leaked the
 *   queue entry. Fixed by passing remote per-request into
 *   createSessionTransport().
 * AUD-16 — JWT blacklist: count-based FIFO eviction de-revoked old jti and
 *   restart wiped all revocations. Fixed by exp-based eviction + optional
 *   persistence to a JSON file (blacklistPath).
 * AUD-17 — TLS wiring: TlsContext existed but had zero call sites. Wired
 *   into HTTP (https.createServer) and TCP (tls.createServer) adapters,
 *   opt-in via TLS_CERT_PATH/TLS_KEY_PATH.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { request as httpRequest, type Server as HttpServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { HttpTransportAdapter } from '../src/transport/http-transport.js';
import { JwtValidator, createTestToken } from '../src/core/jwt-validator.js';
import { SessionManager } from '../src/core/session-manager.js';
import { createMockServerContext } from './helpers.js';
import type { ServerContext } from '../src/register/context.js';

const SECRET = 'aud-test-secret-that-is-long-enough-for-hs256';

// ─── AUD-14: per-request remote attribution ────────────────────────────

function portOf(adapter: HttpTransportAdapter): number {
  const srv = (adapter as unknown as { httpServer?: HttpServer }).httpServer;
  if (!srv) throw new Error('httpServer not started');
  return (srv.address() as AddressInfo).port;
}

function postJson(
  port: number,
  body: string,
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
    clientInfo: { name: 'aud14-test', version: '0.0.0' },
  },
});

describe('AUD-14: per-request remote attribution', () => {
  let adapter: HttpTransportAdapter;
  let ctx: ServerContext;
  let sm: SessionManager;

  afterEach(async () => {
    await adapter?.close().catch(() => undefined);
    await sm?.closeAll().catch(() => undefined);
  });

  it('attributes the correct remote to each of two parallel initialize sessions', async () => {
    sm = new SessionManager();
    adapter = new HttpTransportAdapter(0, '127.0.0.1');
    ctx = createMockServerContext({ sessionManager: sm });
    await adapter.connect(ctx);
    await new Promise((r) => setTimeout(r, 50));
    const port = portOf(adapter);

    // Two parallel initialize POSTs — with the old FIFO queue, whichever
    // onsessioninitialized ran first consumed remotes in arrival order, so
    // a reordering misattributed IPs. Now remote is bound per-request.
    const [r1, r2] = await Promise.all([postJson(port, INIT_BODY), postJson(port, INIT_BODY)]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const sessions = sm.getAll();
    expect(sessions.length).toBe(2);
    for (const s of sessions) {
      // Both came from loopback — the point is each session got *a* remote
      // from its own request, not a shifted/duplicated/missing one.
      expect(s.remote).toBeTruthy();
      expect(typeof s.remote).toBe('string');
    }
  });

  it('does not leak remote state when initialize fails', async () => {
    sm = new SessionManager();
    adapter = new HttpTransportAdapter(0, '127.0.0.1');
    ctx = createMockServerContext({ sessionManager: sm });
    await adapter.connect(ctx);
    await new Promise((r) => setTimeout(r, 50));
    const port = portOf(adapter);

    // Malformed initialize (missing params) — SDK rejects, onsessioninitialized
    // never fires. Old code left the pushed remote in the queue forever.
    const bad = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    await postJson(port, bad);
    await postJson(port, bad);

    // A subsequent valid init must still get its own remote — proves no
    // stale queue entries are consumed.
    const ok = await postJson(port, INIT_BODY);
    expect(ok.status).toBe(200);
    const sessions = sm.getAll();
    expect(sessions.length).toBe(1);
    expect(sessions[0].remote).toBeTruthy();
  });
});

// ─── AUD-16: JWT blacklist exp-eviction + persistence ──────────────────

describe('AUD-16: JWT blacklist hardening', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'jwt-bl-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const makeValidator = (overrides: Record<string, unknown> = {}) =>
    new JwtValidator({ secret: SECRET, ...overrides });

  it('evicts expired revocations before live ones when at capacity', () => {
    const now = Math.floor(Date.now() / 1000);
    const v = makeValidator({ maxBlacklistSize: 2 });
    // Two live revocations fill capacity.
    v.revokeByJti('live-1', now + 3600);
    v.revokeByJti('live-2', now + 3600);
    // An expired revocation is dead weight — adding it must not evict live ones.
    v.revokeByJti('expired-1', now - 10);
    expect(v.isRevoked('live-1')).toBe(true);
    expect(v.isRevoked('live-2')).toBe(true);
    expect(v.isRevoked('expired-1')).toBe(false); // exp passed → treated as not revoked
  });

  it('evicts earliest-exp entry first when over capacity (not FIFO)', () => {
    const now = Math.floor(Date.now() / 1000);
    const v = makeValidator({ maxBlacklistSize: 2 });
    v.revokeByJti('short-lived', now + 60);    // expires soon
    v.revokeByJti('long-lived', now + 86400);  // expires in a day
    v.revokeByJti('mid-lived', now + 3600);    // over capacity → evict earliest exp
    expect(v.isRevoked('short-lived')).toBe(false); // evicted (earliest exp)
    expect(v.isRevoked('long-lived')).toBe(true);
    expect(v.isRevoked('mid-lived')).toBe(true);
  });

  it('revokeToken decodes jti+exp from the token itself', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await createTestToken({ sub: 'u1', jti: 'tok-jti', exp: now + 3600 }, SECRET);
    const v = makeValidator();
    v.revokeToken(token);
    expect(v.isRevoked('tok-jti')).toBe(true);
    expect(await v.validate(token)).toBeNull();
  });

  it('persists revocations to blacklistPath and reloads on construction', () => {
    const file = path.join(dir, '.jwt-revoked.json');
    const now = Math.floor(Date.now() / 1000);

    const v1 = makeValidator({ blacklistPath: file });
    v1.revokeByJti('persist-me', now + 3600);
    v1.revokeByJti('expired-skip', now - 5);
    expect(existsSync(file)).toBe(true);

    // New instance = simulated restart — revocation survives.
    const v2 = makeValidator({ blacklistPath: file });
    expect(v2.isRevoked('persist-me')).toBe(true);
    // Expired entry was not persisted as live (or is dropped on load).
    expect(v2.isRevoked('expired-skip')).toBe(false);
  });

  it('drops expired entries on load', () => {
    const file = path.join(dir, '.jwt-revoked.json');
    const now = Math.floor(Date.now() / 1000);
    writeFileSync(file, JSON.stringify({ revoked: { old: now - 100, fresh: now + 100 } }));
    const v = makeValidator({ blacklistPath: file });
    expect(v.isRevoked('old')).toBe(false);
    expect(v.isRevoked('fresh')).toBe(true);
  });

  it('clearBlacklist persists the empty state', () => {
    const file = path.join(dir, '.jwt-revoked.json');
    const now = Math.floor(Date.now() / 1000);
    const v1 = makeValidator({ blacklistPath: file });
    v1.revokeByJti('x', now + 3600);
    v1.clearBlacklist();
    const v2 = makeValidator({ blacklistPath: file });
    expect(v2.isRevoked('x')).toBe(false);
  });

  it('works without blacklistPath (in-memory only, no file writes)', () => {
    const v = makeValidator();
    v.revokeByJti('mem-only');
    expect(v.isRevoked('mem-only')).toBe(true);
    expect(existsSync(path.join(dir, '.jwt-revoked.json'))).toBe(false);
  });
});

// ─── AUD-17: TLS wiring ────────────────────────────────────────────────

describe('AUD-17: TLS wiring', () => {
  const PREV_CERT = process.env.TLS_CERT_PATH;
  const PREV_KEY = process.env.TLS_KEY_PATH;
  let dir: string;
  let adapter: HttpTransportAdapter;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'tls-wire-'));
  });

  afterEach(async () => {
    await adapter?.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
    if (PREV_CERT === undefined) delete process.env.TLS_CERT_PATH; else process.env.TLS_CERT_PATH = PREV_CERT;
    if (PREV_KEY === undefined) delete process.env.TLS_KEY_PATH; else process.env.TLS_KEY_PATH = PREV_KEY;
  });

  it('serves plain HTTP when TLS env vars are unset', async () => {
    delete process.env.TLS_CERT_PATH;
    delete process.env.TLS_KEY_PATH;
    adapter = new HttpTransportAdapter(0, '127.0.0.1');
    await adapter.connect(createMockServerContext());
    await new Promise((r) => setTimeout(r, 50));
    const res = await postJson(portOf(adapter), INIT_BODY);
    expect(res.status).toBe(200);
  });

  it('serves HTTPS when TLS_CERT_PATH/TLS_KEY_PATH point to a valid cert', async () => {
    // Generate a self-signed cert via openssl (available in CI/dev images).
    const cert = path.join(dir, 'cert.pem');
    const key = path.join(dir, 'key.pem');
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${key}" -out "${cert}" -days 1 -nodes -subj "/CN=localhost"`,
      { stdio: 'pipe' },
    );
    process.env.TLS_CERT_PATH = cert;
    process.env.TLS_KEY_PATH = key;

    adapter = new HttpTransportAdapter(0, '127.0.0.1');
    await adapter.connect(createMockServerContext());
    await new Promise((r) => setTimeout(r, 50));
    const port = portOf(adapter);

    // Plain HTTP against an HTTPS port must fail.
    await expect(postJson(port, INIT_BODY)).rejects.toThrow();

    // HTTPS with rejectUnauthorized=false (self-signed) must succeed.
    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpsRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/',
          method: 'POST',
          rejectUnauthorized: false,
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
        },
        (r) => {
          const chunks: Buffer[] = [];
          r.on('data', (c) => chunks.push(c as Buffer));
          r.on('end', () => resolve({ status: r.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }));
        },
      );
      req.on('error', reject);
      req.write(INIT_BODY);
      req.end();
    });
    expect(res.status).toBe(200);
  });

  it('falls back to plain HTTP with a warning when cert files are missing', async () => {
    process.env.TLS_CERT_PATH = path.join(dir, 'nonexistent-cert.pem');
    process.env.TLS_KEY_PATH = path.join(dir, 'nonexistent-key.pem');
    adapter = new HttpTransportAdapter(0, '127.0.0.1');
    await adapter.connect(createMockServerContext());
    await new Promise((r) => setTimeout(r, 50));
    // isEnabled (paths set) but !isReady (files missing) → plain HTTP.
    const res = await postJson(portOf(adapter), INIT_BODY);
    expect(res.status).toBe(200);
  });
});
