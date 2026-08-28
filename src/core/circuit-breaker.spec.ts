/**
 * core/circuit-breaker.spec.ts — Tests for circuit breaker (TD-011).
 * Moved from proxy/resilience.spec.ts (P-004) together with the class.
 */

import { describe, it, expect } from 'vitest';
import { CircuitBreaker, DEFAULT_CIRCUIT_CONFIG } from './circuit-breaker.js';

describe('TD-011: CircuitBreaker', () => {
  it('starts in closed state', () => {
    const cb = new CircuitBreaker();
    expect(cb.currentState).toBe('closed');
    expect(cb.canExecute()).toBe(true);
  });

  it('opens after failure threshold', () => {
    const cb = new CircuitBreaker({ ...DEFAULT_CIRCUIT_CONFIG, failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.currentState).toBe('closed'); // not yet
    cb.recordFailure();
    expect(cb.currentState).toBe('open');
    expect(cb.canExecute()).toBe(false);
  });

  it('resets failure count on success in closed state', () => {
    const cb = new CircuitBreaker({ ...DEFAULT_CIRCUIT_CONFIG, failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    cb.recordFailure();
    expect(cb.currentState).toBe('closed'); // only 1 failure after reset
  });

  it('transitions open → half-open after reset timeout', async () => {
    const cb = new CircuitBreaker({
      ...DEFAULT_CIRCUIT_CONFIG,
      failureThreshold: 1,
      resetTimeoutMs: 50,
    });
    cb.recordFailure();
    expect(cb.currentState).toBe('open');

    await new Promise((r) => setTimeout(r, 60));
    expect(cb.currentState).toBe('half-open');
    expect(cb.canExecute()).toBe(true);
  });

  it('closes after enough successes in half-open', async () => {
    const cb = new CircuitBreaker({
      ...DEFAULT_CIRCUIT_CONFIG,
      failureThreshold: 1,
      resetTimeoutMs: 50,
      halfOpenSuccessThreshold: 2,
    });
    cb.recordFailure();
    await new Promise((r) => setTimeout(r, 60));

    expect(cb.currentState).toBe('half-open');
    cb.recordSuccess();
    expect(cb.currentState).toBe('half-open'); // need 2
    cb.recordSuccess();
    expect(cb.currentState).toBe('closed');
  });

  it('goes back to open on failure in half-open', async () => {
    const cb = new CircuitBreaker({
      ...DEFAULT_CIRCUIT_CONFIG,
      failureThreshold: 1,
      resetTimeoutMs: 50,
    });
    cb.recordFailure();
    await new Promise((r) => setTimeout(r, 60));

    expect(cb.currentState).toBe('half-open');
    cb.recordFailure();
    expect(cb.currentState).toBe('open');
  });

  it('reset() forces closed state', () => {
    const cb = new CircuitBreaker({ ...DEFAULT_CIRCUIT_CONFIG, failureThreshold: 1 });
    cb.recordFailure();
    expect(cb.currentState).toBe('open');
    cb.reset();
    expect(cb.currentState).toBe('closed');
    expect(cb.canExecute()).toBe(true);
  });

  it('stats returns current state info', () => {
    const cb = new CircuitBreaker({ ...DEFAULT_CIRCUIT_CONFIG, failureThreshold: 2 });
    cb.recordFailure();
    expect(cb.stats.failureCount).toBe(1);
    expect(cb.stats.state).toBe('closed');
  });
});
