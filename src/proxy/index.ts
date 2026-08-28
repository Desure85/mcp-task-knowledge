/**
 * proxy/index.ts — Public API for Thin Proxy module (P-001, P-002).
 */

export { ProxyBootstrap } from './bootstrap.js';
export { ProxyMirror, jsonSchemaToZod, jsonSchemaToShape } from './mirror.js';
export type { MirrorStats } from './mirror.js';
export { DEFAULT_PROXY_CONFIG } from './types.js';
export type { ProxyConfig, ProxyHealth, UpstreamTransport, ProxyAuthMode } from './types.js';
