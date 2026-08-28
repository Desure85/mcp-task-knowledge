/**
 * health/checker.ts — Health checker (SCALE-001).
 *
 * Aggregates health from all registered components.
 * Provides liveness, readiness, and drain checks for Kubernetes probes.
 *
 * Endpoints:
 *   - /healthz — liveness (is the process alive and not deadlocked)
 *   - /readyz  — readiness (are all dependencies ready: transport, DB, embeddings)
 *   - /drainz  — drain (stop accepting new sessions, graceful shutdown)
 */

import type { ComponentHealth, HealthCheckFn, HealthCheckResult, HealthStatus } from './types.js';
import { childLogger } from '../core/logger.js';

const log = childLogger('health-checker');

// ─── HealthChecker ────────────────────────────────────────────────

export class HealthChecker {
  private readonly components = new Map<string, HealthCheckFn>();
  private draining = false;
  private startedAt: number;

  constructor() {
    this.startedAt = Date.now();
  }

  /**
   * Register a health check component.
   * @param name — component name (unique)
   * @param fn — check function, returns ComponentHealth
   */
  register(name: string, fn: HealthCheckFn): void {
    this.components.set(name, fn);
    log.debug({ name }, 'health component registered');
  }

  /**
   * Unregister a health check component.
   */
  unregister(name: string): void {
    this.components.delete(name);
  }

  /**
   * Run all registered health checks and aggregate results.
   */
  async check(): Promise<HealthCheckResult> {
    const componentResults: ComponentHealth[] = [];

    for (const [name, fn] of this.components) {
      try {
        const result = await fn();
        componentResults.push(result);
      } catch (err) {
        componentResults.push({
          name,
          status: 'unhealthy',
          ready: false,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Aggregate: worst status wins
    const status = this.aggregateStatus(componentResults);
    const ready = !this.draining && componentResults.every((c) => c.ready);

    return {
      status,
      ready,
      draining: this.draining,
      uptimeMs: Date.now() - this.startedAt,
      timestamp: new Date().toISOString(),
      components: componentResults,
    };
  }

  /**
   * Liveness check — is the process alive?
   * Returns true unless the process is in an error state.
   * Used by /healthz.
   */
  async liveness(): Promise<boolean> {
    const result = await this.check();
    return result.status !== 'unhealthy';
  }

  /**
   * Readiness check — is the server ready to serve requests?
   * Returns true if all components are ready and not draining.
   * Used by /readyz.
   */
  async readiness(): Promise<boolean> {
    const result = await this.check();
    return result.ready;
  }

  /**
   * Start draining — stop accepting new sessions.
   * Existing sessions continue until they finish or are closed.
   */
  startDraining(): void {
    this.draining = true;
    log.info('drain mode activated — no new sessions will be accepted');
  }

  /**
   * Stop draining — resume accepting new sessions.
   */
  stopDraining(): void {
    this.draining = false;
    log.info('drain mode deactivated — accepting new sessions');
  }

  /**
   * Whether the server is currently draining.
   */
  get isDraining(): boolean {
    return this.draining;
  }

  /**
   * Reset start time (for testing).
   */
  resetStartTime(): void {
    this.startedAt = Date.now();
  }

  // ─── Internal ───────────────────────────────────────────────────

  private aggregateStatus(components: ComponentHealth[]): HealthStatus {
    if (components.length === 0) return 'healthy';
    if (components.some((c) => c.status === 'unhealthy')) return 'unhealthy';
    if (components.some((c) => c.status === 'degraded')) return 'degraded';
    return 'healthy';
  }
}
