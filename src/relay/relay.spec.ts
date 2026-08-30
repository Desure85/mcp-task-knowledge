/**
 * relay/relay.spec.ts — Tests for LAN Relay (BM-012): crypto, discovery, manager.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { deriveKey, encrypt, decrypt } from './crypto.js';
import { LanDiscovery } from './discovery.js';
import { RelayManager } from './relay-manager.js';

describe('BM-012: relay crypto', () => {
  it('encrypt/decrypt round-trips', () => {
    const key = deriveKey('test-passphrase');
    const ciphertext = encrypt('hello relay', key);
    expect(decrypt(ciphertext, key)).toBe('hello relay');
  });

  it('different passphrases produce different keys', () => {
    const k1 = deriveKey('a');
    const k2 = deriveKey('b');
    expect(k1.equals(k2)).toBe(false);
  });

  it('tampered ciphertext fails decryption (GCM auth)', () => {
    const key = deriveKey('test');
    const ciphertext = encrypt('secret', key);
    const parts = ciphertext.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${Buffer.from('AAAA').toString('base64')}`;
    expect(() => decrypt(tampered, key)).toThrow();
  });

  it('wrong key fails decryption', () => {
    const ciphertext = encrypt('x', deriveKey('key-a'));
    expect(() => decrypt(ciphertext, deriveKey('key-b'))).toThrow();
  });
});

describe('BM-012: LanDiscovery', () => {
  let d1: LanDiscovery;
  let d2: LanDiscovery;

  afterEach(() => {
    d1?.stop();
    d2?.stop();
  });

  it('discovers peers on the same multicast group', async () => {
    d1 = new LanDiscovery({ name: 'peer-a', port: 41240, announceIntervalMs: 50, peerTtlMs: 500 });
    d2 = new LanDiscovery({ name: 'peer-b', port: 41240, announceIntervalMs: 50, peerTtlMs: 500 });
    d1.start();
    d2.start();

    // Wait for a few announce cycles
    await new Promise((r) => setTimeout(r, 300));

    const d1Peers = d1.peersList().map((p) => p.name);
    const d2Peers = d2.peersList().map((p) => p.name);
    expect(d1Peers).toContain('peer-b');
    expect(d2Peers).toContain('peer-a');
  });

  it('prunes stale peers after TTL', async () => {
    d1 = new LanDiscovery({ name: 'peer-a', port: 41241, announceIntervalMs: 1000, peerTtlMs: 200 });
    d2 = new LanDiscovery({ name: 'peer-b', port: 41241, announceIntervalMs: 50, peerTtlMs: 300 });
    d1.start();
    d2.start();

    await new Promise((r) => setTimeout(r, 200));
    expect(d2.peersList().map((p) => p.name)).toContain('peer-a');

    // Stop d1 — its announcements stop, d2 prunes it after its own TTL (300ms)
    d1.stop();
    await new Promise((r) => setTimeout(r, 500));
    expect(d2.peersList().map((p) => p.name)).not.toContain('peer-a');
  });
});

describe('BM-012: RelayManager', () => {
  let relay: RelayManager;

  afterEach(() => {
    relay?.stop();
  });

  it('starts with encryption aes-256-gcm and reports status', () => {
    relay = new RelayManager({ port: 0, sharedKey: 'test-key' });
    expect(relay.enabled).toBe(false);
    relay.start();
    const status = relay.status();
    expect(status.enabled).toBe(true);
    expect(status.encryption).toBe('aes-256-gcm');
    expect(status.connections).toBe(0);
  });

  it('shareBrief with no peers returns sent:0', () => {
    relay = new RelayManager({ port: 0, sharedKey: 'test-key' });
    relay.start();
    const result = relay.shareBrief({ hello: 'world' });
    expect(result.sent).toBe(0);
  });

  it('stop is idempotent and disables', () => {
    relay = new RelayManager({ port: 0, sharedKey: 'test-key' });
    relay.start();
    relay.stop();
    relay.stop();
    expect(relay.enabled).toBe(false);
  });
});
