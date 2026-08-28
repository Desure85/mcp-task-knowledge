/**
 * config/loader.ts — Unified config loader (CFG-001).
 *
 * Merges config from 4 sources (lowest → highest priority):
 *   1. Schema defaults (defined in schema.ts via .default())
 *   2. Config file (JSON from --config path or MCP_CONFIG_JSON env)
 *   3. Environment variables (mapped to schema paths)
 *   4. CLI args (--transport, --port, --host, --config)
 *
 * Result: a single validated, frozen Config object.
 *
 * API:
 *   import { loadUnifiedConfig } from './config/loader.js';
 *   const config = loadUnifiedConfig();
 *   config.transport.port    // → 3001
 *   config.session.ttlMs     // → 86400000
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigSchema, type Config } from './schema.js';

// ─── Env var → schema path mapping ───────────────────────────────
//
// Each entry: { env: string, path: string[], parse?: (v: string) => unknown }
// Maps an env var to a dot-path in the config schema.
// Booleans: '1','true','yes','on' → true; everything else → false.

function parseBool(v: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function parseNum(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

interface EnvMapping {
  env: string;
  path: string[];
  parse?: (v: string) => unknown;
}

const ENV_MAP: EnvMapping[] = [
  // Transport
  { env: 'MCP_TRANSPORT', path: ['transport', 'type'] },
  { env: 'MCP_PORT', path: ['transport', 'port'], parse: parseNum },
  { env: 'MCP_HOST', path: ['transport', 'host'] },
  { env: 'MCP_TCP_PORT', path: ['transport', 'tcpPort'], parse: parseNum },
  { env: 'MCP_TCP_HOST', path: ['transport', 'tcpHost'] },
  { env: 'MCP_UNIX_PATH', path: ['transport', 'unixPath'] },

  // Session
  { env: 'MCP_MAX_SESSIONS', path: ['session', 'maxSessions'], parse: parseNum },
  { env: 'MCP_SESSION_TTL_MS', path: ['session', 'ttlMs'], parse: parseNum },
  { env: 'MCP_IDLE_TIMEOUT_MS', path: ['session', 'idleTimeoutMs'], parse: parseNum },
  { env: 'MCP_PRUNE_INTERVAL_MS', path: ['session', 'pruneIntervalMs'], parse: parseNum },

  // Auth
  { env: 'JWT_SECRET', path: ['auth', 'jwtSecret'] },
  { env: 'JWT_ISSUER', path: ['auth', 'jwtIssuer'] },
  { env: 'JWT_AUDIENCE', path: ['auth', 'jwtAudience'] },
  { env: 'JWKS_URL', path: ['auth', 'jwksUrl'] },

  // Rate limit
  { env: 'MCP_RATE_LIMIT_MAX_TOKENS', path: ['rateLimit', 'maxTokens'], parse: parseNum },
  { env: 'MCP_RATE_LIMIT_BURST_MAX_TOKENS', path: ['rateLimit', 'burstMaxTokens'], parse: parseNum },
  { env: 'MCP_RATE_LIMIT_REFILL_PER_SEC', path: ['rateLimit', 'refillPerSec'], parse: parseNum },

  // Logging
  { env: 'LOG_LEVEL', path: ['logging', 'level'] },
  { env: 'LOG_FORMAT', path: ['logging', 'format'] },
  { env: 'LOG_STARTUP', path: ['logging', 'startupBanner'], parse: parseBool },

  // Metrics
  { env: 'METRICS_ENABLED', path: ['metrics', 'enabled'], parse: parseBool },
  { env: 'METRICS_PORT', path: ['metrics', 'port'], parse: parseNum },

  // Embeddings
  { env: 'EMBEDDINGS_MODE', path: ['embeddings', 'mode'] },
  { env: 'EMBEDDINGS_MODEL_PATH', path: ['embeddings', 'modelPath'] },
  { env: 'EMBEDDINGS_DIM', path: ['embeddings', 'dim'], parse: parseNum },
  { env: 'EMBEDDINGS_CACHE_DIR', path: ['embeddings', 'cacheDir'] },
  { env: 'EMBEDDINGS_MEM_LIMIT_MB', path: ['embeddings', 'cacheMemLimitMB'], parse: parseNum },
  { env: 'EMBEDDINGS_PERSIST', path: ['embeddings', 'persist'], parse: parseBool },
  { env: 'EMBEDDINGS_BATCH_SIZE', path: ['embeddings', 'batchSize'], parse: parseNum },
  { env: 'EMBEDDINGS_MAX_LEN', path: ['embeddings', 'maxLen'], parse: parseNum },

  // Obsidian
  { env: 'OBSIDIAN_VAULT_ROOT', path: ['obsidian', 'vaultRoot'] },

  // Catalog
  { env: 'CATALOG_ENABLED', path: ['catalog', 'enabled'], parse: parseBool },
  { env: 'CATALOG_READ_ENABLED', path: ['catalog', 'readEnabled'], parse: parseBool },
  { env: 'CATALOG_WRITE_ENABLED', path: ['catalog', 'writeEnabled'], parse: parseBool },
  { env: 'CATALOG_MODE', path: ['catalog', 'mode'] },
  { env: 'CATALOG_PREFER', path: ['catalog', 'prefer'] },
  { env: 'CATALOG_EMBEDDED_ENABLED', path: ['catalog', 'embedded', 'enabled'], parse: parseBool },
  { env: 'CATALOG_EMBEDDED_PREFIX', path: ['catalog', 'embedded', 'prefix'] },
  { env: 'CATALOG_EMBEDDED_STORE', path: ['catalog', 'embedded', 'store'] },
  { env: 'CATALOG_EMBEDDED_FILE_PATH', path: ['catalog', 'embedded', 'filePath'] },
  { env: 'CATALOG_EMBEDDED_SQLITE_DRIVER', path: ['catalog', 'embedded', 'sqliteDriver'] },
  { env: 'CATALOG_REMOTE_ENABLED', path: ['catalog', 'remote', 'enabled'], parse: parseBool },
  { env: 'CATALOG_URL', path: ['catalog', 'remote', 'baseUrl'] },
  { env: 'CATALOG_REMOTE_BASE_URL', path: ['catalog', 'remote', 'baseUrl'] },
  { env: 'CATALOG_REMOTE_TIMEOUT_MS', path: ['catalog', 'remote', 'timeoutMs'], parse: parseNum },
  { env: 'CATALOG_SYNC_ENABLED', path: ['catalog', 'sync', 'enabled'], parse: parseBool },
  { env: 'CATALOG_SYNC_INTERVAL_SEC', path: ['catalog', 'sync', 'intervalSec'], parse: parseNum },
  { env: 'CATALOG_SYNC_DIRECTION', path: ['catalog', 'sync', 'direction'] },

  // Tools
  { env: 'MCP_TOOLS_ENABLED', path: ['tools', 'enabled'], parse: parseBool },
  { env: 'MCP_STRICT_TOOL_DEDUP', path: ['tools', 'strictDedup'], parse: parseBool },
  { env: 'MCP_TOOL_RESOURCES_ENABLED', path: ['tools', 'resources', 'enabled'], parse: parseBool },
  { env: 'MCP_TOOL_RESOURCES_EXEC', path: ['tools', 'resources', 'execEnabled'], parse: parseBool },

  // Prompts
  { env: 'PROMPTS_BUILD_ENABLED', path: ['prompts', 'buildEnabled'], parse: parseBool },

  // Data
  { env: 'DATA_DIR', path: ['data', 'dir'] },
  { env: 'MCP_TASK_DIR', path: ['data', 'tasksDir'] },
  { env: 'MCP_KNOWLEDGE_DIR', path: ['data', 'knowledgeDir'] },
  { env: 'MCP_PROMPTS_DIR', path: ['data', 'promptsDir'] },
  { env: 'CURRENT_PROJECT', path: ['data', 'currentProject'] },
];

// ─── CLI arg parsing ─────────────────────────────────────────────

function getCliArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return undefined;
}

// ─── Deep merge ──────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, override: unknown): T {
  if (override === undefined || override === null) return base;
  if (isPlainObject(base) && isPlainObject(override)) {
    const result: Record<string, unknown> = { ...base };
    for (const [key, val] of Object.entries(override)) {
      result[key] = deepMerge((base as Record<string, unknown>)[key], val);
    }
    return result as T;
  }
  return override as T;
}

// ─── Apply env vars to config object ─────────────────────────────

function applyEnvToObj(obj: Record<string, unknown>): void {
  for (const mapping of ENV_MAP) {
    const val = process.env[mapping.env];
    if (val === undefined || val === '') continue;

    let parsed: unknown = mapping.parse ? mapping.parse(val) : val;
    if (mapping.parse === parseNum && Number.isNaN(parsed)) continue;

    // Navigate to the parent object
    let current: Record<string, unknown> = obj;
    for (let i = 0; i < mapping.path.length - 1; i++) {
      const key = mapping.path[i];
      if (!isPlainObject(current[key])) {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }
    current[mapping.path[mapping.path.length - 1]] = parsed;
  }
}

// ─── Load config file ────────────────────────────────────────────

function loadConfigFile(): Record<string, unknown> {
  const cliPath = getCliArg('--config');
  if (cliPath) {
    try {
      return JSON.parse(readFileSync(resolve(cliPath), 'utf8'));
    } catch {
      // fall through to env
    }
  }

  const jsonEnv = process.env.MCP_CONFIG_JSON;
  if (jsonEnv) {
    try {
      return JSON.parse(jsonEnv);
    } catch {
      // fall through
    }
  }

  return {};
}

// ─── Main loader ─────────────────────────────────────────────────

let cachedConfig: Config | null = null;

export function loadUnifiedConfig(): Config {
  if (cachedConfig) return cachedConfig;

  // 1. Start with schema defaults (Zod .default() values)
  const defaults = ConfigSchema.parse({});

  // 2. Merge config file (overrides defaults)
  const fileConfig = loadConfigFile();
  const merged = deepMerge(defaults, fileConfig);

  // 3. Apply env vars (overrides file config)
  applyEnvToObj(merged as Record<string, unknown>);

  // 4. CLI args (highest priority, except --config which is already handled)
  const cliTransport = getCliArg('--transport');
  if (cliTransport) {
    (merged as Record<string, unknown>).transport = {
      ...((merged as Record<string, unknown>).transport as Record<string, unknown>),
      type: cliTransport,
    };
  }
  const cliPort = getCliArg('--port');
  if (cliPort) {
    const port = parseNum(cliPort);
    if (!Number.isNaN(port)) {
      (merged as Record<string, unknown>).transport = {
        ...((merged as Record<string, unknown>).transport as Record<string, unknown>),
        port,
      };
    }
  }
  const cliHost = getCliArg('--host');
  if (cliHost) {
    (merged as Record<string, unknown>).transport = {
      ...((merged as Record<string, unknown>).transport as Record<string, unknown>),
      host: cliHost,
    };
  }

  // 5. Validate with Zod (fills defaults for missing fields, validates types)
  const validated = ConfigSchema.parse(merged);

  // 6. Freeze to prevent runtime mutation
  cachedConfig = Object.freeze(validated) as Config;

  return cachedConfig;
}

/**
 * Get a config value by dot-path: configGet('transport.port')
 * Convenience wrapper for the unified config.
 */
export function configGet(path: string): unknown {
  const config = loadUnifiedConfig();
  const parts = path.split('.');
  let current: unknown = config;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ─── Reset for testing ───────────────────────────────────────────

export function resetConfigCache(): void {
  cachedConfig = null;
}
