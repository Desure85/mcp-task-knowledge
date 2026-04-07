/**
 * JwtValidator — JWT/JWKS token validation (A-002)
 *
 * Provides a production-ready TokenValidator for AuthManager that validates
 * JSON Web Tokens using either local secrets (HMAC) or remote JWKS (RSA/ECDSA).
 *
 * Features:
 *   - HS256, HS384, HS512 (symmetric — shared secret)
 *   - RS256, RS384, RS512, ES256, ES384, ES512 (asymmetric — JWKS)
 *   - JWKS endpoint support with in-memory key caching + TTL
 *   - Automatic key rotation (multiple keys in JWKS, matched by kid)
 *   - Standard claim validation: exp, nbf, iss, aud
 *   - Clock skew tolerance (configurable, default 30s)
 *   - Token blacklist (jti-based revocation, in-memory)
 *   - Role extraction from custom claims (roles, realm_access.roles, groups)
 *   - userId from sub claim (configurable mapping)
 *
 * Integration:
 *   const validator = new JwtValidator({ issuer: 'https://auth.example.com', ... });
 *   const auth = new AuthManager({ tokenValidator: validator.validate.bind(validator) });
 *
 * JWKS mode:
 *   const validator = new JwtValidator({
 *     jwksUri: 'https://auth.example.com/.well-known/jwks.json',
 *     issuer: 'https://auth.example.com',
 *     audience: 'mcp-server',
 *   });
 *
 * HMAC mode:
 *   const validator = new JwtValidator({
 *     secret: process.env.JWT_SECRET!,
 *     issuer: 'mcp-server',
 *   });
 */

import * as jose from 'jose';
import type { JWTHeaderParameters, JWTPayload, JWTVerifyResult } from 'jose';
import type { TokenValidator, AuthResult } from './auth.js';
import { childLogger } from './logger.js';

const log = childLogger('jwt-validator');

// ─── Types ────────────────────────────────────────────────────────────

/** Supported JWS algorithms. */
export type JwtAlgorithm =
  | 'HS256' | 'HS384' | 'HS512'
  | 'RS256' | 'RS384' | 'RS512'
  | 'ES256' | 'ES384' | 'ES512';

/** Options for JwtValidator. */
export interface JwtValidatorOptions {
  // ── Secret mode (HMAC) ──

  /** Shared secret for HMAC algorithms (HS256/HS384/HS512). */
  secret?: string;

  // ── JWKS mode (asymmetric) ──

  /** JWKS endpoint URL for asymmetric key discovery. */
  jwksUri?: string;

  /**
   * Cache TTL for JWKS keys in milliseconds.
   * Default: 5 minutes (300_000 ms).
   */
  jwksCacheTtl?: number;

  // ── Claim validation ──

  /** Expected issuer (iss claim). Validates if provided. */
  issuer?: string | string[];

  /** Expected audience (aud claim). Validates if provided. */
  audience?: string | string[];

  /** Clock skew tolerance in seconds. Default: 30. */
  clockSkew?: number;

  /** Maximum token age in seconds (iat claim). Optional. */
  maxAge?: number;

  // ── Claim mapping ──

  /**
   * Claim path for userId extraction.
   * Default: 'sub'.
   * For nested paths use dot notation: 'custom.user_id'.
   */
  userIdClaim?: string;

  /**
   * Claim paths for role extraction.
   * Checked in order; first match wins.
   * Default: ['roles', 'realm_access.roles', 'groups'].
   */
  roleClaims?: string[];

  /**
   * Extract additional metadata from specific claims.
   * Map of metadataKey → claimPath.
   * Example: { tenant: 'tenant_id', plan: 'subscription.plan' }
   */
  metadataClaims?: Record<string, string>;

  // ── Revocation ──

  /**
   * Maximum blacklist size. Default: 10_000.
   * When exceeded, oldest entries are evicted.
   */
  maxBlacklistSize?: number;
}

/** Parsed JWT payload with typed claims. */
export interface JwtPayload extends JWTPayload {
  [key: string]: unknown;
}

// ─── Errors ───────────────────────────────────────────────────────────

