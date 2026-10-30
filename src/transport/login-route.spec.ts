/**
 * transport/login-route.spec.ts — Tests for POST /auth/login.
 *
 * The handler is exercised through a real HTTP server on an ephemeral port:
 * that covers streaming body reads, headers and status codes the same way the
 * transport does in production, without mocking req/res.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as jose from 'jose';
import { createLoginHandler, LOGIN_TOKEN_TTL_SECONDS, type LoginHandler } from './login-route.js';

const USER = 'admin';
const PASSWORD = 'admin-secret';
const JWT_SECRET = 'unit-test-secret';

const ENV_KEYS = ['MCP_LOGIN_USER', 'MCP_LOGIN_PASSWORD', 'JWT_SECRET'] as const;

let server: Server | undefined;
let baseUrl = '';
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.MCP_LOGIN_USER = USER;
  process.env.MCP_LOGIN_PASSWORD = PASSWORD;
  process.env.JWT_SECRET = JWT_SECRET;
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await stopServer();
});

async function startServer(handler: LoginHandler = createLoginHandler()): Promise<void> {
  server = createServer((req, res) => {
    void handler(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function stopServer(): Promise<void> {
  const current = server;
  server = undefined;
  if (!current) return;
  current.closeAllConnections?.();
  await new Promise<void>((resolve) => current.close(() => resolve()));
}

function postLogin(
  body: string,
  headers: Record<string, string> = { 'content-type': 'application/json' },
): Promise<Response> {
  return fetch(`${baseUrl}/auth/login`, { method: 'POST', headers, body });
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return await res.json() as Record<string, unknown>;
}

describe('POST /auth/login', () => {
  it('returns a signed JWT for valid credentials', async () => {
    await startServer();

    const res = await postLogin(JSON.stringify({ username: USER, password: PASSWORD }));

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await readJson(res);
    expect(body.ok).toBe(true);
    expect(body.expiresIn).toBe(LOGIN_TOKEN_TTL_SECONDS);
    expect(body.user).toEqual({ id: USER, roles: ['admin'] });
    expect(typeof body.token).toBe('string');

    const token = body.token as string;
    const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(JWT_SECRET), {
      algorithms: ['HS256'],
    });
    expect(payload.sub).toBe(USER);
    expect(payload.roles).toEqual(['admin']);
    expect(payload.iat).toBeTypeOf('number');
    expect(payload.exp).toBeTypeOf('number');
    expect((payload.exp as number) - (payload.iat as number)).toBe(LOGIN_TOKEN_TTL_SECONDS);
  });

  it('rejects a wrong password with a generic 401', async () => {
    await startServer();

    const res = await postLogin(JSON.stringify({ username: USER, password: 'nope' }));

    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await readJson(res)).toEqual({
      ok: false,
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' },
    });
  });

  it('rejects a wrong username with the same generic 401', async () => {
    await startServer();

    const res = await postLogin(JSON.stringify({ username: 'root', password: PASSWORD }));

    expect(res.status).toBe(401);
    expect(await readJson(res)).toEqual({
      ok: false,
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' },
    });
  });

  it('fails closed with 503 when login credentials are not configured', async () => {
    delete process.env.MCP_LOGIN_USER;
    delete process.env.MCP_LOGIN_PASSWORD;
    await startServer();

    const res = await postLogin(JSON.stringify({ username: USER, password: PASSWORD }));

    expect(res.status).toBe(503);
    expect(await readJson(res)).toEqual({
      ok: false,
      error: {
        code: 'LOGIN_DISABLED',
        message: 'Login is not configured (set MCP_LOGIN_USER and MCP_LOGIN_PASSWORD)',
      },
    });
  });

  it('fails closed with 503 when the password is empty', async () => {
    process.env.MCP_LOGIN_PASSWORD = '';
    await startServer();

    const res = await postLogin(JSON.stringify({ username: USER, password: PASSWORD }));

    expect(res.status).toBe(503);
    expect(((await readJson(res)).error as { code: string }).code).toBe('LOGIN_DISABLED');
  });

  it('fails closed with 503 when JWT_SECRET is missing', async () => {
    delete process.env.JWT_SECRET;
    await startServer();

    const res = await postLogin(JSON.stringify({ username: USER, password: PASSWORD }));

    expect(res.status).toBe(503);
    const body = await readJson(res);
    expect((body.error as { code: string }).code).toBe('LOGIN_DISABLED');
    expect((body.error as { message: string }).message).toContain('JWT_SECRET');
  });

  it('rate-limits after 10 failed attempts and blocks valid credentials too', async () => {
    await startServer();
    const bad = JSON.stringify({ username: USER, password: 'wrong' });

    for (let attempt = 1; attempt <= 10; attempt++) {
      const res = await postLogin(bad);
      expect(res.status, `attempt ${attempt}`).toBe(401);
    }

    const limited = await postLogin(bad);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('cache-control')).toBe('no-store');
    expect(await readJson(limited)).toEqual({
      ok: false,
      error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' },
    });

    const validWhileLimited = await postLogin(JSON.stringify({ username: USER, password: PASSWORD }));
    expect(validWhileLimited.status).toBe(429);
  });

  it('resets the failure counter after a successful login', async () => {
    await startServer();
    const bad = JSON.stringify({ username: USER, password: 'wrong' });

    for (let attempt = 1; attempt <= 9; attempt++) {
      expect((await postLogin(bad)).status).toBe(401);
    }
    expect((await postLogin(JSON.stringify({ username: USER, password: PASSWORD }))).status).toBe(200);

    for (let attempt = 1; attempt <= 9; attempt++) {
      const res = await postLogin(bad);
      expect(res.status, `attempt ${attempt} after reset`).toBe(401);
    }
  });

  it('rejects a malformed body with 400', async () => {
    await startServer();

    const res = await postLogin('{"username":');

    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'Invalid credentials payload' },
    });
  });

  it('rejects a body without both string fields with 400', async () => {
    await startServer();

    const res = await postLogin(JSON.stringify({ username: USER }));

    expect(res.status).toBe(400);
    expect(((await readJson(res)).error as { code: string }).code).toBe('BAD_REQUEST');
  });

  it('answers 405 for non-POST methods', async () => {
    await startServer();

    const res = await fetch(`${baseUrl}/auth/login`, { method: 'GET' });

    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
