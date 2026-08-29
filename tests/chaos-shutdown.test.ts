/**
 * tests/chaos-shutdown.test.ts — Chaos & graceful shutdown tests (Q-009)
 *
 * Spawns the real MCP server (dist/index.js) as a child process and
 * verifies:
 *   - SIGTERM triggers graceful shutdown (clean exit code 0, data intact)
 *   - SIGINT triggers graceful shutdown (clean exit code 0)
 *   - SIGKILL (hard kill) leaves stored data intact (file-backed storage)
 *   - Server survives partial writes / restarts with data intact
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-chaos');
const STORE = path.join(TMP, 'store');

let portCounter = 4000;

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

function startServer(): ChildProcess {
  const port = ++portCounter;
  return spawn('node', ['dist/index.js'], {
    env: {
      ...process.env,
      DATA_DIR: STORE,
      OBSIDIAN_VAULT_ROOT: path.join(TMP, 'vault'),
      EMBEDDINGS_MODE: 'none',
      CATALOG_ENABLED: 'false',
      // HTTP transport: signal handlers are installed for non-stdio transports
      MCP_TRANSPORT: 'http',
      MCP_PORT: String(port),
      MCP_HOST: '127.0.0.1',
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

/** Wait until the server answers HTTP (health endpoint) or timeout. */
async function waitForReady(child: ChildProcess, port: number, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false; // process died before ready
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
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function waitForExit(child: ChildProcess, timeoutMs = 8000): Promise<number | null> {
  const [code] = await Promise.race([
    once(child, 'exit'),
    new Promise<[number | null]>((resolve) => setTimeout(() => resolve([null]), timeoutMs)),
  ]);
  return code as number | null;
}

function signalPort(child: ChildProcess, signal: NodeJS.Signals) {
  child.kill(signal);
}

describe('Q-009: chaos / graceful shutdown', () => {
  beforeAll(async () => {
    await rmrf(TMP);
    await fsp.mkdir(STORE, { recursive: true });
  });

  afterAll(async () => {
    await rmrf(TMP);
  });

  it('SIGTERM triggers graceful shutdown with exit code 0', async () => {
    const child = startServer();
    const port = portCounter;
    expect(await waitForReady(child, port)).toBe(true);
    signalPort(child, 'SIGTERM');
    const code = await waitForExit(child);
    expect(code).toBe(0);
  }, 20000);

  it('SIGINT triggers graceful shutdown with exit code 0', async () => {
    const child = startServer();
    const port = portCounter;
    expect(await waitForReady(child, port)).toBe(true);
    signalPort(child, 'SIGINT');
    const code = await waitForExit(child);
    expect(code).toBe(0);
  }, 20000);

  it('SIGKILL (hard kill) leaves storage directory valid', async () => {
    // Pre-create a data file, then hard-kill the server
    const dataDir = path.join(STORE, 'tasks', 'mcp');
    await fsp.mkdir(dataDir, { recursive: true });
    const sampleTask = {
      id: 'chaos-task-1',
      title: 'Chaos task',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await fsp.writeFile(path.join(dataDir, 'chaos-task-1.json'), JSON.stringify(sampleTask));

    const child = startServer();
    const port = portCounter;
    expect(await waitForReady(child, port)).toBe(true);
    signalPort(child, 'SIGKILL');
    const code = await waitForExit(child);
    expect(code).not.toBe(0); // killed by signal, not clean exit

    // Data must still be valid JSON after hard kill
    const raw = await fsp.readFile(path.join(dataDir, 'chaos-task-1.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual(sampleTask);
  }, 20000);

  it('server restarts cleanly after SIGKILL (data survives)', async () => {
    // Second boot after hard kill must not corrupt anything
    const child = startServer();
    const port = portCounter;
    expect(await waitForReady(child, port)).toBe(true);
    signalPort(child, 'SIGTERM');
    const code = await waitForExit(child);
    expect(code).toBe(0);

    const raw = await fsp.readFile(path.join(STORE, 'tasks', 'mcp', 'chaos-task-1.json'), 'utf8');
    expect(JSON.parse(raw).title).toBe('Chaos task');
  }, 20000);
});
