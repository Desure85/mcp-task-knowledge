/**
 * config/index.ts — Unified configuration public API (CFG-001).
 *
 * Usage:
 *   import { config, configGet } from './config/index.js';
 *   config.transport.port    // → 3001
 *   configGet('session.ttlMs') // → 86400000
 *
 * The config object is frozen — cannot be mutated at runtime.
 * To change config, restart the server with new env/file/CLI args.
 */

export { loadUnifiedConfig, configGet, resetConfigCache } from './loader.js';
export type {
  Config,
  TransportConfig,
  SessionConfig,
  AuthConfig,
  RateLimitConfig,
  LoggingConfig,
  MetricsConfig,
  EmbeddingsConfig,
  CatalogConfig,
  ToolsConfig,
  DataConfig,
} from './schema.js';

import { loadUnifiedConfig } from './loader.js';
import type { Config } from './schema.js';

/**
 * Frozen, validated configuration object.
 * Loaded once on first access (lazy singleton).
 */
export const config: Config = loadUnifiedConfig();
