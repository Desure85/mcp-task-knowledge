/**
 * tests/e2e-full/http-sessions.test.ts — Q-014 slice 11: sessions + rate-limit e2e.
 *
 * Real server (dist/index.js) on HTTP + ephemeral port via the SDK
 * StreamableHTTP client: session_list shows available:true with our session
 * and rateLimitingEnabled, proving SessionManager + RateLimiter wiring.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-e2e-full-http-sess');
const STORE = path.join(TMP, 'store');

const JWT_SECRET = 'q014-e2e-test-secret-32bytes-min!!';

function mintJwt(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'q014-user',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

let portCounter = 4950;

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

async function waitForReady(child: ChildProcess, port: number, timeoutMs = 15000): Promise<boolean> {
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

describe('Q-014 slice 11: HTTP sessions + rate limiting (live server)', () => {
  it('session_list shows our session with rate-limit info', async () => {
    await rmrf(TMP);
    await fsp.mkdir(STORE, { recursive: true });
    const port = ++portCounter;
    const child: ChildProcess = spawn('node', ['dist/index.js'], {
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
      },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let client: Client | null = null;
    try {
      expect(await waitForReady(child, port)).toBe(true);
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/`));
      client = new Client({ name: 'q014-http-sess', version: '0.0.1' });
      await client.connect(transport);

      const auth = (await client.callTool({ name: 'mcp.authenticate', arguments: { token: mintJwt() } })) as { content?: Array<{ text?: string }> };
      expect(JSON.parse(auth?.content?.[0]?.text ?? '{}').ok).toBe(true);

      const res = (await client.callTool({ name: 'session_list', arguments: {} })) as { content?: Array<{ text?: string }> };
      const text = res?.content?.[0]?.text ?? '{}';
      const env = JSON.parse(text);
      expect(env.ok).toBe(true);
      expect(env.data.available).toBe(true);
      expect(env.data.sessionsEnabled).toBe(true);
      expect(env.data.rateLimitingEnabled).toBe(true);
      expect(typeof env.data.total).toBe('number');

      // PH-002: HTTP sessions are registered in SessionManager under the SDK
      // session id (== mcp-session-id header) — session_list is now live.
      const sdkSessionId = transport.sessionId;
      expect(sdkSessionId).toBeTruthy();
      expect(env.data.total).toBeGreaterThanOrEqual(1);
      const ours = env.data.sessions.find((s: { sessionId?: string }) => s.sessionId === sdkSessionId);
      expect(ours).toBeTruthy();
      expect(ours.metadata?.transport).toBe('http');
      // authenticate() earlier should have stamped userId into metadata
      // (A-003 wiring reaches SessionManager only once the session exists).
      expect(ours.metadata?.userId).toBe('q014-user');

      // session_info resolves full detail by the live session id.
      const info = (await client.callTool({ name: 'session_info', arguments: { sessionId: sdkSessionId } })) as { content?: Array<{ text?: string }> };
      const infoEnv = JSON.parse(info?.content?.[0]?.text ?? '{}');
      expect(infoEnv.ok).toBe(true);
      expect(infoEnv.data.sessionId).toBe(sdkSessionId);
    } finally {
      try { await client?.close(); } catch {}
      try { child.kill('SIGTERM'); } catch {}
      await rmrf(TMP);
    }
  }, 60000);
});
