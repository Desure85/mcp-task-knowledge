/**
 * tests/request-scope-project.test.ts — PH-004 unit coverage.
 *
 * resolveProject() precedence: explicit arg > session-scoped current
 * (ALS + resolver) > global current. Covers the session metadata path
 * without spawning a server.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { resolveProject, setSessionProjectResolver, setCurrentProject } from '../src/config.js';
import { requestScope, currentSessionId } from '../src/core/request-context.js';

describe('PH-004: session-scoped project resolution', () => {
  afterEach(() => {
    setSessionProjectResolver(undefined);
    setCurrentProject('mcp');
  });

  it('explicit project arg always wins', () => {
    setSessionProjectResolver(() => 'session-proj');
    expect(requestScope.run({ sessionId: 's1' }, () => resolveProject('explicit'))).toBe('explicit');
    expect(resolveProject('explicit')).toBe('explicit');
  });

  it('session-scoped resolver applies inside ALS scope', () => {
    setSessionProjectResolver(() => 'session-proj');
    const resolved = requestScope.run({ sessionId: 's1' }, () => resolveProject());
    expect(resolved).toBe('session-proj');
  });

  it('falls back to global current when resolver returns undefined', () => {
    setCurrentProject('global-proj');
    setSessionProjectResolver(() => undefined);
    expect(requestScope.run({ sessionId: 's1' }, () => resolveProject())).toBe('global-proj');
  });

  it('falls back to global current when no resolver is wired', () => {
    setCurrentProject('global-proj');
    expect(requestScope.run({ sessionId: 's1' }, () => resolveProject())).toBe('global-proj');
  });

  it('whitespace-only session value falls back to global', () => {
    setCurrentProject('global-proj');
    setSessionProjectResolver(() => '   ');
    expect(requestScope.run({ sessionId: 's1' }, () => resolveProject())).toBe('global-proj');
  });

  it('currentSessionId reflects ALS store and is empty outside scope', () => {
    expect(currentSessionId()).toBeUndefined();
    expect(requestScope.run({ sessionId: 'sX' }, () => currentSessionId())).toBe('sX');
  });
});
