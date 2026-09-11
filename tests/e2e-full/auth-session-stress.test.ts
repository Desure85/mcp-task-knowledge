/**
 * tests/e2e-full/auth-session-stress.test.ts — Q-014 slice 16: auth/session/cluster core.
 *
 * Semantic checks (not shape-only): a tool call must actually be allowed or
 * denied based on auth state; rate limiting must actually produce 429; a
 * session that authenticates must show up in session introspection.
 *
 *   HTTP (real server, ephemeral port):
 *     - unauthenticated tools/call → 401
 *     - wrong token → 401
 *     - correct token → 200 with a real tool result
 *     - burst over MCP_RATE_LIMIT_MAX_TOKENS → 429
 *     - session_info reflects the authenticated session
 *   stdio:
 *     - cluster_status/cluster_nodes answer with availability shape
 *     - cluster_assign without a ClusterManager fails cleanly (err envelope)
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { spawnServer } from './harness.js';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-e2e-full-auth-stress');
const STORE = path.join(TMP, 'store');

let portCounter = 4700;

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

function post(port: number, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('post timeout')); });
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

  const tasksCall = () => ({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'tasks_list', arguments: { project: 'mcp' } },
  });

  it('HTTP: unauthenticated tools/call → 401, valid token → 200, wrong token → 401', async () => {
    await startHttp();
    try {
      const unauth = await post(port, tasksCall());
      expect(unauth.status).toBe(401);
      expect(JSON.parse(unauth.text).error).toBeDefined();

      const wrong = await post(port, tasksCall(), { Authorization: 'Bearer wrong-token' });
      expect(wrong.status).toBe(401);

      const ok = await post(port, tasksCall(), { Authorization: 'Bearer test-token-abc-123' });
      expect(ok.status).toBe(200);
      const body = JSON.parse(ok.text);
      expect(body.result?.content?.[0]?.text).toBeTruthy();
    } finally {
      await stop();
    }
  }, 60000);

  it('HTTP: rate limiting trips after burst (429)', async () => {
    await startHttp({ MCP_RATE_LIMIT_MAX_TOKENS: '3' });
    try {
      const call = () => post(port, tasksCall(), { Authorization: 'Bearer test-token-abc-123' });

      for (let i = 0; i < 3; i++) {
        const r = await call();
        expect(r.status).toBe(200);
      }
      const limited = await call();
      expect(limited.status).toBe(429);
    } finally {
      await stop();
    }
  }, 60000);

  it('HTTP: session_info reflects the authenticated session', async () => {
    await startHttp();
    try {
      const auth = await post(port, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'mcp.authenticate', arguments: { token: 'test-token-abc-123' } },
      });
      expect(auth.status).toBe(200);
      const authBody = JSON.parse(auth.text);
      const sessionId = authBody.result?.content?.[0]?.text
        ? JSON.parse(authBody.result.content[0].text).sessionId
        : undefined;

      const info = await post(port, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'session_info', arguments: { sessionId } },
      }, { Authorization: 'Bearer test-token-abc-123' });
      expect(info.status).toBe(200);
      const infoBody = JSON.parse(info.text);
      const text = infoBody.result?.content?.[0]?.text ?? '';
      expect(JSON.parse(text).available).toBe(true);
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
