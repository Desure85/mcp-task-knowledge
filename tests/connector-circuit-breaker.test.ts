/**
 * TR-34: connector calls must go through a per-connector ServiceAvailability
 * circuit, fast-fail while open, and expose a health component.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConnectorRegistry } from '../src/connectors/registry.js';
import {
  _resetServiceAvailabilityRegistry,
  getServiceAvailabilityRegistry,
} from '../src/core/graceful-degradation.js';
import type { Connector } from '../src/connectors/types.js';

type Handler = (input: Record<string, unknown>) => Promise<unknown>;

let fail = true;
const calls: number[] = [];

function fakeConnector(): Connector {
  return {
    id: 'fake',
    name: 'Fake API',
    version: '1.0.0',
    async init(ctx) {
      ctx.registerTool('fake_op', { description: 'fake' }, async () => {
        calls.push(Date.now());
        if (fail) throw new Error('upstream boom');
        return { ok: true };
      });
    },
    async health() {
      return { healthy: true };
    },
  };
}

beforeEach(() => {
  _resetServiceAvailabilityRegistry();
  fail = true;
  calls.length = 0;
});

afterEach(() => {
  _resetServiceAvailabilityRegistry();
});

describe('TR-34 connector circuit breaker', () => {
  it('opens after failures, fast-fails, recovers in half-open and exposes health', async () => {
    const registry = new ConnectorRegistry();
    registry.register({ id: 'fake', factory: () => fakeConnector(), enabledByDefault: true });
    const service = getServiceAvailabilityRegistry().get('connector:fake', {
      circuit: { failureThreshold: 2, resetTimeoutMs: 50, halfOpenSuccessThreshold: 2 },
    });

    const tools = new Map<string, Handler>();
    const result = await registry.initAll(
      { fake: { enabled: true } },
      (name, _schema, handler) => tools.set(name, handler),
    );
    expect(result.initialized).toEqual(['fake']);
    const handler = tools.get('fake_op')!;

    await expect(handler({})).rejects.toThrow('upstream boom');
    await expect(handler({})).rejects.toThrow('upstream boom');
    expect(service.state.availability).toBe('unavailable');
    expect(calls).toHaveLength(2);

    await expect(handler({})).rejects.toThrow('circuit open');
    expect(calls).toHaveLength(2);
    expect(service.toComponentHealth()).toMatchObject({ name: 'connector:fake', status: 'unhealthy', ready: false });

    fail = false;
    await new Promise((resolve) => setTimeout(resolve, 60));
    await expect(handler({})).resolves.toEqual({ ok: true });
    await expect(handler({})).resolves.toEqual({ ok: true });
    expect(service.state.circuitState).toBe('closed');
    expect(service.toComponentHealth().status).toBe('healthy');
  });

  it('does not open on success', async () => {
    fail = false;
    const registry = new ConnectorRegistry();
    registry.register({ id: 'fake', factory: () => fakeConnector(), enabledByDefault: true });
    const service = getServiceAvailabilityRegistry().get('connector:fake', {
      circuit: { failureThreshold: 1, resetTimeoutMs: 50, halfOpenSuccessThreshold: 1 },
    });
    const tools = new Map<string, Handler>();
    await registry.initAll({ fake: { enabled: true } }, (name, _schema, handler) => tools.set(name, handler));

    await expect(tools.get('fake_op')!({})).resolves.toEqual({ ok: true });
    expect(service.state.availability).toBe('available');
    expect(service.state.totalSuccesses).toBe(1);
  });
});
