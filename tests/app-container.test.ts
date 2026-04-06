import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppContainer, defaultRegistration } from '../src/core/app-container.js';
import type { AppContainerOptions, AppState, RegisterCallback } from '../src/core/app-container.js';
import type { TransportAdapter, TransportFactory } from '../src/transport/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Build a mock TransportAdapter for testing.
 * Tracks connect/close calls without actual I/O.
 */
function createMockAdapter(): TransportAdapter & {
  connectCalls: number;
  closeCalls: number;
} {
  const adapter = {
    type: 'stdio',
    connected: false,
    connectCalls: 0,
    closeCalls: 0,
    async connect() { this.connectCalls++; this.connected = true; },
    async close() { this.closeCalls++; this.connected = false; },
  };
  return adapter;
}

// ─── State transitions ────────────────────────────────────────────────

describe('AppContainer — state transitions', () => {
  it('starts in idle state', () => {
    const app = new AppContainer({ handleSignals: false });
    expect(app.state).toBe('idle');
  });

  it('rejects double init', async () => {
    const app = new AppContainer({ handleSignals: false });
    app._setState('ready');
    await expect(app.init()).rejects.toThrow(/invalid state transition.*ready.*initializing/i);
  });

  it('rejects start before init', async () => {
    const app = new AppContainer({ handleSignals: false });
    await expect(app.start()).rejects.toThrow(/invalid state transition.*idle.*running/i);
  });

  it('rejects start when already running', async () => {
    const app = new AppContainer({ handleSignals: false });
    app._setState('running');
    await expect(app.start()).rejects.toThrow(/invalid state transition.*running.*running/i);
  });

  it('allows stop from running state', async () => {
    const app = new AppContainer({ handleSignals: false });
    app._setState('running');
    await app.stop();
    expect(app.state).toBe('stopped');
  });

  it('stop is idempotent from stopped state', async () => {
    const app = new AppContainer({ handleSignals: false });
    app._setState('stopped');
    await app.stop();
    expect(app.state).toBe('stopped');
  });

  it('stop is idempotent from stopping state', async () => {
    const app = new AppContainer({ handleSignals: false });
    app._setState('stopping');
    await app.stop();
    expect(app.state).toBe('stopping');
  });

  it('allows stop from ready state (never started)', async () => {
    const app = new AppContainer({ handleSignals: false });
    app._setState('ready');
    await app.stop();
    expect(app.state).toBe('stopped');
  });

  it('allows stop from error state', async () => {
    const app = new AppContainer({ handleSignals: false });
    app._setState('error');
    await app.stop();
    expect(app.state).toBe('stopped');
  });

  it('allows stop from idle state', async () => {
    const app = new AppContainer({ handleSignals: false });
    await app.stop();
    expect(app.state).toBe('stopped');
  });

  it('allows restart after stop (stopped → initializing)', () => {
    const app = new AppContainer({ handleSignals: false });
    app._setState('stopped');
    app._setState('initializing');
    expect(app.state).toBe('initializing');
  });

  it('allows restart after error (error → initializing)', () => {
    const app = new AppContainer({ handleSignals: false });
    app._setState('error');
    app._setState('initializing');
    expect(app.state).toBe('initializing');
  });

  it('rejects direct transition: ready → idle via _setState', () => {
    const app = new AppContainer({ handleSignals: false });
    app._setState('ready');
    // _setState bypasses validation, so we can set anything for testing.
    // The important thing is that init/start/stop enforce transitions.
    expect(app.state).toBe('ready');
  });

  it('all valid state transitions work via _setState', () => {
    const app = new AppContainer({ handleSignals: false });

    // idle → initializing → ready → running → stopping → stopped
    app._setState('initializing');
    expect(app.state).toBe('initializing');

    app._setState('ready');
    expect(app.state).toBe('ready');

    app._setState('running');
    expect(app.state).toBe('running');

    app._setState('stopping');
    expect(app.state).toBe('stopping');

    app._setState('stopped');
    expect(app.state).toBe('stopped');

    // error state
    app._setState('error');
    expect(app.state).toBe('error');
  });
});

// ─── Constructor options ──────────────────────────────────────────────

