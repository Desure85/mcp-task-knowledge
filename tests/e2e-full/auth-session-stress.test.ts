/**
 * tests/e2e-full/auth-session-stress.test.ts — Q-014 slice 16: auth/session/cluster core.
 *
 * Semantic checks (not shape-only): a tool call must actually be allowed or
 * denied based on auth state; a session that authenticates must show up in
 * session introspection.
 *
 * Auth flow (AUD-01): raw JSON-RPC over HTTP —
 *   initialize (open) → mcp-session-id → mcp.authenticate(token) → data methods.
 *
 *   HTTP (real server, ephemeral port):
 *     - unauthenticated tools/call → 401
 *     - mcp.authenticate with bad token → ok:false
 *     - mcp.authenticate with valid token → ok:true, then tools/call → 200
 *     - session_info reflects the authenticated session
 *   stdio:
 *     - cluster_status/cluster_nodes answer with availability shape
 *     - cluster_assign without a ClusterManager fails cleanly (err envelope)
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { spawnServer } from './harness.js';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-e2e-full-auth-stress');

const JWT_SECRET = 'q014-e2e-auth-stress-secret-32b!!';

function mintJwt(sub = 'q014-stress-user', roles: string[] = []): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub,
    roles,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function rpc(id: number, method: string, params?: unknown) {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
}

let portCounter = 4700;

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

interface McpResp { status: number; sessionId?: string; json?: any }

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

describe('Q-014 slice 16: auth/session/cluster core', () => {
  let child: ChildProcess | undefined;
  let port = 0;
  let tmp = '';

  async function startHttp(extraEnv: Record<string, string> = {}) {
    tmp = path.join(TMP, `-${++portCounter}`);
    await rmrf(tmp);
    await fsp.mkdir(path.join(tmp, 'store'), { recursive: true });
    port = portCounter;
    child = spawn('node', ['dist/index.js'], {
      env: {
        ...process.env,
        DATA_DIR: path.join(tmp, 'store'),
        OBSIDIAN_VAULT_ROOT: path.join(tmp, 'vault'),
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
    expect(await waitForReady(child, port)).toBe(true);
  }

  async function stop() {
    try { child?.kill('SIGTERM'); } catch {}
    try { await rmrf(tmp); } catch {}
    child = undefined;
  }

  const tasksCall = (id = 1) => rpc(id, 'tools/call', { name: 'tasks_list', arguments: { project: 'mcp' } });

  it('HTTP: unauthenticated tools/call → 401; bad token → auth error; valid token → 200', async () => {
    await startHttp();
    try {
      const init = await mcpPost(port, undefined, rpc(1, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'q014-stress', version: '0.0.1' },
      }));
      expect(init.status).toBe(200);
      const sid = init.sessionId;
      expect(sid).toBeTruthy();
      await mcpPost(port, sid, { jsonrpc: '2.0', method: 'notifications/initialized' });

      const unauth = await mcpPost(port, sid, tasksCall(2));
      expect(unauth.status).toBe(401);
      expect(unauth.json?.error).toBeDefined();

      const bad = await mcpPost(port, sid, rpc(3, 'tools/call', {
        name: 'mcp.authenticate', arguments: { token: 'wrong-token' },
      }));
      expect(bad.status).toBe(200);
      expect(JSON.parse(bad.json?.result?.content?.[0]?.text ?? '{}').ok).toBe(false);

      const auth = await mcpPost(port, sid, rpc(4, 'tools/call', {
        name: 'mcp.authenticate', arguments: { token: mintJwt() },
      }));
      expect(auth.status).toBe(200);
      expect(JSON.parse(auth.json?.result?.content?.[0]?.text ?? '{}').ok).toBe(true);

      const ok = await mcpPost(port, sid, tasksCall(5));
      expect(ok.status).toBe(200);
      expect(ok.json?.result?.content?.[0]?.text).toBeTruthy();
    } finally {
      await stop();
    }
  }, 60000);

  it('HTTP: session_info reflects the authenticated session (admin role required)', async () => {
    await startHttp();
    try {
      const init = await mcpPost(port, undefined, rpc(1, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'q014-stress', version: '0.0.1' },
      }));
      const sid = init.sessionId!;
      await mcpPost(port, sid, { jsonrpc: '2.0', method: 'notifications/initialized' });

      const auth = await mcpPost(port, sid, rpc(2, 'tools/call', {
        name: 'mcp.authenticate', arguments: { token: mintJwt('q014-stress-user', ['admin']) },
      }));
      expect(auth.status).toBe(200);
      expect(JSON.parse(auth.json?.result?.content?.[0]?.text ?? '{}').ok).toBe(true);

      const info = await mcpPost(port, sid, rpc(3, 'tools/call', {
        name: 'session_info', arguments: { sessionId: sid },
      }));
      expect(info.status).toBe(200);
      const text = info.json?.result?.content?.[0]?.text ?? '';
      const env = JSON.parse(text);
      expect(env.ok).toBe(true);
      expect(env.data.sessionId).toBe(sid);
      expect(env.data.available).toBe(true);
    } finally {
      await stop();
    }
  }, 60000);

  it('stdio: cluster status/nodes answer with availability; assign fails cleanly without ClusterManager', async () => {
    const srv = await spawnServer('cluster-core');
    try {
      const st = await srv.callTool('cluster_status', {});
      expect(st.env.ok).toBe(true);
      expect(st.env.data.clusteringEnabled).toBe(false);

      const nodes = await srv.callTool('cluster_nodes', {});
      expect(nodes.env.ok).toBe(true);
      expect(nodes.env.data.nodes).toEqual([]);

      const assign = await srv.callTool('cluster_assign', { sessionId: 'sess-1' });
      expect(assign.env.ok).toBe(false);
    } finally {
      await srv.close();
    }
  }, 60000);
});
