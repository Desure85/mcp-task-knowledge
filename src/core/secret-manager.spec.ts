/**
 * core/secret-manager.spec.ts — Tests for SecretManager (SEC-004).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SecretManager, createSecretManager } from './secret-manager.js';

let testDir: string;
let testFile: string;

describe('SEC-004: SecretManager — env backend', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.TEST_API_KEY = 'env-secret-value';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('reads secrets from environment variables', async () => {
    const sm = new SecretManager({ backend: 'env' });
    expect(await sm.get('TEST_API_KEY')).toBe('env-secret-value');
  });

  it('returns undefined for missing env var', async () => {
    const sm = new SecretManager({ backend: 'env' });
    expect(await sm.get('NONEXISTENT_KEY')).toBeUndefined();
  });

  it('throws on set for env backend', async () => {
    const sm = new SecretManager({ backend: 'env' });
    await expect(sm.set('KEY', 'value')).rejects.toThrow('cannot set env vars');
  });

  it('throws on delete for env backend', async () => {
    const sm = new SecretManager({ backend: 'env' });
    await expect(sm.delete('KEY')).rejects.toThrow('delete not supported');
  });

  it('lists env vars that look like secrets', async () => {
    process.env.MY_API_KEY = 'val';
    process.env.MY_TOKEN = 'val';
    process.env.MY_SECRET = 'val';
    process.env.NORMAL_VAR = 'val';
    const sm = new SecretManager({ backend: 'env' });
    const keys = (await sm.list()).map((m) => m.key);
    expect(keys).toContain('TEST_API_KEY');
    expect(keys).toContain('MY_API_KEY');
    expect(keys).toContain('MY_TOKEN');
    expect(keys).toContain('MY_SECRET');
    expect(keys).not.toContain('NORMAL_VAR');
  });

  it('has() returns true for existing secret', async () => {
    const sm = new SecretManager({ backend: 'env' });
    expect(await sm.has('TEST_API_KEY')).toBe(true);
    expect(await sm.has('NONEXISTENT')).toBe(false);
  });

  it('currentBackend returns env', () => {
    expect(new SecretManager({ backend: 'env' }).currentBackend).toBe('env');
  });
});

describe('SEC-004: SecretManager — file backend', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `secrets-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    testFile = join(testDir, 'secrets.enc.json');
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('stores and retrieves a secret', async () => {
    const sm = new SecretManager({ backend: 'file', filePath: testFile, masterKey: 'test-key-123' });
    await sm.set('api_key', 'my-secret-value');
    expect(await sm.get('api_key')).toBe('my-secret-value');
  });

  it('encrypts values at rest', async () => {
    const sm = new SecretManager({ backend: 'file', filePath: testFile, masterKey: 'test-key-123' });
    await sm.set('api_key', 'my-secret-value');
    const content = readFileSync(testFile, 'utf8');
    expect(content).not.toContain('my-secret-value');
  });

  it('returns undefined for missing key', async () => {
    const sm = new SecretManager({ backend: 'file', filePath: testFile, masterKey: 'test-key-123' });
    expect(await sm.get('nonexistent')).toBeUndefined();
  });

  it('deletes a secret', async () => {
    const sm = new SecretManager({ backend: 'file', filePath: testFile, masterKey: 'test-key-123' });
    await sm.set('api_key', 'value');
    expect(await sm.has('api_key')).toBe(true);
    expect(await sm.delete('api_key')).toBe(true);
    expect(await sm.has('api_key')).toBe(false);
  });

  it('delete returns false for missing key', async () => {
    const sm = new SecretManager({ backend: 'file', filePath: testFile, masterKey: 'test-key-123' });
    expect(await sm.delete('nonexistent')).toBe(false);
  });

  it('overwrites existing secret', async () => {
    const sm = new SecretManager({ backend: 'file', filePath: testFile, masterKey: 'test-key-123' });
    await sm.set('api_key', 'old-value');
    await sm.set('api_key', 'new-value');
    expect(await sm.get('api_key')).toBe('new-value');
  });

  it('preserves createdAt on overwrite', async () => {
    const sm = new SecretManager({ backend: 'file', filePath: testFile, masterKey: 'test-key-123' });
    await sm.set('api_key', 'old-value');
    const createdAt1 = (await sm.list())[0].createdAt;
    await new Promise((r) => setTimeout(r, 10));
    await sm.set('api_key', 'new-value');
    const list2 = await sm.list();
    expect(list2[0].createdAt).toBe(createdAt1);
    expect(list2[0].updatedAt).not.toBe(createdAt1);
  });

  it('lists stored secrets with metadata', async () => {
    const sm = new SecretManager({ backend: 'file', filePath: testFile, masterKey: 'test-key-123' });
    await sm.set('key1', 'val1');
    await sm.set('key2', 'val2');
    const list = await sm.list();
    expect(list.length).toBe(2);
    expect(list.map((m) => m.key).sort()).toEqual(['key1', 'key2']);
    expect(list[0].backend).toBe('file');
  });

  it('persists across instances with same key', async () => {
    const sm1 = new SecretManager({ backend: 'file', filePath: testFile, masterKey: 'test-key-123' });
    await sm1.set('api_key', 'persisted-value');
    const sm2 = new SecretManager({ backend: 'file', filePath: testFile, masterKey: 'test-key-123' });
    expect(await sm2.get('api_key')).toBe('persisted-value');
  });

  it('fails to decrypt with wrong key', async () => {
    const sm1 = new SecretManager({ backend: 'file', filePath: testFile, masterKey: 'correct-key' });
    await sm1.set('api_key', 'secret');
    const sm2 = new SecretManager({ backend: 'file', filePath: testFile, masterKey: 'wrong-key' });
    expect(await sm2.get('api_key')).toBeUndefined();
  });

  it('currentBackend returns file', () => {
    const sm = new SecretManager({ backend: 'file', filePath: testFile, masterKey: 'key' });
    expect(sm.currentBackend).toBe('file');
  });
});

describe('SEC-004: SecretManager — docker backend', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `docker-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('reads secrets from Docker secrets directory', async () => {
    writeFileSync(join(testDir, 'api_key'), 'docker-secret-value\n');
    const sm = new SecretManager({ backend: 'docker', dockerSecretsDir: testDir });
    expect(await sm.get('api_key')).toBe('docker-secret-value');
  });

  it('returns undefined for missing Docker secret', async () => {
    const sm = new SecretManager({ backend: 'docker', dockerSecretsDir: testDir });
    expect(await sm.get('nonexistent')).toBeUndefined();
  });

  it('throws on set for docker backend', async () => {
    const sm = new SecretManager({ backend: 'docker', dockerSecretsDir: testDir });
    await expect(sm.set('KEY', 'value')).rejects.toThrow('cannot set Docker secrets');
  });

  it('lists Docker secrets', async () => {
    writeFileSync(join(testDir, 'key1'), 'val1');
    writeFileSync(join(testDir, 'key2'), 'val2');
    const sm = new SecretManager({ backend: 'docker', dockerSecretsDir: testDir });
    const list = await sm.list();
    expect(list.length).toBe(2);
    expect(list[0].backend).toBe('docker');
  });
});

describe('SEC-004: SecretManager — vault backend', () => {
  it('returns undefined for get (not implemented)', async () => {
    const sm = new SecretManager({ backend: 'vault', vaultUrl: 'http://localhost:8200' });
    expect(await sm.get('key')).toBeUndefined();
  });

  it('throws on set (not implemented)', async () => {
    const sm = new SecretManager({ backend: 'vault' });
    await expect(sm.set('key', 'value')).rejects.toThrow('vault backend not yet implemented');
  });

  it('returns empty list', async () => {
    const sm = new SecretManager({ backend: 'vault' });
    expect(await sm.list()).toEqual([]);
  });
});

describe('SEC-004: createSecretManager', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => { originalEnv = { ...process.env }; });
  afterEach(() => { process.env = originalEnv; });

  it('creates env backend by default', () => {
    delete process.env.SECRET_BACKEND;
    expect(createSecretManager().currentBackend).toBe('env');
  });

  it('creates file backend when SECRET_BACKEND=file', () => {
    process.env.SECRET_BACKEND = 'file';
    process.env.SECRET_FILE_PATH = join(process.cwd(), '.test-tmp', 'test-secrets.json');
    process.env.SECRET_MASTER_KEY = 'test-key';
    expect(createSecretManager().currentBackend).toBe('file');
  });

  it('creates docker backend when SECRET_BACKEND=docker', () => {
    process.env.SECRET_BACKEND = 'docker';
    expect(createSecretManager().currentBackend).toBe('docker');
  });
});
