/**
 * proxy/resilience.spec.ts — Tests for circuit breaker + health watcher (P-004).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CircuitBreaker,
  UpstreamHealthWatcher,
  DEFAULT_CIRCUIT_CONFIG,
  DEFAULT_WATCHER_CONFIG,
  _resetProxyMetrics,
} from './resilience.js';

describe('P-004: CircuitBreaker', () => {
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

describe('P-004: UpstreamHealthWatcher', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts and stops', () => {
    const watcher = new UpstreamHealthWatcher(
      async () => true,
      () => {},
      { checkIntervalMs: 1000, checkTimeoutMs: 100 },
    );
    expect(watcher.running).toBe(false);
    watcher.start();
    expect(watcher.running).toBe(true);
    watcher.stop();
    expect(watcher.running).toBe(false);
  });

  it('does not start when checkIntervalMs is 0', () => {
    const watcher = new UpstreamHealthWatcher(
      async () => true,
      () => {},
      { checkIntervalMs: 0, checkTimeoutMs: 100 },
    );
    watcher.start();
    expect(watcher.running).toBe(false);
  });

  it('records latency on successful check', async () => {
    const watcher = new UpstreamHealthWatcher(
      async () => true,
      () => {},
      { checkIntervalMs: 0, checkTimeoutMs: 1000 },
    );
    const healthy = await watcher.check();
    expect(healthy).toBe(true);
    expect(watcher.lastLatencyMs).toBeGreaterThanOrEqual(0);
    expect(watcher.consecutiveFailures).toBe(0);
  });

  it('increments failures on unhealthy check', async () => {
    const watcher = new UpstreamHealthWatcher(
      async () => false,
      () => {},
      { checkIntervalMs: 0, checkTimeoutMs: 1000 },
    );
    const healthy = await watcher.check();
    expect(healthy).toBe(false);
    expect(watcher.consecutiveFailures).toBe(1);
  });

  it('triggers onUnhealthy after 2 consecutive failures', async () => {
    const onUnhealthy = vi.fn();
    const watcher = new UpstreamHealthWatcher(
      async () => false,
      onUnhealthy,
      { checkIntervalMs: 0, checkTimeoutMs: 1000 },
    );
    await watcher.check();
    expect(onUnhealthy).not.toHaveBeenCalled();
    await watcher.check();
    expect(onUnhealthy).toHaveBeenCalledTimes(1);
  });

  it('handles check timeout', async () => {
    const watcher = new UpstreamHealthWatcher(
      async () => new Promise<boolean>((r) => setTimeout(() => r(true), 200)),
      () => {},
      { checkIntervalMs: 0, checkTimeoutMs: 50 },
    );
    const healthy = await watcher.check();
    expect(healthy).toBe(false);
    expect(watcher.consecutiveFailures).toBe(1);
  });

  it('resets failures on successful check after failures', async () => {
    let isHealthy = false;
    const watcher = new UpstreamHealthWatcher(
      async () => isHealthy,
      () => {},
      { checkIntervalMs: 0, checkTimeoutMs: 1000 },
    );
    await watcher.check();
    expect(watcher.consecutiveFailures).toBe(1);

    isHealthy = true;
    await watcher.check();
    expect(watcher.consecutiveFailures).toBe(0);
  });

  it('stats returns watcher info', async () => {
    const watcher = new UpstreamHealthWatcher(
      async () => true,
      () => {},
      { checkIntervalMs: 0, checkTimeoutMs: 1000 },
    );
    await watcher.check();
    const stats = watcher.stats;
    expect(stats.lastCheckAt).toBeGreaterThan(0);
    expect(stats.lastLatencyMs).toBeGreaterThanOrEqual(0);
    expect(stats.consecutiveFailures).toBe(0);
  });
});

describe('P-004: DEFAULT configs', () => {
  it('DEFAULT_CIRCUIT_CONFIG has sensible values', () => {
    expect(DEFAULT_CIRCUIT_CONFIG.failureThreshold).toBe(5);
    expect(DEFAULT_CIRCUIT_CONFIG.resetTimeoutMs).toBe(10_000);
    expect(DEFAULT_CIRCUIT_CONFIG.halfOpenSuccessThreshold).toBe(2);
  });

  it('DEFAULT_WATCHER_CONFIG has sensible values', () => {
    expect(DEFAULT_WATCHER_CONFIG.checkIntervalMs).toBe(30_000);
    expect(DEFAULT_WATCHER_CONFIG.checkTimeoutMs).toBe(5_000);
  });
});

describe('P-004: Proxy metrics', () => {
  beforeEach(() => {
    _resetProxyMetrics();
  });

  it('initProxyMetrics returns undefined when registry is undefined', () => {
    expect(initProxyMetrics(undefined)).toBeUndefined();
  });

  it('initProxyMetrics creates metrics on registry', () => {
    const { Registry } = require('prom-client') as typeof import('prom-client');
    const registry = new Registry();
    const metrics = initProxyMetrics(registry);
    expect(metrics).toBeDefined();
    expect(metrics?.upstreamRequests).toBeDefined();
    expect(metrics?.upstreamErrors).toBeDefined();
    expect(metrics?.upstreamReconnects).toBeDefined();
  });

  it('getProxyMetrics returns undefined before init', () => {
    _resetProxyMetrics();
    expect(getProxyMetrics()).toBeUndefined();
  });
});

// Import for metrics test
import { initProxyMetrics, getProxyMetrics } from './resilience.js';
