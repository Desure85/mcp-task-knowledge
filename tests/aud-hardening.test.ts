/**
 * tests/aud-hardening.test.ts — Этап M фаза 2 (request-path hardening):
 *
 *   AUD-12  error message hygiene — e.message (internal paths, stack
 *           fragments, validator internals) never reaches the client;
 *           generic message out, details to the server log.
 *   AUD-13  mcp.authenticate brute-force protection keyed by client remote
 *           IP (from SessionManager session metadata), not sessionId —
 *           a fresh initialize must not reset the failure counter.
 *   AUD-15  authenticatedSessions cleanup — revokeSession fires on
 *           session close (onClose callback), and the WS tokenValidator
 *           path no longer leaks phantom 'ws:*' entries.
 */

import { describe, it, expect } from 'vitest';
import { AuthManager, AuthError, InvalidTokenError, createStaticValidator } from '../src/core/auth.js';
import { AuthProtection } from '../src/core/auth-protection.js';
import { SessionManager } from '../src/core/session-manager.js';
import { wrapToolHandler } from '../src/core/auth-gate.js';

const okResult = () => ({ content: [{ type: 'text' as const, text: '{"ok":true}' }] });

function envelope(res: { content: { text: string }[] }): { ok: boolean; error?: { message: string } } {
  return JSON.parse(res.content[0].text);
}

// ─── AUD-12: error message hygiene ──────────────────────────────────

