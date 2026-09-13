/**
 * connectors/credentials.ts — Credential resolution helper (TR-26).
 *
 * Single place for connector credential lookup. Resolution order:
 *   1. `ctx.config[configKey]` — explicit per-connector config (highest priority)
 *   2. `ctx.secrets?.get(envName)` — SecretManager backend (env/file/docker/vault)
 *   3. `process.env[envName]` — direct env fallback for contexts without SecretManager
 *      (tests, third-party embedders, legacy callers)
 *
 * Returns `undefined` when no source yields a value.
 */

import type { ConnectorContext } from './types.js';

export async function resolveCredential(
  ctx: ConnectorContext,
  configKey: string,
  envName: string,
): Promise<string | undefined> {
  const fromConfig = ctx.config[configKey];
  if (typeof fromConfig === 'string' && fromConfig.length > 0) {
    return fromConfig;
  }
  const fromSecrets = await ctx.secrets?.get(envName);
  if (typeof fromSecrets === 'string' && fromSecrets.length > 0) {
    return fromSecrets;
  }
  const fromEnv = process.env[envName];
  return typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : undefined;
}
