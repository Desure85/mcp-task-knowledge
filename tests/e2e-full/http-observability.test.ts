/**
 * tests/e2e-full/http-observability.test.ts — Q-014 slice 12: observability e2e.
 *
 * Real server (dist/index.js) on HTTP + ephemeral port:
 * /healthz 200, /metrics 200 Prometheus text with mcp_ prefix after traffic.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-e2e-full-http-obs');
const STORE = path.join(TMP, 'store');

let portCounter = 5050;

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

function get(port: number, urlPath: string): Promise<{ status: number; text: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, timeout: 5000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        text: Buffer.concat(chunks).toString('utf8'),
        headers: res.headers,
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('get timeout')); });
  });
}

async function waitForReady(child: ChildProcess, port: number, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const r = await get(port, '/healthz');
      if (r.status === 200) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

describe('Q-014 slice 12: HTTP observability (live server)', () => {
  it('/healthz 200 and /metrics exposes mcp_ series', async () => {
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
      },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    try {
      expect(await waitForReady(child, port)).toBe(true);

      const health = await get(port, '/healthz');
      expect(health.status).toBe(200);

      const metrics = await get(port, '/metrics');
      expect(metrics.status).toBe(200);
      expect(String(metrics.headers['content-type'])).toContain('text');
      expect(metrics.text).toContain('mcp_');
    } finally {
      try { child.kill('SIGTERM'); } catch {}
      await rmrf(TMP);
    }
  }, 60000);
});