describe('AUD-12: error message hygiene', () => {
  it('wrapToolHandler: handler throw → generic "internal error", no e.message leak', async () => {
    const secret = '/home/deploy/secrets/db-passwords.json';
    const wrapped = wrapToolHandler(
      'tasks_list',
      () => {
        throw new Error(`ENOENT: cannot open ${secret}`);
      },
      () => ({ auth: undefined, transport: 'stdio', security: undefined }),
    );
    const res = (await wrapped({}, { sessionId: 's1' })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(res.isError).toBe(true);
    const env = envelope(res);
    expect(env.error?.message).toBe('internal error');
    expect(env.error?.message).not.toContain(secret);
    expect(env.error?.message).not.toContain('ENOENT');
  });

  it('wrapToolHandler: non-Error throw → still generic', async () => {
    const wrapped = wrapToolHandler(
      'tasks_list',
      () => {
        // eslint-disable-next-line no-throw-literal
        throw 'raw string with /internal/path';
      },
      () => ({ auth: undefined, transport: 'stdio', security: undefined }),
    );
    const res = (await wrapped({}, { sessionId: 's1' })) as { content: { text: string }[] };
    expect(envelope(res).error?.message).toBe('internal error');
  });
});

// ─── AUD-13: IP-keyed brute-force protection ────────────────────────

describe('AUD-13: authenticate rate-limit by remote IP', () => {
  function makeAuth(maxAttempts = 3) {
    const sm = new SessionManager({ maxSessions: 1000 });
    const ap = new AuthProtection({ maxAttempts, windowMs: 60_000, baseLockoutMs: 60_000 });
    const auth = new AuthManager({
      requireAuth: true,
      transport: 'http',
      tokenValidator: createStaticValidator({ 'good-token': { userId: 'u1', roles: [] } }),
      sessionManager: sm,
      authProtection: ap,
    });
    return { sm, ap, auth };
  }

  it('failures accumulate across DIFFERENT sessions from the same IP', async () => {
    const { sm, auth } = makeAuth(3);
    // Attacker reconnects: each initialize → fresh sessionId, same remote IP.
    for (let i = 0; i < 3; i++) {
      const s = sm.create({ remote: '203.0.113.7' });
      await expect(auth.authenticate(s.id, 'bad-token')).rejects.toThrow(InvalidTokenError);
    }
    // 4th attempt from same IP — locked even though it's a brand-new session.
    const s4 = sm.create({ remote: '203.0.113.7' });
    await expect(auth.authenticate(s4.id, 'bad-token')).rejects.toThrow(AuthError);
    await expect(auth.authenticate(s4.id, 'bad-token')).rejects.toThrow(/too many failed attempts/);
    // Even the CORRECT token is refused while locked.
    await expect(auth.authenticate(s4.id, 'good-token')).rejects.toThrow(/too many failed attempts/);
  });

  it('different IPs are tracked independently', async () => {
    const { sm, auth } = makeAuth(2);
    const a1 = sm.create({ remote: '198.51.100.1' });
    const a2 = sm.create({ remote: '198.51.100.1' });
    await expect(auth.authenticate(a1.id, 'bad')).rejects.toThrow(InvalidTokenError);
    await expect(auth.authenticate(a2.id, 'bad')).rejects.toThrow(InvalidTokenError);
    // a-side IP now locked
    const a3 = sm.create({ remote: '198.51.100.1' });
    await expect(auth.authenticate(a3.id, 'bad')).rejects.toThrow(/too many failed attempts/);
    // b-side IP unaffected
    const b1 = sm.create({ remote: '192.0.2.55' });
    await expect(auth.authenticate(b1.id, 'bad')).rejects.toThrow(InvalidTokenError);
  });

  it('TCP-style remote "ip:port" strips the port — same IP across reconnects', async () => {
    const { sm, auth } = makeAuth(2);
    // TCP transport stores remote as `${remoteAddress}:${remotePort}` —
    // each reconnect gets a new source port AND a new sessionId.
    const s1 = sm.create({ remote: '203.0.113.9:51001' });
    const s2 = sm.create({ remote: '203.0.113.9:52222' });
    await expect(auth.authenticate(s1.id, 'bad')).rejects.toThrow(InvalidTokenError);
    await expect(auth.authenticate(s2.id, 'bad')).rejects.toThrow(InvalidTokenError);
    const s3 = sm.create({ remote: '203.0.113.9:54444' });
    await expect(auth.authenticate(s3.id, 'bad')).rejects.toThrow(/too many failed attempts/);
  });

  it('successful auth resets the failure counter for that IP', async () => {
    const { sm, auth } = makeAuth(3);
    const s1 = sm.create({ remote: '203.0.113.20' });
    const s2 = sm.create({ remote: '203.0.113.20' });
    await expect(auth.authenticate(s1.id, 'bad')).rejects.toThrow(InvalidTokenError);
    await expect(auth.authenticate(s2.id, 'bad')).rejects.toThrow(InvalidTokenError);
    // legit login from same IP clears the counter
    const s3 = sm.create({ remote: '203.0.113.20' });
    await auth.authenticate(s3.id, 'good-token');
    // full maxAttempts (3) fresh failures needed before lockout — the first
    // two must NOT lock (proves the counter was actually reset).
    const s4 = sm.create({ remote: '203.0.113.20' });
    const s5 = sm.create({ remote: '203.0.113.20' });
    await expect(auth.authenticate(s4.id, 'bad')).rejects.toThrow(InvalidTokenError);
    await expect(auth.authenticate(s5.id, 'bad')).rejects.toThrow(InvalidTokenError);
    const s5b = sm.create({ remote: '203.0.113.20' });
    await expect(auth.authenticate(s5b.id, 'bad')).rejects.toThrow(InvalidTokenError);
    const s6 = sm.create({ remote: '203.0.113.20' });
    await expect(auth.authenticate(s6.id, 'bad')).rejects.toThrow(/too many failed attempts/);
  });

  it('no sessionManager → falls back to sessionId key (still bounded per session)', async () => {
    const ap = new AuthProtection({ maxAttempts: 2, windowMs: 60_000, baseLockoutMs: 60_000 });
    const auth = new AuthManager({
      requireAuth: true,
      tokenValidator: createStaticValidator({ good: { userId: 'u' } }),
      authProtection: ap,
    });
    await expect(auth.authenticate('sess-x', 'bad')).rejects.toThrow(InvalidTokenError);
    await expect(auth.authenticate('sess-x', 'bad')).rejects.toThrow(InvalidTokenError);
    await expect(auth.authenticate('sess-x', 'bad')).rejects.toThrow(/too many failed attempts/);
  });

  it('no authProtection configured → unprotected (backwards compat)', async () => {
    const auth = new AuthManager({
      requireAuth: true,
      tokenValidator: createStaticValidator({ good: { userId: 'u' } }),
    });
    for (let i = 0; i < 10; i++) {
      await expect(auth.authenticate('s', 'bad')).rejects.toThrow(InvalidTokenError);
    }
  });
});

// ─── AUD-15: authenticatedSessions cleanup ──────────────────────────

describe('AUD-15: revokeSession on session close', () => {
  it('sessionManager.close() fires onClose → revokeSession (transport wiring)', async () => {
    const sm = new SessionManager({ maxSessions: 100 });
    const auth = new AuthManager({
      requireAuth: true,
      tokenValidator: createStaticValidator({ tok: { userId: 'u1' } }),
      sessionManager: sm,
    });
    // Mirror the transport wiring: onClose → revokeSession.
    const session = sm.create({
      remote: '127.0.0.1',
      onClose: async (sid) => auth.revokeSession(sid),
    });
    await auth.authenticate(session.id, 'tok');
    expect(auth.isAuthenticated(session.id)).toBe(true);
    expect(auth.authenticatedCount).toBe(1);

    await sm.close(session.id);
    expect(auth.authenticatedCount).toBe(0);
    expect(auth.isAuthenticated(session.id)).toBe(false);
  });

  it('prune() sweep revokes expired sessions via onClose', async () => {
    const sm = new SessionManager({ maxSessions: 100, sessionTtlMs: 1, idleTimeoutMs: 60_000 });
    const auth = new AuthManager({
      requireAuth: true,
      tokenValidator: createStaticValidator({ tok: { userId: 'u1' } }),
      sessionManager: sm,
    });
    const session = sm.create({
      remote: '127.0.0.1',
      onClose: async (sid) => auth.revokeSession(sid),
    });
    await auth.authenticate(session.id, 'tok');
    expect(auth.authenticatedCount).toBe(1);

    await new Promise((r) => setTimeout(r, 5)); // let TTL elapse
    const closed = await sm.prune();
    expect(closed).toContain(session.id);
    expect(auth.authenticatedCount).toBe(0);
  });

  it('closeAll() revokes every authenticated session via onClose', async () => {
    const sm = new SessionManager({ maxSessions: 100 });
    const auth = new AuthManager({
      requireAuth: true,
      tokenValidator: createStaticValidator({ tok: { userId: 'u1' } }),
      sessionManager: sm,
    });
    for (let i = 0; i < 3; i++) {
      const s = sm.create({ remote: '127.0.0.1', onClose: async (sid) => auth.revokeSession(sid) });
      await auth.authenticate(s.id, 'tok');
    }
    expect(auth.authenticatedCount).toBe(3);
    await sm.closeAll();
    expect(auth.authenticatedCount).toBe(0);
  });

  it('validateToken() does NOT mark authenticatedSessions (WS-path leak)', async () => {
    const auth = new AuthManager({
      requireAuth: true,
      tokenValidator: createStaticValidator({ tok: { userId: 'u1' } }),
    });
    const r = await auth.validateToken('tok');
    expect(r?.userId).toBe('u1');
    expect(auth.authenticatedCount).toBe(0);
    expect(auth.getAuthenticatedSessionIds().size).toBe(0);

    const bad = await auth.validateToken('nope');
    expect(bad).toBeNull();
    expect(auth.authenticatedCount).toBe(0);
  });
});
