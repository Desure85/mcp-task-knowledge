/**
 * proxy/index.ts — Public API for Thin Proxy module (P-001).
 */

export { ProxyBootstrap } from './bootstrap.js';
export { DEFAULT_PROXY_CONFIG } from './types.js';
export type { ProxyConfig, ProxyHealth, UpstreamTransport, ProxyAuthMode } from './types.js';
