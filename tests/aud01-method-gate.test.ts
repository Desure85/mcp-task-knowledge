/**
 * AUD-01 — decideMethodCall gates ALL JSON-RPC methods, not just tools/call.
 *
 * Before this fix, resources/list+read, prompts/list+get and
 * completion/complete bypassed auth entirely on network transports: an
 * unauthenticated client could initialize → resources/read → read every
 * task://, knowledge:// and prompt:// document.
 */

import { describe, it, expect } from 'vitest';
import { AuthManager, createStaticValidator } from '../src/core/auth.js';
import { decideMethodCall } from '../src/core/auth-gate.js';

const TOKENS = { 'valid-token': { userId: 'user-1', roles: ['admin'] } };

function httpAuth(): AuthManager {
  return new AuthManager({ transport: 'http', tokenValidator: createStaticValidator(TOKENS) });
}

function tcpAuth(): AuthManager {
  return new AuthManager({ transport: 'tcp', tokenValidator: createStaticValidator(TOKENS) });
}

const DATA_METHODS = [
  'resources/list',
  'resources/read',
  'resources/templates/list',
  'prompts/list',
  'prompts/get',
  'completion/complete',
  'tools/list',
];

describe('decideMethodCall — pre-auth surface (requireAuth on)', () => {
  it('allows lifecycle methods pre-auth', () => {
    const auth = httpAuth();
    for (const m of ['initialize', 'ping', 'notifications/initialized', 'notifications/cancelled']) {
      const d = decideMethodCall(auth, 'http', { method: m });
      expect(d.allowed, `${m} must stay reachable pre-auth`).toBe(true);
    }
  });

  it('allows mcp.authenticate via tools/call pre-auth', () => {
    const d = decideMethodCall(httpAuth(), 'http', {
      method: 'tools/call',
      toolName: 'mcp.authenticate',
      sessionId: 's-1',
    });
    expect(d.allowed).toBe(true);
  });

  it('denies every data method pre-auth on http', () => {
    const auth = httpAuth();
    for (const m of DATA_METHODS) {
      const d = decideMethodCall(auth, 'http', { method: m, sessionId: 's-1' });
      expect(d.allowed, `${m} must be gated pre-auth`).toBe(false);
      if (!d.allowed) expect(d.reason).toMatch(/authentication required/);
    }
  });

  it('denies every data method pre-auth on tcp', () => {
    const auth = tcpAuth();
    for (const m of DATA_METHODS) {
      const d = decideMethodCall(auth, 'tcp', { method: m, sessionId: 's-1' });
      expect(d.allowed, `${m} must be gated pre-auth on tcp`).toBe(false);
    }
  });

  it('denies tools/call with a non-whitelisted tool pre-auth', () => {
    const d = decideMethodCall(httpAuth(), 'http', {
      method: 'tools/call',
      toolName: 'tasks_list',
      sessionId: 's-1',
    });
    expect(d.allowed).toBe(false);
  });

  it('denies tools/call with a missing tool name (fail-closed)', () => {
    const d = decideMethodCall(httpAuth(), 'http', { method: 'tools/call', sessionId: 's-1' });
    expect(d.allowed).toBe(false);
  });
});

describe('decideMethodCall — post-auth surface', () => {
  it('allows all methods for an authenticated session', async () => {
    const auth = httpAuth();
    await auth.authenticate('s-1', 'valid-token');
    for (const m of [...DATA_METHODS, 'initialize', 'ping']) {
      const d = decideMethodCall(auth, 'http', { method: m, sessionId: 's-1' });
      expect(d.allowed, `${m} must be allowed post-auth`).toBe(true);
    }
    const tool = decideMethodCall(auth, 'http', { method: 'tools/call', toolName: 'tasks_list', sessionId: 's-1' });
    expect(tool.allowed).toBe(true);
  });

  it('a different session stays denied', async () => {
    const auth = httpAuth();
    await auth.authenticate('s-1', 'valid-token');
    const d = decideMethodCall(auth, 'http', { method: 'resources/read', sessionId: 's-2' });
    expect(d.allowed).toBe(false);
  });
});

describe('decideMethodCall — transport semantics', () => {
  it('stdio without AuthManager allows everything (local pipe)', () => {
    for (const m of DATA_METHODS) {
      expect(decideMethodCall(undefined, 'stdio', { method: m }).allowed).toBe(true);
    }
  });

  it('http/tcp without AuthManager fail closed on data methods but keep lifecycle open', () => {
    for (const t of ['http', 'tcp']) {
      for (const m of DATA_METHODS) {
        expect(decideMethodCall(undefined, t, { method: m }).allowed, `${t}:${m}`).toBe(false);
      }
      expect(decideMethodCall(undefined, t, { method: 'initialize' }).allowed).toBe(true);
      expect(decideMethodCall(undefined, t, { method: 'ping' }).allowed).toBe(true);
    }
  });

  it('requireAuth=false allows everything (unix/local)', () => {
    const auth = new AuthManager({ transport: 'unix', requireAuth: false });
    for (const m of DATA_METHODS) {
      expect(decideMethodCall(auth, 'unix', { method: m }).allowed).toBe(true);
    }
  });
});
