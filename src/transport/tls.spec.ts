/**
 * transport/tls.spec.ts — Tests for TLS/mTLS support (SEC-002).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TlsContext, createTlsContext } from './tls.js';

// ─── Self-signed cert generator (for tests) ───────────────────────

function generateSelfSignedCert(commonName = 'test'): { cert: string; key: string } {
  // Use openssl to generate a real self-signed certificate
  const dir = join(process.cwd(), '.test-tmp', `certgen-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const certPath = join(dir, 'cert.pem');
  const keyPath = join(dir, 'key.pem');
  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 1 -nodes -subj "/CN=${commonName}" 2>/dev/null`,
    );
    const cert = readFileSync(certPath, 'utf8');
    const key = readFileSync(keyPath, 'utf8');
    return { cert, key };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

let testDir: string;
let certPath: string;
let keyPath: string;
let caPath: string;

describe('SEC-002: TlsContext — basic', () => {
  it('is disabled by default', () => {
    const ctx = new TlsContext();
    expect(ctx.isEnabled).toBe(false);
    expect(ctx.isMtlsEnabled).toBe(false);
  });

  it('isEnabled when cert and key paths provided', () => {
    const ctx = new TlsContext({ cert: '/fake/cert.pem', key: '/fake/key.pem' });
    // isEnabled checks paths are provided, not that files exist
    expect(ctx.isEnabled).toBe(true);
  });

  it('isMtlsEnabled when requestCert is true', () => {
    const ctx = new TlsContext({ cert: '/fake/cert.pem', key: '/fake/key.pem', requestCert: true });
    expect(ctx.isMtlsEnabled).toBe(true);
  });

  it('isMtlsEnabled is false when requestCert is false', () => {
    const ctx = new TlsContext({ cert: '/fake/cert.pem', key: '/fake/key.pem', requestCert: false });
    expect(ctx.isMtlsEnabled).toBe(false);
  });

  it('throws when accessing context if not enabled', () => {
    const ctx = new TlsContext();
    expect(() => ctx.context).toThrow('TLS is not enabled');
  });

  it('throws when createServerOptions if not enabled', () => {
    const ctx = new TlsContext();
    expect(() => ctx.createServerOptions()).toThrow('TLS is not enabled');
  });
});

describe('SEC-002: TlsContext — with real cert files', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `tls-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    const { cert, key } = generateSelfSignedCert('test-server');
    certPath = join(testDir, 'cert.pem');
    keyPath = join(testDir, 'key.pem');
    writeFileSync(certPath, cert);
    writeFileSync(keyPath, key);
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('loads cert and key from files', () => {
    const ctx = new TlsContext({ cert: certPath, key: keyPath });
    expect(ctx.isEnabled).toBe(true);
    expect(() => ctx.context).not.toThrow();
  });

  it('creates server options with secureContext', () => {
    const ctx = new TlsContext({ cert: certPath, key: keyPath });
    const options = ctx.createServerOptions();
    expect(options.secureContext).toBeDefined();
    expect(options.requestCert).toBe(false);
    expect(options.rejectUnauthorized).toBe(true);
  });

  it('creates server options with mTLS enabled', () => {
    const ctx = new TlsContext({
      cert: certPath, key: keyPath,
      requestCert: true,
      rejectUnauthorized: true,
    });
    const options = ctx.createServerOptions();
    expect(options.requestCert).toBe(true);
    expect(options.rejectUnauthorized).toBe(true);
  });

  it('creates client options', () => {
    const ctx = new TlsContext({ cert: certPath, key: keyPath, ca: certPath });
    const options = ctx.createClientOptions();
    expect(options.rejectUnauthorized).toBe(true);
    expect(options.ca).toBeDefined();
    expect(options.cert).toBeDefined();
    expect(options.key).toBeDefined();
  });

  it('sets ALPN protocols', () => {
    const ctx = new TlsContext({
      cert: certPath, key: keyPath,
      alpnProtocols: ['h2', 'http/1.1'],
    });
    const options = ctx.createServerOptions();
    expect(options.ALPNProtocols).toEqual(['h2', 'http/1.1']);
  });

  it('sets minVersion', () => {
    const ctx = new TlsContext({
      cert: certPath, key: keyPath,
      minVersion: 'TLSv1.3',
    });
    const options = ctx.createServerOptions();
    expect(options.minVersion).toBe('TLSv1.3');
  });

  it('reloads context', () => {
    const ctx = new TlsContext({ cert: certPath, key: keyPath });
    expect(ctx.getStats().reloadCount).toBe(1); // initial load

    ctx.reload();
    expect(ctx.getStats().reloadCount).toBe(2);
    expect(ctx.getStats().lastReloadedAt).toBeDefined();
  });

  it('updates config and reloads', () => {
    const ctx = new TlsContext({ cert: certPath, key: keyPath });
    expect(ctx.getStats().reloadCount).toBe(1);

    // Generate new cert
    const { cert: cert2, key: key2 } = generateSelfSignedCert('test-server-2');
    const certPath2 = join(testDir, 'cert2.pem');
    const keyPath2 = join(testDir, 'key2.pem');
    writeFileSync(certPath2, cert2);
    writeFileSync(keyPath2, key2);

    ctx.updateConfig({ cert: certPath2, key: keyPath2 });
    expect(ctx.getStats().reloadCount).toBe(2);
    expect(ctx.getStats().certPath).toBe(certPath2);
  });

  it('verifyClientCert returns true without allowlist', () => {
    const ctx = new TlsContext({ cert: certPath, key: keyPath });
    expect(ctx.verifyClientCert('any-subject')).toBe(true);
  });

  it('verifyClientCert checks allowlist', () => {
    const ctx = new TlsContext({
      cert: certPath, key: keyPath,
      authorizedSubjects: ['allowed-client'],
    });
    expect(ctx.verifyClientCert('allowed-client')).toBe(true);
    expect(ctx.verifyClientCert('blocked-client')).toBe(false);
  });

  it('getStats returns correct info', () => {
    const ctx = new TlsContext({
      cert: certPath, key: keyPath,
      requestCert: true,
    });
    const stats = ctx.getStats();
    expect(stats.enabled).toBe(true);
    expect(stats.mtlsEnabled).toBe(true);
    expect(stats.reloadCount).toBe(1);
    expect(stats.certPath).toBe(certPath);
    expect(stats.keyPath).toBe(keyPath);
  });

  it('dispose cleans up context', () => {
    const ctx = new TlsContext({ cert: certPath, key: keyPath });
    ctx.dispose();
    // After dispose, accessing context should throw
    expect(() => ctx.context).toThrow();
  });
});

describe('SEC-002: TlsContext — hot reload', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `tls-hot-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    const { cert, key } = generateSelfSignedCert('test-hot');
    certPath = join(testDir, 'cert.pem');
    keyPath = join(testDir, 'key.pem');
    writeFileSync(certPath, cert);
    writeFileSync(keyPath, key);
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('starts watching when hotReload is true', () => {
    const ctx = new TlsContext({ cert: certPath, key: keyPath, hotReload: true });
    ctx.stopWatching(); // cleanup
    // Just verify it doesn't throw
    expect(ctx.isEnabled).toBe(true);
  });

  it('stopWatching is safe to call multiple times', () => {
    const ctx = new TlsContext({ cert: certPath, key: keyPath });
    ctx.stopWatching();
    ctx.stopWatching();
  });
});

describe('SEC-002: createTlsContext', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => { originalEnv = { ...process.env }; });
  afterEach(() => { process.env = originalEnv; });

  it('creates disabled context by default', () => {
    delete process.env.TLS_CERT_PATH;
    delete process.env.TLS_KEY_PATH;
    const ctx = createTlsContext();
    expect(ctx.isEnabled).toBe(false);
  });

  it('creates enabled context with env vars', () => {
    process.env.TLS_CERT_PATH = '/fake/cert.pem';
    process.env.TLS_KEY_PATH = '/fake/key.pem';
    const ctx = createTlsContext();
    expect(ctx.isEnabled).toBe(true);
  });

  it('enables mTLS with TLS_REQUEST_CERT', () => {
    process.env.TLS_CERT_PATH = '/fake/cert.pem';
    process.env.TLS_KEY_PATH = '/fake/key.pem';
    process.env.TLS_REQUEST_CERT = 'true';
    const ctx = createTlsContext();
    expect(ctx.isMtlsEnabled).toBe(true);
  });
});
