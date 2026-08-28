/**
 * core/auth-protection.ts — Authentication protection (SEC-005).
 *
 * Rate-limiting and lockout for mcp.authenticate attempts.
 * Prevents brute-force attacks on authentication.
 *
 * Features:
 *   - Rate limit: max N attempts per time window per IP/session
 *   - Lockout: after N consecutive failures, block for cooldown period
 *   - Exponential backoff: each subsequent lockout is longer
 *   - IP-based and session-based tracking
 *   - Automatic unlock after cooldown expires
 *
 * Usage:
 *   const protection = new AuthProtection({ maxAttempts: 5, windowMs: 60_000 });
 *
 *   // Before authenticate:
 *   const check = protection.check(identifier);
 *   if (check.locked) return deny;
 *
 *   // After authenticate:
 *   protection.recordSuccess(identifier);
 *   // or
 *   protection.recordFailure(identifier);
 */

import { childLogger } from './logger.js';

const log = childLogger('auth-protection');

// ─── Types ────────────────────────────────────────────────────────

export interface AuthProtectionOptions {
  /** Max attempts within the window before lockout. Default: 5. */
  maxAttempts?: number;
  /** Time window for attempt counting (ms). Default: 60_000 (1 min). */
  windowMs?: number;
  /** Base lockout duration (ms). Default: 30_000 (30 sec). */
  baseLockoutMs?: number;
  /** Max lockout duration (ms). Default: 3_600_000 (1 hour). */
  maxLockoutMs?: number;
  /** Backoff multiplier for consecutive lockouts. Default: 2. */
  backoffMultiplier?: number;
  /** Max consecutive lockouts before permanent ban. 0 = no permanent ban. Default: 0. */
  maxLockoutCount?: number;
}

export const DEFAULT_AUTH_PROTECTION_OPTIONS: Required<AuthProtectionOptions> = {
  maxAttempts: 5,
  windowMs: 60_000,
  baseLockoutMs: 30_000,
  maxLockoutMs: 3_600_000,
  backoffMultiplier: 2,
  maxLockoutCount: 0,
};

export interface ProtectionState {
  /** Whether this identifier is currently locked out. */
  locked: boolean;
  /** Lockout expiry timestamp (ms since epoch). 0 if not locked. */
  lockoutExpiresAt: number;
  /** Number of failed attempts in the current window. */
  failureCount: number;
  /** Number of consecutive lockouts (for backoff). */
  lockoutCount: number;
  /** Whether permanently banned. */
  permanentlyBanned: boolean;
  /** Remaining ms until lockout expires (0 if not locked). */
  remainingMs: number;
}

export interface CheckResult {
  /** Whether the attempt is allowed (not locked/banned). */
  allowed: boolean;
  /** Current state for this identifier. */
  state: ProtectionState;
  /** Reason if not allowed. */
  reason?: string;
}

// ─── AuthProtection ───────────────────────────────────────────────

interface IdentifierState {
  failures: number[]; // timestamps of recent failures
  lockoutCount: number;
  lockedUntil: number;
  permanentlyBanned: boolean;
}

export class AuthProtection {
  private readonly options: Required<AuthProtectionOptions>;
  private readonly states = new Map<string, IdentifierState>();

  constructor(options?: AuthProtectionOptions) {
    this.options = { ...DEFAULT_AUTH_PROTECTION_OPTIONS, ...options };
  }

  /**
   * Check if an auth attempt is allowed for the given identifier.
   * Does not record a failure — call recordFailure() on auth failure.
   *
   * @param identifier — IP address or session ID
   * @returns CheckResult with allowed flag and state
   */
  check(identifier: string): CheckResult {
    const state = this.getOrCreateState(identifier);
    const now = Date.now();

    // Check permanent ban
    if (state.permanentlyBanned) {
      return {
        allowed: false,
        state: this.buildState(state, now),
        reason: 'permanently banned',
      };
    }

    // Check if locked out
    if (state.lockedUntil > now) {
      const remaining = state.lockedUntil - now;
      return {
        allowed: false,
        state: this.buildState(state, now),
        reason: `locked out — retry in ${Math.ceil(remaining / 1000)}s`,
      };
    }

    // Check if lockout just expired — reset failure window
    if (state.lockedUntil > 0 && state.lockedUntil <= now) {
      state.failures = state.failures.filter((t) => t > now - this.options.windowMs);
    }

    // Count recent failures
    const recentFailures = state.failures.filter((t) => t > now - this.options.windowMs);

    return {
      allowed: true,
      state: this.buildState(state, now),
    };
  }