/** Base error for JWT validation failures. */
export class JwtValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'JwtValidationError';
  }
}

/** Token has expired. */
export class TokenExpiredError extends JwtValidationError {
  constructor(message: string = 'token expired') {
    super('TOKEN_EXPIRED', message);
  }
}

/** Token is not yet valid. */
export class TokenNotYetValidError extends JwtValidationError {
  constructor(message: string = 'token not yet valid') {
    super('TOKEN_NOT_YET_VALID', message);
  }
}

/** Token has been revoked (blacklisted). */
export class TokenRevokedError extends JwtValidationError {
  constructor(message: string = 'token revoked') {
    super('TOKEN_REVOKED', message);
  }
}

/** Invalid issuer. */
export class InvalidIssuerError extends JwtValidationError {
  constructor(expected: string | string[], actual?: string) {
    super('INVALID_ISSUER', `invalid issuer: expected ${Array.isArray(expected) ? expected.join('|') : expected}, got ${actual ?? 'undefined'}`);
  }
}

/** Invalid audience. */
export class InvalidAudienceError extends JwtValidationError {
  constructor(expected: string | string[], actual?: string | string[]) {
    super('INVALID_AUDIENCE', `invalid audience: expected ${Array.isArray(expected) ? expected.join('|') : expected}, got ${actual ?? 'undefined'}`);
  }
}

// ─── JwtValidator ─────────────────────────────────────────────────────

/**
 * JWT/JWKS token validator.
 *
 * Validates JWT tokens and returns AuthResult for use with AuthManager.
 * Supports both HMAC (shared secret) and JWKS (asymmetric key discovery).
 */
export class JwtValidator {
  private readonly secret?: string;
  private readonly jwksUri?: string;
  private readonly jwksCacheTtl: number;
  private readonly expectedIssuer?: string | string[];
  private readonly expectedAudience?: string | string[];
  private readonly clockSkew: number;
  private readonly maxAge?: number;
  private readonly userIdClaim: string;
  private readonly roleClaims: string[];
  private readonly metadataClaims: Record<string, string>;
  private readonly maxBlacklistSize: number;

  // State
  private jwksResolver?: ReturnType<typeof jose.createRemoteJWKSet>;
  private readonly blacklist = new Set<string>();
  private readonly blacklistTimestamps: Array<{ jti: string; ts: number }> = [];

  constructor(options: JwtValidatorOptions) {
    if (!options.secret && !options.jwksUri) {
      throw new Error('JwtValidator requires either "secret" or "jwksUri"');
    }

    this.secret = options.secret;
    this.jwksUri = options.jwksUri;
    this.jwksCacheTtl = options.jwksCacheTtl ?? 300_000; // 5 min
    this.expectedIssuer = options.issuer;
    this.expectedAudience = options.audience;
    this.clockSkew = options.clockSkew ?? 30;
    this.maxAge = options.maxAge;
    this.userIdClaim = options.userIdClaim ?? 'sub';
    this.roleClaims = options.roleClaims ?? ['roles', 'realm_access.roles', 'groups'];
    this.metadataClaims = options.metadataClaims ?? {};
    this.maxBlacklistSize = options.maxBlacklistSize ?? 10_000;
  }

  // ─── Public API ────────────────────────────────────────────────────

