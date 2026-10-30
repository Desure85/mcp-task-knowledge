/**
 * tests/e2e-full/aud-high-security.test.ts — live-server probes for the
 * "high" findings that previously had unit tests only:
 *
 *   AUD-04  session_list is admin-only (non-admin token denied)
 *   AUD-05  token expiry really ends access (same session id rejected after exp)
 *   AUD-06  /ws rejects missing/invalid token, accepts a valid one
 *   AUD-07  SECURITY_STACK=1 → tool calls land in the audit log
 */

import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import WebSocket from 'ws';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-e2e-full-audhigh');
const JWT_SECRET = 'aud-high-e2e-secret-32bytes-min!!!';

function mintJwt(opts: { sub?: string; roles?: string[]; ttlSec?: number } = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: opts.sub ?? 'u1',
    roles: opts.roles ?? ['user'],
    iat: now,
    exp: now + (opts.ttlSec ?? 3600),
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

let portCounter = 4700;
const children: ChildProcess[] = [];

async function waitReady(child: ChildProcess, port: number): Promise<void> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('server exited early');
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/healthz', timeout: 500 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server not ready');
}

async function startServer(name: string, extraEnv: Record<string, string> = {}) {
  const dir = path.join(TMP, name);
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(path.join(dir, 'store'), { recursive: true });
  const port = ++portCounter;
  const child = spawn('node', ['dist/index.js'], {
    env: {
      ...process.env,
      DATA_DIR: path.join(dir, 'store'),
      OBSIDIAN_VAULT_ROOT: path.join(dir, 'vault'),
      EMBEDDINGS_MODE: 'none',
      CATALOG_ENABLED: 'false',
      MCP_TRANSPORT: 'http',
      MCP_PORT: String(port),
      MCP_HOST: '127.0.0.1',
      JWT_SECRET,
      ...extraEnv,
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  children.push(child);
  await waitReady(child, port);
  return { port, dir };
}

afterAll(async () => {
  for (const c of children) c.kill('SIGKILL');
  await fsp.rm(TMP, { recursive: true, force: true });
});

/** Minimal JSON-RPC over Streamable HTTP with explicit session control. */
async function rpc(port: number, body: unknown, sessionId?: string) {
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
  const json = (() => {
    try { return JSON.parse(dataLine ? dataLine.slice(5) : text); } catch { return undefined; }
  })();
  return { status: res.status, sid: res.headers.get('mcp-session-id') ?? sessionId, json };
}

async function openSession(port: number, token: string) {
  const init = await rpc(port, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'probe', version: '0' } },
  });
  expect(init.status).toBe(200);
  const sid = init.sid!;
  await rpc(port, { jsonrpc: '2.0', method: 'notifications/initialized' }, sid);
  const auth = await call(port, sid, 'mcp.authenticate', { token });
  expect(auth.ok, JSON.stringify(auth)).toBe(true);
  return sid;
}

async function call(port: number, sid: string, name: string, args: Record<string, unknown> = {}) {
  const r = await rpc(port, { jsonrpc: '2.0', id: Math.floor(Math.random() * 1e6), method: 'tools/call', params: { name, arguments: args } }, sid);
  const text = r.json?.result?.content?.[0]?.text;
  const parsed = text ? JSON.parse(text) : undefined;
  return { status: r.status, ok: parsed?.ok as boolean | undefined, error: parsed?.error, raw: r.json };
}

function wsOutcome(port: number, token: string | null): Promise<{ closeCode?: number; opened: boolean }> {
  return new Promise((resolve) => {
    const url = `ws://127.0.0.1:${port}/ws${token === null ? '' : `?token=${encodeURIComponent(token)}`}`;
    const ws = new WebSocket(url);
    let opened = false;
    const timer = setTimeout(() => { ws.terminate(); resolve({ opened }); }, 4000);
    ws.on('message', () => { opened = true; clearTimeout(timer); ws.close(); resolve({ opened: true }); });
    ws.on('close', (code) => { clearTimeout(timer); resolve({ closeCode: code, opened }); });
    ws.on('unexpected-response', (_req, res) => { clearTimeout(timer); resolve({ closeCode: res.statusCode, opened: false }); });
    ws.on('error', () => { /* handled by close/unexpected-response */ });
  });
}

describe('AUD high-severity live probes', () => {
  it('AUD-06: /ws rejects no/invalid token and accepts a valid one', async () => {
    const { port } = await startServer('ws');
    const none = await wsOutcome(port, null);
    expect(none.opened, `no token: ${JSON.stringify(none)}`).toBe(false);
    const bad = await wsOutcome(port, 'garbage');
    expect(bad.opened, `bad token: ${JSON.stringify(bad)}`).toBe(false);
    const good = await wsOutcome(port, mintJwt({ roles: ['admin'] }));
    expect(good.opened, `valid token: ${JSON.stringify(good)}`).toBe(true);
  }, 60000);

  it('AUD-04: session_list is denied for a non-admin and allowed for admin', async () => {
    const { port } = await startServer('roles');
    const userSid = await openSession(port, mintJwt({ sub: 'plain', roles: ['user'] }));
    const adminSid = await openSession(port, mintJwt({ sub: 'root', roles: ['admin'] }));
    const denied = await call(port, userSid, 'session_list');
    expect(denied.ok).toBe(false);
    expect(String(denied.error?.message ?? denied.error)).toMatch(/admin/i);
    const allowed = await call(port, adminSid, 'session_list');
    expect(allowed.ok).toBe(true);
  }, 60000);

  it('AUD-05: after the token expires the same session id no longer works', async () => {
    const { port } = await startServer('expiry', { MCP_PRUNE_INTERVAL_MS: '300' });
    const sid = await openSession(port, mintJwt({ ttlSec: 3 }));
    const before = await call(port, sid, 'tasks_list', {});
    expect(before.status).toBe(200);
    expect(before.ok).not.toBe(undefined);
    await new Promise((r) => setTimeout(r, 5000));
    const after = await rpc(port, { jsonrpc: '2.0', id: 99, method: 'tools/list' }, sid);
    expect([401, 403, 404], `status after expiry: ${after.status} ${JSON.stringify(after.json)}`).toContain(after.status);
  }, 60000);

  it('AUD-07: SECURITY_STACK=1 writes tool calls to the audit log', async () => {
    const { port, dir } = await startServer('audit', { SECURITY_STACK: '1' });
    const sid = await openSession(port, mintJwt({ roles: ['admin'] }));
    await call(port, sid, 'tasks_list', {});
    await new Promise((r) => setTimeout(r, 500));
    const logPath = path.join(dir, 'store', 'audit.log');
    const content = await fsp.readFile(logPath, 'utf-8').catch(() => '');
    expect(content, 'audit.log must exist and mention the call').toMatch(/tasks_list/);
  }, 60000);
});
