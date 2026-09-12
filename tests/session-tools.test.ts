/**
 * Tests for session tools (S-004)
 *
 * Covers: session_info, session_list tools with and without SessionManager/RateLimiter.
 */

import { describe, it, expect, vi} from 'vitest';
import { SessionManager } from '../src/core/session-manager.js';
import { RateLimiter } from '../src/core/rate-limiter.js';
import { registerSessionTools } from '../src/register/session.js';
import type { ServerContext } from '../src/register/context.js';
import type { ToolMetaHandler } from '../src/register/setup.js';

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Create a mock ServerContext that captures registered tool handlers.
 * Allows calling tools directly without MCP SDK overhead.
 */
function createMockContext(overrides?: Partial<ServerContext>): {
  ctx: ServerContext;
  getHandler: (name: string) => ToolMetaHandler | undefined;
} {
  const handlers = new Map<string, ToolMetaHandler>();

  const ctx: ServerContext = {
    server: {
      registerTool(name: string, _def: unknown, handler: unknown) {
        handlers.set(name, handler as ToolMetaHandler);
      },
    } as any,
    cfg: {} as any,
    catalogCfg: {} as any,
    catalogProvider: {} as any,
    vectorAdapter: undefined,
    vectorInitAttempted: false,
    ensureVectorAdapter: async () => undefined,
    toolRegistry: {
      has: () => false,
      set: vi.fn(),
    } as any,
    resourceRegistry: [],
    toolNames: new Set(),
    STRICT_TOOL_DEDUP: false,
    TOOLS_ENABLED: true,
    TOOL_RES_ENABLED: false,
    TOOL_RES_EXEC: false,
    REPO_ROOT: '/tmp',
    SERVER_CAPS: { resources: { subscribe: false, listChanged: false }, tools: { listChanged: false }, prompts: { listChanged: false }, completion: {} },
    normalizeBase64: (s: string) => s,
    makeResourceTemplate: (p: string) => p as any,
    registerToolAsResource: vi.fn(),
    ...overrides,
  };

  return {
    ctx,
    getHandler: (name: string) => handlers.get(name),
  };
}

/**
 * Parse the JSON payload from an ok/err response.
 */
function parseResponse(result: any): any {
  try {
    const text = result?.content?.[0]?.text;
    return typeof text === 'string' ? JSON.parse(text) : result;
  } catch {
    return result;
  }
}

/** AUD-04: GateExtra that marks the caller as `sessionId`. */
function asSession(sessionId: string): { sessionId: string } {
  return { sessionId };
}

/** AUD-04: mark caller as admin by giving the calling session admin role in SM. */
function makeAdmin(sm: SessionManager, sessionId: string): void {
  sm.updateMetadata(sessionId, { roles: ['admin'] });
}

// ─── session_info ──────────────────────────────────────────────────────

