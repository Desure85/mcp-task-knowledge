/**
 * proxy/types.ts — Thin Proxy type definitions (P-001).
 *
 * The proxy sits between MCP clients and an upstream MCP server:
 *   MCP Client → [Proxy] → [Upstream MCP Server]
 *
 * P-001 defines config + lifecycle. P-002 adds tool/resource mirroring.
 * P-003 adds request forwarding + flow control.
 */

import type { TransportHealth } from '../transport/types.js';

// ─── Config ───────────────────────────────────────────────────────

/** How the proxy connects to the upstream MCP server. */
export type UpstreamTransport = 'http' | 'tcp' | 'stdio';

/** Authentication mode for upstream connection. */
export type ProxyAuthMode = 'none' | 'jwt' | 'static-token';

/** Proxy configuration (from config file / env / CLI). */
export interface ProxyConfig {
  /** Enable proxy mode. When false, the server runs normally (non-proxy). */
  enabled: boolean;

  /** Upstream MCP server connection settings. */
  upstream: {
    /** Transport type to connect to upstream. */
    transport: UpstreamTransport;
    /** Upstream URL (for HTTP) or host:port (for TCP). */
    url: string;
    /** Connection timeout in milliseconds. */
    timeoutMs: number;
    /** Reconnect delay in milliseconds (0 = no auto-reconnect). */
    reconnectDelayMs: number;
    /** Max reconnect attempts (0 = infinite). */
    maxReconnects: number;
  };

  /** Authentication for upstream connection. */
  auth: {
    mode: ProxyAuthMode;
    /** Static token for 'static-token' mode. */
    token?: string;
    /** JWT secret for 'jwt' mode. */
    jwtSecret?: string;
    /** JWT issuer for validation. */
    jwtIssuer?: string;
  };

  /** Downstream listen settings (how clients connect to the proxy). */
  downstream: {
    /** Transport type for downstream clients. */
    transport: 'http' | 'tcp' | 'stdio';
    /** Port for HTTP/TCP downstream. */
    port: number;
    /** Host for HTTP/TCP downstream. */
    host: string;
  };
}

// ─── Health ───────────────────────────────────────────────────────

/** Proxy health status — includes upstream connection state. */
export interface ProxyHealth {
  /** Whether the proxy is healthy and ready to serve. */
  healthy: boolean;
  /** Whether the proxy is running. */
  running: boolean;
  /** Whether the upstream connection is alive. */
  upstreamConnected: boolean;
  /** Downstream transport health. */
  downstream: TransportHealth;
  /** Proxy config summary (no secrets). */
  config: {
    enabled: boolean;
    upstreamTransport: UpstreamTransport;
    upstreamUrl: string;
    authMode: ProxyAuthMode;
  };
}

// ─── Defaults ─────────────────────────────────────────────────────

export const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  enabled: false,
  upstream: {
    transport: 'http',
    url: 'http://localhost:3001',
    timeoutMs: 5000,
    reconnectDelayMs: 1000,
    maxReconnects: 5,
  },
  auth: {
    mode: 'none',
  },
  downstream: {
    transport: 'http',
    port: 3002,
    host: '0.0.0.0',
  },
};
