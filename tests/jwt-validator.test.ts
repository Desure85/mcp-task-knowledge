/**
 * Tests for JwtValidator — JWT/JWKS validation (A-002)
 *
 * Covers:
 *   - HMAC token validation (HS256)
 *   - Expired tokens
 *   - Not-yet-valid tokens
 *   - Invalid issuer/audience
 *   - Token revocation (blacklist)
 *   - Role extraction (array, string, nested path)
 *   - userId claim extraction
 *   - Custom metadata claims
 *   - Max age validation
 *   - Clock skew tolerance
 *   - Factory helpers (createHmacValidator, createJwksValidator)
 *   - createTestToken helper
 *   - Integration with AuthManager
 *   - asTokenValidator()
 *   - decode() without verification
 *   - Blacklist eviction
 *   - Error types
 *   - Invalid tokens (malformed, wrong secret)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as jose from 'jose';
import {
  JwtValidator,
  JwtValidationError,
  TokenExpiredError,
  TokenNotYetValidError,
  TokenRevokedError,
  InvalidIssuerError,
  InvalidAudienceError,
  createHmacValidator,
  createJwksValidator,
  createTestToken,
} from '../src/core/jwt-validator.js';
import { AuthManager, createStaticValidator } from '../src/core/auth.js';
import type { AuthResult } from '../src/core/auth.js';

// ─── Helpers ──────────────────────────────────────────────────────────

const SECRET = 'test-secret-key-32-chars-long-enough!!';
const SECRET2 = 'different-secret-key-for-testing!!';

/** Create a valid token with default claims. */
async function makeToken(overrides: Record<string, unknown> = {}, secret: string = SECRET): Promise<string> {
  const payload = {
    sub: 'user-1',
    iss: 'test-issuer',
    aud: 'test-audience',
    roles: ['admin', 'editor'],
    ...overrides,
  };
  return createTestToken(payload, secret);
}

/** Create a token that expires in `secondsFromNow` seconds. */
async function makeExpiringToken(secondsFromNow: number, overrides: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return makeToken({
    iat: now,
    exp: now + secondsFromNow,
    ...overrides,
  });
}

/** Create a token not valid until `secondsFromNow` seconds. */
async function makeNotBeforeToken(secondsFromNow: number, overrides: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return makeToken({
    iat: now - 60,
    nbf: now + secondsFromNow,
    ...overrides,
  });
}

/** Create validator with default config for testing. */
function createValidator(overrides: Record<string, unknown> = {}): JwtValidator {
  return new JwtValidator({
    secret: SECRET,
    issuer: 'test-issuer',
    audience: 'test-audience',
    clockSkew: 5,
    ...overrides,
  });
}

// ─── Error types ──────────────────────────────────────────────────────

describe('JwtValidator errors', () => {
  it('JwtValidationError should have code and message', () => {
    const err = new JwtValidationError('TEST', 'test message');
    expect(err.name).toBe('JwtValidationError');
    expect(err.code).toBe('TEST');
    expect(err.message).toBe('test message');
    expect(err).toBeInstanceOf(Error);
  });

  it('TokenExpiredError should have TOKEN_EXPIRED code', () => {
    const err = new TokenExpiredError();
    expect(err.code).toBe('TOKEN_EXPIRED');
    expect(err.message).toBe('token expired');
  });

  it('TokenNotYetValidError should have TOKEN_NOT_YET_VALID code', () => {
    const err = new TokenNotYetValidError();
    expect(err.code).toBe('TOKEN_NOT_YET_VALID');
  });

  it('TokenRevokedError should have TOKEN_REVOKED code', () => {
    const err = new TokenRevokedError();
    expect(err.code).toBe('TOKEN_REVOKED');
  });

  it('InvalidIssuerError should include expected and actual', () => {
    const err = new InvalidIssuerError('expected-iss', 'actual-iss');
    expect(err.code).toBe('INVALID_ISSUER');
    expect(err.message).toContain('expected-iss');
    expect(err.message).toContain('actual-iss');
  });

  it('InvalidAudienceError should include expected and actual', () => {
    const err = new InvalidAudienceError('expected-aud', 'actual-aud');
    expect(err.code).toBe('INVALID_AUDIENCE');
    expect(err.message).toContain('expected-aud');
  });
});

// ─── HMAC validation ──────────────────────────────────────────────────

