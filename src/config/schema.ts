/**
 * config/schema.ts — Zod schema for unified configuration (CFG-001).
 *
 * Single source of truth for all config fields, their types, defaults,
 * and validation rules. Used by loader.ts to validate the merged config
 * from defaults → config file → env → CLI args.
 *
 * Hierarchy: defaults (here) → config file → env vars → CLI args
 *             (lowest priority)                          (highest)
 */

import { z } from 'zod';

// ─── Transport ───────────────────────────────────────────────────

export const TransportSchema = z.object({
  type: z.enum(['stdio', 'tcp', 'http']).default('stdio'),
  port: z.number().int().min(1).max(65535).default(3001),
  host: z.string().default('0.0.0.0'),
  // TCP/Unix specific
  tcpPort: z.number().int().min(1).max(65535).default(3002),
  tcpHost: z.string().default('0.0.0.0'),
  unixPath: z.string().default('/tmp/mcp-task-knowledge.sock'),
  handleSignals: z.boolean().default(true),
});

// ─── Session ─────────────────────────────────────────────────────

export const SessionSchema = z.object({
  maxSessions: z.number().int().min(1).default(1000),
  ttlMs: z.number().int().min(1000).default(86_400_000),       // 24h
  idleTimeoutMs: z.number().int().min(1000).default(1_800_000), // 30min
  pruneIntervalMs: z.number().int().min(1000).default(60_000),  // 1min
});

// ─── Auth ────────────────────────────────────────────────────────

export const AuthSchema = z.object({
  jwtSecret: z.string().optional(),
  jwtIssuer: z.string().optional(),
  jwtAudience: z.string().optional(),
  jwksUrl: z.string().url().optional(),
  tokenLeewaySec: z.number().int().min(0).default(60),
});

// ─── Rate Limiting ───────────────────────────────────────────────

export const RateLimitSchema = z.object({
  maxTokens: z.number().int().min(1).default(60),
  burstMaxTokens: z.number().int().min(1).default(100),
  refillPerSec: z.number().positive().default(1),
});

// ─── Logging ─────────────────────────────────────────────────────

export const LoggingSchema = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  format: z.enum(['json', 'pretty']).default('json'),
  startupBanner: z.boolean().default(true),
});

// ─── Metrics ─────────────────────────────────────────────────────

export const MetricsSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().int().min(1).max(65535).default(9090),
  path: z.string().default('/metrics'),
});

// ─── Embeddings ──────────────────────────────────────────────────

export const EmbeddingsSchema = z.object({
  mode: z.enum(['none', 'onnx-cpu', 'onnx-gpu']).default('onnx-gpu'),
  modelPath: z.string().optional(),
  dim: z.number().int().min(1).optional(),
  cacheDir: z.string().optional(),
  cacheMemLimitMB: z.number().int().min(1).default(128),
  persist: z.boolean().default(true),
  batchSize: z.number().int().min(1).default(16),
  maxLen: z.number().int().min(1).max(512).default(256),
});

// ─── Obsidian ────────────────────────────────────────────────────

export const ObsidianSchema = z.object({
  vaultRoot: z.string().default('/data/obsidian'),
});

// ─── Catalog ─────────────────────────────────────────────────────

export const CatalogSchema = z.object({
  enabled: z.boolean().default(false),
  readEnabled: z.boolean().default(true),
  writeEnabled: z.boolean().default(false),
  mode: z.enum(['embedded', 'remote', 'hybrid']).default('embedded'),
  prefer: z.enum(['embedded', 'remote']).default('embedded'),
  embedded: z.object({
    enabled: z.boolean().default(true),
    prefix: z.string().default('/catalog'),
    store: z.enum(['memory', 'file', 'sqlite']).default('memory'),
    filePath: z.string().optional(),
    sqliteDriver: z.enum(['auto', 'native', 'wasm']).optional(),
  }).default({}),
  remote: z.object({
    enabled: z.boolean().default(false),
    baseUrl: z.string().optional(),
    timeoutMs: z.number().int().min(100).default(2000),
  }).default({}),
  sync: z.object({
    enabled: z.boolean().default(false),
    intervalSec: z.number().int().min(1).default(60),
    direction: z.enum(['remote_to_embedded', 'embedded_to_remote', 'none']).default('remote_to_embedded'),
  }).default({}),
});

// ─── Tools ───────────────────────────────────────────────────────

export const ToolsSchema = z.object({
  enabled: z.boolean().default(true),
  strictDedup: z.boolean().default(false),
  resources: z.object({
    enabled: z.boolean().default(true),
    execEnabled: z.boolean().default(true),
  }).default({}),
});

// ─── Prompts ─────────────────────────────────────────────────────

export const PromptsSchema = z.object({
  buildEnabled: z.boolean().default(false),
});

// ─── Data ────────────────────────────────────────────────────────

export const DataSchema = z.object({
  dir: z.string().default('./data'),
  tasksDir: z.string().optional(),
  knowledgeDir: z.string().optional(),
  promptsDir: z.string().optional(),
  embeddingsDir: z.string().optional(),
  currentProject: z.string().default('mcp'),
});

// ─── Full Config ─────────────────────────────────────────────────
//
// Each section is optional with .default({}) so that ConfigSchema.parse({})
// fills in all nested defaults from the sub-schemas.

export const ConfigSchema = z.object({
  transport: TransportSchema.default({}),
  session: SessionSchema.default({}),
  auth: AuthSchema.default({}),
  rateLimit: RateLimitSchema.default({}),
  logging: LoggingSchema.default({}),
  metrics: MetricsSchema.default({}),
  embeddings: EmbeddingsSchema.default({}),
  obsidian: ObsidianSchema.default({}),
  catalog: CatalogSchema.default({}),
  tools: ToolsSchema.default({}),
  prompts: PromptsSchema.default({}),
  data: DataSchema.default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type TransportConfig = z.infer<typeof TransportSchema>;
export type SessionConfig = z.infer<typeof SessionSchema>;
export type AuthConfig = z.infer<typeof AuthSchema>;
export type RateLimitConfig = z.infer<typeof RateLimitSchema>;
export type LoggingConfig = z.infer<typeof LoggingSchema>;
export type MetricsConfig = z.infer<typeof MetricsSchema>;
export type EmbeddingsConfig = z.infer<typeof EmbeddingsSchema>;
export type CatalogConfig = z.infer<typeof CatalogSchema>;
export type ToolsConfig = z.infer<typeof ToolsSchema>;
export type DataConfig = z.infer<typeof DataSchema>;
