/**
 * core/token-manager.ts — Token refresh flow (SEC-003).
 *
 * Implements short-lived access tokens + refresh tokens with revocation.
 *
 * Architecture:
 *   1. Client authenticates → TokenManager.issue() → access + refresh tokens
 *   2. Access token expires (15-30 min) → client calls refresh(refreshToken)
 *   3. TokenManager validates refresh token → issues new access token
 *   4. Client logs out → TokenManager.revoke(refreshToken) → blacklisted
 *
 * Token format: base64url(JSON payload) — simple, no external JWT lib needed.
 * For production JWT/JWKS, use A-002's JWT validator as tokenValidator.
 *
 * Integration with AuthManager:
 *   const tokenManager = new TokenManager({ ... });
 *   const auth = new AuthManager({
 *     tokenValidator: tokenManager.createValidator(),
 *     ...
 *   });
 */

import { randomUUID, createHmac } from 'node:crypto';
import { childLogger } from './logger.js';

const log = childLogger('token-manager');

// ─── Types ────────────────────────────────────────────────────────

export interface TokenPayload {
  /** Token ID (for revocation tracking). */
  jti: string;
  /** User ID. */
  userId: string;
  /** User roles. */
  roles: string[];
  /** Token type: access or refresh. */
  type: 'access' | 'refresh';
  /** Issued at (ms since epoch). */
  iat: number;
  /** Expiration (ms since epoch). */
  exp: number;
  /** Optional session ID binding. */
  sessionId?: string;
  /** Optional metadata. */
  metadata?: Record<string, unknown>;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
}

export interface TokenManagerOptions {
  /** Access token TTL in ms (default: 15 min). */
  accessTokenTtlMs?: number;
  /** Refresh token TTL in ms (default: 7 days). */
  refreshTokenTtlMs?: number;
  /** Secret for HMAC signing (default: random per-process). */
  secret?: string;
  /** Issuer (default: 'mcp-task-knowledge'). */
  issuer?: string;
  /** Interval for cleaning expired tokens from blacklist (ms, 0 = disabled). */
  cleanupIntervalMs?: number;
}

export const DEFAULT_TOKEN_OPTIONS: Required<TokenManagerOptions> = {
  accessTokenTtlMs: 15 * 60 * 1000,   // 15 minutes
  refreshTokenTtlMs: 7 * 24 * 60 * 1000, // 7 days
  secret: randomUUID(), // per-process secret
  issuer: 'mcp-task-knowledge',
  cleanupIntervalMs: 60 * 60 * 1000, // 1 hour
};

// ─── Errors ───────────────────────────────────────────────────────

export class TokenError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TokenError';
  }
}

export class TokenExpiredError extends TokenError {
  constructor(message = 'token expired') {
    super('TOKEN_EXPIRED', message);
  }
}

export class TokenRevokedError extends TokenError {
  constructor(message = 'token revoked') {
    super('TOKEN_REVOKED', message);
  }
}

export class InvalidTokenError extends TokenError {
  constructor(message = 'invalid token') {
    super('INVALID_TOKEN', message);
  }
}

// ─── Token encoding ───────────────────────────────────────────────

function base64urlEncode(data: string): string {
  return Buffer.from(data, 'utf8').toString('base64url');
}

