/**
 * proxy/resilience.ts — Proxy resilience and observability (P-004).
 *
 * Adds:
 *   - Circuit breaker: trips after N consecutive upstream failures,
 *     fast-fails requests until recovery period elapses
 *   - Proxy metrics: Prometheus counters/gauges for proxy-specific stats
 *   - Health check integration: upstream ping + latency measurement
 *   - Auto-reconnect watcher: monitors upstream connection, triggers
 *     reconnect on disconnect
 *
 * Used by ProxyBootstrap and ProxyForwarder.
 */

import type { Registry, Counter, Gauge } from 'prom-client';
import { childLogger } from '../core/logger.js';

const log = childLogger('proxy:resilience');

// ─── Circuit Breaker ──────────────────────────────────────────────

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

// ─── Proxy Metrics ────────────────────────────────────────────────

interface ProxyMetrics {
  upstreamRequests: Counter<string>;
  upstreamErrors: Counter<string>;
  upstreamReconnects: Counter<string>;
  circuitBreakerState: Gauge<string>;
  upstreamLatencyMs: Gauge<string>;
  forwardedNotifications: Counter<string>;
}

let _proxyMetrics: ProxyMetrics | undefined;

/**
 * Register proxy-specific metrics on an existing Prometheus registry.
 * No-op if registry is undefined (metrics disabled).
 */
export function initProxyMetrics(registry: Registry | undefined): ProxyMetrics | undefined {
  if (!registry) return undefined;
  if (_proxyMetrics) return _proxyMetrics;

  const { Counter, Gauge } = require('prom-client') as typeof import('prom-client');

  _proxyMetrics = {
    upstreamRequests: new Counter({
      name: 'mcp_proxy_upstream_requests_total',
      help: 'Total requests forwarded to upstream',
      labelNames: ['status'] as const,
      registers: [registry],
    }),
    upstreamErrors: new Counter({
      name: 'mcp_proxy_upstream_errors_total',
      help: 'Total upstream errors',
      labelNames: ['type'] as const,
      registers: [registry],
    }),
    upstreamReconnects: new Counter({
      name: 'mcp_proxy_upstream_reconnects_total',
      help: 'Total upstream reconnection attempts',
      labelNames: ['result'] as const,
      registers: [registry],
    }),
    circuitBreakerState: new Gauge({
      name: 'mcp_proxy_circuit_breaker_state',
      help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
      registers: [registry],
    }),
    upstreamLatencyMs: new Gauge({
      name: 'mcp_proxy_upstream_latency_ms',
      help: 'Upstream response latency in milliseconds',
      registers: [registry],
    }),
    forwardedNotifications: new Counter({
      name: 'mcp_proxy_forwarded_notifications_total',
      help: 'Total notifications forwarded from upstream to downstream',
      labelNames: ['type'] as const,
      registers: [registry],
    }),
  };

  return _proxyMetrics;
}

/** Get proxy metrics (undefined if not initialized). */
export function getProxyMetrics(): ProxyMetrics | undefined {
  return _proxyMetrics;
}

/** Reset proxy metrics (for testing). */
export function _resetProxyMetrics(): void {
  _proxyMetrics = undefined;
}

/**
 * Record an upstream request result in metrics.
 */
export function recordUpstreamRequest(status: 'success' | 'error' | 'timeout'): void {
  _proxyMetrics?.upstreamRequests.inc({ status });
  if (status === 'error') {
    _proxyMetrics?.upstreamErrors.inc({ type: 'request_error' });
  } else if (status === 'timeout') {
    _proxyMetrics?.upstreamErrors.inc({ type: 'timeout' });
  }
}

/**
 * Record a reconnect attempt.
 */
export function recordReconnect(result: 'success' | 'failure'): void {
  _proxyMetrics?.upstreamReconnects.inc({ result });
}

/**
 * Update circuit breaker state gauge.
 */
export function recordCircuitBreakerState(state: CircuitState): void {
  const value = state === 'closed' ? 0 : state === 'half-open' ? 1 : 2;
  _proxyMetrics?.circuitBreakerState.set(value);
}

/**
 * Record upstream latency.
 */
export function recordUpstreamLatency(ms: number): void {
  _proxyMetrics?.upstreamLatencyMs.set(ms);
}

/**
 * Record a forwarded notification.
 */
export function recordForwardedNotification(type: string): void {
  _proxyMetrics?.forwardedNotifications.inc({ type });
}

// ─── Upstream Health Watcher ──────────────────────────────────────

export interface WatcherConfig {
  /** Interval between health checks (ms). 0 = disabled. */
  checkIntervalMs: number;
  /** Timeout for health check request (ms). */
  checkTimeoutMs: number;
}

export const DEFAULT_WATCHER_CONFIG: WatcherConfig = {
  checkIntervalMs: 30_000,
  checkTimeoutMs: 5_000,
};

/**
 * Monitors upstream connection health.
 * Periodically checks if upstream is alive and triggers reconnect on failure.
 */
export class UpstreamHealthWatcher {
  private timer?: NodeJS.Timeout;
  private _running = false;
  private _lastCheckAt = 0;
  private _lastLatencyMs = 0;
  private _consecutiveFailures = 0;

  constructor(
    private readonly checkFn: () => Promise<boolean>,
    private readonly onUnhealthy: () => void,
    private readonly config: WatcherConfig = DEFAULT_WATCHER_CONFIG,
  ) {}

  get running(): boolean {
    return this._running;
  }

  get lastLatencyMs(): number {
    return this._lastLatencyMs;
  }

  get consecutiveFailures(): number {
    return this._consecutiveFailures;
  }

  /** Start periodic health checks. */
  start(): void {
    if (this._running || this.config.checkIntervalMs === 0) return;
    this._running = true;
    this.timer = setInterval(() => this.check(), this.config.checkIntervalMs);
    log.info({ intervalMs: this.config.checkIntervalMs }, 'upstream health watcher started');
  }

  /** Stop periodic health checks. */
  stop(): void {
    if (!this._running) return;
    this._running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    log.info('upstream health watcher stopped');
  }

  /** Perform a single health check. */
  async check(): Promise<boolean> {
    this._lastCheckAt = Date.now();
    const start = Date.now();

    try {
      // Race the check against timeout
      const healthy = await Promise.race([
        this.checkFn(),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error('health check timeout')), this.config.checkTimeoutMs),
        ),
      ]);

      this._lastLatencyMs = Date.now() - start;
      recordUpstreamLatency(this._lastLatencyMs);

      if (healthy) {
        this._consecutiveFailures = 0;
      } else {
        this.handleFailure();
      }
      return healthy;
    } catch {
      this._lastLatencyMs = Date.now() - start;
      this.handleFailure();
      return false;
    }
  }

  private handleFailure(): void {
    this._consecutiveFailures++;
    log.warn({ failures: this._consecutiveFailures }, 'upstream health check failed');
    if (this._consecutiveFailures >= 2) {
      log.warn('triggering onUnhealthy callback');
      this.onUnhealthy();
    }
  }

  get stats() {
    return {
      running: this._running,
      lastCheckAt: this._lastCheckAt || undefined,
      lastLatencyMs: this._lastLatencyMs,
      consecutiveFailures: this._consecutiveFailures,
    };
  }
}