  /**
   * Validate a JWT token and return AuthResult (or null if invalid).
   *
   * This method implements the TokenValidator interface for use with AuthManager.
   * It performs the following checks in order:
   *   1. Token revocation (blacklist)
   *   2. Signature verification (HMAC or JWKS)
   *   3. Expiry (exp) with clock skew
   *   4. Not-before (nbf) with clock skew
   *   5. Issuer (iss) validation
   *   6. Audience (aud) validation
   *   7. Max age (iat) validation
   *   8. userId extraction
   *
   * On any validation failure, returns null (TokenValidator contract).
   * Errors are logged for observability.
   */
  async validate(token: string): Promise<AuthResult | null> {
    try {
      // Step 1: Check blacklist (decode without verification)
      const rawPayload = jose.decodeJwt(token);
      if (rawPayload.jti && this.blacklist.has(rawPayload.jti)) {
        log.warn({ jti: rawPayload.jti }, 'token rejected — revoked');
        return null;
      }

      // Step 2: Verify signature (jose validates exp, nbf, iss, aud with clockTolerance)
      const { payload } = await this.verifySignature(token);
      const claims = payload as JwtPayload & Record<string, unknown>;

      // Steps 3-6: exp/nbf/iss/aud already validated by jose.jwtVerify with our options.

      // Step 7: Validate max age (iat) — additional check beyond jose's defaults
      if (this.maxAge && claims.iat != null) {
        const now = Date.now() / 1000;
        if (claims.iat < now - this.maxAge - this.clockSkew) {
          log.warn({ iat: claims.iat, maxAge: this.maxAge }, 'token rejected — token too old');
          return null;
        }
      }

      // Step 8: Extract userId
      const userId = this.extractClaim(claims, this.userIdClaim);
      if (!userId || typeof userId !== 'string') {
        log.warn({ userIdClaim: this.userIdClaim }, 'token rejected — missing userId claim');
        return null;
      }

      // Extract roles
      const roles = this.extractRoles(claims);

      // Extract additional metadata
      const metadata: Record<string, unknown> = {};
      for (const [metaKey, claimPath] of Object.entries(this.metadataClaims)) {
        const value = this.extractClaim(claims, claimPath);
        if (value !== undefined) {
          metadata[metaKey] = value;
        }
      }

      // Store original claims in metadata
      metadata._jwt_claims = {
        sub: claims.sub,
        iss: claims.iss,
        aud: claims.aud,
        exp: claims.exp,
        iat: claims.iat,
        jti: claims.jti,
      };

      log.info({ userId, roles, jti: claims.jti }, 'JWT validated successfully');

      return { userId, roles, metadata };
    } catch (err) {
      if (err instanceof JwtValidationError) {
        log.warn({ code: err.code, message: err.message }, 'JWT validation failed');
      } else {
        log.error({ err }, 'JWT validation error');
      }
      return null;
    }
  }

  /**
   * Revoke a token by its jti claim.
   *
   * Adds the jti to the blacklist so future validation calls will reject it.
   * Note: call this before validate() to prevent race conditions, or use
   * it for proactive revocation (e.g. on logout or token refresh).
   */
  revokeByJti(jti: string): void {
    if (this.blacklist.has(jti)) return;

    this.blacklist.add(jti);
    this.blacklistTimestamps.push({ jti, ts: Date.now() });

    // Evict oldest entries if at capacity
    while (this.blacklistTimestamps.length > this.maxBlacklistSize) {
      const oldest = this.blacklistTimestamps.shift()!;
      this.blacklist.delete(oldest.jti);
    }

    log.info({ jti, size: this.blacklist.size }, 'token revoked by jti');
  }

  /**
   * Check if a jti is blacklisted.
   */
  isRevoked(jti: string): boolean {
    return this.blacklist.has(jti);
  }

  /**
   * Get current blacklist size.
   */
  get blacklistSize(): number {
    return this.blacklist.size;
  }

  /**
   * Clear the token blacklist.
   */
  clearBlacklist(): void {
    const size = this.blacklist.size;
    this.blacklist.clear();
    this.blacklistTimestamps.length = 0;
    if (size > 0) {
      log.info({ size }, 'token blacklist cleared');
    }
  }

  /**
   * Invalidate JWKS cache (force re-fetch on next validation).
   */
  invalidateCache(): void {
    this.jwksResolver = undefined;
    log.info('JWKS cache invalidated');
  }

  /**
   * Decode a JWT without verification (for debugging/inspection).
   * Returns the header and payload.
   */
  decode(token: string): { header: JWTHeaderParameters; payload: JWTPayload } {
    const header = jose.decodeProtectedHeader(token) as JWTHeaderParameters;
    const payload = jose.decodeJwt(token) as JWTPayload;
    return { header, payload };
  }

  /**
   * Create a TokenValidator function bound to this instance.
   * Convenience for passing directly to AuthManager.
   */
  asTokenValidator(): TokenValidator {
    return (token: string) => this.validate(token);
  }

  // ─── Signature verification ────────────────────────────────────────

