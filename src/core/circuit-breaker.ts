/**
 * core/circuit-breaker.ts — Circuit breaker pattern (TD-011)
 *
 * Extracted from proxy/resilience.ts (P-004) so the core layer can guard
 * optional services (embeddings, catalog, AI) without depending on the
 * proxy module. proxy/resilience.ts re-exports for backward compatibility.
 *
 * State machine:
 *   closed ──(N consecutive failures)──▶ open ──(reset timeout)──▶ half-open
 *   half-open ──(success × threshold)──▶ closed
 *   half-open ──(any failure)──────────▶ open
 */

import { childLogger } from './logger.js';

const log = childLogger('circuit-breaker');

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening circuit. */
  failureThreshold: number;
  /** Time in ms to wait before trying again (half-open state). */
  resetTimeoutMs: number;
  /** Number of successes in half-open before closing circuit. */
  halfOpenSuccessThreshold: number;
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 10_000,
  halfOpenSuccessThreshold: 2,
};

/**
 * Circuit breaker for upstream connection.
 * - closed: requests pass through normally
 * - open: requests fast-fail (upstream is down)
 * - half-open: limited requests pass through to test recovery
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private openedAt = 0;

  constructor(private readonly config: CircuitBreakerConfig = DEFAULT_CIRCUIT_CONFIG) {}

  get currentState(): CircuitState {
    // Auto-transition from open → half-open after reset timeout
    if (this.state === 'open' && Date.now() - this.openedAt >= this.config.resetTimeoutMs) {
      this.state = 'half-open';
      this.successCount = 0;
      log.info('circuit breaker: open → half-open (reset timeout elapsed)');
    }
    return this.state;
  }

  /** Whether requests should be allowed through. */
  canExecute(): boolean {
    const state = this.currentState;
    return state === 'closed' || state === 'half-open';
  }

  /** Record a successful request. */
  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.config.halfOpenSuccessThreshold) {
        this.state = 'closed';
        this.failureCount = 0;
        log.info('circuit breaker: half-open → closed (recovered)');
      }
    } else if (this.state === 'closed') {
      this.failureCount = 0;
    }
  }

  /** Record a failed request. */
  recordFailure(): void {
    this.failureCount++;

    if (this.state === 'half-open') {
      // Failure in half-open → back to open
      this.state = 'open';
      this.openedAt = Date.now();
      log.warn('circuit breaker: half-open → open (failure during recovery)');
    } else if (this.state === 'closed' && this.failureCount >= this.config.failureThreshold) {
      this.state = 'open';
      this.openedAt = Date.now();
      log.warn({ failures: this.failureCount }, 'circuit breaker: closed → open');
    }
  }

  /** Reset to closed state (e.g., on successful reconnect). */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
  }

  get stats() {
    return {
      state: this.currentState,
      failureCount: this.failureCount,
      successCount: this.successCount,
      openedAt: this.openedAt || undefined,
    };
  }
}