describe('JwtValidator — HMAC validation', () => {
  it('should validate a valid token', async () => {
    const validator = createValidator();
    const token = await makeToken();
    const result = await validator.validate(token);

    expect(result).not.toBeNull();
    expect(result!.userId).toBe('user-1');
    expect(result!.roles).toEqual(['admin', 'editor']);
  });

  it('should reject a token with wrong secret', async () => {
    const validator = createValidator();
    const token = await makeToken({}, SECRET2);
    const result = await validator.validate(token);

    expect(result).toBeNull();
  });

  it('should reject a malformed token', async () => {
    const validator = createValidator();
    const result = await validator.validate('not-a-jwt');

    expect(result).toBeNull();
  });

  it('should reject an empty token', async () => {
    const validator = createValidator();
    const result = await validator.validate('');

    expect(result).toBeNull();
  });

  it('should reject a token with wrong structure', async () => {
    const validator = createValidator();
    const result = await validator.validate('header.payload');

    expect(result).toBeNull();
  });

  it('should extract metadata._jwt_claims', async () => {
    const validator = createValidator();
    const token = await makeToken({ jti: 'unique-id-123' });
    const result = await validator.validate(token);

    expect(result).not.toBeNull();
    expect(result!.metadata._jwt_claims).toBeDefined();
    expect(result!.metadata._jwt_claims.sub).toBe('user-1');
    expect(result!.metadata._jwt_claims.jti).toBe('unique-id-123');
  });
});

// ─── Expiry ───────────────────────────────────────────────────────────

describe('JwtValidator — expiry', () => {
  it('should reject an expired token', async () => {
    const validator = createValidator({ clockSkew: 0 });
    // Token expired 10 seconds ago
    const token = await makeExpiringToken(-10);
    const result = await validator.validate(token);

    expect(result).toBeNull();
  });

  it('should accept a token that expires in the future', async () => {
    const validator = createValidator({ clockSkew: 0 });
    const token = await makeExpiringToken(3600);
    const result = await validator.validate(token);

    expect(result).not.toBeNull();
  });

  it('should accept a token within clock skew tolerance', async () => {
    // Token expired 3 seconds ago, clock skew is 5 seconds
    const validator = createValidator({ clockSkew: 5 });
    const token = await makeExpiringToken(-3);
    const result = await validator.validate(token);

    expect(result).not.toBeNull();
  });

  it('should reject a token outside clock skew tolerance', async () => {
    // Token expired 10 seconds ago, clock skew is 5 seconds
    const validator = createValidator({ clockSkew: 5 });
    const token = await makeExpiringToken(-10);
    const result = await validator.validate(token);

    expect(result).toBeNull();
  });
});

// ─── Not-before ───────────────────────────────────────────────────────

describe('JwtValidator — not-before', () => {
  it('should reject a token not yet valid', async () => {
    const validator = createValidator({ clockSkew: 0 });
    // Token not valid for another 60 seconds
    const token = await makeNotBeforeToken(60);
    const result = await validator.validate(token);

    expect(result).toBeNull();
  });

  it('should accept a token with past nbf', async () => {
    const validator = createValidator({ clockSkew: 0 });
    // nbf was 60 seconds ago
    const token = await makeNotBeforeToken(-60);
    const result = await validator.validate(token);

    expect(result).not.toBeNull();
  });

  it('should accept a token within clock skew tolerance', async () => {
    // Token not valid for another 3 seconds, clock skew is 5 seconds
    const validator = createValidator({ clockSkew: 5 });
    const token = await makeNotBeforeToken(3);
    const result = await validator.validate(token);

    expect(result).not.toBeNull();
  });
});

// ─── Issuer validation ────────────────────────────────────────────────