describe('session_info tool', () => {
  it('returns available=false when SessionManager is not set', async () => {
    const { ctx, getHandler } = createMockContext();
    registerSessionTools(ctx);

    const handler = getHandler('session_info');
    expect(handler).toBeDefined();

    const result = parseResponse(await handler!({ sessionId: 'nonexistent' }));
    expect(result.ok).toBe(true);
    expect(result.data.available).toBe(false);
    expect(result.data.sessionsEnabled).toBe(false);
    expect(result.data.reason).toContain('SessionManager not initialized');
  });

  it('returns error for unknown session ID', async () => {
    const sm = new SessionManager();
    const { ctx, getHandler } = createMockContext({ sessionManager: sm });
    registerSessionTools(ctx);

    const self = sm.create({ remote: 'self:1' });
    const handler = getHandler('session_info');
    const result = parseResponse(await handler!(
      { sessionId: '00000000-0000-0000-0000-000000000000' },
      asSession(self.id),
    ));
    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('Session not found');

    await sm.closeAll();
  });

  it('returns session info with rate limit data', async () => {
    const sm = new SessionManager();
    const rl = new RateLimiter({ maxTokens: 30, refillPerSec: 2 });
    const { ctx, getHandler } = createMockContext({ sessionManager: sm, rateLimiter: rl });
    registerSessionTools(ctx);

    // Create a session
    const session = sm.create({ remote: '10.0.0.1:54321', metadata: { userId: 'u1' } });

    // Consume some tokens to create rate limit state
    rl.allow(session.id, 'some_tool');
    rl.allow(session.id, 'some_tool');

    const handler = getHandler('session_info');
    const result = parseResponse(await handler!({ sessionId: session.id }, asSession(session.id)));

    expect(result.ok).toBe(true);
    const d = result.data;
    expect(d.available).toBe(true);
    expect(d.sessionsEnabled).toBe(true);
    expect(d.rateLimitingEnabled).toBe(true);
    expect(d.sessionId).toBe(session.id);
    expect(d.remote).toBe('10.0.0.1:54321');
    expect(d.createdAt).toBe(session.createdAt);
    expect(d.ageMs).toBeGreaterThanOrEqual(0);
    expect(d.idleMs).toBeGreaterThanOrEqual(0);
    expect(d.ttlRemainingMs).toBeGreaterThan(0);
    expect(d.expiresAt).toBeDefined();
    expect(d.rateLimit).not.toBeNull();
    expect(d.rateLimit.remaining).toBe(28); // 30 - 2 consumed
    expect(d.rateLimit.maxTokens).toBe(30);
    expect(d.rateLimit.refillPerSec).toBe(2);
    expect(d.metadata).toEqual({ userId: 'u1' });

    await sm.closeAll();
  });

  it('returns rateLimit=null when RateLimiter is not set', async () => {
    const sm = new SessionManager();
    const { ctx, getHandler } = createMockContext({ sessionManager: sm });
    registerSessionTools(ctx);

    const session = sm.create({ remote: 'test:1' });

    const handler = getHandler('session_info');
    const result = parseResponse(await handler!({ sessionId: session.id }, asSession(session.id)));

    expect(result.ok).toBe(true);
    expect(result.data.rateLimitingEnabled).toBe(false);
    expect(result.data.rateLimit).toBeNull();

    await sm.closeAll();
  });

  it('shows shorter ttlRemainingMs when per-session TTL is set', async () => {
    const sm = new SessionManager({ sessionTtlMs: 9999999 });
    const { ctx, getHandler } = createMockContext({ sessionManager: sm });
    registerSessionTools(ctx);

    const session = sm.create({ remote: 'test:1' });
    sm.setSessionExpiry(session.id, Date.now() + 3600_000);

    const handler = getHandler('session_info');
    const result = parseResponse(await handler!({ sessionId: session.id }, asSession(session.id)));

    expect(result.ok).toBe(true);
    expect(result.data.expiresAt).toBeDefined();
    expect(result.data.ttlRemainingMs).toBeGreaterThan(0);
    expect(result.data.ttlRemainingMs).toBeLessThanOrEqual(3600000);

    await sm.closeAll();
  });

  it('excludes metadata when empty', async () => {
    const sm = new SessionManager();
    const { ctx, getHandler } = createMockContext({ sessionManager: sm });
    registerSessionTools(ctx);

    const session = sm.create({ remote: 'test:1' });

    const handler = getHandler('session_info');
    const result = parseResponse(await handler!({ sessionId: session.id }, asSession(session.id)));

    expect(result.ok).toBe(true);
    expect(result.data.metadata).toBeUndefined();

    await sm.closeAll();
  });

  it('denies access to another session without admin role (AUD-04)', async () => {
    const sm = new SessionManager();
    const { ctx, getHandler } = createMockContext({ sessionManager: sm });
    registerSessionTools(ctx);

    const attacker = sm.create({ remote: '10.0.0.1:1000' });
    const victim = sm.create({ remote: '10.0.0.2:2000', metadata: { userId: 'victim-user' } });

    const handler = getHandler('session_info');
    const result = parseResponse(await handler!(
      { sessionId: victim.id },
      asSession(attacker.id),
    ));

    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('access denied');

    await sm.closeAll();
  });

  it('allows admin role to read another session (AUD-04)', async () => {
    const sm = new SessionManager();
    const { ctx, getHandler } = createMockContext({ sessionManager: sm });
    registerSessionTools(ctx);

    const admin = sm.create({ remote: '10.0.0.1:1000' });
    makeAdmin(sm, admin.id);
    const victim = sm.create({ remote: '10.0.0.2:2000', metadata: { userId: 'victim-user' } });

    const handler = getHandler('session_info');
    const result = parseResponse(await handler!(
      { sessionId: victim.id },
      asSession(admin.id),
    ));

    expect(result.ok).toBe(true);
    expect(result.data.sessionId).toBe(victim.id);
    expect(result.data.remote).toBe('10.0.0.2:2000');

    await sm.closeAll();
  });
});