  /**
   * Record a successful authentication.
   * Resets failure count and lockout count for this identifier.
   */
  recordSuccess(identifier: string): void {
    const state = this.states.get(identifier);
    if (state) {
      state.failures = [];
      state.lockoutCount = 0;
      state.lockedUntil = 0;
    }
  }

  /**
   * Record a failed authentication attempt.
   * If failure count exceeds threshold, triggers lockout with exponential backoff.
   */
  recordFailure(identifier: string): void {
    const state = this.getOrCreateState(identifier);
    const now = Date.now();

    // Don't record failures during lockout
    if (state.lockedUntil > now || state.permanentlyBanned) return;

    // Add failure timestamp
    state.failures.push(now);

    // Clean old failures
    state.failures = state.failures.filter((t) => t > now - this.options.windowMs);

    // Check if we need to lock out
    if (state.failures.length >= this.options.maxAttempts) {
      state.lockoutCount++;

      // Check for permanent ban
      if (this.options.maxLockoutCount > 0 && state.lockoutCount >= this.options.maxLockoutCount) {
        state.permanentlyBanned = true;
        state.lockedUntil = Number.MAX_SAFE_INTEGER;
        log.warn({ identifier, lockoutCount: state.lockoutCount }, 'permanently banned');
        return;
      }

      // Calculate lockout duration with exponential backoff
      const backoffPower = state.lockoutCount - 1;
      const lockoutMs = Math.min(
        this.options.baseLockoutMs * Math.pow(this.options.backoffMultiplier, backoffPower),
        this.options.maxLockoutMs,
      );

      state.lockedUntil = now + lockoutMs;
      log.warn(
        { identifier, failures: state.failures.length, lockoutMs, lockoutCount: state.lockoutCount },
        'identifier locked out',
      );
    }
  }

  /**
   * Manually unlock an identifier (admin action).
   */
  unlock(identifier: string): boolean {
    const state = this.states.get(identifier);
    if (!state) return false;

    state.lockedUntil = 0;
    state.failures = [];
    state.lockoutCount = 0;
    state.permanentlyBanned = false;
    log.info({ identifier }, 'identifier manually unlocked');
    return true;
  }

  /**
   * Get current state for an identifier (read-only).
   */
  getState(identifier: string): ProtectionState {
    const state = this.getOrCreateState(identifier);
    return this.buildState(state, Date.now());
  }

  /**
   * Get count of tracked identifiers.
   */
  get trackedCount(): number {
    return this.states.size;
  }

  /**
   * Get count of currently locked identifiers.
   */
  get lockedCount(): number {
    const now = Date.now();
    let count = 0;
    for (const state of this.states.values()) {
      if (state.lockedUntil > now || state.permanentlyBanned) count++;
    }
    return count;
  }

  /**
   * Clean up expired states (identifiers with no recent activity and no active lockout).
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, state] of this.states) {
      if (
        state.lockedUntil <= now &&
        !state.permanentlyBanned &&
        state.failures.every((t) => t <= now - this.options.windowMs)
      ) {
        this.states.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log.info({ cleaned }, 'auth protection cleanup');
    }
    return cleaned;
  }

  /**
   * Reset all state (for testing or admin reset).
   */
  reset(): void {
    this.states.clear();
  }

  // ─── Internal ───────────────────────────────────────────────────

  private getOrCreateState(identifier: string): IdentifierState {
    let state = this.states.get(identifier);
    if (!state) {
      state = {
        failures: [],
        lockoutCount: 0,
        lockedUntil: 0,
        permanentlyBanned: false,
      };
      this.states.set(identifier, state);
    }
    return state;
  }

  private buildState(state: IdentifierState, now: number): ProtectionState {
    const locked = state.permanentlyBanned || state.lockedUntil > now;
    const recentFailures = state.failures.filter((t) => t > now - this.options.windowMs);

    return {
      locked,
      lockoutExpiresAt: state.permanentlyBanned ? Number.MAX_SAFE_INTEGER : state.lockedUntil,
      failureCount: recentFailures.length,
      lockoutCount: state.lockoutCount,
      permanentlyBanned: state.permanentlyBanned,
      remainingMs: locked ? Math.max(0, state.lockedUntil - now) : 0,
    };
  }
}
