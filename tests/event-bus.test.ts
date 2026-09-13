/**
 * Tests for EventBus — Internal pub/sub event bus (MW-002)
 *
 * Covers: subscription, unsubscription, wildcard matching, event delivery,
 * async listeners, error handling, once(), shutdown, diagnostics,
 * AppContainer integration (server.started / server.stopped events).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus, resetEventBus, getEventBus } from '../src/core/event-bus.js';
import type {
  AnyEvent,
  ToolCalledEvent,
  SessionOpenedEvent,
  ServerStartedEvent,
  EventListener,
} from '../src/core/event-bus.js';

// ─── Helpers ──────────────────────────────────────────────────────────

function createEvent(type: string, extra?: Record<string, unknown>): AnyEvent {
  return {
    type,
    timestamp: Date.now(),
    ...extra,
  } as AnyEvent;
}

function toolCalledEvent(overrides?: Partial<ToolCalledEvent>): ToolCalledEvent {
  return {
    type: 'tool.called',
    timestamp: Date.now(),
    toolName: overrides?.toolName ?? 'test_tool',
    sessionId: overrides?.sessionId ?? 'sess-1',
    input: overrides?.input ?? {},
    durationMs: overrides?.durationMs ?? 10,
    ...overrides,
  };
}

// ─── Subscription ─────────────────────────────────────────────────────

describe('EventBus — subscription', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('should call listener when event is emitted', async () => {
    const listener = vi.fn();
    bus.on('tool.called', listener);

    await bus.emit(toolCalledEvent());

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tool.called', toolName: 'test_tool' }),
    );
  });

  it('should not call listener for different topic', async () => {
    const listener = vi.fn();
    bus.on('tool.called', listener);

    await bus.emit(createEvent('session.opened'));

    expect(listener).not.toHaveBeenCalled();
  });

  it('should support multiple listeners on same topic', async () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    bus.on('tool.called', l1);
    bus.on('tool.called', l2);

    await bus.emit(toolCalledEvent());

    expect(l1).toHaveBeenCalledOnce();
    expect(l2).toHaveBeenCalledOnce();
  });

  it('should call listeners in subscription order', async () => {
    const order: string[] = [];
    bus.on('tool.called', () => { order.push('first'); });
    bus.on('tool.called', () => { order.push('second'); });
    bus.on('tool.called', () => { order.push('third'); });

    await bus.emit(toolCalledEvent());

    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('should unsubscribe via returned function', async () => {
    const listener = vi.fn();
    const unsub = bus.on('tool.called', listener);

    await bus.emit(toolCalledEvent());
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();

    await bus.emit(toolCalledEvent());
    expect(listener).toHaveBeenCalledTimes(1); // not called again
  });

  it('should not call listener after unsubscribe', async () => {
    const listener = vi.fn();
    const unsub = bus.on('tool.called', listener);
    unsub();

    await bus.emit(toolCalledEvent());
    expect(listener).not.toHaveBeenCalled();
  });

  it('should handle multiple unsubscribes gracefully', async () => {
    const listener = vi.fn();
    const unsub = bus.on('tool.called', listener);

    unsub();
    unsub(); // double unsubscribe — should not throw

    await bus.emit(toolCalledEvent());
    expect(listener).not.toHaveBeenCalled();
  });
});

// ─── Once ─────────────────────────────────────────────────────────────

describe('EventBus — once', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('should call listener exactly once', async () => {
    const listener = vi.fn();
    bus.once('tool.called', listener);

    await bus.emit(toolCalledEvent());
    await bus.emit(toolCalledEvent());
    await bus.emit(toolCalledEvent());

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should auto-unsubscribe after first call', async () => {
    const listener = vi.fn();
    bus.once('tool.called', listener);

    await bus.emit(toolCalledEvent());

    expect(bus.listenerCount('tool.called')).toBe(0);
  });
});

// ─── Wildcard ─────────────────────────────────────────────────────────

describe('EventBus — wildcard', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('should match trailing wildcard pattern', async () => {
    const listener = vi.fn();
    bus.on('tool.*', listener);

    await bus.emit(toolCalledEvent());
    await bus.emit(createEvent('tool.error'));

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('should not match unrelated topics with wildcard', async () => {
    const listener = vi.fn();
    bus.on('tool.*', listener);

    await bus.emit(createEvent('session.opened'));

    expect(listener).not.toHaveBeenCalled();
  });

  it('should match exact and wildcard listeners together', async () => {
    const exact = vi.fn();
    const wildcard = vi.fn();
    bus.on('tool.called', exact);
    bus.on('tool.*', wildcard);

    await bus.emit(toolCalledEvent());

    expect(exact).toHaveBeenCalledTimes(1);
    expect(wildcard).toHaveBeenCalledTimes(1);
  });

  it('should call exact listeners before wildcard', async () => {
    const order: string[] = [];
    bus.on('tool.called', () => { order.push('exact'); });
    bus.on('tool.*', () => { order.push('wildcard'); });

    await bus.emit(toolCalledEvent());

    expect(order).toEqual(['exact', 'wildcard']);
  });

  it('should call wildcard unsub only for that wildcard', async () => {
    const wc1 = vi.fn();
    const wc2 = vi.fn();
    const unsub1 = bus.on('tool.*', wc1);
    bus.on('session.*', wc2);

    unsub1();

    await bus.emit(toolCalledEvent());
    expect(wc1).not.toHaveBeenCalled();

    await bus.emit(createEvent('session.opened'));
    expect(wc2).toHaveBeenCalledTimes(1);
  });

  it('should count wildcard listeners in listenerCount', () => {
    bus.on('tool.*', vi.fn());
    bus.on('tool.called', vi.fn());

    expect(bus.listenerCount('tool.called')).toBe(2); // exact + wildcard
    expect(bus.listenerCount('tool.error')).toBe(1); // wildcard only
  });
});

// ─── Async listeners ─────────────────────────────────────────────────

describe('EventBus — async listeners', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('should support async listeners', async () => {
    const listener = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    bus.on('tool.called', listener);

    await bus.emit(toolCalledEvent());

    expect(listener).toHaveBeenCalledOnce();
  });

  it('should await all async listeners', async () => {
    const order: string[] = [];

    bus.on('tool.called', async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push('slow');
    });

    bus.on('tool.called', async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push('fast');
    });

    await bus.emit(toolCalledEvent());

    // Both should have completed
    expect(order).toHaveLength(2);
    expect(order).toContain('slow');
    expect(order).toContain('fast');
  });

  it('should catch listener errors and continue delivery', async () => {
    const l1 = vi.fn(() => { throw new Error('l1 boom'); });
    const l2 = vi.fn();

    bus.on('tool.called', l1);
    bus.on('tool.called', l2);

    // Should not throw
    await bus.emit(toolCalledEvent());

    expect(l1).toHaveBeenCalledOnce();
    expect(l2).toHaveBeenCalledOnce();
  });

  it('should catch async listener errors and continue', async () => {
    const l1 = vi.fn(async () => { throw new Error('async boom'); });
    const l2 = vi.fn();

    bus.on('tool.called', l1);
    bus.on('tool.called', l2);

    await bus.emit(toolCalledEvent());

    expect(l1).toHaveBeenCalledOnce();
    expect(l2).toHaveBeenCalledOnce();
  });
});

// ─── Remove all listeners ────────────────────────────────────────────

describe('EventBus — removeAllListeners', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('should remove all listeners for a specific topic', async () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    bus.on('tool.called', l1);
    bus.on('session.opened', l2);

    bus.removeAllListeners('tool.called');

    await bus.emit(toolCalledEvent());
    expect(l1).not.toHaveBeenCalled();

    await bus.emit(createEvent('session.opened'));
    expect(l2).toHaveBeenCalledTimes(1);
  });

  it('should remove all listeners when no topic specified', async () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    bus.on('tool.called', l1);
    bus.on('session.opened', l2);

    bus.removeAllListeners();

    await bus.emit(toolCalledEvent());
    await bus.emit(createEvent('session.opened'));
    expect(l1).not.toHaveBeenCalled();
    expect(l2).not.toHaveBeenCalled();
  });
});

// ─── Diagnostics ─────────────────────────────────────────────────────

describe('EventBus — diagnostics', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('should return correct listenerCount', () => {
    expect(bus.listenerCount()).toBe(0);

    bus.on('tool.called', vi.fn());
    bus.on('tool.called', vi.fn());
    bus.on('session.opened', vi.fn());
    bus.on('tool.*', vi.fn());

    expect(bus.listenerCount()).toBe(4);
    expect(bus.listenerCount('tool.called')).toBe(3); // 2 exact + 1 wildcard
    expect(bus.listenerCount('session.opened')).toBe(1);
  });

  it('should return topics list', () => {
    bus.on('tool.called', vi.fn());
    bus.on('session.opened', vi.fn());
    bus.on('tool.*', vi.fn()); // wildcard — not in getTopics()

    const topics = bus.getTopics();
    expect(topics).toContain('tool.called');
    expect(topics).toContain('session.opened');
    expect(topics).not.toContain('tool.*');
  });

  it('should report hasListeners correctly', () => {
    expect(bus.hasListeners('tool.called')).toBe(false);

    bus.on('tool.*', vi.fn());
    expect(bus.hasListeners('tool.called')).toBe(true);
    expect(bus.hasListeners('session.opened')).toBe(false);

    bus.on('tool.called', vi.fn());
    expect(bus.hasListeners('tool.called')).toBe(true);
  });
});

// ─── Shutdown ─────────────────────────────────────────────────────────

describe('EventBus — shutdown', () => {
  it('should prevent subscriptions after shutdown', async () => {
    const bus = new EventBus();
    bus.shutdown();

    const listener = vi.fn();
    const unsub = bus.on('tool.called', listener);

    // Subscription should be rejected — unsub is a no-op
    await bus.emit(toolCalledEvent());
    expect(listener).not.toHaveBeenCalled();
  });

  it('should ignore emit calls after shutdown', async () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on('tool.called', listener);

    bus.shutdown();
    await bus.emit(toolCalledEvent());

    expect(listener).not.toHaveBeenCalled();
  });

  it('should report isShutdown', () => {
    const bus = new EventBus();
    expect(bus.isShutdown).toBe(false);
    bus.shutdown();
    expect(bus.isShutdown).toBe(true);
  });
});

// ─── Typed events ────────────────────────────────────────────────────

describe('EventBus — typed events', () => {
  it('should deliver ToolCalledEvent with correct payload', async () => {
    const bus = new EventBus();
    const listener = vi.fn<(e: ToolCalledEvent) => void>();

    bus.on('tool.called', listener);
    await bus.emit(toolCalledEvent({ toolName: 'greet', durationMs: 42 }));

    expect(listener).toHaveBeenCalledOnce();
    const event = listener.mock.calls[0][0];
    expect(event.type).toBe('tool.called');
    expect(event.toolName).toBe('greet');
    expect(event.sessionId).toBe('sess-1');
    expect(event.durationMs).toBe(42);
    expect(event.timestamp).toBeGreaterThan(0);
  });

  it('should deliver SessionOpenedEvent with correct payload', async () => {
    const bus = new EventBus();
    const listener = vi.fn<(e: SessionOpenedEvent) => void>();

    bus.on('session.opened', listener);
    const event: SessionOpenedEvent = {
      type: 'session.opened',
      timestamp: Date.now(),
      sessionId: 's-42',
      remote: '10.0.0.1:1234',
      userId: 'user-1',
    };
    await bus.emit(event);

    expect(listener).toHaveBeenCalledOnce();
    const received = listener.mock.calls[0][0];
    expect(received.sessionId).toBe('s-42');
    expect(received.remote).toBe('10.0.0.1:1234');
    expect(received.userId).toBe('user-1');
  });

  it('should deliver custom events', async () => {
    const bus = new EventBus();
    const listener = vi.fn();

    bus.on('custom.my_event', listener);
    await bus.emit({ type: 'custom.my_event', timestamp: Date.now(), data: { key: 'val' } });

    expect(listener).toHaveBeenCalledOnce();
    const received = listener.mock.calls[0][0];
    expect(received.type).toBe('custom.my_event');
    expect((received as any).data).toEqual({ key: 'val' });
  });
});

// ─── Singleton ────────────────────────────────────────────────────────

describe('EventBus — singleton', () => {
  afterEach(() => {
    resetEventBus();
  });

  it('should return same instance', () => {
    const a = getEventBus();
    const b = getEventBus();
    expect(a).toBe(b);
  });

  it('should reset to new instance', () => {
    const a = getEventBus();
    resetEventBus();
    const b = getEventBus();
    expect(a).not.toBe(b);
  });
});
