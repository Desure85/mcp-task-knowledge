import { describe, expect, it } from 'vitest';
import { AuthManager } from '../src/core/auth.js';
import { AuthProtection } from '../src/core/auth-protection.js';
import { SecurityStack } from '../src/core/security-stack.js';

function ap(): AuthProtection {
  return new AuthProtection({ maxAttempts: 2, windowMs: 60_000, maxLockoutMs: 60_000 });
}

describe('TR-21 shared IP-keyed AuthProtection', () => {
  it('SecurityStack checks the clientKey, not the sessionId', () => {
    const protection = ap();
    protection.recordFailure('203.0.113.9');
    protection.recordFailure('203.0.113.9');
    const stack = new SecurityStack({ authProtection: protection });
    const denied = stack.check({ toolName: 'tasks_list', sessionId: 'fresh-session', clientKey: '203.0.113.9' });
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.stage).toBe('auth-protection');

    const otherSessionSameIp = stack.check({ toolName: 'tasks_list', sessionId: 'other-session', clientKey: '203.0.113.9' });
    expect(otherSessionSameIp.allowed).toBe(false);

    const otherIp = stack.check({ toolName: 'tasks_list', sessionId: 'fresh-session', clientKey: '198.51.100.1' });
    expect(otherIp.allowed).toBe(true);
  });

  it('recordAuthOutcome uses the same clientKey', () => {
    const protection = ap();
    const stack = new SecurityStack({ authProtection: protection });
    stack.recordAuthOutcome({ toolName: 'mcp.authenticate', sessionId: 's1', clientKey: '203.0.113.9' }, false);
    stack.recordAuthOutcome({ toolName: 'mcp.authenticate', sessionId: 's2', clientKey: '203.0.113.9' }, false);
    const denied = stack.check({ toolName: 'tasks_list', sessionId: 's3', clientKey: '203.0.113.9' });
    expect(denied.allowed).toBe(false);
  });

  it('AuthManager exposes the IP key derived from SessionManager remote', () => {
    const sessionManager = {
      get: (id: string) => (id === 's1' ? { remote: '198.51.100.7:54321' } : undefined),
    };
    const auth = new AuthManager({ sessionManager: sessionManager as never });
    expect(auth.getClientKey('s1')).toBe('198.51.100.7');
    expect(auth.getClientKey('missing')).toBe('missing');
  });
});
