/**
 * proxy/index.ts — Public API for Thin Proxy module (P-001..P-004).
 */

export { ProxyBootstrap } from './bootstrap.js';
export { ProxyMirror, jsonSchemaToZod, jsonSchemaToShape } from './mirror.js';
export type { MirrorStats } from './mirror.js';
export { ProxyForwarder, DEFAULT_FORWARDER_CONFIG } from './forwarder.js';
export type { ForwarderConfig, ForwarderStats } from './forwarder.js';
export {
  CircuitBreaker,
  UpstreamHealthWatcher,
  initProxyMetrics,
  getProxyMetrics,
  recordUpstreamRequest,
  recordReconnect,
  recordCircuitBreakerState,
  recordUpstreamLatency,
  recordForwardedNotification,
  DEFAULT_CIRCUIT_CONFIG,
  DEFAULT_WATCHER_CONFIG,
} from './resilience.js';
export type {
  CircuitState,
  CircuitBreakerConfig,
  WatcherConfig,
} from './resilience.js';
export { DEFAULT_PROXY_CONFIG } from './types.js';
export type { ProxyConfig, ProxyHealth, UpstreamTransport, ProxyAuthMode } from './types.js';
