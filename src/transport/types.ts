/**
 * Transport Layer Abstraction (F-002)
 *
 * Decouples transport selection/wiring from the application entry point.
 * Adding a new transport (TCP, WebSocket, etc.) requires only:
 *   1. Implement TransportAdapter
 *   2. Call registry.registerTransport(factory)
 *
 * The built-in transports (stdio, http) are registered in registry.ts.
 */

import type { ServerContext } from '../register/context.js';

// ─── Config ───────────────────────────────────────────────────────────

/** Typed options per transport — kept loose for extensibility */
export interface TransportConfig {
  /** Transport type identifier (e.g. "stdio", "http", "ws") */
  type: string;
  /** Arbitrary transport-specific options (port, host, path, tls, …) */
  options?: Record<string, unknown>;
}

// ─── Adapter ──────────────────────────────────────────────────────────

/**
 * Health status returned by `TransportAdapter.health()`.
 * Used by SCALE-001 `/healthz` endpoint and Kubernetes probes.
 */
export interface TransportHealth {
  /** Transport type identifier. */
  type: string;
  /** Whether the transport is healthy and ready to serve requests. */
  healthy: boolean;
  /** Whether the adapter has been connected (lifecycle state). */
  connected: boolean;
  /** Transport-specific details (port, active connections, etc.). */
  details?: Record<string, unknown>;
}

/**
 * Wraps an MCP SDK Transport with full lifecycle management.
 *
 * The adapter owns the connection to the MCP server AND any auxiliary
 * resources (HTTP servers, TCP listeners, etc.).
 */
export interface TransportAdapter {
  /** Transport type identifier (matches registry key). */
  readonly type: string;

  /** Whether the transport is currently connected. */
  readonly connected: boolean;

  /**
   * Wire the transport to the MCP server and start listening.
   * Must be called exactly once.
   */
  connect(ctx: ServerContext): Promise<void>;

  /**
   * Gracefully shut down the transport and release all resources.
   * Idempotent — safe to call multiple times.
   */
  close(): Promise<void>;

  /**
   * Check transport health (T-004).
   * Returns whether the transport is alive and ready to serve requests.
   * Stdio is always healthy; TCP/HTTP check socket/listener state.
   */
  health(): TransportHealth;
}

// ─── Factory ──────────────────────────────────────────────────────────

/**
 * Factory that produces a TransportAdapter from a config object.
 *
 * Implementations should be stateless and reusable.
 */
export interface TransportFactory {
  /** Transport type identifier this factory produces. */
  readonly type: string;

  /**
   * Create a new adapter instance.
   * @param config — parsed config with at least `type` matching factory's type.
   * @throws if config is invalid or missing required options.
   */
  create(config: TransportConfig): TransportAdapter;
}
