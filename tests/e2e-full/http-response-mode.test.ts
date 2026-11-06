/**
 * tests/e2e-full/http-response-mode.test.ts — SC-01: JSON responses vs SSE.
 *
 * Ответ по умолчанию — `application/json` (линейное обрамление вместо квадратичного SSE).
 * Но если клиент прислал `params._meta.progressToken`, ему нужны progress-уведомления,
 * а они доставляются только по открытому SSE-стриму — такой запрос обязан получить
 * `text/event-stream`. `MCP_JSON_RESPONSES=0` возвращает SSE для всех запросов.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import http from 'node:http';
import crypto from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { requestWantsProgress } from '../../src/transport/http-transport.js';
import { assertDistFresh } from '../support/dist-guard.js';
import { getFreePort, spawnTrackedServer, terminateServer } from '../support/server-process.js';

assertDistFresh();

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-e2e-full-http-mode');
const STORE = path.join(TMP, 'store');
const JWT_SECRET = 'sc01-response-mode-secret-32bytes!!';

function mintJwt(sub = 'sc01-user'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub,
      roles: ['admin'],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

function post(
  port: number,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Content-Length': Buffer.byteLength(payload),
          ...headers,
        },
        timeout: 10_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        const isSse = String(res.headers['content-type'] ?? '').includes('text/event-stream');
        const finish = () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') });
          res.destroy();
        };
        res.on('data', (c) => {
          chunks.push(c);
          // An SSE response is a keep-alive stream: it is not closed after the
          // JSON-RPC reply, so resolve as soon as the first event is complete.
          if (isSse && Buffer.concat(chunks).toString('utf8').includes('\n\n')) finish();
        });
        res.on('end', finish);
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('post timeout')));
    req.end(payload);
  });
}

/** JSON or SSE body → the tool envelope inside `result.content[0].text`. */
function toolEnvelope(body: string): { ok?: boolean } {
  const raw = body.includes('data:')
    ? (body.split('\n').find((line) => line.startsWith('data:')) ?? '').slice(5).trim()
    : body;
  const rpc = JSON.parse(raw) as { result: { content: Array<{ text: string }> } };
  return JSON.parse(rpc.result.content[0].text) as { ok?: boolean };
}

async function waitForReady(child: ChildProcess, port: number, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const ok = await new Promise<boolean>((resolve) => {
        const req = http.get({ host: '127.0.0.1', port, path: '/healthz', timeout: 500 }, (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
      });
      if (ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function startServer(extraEnv: Record<string, string> = {}) {
  await rmrf(TMP);
  await fsp.mkdir(STORE, { recursive: true });
  const port = await getFreePort();
  const child: ChildProcess = spawnTrackedServer(['dist/index.js'], {
    env: {
      ...process.env,
      DATA_DIR: STORE,
      OBSIDIAN_VAULT_ROOT: path.join(TMP, 'vault'),
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
  if (!(await waitForReady(child, port))) {
    await terminateServer(child);
    throw new Error('server did not become ready');
  }
  return { child, port };
}

/** initialize → initialized → mcp.authenticate, returning the session headers. */
async function openSession(port: number): Promise<Record<string, string>> {
  const init = await post(port, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mode-probe', version: '0' } },
  });
  const sessionId = String(init.headers['mcp-session-id'] ?? '');
  expect(sessionId).not.toBe('');
  const headers = { 'mcp-session-id': sessionId };

  await post(port, { jsonrpc: '2.0', method: 'notifications/initialized' }, headers);
  const auth = await post(
    port,
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'mcp.authenticate', arguments: { token: mintJwt() } } },
    headers,
  );
  expect(toolEnvelope(auth.text).ok).toBe(true);
  return headers;
}

function listCall(id: number, progressToken?: string) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: {
      name: 'project_list',
      arguments: {},
      ...(progressToken ? { _meta: { progressToken } } : {}),
    },
  };
}

describe('requestWantsProgress', () => {
  it('detects a progressToken on a single or batched message', () => {
    expect(requestWantsProgress({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} })).toBe(false);
    expect(requestWantsProgress({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { _meta: { progressToken: 'p' } } })).toBe(true);
    expect(
      requestWantsProgress([
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { _meta: { progressToken: 0 } } },
      ]),
    ).toBe(true);
  });
});

describe('SC-01 HTTP response mode (live server)', () => {
  it('answers with JSON by default and switches to SSE when progress is requested', async () => {
    const { child, port } = await startServer();
    try {
      const headers = await openSession(port);

      const plain = await post(port, listCall(10), headers);
      expect(plain.status).toBe(200);
      expect(String(plain.headers['content-type'] ?? '')).toContain('application/json');
      expect(toolEnvelope(plain.text).ok).toBe(true);

      const withProgress = await post(port, listCall(11, 'progress-1'), headers);
      expect(withProgress.status).toBe(200);
      expect(String(withProgress.headers['content-type'] ?? '')).toContain('text/event-stream');
      // SSE body: the JSON-RPC result arrives as a `data:` event.
      expect(withProgress.text).toContain('data:');
      expect(toolEnvelope(withProgress.text).ok).toBe(true);
    } finally {
      await terminateServer(child);
      await rmrf(TMP);
    }
  }, 60_000);

  it('MCP_JSON_RESPONSES=0 keeps SSE for every request', async () => {
    const { child, port } = await startServer({ MCP_JSON_RESPONSES: '0' });
    try {
      const headers = await openSession(port);
      const plain = await post(port, listCall(20), headers);
      expect(plain.status).toBe(200);
      expect(String(plain.headers['content-type'] ?? '')).toContain('text/event-stream');
    } finally {
      await terminateServer(child);
      await rmrf(TMP);
    }
  }, 60_000);
});
