/**
 * core/token-manager.spec.ts — Tests for TokenManager (SEC-003).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TokenManager,
  TokenExpiredError,
  TokenRevokedError,
  InvalidTokenError,
  DEFAULT_TOKEN_OPTIONS,
} from './token-manager.js';

describe('SEC-003: TokenManager', () => {
  let tm: TokenManager;

  beforeEach(() => {
    tm = new TokenManager({
      accessTokenTtlMs: 1000,
      refreshTokenTtlMs: 5000,
      secret: 'test-secret',
      cleanupIntervalMs: 0,
    });
  });

  afterEach(() => {
    tm.close();
  });

  describe('issue()', () => {
    it('issues an access + refresh token pair', () => {
      const pair = tm.issue('user-1', ['admin']);
      expect(pair.accessToken).toBeDefined();
      expect(pair.refreshToken).toBeDefined();
      expect(pair.accessExpiresAt).toBeGreaterThan(Date.now());
      expect(pair.refreshExpiresAt).toBeGreaterThan(pair.accessExpiresAt);
    });

    it('tokens are different strings', () => {
      const pair = tm.issue('user-1');
      expect(pair.accessToken).not.toBe(pair.refreshToken);
    });

    it('tracks refresh token internally', () => {
      tm.issue('user-1');
      expect(tm.activeRefreshTokenCount).toBe(1);
    });
  });

  describe('verify() — access tokens', () => {
    it('verifies a valid access token', () => {
      const pair = tm.issue('user-1', ['admin']);
      const payload = tm.verify(pair.accessToken, 'access');
      expect(payload.userId).toBe('user-1');
      expect(payload.roles).toEqual(['admin']);
      expect(payload.type).toBe('access');
    });

    it('rejects malformed token', () => {
      expect(() => tm.verify('not-a-token', 'access')).toThrow(InvalidTokenError);
    });

    it('rejects token with wrong signature', () => {
      const pair = tm.issue('user-1');
      const parts = pair.accessToken.split('.');
      const tampered = `${parts[0]}.wrong-signature`;
      expect(() => tm.verify(tampered, 'access')).toThrow(InvalidTokenError);
    });

    it('rejects expired token', async () => {
      const shortTm = new TokenManager({
        accessTokenTtlMs: 10,
        refreshTokenTtlMs: 20,
        secret: 'test',
        cleanupIntervalMs: 0,
      });
      const pair = shortTm.issue('user-1');
      await new Promise((r) => setTimeout(r, 15));
      expect(() => shortTm.verify(pair.accessToken, 'access')).toThrow(TokenExpiredError);
      shortTm.close();
    });

    it('rejects wrong token type', () => {
      const pair = tm.issue('user-1');
      // refresh token should not work as access
      expect(() => tm.verify(pair.refreshToken, 'access')).toThrow(InvalidTokenError);
    });

    it('accepts any type when expectedType is not specified', () => {
      const pair = tm.issue('user-1');
      expect(() => tm.verify(pair.accessToken)).not.toThrow();
      expect(() => tm.verify(pair.refreshToken)).not.toThrow();
    });
  });

  describe('verify() — refresh tokens', () => {
    it('verifies a valid refresh token', () => {
      const pair = tm.issue('user-1');
      const payload = tm.verify(pair.refreshToken, 'refresh');
      expect(payload.type).toBe('refresh');
      expect(payload.userId).toBe('user-1');
    });
  });

  describe('refresh()', () => {
    it('issues a new token pair from refresh token', () => {
      const pair = tm.issue('user-1', ['user']);
      const newPair = tm.refresh(pair.refreshToken);

      expect(newPair.accessToken).not.toBe(pair.accessToken);
      expect(newPair.refreshToken).not.toBe(pair.refreshToken);
      expect(newPair.accessExpiresAt).toBeGreaterThan(Date.now());
    });

    it('revokes old refresh token after refresh (rotation)', () => {
      const pair = tm.issue('user-1');
      tm.refresh(pair.refreshToken);
      // Old refresh token should now be revoked
      expect(() => tm.verify(pair.refreshToken, 'refresh')).toThrow(TokenRevokedError);
    });

    it('rejects refresh with expired refresh token', async () => {
      const shortTm = new TokenManager({
        accessTokenTtlMs: 10,
        refreshTokenTtlMs: 20,
        secret: 'test',
        cleanupIntervalMs: 0,
      });
      const pair = shortTm.issue('user-1');
      await new Promise((r) => setTimeout(r, 25));
      expect(() => shortTm.refresh(pair.refreshToken)).toThrow(TokenExpiredError);
      shortTm.close();
    });

    it('rejects refresh with access token instead of refresh', () => {
      const pair = tm.issue('user-1');
      expect(() => tm.refresh(pair.accessToken)).toThrow(InvalidTokenError);
    });

    it('preserves userId and roles through refresh', () => {
      const pair = tm.issue('user-1', ['admin', 'user']);
      const newPair = tm.refresh(pair.refreshToken);
      const payload = tm.verify(newPair.accessToken, 'access');
      expect(payload.userId).toBe('user-1');
      expect(payload.roles).toEqual(['admin', 'user']);
    });
  });

  describe('revoke()', () => {
    it('revokes an access token', () => {
      const pair = tm.issue('user-1');
      tm.revoke(pair.accessToken);
      expect(() => tm.verify(pair.accessToken, 'access')).toThrow(TokenRevokedError);
    });

    it('revokes a refresh token', () => {
      const pair = tm.issue('user-1');
      tm.revoke(pair.refreshToken);
      expect(() => tm.verify(pair.refreshToken, 'refresh')).toThrow(TokenRevokedError);
    });

    it('isRevoked returns true for revoked token', () => {
      const pair = tm.issue('user-1');
      expect(tm.isRevoked(pair.accessToken)).toBe(false);
      tm.revoke(pair.accessToken);
      expect(tm.isRevoked(pair.accessToken)).toBe(true);
    });

    it('revoke is safe for invalid tokens', () => {
      expect(() => tm.revoke('invalid')).not.toThrow();
    });

    it('decrements activeRefreshTokenCount when revoking refresh', () => {
      const pair = tm.issue('user-1');
      expect(tm.activeRefreshTokenCount).toBe(1);
      tm.revoke(pair.refreshToken);
      expect(tm.activeRefreshTokenCount).toBe(0);
    });
  });

  describe('revokeAllForUser()', () => {
    it('revokes all refresh tokens for a user', () => {
      tm.issue('user-1', ['admin']);
      tm.issue('user-1', ['admin']);
      tm.issue('user-2', ['user']);
      expect(tm.activeRefreshTokenCount).toBe(3);

      const count = tm.revokeAllForUser('user-1');
      expect(count).toBe(2);
      expect(tm.activeRefreshTokenCount).toBe(1);
    });

    it('returns 0 for unknown user', () => {
      tm.issue('user-1');
      expect(tm.revokeAllForUser('unknown')).toBe(0);
    });
  });

  describe('createValidator()', () => {
    it('returns a validator compatible with AuthManager', async () => {
      const pair = tm.issue('user-1', ['admin']);
      const validator = tm.createValidator();
      const result = await validator(pair.accessToken);

      expect(result).not.toBeNull();
      expect(result!.userId).toBe('user-1');
      expect(result!.roles).toEqual(['admin']);
    });

    it('returns null for invalid token', async () => {
      const validator = tm.createValidator();
      const result = await validator('invalid-token');
      expect(result).toBeNull();
    });

    it('returns null for expired token', async () => {
      const shortTm = new TokenManager({
        accessTokenTtlMs: 10,
        refreshTokenTtlMs: 20,
        secret: 'test',
        cleanupIntervalMs: 0,
      });
      const pair = shortTm.issue('user-1');
      await new Promise((r) => setTimeout(r, 15));

      const validator = shortTm.createValidator();
      const result = await validator(pair.accessToken);
      expect(result).toBeNull();
      shortTm.close();
    });

    it('returns null for revoked token', async () => {
      const pair = tm.issue('user-1');
      tm.revoke(pair.accessToken);

      const validator = tm.createValidator();
      const result = await validator(pair.accessToken);
      expect(result).toBeNull();
    });

    it('includes _jwt_claims in metadata for AuthManager TTL binding', async () => {
      const pair = tm.issue('user-1');
      const validator = tm.createValidator();
      const result = await validator(pair.accessToken);

      expect(result!.metadata?._jwt_claims).toBeDefined();
      const claims = result!.metadata!._jwt_claims as Record<string, unknown>;
      expect(claims.exp).toBeDefined();
      expect(claims.iat).toBeDefined();
      expect(claims.jti).toBeDefined();
    });
  });

  describe('cleanup()', () => {
    it('removes expired tokens from blacklist', async () => {
      const shortTm = new TokenManager({
        accessTokenTtlMs: 10,
        refreshTokenTtlMs: 20,
        secret: 'test',
        cleanupIntervalMs: 0,
      });
      const pair = shortTm.issue('user-1');
      shortTm.revoke(pair.accessToken);
      expect(shortTm.blacklistedTokenCount).toBe(1);

      await new Promise((r) => setTimeout(r, 30));
      shortTm.cleanup();
      expect(shortTm.blacklistedTokenCount).toBe(0);
      shortTm.close();
    });

    it('removes expired refresh tokens', async () => {
      const shortTm = new TokenManager({
        accessTokenTtlMs: 10,
        refreshTokenTtlMs: 20,
        secret: 'test',
        cleanupIntervalMs: 0,
      });
      shortTm.issue('user-1');
      expect(shortTm.activeRefreshTokenCount).toBe(1);

      await new Promise((r) => setTimeout(r, 30));
      shortTm.cleanup();
      expect(shortTm.activeRefreshTokenCount).toBe(0);
      shortTm.close();
    });
  });

  describe('close()', () => {
    it('stops cleanup timer', () => {
      const tm2 = new TokenManager({ cleanupIntervalMs: 1000 });
      tm2.close();
      // No way to directly check timer, but close should not throw
      expect(() => tm2.close()).not.toThrow();
    });
  });

  describe('DEFAULT_TOKEN_OPTIONS', () => {
    it('has sensible defaults', () => {
      expect(DEFAULT_TOKEN_OPTIONS.accessTokenTtlMs).toBe(15 * 60 * 1000);
      expect(DEFAULT_TOKEN_OPTIONS.refreshTokenTtlMs).toBe(7 * 24 * 60 * 1000);
      expect(DEFAULT_TOKEN_OPTIONS.issuer).toBe('mcp-task-knowledge');
    });
  });

  describe('Token errors', () => {
    it('TokenExpiredError has correct code', () => {
      try {
        throw new TokenExpiredError();
      } catch (err) {
        expect(err).toBeInstanceOf(TokenExpiredError);
        expect((err as TokenExpiredError).code).toBe('TOKEN_EXPIRED');
      }
    });

    it('TokenRevokedError has correct code', () => {
      try {
        throw new TokenRevokedError();
      } catch (err) {
        expect(err).toBeInstanceOf(TokenRevokedError);
        expect((err as TokenRevokedError).code).toBe('TOKEN_REVOKED');
      }
    });

    it('InvalidTokenError has correct code', () => {
      try {
        throw new InvalidTokenError();
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidTokenError);
        expect((err as InvalidTokenError).code).toBe('INVALID_TOKEN');
      }
    });
  });

  describe('multiple users', () => {
    it('issues and verifies tokens for multiple users independently', () => {
      const pair1 = tm.issue('user-1', ['admin']);
      const pair2 = tm.issue('user-2', ['user']);

      const p1 = tm.verify(pair1.accessToken, 'access');
      const p2 = tm.verify(pair2.accessToken, 'access');

      expect(p1.userId).toBe('user-1');
      expect(p2.userId).toBe('user-2');
      expect(p1.jti).not.toBe(p2.jti);
    });

    it('revoking one user does not affect another', () => {
      const pair1 = tm.issue('user-1');
      const pair2 = tm.issue('user-2');

      tm.revoke(pair1.accessToken);
      expect(() => tm.verify(pair1.accessToken, 'access')).toThrow(TokenRevokedError);
      expect(() => tm.verify(pair2.accessToken, 'access')).not.toThrow();
    });
  });
});
