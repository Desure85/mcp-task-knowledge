/**
 * core/oauth.spec.ts — Tests for OAuth 2.1 PKCE provider (AI-014)
 */

import { describe, it, expect } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { OAuthProvider } from './oauth.js';

function makePkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

describe('AI-014: OAuth 2.1 PKCE provider', () => {
  const provider = new OAuthProvider({
    issuer: 'http://localhost:3001',
    secret: 'test-secret',
    tokenTtlSec: 60,
  });

  it('issues an authorization code', () => {
    const { challenge } = makePkcePair();
    const code = provider.issueAuthCode({
      clientId: 'test-client',
      redirectUri: 'http://localhost:3000/callback',
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      scope: 'tasks:read',
    });
    expect(code).toBeTruthy();
    expect(code.length).toBeGreaterThan(20);
    expect(provider.pendingCodeCount).toBe(1);
  });

  it('exchanges code for access token with valid PKCE', () => {
    const { verifier, challenge } = makePkcePair();
    const code = provider.issueAuthCode({
      clientId: 'test-client',
      redirectUri: 'http://localhost:3000/callback',
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      scope: 'tasks:read tasks:write',
    });
    const token = provider.exchangeCode({
      code,
      codeVerifier: verifier,
      redirectUri: 'http://localhost:3000/callback',
      clientId: 'test-client',
    });
    expect(token.accessToken).toBeTruthy();
    expect(token.tokenType).toBe('Bearer');
    expect(token.expiresIn).toBe(60);
    expect(token.scope).toBe('tasks:read tasks:write');
  });

  it('rejects exchange with wrong PKCE verifier', () => {
    const { challenge } = makePkcePair();
    const code = provider.issueAuthCode({
      clientId: 'test-client',
      redirectUri: 'http://localhost:3000/callback',
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
    });
    expect(() =>
      provider.exchangeCode({
        code,
        codeVerifier: 'wrong-verifier',
        redirectUri: 'http://localhost:3000/callback',
        clientId: 'test-client',
      }),
    ).toThrow('PKCE verification failed');
  });

  it('rejects exchange with wrong client_id', () => {
    const { verifier, challenge } = makePkcePair();
    const code = provider.issueAuthCode({
      clientId: 'test-client',
      redirectUri: 'http://localhost:3000/callback',
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
    });
    expect(() =>
      provider.exchangeCode({
        code,
        codeVerifier: verifier,
        redirectUri: 'http://localhost:3000/callback',
        clientId: 'wrong-client',
      }),
    ).toThrow('client mismatch');
  });

  it('rejects reuse of authorization code', () => {
    const { verifier, challenge } = makePkcePair();
    const code = provider.issueAuthCode({
      clientId: 'test-client',
      redirectUri: 'http://localhost:3000/callback',
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
    });
    provider.exchangeCode({
      code,
      codeVerifier: verifier,
      redirectUri: 'http://localhost:3000/callback',
      clientId: 'test-client',
    });
    expect(() =>
      provider.exchangeCode({
        code,
        codeVerifier: verifier,
        redirectUri: 'http://localhost:3000/callback',
        clientId: 'test-client',
      }),
    ).toThrow('code not found');
  });

  it('validates issued access token', () => {
    const { verifier, challenge } = makePkcePair();
    const code = provider.issueAuthCode({
      clientId: 'validate-client',
      redirectUri: 'http://localhost:3000/callback',
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      scope: 'read',
    });
    const token = provider.exchangeCode({
      code,
      codeVerifier: verifier,
      redirectUri: 'http://localhost:3000/callback',
      clientId: 'validate-client',
    });
    const result = provider.validateToken(token.accessToken);
    expect(result.clientId).toBe('validate-client');
    expect(result.scope).toBe('read');
  });

  it('rejects invalid access token', () => {
    expect(() => provider.validateToken('nonexistent-token')).toThrow('not found');
  });

  it('revokes a token', () => {
    const { verifier, challenge } = makePkcePair();
    const code = provider.issueAuthCode({
      clientId: 'revoke-client',
      redirectUri: 'http://localhost:3000/callback',
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
    });
    const token = provider.exchangeCode({
      code,
      codeVerifier: verifier,
      redirectUri: 'http://localhost:3000/callback',
      clientId: 'revoke-client',
    });
    expect(provider.revokeToken(token.accessToken)).toBe(true);
    expect(() => provider.validateToken(token.accessToken)).toThrow('not found');
  });
});