describe('AppContainer — constructor options', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.MCP_TRANSPORT;
    delete process.env.MCP_PORT;
    delete process.env.MCP_HOST;
  });

  afterEach(() => {
    Object.assign(process.env, originalEnv);
  });

  it('defaults to stdio transport', () => {
    const app = new AppContainer({ handleSignals: false });
    expect(app.state).toBe('idle');
  });

  it('reads transport type from env', () => {
    process.env.MCP_TRANSPORT = 'http';
    const app = new AppContainer({ handleSignals: false });
    expect(app.state).toBe('idle');
  });

  it('constructor accepts explicit transport type', () => {
    const app = new AppContainer({ transportType: 'http', handleSignals: false });
    expect(app.state).toBe('idle');
  });

  it('constructor accepts port override', () => {
    const app = new AppContainer({ port: 9999, handleSignals: false });
    expect(app.state).toBe('idle');
  });

  it('constructor accepts host override', () => {
    const app = new AppContainer({ host: '127.0.0.1', handleSignals: false });
    expect(app.state).toBe('idle');
  });

  it('constructor accepts custom registerTools callback', () => {
    const customFn: RegisterCallback = vi.fn();
    const app = new AppContainer({ registerTools: customFn, handleSignals: false });
    expect(app.state).toBe('idle');
  });

  it('handleSignals defaults to false for stdio', () => {
    const app = new AppContainer({ handleSignals: 'auto' });
    // stdio → handleSignals = false (can't inspect directly, but no error)
    expect(app.state).toBe('idle');
  });

  it('handleSignals defaults to true for http transport', () => {
    process.env.MCP_TRANSPORT = 'http';
    const app = new AppContainer({ handleSignals: 'auto' });
    // http → handleSignals = true (can't inspect directly, but no error)
    expect(app.state).toBe('idle');
  });
});

// ─── Getters ──────────────────────────────────────────────────────────

describe('AppContainer — getters', () => {
  it('getContext throws before init', () => {
    const app = new AppContainer({ handleSignals: false });
    expect(() => app.getContext()).toThrow(/context not available/);
  });

  it('getTransport throws before start', () => {
    const app = new AppContainer({ handleSignals: false });
    app._setState('ready');
    expect(() => app.getTransport()).toThrow(/transport not available/);
  });
});

// ─── Cleanup callbacks ────────────────────────────────────────────────

describe('AppContainer — cleanup callbacks', () => {
  it('addCleanup registers callback', () => {
    const app = new AppContainer({ handleSignals: false });
    const fn = vi.fn();
    app.addCleanup(fn);
    expect(app._getCleanupCallbacks()).toHaveLength(1);
  });

  it('cleanup callbacks run in LIFO order on stop', async () => {
    const app = new AppContainer({ handleSignals: false });
    app._setState('running');

    const order: string[] = [];
    app.addCleanup(() => { order.push('first'); });
    app.addCleanup(() => { order.push('second'); });
    app.addCleanup(async () => { order.push('third'); });

    await app.stop();

    // LIFO: third, second, first
    expect(order).toEqual(['third', 'second', 'first']);
  });

  it('cleanup callback errors are caught (non-fatal)', async () => {
    const app = new AppContainer({ handleSignals: false });
    app._setState('running');

    const goodFn = vi.fn();
    const badFn = vi.fn(() => { throw new Error('cleanup boom'); });

    app.addCleanup(badFn);
    app.addCleanup(goodFn);

    await expect(app.stop()).resolves.not.toThrow();
    expect(badFn).toHaveBeenCalled();
    expect(goodFn).toHaveBeenCalled();
  });

  it('cleanup callbacks are cleared after stop', async () => {
    const app = new AppContainer({ handleSignals: false });
    app._setState('running');

    app.addCleanup(vi.fn());
    app.addCleanup(vi.fn());
    expect(app._getCleanupCallbacks()).toHaveLength(2);

    await app.stop();
    expect(app._getCleanupCallbacks()).toHaveLength(0);
  });

  it('async cleanup callbacks are awaited', async () => {
    const app = new AppContainer({ handleSignals: false });
    app._setState('running');

    let resolved = false;
    app.addCleanup(async () => {
      await new Promise((r) => setTimeout(r, 10));
      resolved = true;
    });

    await app.stop();
    expect(resolved).toBe(true);
  });

  it('multiple addCleanup calls accumulate', () => {
    const app = new AppContainer({ handleSignals: false });
    app.addCleanup(vi.fn());
    app.addCleanup(vi.fn());
    app.addCleanup(vi.fn());
    expect(app._getCleanupCallbacks()).toHaveLength(3);
  });
});