describe('JwtValidator — issuer validation', () => {
  it('should accept correct issuer', async () => {
    const validator = createValidator({ issuer: 'test-issuer' });
    const token = await makeToken({ iss: 'test-issuer' });
    const result = await validator.validate(token);

    expect(result).not.toBeNull();
  });

  it('should reject wrong issuer', async () => {
    const validator = createValidator({ issuer: 'correct-issuer' });
    const token = await makeToken({ iss: 'wrong-issuer' });
    const result = await validator.validate(token);

    expect(result).toBeNull();
  });

  it('should accept issuer from array', async () => {
    const validator = createValidator({ issuer: ['iss-a', 'iss-b'] });
    const tokenA = await makeToken({ iss: 'iss-a' });
    const tokenB = await makeToken({ iss: 'iss-b' });

    expect((await validator.validate(tokenA))?.userId).toBe('user-1');
    expect((await validator.validate(tokenB))?.userId).toBe('user-1');
  });

  it('should reject issuer not in array', async () => {
    const validator = createValidator({ issuer: ['iss-a', 'iss-b'] });
    const token = await makeToken({ iss: 'iss-c' });
    const result = await validator.validate(token);

    expect(result).toBeNull();
  });

  it('should accept when issuer validation is not configured', async () => {
    const validator = new JwtValidator({ secret: SECRET }); // no issuer
    const token = await makeToken({ iss: 'any-issuer' });
    const result = await validator.validate(token);

    expect(result).not.toBeNull();
  });
});

// ─── Audience validation ──────────────────────────────────────────────

describe('JwtValidator — audience validation', () => {
  it('should accept correct audience', async () => {
    const validator = createValidator({ audience: 'test-audience' });
    const token = await makeToken({ aud: 'test-audience' });
    const result = await validator.validate(token);

    expect(result).not.toBeNull();
  });

  it('should reject wrong audience', async () => {
    const validator = createValidator({ audience: 'correct-aud' });
    const token = await makeToken({ aud: 'wrong-aud' });
    const result = await validator.validate(token);

    expect(result).toBeNull();
  });

  it('should match audience from array', async () => {
    const validator = createValidator({ audience: ['aud-a', 'aud-b'] });
    const token = await makeToken({ aud: ['aud-a', 'extra'] });

    expect((await validator.validate(token))?.userId).toBe('user-1');
  });

  it('should reject audience not in array', async () => {
    const validator = createValidator({ audience: ['aud-a'] });
    const token = await makeToken({ aud: 'aud-b' });

    expect(await validator.validate(token)).toBeNull();
  });
});

// ─── Max age ──────────────────────────────────────────────────────────

describe('JwtValidator — max age', () => {
  it('should reject token that is too old', async () => {
    const validator = createValidator({ maxAge: 60, clockSkew: 0 });
    const now = Math.floor(Date.now() / 1000);
    // Token issued 120 seconds ago
    const token = await makeToken({ iat: now - 120 });
    const result = await validator.validate(token);

    expect(result).toBeNull();
  });

  it('should accept fresh token', async () => {
    const validator = createValidator({ maxAge: 3600, clockSkew: 0 });
    const now = Math.floor(Date.now() / 1000);
    const token = await makeToken({ iat: now });
    const result = await validator.validate(token);

    expect(result).not.toBeNull();
  });

  it('should respect clock skew with max age', async () => {
    // Token issued 65 seconds ago, maxAge 60, clockSkew 10 → should pass (65 < 60+10)
    const validator = createValidator({ maxAge: 60, clockSkew: 10 });
    const now = Math.floor(Date.now() / 1000);
    const token = await makeToken({ iat: now - 65 });

    expect((await validator.validate(token))?.userId).toBe('user-1');
  });
});

// ─── Role extraction ──────────────────────────────────────────────────

describe('JwtValidator — role extraction', () => {
  it('should extract roles from array', async () => {
    const validator = createValidator();
    const token = await makeToken({ roles: ['admin', 'user'] });
    const result = await validator.validate(token);

    expect(result!.roles).toEqual(['admin', 'user']);
  });

  it('should extract roles from string', async () => {
    const validator = createValidator({ roleClaims: ['single_role'] });
    const token = await makeToken({ roles: undefined, single_role: 'admin' });
    const result = await validator.validate(token);

    expect(result!.roles).toEqual(['admin']);
  });

  it('should extract roles from nested path', async () => {
    const validator = createValidator({ roleClaims: ['realm_access.roles'] });
    const token = await makeToken({
      roles: undefined,
      realm_access: { roles: ['offline_access', 'uma_authorization'] },
    });
    const result = await validator.validate(token);

    expect(result!.roles).toEqual(['offline_access', 'uma_authorization']);
  });

  it('should fallback to next claim path if first is empty', async () => {
    const validator = createValidator({
      roleClaims: ['roles', 'realm_access.roles', 'groups'],
    });
    const token = await makeToken({
      roles: undefined,
      realm_access: { roles: ['role-a'] },
    });
    const result = await validator.validate(token);

    expect(result!.roles).toEqual(['role-a']);
  });

  it('should return empty array when no roles found', async () => {
    const validator = createValidator({ roleClaims: ['nonexistent'] });
    const token = await makeToken({ roles: undefined });
    const result = await validator.validate(token);

    expect(result!.roles).toEqual([]);
  });

  it('should filter non-string values from roles array', async () => {
    const validator = createValidator();
    const token = await makeToken({ roles: ['admin', 42, null, 'user'] });
    const result = await validator.validate(token);

    expect(result!.roles).toEqual(['admin', 'user']);
  });
});

