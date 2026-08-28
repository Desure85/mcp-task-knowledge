/**
 * proxy/bootstrap.ts — Thin Proxy bootstrap and lifecycle (P-001).
 *
 * The proxy connects to an upstream MCP server via the SDK Client,
 * and listens for downstream MCP client connections via a transport adapter.
 *
 * P-001: bootstrap + config + lifecycle + upstream connection.
 * P-002: tool/resource mirroring (forward list requests).
 * P-003: request forwarding + flow control.
 *
 * Usage:
 *   const proxy = new ProxyBootstrap(config);
 *   await proxy.start();    // connects to upstream, starts listening
 *   const health = proxy.health();
 *   await proxy.stop();     // graceful shutdown
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ProxyConfig, ProxyHealth } from './types.js';
import { childLogger } from '../core/logger.js';

const log = childLogger('proxy:bootstrap');

// ─── Bootstrap ────────────────────────────────────────────────────

export class ProxyBootstrap {
  private client?: Client;
  private clientTransport?: Transport;
  private _running = false;
  private _upstreamConnected = false;
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(private readonly config: ProxyConfig) {
    if (!config.enabled) {
      throw new Error('[proxy] config.enabled is false — cannot bootstrap');
    }
  }

  /** Whether the proxy is running. */
  get running(): boolean {
    return this._running;
  }

  /** Whether the upstream connection is alive. */
  get upstreamConnected(): boolean {
    return this._upstreamConnected;
  }

  /**
   * Start the proxy: connect to upstream MCP server.
   * Downstream listener is set up by the caller (AppContainer or standalone).
   * Returns when upstream connection is established.
   */
  async start(): Promise<void> {
    if (this._running) {
      throw new Error('[proxy] already running');
    }

    log.info({ upstreamUrl: this.config.upstream.url }, 'starting proxy');
    await this.connectUpstream();
    this._running = true;
    log.info('proxy started — upstream connected');
  }

  /**
   * Connect to the upstream MCP server.
   * Uses StreamableHTTPClientTransport for HTTP upstream.
   * Throws on connection failure.
   */
  private async connectUpstream(): Promise<void> {
    const { transport, url } = this.config.upstream;

    if (transport !== 'http') {
      throw new Error(`[proxy] upstream transport "${transport}" not yet supported (P-001: HTTP only)`);
    }

    // Create client transport to upstream
    this.clientTransport = new StreamableHTTPClientTransport(
      new URL(url),
    );

    // Create MCP client
    this.client = new Client(
      { name: 'mcp-task-knowledge-proxy', version: '1.0.0' },
      { capabilities: {} },
    );

    // Connect to upstream
    try {
      await this.client.connect(this.clientTransport);
      this._upstreamConnected = true;
      this.reconnectAttempts = 0;
      log.info({ url }, 'connected to upstream MCP server');
    } catch (err) {
      this._upstreamConnected = false;
      log.error({ err, url }, 'failed to connect to upstream');
      throw err;
    }
  }

  /**
   * Attempt to reconnect to upstream (with backoff).
   * Called automatically on connection loss, or manually.
   */
  async reconnect(): Promise<boolean> {
    if (this.reconnectAttempts >= this.config.upstream.maxReconnects && this.config.upstream.maxReconnects > 0) {
      log.error({ attempts: this.reconnectAttempts }, 'max reconnect attempts reached');
      return false;
    }

    this.reconnectAttempts++;
    log.info({ attempt: this.reconnectAttempts }, 'attempting reconnect');

    try {
      // Close existing client if any
      if (this.client) {
        try { await this.client.close(); } catch { /* ignore */ }
      }

      await this.connectUpstream();
      return true;
    } catch {
      // Schedule next reconnect if auto-reconnect is enabled
      const delay = this.config.upstream.reconnectDelayMs;
      if (delay > 0) {
        this.reconnectTimer = setTimeout(() => this.reconnect(), delay);
      }
      return false;
    }
  }

  /**
   * Get the MCP client for upstream communication.
   * Used by P-002 (mirroring) and P-003 (forwarding).
   */
  getClient(): Client {
    if (!this.client || !this._upstreamConnected) {
      throw new Error('[proxy] upstream client not available — call start() first');
    }
    return this.client;
  }

  /**
   * Graceful shutdown: close upstream connection, clear timers.
   * Idempotent — safe to call multiple times.
   */
  async stop(): Promise<void> {
    if (!this._running) return;

    log.info('stopping proxy');

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    try {
      if (this.client) {
        await this.client.close();
      }
    } catch (err) {
      log.warn({ err }, 'error closing upstream client');
    } finally {
      this._upstreamConnected = false;
      this._running = false;
      this.client = undefined;
      this.clientTransport = undefined;
    }

    log.info('proxy stopped');
  }

  /**
   * Check proxy health (T-004 compatible).
   * Returns upstream + downstream status.
   */
  health(): ProxyHealth {
    return {
      healthy: this._running && this._upstreamConnected,
      running: this._running,
      upstreamConnected: this._upstreamConnected,
      downstream: {
        type: this.config.downstream.transport,
        healthy: this._running,
        connected: this._running,
        details: {
          port: this.config.downstream.port,
          host: this.config.downstream.host,
        },
      },
      config: {
        enabled: this.config.enabled,
        upstreamTransport: this.config.upstream.transport,
        upstreamUrl: this.config.upstream.url,
        authMode: this.config.auth.mode,
      },
    };
  }
}
