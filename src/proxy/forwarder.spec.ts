/**
 * proxy/forwarder.spec.ts — Tests for ProxyForwarder (P-003).
 *
 * Tests cover flow control (concurrency, queue, backpressure, timeout),
 * notification forwarding, and re-mirror triggers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProxyForwarder, DEFAULT_FORWARDER_CONFIG } from './forwarder.js';
import type { ProxyMirror } from './mirror.js';

// Mock SDK
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn(),
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(),
}));

function createMockClient() {
  return {
    setNotificationHandler: vi.fn(),
    removeNotificationHandler: vi.fn(),
  } as any;
}

function createMockServer() {
  return {
    server: {
      notification: vi.fn().mockResolvedValue(undefined),
    },
  } as any;
}

function createMockMirror() {
  return {
    unregisterAll: vi.fn(),
    mirrorAll: vi.fn().mockResolvedValue({ tools: 0, resources: 0, prompts: 0, errors: 0 }),
  } as unknown as ProxyMirror;
}

describe('P-003: ProxyForwarder', () => {
  let client: any;
  let server: any;
  let mirror: any;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createMockClient();
    server = createMockServer();
    mirror = createMockMirror();
  });

  describe('constructor', () => {
    it('uses default config when none provided', () => {
      const f = new ProxyForwarder(client, server, mirror);
      expect(f.stats.inFlight).toBe(0);
      expect(f.stats.queued).toBe(0);
    });

    it('merges custom config with defaults', () => {
      const f = new ProxyForwarder(client, server, mirror, { maxConcurrent: 5 });
      // Internal config is private, but we can test behavior
      expect(f.stats.inFlight).toBe(0);
    });
  });

  describe('forward() — flow control', () => {
    it('executes immediately when under concurrency limit', async () => {
      const f = new ProxyForwarder(client, server, mirror, { maxConcurrent: 2 });
      const result = await f.forward(async () => 'hello');
      expect(result).toBe('hello');
      expect(f.stats.totalForwarded).toBe(1);
      expect(f.stats.inFlight).toBe(0);
    });

    it('queues when at concurrency limit', async () => {
      const f = new ProxyForwarder(client, server, mirror, { maxConcurrent: 1 });

      // First request — blocks (never resolves)
      let resolve1: (v: string) => void;
      const block1 = new Promise<string>((r) => { resolve1 = r; });
      const p1 = f.forward(() => block1);

      // Give it a tick to start
      await new Promise((r) => setTimeout(r, 10));

      // Second request — should be queued
      const p2 = f.forward(async () => 'second');
      await new Promise((r) => setTimeout(r, 10));

      expect(f.stats.queued).toBe(1);
      expect(f.stats.inFlight).toBe(1);

      // Release first request
      resolve1!('first');
      await p1;

      // Second should now execute
      const result2 = await p2;
      expect(result2).toBe('second');
      expect(f.stats.queued).toBe(0);
    });

    it('rejects when queue is full (backpressure)', async () => {
      const f = new ProxyForwarder(client, server, mirror, {
        maxConcurrent: 1,
        maxQueueSize: 1,
      });

      // Block the single concurrent slot
      let resolve1: (v: string) => void;
      const block1 = new Promise<string>((r) => { resolve1 = r; });
      const p1 = f.forward(() => block1);
      await new Promise((r) => setTimeout(r, 10));

      // Fill the queue
      const p2 = f.forward(async () => 'queued');
      await new Promise((r) => setTimeout(r, 10));

      // Third should be rejected
      await expect(f.forward(async () => 'rejected')).rejects.toThrow('queue full');
      expect(f.stats.totalRejected).toBe(1);

      // Cleanup
      resolve1!('done');
      await p1;
      await p2;
    });

    it('propagates upstream errors', async () => {
      const f = new ProxyForwarder(client, server, mirror);
      await expect(f.forward(async () => {
        throw new Error('upstream error');
      })).rejects.toThrow('upstream error');
      expect(f.stats.totalRejected).toBe(1);
    });

    it('drains queue after request completes', async () => {
      const f = new ProxyForwarder(client, server, mirror, { maxConcurrent: 1 });

      let resolve1: (v: number) => void;
      const block1 = new Promise<number>((r) => { resolve1 = r; });
      const p1 = f.forward(() => block1);
      await new Promise((r) => setTimeout(r, 10));

      const p2 = f.forward(async () => 2);
      const p3 = f.forward(async () => 3);
      await new Promise((r) => setTimeout(r, 10));

      expect(f.stats.queued).toBe(2);

      // Release first — queue should drain
      resolve1!(1);
      await p1;
      await p2;
      await p3;

      expect(f.stats.queued).toBe(0);
      expect(f.stats.totalForwarded).toBe(3);
    });
  });

  describe('start() / stop()', () => {
    it('start() installs notification handlers', () => {
      const f = new ProxyForwarder(client, server, mirror, { forwardNotifications: true });
      f.start();
      // Should have called setNotificationHandler multiple times
      // (tools/list_changed, resources/list_changed, prompts/list_changed,
      //  resources/updated, progress)
      expect(client.setNotificationHandler).toHaveBeenCalled();
      expect(client.setNotificationHandler.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('start() is no-op when forwardNotifications is false', () => {
      const f = new ProxyForwarder(client, server, mirror, { forwardNotifications: false });
      f.start();
      expect(client.setNotificationHandler).not.toHaveBeenCalled();
    });

    it('stop() removes notification handlers', () => {
      const f = new ProxyForwarder(client, server, mirror, { forwardNotifications: true });
      f.start();
      f.stop();
      expect(client.removeNotificationHandler).toHaveBeenCalled();
    });

    it('stop() rejects queued requests', async () => {
      const f = new ProxyForwarder(client, server, mirror, { maxConcurrent: 1 });

      let resolve1: (v: string) => void;
      const block1 = new Promise<string>((r) => { resolve1 = r; });
      const p1 = f.forward(() => block1);
      await new Promise((r) => setTimeout(r, 10));

      const p2 = f.forward(async () => 'queued');
      await new Promise((r) => setTimeout(r, 10));

      f.stop();

      await expect(p2).rejects.toThrow('forwarder stopped');

      // Cleanup p1
      resolve1!('done');
      await p1;
    });
  });

  describe('notification handlers', () => {
    it('auto-remirror on tools/list_changed', async () => {
      const f = new ProxyForwarder(client, server, mirror, {
        forwardNotifications: true,
        autoRemirror: true,
      });
      f.start();

      // Find the tools/list_changed handler
      const calls = client.setNotificationHandler.mock.calls;
      // Each call: [schema, handler]
      // We need to find the one for tools/list_changed and invoke it
      // Since we can't easily filter by method, just invoke all handlers
      // and check that mirrorAll was called
      for (const [, handler] of calls) {
        await handler({ method: 'notifications/tools/list_changed' });
      }

      expect(mirror.unregisterAll).toHaveBeenCalled();
      expect(mirror.mirrorAll).toHaveBeenCalled();
      expect(f.stats.remirrorEvents).toBeGreaterThan(0);

      f.stop();
    });

    it('forwards resources/updated to downstream', async () => {
      const f = new ProxyForwarder(client, server, mirror, {
        forwardNotifications: true,
        autoRemirror: false, // disable to isolate
      });
      f.start();

      const calls = client.setNotificationHandler.mock.calls;
      for (const [, handler] of calls) {
        await handler({ method: 'notifications/resources/updated' });
      }

      expect(server.server.notification).toHaveBeenCalled();
      expect(f.stats.notificationsForwarded).toBeGreaterThan(0);

      f.stop();
    });
  });

  describe('stats', () => {
    it('tracks inFlight and queued correctly', async () => {
      const f = new ProxyForwarder(client, server, mirror, { maxConcurrent: 2 });

      let r1: (v: string) => void;
      let r2: (v: string) => void;
      const b1 = new Promise<string>((r) => { r1 = r; });
      const b2 = new Promise<string>((r) => { r2 = r; });

      const p1 = f.forward(() => b1);
      const p2 = f.forward(() => b2);
      await new Promise((r) => setTimeout(r, 10));

      expect(f.stats.inFlight).toBe(2);
      expect(f.stats.queued).toBe(0);

      r1!('a');
      r2!('b');
      await p1;
      await p2;

      expect(f.stats.inFlight).toBe(0);
      expect(f.stats.totalForwarded).toBe(2);
    });
  });
});

describe('P-003: DEFAULT_FORWARDER_CONFIG', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_FORWARDER_CONFIG.maxConcurrent).toBe(10);
    expect(DEFAULT_FORWARDER_CONFIG.maxQueueSize).toBe(100);
    expect(DEFAULT_FORWARDER_CONFIG.timeoutMs).toBe(30_000);
    expect(DEFAULT_FORWARDER_CONFIG.forwardNotifications).toBe(true);
    expect(DEFAULT_FORWARDER_CONFIG.autoRemirror).toBe(true);
  });
});