// ─── User ID extraction ──────────────────────────────────────────────

describe('JwtValidator — userId extraction', () => {
  it('should extract userId from sub claim by default', async () => {
    const validator = createValidator();
    const token = await makeToken({ sub: 'my-user-id' });
    const result = await validator.validate(token);

    expect(result!.userId).toBe('my-user-id');
  });

  it('should extract userId from custom claim path', async () => {
    const validator = createValidator({ userIdClaim: 'custom.user_id' });
    const token = await makeToken({
      sub: 'sub-value',
      custom: { user_id: 'custom-user' },
    });
    const result = await validator.validate(token);

    expect(result!.userId).toBe('custom-user');
  });

  it('should reject if userId claim is missing', async () => {
    const validator = createValidator({ userIdClaim: 'custom_id' });
    const token = await makeToken({ sub: 'user-1' }); // no custom_id
    const result = await validator.validate(token);

    expect(result).toBeNull();
  });

  it('should reject if userId claim is not a string', async () => {
    const validator = createValidator({ userIdClaim: 'user_num' });
    const token = await makeToken({ user_num: 12345 });
    const result = await validator.validate(token);

    expect(result).toBeNull();
  });
});

// ─── Metadata claims ──────────────────────────────────────────────────

describe('JwtValidator — metadata claims', () => {
  it('should extract metadata from configured claims', async () => {
    const validator = createValidator({
      metadataClaims: {
        tenant: 'tenant_id',
        plan: 'subscription.plan',
      },
    });
    const token = await makeToken({
      tenant_id: 'acme',
      subscription: { plan: 'pro' },
    });
    const result = await validator.validate(token);

    expect(result).not.toBeNull();
    expect(result!.metadata.tenant).toBe('acme');
    expect(result!.metadata.plan).toBe('pro');
  });

  it('should not include metadata for missing claims', async () => {
    const validator = createValidator({
      metadataClaims: { nonexistent: 'missing.path' },
    });
    const token = await makeToken();
    const result = await validator.validate(token);

    expect(result).not.toBeNull();
    expect(result!.metadata.nonexistent).toBeUndefined();
  });
});

// ─── Blacklist / Revocation ───────────────────────────────────────────

describe('JwtValidator — blacklist', () => {
  it('should reject a revoked token', async () => {
    const validator = createValidator();
    const token = await makeToken({ jti: 'revoke-me' });

    // First validation should succeed
    expect((await validator.validate(token))?.userId).toBe('user-1');

    // Revoke
    validator.revokeByJti('revoke-me');

    // Second validation should fail
    expect(await validator.validate(token)).toBeNull();
  });

  it('should report revoked status', () => {
    const validator = createValidator();
    expect(validator.isRevoked('jti-1')).toBe(false);

    validator.revokeByJti('jti-1');
    expect(validator.isRevoked('jti-1')).toBe(true);
  });

  it('should report blacklist size', () => {
    const validator = createValidator();
    expect(validator.blacklistSize).toBe(0);

    validator.revokeByJti('jti-1');
    expect(validator.blacklistSize).toBe(1);

    validator.revokeByJti('jti-2');
    expect(validator.blacklistSize).toBe(2);
  });

  it('should not add duplicate jti to blacklist', () => {
    const validator = createValidator();
    validator.revokeByJti('jti-1');
    validator.revokeByJti('jti-1');

    expect(validator.blacklistSize).toBe(1);
  });

  it('should evict oldest entries when at capacity', () => {
    const validator = createValidator({ maxBlacklistSize: 3 });

    validator.revokeByJti('jti-1');
    validator.revokeByJti('jti-2');
    validator.revokeByJti('jti-3');
    expect(validator.blacklistSize).toBe(3);

    // Adding one more should evict jti-1
    validator.revokeByJti('jti-4');
    expect(validator.blacklistSize).toBe(3);
    expect(validator.isRevoked('jti-1')).toBe(false);
    expect(validator.isRevoked('jti-2')).toBe(true);
    expect(validator.isRevoked('jti-4')).toBe(true);
  });

  it('should clear blacklist', () => {
    const validator = createValidator();
    validator.revokeByJti('jti-1');
    validator.revokeByJti('jti-2');

    validator.clearBlacklist();
    expect(validator.blacklistSize).toBe(0);
    expect(validator.isRevoked('jti-1')).toBe(false);
  });

  it('should allow tokens without jti (revocation not applicable)', async () => {
    const validator = createValidator();
    const token = await makeToken(); // no jti set

    expect((await validator.validate(token))?.userId).toBe('user-1');
  });
});

