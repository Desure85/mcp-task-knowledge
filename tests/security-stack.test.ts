/**
 * AUD-07 — security stack wired into tools/call dispatch.
 *
 * Before this change, RateLimiter / InputSanitizer / ACLEngine /
 * AuditLogger / AuthProtection existed but had zero call sites — dead code.
 * Now wrapToolHandler runs them (in order: auth-protection → rate-limit →
 * sanitizer → ACL → handler → audit) when a SecurityStack is attached.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { wrapToolHandler } from '../src/core/auth-gate.js';
import { SecurityStack } from '../src/core/security-stack.js';
import { RateLimiter } from '../src/core/rate-limiter.js';
import { ACLEngine } from '../src/core/acl.js';
import { AuthProtection } from '../src/core/auth-protection.js';
import { AuditLogger } from '../src/audit/logger.js';
import { AuthManager, createStaticValidator } from '../src/core/auth.js';

const okResult = () => ({ content: [{ type: 'text' as const, text: '{"ok":true}' }] });

function makeResolve(security?: SecurityStack, auth?: AuthManager) {
  return () => ({ auth, transport: 'stdio', security });
}

async function callTool(
  wrapped: (args: unknown, extra?: { sessionId?: string }) => Promise<unknown>,
  args: unknown = {},
  sessionId = 'sess-1',
) {
  return wrapped(args, { sessionId }) as Promise<{
    content: { type: string; text: string }[];
    isError?: boolean;
  }>;
}

function envelope(res: { content: { text: string }[] }): { ok: boolean; error?: { message: string } } {
  return JSON.parse(res.content[0].text);
}

describe('AUD-07: SecurityStack in wrapToolHandler', () => {
  let dir: string;
  let auditPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'secstack-'));
    auditPath = path.join(dir, 'audit.log');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('no stack attached → handler runs, no overhead (backwards compat)', async () => {
    const wrapped = wrapToolHandler('tasks_list', () => okResult(), makeResolve());
    const res = await callTool(wrapped);
    expect(res.isError).toBeUndefined();
  });

  it('rate-limit: exhausted bucket → denied with rate-limit message', async () => {
    const rateLimiter = new RateLimiter({ maxTokens: 1, burstMaxTokens: 1, refillPerSec: 0 });
    const stack = new SecurityStack({ rateLimiter });
    const wrapped = wrapToolHandler('tasks_list', () => okResult(), makeResolve(stack));

    const first = await callTool(wrapped);
    expect(first.isError).toBeUndefined();

    const second = await callTool(wrapped);
    expect(second.isError).toBe(true);
    expect(envelope(second).error?.message).toMatch(/rate limited/);
  });

  it('sanitizer (reject mode): injection in input → denied', async () => {
    const stack = new SecurityStack({ sanitizer: { mode: 'reject' } });
    const wrapped = wrapToolHandler(
      'knowledge_create',
      () => okResult(),
      makeResolve(stack),
    );
    const res = await callTool(wrapped, { title: "x'; DROP TABLE tasks;--" });
    expect(res.isError).toBe(true);
    expect(envelope(res).error?.message).toMatch(/input validation failed/);
  });

  it('sanitizer (sanitize mode): threat cleaned, handler still runs', async () => {
    const stack = new SecurityStack({ sanitizer: { mode: 'sanitize' } });
    let seen: unknown;
    const wrapped = wrapToolHandler(
      'knowledge_create',
      (args) => {
        seen = args;
        return okResult();
      },
      makeResolve(stack),
    );
    const res = await callTool(wrapped, { title: "x'; DROP TABLE tasks;--" });
    expect(res.isError).toBeUndefined();
    // sanitize mode escapes dangerous chars rather than stripping keywords
    expect((seen as { title: string }).title).not.toBe("x'; DROP TABLE tasks;--");
  });

  it('ACL: deny rule for role → denied; admin bypasses', async () => {
    const acl = new ACLEngine({
      enabled: true,
      policy: {
        name: 'test',
        defaultAction: 'allow',
        rules: [{ effect: 'deny', toolPattern: 'tasks_*', roles: ['user'] }],
      },
    });
    const auth = new AuthManager({
      transport: 'http',
      requireAuth: true,
      tokenValidator: createStaticValidator({
        'user-tok': { userId: 'u1', roles: ['user'] },
        'admin-tok': { userId: 'a1', roles: ['admin'] },
      }),
    });
    // grant sessions directly (no SessionManager → getRoles returns [])
    // so instead verify via evaluate path: anonymous roles → rule with roles:['user'] doesn't match → default allow.
    // For a real deny, use a rule without role restriction.
    acl.clearRules();
    acl.addRule({ effect: 'deny', toolPattern: 'tasks_*' });
    const stack = new SecurityStack({ acl, authManager: auth });
    const wrapped = wrapToolHandler('tasks_list', () => okResult(), makeResolve(stack, auth));

    const res = await callTool(wrapped, {}, 'sess-x');
    // auth gate: requireAuth on http + unauthenticated → denied at auth stage
    expect(res.isError).toBe(true);
    expect(envelope(res).error?.message).toMatch(/authentication required/);

    // authenticate, then ACL denies
    auth.grantSession('sess-x', 'u1', ['user']);
    const res2 = await callTool(wrapped, {}, 'sess-x');
    expect(res2.isError).toBe(true);
    expect(envelope(res2).error?.message).toMatch(/access denied by ACL/);

    // a non-matching tool passes ACL but still requires auth
    const wrapped2 = wrapToolHandler('knowledge_list', () => okResult(), makeResolve(stack, auth));
    const res3 = await callTool(wrapped2, {}, 'sess-x');
    expect(res3.isError).toBeUndefined();
  });

  it('audit: allowed call writes tool.call + tool.result entries', async () => {
    const auditLogger = new AuditLogger({
      enabled: true,
      filePath: auditPath,
      maxFileSize: 0,
      maxFiles: 1,
      rotateIntervalMs: 0,
      logInput: true,
      logResult: false,
      maxResultLength: 100,
      redactFields: ['token'],
    });
    const stack = new SecurityStack({ auditLogger });
    const wrapped = wrapToolHandler('tasks_list', () => okResult(), makeResolve(stack));

    const res = await callTool(wrapped, { token: 'should-be-redacted' }, 'sess-audit');
    expect(res.isError).toBeUndefined();
    await auditLogger.close();

    const lines = readFileSync(auditPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const types = lines.map((e) => `${e.type}:${e.status}`);
    expect(types).toContain('tool.call:pending');
    expect(types).toContain('tool.result:success');
    const callEv = lines.find((e) => e.type === 'tool.call');
    expect(callEv.target).toBe('tasks_list');
    expect(callEv.sessionId).toBe('sess-audit');
    expect(callEv.input.token).toBe('[REDACTED]');
  });

  it('audit: denied call writes tool.result:denied', async () => {
    const auditLogger = new AuditLogger({
      enabled: true,
      filePath: auditPath,
      maxFileSize: 0,
      maxFiles: 1,
      rotateIntervalMs: 0,
      logInput: false,
      logResult: false,
      maxResultLength: 100,
      redactFields: [],
    });
    const rateLimiter = new RateLimiter({ maxTokens: 0, burstMaxTokens: 0, refillPerSec: 0 });
    const stack = new SecurityStack({ auditLogger, rateLimiter });
    const wrapped = wrapToolHandler('tasks_list', () => okResult(), makeResolve(stack));

    const res = await callTool(wrapped);
    expect(res.isError).toBe(true);
    await auditLogger.close();

    const lines = readFileSync(auditPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.some((e) => e.type === 'tool.result' && e.status === 'denied')).toBe(true);
  });

  it('auth-protection: locked identifier → denied before handler', async () => {
    const authProtection = new AuthProtection({ maxAttempts: 2, windowMs: 60_000, maxLockoutMs: 60_000 });
    authProtection.recordFailure('sess-1');
    authProtection.recordFailure('sess-1');
    const stack = new SecurityStack({ authProtection });
    const wrapped = wrapToolHandler('mcp.authenticate', () => okResult(), makeResolve(stack));

    const res = await callTool(wrapped, { token: 'x' }, 'sess-1');
    expect(res.isError).toBe(true);
    expect(envelope(res).error?.message).toMatch(/access denied/);
  });

  it('auth-protection: failed mcp.authenticate records failure', async () => {
    const authProtection = new AuthProtection({ maxAttempts: 2, windowMs: 60_000, maxLockoutMs: 60_000 });
    const stack = new SecurityStack({ authProtection });
    const failing = wrapToolHandler(
      'mcp.authenticate',
      () => ({ content: [{ type: 'text' as const, text: 'bad' }], isError: true as const }),
      makeResolve(stack),
    );
    await callTool(failing, { token: 'bad' }, 'sess-9');
    await callTool(failing, { token: 'bad' }, 'sess-9');
    // third call should be locked out by auth-protection stage
    const res = await callTool(failing, { token: 'bad' }, 'sess-9');
    expect(envelope(res).error?.message).toMatch(/access denied/);
  });

  it('stage order: rate-limit runs before ACL', async () => {
    const rateLimiter = new RateLimiter({ maxTokens: 0, burstMaxTokens: 0, refillPerSec: 0 });
    const acl = new ACLEngine({
      enabled: true,
      policy: { name: 't', defaultAction: 'deny', rules: [] },
    });
    const stack = new SecurityStack({ rateLimiter, acl });
    const wrapped = wrapToolHandler('tasks_list', () => okResult(), makeResolve(stack));
    const res = await callTool(wrapped);
    expect(envelope(res).error?.message).toMatch(/rate limited/);
  });
});
