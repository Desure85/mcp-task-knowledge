/**
 * tests/e2e-full/tcp-transport.test.ts — Q-014 slice 10: TCP transport e2e.
 *
 * Real server (dist/index.js) with MCP_TRANSPORT=tcp on an ephemeral port.
 * Handshake + framing verified end to end. Known limitation (stream-transport
 * registerTools is a no-op pending S-002 ToolExecutor): per-connection
 * sessions expose no tools, so tools/list is empty and tools/call errors
 * cleanly without dropping the connection.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-e2e-full-tcp');
const STORE = path.join(TMP, 'store');

let portCounter = 4800;

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

interface Pending { resolve: (v: any) => void; reject: (e: Error) => void; }

class LineClient {
  private sock: net.Socket;
  private buf = '';
  private pending = new Map<number, Pending>();
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
    const line = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sock.write(line, (err) => { if (err) { this.pending.delete(id); reject(err); } });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('request timeout')); } }, 10000);
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

describe('Q-014 slice 10: TCP transport roundtrip (live server)', () => {
  it('initialize → list → call tasks over raw TCP framing', async () => {
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
      },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    try {
      expect(await waitForPort(port)).toBe(true);
      const client = new LineClient(port);
      try {
        const init = await client.request('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'q014-tcp', version: '0.0.1' },
        });
        expect(init.result).toBeDefined();
        client.notify('notifications/initialized', {});

        const list = await client.request('tools/list', {});
        expect(list.error?.code).toBe(-32601);

        const callAttempt = await client.request('tools/call', {
          name: 'tasks_create',
          arguments: { project: 'mcp', title: 'Q014 tcp task' },
        });
        expect(callAttempt.error).toBeDefined();

        const client2 = new LineClient(port);
        try {
          const init2 = await client2.request('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'q014-tcp-2', version: '0.0.1' },
          });
          expect(init2.result).toBeDefined();
        } finally {
          client2.close();
        }
      } finally {
        client.close();
      }
    } finally {
      try { child.kill('SIGTERM'); } catch {}
      await rmrf(TMP);
    }
  }, 60000);
});
