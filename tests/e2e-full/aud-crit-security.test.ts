/**
 * tests/e2e-full/aud-crit-security.test.ts — Этап M фаза 1 (critical):
 *
 *   AUD-01  every MCP method is auth-gated on http+tcp — resources/list+read,
 *           prompts/list+get, completion/complete, tools/list all denied
 *           pre-auth; whitelist = initialize/ping/mcp.authenticate only.
 *   AUD-02  resources/read is read-only — task://action/* URIs no longer
 *           mutate state (mutations are tools-only).
 *   AUD-03  project/id path traversal rejected at storage boundary
 *           (resolveUnder) and at project_create (PROJECT_ID_RE).
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-e2e-full-audcrit');
const STORE = path.join(TMP, 'store');

const JWT_SECRET = 'aud-crit-e2e-secret-32bytes-min!!!';

function mintJwt(sub = 'aud-user'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

let portCounter = 4400;

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

interface McpResp { status: number; sessionId?: string; json?: any }

/** POST a JSON-RPC message; parses both plain JSON and SSE (data:) bodies. */
async function mcpPost(port: number, sessionId: string | undefined, body: unknown): Promise<McpResp> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'Content-Length': String(Buffer.byteLength(payload)),
    };
    if (sessionId) headers['mcp-session-id'] = sessionId;
    const req = http.request(
      { host: '127.0.0.1', port, path: '/', method: 'POST', headers, timeout: 8000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: any;
          const ct = res.headers['content-type'] ?? '';
          if (ct.includes('text/event-stream')) {
            for (const line of text.split('\n')) {
              if (line.startsWith('data:')) {
                try { json = JSON.parse(line.slice(5).trim()); } catch {}
              }
            }
          } else {
            try { json = JSON.parse(text); } catch { json = undefined; }
          }
          resolve({
            status: res.statusCode ?? 0,
            sessionId: (res.headers['mcp-session-id'] as string | undefined) ?? sessionId,
            json,
          });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('mcpPost timeout')); });
    req.end(payload);
  });
}

function rpc(id: number, method: string, params: unknown = {}) {
  return { jsonrpc: '2.0', id, method, params };
}

// ── TCP line client (same framing as tcp-transport.test.ts) ───────────

class LineClient {
  private sock: net.Socket;
  private buf = '';
  private pending = new Map<number, { resolve: (v: any) => void }>();
  private nextId = 1;

  constructor(port: number) {
    this.sock = net.createConnection({ host: '127.0.0.1', port });
    this.sock.setEncoding('utf8');
    this.sock.on('data', (chunk: string) => this.onData(chunk));
  }

  private onData(chunk: string) {
    this.buf += chunk;
    for (;;) {
      const idx = this.buf.indexOf('\n');
      if (idx < 0) return;
      const line = this.buf.slice(0, idx).replace(/\r$/, '');
      this.buf = this.buf.slice(idx + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          this.pending.get(msg.id)!.resolve(msg);
          this.pending.delete(msg.id);
        }
      } catch {}
    }
  }

  request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve });
      this.sock.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', (err) => {
        if (err) { this.pending.delete(id); reject(err); }
      });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('tcp request timeout')); } }, 10000);
    });
  }

  notify(method: string, params: unknown) {
    this.sock.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  close() { this.sock.destroy(); }
}

