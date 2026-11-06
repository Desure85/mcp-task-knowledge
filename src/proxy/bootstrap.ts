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

/**
 * MU-08: the task-knowledge core keeps every non-lifecycle method closed until
 * the session calls this tool (`src/register/auth.ts`). It is reachable before
 * authentication, exactly like `initialize`.
 */
export const AUTHENTICATE_TOOL = 'mcp.authenticate';

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  const first = Array.isArray(content) ? content.find((item) => typeof item?.text === 'string') : undefined;
  return first?.text ?? 'unknown error';
}

// ─── Bootstrap ────────────────────────────────────────────────────

export class ProxyBootstrap {
  private client?: Client;
  private clientTransport?: Transport;
  private _running = false;
  private _upstreamConnected = false;
  private _authenticated = false;
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

  /** Whether this session authenticated with the upstream (MU-08). */
  get authenticated(): boolean {
    return this._authenticated;
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
    try {
      await this.connectUpstream();
      this._running = true;
    } catch (err) {
      await this.closeUpstream();
      throw err;
    }
    log.info('proxy started — upstream connected');
  }

  /**
   * Connect to the upstream MCP server, then authenticate the new session when
   * a token is configured. Throws on connection or authentication failure.
   */
  private async connectUpstream(): Promise<void> {
    const { transport, url } = this.config.upstream;

    if (transport !== 'http') {
      throw new Error(`[proxy] upstream transport "${transport}" not yet supported (P-001: HTTP only)`);
    }

    await this.closeUpstream();

    this.clientTransport = new StreamableHTTPClientTransport(
      new URL(url),
      { requestInit: this.buildRequestInit() },
    );

    this.client = new Client(
      { name: 'mcp-task-knowledge-proxy', version: '1.0.0' },
      { capabilities: {} },
    );

    try {
      await this.client.connect(this.clientTransport);
      this._upstreamConnected = true;
      this.reconnectAttempts = 0;
      log.info({ url }, 'connected to upstream MCP server');
      await this.authenticate();
    } catch (err) {
      this._upstreamConnected = false;
      this._authenticated = false;
      log.error({ err, url }, 'failed to connect to upstream');
      throw err;
    }
  }

  private buildRequestInit(): RequestInit | undefined {
    const { mode, token } = this.config.auth;
    if ((mode === 'static-token' || mode === 'jwt') && token) {
      return { headers: { Authorization: `Bearer ${token}` } };
    }
    return undefined;
  }

  /**
   * Authenticate the current upstream session.
   *
   * The core gates every method except `initialize`/`ping` behind a session
   * token (`mcp.authenticate`), so a fresh `Client` — including the one created
   * by `reconnect()` — is unauthenticated until this runs. A configured token
   * is also sent as `Authorization`, which the core ignores today but keeps
   * the config honest for header-based upstreams.
   */
  async authenticate(): Promise<void> {
    const { mode, token } = this.config.auth;
    if (!token) {
      this._authenticated = mode === 'none';
      return;
    }

    const result = await this.getClient().callTool({
      name: AUTHENTICATE_TOOL,
      arguments: { token },
    });
    const failed = Boolean((result as { isError?: boolean }).isError);
    if (failed) {
      throw new Error(`[proxy] upstream authentication failed: ${this.redact(textOf(result))}`);
    }
    this._authenticated = true;
    log.info('authenticated with upstream');
  }

  private redact(text: string): string {
    const token = this.config.auth.token;
    return token ? text.split(token).join('<redacted>') : text;
  }

  private async closeUpstream(): Promise<void> {
    this._authenticated = false;
    this._upstreamConnected = false;
    const client = this.client;
    this.client = undefined;
    this.clientTransport = undefined;
    if (!client) return;
    try {
      await client.close();
    } catch (err) {
      log.warn({ err }, 'error closing upstream client');
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

    await this.closeUpstream();
    this._running = false;
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
