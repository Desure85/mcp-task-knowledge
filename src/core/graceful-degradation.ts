/**
 * core/graceful-degradation.ts — Optional-service availability tracking (TD-011)
 *
 * Wraps the codebase's existing "undefined = unavailable" convention into a
 * typed tracker: each optional service (embeddings, catalog, AI models) has
 * an availability state that degrades automatically on repeated failures and
 * recovers on success, plus a fallback wrapper that returns a default value
 * instead of throwing when the service is unavailable.
 *
 * Health integration: availability maps to the health module's
 * ComponentHealth (healthy / degraded / unhealthy) for /healthz reporting.
 */

import { childLogger } from './logger.js';
import { CircuitBreaker, DEFAULT_CIRCUIT_CONFIG } from './circuit-breaker.js';
import type { CircuitBreakerConfig, CircuitState } from './circuit-breaker.js';
import type { ComponentHealth, HealthStatus } from '../health/types.js';

const log = childLogger('graceful-degradation');

// ─── Availability state ────────────────────────────────────────────

/**
 * Availability of one optional service.
 * - available: usable (or never failed)
 * - degraded: failing, circuit tripping — use fallback
 * - unavailable: circuit open — do not call, use fallback
 */
export type Availability = 'available' | 'degraded' | 'unavailable';

export interface ServiceAvailabilityOptions {
  /** Circuit breaker config controlling degradation thresholds. */
  circuit?: CircuitBreakerConfig;
  /** Human-readable service name for logs/health (default: key). */
  label?: string;
}

/** Live state of a tracked service. */
export interface ServiceState {
  availability: Availability;
  circuitState: CircuitState;
  consecutiveFailures: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  totalFailures: number;
  totalSuccesses: number;
}

/**
 * Tracks availability of one optional service.
 * Failures count against a per-service circuit breaker; repeated failures
 * move the service through available → degraded → unavailable, successes
 * recover it. Never throws.
 */
export class ServiceAvailability {
  readonly name: string;
  private readonly label: string;
  private readonly circuit: CircuitBreaker;
  private lastFailureAt?: number;
  private lastSuccessAt?: number;
  private totalFailures = 0;
  private totalSuccesses = 0;

  constructor(name: string, options: ServiceAvailabilityOptions = {}) {
    this.name = name;
    this.label = options.label ?? name;
    this.circuit = new CircuitBreaker(options.circuit ?? DEFAULT_CIRCUIT_CONFIG);
  }

  /** Whether the service may be called. */
  canExecute(): boolean {
    return this.circuit.canExecute();
  }

  /** Record a successful call (recovers the circuit). */
  recordSuccess(): void {
    this.circuit.recordSuccess();
    this.totalSuccesses++;
    this.lastSuccessAt = Date.now();
  }

  /** Record a failed call (degrades the circuit). */
  recordFailure(): void {
    this.circuit.recordFailure();
    this.totalFailures++;
    this.lastFailureAt = Date.now();
    const s = this.circuit.stats;
    if (s.state === 'open') {
      log.warn({ service: this.name, failures: s.failureCount }, `${this.label} unavailable — fallback in effect`);
    } else if (s.state === 'half-open') {
      log.warn({ service: this.name }, `${this.label} degraded — probing recovery`);
    }
  }

  /** Force reset to available (e.g. configuration change). */
  reset(): void {
    this.circuit.reset();
  }

  /** Current availability derived from circuit state. */
  get availability(): Availability {
    switch (this.circuit.currentState) {
      case 'open':
        return 'unavailable';
      case 'half-open':
        return 'degraded';
      default:
        return 'available';
    }
  }

  /** Full live state for observability. */
  get state(): ServiceState {
    const s = this.circuit.stats;
    return {
      availability: this.availability,
      circuitState: s.state,
      consecutiveFailures: s.failureCount,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    };
  }

  /** Health component for the health checker. */
  toComponentHealth(): ComponentHealth {
    const state = this.state;
    let status: HealthStatus;
    let message: string | undefined;
    let ready = true;

    switch (state.availability) {
      case 'available':
        status = 'healthy';
        break;
      case 'degraded':
        status = 'degraded';
        message = 'recovering after failures';
        ready = true;
        break;
      case 'unavailable':
        status = 'unhealthy';
        message = 'fallback in effect';
        ready = false;
        break;
    }

    const details: Record<string, unknown> = {
      circuitState: state.circuitState,
      consecutiveFailures: state.consecutiveFailures,
      totalFailures: state.totalFailures,
      totalSuccesses: state.totalSuccesses,
    };
    if (state.lastFailureAt) details.lastFailureAt = new Date(state.lastFailureAt).toISOString();

    return { name: this.name, status, ready, message, details };
  }
}

// ─── Registry ──────────────────────────────────────────────────────

// Process-wide registry singleton (like metrics.ts) so tool handlers can
// record availability without plumbing the registry through ServerContext.
let _registry: ServiceAvailabilityRegistry | undefined;

/**
 * Get (or create) the process-wide service availability registry.
 * Safe to call from any module; AppContainer registers its trackers here.
 */
export function getServiceAvailabilityRegistry(): ServiceAvailabilityRegistry {
  if (!_registry) _registry = new ServiceAvailabilityRegistry();
  return _registry;
}

/** Reset the singleton (testing only). */
export function _resetServiceAvailabilityRegistry(): void {
  _registry = undefined;
}

/**
 * Registry of optional-service availability trackers.
 * Convenience for wiring many services into health checks at once.
 */
export class ServiceAvailabilityRegistry {
  private readonly services = new Map<string, ServiceAvailability>();

  /** Get or create a tracker for the given service. */
  get(name: string, options: ServiceAvailabilityOptions = {}): ServiceAvailability {
    let svc = this.services.get(name);
    if (!svc) {
      svc = new ServiceAvailability(name, options);
      this.services.set(name, svc);
    }
    return svc;
  }

  /** Remove a tracker (e.g. on shutdown). */
  remove(name: string): boolean {
    return this.services.delete(name);
  }

  /** All tracked states, keyed by service name. */
  states(): Record<string, ServiceState> {
    const out: Record<string, ServiceState> = {};
    for (const [name, svc] of this.services) out[name] = svc.state;
    return out;
  }

  /** Health components for every tracked service. */
  components(): ComponentHealth[] {
    return [...this.services.values()].map((svc) => svc.toComponentHealth());
  }

  get size(): number {
    return this.services.size;
  }
}

// ─── Fallback wrapper ──────────────────────────────────────────────

/**
 * Execute a call with graceful degradation: when the service is unavailable
 * (circuit open) or the call throws, return fallbackValue instead of
 * propagating. Successful calls and failures are recorded on the tracker.
 *
 * @param availability — the service tracker to record against
 * @param call — the actual service call
 * @param fallbackValue — value returned on unavailable/failure
 */
export async function withFallback<T>(
  availability: ServiceAvailability,
  call: () => Promise<T>,
  fallbackValue: T,
): Promise<T> {
  if (!availability.canExecute()) {
    return fallbackValue;
  }
  try {
    const result = await call();
    availability.recordSuccess();
    return result;
  } catch {
    availability.recordFailure();
    return fallbackValue;
  }
}
