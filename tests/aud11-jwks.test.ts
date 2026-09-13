/**
 * AUD-11: JWKS kid-selection and cacheMaxAge wiring.
 *
 * Regression: resolveKey() called jwksResolver() without (protectedHeader, token),
 * so jose could not select the correct key by kid — multi-key JWKS (key rotation)
 * failed validation. jwksCacheTtl option was dead code.
 *
 * Fix: pass the createRemoteJWKSet resolver function directly to jwtVerify so
 * jose performs kid-selection internally; wire cacheMaxAge from jwksCacheTtl.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as jose from 'jose';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { JwtValidator } from '../src/core/jwt-validator.js';

// ─── JWKS test server ────────────────────────────────────────────────

let server: Server;
let jwksUri: string;
let publicJwks: jose.JSONWebKeySet;
let fetchCount = 0;

// Two RSA key pairs — simulates key rotation (old + new key in the set)
let key1: { privateKey: CryptoKey; publicJwk: jose.JWK };
let key2: { privateKey: CryptoKey; publicJwk: jose.JWK };

beforeAll(async () => {
  const pair1 = await jose.generateKeyPair('RS256', { extractable: true });
  const pair2 = await jose.generateKeyPair('RS256', { extractable: true });

  const jwk1 = await jose.exportJWK(pair1.publicKey);
  const jwk2 = await jose.exportJWK(pair2.publicKey);
  jwk1.kid = 'key-1';
  jwk1.alg = 'RS256';
  jwk1.use = 'sig';
  jwk2.kid = 'key-2';
  jwk2.alg = 'RS256';
  jwk2.use = 'sig';

  key1 = { privateKey: pair1.privateKey, publicJwk: jwk1 };
  key2 = { privateKey: pair2.privateKey, publicJwk: jwk2 };
  publicJwks = { keys: [jwk1, jwk2] };

  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    fetchCount++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(publicJwks));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = (server.address() as AddressInfo).port;
  jwksUri = `http://127.0.0.1:${port}/jwks`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────

async function signToken(
  privateKey: CryptoKey,
  kid: string,
  claims: Record<string, unknown> = {},
): Promise<string> {
  return await new jose.SignJWT({ sub: 'user-1', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('AUD-11: JWKS kid selection', () => {
  it('validates a token signed by the SECOND key in a multi-key JWKS', async () => {
    const validator = new JwtValidator({ jwksUri });
    // Token signed with key2 — before the fix, resolver() was called with no
    // header so jose could not pick key-2 by kid.
    const token = await signToken(key2.privateKey, 'key-2');
    const result = await validator.validate(token);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe('user-1');
  });

  it('validates a token signed by the FIRST key in a multi-key JWKS', async () => {
    const validator = new JwtValidator({ jwksUri });
    const token = await signToken(key1.privateKey, 'key-1');
    const result = await validator.validate(token);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe('user-1');
  });

  it('validates tokens signed by DIFFERENT keys against the same validator (rotation)', async () => {
    const validator = new JwtValidator({ jwksUri });
    const t1 = await signToken(key1.privateKey, 'key-1', { sub: 'user-a' });
    const t2 = await signToken(key2.privateKey, 'key-2', { sub: 'user-b' });
    const r1 = await validator.validate(t1);
    const r2 = await validator.validate(t2);
    expect(r1?.userId).toBe('user-a');
    expect(r2?.userId).toBe('user-b');
  });

  it('rejects a token whose kid does not match any key in the JWKS', async () => {
    const validator = new JwtValidator({ jwksUri });
    // Sign with key1 but claim a kid that is not in the set
    const token = await signToken(key1.privateKey, 'kid-not-in-jwks');
    const result = await validator.validate(token);
    expect(result).toBeNull();
  });

  it('rejects a token signed by a key NOT in the JWKS (forged kid)', async () => {
    const validator = new JwtValidator({ jwksUri });
    // Attacker generates their own key pair and sets kid=key-1
    const attacker = await jose.generateKeyPair('RS256', { extractable: true });
    const token = await new jose.SignJWT({ sub: 'attacker' })
      .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(attacker.privateKey);
    const result = await validator.validate(token);
    expect(result).toBeNull();
  });
});

describe('AUD-11: jwksCacheTtl wiring', () => {
  it('passes jwksCacheTtl to createRemoteJWKSet as cacheMaxAge', async () => {
    // A very short cacheMaxAge forces a refetch on the second validation
    // after the TTL expires — proving the option reaches jose.
    const validator = new JwtValidator({ jwksUri, jwksCacheTtl: 1 }); // 1 ms
    const token = await signToken(key1.privateKey, 'key-1');

    fetchCount = 0;
    const r1 = await validator.validate(token);
    expect(r1).not.toBeNull();
    const fetchesAfterFirst = fetchCount;
    expect(fetchesAfterFirst).toBeGreaterThanOrEqual(1);

    // Wait for the 1ms cache to expire, then validate again — jose must refetch.
    await new Promise((r) => setTimeout(r, 20));
    const r2 = await validator.validate(token);
    expect(r2).not.toBeNull();
    expect(fetchCount).toBeGreaterThan(fetchesAfterFirst);
  });

  it('reuses the cached JWKS within cacheMaxAge (no refetch)', async () => {
    const validator = new JwtValidator({ jwksUri, jwksCacheTtl: 60_000 }); // 1 min
    const token = await signToken(key1.privateKey, 'key-1');

    fetchCount = 0;
    await validator.validate(token);
    const afterFirst = fetchCount;
    await validator.validate(token);
    await validator.validate(token);
    // Within TTL — no additional fetches beyond the first
    expect(fetchCount).toBe(afterFirst);
  });

  it('invalidateCache() forces a fresh resolver (refetch on next validate)', async () => {
    const validator = new JwtValidator({ jwksUri, jwksCacheTtl: 60_000 });
    const token = await signToken(key1.privateKey, 'key-1');

    fetchCount = 0;
    await validator.validate(token);
    const afterFirst = fetchCount;

    validator.invalidateCache();
    await validator.validate(token);
    expect(fetchCount).toBeGreaterThan(afterFirst);
  });
});
