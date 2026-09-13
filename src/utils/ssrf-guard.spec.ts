/**
 * utils/ssrf-guard.spec.ts — Tests for TR-28 webhook SSRF guard.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import dns from 'node:dns';
import { checkWebhookUrl, checkWebhookUrlResolved, isPrivateIPv4, isPrivateIPv6 } from './ssrf-guard.js';

const ENV_KEYS = ['WEBHOOK_ALLOWED_HOSTS', 'WEBHOOK_ALLOW_PRIVATE'] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

describe('checkWebhookUrl — scheme allowlist', () => {
  it('accepts https', () => {
    const r = checkWebhookUrl('https://example.com/hook');
    expect(r.ok).toBe(true);
  });

  it('accepts http (dev)', () => {
    const r = checkWebhookUrl('http://example.com/hook');
    expect(r.ok).toBe(true);
  });

  it.each(['file:///etc/passwd', 'ftp://example.com/x', 'gopher://x/', 'data:text/plain,hi', 'javascript:alert(1)'])(
    'rejects %s',
    (u) => {
      const r = checkWebhookUrl(u);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/scheme/);
    },
  );

  it('rejects unparseable URL', () => {
    const r = checkWebhookUrl('not a url');
    expect(r.ok).toBe(false);
  });
});

describe('checkWebhookUrl — private IPv4', () => {
  it.each([
    'http://127.0.0.1/',
    'http://127.1/',
    'http://10.0.0.1/',
    'http://10.255.255.255/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://0.0.0.0/',
    'http://100.64.0.1/',
  ])('blocks %s', (u) => {
    const r = checkWebhookUrl(u);
    expect(r.ok).toBe(false);
  });

  it.each([
    'http://8.8.8.8/',
    'http://1.1.1.1/',
    'http://172.15.0.1/', // just below 172.16/12
    'http://172.32.0.1/', // just above 172.16/12
    'http://11.0.0.1/',
    'http://192.169.0.1/',
    'http://100.63.255.255/', // below CGNAT
    'http://100.128.0.1/', // above CGNAT
  ])('allows public %s', (u) => {
    const r = checkWebhookUrl(u);
    expect(r.ok).toBe(true);
  });
});

describe('checkWebhookUrl — obfuscated IPv4', () => {
  it.each([
    'http://2130706433/', // 127.0.0.1 as integer
    'http://0x7f000001/', // hex
    'http://0177.0.0.1/', // octal-ish
    'http://0x7f.1/',
  ])('blocks %s (normalized by URL parser or defensive check)', (u) => {
    const r = checkWebhookUrl(u);
    expect(r.ok).toBe(false);
  });
});

describe('checkWebhookUrl — IPv6', () => {
  it.each([
    'http://[::1]/',
    'http://[::]/',
    'http://[fe80::1]/',
    'http://[fc00::1]/',
    'http://[fd00::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:10.0.0.1]/',
    'http://[::ffff:169.254.169.254]/',
  ])('blocks %s', (u) => {
    const r = checkWebhookUrl(u);
    expect(r.ok).toBe(false);
  });

  it('allows public IPv6', () => {
    const r = checkWebhookUrl('http://[2606:4700:4700::1111]/');
    expect(r.ok).toBe(true);
  });

  it('allows public IPv4-mapped IPv6', () => {
    const r = checkWebhookUrl('http://[::ffff:8.8.8.8]/');
    expect(r.ok).toBe(true);
  });
});

describe('checkWebhookUrl — local hostnames', () => {
  it.each([
    'http://localhost/',
    'http://LOCALHOST/',
    'http://localhost./',
    'http://evil.localhost/',
    'http://printer.local/',
  ])('blocks %s', (u) => {
    const r = checkWebhookUrl(u);
    expect(r.ok).toBe(false);
  });

  it('allows localhost.evil.com (not a .localhost suffix)', () => {
    const r = checkWebhookUrl('http://localhost.evil.com/');
    expect(r.ok).toBe(true);
  });
});

describe('checkWebhookUrl — env config', () => {
  it('WEBHOOK_ALLOWED_HOSTS bypasses private block for listed host', () => {
    process.env.WEBHOOK_ALLOWED_HOSTS = 'internal.example.com, 127.0.0.1';
    expect(checkWebhookUrl('http://127.0.0.1/hook').ok).toBe(true);
    expect(checkWebhookUrl('http://internal.example.com/').ok).toBe(true);
    // non-listed private still blocked
    expect(checkWebhookUrl('http://10.0.0.1/').ok).toBe(false);
  });

  it('WEBHOOK_ALLOWED_HOSTS does not bypass scheme check', () => {
    process.env.WEBHOOK_ALLOWED_HOSTS = 'example.com';
    expect(checkWebhookUrl('file:///etc/passwd').ok).toBe(false);
  });

  it('WEBHOOK_ALLOW_PRIVATE=1 allows private hosts', () => {
    process.env.WEBHOOK_ALLOW_PRIVATE = '1';
    expect(checkWebhookUrl('http://127.0.0.1/').ok).toBe(true);
    expect(checkWebhookUrl('http://localhost/').ok).toBe(true);
    expect(checkWebhookUrl('http://169.254.169.254/').ok).toBe(true);
  });

  it('opts.allowedHosts works without env', () => {
    const r = checkWebhookUrl('http://127.0.0.1/', { allowedHosts: ['127.0.0.1'] });
    expect(r.ok).toBe(true);
  });

  it('opts.allowPrivate works without env', () => {
    const r = checkWebhookUrl('http://127.0.0.1/', { allowPrivate: true });
    expect(r.ok).toBe(true);
  });
});

describe('checkWebhookUrlResolved — DNS layer', () => {
  it('blocks when hostname resolves to a private address', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
      { address: '169.254.169.254', family: 4 },
    ] as never);
    const r = await checkWebhookUrlResolved('http://metadata.evil.example/');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/private address/);
  });

  it('blocks when ANY of multiple resolved addresses is private', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ] as never);
    const r = await checkWebhookUrlResolved('http://roundrobin.evil.example/');
    expect(r.ok).toBe(false);
  });

  it('blocks on private IPv6 resolution', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
      { address: 'fd00::1', family: 6 },
    ] as never);
    const r = await checkWebhookUrlResolved('http://v6.evil.example/');
    expect(r.ok).toBe(false);
  });

  it('passes when all resolved addresses are public', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ] as never);
    const r = await checkWebhookUrlResolved('http://example.com/');
    expect(r.ok).toBe(true);
  });

  it('fails closed on DNS lookup error', async () => {
    vi.spyOn(dns.promises, 'lookup').mockRejectedValue(new Error('ENOTFOUND'));
    const r = await checkWebhookUrlResolved('http://nonexistent.invalid/');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/DNS lookup failed/);
  });

  it('skips DNS for literal IPs (still blocked if private)', async () => {
    const spy = vi.spyOn(dns.promises, 'lookup');
    const r = await checkWebhookUrlResolved('http://127.0.0.1/');
    expect(r.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('skips DNS for allowlisted hosts', async () => {
    const spy = vi.spyOn(dns.promises, 'lookup');
    const r = await checkWebhookUrlResolved('http://internal.corp/', { allowedHosts: ['internal.corp'] });
    expect(r.ok).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('IP helpers', () => {
  it('isPrivateIPv4 boundaries', () => {
    expect(isPrivateIPv4('172.15.255.255')).toBe(false);
    expect(isPrivateIPv4('172.16.0.0')).toBe(true);
    expect(isPrivateIPv4('172.31.255.255')).toBe(true);
    expect(isPrivateIPv4('172.32.0.0')).toBe(false);
    expect(isPrivateIPv4('100.63.255.255')).toBe(false);
    expect(isPrivateIPv4('100.64.0.0')).toBe(true);
    expect(isPrivateIPv4('100.127.255.255')).toBe(true);
    expect(isPrivateIPv4('100.128.0.0')).toBe(false);
  });

  it('isPrivateIPv6 forms', () => {
    expect(isPrivateIPv6('::1')).toBe(true);
    expect(isPrivateIPv6('::')).toBe(true);
    expect(isPrivateIPv6('fe80::1')).toBe(true);
    expect(isPrivateIPv6('fc00::1')).toBe(true);
    expect(isPrivateIPv6('fdff::1')).toBe(true);
    expect(isPrivateIPv6('::ffff:7f00:1')).toBe(true);
    expect(isPrivateIPv6('::ffff:808:808')).toBe(false);
    expect(isPrivateIPv6('2606:4700:4700::1111')).toBe(false);
  });
});
