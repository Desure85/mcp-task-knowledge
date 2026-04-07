/**
 * Tests for AuthManager — Pre-auth gate and authentication (A-001)
 *
 * Covers: pre-auth gating, authenticate/revoke, pre-hook integration,
 * static validator, session metadata, error types, diagnostics.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AuthManager,
  AuthError,
  InvalidTokenError,
  NotAuthenticatedError,
  createStaticValidator,
} from '../src/core/auth.js';
import type { TokenValidator, AuthResult } from '../src/core/auth.js';
import { ToolExecutor, ToolDeniedError, createToolContext } from '../src/core/tool-executor.js';
import type { RawToolHandler, ToolContext } from '../src/core/tool-executor.js';
import type { ServerContext } from '../src/register/context.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SessionManager } from '../src/core/session-manager.js';

// ─── Helpers ──────────────────────────────────────────────────────────

function createMockServerContext(): ServerContext {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  return {
    server,
    cfg: { embeddings: { mode: 'none' }, obsidian: { vaultRoot: '/tmp' } },
    catalogCfg: {
      mode: 'embedded', prefer: 'embedded',
      embedded: { enabled: false, prefix: '/catalog', store: 'memory' },
      remote: { enabled: false, timeoutMs: 2000 },
      sync: { enabled: false, intervalSec: 60, direction: 'none' },
    },
    catalogProvider: {} as any,
    vectorAdapter: undefined, vectorInitAttempted: false,
    ensureVectorAdapter: async () => undefined,
    toolRegistry: { get: () => undefined, has: () => false, set: () => {}, all: () => [], size: 0 } as any,
    resourceRegistry: [], toolNames: new Set(),
    STRICT_TOOL_DEDUP: false, TOOLS_ENABLED: true, TOOL_RES_ENABLED: false, TOOL_RES_EXEC: false,
    REPO_ROOT: '/tmp',
    SERVER_CAPS: { resources: { list: true, read: true }, tools: { call: true } },
    normalizeBase64: (s) => s, makeResourceTemplate: () => ({}) as any, registerToolAsResource: () => {},
  };
}

function createContext(sessionId: string = 'sess-1', overrides?: Partial<ToolContext>): ToolContext {
  return createToolContext({
    sessionId,
    remote: '127.0.0.1:54321',
    server: createMockServerContext(),
    ...overrides,
  });
}

function createAuthManager(overrides?: Record<string, unknown>): AuthManager {
  return new AuthManager({
    requireAuth: true,
    tokenValidator: createStaticValidator({
      'valid-token': { userId: 'user-1', roles: ['admin'] },
      'user-token': { userId: 'user-2', roles: [] },
    }),
    ...overrides,
  });
}

// ─── Error types ──────────────────────────────────────────────────────

describe('AuthError', () => {
  it('should have correct properties', () => {
    const err = new AuthError('TEST_CODE', 'test message');
    expect(err.name).toBe('AuthError');
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('test message');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AuthError);
  });
});

describe('InvalidTokenError', () => {
  it('should have correct defaults', () => {
    const err = new InvalidTokenError();
    expect(err.name).toBe('AuthError');
    expect(err.code).toBe('INVALID_TOKEN');
    expect(err.message).toBe('invalid token');
  });

  it('should accept custom message', () => {
    const err = new InvalidTokenError('token expired');
    expect(err.code).toBe('INVALID_TOKEN');
    expect(err.message).toBe('token expired');
  });
});

describe('NotAuthenticatedError', () => {
  it('should have correct defaults', () => {
    const err = new NotAuthenticatedError();
    expect(err.code).toBe('NOT_AUTHENTICATED');
    expect(err.message).toBe('authentication required');
  });
});

// ─── Pre-auth gating ─────────────────────────────────────────────────

describe('AuthManager — pre-auth gating', () => {
  it('should allow pre-auth methods without authentication', () => {
    const auth = createAuthManager();
    expect(auth.isPreAuthMethod('mcp.authenticate')).toBe(true);
    expect(auth.isPreAuthMethod('tools/list')).toBe(true);
    expect(auth.isPreAuthMethod('ping')).toBe(true);
  });

  it('should deny non-pre-auth methods when not authenticated', () => {
    const auth = createAuthManager();
    expect(auth.isPreAuthMethod('tasks_list')).toBe(false);
    expect(auth.isPreAuthMethod('search_tasks')).toBe(false);
  });

  it('should support custom authMethods', () => {
    const auth = new AuthManager({
      requireAuth: true,
      authMethods: ['notifications/list'],
    });
    expect(auth.isPreAuthMethod('notifications/list')).toBe(true);
    expect(auth.isPreAuthMethod('mcp.authenticate')).toBe(true); // built-in still works
  });

  it('should report requireAuth correctly', () => {
    const auth1 = new AuthManager({ requireAuth: true });
    expect(auth1.isAuthRequired()).toBe(true);

    const auth2 = new AuthManager({ requireAuth: false });
    expect(auth2.isAuthRequired()).toBe(false);

    const auth3 = new AuthManager();
    expect(auth3.isAuthRequired()).toBe(false);
  });
});

// ─── Authentication ──────────────────────────────────────────────────

describe('AuthManager — authenticate', () => {
  it('should authenticate with valid token', async () => {
    const auth = createAuthManager();
    const result = await auth.authenticate('sess-1', 'valid-token');

    expect(result.userId).toBe('user-1');
    expect(result.roles).toEqual(['admin']);
    expect(auth.isAuthenticated('sess-1')).toBe(true);
  });

  it('should throw InvalidTokenError for invalid token', async () => {
    const auth = createAuthManager();
    await expect(auth.authenticate('sess-1', 'bad-token')).rejects.toThrow(InvalidTokenError);
    expect(auth.isAuthenticated('sess-1')).toBe(false);
  });

  it('should throw AuthError when no validator configured', async () => {
    const auth = new AuthManager({ requireAuth: true });
    await expect(auth.authenticate('sess-1', 'any')).rejects.toThrow(AuthError);
    await expect(auth.authenticate('sess-1', 'any')).rejects.toThrow('no token validator configured');
  });

  it('should support async token validators', async () => {
    const slowValidator: TokenValidator = async (token) => {
      await new Promise((r) => setTimeout(r, 10));
      if (token === 'slow-token') return { userId: 'slow-user' };
      return null;
    };

    const auth = new AuthManager({ requireAuth: true, tokenValidator: slowValidator });
    const result = await auth.authenticate('sess-1', 'slow-token');
    expect(result.userId).toBe('slow-user');
    expect(auth.isAuthenticated('sess-1')).toBe(true);
  });
});

// ─── Grant / Revoke ──────────────────────────────────────────────────

describe('AuthManager — grant / revoke', () => {
  it('should manually grant a session', () => {
    const auth = createAuthManager();
    auth.grantSession('sess-1', 'granted-user', ['editor']);
    expect(auth.isAuthenticated('sess-1')).toBe(true);
  });

  it('should revoke an authenticated session', async () => {
    const auth = createAuthManager();
    await auth.authenticate('sess-1', 'valid-token');
    expect(auth.isAuthenticated('sess-1')).toBe(true);

    auth.revokeSession('sess-1');
    expect(auth.isAuthenticated('sess-1')).toBe(false);
  });

  it('should revoke gracefully for non-authenticated session', () => {
    const auth = createAuthManager();
    expect(() => auth.revokeSession('nonexistent')).not.toThrow();
  });

  it('should revoke all sessions', async () => {
    const auth = createAuthManager();
    await auth.authenticate('s1', 'valid-token');
    await auth.authenticate('s2', 'valid-token');
    expect(auth.authenticatedCount).toBe(2);

    auth.revokeAll();
    expect(auth.authenticatedCount).toBe(0);
    expect(auth.isAuthenticated('s1')).toBe(false);
    expect(auth.isAuthenticated('s2')).toBe(false);
  });
});

// ─── Session metadata integration ────────────────────────────────────

describe('AuthManager — session metadata', () => {
  it('should store userId in session metadata via SessionManager', async () => {
    const sm = new SessionManager({ maxSessions: 100 });
    const session = sm.create({ remote: '127.0.0.1' });

    const auth = new AuthManager({
      requireAuth: true,
      tokenValidator: createStaticValidator({
        'tok': { userId: 'u1', roles: ['admin'] },
      }),
      sessionManager: sm,
    });

    await auth.authenticate(session.id, 'tok');

    const updated = sm.get(session.id);
    expect(updated?.metadata?.userId).toBe('u1');
    expect(updated?.metadata?.roles).toEqual(['admin']);
    expect(updated?.metadata?.authenticatedAt).toBeDefined();
  });

  it('should clean metadata on revoke', async () => {
    const sm = new SessionManager({ maxSessions: 100 });
    const session = sm.create({ remote: '127.0.0.1' });

    const auth = new AuthManager({
      requireAuth: true,
      tokenValidator: createStaticValidator({ 'tok': { userId: 'u1' } }),
      sessionManager: sm,
    });

    await auth.authenticate(session.id, 'tok');
    expect(sm.get(session.id)?.metadata?.userId).toBe('u1');

    auth.revokeSession(session.id);
    expect(sm.get(session.id)?.metadata?.userId).toBeUndefined();
  });

  it('should store extra metadata from AuthResult', async () => {
    const sm = new SessionManager({ maxSessions: 100 });
    const session = sm.create({ remote: '127.0.0.1' });

    const auth = new AuthManager({
      requireAuth: true,
      tokenValidator: async () => ({
        userId: 'u1',
        metadata: { tenant: 'acme', plan: 'pro' },
      }),
      sessionManager: sm,
    });

    await auth.authenticate(session.id, 'tok');

    expect(sm.get(session.id)?.metadata?.tenant).toBe('acme');
    expect(sm.get(session.id)?.metadata?.plan).toBe('pro');
  });

  it('should getUserId from session metadata', async () => {
    const sm = new SessionManager({ maxSessions: 100 });
    const session = sm.create({ remote: '127.0.0.1' });

    const auth = new AuthManager({
      requireAuth: true,
      tokenValidator: createStaticValidator({ 'tok': { userId: 'u1' } }),
      sessionManager: sm,
    });

    expect(auth.getUserId(session.id)).toBeUndefined();
    await auth.authenticate(session.id, 'tok');
    expect(auth.getUserId(session.id)).toBe('u1');
  });

  it('should getRoles from session metadata', async () => {
    const sm = new SessionManager({ maxSessions: 100 });
    const session = sm.create({ remote: '127.0.0.1' });

    const auth = new AuthManager({
      requireAuth: true,
      tokenValidator: createStaticValidator({ 'tok': { userId: 'u1', roles: ['a', 'b'] } }),
      sessionManager: sm,
    });

    await auth.authenticate(session.id, 'tok');
    expect(auth.getRoles(session.id)).toEqual(['a', 'b']);
  });

  it('should work without SessionManager', async () => {
    const auth = createAuthManager();
    await auth.authenticate('s1', 'valid-token');

    // Without SessionManager, getUserId returns placeholder
    expect(auth.getUserId('s1')).toBe('__authenticated__');
    expect(auth.getUserId('unknown')).toBeUndefined();
    expect(auth.getRoles('s1')).toEqual([]);
  });
});

// ─── Pre-hook integration ────────────────────────────────────────────

describe('AuthManager — pre-hook integration', () => {
  it('should allow all calls when requireAuth=false', async () => {
    const auth = new AuthManager({ requireAuth: false });
    const hook = auth.createPreHook();
    const ctx = createContext();

    const result = hook('any_tool', {}, ctx);
    expect(result.deny).toBe(false);
  });

  it('should allow pre-auth methods without authentication', () => {
    const auth = createAuthManager();
    const hook = auth.createPreHook();
    const ctx = createContext();

    expect(hook('mcp.authenticate', {}, ctx).deny).toBe(false);
    expect(hook('tools/list', {}, ctx).deny).toBe(false);
    expect(hook('ping', {}, ctx).deny).toBe(false);
  });

  it('should deny non-pre-auth methods when not authenticated', () => {
    const auth = createAuthManager();
    const hook = auth.createPreHook();
    const ctx = createContext('unauth-session');

    const result = hook('tasks_list', {}, ctx);
    expect(result.deny).toBe(true);
    expect(result.reason).toContain('authentication required');
  });

  it('should allow all methods after authentication', async () => {
    const auth = createAuthManager();
    const hook = auth.createPreHook();
    const ctx = createContext('auth-session');

    await auth.authenticate('auth-session', 'valid-token');

    const result = hook('tasks_list', {}, ctx);
    expect(result.deny).toBe(false);
  });

  it('should work with ToolExecutor', async () => {
    const auth = createAuthManager();
    const executor = new ToolExecutor();
    executor.addPreHook(auth.createPreHook());

    const ctx = createContext('test-session');
    const handler: RawToolHandler = async () => 'ok';

    // Before auth — should deny
    await expect(
      executor.execute('tasks_list', {}, ctx, handler),
    ).rejects.toThrow(ToolDeniedError);

    // Authenticate
    await auth.authenticate('test-session', 'valid-token');

    // After auth — should allow
    const result = await executor.execute('tasks_list', {}, ctx, handler);
    expect(result).toBe('ok');
  });

  it('should allow mcp.authenticate even without auth via executor', async () => {
    const auth = createAuthManager();
    const executor = new ToolExecutor();
    executor.addPreHook(auth.createPreHook());

    const ctx = createContext('test-session');
    const handler: RawToolHandler = async () => 'auth-ok';

    const result = await executor.execute('mcp.authenticate', { token: 'valid-token' }, ctx, handler);
    expect(result).toBe('auth-ok');
  });
});

// ─── Diagnostics ─────────────────────────────────────────────────────

describe('AuthManager — diagnostics', () => {
  it('should report authenticated count', async () => {
    const auth = createAuthManager();
    expect(auth.authenticatedCount).toBe(0);

    await auth.authenticate('s1', 'valid-token');
    await auth.authenticate('s2', 'user-token');
    expect(auth.authenticatedCount).toBe(2);

    auth.revokeSession('s1');
    expect(auth.authenticatedCount).toBe(1);
  });

  it('should return authenticated session IDs', async () => {
    const auth = createAuthManager();
    await auth.authenticate('s1', 'valid-token');
    await auth.authenticate('s2', 'user-token');

    const ids = auth.getAuthenticatedSessionIds();
    expect(ids).toContain('s1');
    expect(ids).toContain('s2');
    expect(ids.size).toBe(2);
  });

  it('should return pre-auth methods list', () => {
    const auth = createAuthManager();
    const methods = auth.getPreAuthMethods();
    expect(methods).toContain('mcp.authenticate');
    expect(methods).toContain('tools/list');
    expect(methods).toContain('ping');
  });

  it('should include custom methods in pre-auth list', () => {
    const auth = new AuthManager({ requireAuth: true, authMethods: ['status'] });
    const methods = auth.getPreAuthMethods();
    expect(methods).toContain('status');
  });
});

// ─── Static validator ────────────────────────────────────────────────

describe('createStaticValidator', () => {
  it('should validate known tokens', async () => {
    const validator = createStaticValidator({
      'admin-key': { userId: 'admin', roles: ['admin', 'user'] },
      'user-key': { userId: 'user', roles: ['user'] },
    });

    const r1 = await validator('admin-key');
    expect(r1?.userId).toBe('admin');

    const r2 = await validator('user-key');
    expect(r2?.userId).toBe('user');

    const r3 = await validator('bad-key');
    expect(r3).toBeNull();
  });

  it('should default roles to empty array', async () => {
    const validator = createStaticValidator({
      'key': { userId: 'u' },
    });
    const result = await validator('key');
    expect(result?.roles).toEqual([]);
  });
});