async function waitForPort(port: number, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = net.createConnection({ host: '127.0.0.1', port, timeout: 500 });
      s.on('connect', () => { s.destroy(); resolve(true); });
      s.on('error', () => resolve(false));
      s.on('timeout', () => { s.destroy(); resolve(false); });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('AUD-01/02/03 — critical request-path hardening (live server)', () => {
  it('AUD-01 http: all data methods denied pre-auth; work after mcp.authenticate', async () => {
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
    try {
      expect(await waitForReady(child, port)).toBe(true);

      // initialize → session id (must stay open pre-auth).
      const init = await mcpPost(port, undefined, rpc(1, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'aud01', version: '0.0.1' },
      }));
      expect(init.status).toBe(200);
      const sid = init.sessionId;
      expect(sid).toBeTruthy();
      await mcpPost(port, sid, { jsonrpc: '2.0', method: 'notifications/initialized' });

      // Every data method → 401 pre-auth (previously passed through).
      for (const [i, method] of ['resources/list', 'prompts/list', 'tools/list'].entries()) {
        const res = await mcpPost(port, sid, rpc(10 + i, method));
        expect(res.status, `${method} must be 401 pre-auth`).toBe(401);
        expect(res.json?.error?.code).toBe(-32001);
      }
      const read = await mcpPost(port, sid, rpc(20, 'resources/read', { uri: 'task://tasks' }));
      expect(read.status).toBe(401);

      // Authenticate → the same methods work.
      const auth = await mcpPost(port, sid, rpc(30, 'tools/call', { name: 'mcp.authenticate', arguments: { token: mintJwt() } }));
      expect(auth.status).toBe(200);
      expect(JSON.parse(auth.json?.result?.content?.[0]?.text ?? '{}').ok).toBe(true);

      const list = await mcpPost(port, sid, rpc(31, 'resources/list'));
      expect(list.status).toBe(200);
      expect(list.json?.result?.resources).toBeDefined();
      const tlist = await mcpPost(port, sid, rpc(32, 'tools/list'));
      expect(tlist.status).toBe(200);
      expect(Array.isArray(tlist.json?.result?.tools)).toBe(true);
    } finally {
      try { child.kill('SIGTERM'); } catch {}
      await rmrf(TMP);
    }
  }, 60000);

  it('AUD-01 tcp: resources/list denied pre-auth, served post-auth', async () => {
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
        MCP_TRANSPORT: 'tcp',
        MCP_PORT: String(port),
        MCP_TCP_PORT: String(port),
        MCP_TCP_HOST: '127.0.0.1',
        JWT_SECRET,
      },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let client: LineClient | null = null;
    try {
      expect(await waitForPort(port)).toBe(true);
      client = new LineClient(port);
      const init = await client.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'aud01-tcp', version: '0.0.1' },
      });
      expect(init.result).toBeDefined();
      client.notify('notifications/initialized', {});

      // Pre-auth: resources/list denied (was reachable before the fix).
      const denied = await client.request('resources/list', {});
      expect(denied.error).toBeDefined();
      expect(denied.error?.code).toBe(-32001);
      const deniedRead = await client.request('resources/read', { uri: 'task://tasks' });
      expect(deniedRead.error?.code).toBe(-32001);
      const deniedCompletion = await client.request('completion/complete', {
        ref: { type: 'ref/prompt', name: 'x' },
        argument: { name: 'a', value: 'b' },
      });
      expect(deniedCompletion.error?.code).toBe(-32001);

      const auth = await client.request('tools/call', {
        name: 'mcp.authenticate',
        arguments: { token: mintJwt() },
      });
      expect(auth.error).toBeUndefined();
      expect(JSON.parse(auth.result?.content?.[0]?.text ?? '{}').ok).toBe(true);

      const list = await client.request('resources/list', {});
      expect(list.error).toBeUndefined();
      expect(list.result?.resources).toBeDefined();
    } finally {
      client?.close();
      try { child.kill('SIGTERM'); } catch {}
      await rmrf(TMP);
    }
  }, 60000);

  it('AUD-02: resources/read cannot mutate — task://action/* returns ok:false, task unchanged', async () => {
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
    try {
      expect(await waitForReady(child, port)).toBe(true);
      const init = await mcpPost(port, undefined, rpc(1, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'aud02', version: '0.0.1' },
      }));
      const sid = init.sessionId!;
      await mcpPost(port, sid, { jsonrpc: '2.0', method: 'notifications/initialized' });
      await mcpPost(port, sid, rpc(2, 'tools/call', { name: 'mcp.authenticate', arguments: { token: mintJwt() } }));

      // Create a task via the proper tool.
      const created = await mcpPost(port, sid, rpc(3, 'tools/call', {
        name: 'tasks_create',
        arguments: { project: 'mcp', title: 'AUD02 immutable task' },
      }));
      const createdEnv = JSON.parse(created.json?.result?.content?.[0]?.text ?? '{}');
      expect(createdEnv.ok).toBe(true);
      const taskId = createdEnv.data?.id ?? createdEnv.data?.task?.id;
      expect(taskId).toBeTruthy();

      // The old mutation surface: every action URI form must refuse.
      for (const [i, uri] of [
        `task://action/mcp/${taskId}/close`,
        `task://action?project=mcp&id=${taskId}&action=complete`,
        `task://mcp/${taskId}/action/trash`,
        `task://action/mcp/${taskId}/status/completed`,
      ].entries()) {
        const res = await mcpPost(port, sid, rpc(40 + i, 'resources/read', { uri }));
        expect(res.status).toBe(200);
        const text = res.json?.result?.contents?.[0]?.text;
        const env = text ? JSON.parse(text) : undefined;
        // Either the explicit refuse-envelope (registered refuse stubs) or a
        // JSON-RPC "not found" — both refuse; the contract is: no mutation.
        const refused = env?.ok === false || res.json?.error !== undefined;
        expect(refused, `action URI must refuse: ${uri} → ${text ?? JSON.stringify(res.json)}`).toBe(true);
        if (env?.ok === false) expect(env.error).toMatch(/removed|unsupported|not found/i);
      }

      // State untouched: still 'pending' via the read path and the tool.
      const read = await mcpPost(port, sid, rpc(50, 'resources/read', { uri: `task://mcp/${taskId}` }));
      const task = JSON.parse(read.json?.result?.contents?.[0]?.text ?? '{}');
      expect(task.status ?? task.data?.status).toBe('pending');
      const got = await mcpPost(port, sid, rpc(51, 'tools/call', { name: 'tasks_get', arguments: { project: 'mcp', id: taskId } }));
      const gotEnv = JSON.parse(got.json?.result?.content?.[0]?.text ?? '{}');
      expect(gotEnv.data?.status ?? gotEnv.data?.task?.status).toBe('pending');
    } finally {
      try { child.kill('SIGTERM'); } catch {}
      await rmrf(TMP);
    }
  }, 60000);

  it('AUD-03: traversal in project/id/filename rejected at every boundary', async () => {
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
    try {
      expect(await waitForReady(child, port)).toBe(true);
      const init = await mcpPost(port, undefined, rpc(1, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'aud03', version: '0.0.1' },
      }));
      const sid = init.sessionId!;
      await mcpPost(port, sid, { jsonrpc: '2.0', method: 'notifications/initialized' });
      await mcpPost(port, sid, rpc(2, 'tools/call', { name: 'mcp.authenticate', arguments: { token: mintJwt() } }));

      const call = async (id: number, name: string, args: Record<string, unknown>) => {
        const res = await mcpPost(port, sid, rpc(id, 'tools/call', { name, arguments: args }));
        const content = res.json?.result?.content?.[0]?.text;
        const env = content ? JSON.parse(content) : undefined;
        return { res, env, isError: res.json?.result?.isError === true || res.json?.error !== undefined };
      };

      // project_create with traversal id → rejected (schema regex).
      const pc = await call(10, 'project_create', { id: '../escape-proj' });
      expect(pc.env?.ok === false || pc.isError).toBe(true);
      const pc2 = await call(11, 'project_create', { id: 'a/b' });
      expect(pc2.env?.ok === false || pc2.isError).toBe(true);

      // tasks_create with traversal project → error envelope, no dir created.
      const tc = await call(12, 'tasks_create', { project: '../../outside', title: 'nope' });
      expect(tc.env?.ok === false || tc.isError).toBe(true);
      const escaped = path.resolve(STORE, '..', '..', 'outside');
      await expect(fsp.stat(escaped)).rejects.toThrow();

      // task read with traversal project → denied (was a file read before).
      const tr = await call(13, 'tasks_get', { project: '..', id: 'x' });
      expect(tr.env?.ok === false || tr.isError).toBe(true);

      // knowledge read with traversal project → error.
      const kr = await call(14, 'knowledge_get', { project: '../..', id: 'x' });
      expect(kr.env?.ok === false || kr.isError).toBe(true);

      // Resource URI traversal (percent-encoded separators survive URL
      // normalization, then resolveUnderPath must reject them).
      const exp = await mcpPost(port, sid, rpc(60, 'resources/read', { uri: 'export://mcp/json/..%2F..%2F..%2Fetc%2Fpasswd' }));
      const expText = exp.json?.result?.contents?.[0]?.text;
      expect(exp.json?.error !== undefined || (expText && /escapes|forbidden|Failed/i.test(expText))).toBe(true);

      const taskRes = await mcpPost(port, sid, rpc(61, 'resources/read', { uri: 'task://../x' }));
      expect(taskRes.json?.error !== undefined || JSON.stringify(taskRes.json?.result ?? {}).includes('error')).toBe(true);

      // Legit calls still work: valid project + task roundtrip.
      const okPc = await call(70, 'project_create', { id: 'aud03-proj' });
      expect(okPc.env?.ok).toBe(true);
      const okTc = await call(71, 'tasks_create', { project: 'aud03-proj', title: 'legit' });
      expect(okTc.env?.ok).toBe(true);
    } finally {
      try { child.kill('SIGTERM'); } catch {}
      await rmrf(TMP);
    }
  }, 60000);
});