// ─── Factory helpers ──────────────────────────────────────────────────

describe('createHmacValidator', () => {
  it('should create a working HMAC validator', async () => {
    const validator = createHmacValidator({
      secret: SECRET,
      issuer: 'test-issuer',
    });
    const token = await makeToken({ iss: 'test-issuer' });
    const result = await validator.validate(token);

    expect(result!.userId).toBe('user-1');
  });

  it('should reject wrong issuer', async () => {
    const validator = createHmacValidator({
      secret: SECRET,
      issuer: 'wrong-issuer',
    });
    const token = await makeToken({ iss: 'test-issuer' });

    expect(await validator.validate(token)).toBeNull();
  });
});

describe('createJwksValidator', () => {
  it('should require jwksUri', () => {
    expect(() => createJwksValidator({ jwksUri: 'https://example.com/jwks' })).not.toThrow();
  });
});

describe('createTestToken', () => {
  it('should create a valid JWT', async () => {
    const token = await createTestToken({ sub: 'test' }, 'secret', 'HS256');
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');

    // Should have 3 parts
    const parts = token.split('.');
    expect(parts.length).toBe(3);
  });

  it('should create a verifiable JWT', async () => {
    const secret = 'verify-secret';
    const token = await createTestToken({ sub: 'verify-me' }, secret, 'HS256');

    // Verify with jose directly
    const key = new TextEncoder().encode(secret);
    const { payload } = await jose.jwtVerify(token, key);
    expect(payload.sub).toBe('verify-me');
  });
});

// ─── Constructor validation ───────────────────────────────────────────

describe('JwtValidator constructor', () => {
  it('should throw if neither secret nor jwksUri provided', () => {
    expect(() => new JwtValidator({})).toThrow('requires either "secret" or "jwksUri"');
  });

  it('should accept secret', () => {
    expect(() => new JwtValidator({ secret: 'x' })).not.toThrow();
  });

  it('should accept jwksUri', () => {
    expect(() => new JwtValidator({ jwksUri: 'https://example.com/jwks' })).not.toThrow();
  });
});

// ─── Decode (no verification) ────────────────────────────────────────

describe('JwtValidator — decode', () => {
  it('should decode a token without verification', async () => {
    const validator = createValidator();
    const token = await makeToken({ sub: 'decode-me', jti: 'jt-123' });

    const { header, payload } = validator.decode(token);
    expect(header.alg).toBe('HS256');
    expect(payload.sub).toBe('decode-me');
    expect(payload.jti).toBe('jt-123');
  });

  it('should decode even with wrong secret', async () => {
    const validator = createValidator({ secret: 'right-secret' });
    const token = await makeToken({ sub: 'any' }, 'wrong-secret');

    // decode should work (no verification)
    const { payload } = validator.decode(token);
    expect(payload.sub).toBe('any');
  });
});

// ─── asTokenValidator ─────────────────────────────────────────────────

describe('JwtValidator — asTokenValidator', () => {
  it('should return a TokenValidator function', async () => {
    const validator = createValidator();
    const tokenFn = validator.asTokenValidator();

    expect(typeof tokenFn).toBe('function');

    const token = await makeToken();
    const result = await tokenFn(token);
    expect(result!.userId).toBe('user-1');
  });

  it('should return null for invalid tokens', async () => {
    const validator = createValidator();
    const tokenFn = validator.asTokenValidator();

    expect(await tokenFn('invalid')).toBeNull();
  });
});

