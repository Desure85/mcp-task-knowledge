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
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
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
   * When exceeded, expired entries are purged first, then entries with the
   * earliest token `exp` are evicted (soonest-to-expire first — a revoked
   * token stops mattering once it would fail the exp check anyway).
   */
  maxBlacklistSize?: number;

  /**
   * AUD-16: path to persist the revocation blacklist (JSON file).
   * When set, revocations survive process restarts; the file is loaded
   * lazily on construction and rewritten on each mutation.
   * Example: path.join(DATA_DIR, '.jwt-revoked.json')
   */
  blacklistPath?: string;
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
  private readonly blacklistPath?: string;

  // State
  private jwksResolver?: ReturnType<typeof jose.createRemoteJWKSet>;
  /**
   * AUD-16: jti → token exp (epoch seconds). `0` = unknown exp (entry kept
   * until capacity eviction). Expired entries are purged lazily on mutation
   * and on validate() — a revoked token whose exp already passed would be
   * rejected by the exp check anyway, so keeping it only wastes capacity.
   */
  private readonly blacklist = new Map<string, number>();

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
    this.blacklistPath = options.blacklistPath;
    if (this.blacklistPath) {
      this.loadBlacklist();
    }
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
   *
   * @param jti - the token's jti claim
   * @param exp - the token's exp claim (epoch seconds), if known. Enables
   *   exp-based eviction: expired revocations are dead weight and are purged
   *   first when the blacklist reaches capacity. Unknown → entry is kept
   *   until capacity eviction.
   */
  revokeByJti(jti: string, exp?: number): void {
    if (this.blacklist.has(jti)) return;

    this.blacklist.set(jti, typeof exp === 'number' && Number.isFinite(exp) ? exp : 0);
    this.evictBlacklistIfNeeded();
    this.persistBlacklist();

    log.info({ jti, size: this.blacklist.size }, 'token revoked by jti');
  }

  /**
   * Revoke a raw JWT — decodes jti and exp from the token itself.
   * Preferred over revokeByJti when the caller has the token: the exp claim
   * lets the blacklist drop the entry once the token would be rejected by
   * the expiry check anyway. No-op if the token has no jti.
   */
  revokeToken(token: string): void {
    try {
      const payload = jose.decodeJwt(token);
      if (payload.jti) {
        this.revokeByJti(payload.jti, payload.exp);
      }
    } catch (err) {
      log.warn({ err }, 'revokeToken: failed to decode token');
    }
  }

  /**
   * Check if a jti is blacklisted.
   */
  isRevoked(jti: string): boolean {
    const exp = this.blacklist.get(jti);
    if (exp === undefined) return false;
    // A revocation for an already-expired token is meaningless — treat as
    // not revoked and drop the entry.
    if (exp > 0 && exp * 1000 <= Date.now()) {
      this.blacklist.delete(jti);
      return false;
    }
    return true;
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
    this.persistBlacklist();
    if (size > 0) {
      log.info({ size }, 'token blacklist cleared');
    }
  }

  // ─── Blacklist internals (AUD-16) ──────────────────────────────────

  /**
   * Eviction policy: purge expired entries first (their tokens fail the exp
   * check regardless), then — if still over capacity — evict entries with
   * the earliest exp (soonest to become irrelevant). Entries with unknown
   * exp (0) sort last so they outlive known-exp entries.
   */
  private evictBlacklistIfNeeded(): void {
    const nowSec = Date.now() / 1000;
    for (const [jti, exp] of this.blacklist) {
      if (exp > 0 && exp <= nowSec) this.blacklist.delete(jti);
    }
    if (this.blacklist.size <= this.maxBlacklistSize) return;

    const byExp = [...this.blacklist.entries()].sort((a, b) => {
      const ea = a[1] === 0 ? Number.POSITIVE_INFINITY : a[1];
      const eb = b[1] === 0 ? Number.POSITIVE_INFINITY : b[1];
      return ea - eb;
    });
    const excess = this.blacklist.size - this.maxBlacklistSize;
    for (let i = 0; i < excess; i++) {
      this.blacklist.delete(byExp[i][0]);
    }
  }

  /** Load persisted revocations from blacklistPath (best-effort). */
  private loadBlacklist(): void {
    try {
      const raw = readFileSync(this.blacklistPath!, 'utf8');
      const data = JSON.parse(raw) as { revoked?: Record<string, number> };
      const nowSec = Date.now() / 1000;
      let loaded = 0;
      for (const [jti, exp] of Object.entries(data.revoked ?? {})) {
        if (typeof jti !== 'string' || typeof exp !== 'number') continue;
        if (exp > 0 && exp <= nowSec) continue; // already-expired revocation
        this.blacklist.set(jti, exp);
        loaded++;
      }
      if (loaded > 0) {
        log.info({ loaded, path: this.blacklistPath }, 'token blacklist loaded from disk');
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn({ err, path: this.blacklistPath }, 'failed to load token blacklist — starting empty');
      }
    }
  }

  /** Persist revocations to blacklistPath (atomic tmp+rename, best-effort). */
  private persistBlacklist(): void {
    if (!this.blacklistPath) return;
    try {
      mkdirSync(dirname(this.blacklistPath), { recursive: true });
      const revoked: Record<string, number> = {};
      for (const [jti, exp] of this.blacklist) revoked[jti] = exp;
      const tmp = `${this.blacklistPath}.tmp`;
      writeFileSync(tmp, JSON.stringify({ revoked }), 'utf8');
      renameSync(tmp, this.blacklistPath);
    } catch (err) {
      log.warn({ err, path: this.blacklistPath }, 'failed to persist token blacklist');
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
      const jwks = this.getJwksResolver();
      // Pass the resolver function itself — jose calls it with
      // (protectedHeader, token) and performs kid-based key selection
      // internally, including refetch on unknown kid (key rotation).
      return await jose.jwtVerify(token, jwks, verifyOptions);
    }

    throw new Error('no secret or jwksUri configured');
  }

  /**
   * Get (or lazily create) the remote JWKS resolver.
   *
   * The returned function has signature `(protectedHeader, token) => KeyLike`
   * and is passed directly to `jose.jwtVerify`, which invokes it with the
   * token's protected header so the correct key is selected by `kid`.
   * `cacheMaxAge` is wired from the `jwksCacheTtl` option.
   */
  private getJwksResolver(): ReturnType<typeof jose.createRemoteJWKSet> {
    if (!this.jwksResolver) {
      this.jwksResolver = jose.createRemoteJWKSet(new URL(this.jwksUri!), {
        cacheMaxAge: this.jwksCacheTtl,
      });
    }
    return this.jwksResolver;
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
