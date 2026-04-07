/**
 * Tests for A-003 — Token claims bound to session TTL
 *
 * Covers:
 *   - SessionManager.setSessionExpiry() / clearSessionExpiry()
 *   - SessionManager.getSessionExpiry() / isSessionExpired()
 *   - SessionInfo.expiresAt / ttlRemainingMs
 *   - prune() respects per-session expiry (token-expiry before global TTL)
 *   - AuthManager auto-binds JWT exp to session TTL
 *   - AuthManager tokenTtlGraceMs configuration
 *   - Grace period (session closed before token expiry)
 *   - Sessions without per-session expiry use global TTL
 *   - setSessionExpiry clamps to creation time
 *   - Session expiry preserved in SessionInfo
 *   - Integration: AuthManager + SessionManager + JwtValidator end-to-end
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../src/core/session-manager.js';
import { AuthManager, createStaticValidator } from '../src/core/auth.js';
import { JwtValidator, createTestToken } from '../src/core/jwt-validator.js';

// ─── Helpers ──────────────────────────────────────────────────────────

const SECRET = 'test-secret-key-32-chars-long-enough!!';

function createSm(overrides?: Record<string, unknown>): SessionManager {
  return new SessionManager({
    maxSessions: 100,
    sessionTtlMs: 86_400_000, // 24h
    idleTimeoutMs: 1_800_000, // 30min
    pruneIntervalMs: 60_000,
    ...overrides,
  });
}

function createJwtAuth(sm: SessionManager, graceMs?: number): AuthManager {
  const validator = new JwtValidator({ secret: SECRET, issuer: 'test', audience: 'test' });
  return new AuthManager({
    requireAuth: true,
    tokenValidator: validator.asTokenValidator(),
    sessionManager: sm,
    tokenTtlGraceMs: graceMs,
  });
}

async function makeToken(overrides: Record<string, unknown> = {}): Promise<string> {
  return createTestToken({ sub: 'user-1', iss: 'test', aud: 'test', ...overrides }, SECRET);
}

// ─── SessionManager per-session TTL ───────────────────────────────────

describe('SessionManager — setSessionExpiry', () => {
  it('should set per-session expiry', () => {
    const sm = createSm();
    const session = sm.create({ remote: '127.0.0.1' });

    const futureExpiry = Date.now() + 3600_000; // 1h from now
    const result = sm.setSessionExpiry(session.id, futureExpiry);

    expect(result).toBe(true);
    expect(sm.getSessionExpiry(session.id)).toBe(futureExpiry);
  });

  it('should return false for nonexistent session', () => {
    const sm = createSm();
    expect(sm.setSessionExpiry('nonexistent', Date.now() + 1000)).toBe(false);
  });

  it('should clamp expiry to creation time', () => {
    const sm = createSm();
    const session = sm.create({ remote: '127.0.0.1' });

    // Set expiry 1h before session was created — should clamp to createdAt
    // setSessionExpiry clamps to creation time, so expiry = createdAt
    sm.setSessionExpiry(session.id, 1); // way in the past

    const expiry = sm.getSessionExpiry(session.id);
    expect(expiry).toBeGreaterThan(0);
    // After clamping, expiresAt should be createdAt
    const info = sm.get(session.id)!;
    const createdAtMs = new Date(info.createdAt).getTime();
    expect(expiry).toBe(createdAtMs);
  });
});

describe('SessionManager — clearSessionExpiry', () => {
  it('should clear per-session expiry', () => {
    const sm = createSm();
    const session = sm.create({ remote: '127.0.0.1' });

    sm.setSessionExpiry(session.id, Date.now() + 3600_000);
    expect(sm.clearSessionExpiry(session.id)).toBe(true);

    // Should now fall back to global TTL
    const expiry = sm.getSessionExpiry(session.id);
    expect(expiry).toBeGreaterThan(Date.now() + 86_000_000); // ~24h remaining
  });

  it('should return false if no expiry was set', () => {
    const sm = createSm();
    const session = sm.create({ remote: '127.0.0.1' });
    expect(sm.clearSessionExpiry(session.id)).toBe(false);
  });

  it('should return false for nonexistent session', () => {
    const sm = createSm();
    expect(sm.clearSessionExpiry('nonexistent')).toBe(false);
  });
});

describe('SessionManager — getSessionExpiry', () => {
  it('should return per-session expiry when set', () => {
    const sm = createSm();
    const session = sm.create({ remote: '127.0.0.1' });

    const customExpiry = Date.now() + 7200_000;
    sm.setSessionExpiry(session.id, customExpiry);

    expect(sm.getSessionExpiry(session.id)).toBe(customExpiry);
  });

  it('should return global TTL when no per-session expiry', () => {
    const sm = createSm();
    const session = sm.create({ remote: '127.0.0.1' });
    const createdAtMs = new Date(session.createdAt).getTime();

    const expiry = sm.getSessionExpiry(session.id);
    expect(expiry).toBeCloseTo(createdAtMs + 86_400_000, -3);
  });

  it('should return undefined for nonexistent session', () => {
    const sm = createSm();
    expect(sm.getSessionExpiry('nonexistent')).toBeUndefined();
  });
});

describe('SessionManager — isSessionExpired', () => {
  it('should return true when session exceeded per-session expiry', async () => {
    const sm = createSm();
    const session = sm.create({ remote: '127.0.0.1' });

    // Set expiry in the past
    sm.setSessionExpiry(session.id, Date.now() - 1000);
    expect(sm.isSessionExpired(session.id)).toBe(true);
  });

  it('should return false when session has not expired', () => {
    const sm = createSm();
    const session = sm.create({ remote: '127.0.0.1' });

    sm.setSessionExpiry(session.id, Date.now() + 3600_000);
    expect(sm.isSessionExpired(session.id)).toBe(false);
  });

  it('should return undefined for nonexistent session', () => {
    const sm = createSm();
    expect(sm.isSessionExpired('nonexistent')).toBeUndefined();
  });
});

describe('SessionManager — SessionInfo expiry fields', () => {
  it('should include expiresAt in SessionInfo when per-session expiry is set', () => {
    const sm = createSm();
    const session = sm.create({ remote: '127.0.0.1' });

    const customExpiry = Date.now() + 3600_000;
    sm.setSessionExpiry(session.id, customExpiry);

    const info = sm.get(session.id)!;
    expect(info.expiresAt).toBe(customExpiry);
    expect(info.ttlRemainingMs).toBeGreaterThan(0);
    expect(info.ttlRemainingMs).toBeLessThanOrEqual(3600_000);
  });

  it('should include global TTL based expiresAt when no per-session expiry', () => {
    const sm = createSm();
    const session = sm.create({ remote: '127.0.0.1' });

    const info = sm.get(session.id)!;
    expect(info.expiresAt).toBeDefined();
    expect(info.ttlRemainingMs).toBeGreaterThan(86_000_000); // ~24h
    expect(info.ttlRemainingMs).toBeLessThanOrEqual(86_400_000);
  });
});

describe('SessionManager — prune with per-session expiry', () => {
  it('should close session when per-session expiry is reached', async () => {
    const sm = createSm();
    const session = sm.create({ remote: '127.0.0.1' });

    // Set expiry in the past
    sm.setSessionExpiry(session.id, Date.now() - 1000);

    const closed = await sm.prune();
    expect(closed).toContain(session.id);
    expect(sm.has(session.id)).toBe(false);
  });

  it('should not close session when per-session expiry is in the future', async () => {
    const sm = createSm();
    const session = sm.create({ remote: '127.0.0.1' });

    sm.setSessionExpiry(session.id, Date.now() + 3600_000);

    const closed = await sm.prune();
    expect(closed).not.toContain(session.id);
    expect(sm.has(session.id)).toBe(true);
  });

  it('should close token-expired session even if global TTL is far away', async () => {
    // Token expires in 1 second, global TTL is 24h
    const sm = createSm({ sessionTtlMs: 86_400_000 });
    const session = sm.create({ remote: '127.0.0.1' });

    // Token expired 5 seconds ago
    sm.setSessionExpiry(session.id, Date.now() - 5000);

    const closed = await sm.prune();
    expect(closed).toContain(session.id);
  });

  it('should mix per-session and global TTL sessions in prune', async () => {
    const sm = createSm({ sessionTtlMs: 86_400_000 });
    const s1 = sm.create({ remote: '127.0.0.1' });
    const s2 = sm.create({ remote: '127.0.0.1' });
    const s3 = sm.create({ remote: '127.0.0.1' });

    // s1: per-session expiry in the past
    sm.setSessionExpiry(s1.id, Date.now() - 1000);
    // s2: no per-session expiry, well within global TTL
    // s3: per-session expiry in the future
    sm.setSessionExpiry(s3.id, Date.now() + 3600_000);

    const closed = await sm.prune();
    expect(closed).toContain(s1.id);
    expect(closed).not.toContain(s2.id);
    expect(closed).not.toContain(s3.id);
  });

  it('should use global TTL for sessions without per-session expiry', async () => {
    // Very short global TTL
    const sm = createSm({ sessionTtlMs: 10 });
    const session = sm.create({ remote: '127.0.0.1' });

    // Wait for global TTL to pass
    await new Promise((r) => setTimeout(r, 20));

    const closed = await sm.prune();
    expect(closed).toContain(session.id);
  });
});

// ─── AuthManager auto-binds JWT exp to session TTL ───────────────────

describe('AuthManager — JWT exp → session TTL binding', () => {
  it('should bind session TTL to JWT exp with grace period', async () => {
    const sm = createSm();
    const auth = createJwtAuth(sm, 30_000); // 30s grace

    const now = Math.floor(Date.now() / 1000);
    const token = await makeToken({
      iat: now,
      exp: now + 3600, // 1h from now
    });

    const session = sm.create({ remote: '127.0.0.1' });
    await auth.authenticate(session.id, token);

    // Session expiry should be exp - 30s grace
    const sessionExpiry = sm.getSessionExpiry(session.id)!;
    const expectedExpiry = (now + 3600) * 1000 - 30_000;

    expect(sessionExpiry).toBeCloseTo(expectedExpiry, -2); // within 10ms
  });

  it('should set session expiry in SessionInfo', async () => {
    const sm = createSm();
    const auth = createJwtAuth(sm, 0); // no grace

    const now = Math.floor(Date.now() / 1000);
    const token = await makeToken({ iat: now, exp: now + 600 }); // 10min

    const session = sm.create({ remote: '127.0.0.1' });
    await auth.authenticate(session.id, token);

    const info = sm.get(session.id)!;
    expect(info.expiresAt).toBeDefined();
    expect(info.ttlRemainingMs).toBeGreaterThan(0);
    expect(info.ttlRemainingMs).toBeLessThanOrEqual(600_000);
  });

  it('should close session by prune when JWT token expires', async () => {
    const sm = createSm({ sessionTtlMs: 86_400_000 });
    const auth = createJwtAuth(sm, 1000); // 1s grace

    // Token expired 2 seconds ago
    const now = Math.floor(Date.now() / 1000);
    const token = await makeToken({ iat: now - 120, exp: now - 2 });

    const session = sm.create({ remote: '127.0.0.1' });
    await auth.authenticate(session.id, token);

    // Session should be expired (exp - 1s grace < now)
    const expired = sm.isSessionExpired(session.id);
    expect(expired).toBe(true);

    // Prune should close it
    const closed = await sm.prune();
    expect(closed).toContain(session.id);
  });

  it('should not bind session TTL without JWT claims (static validator)', async () => {
    const sm = createSm();
    const auth = new AuthManager({
      requireAuth: true,
      tokenValidator: createStaticValidator({ 'tok': { userId: 'u1' } }),
      sessionManager: sm,
    });

    const session = sm.create({ remote: '127.0.0.1' });
    await auth.authenticate(session.id, 'tok');

    // No per-session expiry — should use global TTL
    const expiry = sm.getSessionExpiry(session.id);
    const createdAtMs = new Date(session.createdAt).getTime();
    expect(expiry).toBeCloseTo(createdAtMs + 86_400_000, -3);
  });

  it('should not bind session TTL when JWT has no exp claim', async () => {
    const sm = createSm();
    const validator = new JwtValidator({ secret: SECRET });
    const auth = new AuthManager({
      requireAuth: true,
      tokenValidator: validator.asTokenValidator(),
      sessionManager: sm,
    });

    // Token without exp claim
    const token = await makeToken({ exp: undefined });
    const session = sm.create({ remote: '127.0.0.1' });
    await auth.authenticate(session.id, token);

    // No per-session expiry — should use global TTL
    const expiry = sm.getSessionExpiry(session.id);
    const createdAtMs = new Date(session.createdAt).getTime();
    expect(expiry).toBeCloseTo(createdAtMs + 86_400_000, -3);
  });
});

describe('AuthManager — tokenTtlGraceMs configuration', () => {
  it('should use default grace of 30s when not configured', async () => {
    const sm = createSm();
    const validator = new JwtValidator({ secret: SECRET });
    const auth = new AuthManager({
      requireAuth: true,
      tokenValidator: validator.asTokenValidator(),
      sessionManager: sm,
      // tokenTtlGraceMs not set — default 30_000
    });

    const now = Math.floor(Date.now() / 1000);
    const token = await makeToken({ iat: now, exp: now + 3600 });

    const session = sm.create({ remote: '127.0.0.1' });
    await auth.authenticate(session.id, token);

    const expiry = sm.getSessionExpiry(session.id)!;
    const expected = (now + 3600) * 1000 - 30_000;
    expect(expiry).toBeCloseTo(expected, -2);
  });

  it('should use 0 grace when configured', async () => {
    const sm = createSm();
    const auth = createJwtAuth(sm, 0);

    const now = Math.floor(Date.now() / 1000);
    const token = await makeToken({ iat: now, exp: now + 3600 });

    const session = sm.create({ remote: '127.0.0.1' });
    await auth.authenticate(session.id, token);

    const expiry = sm.getSessionExpiry(session.id)!;
    const expected = (now + 3600) * 1000; // no grace
    expect(expiry).toBeCloseTo(expected, -2);
  });

  it('should use custom grace period', async () => {
    const sm = createSm();
    const auth = createJwtAuth(sm, 120_000); // 2min grace

    const now = Math.floor(Date.now() / 1000);
    const token = await makeToken({ iat: now, exp: now + 600 });

    const session = sm.create({ remote: '127.0.0.1' });
    await auth.authenticate(session.id, token);

    const expiry = sm.getSessionExpiry(session.id)!;
    const expected = (now + 600) * 1000 - 120_000;
    expect(expiry).toBeCloseTo(expected, -2);
  });

  it('should disable grace with negative value (close at exact exp)', async () => {
    const sm = createSm();
    const auth = createJwtAuth(sm, -1); // negative = disable grace

    const now = Math.floor(Date.now() / 1000);
    const token = await makeToken({ iat: now, exp: now + 300 });

    const session = sm.create({ remote: '127.0.0.1' });
    await auth.authenticate(session.id, token);

    const expiry = sm.getSessionExpiry(session.id)!;
    const expected = (now + 300) * 1000; // exactly at exp
    expect(expiry).toBeCloseTo(expected, -2);
  });
});

// ─── End-to-end: AuthManager + JwtValidator + SessionManager ─────────

describe('A-003 — full integration', () => {
  it('should create session, authenticate with JWT, and expire by token TTL', async () => {
    const sm = createSm({ sessionTtlMs: 86_400_000 }); // 24h global
    const auth = createJwtAuth(sm, 500); // 500ms grace

    // Create token that expires in 2 seconds
    const now = Math.floor(Date.now() / 1000);
    const token = await makeToken({ iat: now, exp: now + 2 });

    // Create session and authenticate
    const session = sm.create({ remote: '127.0.0.1' });
    await auth.authenticate(session.id, token);
    expect(auth.isAuthenticated(session.id)).toBe(true);

    // Session should be valid initially (2s exp - 500ms grace = 1500ms)
    expect(sm.isSessionExpired(session.id)).toBe(false);

    // Wait for token to expire + grace period
    await new Promise((r) => setTimeout(r, 2000));

    // Session should now be expired
    expect(sm.isSessionExpired(session.id)).toBe(true);

    // Prune should close it
    const closed = await sm.prune();
    expect(closed).toContain(session.id);
    expect(sm.has(session.id)).toBe(false);
  });

  it('should not expire session when token is still valid', async () => {
    const sm = createSm({ sessionTtlMs: 86_400_000 });
    const auth = createJwtAuth(sm, 1000);

    // Token valid for 1 hour
    const now = Math.floor(Date.now() / 1000);
    const token = await makeToken({ iat: now, exp: now + 3600 });

    const session = sm.create({ remote: '127.0.0.1' });
    await auth.authenticate(session.id, token);

    // Should not be expired
    expect(sm.isSessionExpired(session.id)).toBe(false);

    // Prune should not close it
    const closed = await sm.prune();
    expect(closed).not.toContain(session.id);
    expect(sm.has(session.id)).toBe(true);
  });

  it('should revoke auth when session is closed by token expiry', async () => {
    const sm = createSm({ sessionTtlMs: 86_400_000 });
    const auth = createJwtAuth(sm, 100);

    const now = Math.floor(Date.now() / 1000);
    const token = await makeToken({ iat: now, exp: now + 1 });

    const session = sm.create({ remote: '127.0.0.1' });
    await auth.authenticate(session.id, token);
    expect(auth.isAuthenticated(session.id)).toBe(true);

    // Wait for expiry + grace
    await new Promise((r) => setTimeout(r, 1500));

    // Close via prune
    await sm.prune();

    // Auth state should still say authenticated (AuthManager doesn't auto-revoke)
    // But session is gone, so any operation will fail
    expect(sm.has(session.id)).toBe(false);
  });

  it('should handle multiple sessions with different token expiry times', async () => {
    const sm = createSm({ sessionTtlMs: 86_400_000 });
    const auth = createJwtAuth(sm, 0);

    const now = Math.floor(Date.now() / 1000);
    const shortToken = await makeToken({ iat: now, exp: now + 1 }); // 1s
    const longToken = await makeToken({ iat: now, exp: now + 3600 }); // 1h

    const s1 = sm.create({ remote: '127.0.0.1' });
    const s2 = sm.create({ remote: '127.0.0.1' });

    await auth.authenticate(s1.id, shortToken);
    await auth.authenticate(s2.id, longToken);

    // Both should be valid
    expect(sm.isSessionExpired(s1.id)).toBe(false);
    expect(sm.isSessionExpired(s2.id)).toBe(false);

    // Wait for short token to expire
    await new Promise((r) => setTimeout(r, 1500));

    // Only s1 should be expired
    expect(sm.isSessionExpired(s1.id)).toBe(true);
    expect(sm.isSessionExpired(s2.id)).toBe(false);

    // Prune should only close s1
    const closed = await sm.prune();
    expect(closed).toContain(s1.id);
    expect(closed).not.toContain(s2.id);
  });
});
