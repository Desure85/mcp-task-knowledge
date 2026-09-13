/**
 * connectors/credentials.spec.ts — Tests for resolveCredential (TR-26)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { resolveCredential } from './credentials.js';
import type { ConnectorContext } from './types.js';
import { SecretManager } from '../core/secret-manager.js';

function makeCtx(overrides?: Partial<ConnectorContext>): ConnectorContext {
  return {
    config: {},
    registerTool: () => {},
    ...overrides,
  };
}

const ENV_KEY = 'TR26_TEST_CREDENTIAL';

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe('TR-26: resolveCredential', () => {
  it('returns config value when present (config wins over secrets and env)', async () => {
    process.env[ENV_KEY] = 'env-value';
    const secrets = new SecretManager({ backend: 'env' });
    const ctx = makeCtx({ config: { token: 'config-value' }, secrets });
    expect(await resolveCredential(ctx, 'token', ENV_KEY)).toBe('config-value');
  });

  it('uses SecretManager when config is empty', async () => {
    process.env[ENV_KEY] = 'secret-value';
    const secrets = new SecretManager({ backend: 'env' });
    const ctx = makeCtx({ secrets });
    expect(await resolveCredential(ctx, 'token', ENV_KEY)).toBe('secret-value');
  });

  it('falls back to process.env when no secrets manager', async () => {
    process.env[ENV_KEY] = 'env-fallback';
    const ctx = makeCtx();
    expect(await resolveCredential(ctx, 'token', ENV_KEY)).toBe('env-fallback');
  });

  it('returns undefined when nothing provides a value', async () => {
    const ctx = makeCtx();
    expect(await resolveCredential(ctx, 'token', ENV_KEY)).toBeUndefined();
  });

  it('skips empty-string config and falls through to secrets', async () => {
    process.env[ENV_KEY] = 'secret-value';
    const secrets = new SecretManager({ backend: 'env' });
    const ctx = makeCtx({ config: { token: '' }, secrets });
    expect(await resolveCredential(ctx, 'token', ENV_KEY)).toBe('secret-value');
  });
});
