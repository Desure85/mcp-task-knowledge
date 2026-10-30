/**
 * transport/login-route.ts — Username/password login endpoint.
 *
 * Serves `POST /auth/login` for the browser UI: accepts a JSON credentials
 * payload and returns a signed HS256 JWT. Deliberately independent of the MCP
 * session lifecycle and of AuthManager's existing token gate — this endpoint
 * only issues tokens, it never grants anonymous access to MCP methods.
 *
 * Configuration is read from process.env on every request (lazy), so a
 * restarted process picks up new values and tests can vary the environment:
 *   - MCP_LOGIN_USER / MCP_LOGIN_PASSWORD — required; either missing or empty
 *     disables the endpoint (503, fail-closed, never a default password).
 *   - JWT_SECRET — required to sign tokens; missing → 503.
 *
 * Brute-force protection: AuthProtection (core/auth-protection.ts) keyed by
 * the client IP — max 10 failed attempts per 5 minutes, then 429 until the
 * lockout window passes. A successful login resets the counter.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import * as jose from 'jose';
import { AuthProtection } from '../core/auth-protection.js';
import { childLogger } from '../core/logger.js';

const log = childLogger('transport:login');

export const LOGIN_PATH = '/auth/login';

/** Token lifetime: 30 days, mirrored in the `expiresIn` response field. */
export const LOGIN_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_LOGGED_USER_LENGTH = 128;
const LOGIN_ROLES = ['admin'];

const textEncoder = new TextEncoder();

export type LoginHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export interface LoginRouteOptions {
  /** Failed attempts allowed per window. Default: 10. */
  maxAttempts?: number;
  /** Failure window / lockout duration in ms. Default: 5 minutes. */
  windowMs?: number;
}

/** True for `/auth/login` (with optional trailing slash or query string). */
export function isLoginPath(url: string): boolean {
  const path = url.split('?')[0];
  return path === LOGIN_PATH || path === `${LOGIN_PATH}/`;
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(json);
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { ok: false, error: { code, message } });
}

/** Hash to a fixed-length digest so timingSafeEqual never throws on length. */
function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Constant-time comparison over equal-length SHA-256 digests. */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown';
}

/**
 * Read and parse a JSON body with a hard cap. Returns `undefined` for an
 * empty body and throws on invalid JSON / oversized payloads.
 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    received += (chunk as Buffer).length;
    if (received > MAX_BODY_BYTES) {
      throw new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`);
    }
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return undefined;
  return JSON.parse(raw);
}

interface LoginConfig {
  username: string;
  password: string;
  jwtSecret: string;
}

/**
 * Resolve credentials lazily. Returns a config, or the error body to send
 * when the endpoint is not configured (fail-closed).
 */
function readConfig(): { config: LoginConfig } | { error: { message: string } } {
  const username = (process.env.MCP_LOGIN_USER ?? '').trim();
  const password = process.env.MCP_LOGIN_PASSWORD ?? '';
  if (!username || !password) {
    return {
      error: { message: 'Login is not configured (set MCP_LOGIN_USER and MCP_LOGIN_PASSWORD)' },
    };
  }
  const jwtSecret = process.env.JWT_SECRET ?? '';
  if (!jwtSecret) {
    return {
      error: { message: 'Login is not configured (set JWT_SECRET)' },
    };
  }
  return { config: { username, password, jwtSecret } };
}

async function issueToken(config: LoginConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new jose.SignJWT({ roles: [...LOGIN_ROLES] })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(config.username)
    .setIssuedAt(now)
    .setExpirationTime(now + LOGIN_TOKEN_TTL_SECONDS)
    .sign(textEncoder.encode(config.jwtSecret));
}

/**
 * Create a login handler with its own brute-force limiter state.
 * One instance per HTTP server (see http-transport.ts); tests create a fresh
 * handler per case so limiter state never leaks between them.
 */
export function createLoginHandler(options: LoginRouteOptions = {}): LoginHandler {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;

  const protection = new AuthProtection({
    maxAttempts,
    windowMs,
    baseLockoutMs: windowMs,
    maxLockoutMs: windowMs,
    backoffMultiplier: 1,
    maxLockoutCount: 0,
  });

  return async (req, res) => {
    const ip = clientIp(req);

    if (req.method !== 'POST') {
      sendJson(
        res,
        405,
        { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } },
        { Allow: 'POST' },
      );
      return;
    }

    const resolved = readConfig();
    if ('error' in resolved) {
      log.warn({ ip, reason: 'login_disabled' }, 'login rejected');
      sendError(res, 503, 'LOGIN_DISABLED', resolved.error.message);
      return;
    }
    const { config } = resolved;

    const verdict = protection.check(ip);
    if (!verdict.allowed) {
      log.warn({ ip, reason: 'rate_limited' }, 'login rejected');
      sendError(res, 429, 'RATE_LIMITED', 'Too many attempts, try again later');
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendError(res, 400, 'BAD_REQUEST', 'Invalid credentials payload');
      return;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendError(res, 400, 'BAD_REQUEST', 'Invalid credentials payload');
      return;
    }

    const supplied = body as Record<string, unknown>;
    const suppliedUser = supplied.username;
    const suppliedPassword = supplied.password;
    if (
      typeof suppliedUser !== 'string'
      || typeof suppliedPassword !== 'string'
      || suppliedUser.length === 0
      || suppliedPassword.length === 0
    ) {
      sendError(res, 400, 'BAD_REQUEST', 'Invalid credentials payload');
      return;
    }

    // Compare both fields (no short-circuit) so timing does not reveal
    // which one was wrong; the response is a single generic message.
    const userMatches = safeEqual(suppliedUser, config.username);
    const passwordMatches = safeEqual(suppliedPassword, config.password);

    if (!userMatches || !passwordMatches) {
      protection.recordFailure(ip);
      log.warn(
        { userId: suppliedUser.slice(0, MAX_LOGGED_USER_LENGTH), ip, reason: 'invalid_credentials' },
        'login failed',
      );
      sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid username or password');
      return;
    }

    protection.recordSuccess(ip);

    let token: string;
    try {
      token = await issueToken(config);
    } catch (err) {
      log.error({ err, ip }, 'failed to sign login token');
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to issue token');
      return;
    }

    log.info({ userId: config.username, ip }, 'login succeeded');
    sendJson(res, 200, {
      ok: true,
      token,
      expiresIn: LOGIN_TOKEN_TTL_SECONDS,
      user: { id: config.username, roles: [...LOGIN_ROLES] },
    });
  };
}