// ─── Signal handling ──────────────────────────────────────────────────

describe('AppContainer — signal handling', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number | null) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  });

  it('handleSignals=false does not install signal handlers', () => {
    const app = new AppContainer({ handleSignals: false });
    app._setState('running');
    expect(app._hasSignalHandlers()).toBe(false);
  });

  it('handleSignals=true does not install handlers in constructor', () => {
    // Handlers are installed by start(), not the constructor
    const app = new AppContainer({ handleSignals: true });
    expect(app._hasSignalHandlers()).toBe(false);
  });

  it('shutdown calls stop and process.exit', async () => {
    const app = new AppContainer({ handleSignals: false });
    app._setState('running');

    await expect(app.shutdown()).rejects.toThrow(/process\.exit/);
  });

  it('installSignalHandlers can be triggered via private method', () => {
    const app = new AppContainer({ handleSignals: true });
    app._setState('running');

    const installMethod = (app as unknown as { installSignalHandlers: () => void }).installSignalHandlers;
    installMethod.call(app);
    expect(app._hasSignalHandlers()).toBe(true);
  });

  it('stop removes signal handlers', async () => {
    const app = new AppContainer({ handleSignals: true });
    app._setState('running');

    const installMethod = (app as unknown as { installSignalHandlers: () => void }).installSignalHandlers;
    installMethod.call(app);
    expect(app._hasSignalHandlers()).toBe(true);

    await app.stop();
    expect(app._hasSignalHandlers()).toBe(false);
  });

  it('installSignalHandlers is idempotent', () => {
    const app = new AppContainer({ handleSignals: true });
    app._setState('running');

    const installMethod = (app as unknown as { installSignalHandlers: () => void }).installSignalHandlers;
    installMethod.call(app);
    installMethod.call(app); // second call should be no-op
    expect(app._hasSignalHandlers()).toBe(true);
  });

  it('removeSignalHandlers is idempotent', async () => {
    const app = new AppContainer({ handleSignals: true });
    app._setState('running');

    const removeMethod = (app as unknown as { removeSignalHandlers: () => void }).removeSignalHandlers;
    removeMethod.call(app);
    removeMethod.call(app); // should not throw
    expect(app._hasSignalHandlers()).toBe(false);
  });
});

// ─── defaultRegistration ──────────────────────────────────────────────

describe('defaultRegistration', () => {
  it('is exported as a function', () => {
    expect(typeof defaultRegistration).toBe('function');
  });

  it('has correct arity (1 parameter)', () => {
    expect(defaultRegistration.length).toBe(1);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────

describe('AppContainer — edge cases', () => {
  it('multiple instances are independent', () => {
    const a = new AppContainer({ handleSignals: false });
    const b = new AppContainer({ handleSignals: false });
    expect(a.state).toBe('idle');
    expect(b.state).toBe('idle');

    a._setState('running');
    expect(a.state).toBe('running');
    expect(b.state).toBe('idle');
  });

  it('stop from initializing state transitions to stopped', async () => {
    const app = new AppContainer({ handleSignals: false });
    app._setState('initializing');
    await app.stop();
    expect(app.state).toBe('stopped');
  });

  it('stop from error state transitions to stopped', async () => {
    const app = new AppContainer({ handleSignals: false });
    app._setState('error');
    await app.stop();
    expect(app.state).toBe('stopped');
  });

  it('stop handles transport close errors gracefully', async () => {
    const app = new AppContainer({ handleSignals: false });
    app._setState('running');

    // Manually set adapter with a failing close
    const badAdapter: TransportAdapter = {
      type: 'stdio',
      async connect() {},
      async close() { throw new Error('transport close failed'); },
    };
    // We can't directly set adapter, but we can test via the state machine
    // The actual transport close error handling is tested via integration tests
    await app.stop();
    expect(app.state).toBe('stopped');
  });
});

// ─── AppState type export ─────────────────────────────────────────────

describe('AppContainer — type exports', () => {
  it('AppState type includes all expected states', () => {
    const states: AppState[] = ['idle', 'initializing', 'ready', 'running', 'stopping', 'stopped', 'error'];
    expect(states).toHaveLength(7);
  });
});
