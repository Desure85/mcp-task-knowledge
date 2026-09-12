/**
 * DX-29 — SetupLinkStore + buildSetupMarkdown unit tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SetupLinkStore, buildSetupMarkdown } from '../src/core/setup-link.js';
import { TokenManager } from '../src/core/token-manager.js';

const issuer = () => 'token-' + Math.random().toString(36).slice(2);

function makeStore(extra?: Partial<ConstructorParameters<typeof SetupLinkStore>[0]>) {
  return new SetupLinkStore({
    tokenIssuer: issuer,
    cleanupIntervalMs: 0,
    ...extra,
  });
}

describe('SetupLinkStore', () => {
  let store: SetupLinkStore;
  beforeEach(() => { store = makeStore(); });
  afterEach(() => { store.close(); });

  it('creates a link with uuid otp, token, project, role, ~15min expiry', async () => {
    const link = await store.create({ project: 'p1', createdBy: 'admin' });
    expect(link.otp).toMatch(/^[0-9a-f-]{36}$/);
    expect(link.token).toBeTruthy();
    expect(link.project).toBe('p1');
    expect(link.role).toBe('agent');
    expect(link.expiresAt - link.createdAt).toBe(15 * 60 * 1000);
    expect(link.used).toBe(false);
  });

  it('redeem returns the link once, then 410 used', async () => {
    const link = await store.create({ project: 'p1', createdBy: 'a' });
    const first = store.redeem(link.otp);
    expect(first.status).toBe('ok');
    if (first.status === 'ok') expect(first.link.token).toBe(link.token);
    const second = store.redeem(link.otp);
    expect(second.status).toBe('gone');
    if (second.status === 'gone') expect(second.reason).toBe('used');
  });

  it('redeem of unknown otp → not_found', () => {
    const r = store.redeem('00000000-0000-0000-0000-000000000000');
    expect(r.status).toBe('gone');
    if (r.status === 'gone') expect(r.reason).toBe('not_found');
  });

  it('expired link → gone expired', async () => {
    vi.useFakeTimers();
    try {
      const link = await store.create({ project: 'p', createdBy: 'a', ttlMs: 1000 });
      vi.advanceTimersByTime(2000);
      const r = store.redeem(link.otp);
      expect(r.status).toBe('gone');
      if (r.status === 'gone') expect(r.reason).toBe('expired');
    } finally {
      vi.useRealTimers();
    }
  });

  it('invalidates OTP after >5 failed attempts on a used link', async () => {
    const link = await store.create({ project: 'p', createdBy: 'a' });
    store.redeem(link.otp);
    // 5 hits → still 'used'; 6th → invalidated
    for (let i = 0; i < 5; i++) {
      const r = store.redeem(link.otp);
      expect(r.status).toBe('gone');
      if (r.status === 'gone') expect(r.reason).toBe('used');
    }
    const r6 = store.redeem(link.otp);
    expect(r6.status).toBe('gone');
    if (r6.status === 'gone') expect(r6.reason).toBe('invalidated');
    expect(store.peek(link.otp)).toBeUndefined();
  });

  it('cleanup removes expired links', async () => {
    vi.useFakeTimers();
    try {
      await store.create({ project: 'p', createdBy: 'a', ttlMs: 500 });
      vi.advanceTimersByTime(1000);
      expect(store.cleanup()).toBe(1);
      expect(store.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('audit logger records create + redeem', async () => {
    const record = vi.fn();
    const s = makeStore({ auditLogger: { record } as never });
    const link = await s.create({ project: 'p', createdBy: 'a' });
    s.redeem(link.otp, '1.2.3.4');
    expect(record).toHaveBeenCalledWith('config.change', 'success', 'setup_link.create', expect.anything());
    expect(record).toHaveBeenCalledWith('config.change', 'success', 'setup_link.redeem', expect.objectContaining({ clientIp: '1.2.3.4' }));
    s.close();
  });

  it('token issued via TokenManager validates through its validator', async () => {
    const tm = new TokenManager({ cleanupIntervalMs: 0 });
    const s = makeStore({
      tokenIssuer: (o) => tm.issue(o.userId, o.roles, { metadata: o.metadata }).accessToken,
    });
    const link = await s.create({ project: 'proj-x', role: 'agent', createdBy: 'a' });
    const validator = tm.createValidator();
    const res = await validator(link.token);
    expect(res).not.toBeNull();
    expect(res!.roles).toContain('agent');
    expect(res!.metadata?.project).toBe('proj-x');
    s.close();
    tm.close();
  });
});

describe('buildSetupMarkdown', () => {
  const link = {
    otp: 'o', token: 'TOK', project: 'demo', role: 'agent',
    expiresAt: Date.now() + 900_000, used: true, failedAttempts: 0,
    createdAt: Date.now(), createdBy: 'a',
  };

  it('http doc contains URL, token, project', () => {
    const md = buildSetupMarkdown(link, { serverUrl: 'http://h:3001', transport: 'http', toolCount: 100 });
    expect(md).toContain('http://h:3001');
    expect(md).toContain('TOK');
    expect(md).toContain('demo');
    expect(md).toContain('mcp.authenticate');
  });

  it('stdio doc contains npx snippet and env, no token', () => {
    const md = buildSetupMarkdown(link, { serverUrl: 'http://h', transport: 'stdio' });
    expect(md).toContain('npx');
    expect(md).toContain('CURRENT_PROJECT');
    expect(md).not.toContain('TOK');
  });
});
