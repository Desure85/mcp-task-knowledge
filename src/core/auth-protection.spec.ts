/**
 * core/auth-protection.spec.ts — Tests for AuthProtection (SEC-005).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthProtection, DEFAULT_AUTH_PROTECTION_OPTIONS } from './auth-protection.js';

describe('SEC-005: AuthProtection', () => {
  let ap: AuthProtection;

  beforeEach(() => {
    ap = new AuthProtection({
      maxAttempts: 3,
      windowMs: 1000,
      baseLockoutMs: 200,
      maxLockoutMs: 1000,
      backoffMultiplier: 2,
      maxLockoutCount: 0,
    });
  });

  describe('check()', () => {
    it('allows first attempt', () => {
      const result = ap.check('ip-1');
      expect(result.allowed).toBe(true);
      expect(result.state.locked).toBe(false);
    });

    it('allows attempts under threshold', () => {
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      const result = ap.check('ip-1');
      expect(result.allowed).toBe(true);
      expect(result.state.failureCount).toBe(2);
    });

    it('blocks after threshold reached', () => {
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      const result = ap.check('ip-1');
      expect(result.allowed).toBe(false);
      expect(result.state.locked).toBe(true);
      expect(result.reason).toContain('locked out');
    });

    it('returns remaining time when locked', () => {
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      const result = ap.check('ip-1');
      expect(result.state.remainingMs).toBeGreaterThan(0);
      expect(result.state.remainingMs).toBeLessThanOrEqual(200);
    });

    it('tracks different identifiers independently', () => {
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      const result1 = ap.check('ip-1');
      const result2 = ap.check('ip-2');
      expect(result1.state.failureCount).toBe(2);
      expect(result2.state.failureCount).toBe(0);
    });
  });

  describe('recordSuccess()', () => {
    it('resets failure count on success', () => {
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      ap.recordSuccess('ip-1');
      const result = ap.check('ip-1');
      expect(result.state.failureCount).toBe(0);
    });

    it('resets lockout count on success', () => {
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      expect(ap.check('ip-1').state.lockoutCount).toBe(1);

      // Wait for lockout to expire
      vi.useFakeTimers();
      vi.advanceTimersByTime(300);
      ap.recordSuccess('ip-1');
      vi.useRealTimers();

      expect(ap.getState('ip-1').lockoutCount).toBe(0);
    });
  });

  describe('recordFailure() — lockout with backoff', () => {
    it('first lockout uses base lockout duration', () => {
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      const state = ap.getState('ip-1');
      expect(state.locked).toBe(true);
      expect(state.remainingMs).toBeLessThanOrEqual(200);
    });

    it('second lockout uses exponential backoff', () => {
      // First lockout
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      expect(ap.getState('ip-1').lockoutCount).toBe(1);

      // Wait for lockout to expire
      vi.useFakeTimers();
      vi.advanceTimersByTime(250);

      // Second lockout
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      const state = ap.getState('ip-1');
      expect(state.lockoutCount).toBe(2);
      // baseLockoutMs * 2^1 = 200 * 2 = 400
      expect(state.remainingMs).toBeLessThanOrEqual(400);
      vi.useRealTimers();
    });

    it('third lockout uses higher backoff', () => {
      vi.useFakeTimers();

      // First lockout
      for (let i = 0; i < 3; i++) ap.recordFailure('ip-1');
      vi.advanceTimersByTime(250);

      // Second lockout
      for (let i = 0; i < 3; i++) ap.recordFailure('ip-1');
      vi.advanceTimersByTime(450);

      // Third lockout
      for (let i = 0; i < 3; i++) ap.recordFailure('ip-1');
      const state = ap.getState('ip-1');
      expect(state.lockoutCount).toBe(3);
      // baseLockoutMs * 2^2 = 200 * 4 = 800
      expect(state.remainingMs).toBeLessThanOrEqual(800);

      vi.useRealTimers();
    });

    it('lockout duration is capped at maxLockoutMs', () => {
      vi.useFakeTimers();

      // Keep locking out until we hit the cap
      for (let lockout = 0; lockout < 10; lockout++) {
        for (let i = 0; i < 3; i++) ap.recordFailure('ip-1');
        const state = ap.getState('ip-1');
        expect(state.remainingMs).toBeLessThanOrEqual(1000); // maxLockoutMs
        vi.advanceTimersByTime(state.remainingMs + 50);
      }

      vi.useRealTimers();
    });

    it('does not record failures during active lockout', () => {
      // Trigger lockout
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      expect(ap.getState('ip-1').failureCount).toBe(3);

      // These should be ignored
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      expect(ap.getState('ip-1').failureCount).toBe(3);
    });
  });

  describe('permanent ban', () => {
    it('permanently bans after maxLockoutCount', () => {
      const ap2 = new AuthProtection({
        maxAttempts: 2,
        windowMs: 1000,
        baseLockoutMs: 100,
        maxLockoutMs: 1000,
        backoffMultiplier: 2,
        maxLockoutCount: 3,
      });

      vi.useFakeTimers();

      for (let lockout = 0; lockout < 3; lockout++) {
        ap2.recordFailure('ip-1');
        ap2.recordFailure('ip-1');
        vi.advanceTimersByTime(200);
      }

      // Next lockout should trigger permanent ban
      ap2.recordFailure('ip-1');
      ap2.recordFailure('ip-1');

      const state = ap2.getState('ip-1');
      expect(state.permanentlyBanned).toBe(true);
      expect(state.locked).toBe(true);

      vi.useRealTimers();
    });

    it('permanent ban is not lifted by time', () => {
      const ap2 = new AuthProtection({
        maxAttempts: 1,
        baseLockoutMs: 10,
        maxLockoutMs: 100,
        maxLockoutCount: 1,
      });

      ap2.recordFailure('ip-1');
      expect(ap2.getState('ip-1').permanentlyBanned).toBe(true);

      // Wait a long time
      vi.useFakeTimers();
      vi.advanceTimersByTime(10000);
      expect(ap2.getState('ip-1').permanentlyBanned).toBe(true);
      expect(ap2.check('ip-1').allowed).toBe(false);
      vi.useRealTimers();
    });
  });

  describe('unlock()', () => {
    it('manually unlocks an identifier', () => {
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      expect(ap.check('ip-1').allowed).toBe(false);

      const result = ap.unlock('ip-1');
      expect(result).toBe(true);
      expect(ap.check('ip-1').allowed).toBe(true);
    });

    it('clears permanent ban on unlock', () => {
      const ap2 = new AuthProtection({
        maxAttempts: 1,
        maxLockoutCount: 1,
      });
      ap2.recordFailure('ip-1');
      expect(ap2.getState('ip-1').permanentlyBanned).toBe(true);

      ap2.unlock('ip-1');
      expect(ap2.getState('ip-1').permanentlyBanned).toBe(false);
    });

    it('returns false for unknown identifier', () => {
      expect(ap.unlock('unknown')).toBe(false);
    });
  });

  describe('getState()', () => {
    it('returns state for unknown identifier with zero values', () => {
      const state = ap.getState('unknown');
      expect(state.failureCount).toBe(0);
      expect(state.locked).toBe(false);
      expect(state.lockoutCount).toBe(0);
    });
  });

  describe('trackedCount and lockedCount', () => {
    it('tracks count of identifiers', () => {
      ap.check('ip-1');
      ap.check('ip-2');
      expect(ap.trackedCount).toBe(2);
    });

    it('counts locked identifiers', () => {
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-2');
      ap.recordFailure('ip-2');
      ap.recordFailure('ip-2');
      expect(ap.lockedCount).toBe(2);
    });
  });

  describe('cleanup()', () => {
    it('removes inactive identifiers', () => {
      ap.recordFailure('ip-1');
      vi.useFakeTimers();
      vi.advanceTimersByTime(2000); // past windowMs
      const cleaned = ap.cleanup();
      expect(cleaned).toBe(1);
      expect(ap.trackedCount).toBe(0);
      vi.useRealTimers();
    });

    it('does not remove locked identifiers', () => {
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      vi.useFakeTimers();
      vi.advanceTimersByTime(100); // still locked (baseLockoutMs=200)
      const cleaned = ap.cleanup();
      expect(cleaned).toBe(0);
      vi.useRealTimers();
    });
  });

  describe('reset()', () => {
    it('clears all state', () => {
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      expect(ap.trackedCount).toBe(1);

      ap.reset();
      expect(ap.trackedCount).toBe(0);
      expect(ap.check('ip-1').allowed).toBe(true);
    });
  });

  describe('window-based failure counting', () => {
    it('failures outside window are not counted', () => {
      vi.useFakeTimers();

      ap.recordFailure('ip-1');
      ap.recordFailure('ip-1');
      vi.advanceTimersByTime(1100); // past window

      ap.recordFailure('ip-1');
      const state = ap.getState('ip-1');
      // Only 1 failure in current window
      expect(state.failureCount).toBe(1);

      vi.useRealTimers();
    });
  });

  describe('DEFAULT_AUTH_PROTECTION_OPTIONS', () => {
    it('has sensible defaults', () => {
      expect(DEFAULT_AUTH_PROTECTION_OPTIONS.maxAttempts).toBe(5);
      expect(DEFAULT_AUTH_PROTECTION_OPTIONS.windowMs).toBe(60_000);
      expect(DEFAULT_AUTH_PROTECTION_OPTIONS.baseLockoutMs).toBe(30_000);
      expect(DEFAULT_AUTH_PROTECTION_OPTIONS.maxLockoutMs).toBe(3_600_000);
      expect(DEFAULT_AUTH_PROTECTION_OPTIONS.backoffMultiplier).toBe(2);
    });
  });
});
