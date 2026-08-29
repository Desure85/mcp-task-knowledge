/**
 * core/oauth.ts — Minimal OAuth 2.1 PKCE provider for HTTP transport (AI-014)
 *
 * Implements the Authorization Code flow with PKCE (RFC 7636):
 *   1. Client requests authorization code (GET /oauth/authorize)
 *   2. Server issues code bound to code_challenge
 *   3. Client exchanges code for access token (POST /oauth/token)
 *   4. Server verifies code_verifier against stored challenge
 *
 * This is a minimal provider — no refresh tokens, no introspection endpoint.
 * Designed for single-instance deployments; for multi-instance, use an external
 * IdP (Auth0, Keycloak) and configure JWT validation via A-002.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface OAuthConfig {
  /** Token TTL in seconds (default: 3600). */
  tokenTtlSec?: number;
  /** Issuer URL (e.g., http://localhost:3001). */
  issuer: string;
  /** Shared secret for signing tokens (reuse JWT_SECRET). */
  secret: string;
}

interface AuthCodeEntry {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  scope: string;
  expiresAt: number;
}

interface TokenEntry {
  accessToken: string;
  clientId: string;
  scope: string;
  expiresAt: number;
}

const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class OAuthProvider {
  private readonly tokenTtlSec: number;
  private readonly issuer: string;
  private readonly secret: string;
  private readonly authCodes = new Map<string, AuthCodeEntry>();
  private readonly tokens = new Map<string, TokenEntry>();

  constructor(config: OAuthConfig) {
    this.tokenTtlSec = config.tokenTtlSec ?? 3600;
    this.issuer = config.issuer;
    this.secret = config.secret;
  }

  /** Generate an authorization code (step 1). */
  issueAuthCode(params: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: 'S256';
    scope?: string;
  }): string {
    const code = randomBytes(32).toString('base64url');
    this.authCodes.set(code, {
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod,
      scope: params.scope ?? '',
      expiresAt: Date.now() + CODE_TTL_MS,
    });
    return code;
  }

  /** Exchange code for access token (step 2). Throws on invalid code/verifier. */
  exchangeCode(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
  }): { accessToken: string; tokenType: 'Bearer'; expiresIn: number; scope: string } {
    const entry = this.authCodes.get(params.code);
    if (!entry) throw new Error('invalid_grant: code not found');
    if (Date.now() > entry.expiresAt) {
      this.authCodes.delete(params.code);
      throw new Error('invalid_grant: code expired');
    }
    if (entry.clientId !== params.clientId) throw new Error('invalid_grant: client mismatch');
    if (entry.redirectUri !== params.redirectUri) throw new Error('invalid_grant: redirect_uri mismatch');

    // Verify PKCE: S256 = base64url(sha256(code_verifier))
    const computed = createHash('sha256').update(params.codeVerifier).digest('base64url');
    if (!this.safeEqual(computed, entry.codeChallenge)) {
      throw new Error('invalid_grant: PKCE verification failed');
    }

    this.authCodes.delete(params.code);

    const accessToken = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + this.tokenTtlSec * 1000;
    this.tokens.set(accessToken, {
      accessToken,
      clientId: params.clientId,
      scope: entry.scope,
      expiresAt,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.tokenTtlSec,
      scope: entry.scope,
    };
  }

  /** Validate an access token. Returns scope or throws. */
  validateToken(accessToken: string): { clientId: string; scope: string } {
    const entry = this.tokens.get(accessToken);
    if (!entry) throw new Error('invalid_token: not found');
    if (Date.now() > entry.expiresAt) {
      this.tokens.delete(accessToken);
      throw new Error('invalid_token: expired');
    }
    return { clientId: entry.clientId, scope: entry.scope };
  }

  /** Revoke a token. */
  revokeToken(accessToken: string): boolean {
    return this.tokens.delete(accessToken);
  }

  /** Number of active tokens (for diagnostics). */
  get activeTokenCount(): number {
    return this.tokens.size;
  }

  /** Number of pending auth codes. */
  get pendingCodeCount(): number {
    return this.authCodes.size;
  }

  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
