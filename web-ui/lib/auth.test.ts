import { describe, it, expect } from 'vitest';
import { sanitizeNextPath, decodeJwtClaims, isExpired, formatRemaining, isAuthRequiredError } from './auth';

function jwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256' })}.${enc(payload)}.sig`;
}

describe('sanitizeNextPath (open-redirect guard)', () => {
  it.each([
    ['/tasks', '/tasks'],
    ['/knowledge?id=a b', '/knowledge?id=a b'],
    [null, '/'],
    [undefined, '/'],
    ['', '/'],
    ['//evil.com', '/'],
    ['/\\evil.com', '/'],
    ['https://evil.com', '/'],
    ['javascript:alert(1)', '/'],
    ['tasks', '/'],
    ['/a\nb', '/'],
    ['/login', '/'],
    ['/login?next=/x', '/'],
  ])('%j → %j', (input, expected) => {
    expect(sanitizeNextPath(input as string | null | undefined)).toBe(expected);
  });
});

describe('decodeJwtClaims', () => {
  it('reads sub/roles/exp, including unicode subjects', () => {
    const c = decodeJwtClaims(jwt({ sub: 'админ', roles: ['admin', 7], exp: 100, iat: 1 }));
    expect(c).toEqual({ sub: 'админ', roles: ['admin'], exp: 100, iat: 1 });
  });
  it('returns null for malformed tokens', () => {
    expect(decodeJwtClaims('nope')).toBeNull();
    expect(decodeJwtClaims('a.b.c')).toBeNull();
    expect(decodeJwtClaims(undefined)).toBeNull();
  });
});

describe('expiry helpers', () => {
  it('isExpired compares exp (seconds) to now', () => {
    expect(isExpired({ roles: [], exp: 10 }, 11_000)).toBe(true);
    expect(isExpired({ roles: [], exp: 10 }, 9_000)).toBe(false);
    expect(isExpired({ roles: [] }, 9_000)).toBe(false);
    expect(isExpired(null)).toBe(false);
  });
  it('formatRemaining picks the right unit', () => {
    const now = 1_000_000_000;
    expect(formatRemaining(undefined, now)).toBe('no expiry');
    expect(formatRemaining(now / 1000 - 1, now)).toBe('expired');
    expect(formatRemaining(now / 1000 + 35, now)).toBe('35s');
    expect(formatRemaining(now / 1000 + 4 * 3600 + 12 * 60, now)).toBe('4h 12m');
    expect(formatRemaining(now / 1000 + 2 * 86400 + 3 * 3600, now)).toBe('2d 3h');
  });
});

describe('isAuthRequiredError', () => {
  it('detects SDK 401 and auth messages, ignores ordinary failures', () => {
    expect(isAuthRequiredError({ code: 401, message: 'x' })).toBe(true);
    expect(isAuthRequiredError(new Error('mcp.authenticate failed: token expired'))).toBe(true);
    expect(isAuthRequiredError(new Error('Authentication required'))).toBe(true);
    expect(isAuthRequiredError(new Error('task not found'))).toBe(false);
    expect(isAuthRequiredError(null)).toBe(false);
  });
});
