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

function mintJwt(sub = 'q014-user'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub,
    roles: ['admin'],
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

  it('PH-004: current project is session-scoped — two clients stay isolated', async () => {
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
    const proj = `ph004${Date.now().toString(36)}`;
    let clientA: Client | null = null;
    let clientB: Client | null = null;
    try {
      expect(await waitForReady(child, port)).toBe(true);
      const mkClient = async (name: string) => {
        const t = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/`));
        const c = new Client({ name, version: '0.0.1' });
        await c.connect(t);
        const auth = (await c.callTool({ name: 'mcp.authenticate', arguments: { token: mintJwt() } })) as { content?: Array<{ text?: string }> };
        expect(JSON.parse(auth?.content?.[0]?.text ?? '{}').ok).toBe(true);
        return c;
      };
      clientA = await mkClient('q014-http-A');
      clientB = await mkClient('q014-http-B');
      const callJson = async (c: Client, tool: string, args: Record<string, unknown>) => {
        const r = (await c.callTool({ name: tool, arguments: args })) as { content?: Array<{ text?: string }> };
        return JSON.parse(r?.content?.[0]?.text ?? '{}');
      };

      // Client A creates a project and makes it current — session-scoped.
      expect((await callJson(clientA, 'project_create', { id: proj })).ok).toBe(true);
      const setA = await callJson(clientA, 'project_set_current', { project: proj });
      expect(setA.ok).toBe(true);
      expect(setA.data.scope).toBe('session');
      const curA = await callJson(clientA, 'project_get_current', {});
      expect(curA.data.project).toBe(proj);
      expect(curA.data.scope).toBe('session');

      // A creates a task WITHOUT project → resolves to A's session current.
      expect((await callJson(clientA, 'tasks_create', { title: 'PH004 session task' })).ok).toBe(true);
      const listA = await callJson(clientA, 'tasks_list', {});
      expect(JSON.stringify(listA.data)).toContain('PH004 session task');

      // Client B is untouched: global current, no leakage.
      const curB = await callJson(clientB, 'project_get_current', {});
      expect(curB.data.project).toBe('mcp');
      expect(curB.data.scope).toBe('global');
      const listB = await callJson(clientB, 'tasks_list', {});
      expect(JSON.stringify(listB.data)).not.toContain('PH004 session task');
    } finally {
      try { await clientA?.close(); } catch {}
      try { await clientB?.close(); } catch {}
      try { child.kill('SIGTERM'); } catch {}
      await rmrf(TMP);
    }
  }, 60000);

  it('PH-007: authenticated sessions auto-scope memory facts per userId', async () => {
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
    let alice: Client | null = null;
    let bob: Client | null = null;
    try {
      expect(await waitForReady(child, port)).toBe(true);
      const mkClient = async (name: string, sub: string) => {
        const t = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/`));
        const c = new Client({ name, version: '0.0.1' });
        await c.connect(t);
        const auth = (await c.callTool({ name: 'mcp.authenticate', arguments: { token: mintJwt(sub) } })) as { content?: Array<{ text?: string }> };
        expect(JSON.parse(auth?.content?.[0]?.text ?? '{}').ok).toBe(true);
        return c;
      };
      alice = await mkClient('ph007-alice', 'user-alice');
      bob = await mkClient('ph007-bob', 'user-bob');
      const callJson = async (c: Client, tool: string, args: Record<string, unknown>) => {
        const r = (await c.callTool({ name: tool, arguments: args })) as { content?: Array<{ text?: string }> };
        return JSON.parse(r?.content?.[0]?.text ?? '{}');
      };

      // Alice writes a fact without explicit scope → inherits user-alice.
      const addA = await callJson(alice, 'memory_temporal_add', { statement: 'Alice tenant fact ph007-http' });
      expect(addA.ok).toBe(true);
      expect(addA.data.scope?.userId).toBe('user-alice');

      // Bob writes one too → user-bob scope.
      const addB = await callJson(bob, 'memory_temporal_add', { statement: 'Bob tenant fact ph007-http' });
      expect(addB.data.scope?.userId).toBe('user-bob');

      // Default filter = session scope: Alice sees hers, not Bob's.
      const aliceView = await callJson(alice, 'memory_scope_filter', {});
      expect(JSON.stringify(aliceView.data.facts)).toContain('Alice tenant fact');
      expect(JSON.stringify(aliceView.data.facts)).not.toContain('Bob tenant fact');

      // Bob cannot escape into alice's scope even by passing userId explicitly.
      const bobEscape = await callJson(bob, 'memory_scope_filter', { userId: 'user-alice' });
      expect(JSON.stringify(bobEscape.data.facts)).not.toContain('Alice tenant fact');
      expect(bobEscape.data.scope).toContain('user-bob');
    } finally {
      try { await alice?.close(); } catch {}
      try { await bob?.close(); } catch {}
      try { child.kill('SIGTERM'); } catch {}
      await rmrf(TMP);
    }
  }, 60000);

  it('PH-015: CORS for browser clients — preflight + exposed mcp-session-id', async () => {
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
        MCP_CORS_ORIGIN: 'http://localhost:3000',
      },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    try {
      expect(await waitForReady(child, port)).toBe(true);
      const base = `http://127.0.0.1:${port}/`;

      // Preflight from an allowed origin → 204 with the MCP headers.
      const preflight = await fetch(base, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type, mcp-session-id',
        },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
      expect(preflight.headers.get('access-control-allow-headers')).toContain('mcp-session-id');
      expect(preflight.headers.get('access-control-expose-headers')).toContain('mcp-session-id');

      // Preflight from a foreign origin → denied (no allow headers).
      const denied = await fetch(base, {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.example' },
      });
      expect(denied.status).toBe(403);
      expect(denied.headers.get('access-control-allow-origin')).toBeNull();

      // Real initialize from the allowed origin: CORS headers + session id
      // must BOTH be exposed so the browser SDK can continue the session.
      const init = await fetch(base, {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'cors-e2e', version: '0.0.1' },
          },
        }),
      });
      expect(init.status).toBe(200);
      expect(init.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
      expect(init.headers.get('access-control-expose-headers')).toContain('mcp-session-id');
      expect(init.headers.get('mcp-session-id')).toBeTruthy();
    } finally {
      try { child.kill('SIGTERM'); } catch {}
      await rmrf(TMP);
    }
  }, 60000);
});