function base64urlDecode(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf8');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

// ─── TokenManager ─────────────────────────────────────────────────

export class TokenManager {
  private readonly options: Required<TokenManagerOptions>;
  private readonly blacklist = new Map<string, number>(); // jti → exp (for cleanup)
  private readonly refreshTokens = new Map<string, TokenPayload>(); // jti → payload (active refresh tokens)
  private cleanupTimer?: NodeJS.Timeout;

  constructor(options?: TokenManagerOptions) {
    this.options = { ...DEFAULT_TOKEN_OPTIONS, ...options };

    if (this.options.cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(
        () => this.cleanup(),
        this.options.cleanupIntervalMs,
      );
    }
  }

  get accessTokenTtlMs(): number {
    return this.options.accessTokenTtlMs;
  }

  get refreshTokenTtlMs(): number {
    return this.options.refreshTokenTtlMs;
  }

  /**
   * Issue a new access + refresh token pair for a user.
   */
  issue(userId: string, roles: string[] = [], extra?: {
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }): TokenPair {
    const now = Date.now();
    const accessExp = now + this.options.accessTokenTtlMs;
    const refreshExp = now + this.options.refreshTokenTtlMs;

    const accessPayload: TokenPayload = {
      jti: randomUUID(),
      userId,
      roles,
      type: 'access',
      iat: now,
      exp: accessExp,
      sessionId: extra?.sessionId,
      metadata: extra?.metadata,
    };

    const refreshPayload: TokenPayload = {
      jti: randomUUID(),
      userId,
      roles,
      type: 'refresh',
      iat: now,
      exp: refreshExp,
      sessionId: extra?.sessionId,
    };

    // Track refresh token for revocation
    this.refreshTokens.set(refreshPayload.jti, refreshPayload);

    const accessToken = this.encode(accessPayload);
    const refreshToken = this.encode(refreshPayload);

    log.info({ userId, accessExp, refreshExp }, 'token pair issued');

    return {
      accessToken,
      refreshToken,
      accessExpiresAt: accessExp,
      refreshExpiresAt: refreshExp,
    };
  }

  /**
   * Encode a token payload into a signed string.
   * Format: base64url(payload).signature
   */
  private encode(payload: TokenPayload): string {
    const payloadStr = JSON.stringify(payload);
    const encoded = base64urlEncode(payloadStr);
    const sig = sign(encoded, this.options.secret);
    return `${encoded}.${sig}`;
  }

  /**
   * Decode and verify a token string.
   * Checks signature, expiration, and blacklist.
   *
   * @param token — token string
   * @param expectedType — if provided, verifies token type matches
   * @returns decoded TokenPayload
   * @throws TokenExpiredError, TokenRevokedError, InvalidTokenError
   */
  verify(token: string, expectedType?: 'access' | 'refresh'): TokenPayload {
    const parts = token.split('.');
    if (parts.length !== 2) {
      throw new InvalidTokenError('malformed token');
    }

    const [encoded, sig] = parts;

    // Verify signature
    const expectedSig = sign(encoded, this.options.secret);
    if (sig !== expectedSig) {
      throw new InvalidTokenError('invalid signature');
    }

    // Decode payload
    let payload: TokenPayload;
    try {
      payload = JSON.parse(base64urlDecode(encoded)) as TokenPayload;
    } catch {
      throw new InvalidTokenError('malformed payload');
    }

    // Check type
    if (expectedType && payload.type !== expectedType) {
      throw new InvalidTokenError(`expected ${expectedType} token, got ${payload.type}`);
    }

    // Check expiration
    if (Date.now() >= payload.exp) {
      throw new TokenExpiredError();
    }

    // Check blacklist
    if (this.blacklist.has(payload.jti)) {
      throw new TokenRevokedError();
    }

    return payload;
  }

  /**
   * Refresh an access token using a refresh token.
   * The old refresh token is revoked (rotation) and a new pair is issued.
   *
   * @param refreshToken — the refresh token string
   * @returns new TokenPair
   * @throws TokenExpiredError, TokenRevokedError, InvalidTokenError
   */
  refresh(refreshToken: string): TokenPair {
    const payload = this.verify(refreshToken, 'refresh');

    // Revoke old refresh token (rotation)
    this.blacklist.set(payload.jti, payload.exp);
    this.refreshTokens.delete(payload.jti);

    // Issue new pair
    return this.issue(payload.userId, payload.roles, {
      sessionId: payload.sessionId,
    });
  }

  /**
   * Revoke a token (add to blacklist).
   * Works for both access and refresh tokens.
   */
  revoke(token: string): void {
    try {
      // Decode without verification to get jti
      const parts = token.split('.');
      if (parts.length !== 2) return;

      const payload = JSON.parse(base64urlDecode(parts[0])) as TokenPayload;
      this.blacklist.set(payload.jti, payload.exp);

      if (payload.type === 'refresh') {
        this.refreshTokens.delete(payload.jti);
      }

      log.info({ jti: payload.jti, type: payload.type }, 'token revoked');
    } catch {
      // If we can't decode it, it's already invalid
    }
  }

  /**
   * Revoke all tokens for a user.
   * This is a best-effort operation — it revokes all tracked refresh tokens.
   */
  revokeAllForUser(userId: string): number {
    let count = 0;
    for (const [jti, payload] of this.refreshTokens) {
      if (payload.userId === userId) {
        this.blacklist.set(jti, payload.exp);
        this.refreshTokens.delete(jti);
        count++;
      }
    }
    if (count > 0) {
      log.info({ userId, count }, 'all tokens revoked for user');
    }
    return count;
  }

  /**
   * Check if a token is revoked (in blacklist).
   */
  isRevoked(token: string): boolean {
    try {
      const parts = token.split('.');
      if (parts.length !== 2) return true;
      const payload = JSON.parse(base64urlDecode(parts[0])) as TokenPayload;
      return this.blacklist.has(payload.jti);
    } catch {
      return true;
    }
  }

  /**
   * Get count of active refresh tokens.
   */
  get activeRefreshTokenCount(): number {
    return this.refreshTokens.size;
  }

  /**
   * Get count of blacklisted tokens.
   */
  get blacklistedTokenCount(): number {
    return this.blacklist.size;
  }

  /**
   * Create a token validator function compatible with AuthManager.
   * Validates access tokens and returns AuthResult.
   */
  createValidator(): (token: string) => Promise<{ userId: string; roles: string[]; metadata?: Record<string, unknown> } | null> {
    return async (token: string) => {
      try {
        const payload = this.verify(token, 'access');
        return {
          userId: payload.userId,
          roles: payload.roles,
          metadata: {
            ...payload.metadata,
            _jwt_claims: {
              exp: Math.floor(payload.exp / 1000),
              iat: Math.floor(payload.iat / 1000),
              jti: payload.jti,
            },
          },
        };
      } catch (err) {
        log.warn({ err: (err as Error).message }, 'token validation failed');
        return null;
      }
    };
  }

  /**
   * Clean up expired tokens from blacklist and refresh token store.
   */
  cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    // Clean blacklist
    for (const [jti, exp] of this.blacklist) {
      if (exp < now) {
        this.blacklist.delete(jti);
        cleaned++;
      }
    }

    // Clean expired refresh tokens
    for (const [jti, payload] of this.refreshTokens) {
      if (payload.exp < now) {
        this.refreshTokens.delete(jti);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log.info({ cleaned }, 'token cleanup complete');
    }
  }

  /**
   * Close the token manager and stop cleanup timer.
   */
  close(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}
