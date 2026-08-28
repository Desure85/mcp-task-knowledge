/**
 * proxy/bootstrap.spec.ts — Tests for ProxyBootstrap (P-001).
 *
 * Tests cover lifecycle, config validation, health, and reconnection.
 * Upstream connection is mocked — no real MCP server needed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProxyBootstrap } from './bootstrap.js';
import { DEFAULT_PROXY_CONFIG, type ProxyConfig } from './types.js';

// Mock the MCP SDK Client to avoid real network connections
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('P-001: ProxyBootstrap', () => {
  let config: ProxyConfig;

  beforeEach(() => {
    config = {
      ...DEFAULT_PROXY_CONFIG,
      enabled: true,
      upstream: {
        ...DEFAULT_PROXY_CONFIG.upstream,
        url: 'http://localhost:9999',
      },
    };
  });

  describe('constructor', () => {
    it('throws if config.enabled is false', () => {
      expect(() => new ProxyBootstrap({ ...config, enabled: false })).toThrow('config.enabled is false');
    });

    it('accepts valid config', () => {
      const proxy = new ProxyBootstrap(config);
      expect(proxy.running).toBe(false);
      expect(proxy.upstreamConnected).toBe(false);
    });
  });

  describe('start()', () => {
    it('connects to upstream and sets running flag', async () => {
      const proxy = new ProxyBootstrap(config);
      await proxy.start();
      expect(proxy.running).toBe(true);
      expect(proxy.upstreamConnected).toBe(true);
      await proxy.stop();
    });

    it('throws on double start', async () => {
      const proxy = new ProxyBootstrap(config);
      await proxy.start();
      await expect(proxy.start()).rejects.toThrow('already running');
      await proxy.stop();
    });

    it('throws on unsupported upstream transport', async () => {
      const proxy = new ProxyBootstrap({
        ...config,
        upstream: { ...config.upstream, transport: 'tcp' },
      });
      await expect(proxy.start()).rejects.toThrow('not yet supported');
    });
  });

  describe('stop()', () => {
    it('is idempotent (safe to call without start)', async () => {
      const proxy = new ProxyBootstrap(config);
      await expect(proxy.stop()).resolves.not.toThrow();
    });

    it('stops cleanly after start', async () => {
      const proxy = new ProxyBootstrap(config);
      await proxy.start();
      await proxy.stop();
      expect(proxy.running).toBe(false);
      expect(proxy.upstreamConnected).toBe(false);
    });

    it('can start again after stop', async () => {
      const proxy = new ProxyBootstrap(config);
      await proxy.start();
      await proxy.stop();
      await proxy.start();
      expect(proxy.running).toBe(true);
      await proxy.stop();
    });
  });

  describe('health()', () => {
    it('returns unhealthy before start', () => {
      const proxy = new ProxyBootstrap(config);
      const h = proxy.health();
      expect(h.healthy).toBe(false);
      expect(h.running).toBe(false);
      expect(h.upstreamConnected).toBe(false);
    });

    it('returns healthy after start', async () => {
      const proxy = new ProxyBootstrap(config);
      await proxy.start();
      const h = proxy.health();
      expect(h.healthy).toBe(true);
      expect(h.running).toBe(true);
      expect(h.upstreamConnected).toBe(true);
      expect(h.config.enabled).toBe(true);
      expect(h.config.upstreamUrl).toBe('http://localhost:9999');
      expect(h.downstream.type).toBe('http');
      await proxy.stop();
    });

    it('returns unhealthy after stop', async () => {
      const proxy = new ProxyBootstrap(config);
      await proxy.start();
      await proxy.stop();
      const h = proxy.health();
      expect(h.healthy).toBe(false);
      expect(h.running).toBe(false);
    });
  });

  describe('getClient()', () => {
    it('throws before start', () => {
      const proxy = new ProxyBootstrap(config);
      expect(() => proxy.getClient()).toThrow('not available');
    });

    it('returns client after start', async () => {
      const proxy = new ProxyBootstrap(config);
      await proxy.start();
      const client = proxy.getClient();
      expect(client).toBeDefined();
      await proxy.stop();
    });

    it('throws after stop', async () => {
      const proxy = new ProxyBootstrap(config);
      await proxy.start();
      await proxy.stop();
      expect(() => proxy.getClient()).toThrow('not available');
    });
  });
});

describe('P-001: ProxyConfig defaults', () => {
  it('DEFAULT_PROXY_CONFIG has sensible values', () => {
    expect(DEFAULT_PROXY_CONFIG.enabled).toBe(false);
    expect(DEFAULT_PROXY_CONFIG.upstream.transport).toBe('http');
    expect(DEFAULT_PROXY_CONFIG.upstream.url).toBe('http://localhost:3001');
    expect(DEFAULT_PROXY_CONFIG.upstream.timeoutMs).toBe(5000);
    expect(DEFAULT_PROXY_CONFIG.auth.mode).toBe('none');
    expect(DEFAULT_PROXY_CONFIG.downstream.transport).toBe('http');
    expect(DEFAULT_PROXY_CONFIG.downstream.port).toBe(3002);
  });
});