// ─── session_list ──────────────────────────────────────────────────────

describe('session_list tool', () => {
  it('returns available=false when SessionManager is not set', async () => {
    const { ctx, getHandler } = createMockContext();
    registerSessionTools(ctx);

    const handler = getHandler('session_list');
    const result = parseResponse(await handler!({}));

    expect(result.ok).toBe(true);
    expect(result.data.available).toBe(false);
    expect(result.data.sessionsEnabled).toBe(false);
    expect(result.data.total).toBe(0);
    expect(result.data.sessions).toEqual([]);
  });

  it('lists all active sessions with rate limit info', async () => {
    const sm = new SessionManager();
    const rl = new RateLimiter({ maxTokens: 50, refillPerSec: 1 });
    const { ctx, getHandler } = createMockContext({ sessionManager: sm, rateLimiter: rl });
    registerSessionTools(ctx);

    const s1 = sm.create({ remote: '10.0.0.1:1000' });
    const s2 = sm.create({ remote: '10.0.0.2:2000', metadata: { role: 'admin' } });
    makeAdmin(sm, s2.id);

    // Consume tokens for s1
    rl.allow(s1.id, 'tool_a');
    rl.allow(s1.id, 'tool_b');
    rl.allow(s1.id, 'tool_c');

    const handler = getHandler('session_list');
    const result = parseResponse(await handler!({}, asSession(s2.id)));

    expect(result.ok).toBe(true);
    expect(result.data.available).toBe(true);
    expect(result.data.sessionsEnabled).toBe(true);
    expect(result.data.rateLimitingEnabled).toBe(true);
    expect(result.data.total).toBe(2);

    const sessions = result.data.sessions;
    const byId: Record<string, any> = {};
    for (const s of sessions) byId[s.sessionId] = s;

    expect(byId[s1.id]).toBeDefined();
    expect(byId[s1.id].remote).toBe('10.0.0.1:1000');
    expect(byId[s1.id].rateLimit.remaining).toBe(47); // 50 - 3

    expect(byId[s2.id]).toBeDefined();
    expect(byId[s2.id].remote).toBe('10.0.0.2:2000');
    // s2 never called allow(), so no bucket exists → rateLimit is null
    expect(byId[s2.id].rateLimit).toBeNull();
    expect(byId[s2.id].metadata).toMatchObject({ role: 'admin' });

    await sm.closeAll();
  });

  it('returns empty list when no sessions exist', async () => {
    const sm = new SessionManager();
    const { ctx, getHandler } = createMockContext({ sessionManager: sm });
    registerSessionTools(ctx);

    const admin = sm.create({ remote: 'admin:1' });
    makeAdmin(sm, admin.id);

    const handler = getHandler('session_list');
    const result = parseResponse(await handler!({}, asSession(admin.id)));

    expect(result.ok).toBe(true);
    expect(result.data.total).toBe(1);
    expect(result.data.sessions).toHaveLength(1);

    await sm.closeAll();
  });

  it('returns rateLimitingEnabled=false when RateLimiter is not set', async () => {
    const sm = new SessionManager();
    const { ctx, getHandler } = createMockContext({ sessionManager: sm });
    registerSessionTools(ctx);

    const admin = sm.create({ remote: 'test:1' });
    makeAdmin(sm, admin.id);

    const handler = getHandler('session_list');
    const result = parseResponse(await handler!({}, asSession(admin.id)));

    expect(result.ok).toBe(true);
    expect(result.data.rateLimitingEnabled).toBe(false);
    expect(result.data.sessions[0].rateLimit).toBeNull();

    await sm.closeAll();
  });

  it('lists sessions with per-session expiry showing shorter TTL', async () => {
    const sm = new SessionManager({ sessionTtlMs: 9999999 });
    const { ctx, getHandler } = createMockContext({ sessionManager: sm });
    registerSessionTools(ctx);

    const s1 = sm.create({ remote: 'a:1' });
    const s2 = sm.create({ remote: 'b:2' });
    makeAdmin(sm, s1.id);
    sm.setSessionExpiry(s2.id, Date.now() + 1800_000);

    const handler = getHandler('session_list');
    const result = parseResponse(await handler!({}, asSession(s1.id)));

    expect(result.ok).toBe(true);
    const sessions = result.data.sessions;
    const byId: Record<string, any> = {};
    for (const s of sessions) byId[s.sessionId] = s;

    // s1 uses global TTL (very large), s2 uses per-session TTL (30 min)
    expect(byId[s1.id].ttlRemainingMs).toBeGreaterThan(1800_000);
    expect(byId[s2.id].ttlRemainingMs).toBeLessThanOrEqual(1800_000);
    expect(byId[s2.id].ttlRemainingMs).toBeGreaterThan(0);

    await sm.closeAll();
  });

  it('denies session_list for non-admin caller (AUD-04)', async () => {
    const sm = new SessionManager();
    const { ctx, getHandler } = createMockContext({ sessionManager: sm });
    registerSessionTools(ctx);

    const user = sm.create({ remote: '10.0.0.1:1000' });
    sm.create({ remote: '10.0.0.2:2000' });

    const handler = getHandler('session_list');
    const result = parseResponse(await handler!({}, asSession(user.id)));

    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('access denied');
    expect(result.error.message).toContain('admin');

    await sm.closeAll();
  });
});