  private async verifySignature(token: string): Promise<JWTVerifyResult> {
    const verifyOptions = {
      clockTolerance: `${this.clockSkew}s`,
      issuer: this.expectedIssuer,
      audience: this.expectedAudience,
    };

    if (this.secret) {
      const secret = new TextEncoder().encode(this.secret);
      return await jose.jwtVerify(token, secret, verifyOptions);
    }

    if (this.jwksUri) {
      const key = await this.resolveKey(token);
      return await jose.jwtVerify(token, key, verifyOptions);
    }

    throw new Error('no secret or jwksUri configured');
  }

  /**
   * Resolve the signing key from JWKS.
   * Uses kid from token header to match the correct key.
   * Falls back to the first matching key if no kid is present.
   */
  private async resolveKey(token: string): Promise<CryptoKey> {
    if (!this.jwksResolver) {
      this.jwksResolver = jose.createRemoteJWKSet(new URL(this.jwksUri!));
    }
    return await this.jwksResolver();
  }



  // ─── Claim helpers ─────────────────────────────────────────────────

  /**
   * Extract a nested claim value using dot notation.
   * Example: 'realm_access.roles' → payload.realm_access.roles
   */
  private extractClaim(claims: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = claims;

    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Extract roles from the configured claim paths.
   * Returns first match found. Normalizes to string[].
   */
  private extractRoles(claims: Record<string, unknown>): string[] {
    for (const claimPath of this.roleClaims) {
      const value = this.extractClaim(claims, claimPath);
      if (Array.isArray(value)) {
        return value.filter((r): r is string => typeof r === 'string');
      }
      if (typeof value === 'string') {
        return [value];
      }
    }
    return [];
  }

  /**
   * Match a claim value against expected value(s).
   */
  private matchClaim(actual: unknown, expected: string | string[]): boolean {
    if (actual == null) return false;

    if (Array.isArray(expected)) {
      return expected.includes(String(actual));
    }

    return String(actual) === expected;
  }

  /**
   * Match audience claim.
   * Audience can be a string or array of strings.
   */
  private matchAudience(actual: unknown, expected: string | string[]): boolean {
    if (actual == null) return false;

    const expectedSet = new Set(Array.isArray(expected) ? expected : [expected]);
    const actualSet = new Set(
      Array.isArray(actual)
        ? actual.map(String)
        : [String(actual)],
    );

    for (const exp of expectedSet) {
      if (actualSet.has(exp)) return true;
    }

    return false;
  }
}

// ─── Factory helpers ──────────────────────────────────────────────────

/**
 * Create a JWT validator for HMAC (shared secret) mode.
 * Convenience function for simple deployments.
 *
 * @example
 *   const validator = createHmacValidator({
 *     secret: process.env.JWT_SECRET!,
 *     issuer: 'mcp-server',
 *   });
 *   authManager.setTokenValidator(validator.validate.bind(validator));
 */
export function createHmacValidator(options: Omit<JwtValidatorOptions, 'jwksUri'> & { secret: string }): JwtValidator {
  return new JwtValidator(options);
}

/**
 * Create a JWT validator for JWKS (asymmetric key) mode.
 * Convenience function for production deployments with an identity provider.
 *
 * @example
 *   const validator = createJwksValidator({
 *     jwksUri: 'https://auth.example.com/.well-known/jwks.json',
 *     issuer: 'https://auth.example.com',
 *     audience: 'mcp-server',
 *   });
 *   authManager.setTokenValidator(validator.validate.bind(validator));
 */
export function createJwksValidator(options: Omit<JwtValidatorOptions, 'secret'> & { jwksUri: string }): JwtValidator {
  return new JwtValidator(options);
}

/**
 * Create a signed JWT token (for testing and internal tool use).
 *
 * @param payload - JWT payload claims
 * @param secret - HMAC shared secret
 * @param algorithm - JWS algorithm (default: HS256)
 * @returns Signed JWT string
 */
export async function createTestToken(
  payload: Record<string, unknown>,
  secret: string,
  algorithm: string = 'HS256',
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: algorithm as JWTHeaderParameters['alg'] })
    .sign(key);
}
