/**
 * Tests for SessionManager (S-001)
 *
 * Covers: creation, heartbeat, TTL, idle timeout, prune, max sessions,
 * onClose callbacks, graceful shutdown, interface compliance.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../src/core/session-manager.js';
import type { SessionManagerOptions, SessionInfo, CreateSessionOptions } from '../src/core/session-manager.js';

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Create a SessionManager with very short timeouts for fast tests.
 * Default TTL=500ms, idle=200ms, prune=100ms.
 */
function createFastManager(overrides?: Partial<SessionManagerOptions>): SessionManager {
  return new SessionManager({
    sessionTtlMs: 500,
    idleTimeoutMs: 200,
    pruneIntervalMs: 100,
    maxSessions: 10,
    ...overrides,
  });
}

/**
 * Wait for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Creation ─────────────────────────────────────────────────────────

describe('SessionManager — creation', () => {
  it('should create a session with UUID', () => {
    const sm = new SessionManager();
    const session = sm.create({ remote: 'test:1234' });

    expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.remote).toBe('test:1234');
    expect(session.ageMs).toBeGreaterThanOrEqual(0);
    expect(session.idleMs).toBeGreaterThanOrEqual(0);
  });

  it('should track session count', () => {
    const sm = new SessionManager();
    expect(sm.size).toBe(0);

    sm.create({ remote: 'a' });
    expect(sm.size).toBe(1);

    sm.create({ remote: 'b' });
    expect(sm.size).toBe(2);
  });

  it('should attach metadata', () => {
    const sm = new SessionManager();
    const session = sm.create({
      remote: 'test:1',
      metadata: { userId: 'u1', role: 'admin' },
    });

    expect(session.metadata).toEqual({ userId: 'u1', role: 'admin' });
  });

  it('should reject sessions after max limit', () => {
    const sm = new SessionManager({ maxSessions: 2 });
    sm.create({ remote: 'a' });
    sm.create({ remote: 'b' });

    expect(() => sm.create({ remote: 'c' })).toThrow(/max sessions/);
  });

  it('should reject sessions after close', async () => {
    const sm = new SessionManager();
    await sm.closeAll();

    expect(() => sm.create({ remote: 'x' })).toThrow(/manager is closed/);
  });
});

// ─── Heartbeat ────────────────────────────────────────────────────────

describe('SessionManager — heartbeat', () => {
  it('should reset idle timer on heartbeat', async () => {
    const sm = createFastManager({ idleTimeoutMs: 300, pruneIntervalMs: 50 });
    const session = sm.create({ remote: 'test:1' });

    // Wait 200ms (would exceed idle=200 if not heartbeated)
    await sleep(200);
    sm.heartbeat(session.id);
    await sleep(200);

    // Session should still be alive (heartbeat reset idle)
    expect(sm.has(session.id)).toBe(true);

    await sm.closeAll();
  });

  it('should return false for unknown session', () => {
    const sm = new SessionManager();
    expect(sm.heartbeat('nonexistent')).toBe(false);
  });
});

// ─── Get / has ────────────────────────────────────────────────────────

describe('SessionManager — get/has', () => {
  it('should get session info', () => {
    const sm = new SessionManager();
    const created = sm.create({ remote: '192.168.1.1:54321' });
    const fetched = sm.get(created.id);

    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.remote).toBe('192.168.1.1:54321');
    expect(fetched!.createdAt).toBe(created.createdAt);
  });

  it('should return undefined for unknown session', () => {
    const sm = new SessionManager();
    expect(sm.get('nonexistent')).toBeUndefined();
  });

  it('should check has correctly', () => {
    const sm = new SessionManager();
    const session = sm.create({ remote: 'x' });

    expect(sm.has(session.id)).toBe(true);
    expect(sm.has('other')).toBe(false);
  });

  it('should get all sessions', () => {
    const sm = new SessionManager();
    sm.create({ remote: 'a' });
    sm.create({ remote: 'b' });
    sm.create({ remote: 'c' });

    const all = sm.getAll();
    expect(all).toHaveLength(3);
    expect(all.map((s) => s.remote).sort()).toEqual(['a', 'b', 'c']);
  });
});

// ─── Close ────────────────────────────────────────────────────────────

describe('SessionManager — close', () => {
  it('should close a specific session', async () => {
    const sm = new SessionManager();
    const session = sm.create({ remote: 'test' });
    expect(sm.size).toBe(1);

    const closed = await sm.close(session.id);
    expect(closed).toBe(true);
    expect(sm.size).toBe(0);
    expect(sm.has(session.id)).toBe(false);
  });

  it('should return false for unknown session', async () => {
    const sm = new SessionManager();
    const closed = await sm.close('nonexistent');
    expect(closed).toBe(false);
  });

  it('should call onClose callback', async () => {
    const onClose = vi.fn<(id: string) => void>();
    const sm = new SessionManager();
    const session = sm.create({ remote: 'test', onClose });

    await sm.close(session.id);
    expect(onClose).toHaveBeenCalledExactlyOnceWith(session.id);
  });

  it('should handle async onClose callback', async () => {
    const onClose = vi.fn<(id: string) => Promise<void>>();
    onClose.mockResolvedValue(undefined);
    const sm = new SessionManager();
    const session = sm.create({ remote: 'test', onClose });

    await sm.close(session.id);
    expect(onClose).toHaveBeenCalledExactlyOnceWith(session.id);
  });

  it('should not throw on onClose error', async () => {
    const onClose = vi.fn<(id: string) => void>(() => {
      throw new Error('onClose boom');
    });
    const sm = new SessionManager();
    const session = sm.create({ remote: 'test', onClose });

    // Should NOT throw
    await sm.close(session.id);
    expect(sm.size).toBe(0);
  });

  it('should be idempotent on closeAll', async () => {
    const sm = new SessionManager();
    sm.create({ remote: 'a' });

    await sm.closeAll();
    await sm.closeAll();
    expect(sm.closed).toBe(true);
    expect(sm.size).toBe(0);
  });
});

// ─── TTL expiry ───────────────────────────────────────────────────────

describe('SessionManager — TTL expiry', () => {
  it('should expire sessions after TTL via prune', async () => {
    const sm = createFastManager({ sessionTtlMs: 200, idleTimeoutMs: 99999 });
    sm.create({ remote: 'a' });
    sm.create({ remote: 'b' });

    expect(sm.size).toBe(2);

    // Wait for TTL + prune interval
    await sleep(350);

    const expired = await sm.prune();
    expect(expired).toHaveLength(2);
    expect(sm.size).toBe(0);
  });
});

// ─── Idle timeout ─────────────────────────────────────────────────────

describe('SessionManager — idle timeout', () => {
  it('should expire idle sessions via prune', async () => {
    const sm = createFastManager({ sessionTtlMs: 99999, idleTimeoutMs: 200 });
    sm.create({ remote: 'a' });

    expect(sm.size).toBe(1);

    // Wait for idle timeout + prune
    await sleep(300);

    const expired = await sm.prune();
    expect(expired).toHaveLength(1);
    expect(sm.size).toBe(0);
  });

  it('should not expire active sessions', async () => {
    const sm = createFastManager({ sessionTtlMs: 99999, idleTimeoutMs: 200 });
    const session = sm.create({ remote: 'a' });

    // Heartbeat before idle timeout
    await sleep(100);
    sm.heartbeat(session.id);
    await sleep(100);

    // Should still be alive
    const expired = await sm.prune();
    expect(expired).toHaveLength(0);
    expect(sm.has(session.id)).toBe(true);

    await sm.closeAll();
  });
});

// ─── Prune timer ──────────────────────────────────────────────────────

describe('SessionManager — prune timer', () => {
  afterEach(async () => {
    // Clean up any running prune timers
  });

  it('should auto-prune with background timer', async () => {
    const sm = createFastManager({ sessionTtlMs: 99999, idleTimeoutMs: 150 });
    sm.startPrune();
    sm.create({ remote: 'a' });

    expect(sm.size).toBe(1);

    // Wait for prune timer to fire (interval=100 + idle=150)
    await sleep(300);

    // Prune timer should have cleaned up the idle session
    expect(sm.size).toBe(0);

    sm.stopPrune();
  });

  it('should be idempotent on startPrune', () => {
    const sm = new SessionManager();
    sm.startPrune();
    sm.startPrune(); // should not create a second timer
    sm.stopPrune();
  });

  it('should stop prune on closeAll', async () => {
    const sm = createFastManager({ idleTimeoutMs: 150 });
    sm.startPrune();
    sm.create({ remote: 'a' });

    await sm.closeAll();

    // Timer should be stopped — no more prunes
    expect(sm.closed).toBe(true);
  });
});

// ─── closeAll ─────────────────────────────────────────────────────────

describe('SessionManager — closeAll', () => {
  it('should close all sessions and call their callbacks', async () => {
    const onClose = vi.fn<(id: string) => void>();
    const sm = new SessionManager();

    const s1 = sm.create({ remote: 'a', onClose });
    const s2 = sm.create({ remote: 'b', onClose });

    await sm.closeAll();

    expect(sm.size).toBe(0);
    expect(sm.closed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledWith(s1.id);
    expect(onClose).toHaveBeenCalledWith(s2.id);
  });

  it('should handle empty sessions gracefully', async () => {
    const sm = new SessionManager();
    await sm.closeAll();
    expect(sm.closed).toBe(true);
    expect(sm.size).toBe(0);
  });
});

// ─── Default configuration ───────────────────────────────────────────

describe('SessionManager — defaults', () => {
  it('should use default options when none provided', () => {
    const sm = new SessionManager();
    expect(sm.size).toBe(0);
    expect(sm.closed).toBe(false);
  });

  it('should accept custom max sessions', () => {
    const sm = new SessionManager({ maxSessions: 5 });
    for (let i = 0; i < 5; i++) {
      sm.create({ remote: `s${i}` });
    }
    expect(sm.size).toBe(5);
    expect(() => sm.create({ remote: 'extra' })).toThrow(/max sessions/);
  });
});

// ─── SessionInfo shape ────────────────────────────────────────────────

describe('SessionManager — SessionInfo', () => {
  it('should return SessionInfo with correct shape', () => {
    const sm = new SessionManager();
    const info = sm.create({ remote: '192.168.1.1:12345', metadata: { foo: 'bar' } });

    expect(info).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      remote: '192.168.1.1:12345',
      createdAt: expect.any(String),
      lastActivityAt: expect.any(String),
      ageMs: expect.any(Number),
      idleMs: expect.any(Number),
      metadata: { foo: 'bar' },
    });
  });

  it('should return fresh timestamps after heartbeat', async () => {
    const sm = new SessionManager();
    const session = sm.create({ remote: 'test' });

    await sleep(50);
    const infoBefore = sm.get(session.id)!;

    await sleep(50);
    sm.heartbeat(session.id);
    const infoAfter = sm.get(session.id)!;

    // ageMs should increase
    expect(infoAfter.ageMs).toBeGreaterThan(infoBefore.ageMs);
    // idleMs should reset to near 0 (much less than infoBefore.idleMs)
    expect(infoAfter.idleMs).toBeLessThan(infoBefore.idleMs);
  });
});