// ─── buildSessionDetail (indirect via tools) ───────────────────────────

describe('session tools — combined behavior', () => {
  it('session_info and session_list return consistent data', async () => {
    const sm = new SessionManager();
    const rl = new RateLimiter({ maxTokens: 20, refillPerSec: 1 });
    const { ctx, getHandler } = createMockContext({ sessionManager: sm, rateLimiter: rl });
    registerSessionTools(ctx);

    const session = sm.create({ remote: '127.0.0.1:9999' });
    makeAdmin(sm, session.id);
    rl.allow(session.id, 'any_tool');

    const infoHandler = getHandler('session_info')!;
    const listHandler = getHandler('session_list')!;

    const infoResult = parseResponse(await infoHandler({ sessionId: session.id }, asSession(session.id)));
    const listResult = parseResponse(await listHandler({}, asSession(session.id)));

    const infoData = infoResult.data;
    const listedSession = listResult.data.sessions.find(
      (s: any) => s.sessionId === session.id,
    );

    expect(listedSession).toBeDefined();
    expect(listedSession.sessionId).toBe(infoData.sessionId);
    expect(listedSession.remote).toBe(infoData.remote);
    expect(listedSession.createdAt).toBe(infoData.createdAt);
    expect(listedSession.ageMs).toBeCloseTo(infoData.ageMs, -2);
    expect(listedSession.rateLimit.remaining).toBe(infoData.rateLimit.remaining);
    expect(listedSession.rateLimit.maxTokens).toBe(infoData.rateLimit.maxTokens);

    await sm.closeAll();
  });

  it('tools gracefully handle rapid session creation/deletion', async () => {
    const sm = new SessionManager();
    const { ctx, getHandler } = createMockContext({ sessionManager: sm });
    registerSessionTools(ctx);

    const handler = getHandler('session_info')!;
    const session = sm.create({ remote: 'test:1' });

    let result = parseResponse(await handler({ sessionId: session.id }, asSession(session.id)));
    expect(result.ok).toBe(true);

    await sm.close(session.id);

    result = parseResponse(await handler({ sessionId: session.id }, asSession(session.id)));
    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('Session not found');

    await sm.closeAll();
  });
});
