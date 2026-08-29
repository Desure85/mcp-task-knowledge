/**
 * core/graceful-degradation.spec.ts — Tests for TD-011 graceful degradation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ServiceAvailability,
  ServiceAvailabilityRegistry,
  withFallback,
} from './graceful-degradation.js';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('TD-011: ServiceAvailability state machine', () => {
  it('starts available', () => {
    const svc = new ServiceAvailability('embeddings');
    expect(svc.availability).toBe('available');
    expect(svc.canExecute()).toBe(true);
  });

  it('degrades to unavailable after failure threshold', () => {
    const svc = new ServiceAvailability('embeddings', {
      circuit: { failureThreshold: 2, resetTimeoutMs: 60_000, halfOpenSuccessThreshold: 1 },
    });
    svc.recordFailure();
    expect(svc.availability).toBe('available'); // threshold not reached
    svc.recordFailure();
    expect(svc.availability).toBe('unavailable');
    expect(svc.canExecute()).toBe(false);
  });

  it('recovers to available after reset', () => {
    const svc = new ServiceAvailability('embeddings', {
      circuit: { failureThreshold: 1, resetTimeoutMs: 60_000, halfOpenSuccessThreshold: 1 },
    });
    svc.recordFailure();
    expect(svc.availability).toBe('unavailable');
    svc.reset();
    expect(svc.availability).toBe('available');
  });

  it('tracks totals and timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T12:00:00Z'));
    const svc = new ServiceAvailability('catalog');
    svc.recordFailure();
    svc.recordFailure();
    svc.recordSuccess();
    const s = svc.state;
    expect(s.totalFailures).toBe(2);
    expect(s.totalSuccesses).toBe(1);
    expect(s.lastFailureAt).toBe(new Date('2026-08-28T12:00:00Z').getTime());
    expect(s.lastSuccessAt).toBe(new Date('2026-08-28T12:00:00Z').getTime());
    vi.useRealTimers();
  });
});

describe('TD-011: withFallback', () => {
  it('returns call result and records success', async () => {
    const svc = new ServiceAvailability('embeddings');
    const result = await withFallback(svc, async () => 42, -1);
    expect(result).toBe(42);
    expect(svc.state.totalSuccesses).toBe(1);
    expect(svc.state.totalFailures).toBe(0);
  });

  it('returns fallback on thrown error and records failure', async () => {
    const svc = new ServiceAvailability('embeddings');
    const result = await withFallback(svc, async () => {
      throw new Error('onnx crashed');
    }, -1);
    expect(result).toBe(-1);
    expect(svc.state.totalFailures).toBe(1);
  });

  it('fast-fails with fallback when circuit is open (no call)', async () => {
    const svc = new ServiceAvailability('embeddings', {
      circuit: { failureThreshold: 1, resetTimeoutMs: 60_000, halfOpenSuccessThreshold: 1 },
    });
    svc.recordFailure(); // open
    const call = vi.fn(async () => 42);
    const result = await withFallback(svc, call, -1);
    expect(result).toBe(-1);
    expect(call).not.toHaveBeenCalled();
  });
});

describe('TD-011: health integration', () => {
  it('maps available to healthy/ready', () => {
    const svc = new ServiceAvailability('embeddings');
    expect(svc.toComponentHealth()).toMatchObject({
      name: 'embeddings',
      status: 'healthy',
      ready: true,
    });
  });

  it('maps unavailable to unhealthy/not-ready with fallback message', () => {
    const svc = new ServiceAvailability('embeddings', {
      circuit: { failureThreshold: 1, resetTimeoutMs: 60_000, halfOpenSuccessThreshold: 1 },
    });
    svc.recordFailure();
    const h = svc.toComponentHealth();
    expect(h.status).toBe('unhealthy');
    expect(h.ready).toBe(false);
    expect(h.message).toBe('fallback in effect');
    expect(h.details?.circuitState).toBe('open');
  });

  it('registry aggregates components for health checker', () => {
    const reg = new ServiceAvailabilityRegistry();
    reg.get('embeddings');
    reg.get('catalog');
    expect(reg.size).toBe(2);
    expect(reg.components().map((c) => c.name).sort()).toEqual(['catalog', 'embeddings']);
    reg.remove('catalog');
    expect(reg.size).toBe(1);
  });
});

describe('TD-011: circuit breaker integration', () => {
  it('reports degraded (half-open) during recovery window', () => {
    vi.useFakeTimers();
    const svc = new ServiceAvailability('ai-models', {
      circuit: { failureThreshold: 1, resetTimeoutMs: 10_000, halfOpenSuccessThreshold: 1 },
    });
    svc.recordFailure(); // open
    expect(svc.availability).toBe('unavailable');
    vi.advanceTimersByTime(10_001); // open → half-open
    expect(svc.availability).toBe('degraded');
    expect(svc.toComponentHealth().status).toBe('degraded');
    vi.useRealTimers();
  });
});

describe('TD-011: process-wide registry singleton (AI-009)', () => {
  it('getServiceAvailabilityRegistry returns the same instance', async () => {
    const { getServiceAvailabilityRegistry, _resetServiceAvailabilityRegistry } = await import('./graceful-degradation.js');
    _resetServiceAvailabilityRegistry();
    const a = getServiceAvailabilityRegistry();
    const b = getServiceAvailabilityRegistry();
    expect(a).toBe(b);
    expect(a.get('embeddings').availability).toBe('available');
    _resetServiceAvailabilityRegistry();
  });

  it('recordFailure through singleton degrades the shared tracker', async () => {
    const { getServiceAvailabilityRegistry, _resetServiceAvailabilityRegistry } = await import('./graceful-degradation.js');
    _resetServiceAvailabilityRegistry();
    const reg = getServiceAvailabilityRegistry();
    const svc = reg.get('embeddings', {
      circuit: { failureThreshold: 1, resetTimeoutMs: 60_000, halfOpenSuccessThreshold: 1 },
    });
    svc.recordFailure();
    expect(svc.availability).toBe('unavailable');
    // Same instance seen from another call site
    expect(getServiceAvailabilityRegistry().get('embeddings').availability).toBe('unavailable');
    _resetServiceAvailabilityRegistry();
  });
});
