/**
 * tests/e2e-full/http-auth.test.ts — Q-014 slice 5: HTTP auth fail-closed e2e.
 *
 * Real server (dist/index.js) on HTTP + ephemeral port:
 * - tools/call without a session → 401 JSON-RPC error (fail-closed)
 * - tools/list passes the gate (not a tools/call)
 * - tools/call mcp.authenticate passes the gate pre-auth (whitelisted)
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-e2e-full-http-auth');
const STORE = path.join(TMP, 'store');

let portCounter = 4600;

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

function post(port: number, body: unknown): Promise<{ status: number; text: string }> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
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

describe('Q-014 slice 5: HTTP fail-closed gate (live server)', () => {
  let child: ChildProcess;
  let port = 0;

  async function start() {
    await rmrf(TMP);
    await fsp.mkdir(STORE, { recursive: true });
    port = ++portCounter;
    child = spawn('node', ['dist/index.js'], {
      env: {
        ...process.env,
        DATA_DIR: STORE,
        OBSIDIAN_VAULT_ROOT: path.join(TMP, 'vault'),
        EMBEDDINGS_MODE: 'none',
        CATALOG_ENABLED: 'false',
        MCP_TRANSPORT: 'http',
        MCP_PORT: String(port),
        MCP_HOST: '127.0.0.1',
      },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    expect(await waitForReady(child, port)).toBe(true);
  }

  async function stop() {
    try { child?.kill('SIGTERM'); } catch {}
    await rmrf(TMP);
  }

  it('unauthenticated tools/call → 401 with JSON-RPC error', async () => {
    await start();
    try {
      const res = await post(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tasks_list', arguments: { project: 'mcp' } },
      });
      expect(res.status).toBe(401);
      const body = JSON.parse(res.text);
      expect(body.error).toBeDefined();
    } finally {
      await stop();
    }
  }, 60000);

  it('tools/list passes the gate (no 401)', async () => {
    await start();
    try {
      const res = await post(port, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
      expect(res.status).not.toBe(401);
    } finally {
      await stop();
    }
  }, 60000);

  it('mcp.authenticate passes the gate pre-auth (no 401)', async () => {
    await start();
    try {
      const res = await post(port, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'mcp.authenticate', arguments: {} },
      });
      expect(res.status).not.toBe(401);
    } finally {
      await stop();
    }
  }, 60000);
});