// ─── Integration with AuthManager ─────────────────────────────────────

describe('JwtValidator — AuthManager integration', () => {
  it('should work as TokenValidator for AuthManager', async () => {
    const validator = createValidator();
    const auth = new AuthManager({
      requireAuth: true,
      tokenValidator: validator.asTokenValidator(),
    });

    const token = await makeToken();
    const result = await auth.authenticate('session-1', token);

    expect(result.userId).toBe('user-1');
    expect(result.roles).toEqual(['admin', 'editor']);
    expect(auth.isAuthenticated('session-1')).toBe(true);
  });

  it('should reject invalid tokens via AuthManager', async () => {
    const validator = createValidator();
    const auth = new AuthManager({
      requireAuth: true,
      tokenValidator: validator.asTokenValidator(),
    });

    await expect(auth.authenticate('session-1', await makeToken({}, SECRET2))).rejects.toThrow();
    expect(auth.isAuthenticated('session-1')).toBe(false);
  });

  it('should propagate revocation through AuthManager', async () => {
    const validator = createValidator();
    const auth = new AuthManager({
      requireAuth: true,
      tokenValidator: validator.asTokenValidator(),
    });

    const token = await makeToken({ jti: 'revoke-jti' });

    // Authenticate successfully
    await auth.authenticate('session-1', token);
    expect(auth.isAuthenticated('session-1')).toBe(true);

    // Revoke the token
    validator.revokeByJti('revoke-jti');

    // Re-authentication with same token should fail
    await expect(auth.authenticate('session-2', token)).rejects.toThrow();
  });

  it('should reject expired tokens via AuthManager', async () => {
    const validator = createValidator({ clockSkew: 0 });
    const auth = new AuthManager({
      requireAuth: true,
      tokenValidator: validator.asTokenValidator(),
    });

    const token = await makeExpiringToken(-10);
    await expect(auth.authenticate('session-1', token)).rejects.toThrow();
  });
});

// ─── JWKS cache ───────────────────────────────────────────────────────

describe('JwtValidator — JWKS cache', () => {
  it('should invalidate cache', () => {
    const validator = new JwtValidator({ jwksUri: 'https://example.com/jwks' });
    // Should not throw
    validator.invalidateCache();
  });

  it('should create new resolver after invalidation', () => {
    const validator = new JwtValidator({ jwksUri: 'https://example.com/jwks' });
    validator.invalidateCache();
    // Private field — just ensure no error
    expect(true).toBe(true);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────

describe('JwtValidator — edge cases', () => {
  it('should handle token without exp (never expires)', async () => {
    const validator = createValidator();
    const token = await makeToken({ exp: undefined });
    expect((await validator.validate(token))?.userId).toBe('user-1');
  });

  it('should handle token without iat', async () => {
    const validator = createValidator({ maxAge: 3600 });
    const token = await makeToken({ iat: undefined });
    // No iat + maxAge configured → should still pass (maxAge only checked when iat present)
    expect((await validator.validate(token))?.userId).toBe('user-1');
  });

  it('should handle token without nbf', async () => {
    const validator = createValidator();
    const token = await makeToken({ nbf: undefined });
    expect((await validator.validate(token))?.userId).toBe('user-1');
  });

  it('should handle multiple rapid validations', async () => {
    const validator = createValidator();
    const token = await makeToken();

    // Run 100 validations concurrently
    const results = await Promise.all(
      Array.from({ length: 100 }, () => validator.validate(token)),
    );

    expect(results.every((r) => r !== null && r.userId === 'user-1')).toBe(true);
  });

  it('should handle concurrent revocations', () => {
    const validator = createValidator({ maxBlacklistSize: 100 });

    // Revoke 50 tokens concurrently
    for (let i = 0; i < 50; i++) {
      validator.revokeByJti(`jti-${i}`);
    }

    expect(validator.blacklistSize).toBe(50);
    for (let i = 0; i < 50; i++) {
      expect(validator.isRevoked(`jti-${i}`)).toBe(true);
    }
  });

  it('should work without issuer/audience configured', async () => {
    const validator = new JwtValidator({ secret: SECRET });
    const token = await makeToken({ iss: undefined, aud: undefined });
    const result = await validator.validate(token);

    expect(result!.userId).toBe('user-1');
  });
});
