import { describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHmac } from 'node:crypto';

const ENTRY = path.join(process.cwd(), 'tests', 'fixtures', 'multi-transport-server.mjs');
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      srv.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

function nextJson(rl: readline.Interface, id: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for id ${id}`)), 15_000);
    const onLine = (line: string) => {
      try {
        const msg = JSON.parse(line);
        if (msg.id === id) {
          clearTimeout(timer);
          rl.off('line', onLine);
          resolve(msg);
        }
      } catch {}
    };
    rl.on('line', onLine);
  });
}

describe('AA-02: stdio + http in one process', () => {
  it('serves the same tools/list on both transports and survives stdio close', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'aa02-'));
    const port = await freePort();
    const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [ENTRY], {
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        OBSIDIAN_VAULT_ROOT: path.join(dataDir, 'vault'),
        EMBEDDINGS_MODE: 'none',
        CATALOG_ENABLED: 'false',
        MCP_TRANSPORT: 'stdio,http',
        MCP_PORT: String(port),
        MCP_HOST: '127.0.0.1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stderr.resume();
    const rl = readline.createInterface({ input: child.stdout });
    let http: Client | null = null;
    try {
      let ready = false;
      for (let i = 0; i < 100 && !ready; i++) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`);
          ready = true;
          await response.body?.cancel();
        } catch {}
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(ready).toBe(true);

      // HTTP view
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/`));
      http = new Client({ name: 'aa02-http', version: '0.0.1' });
      await http.connect(transport);
      const httpTools = await http.listTools();

      // stdio view on the same child process
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'aa02-stdio', version: '0.0.1' } },
      })}\n`);
      const init = await nextJson(rl, 1);
      expect(init.result?.serverInfo?.name).toBeTruthy();
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
      const stdioList = await nextJson(rl, 2);

      expect(stdioList.result.tools).toHaveLength(httpTools.tools.length);
      expect(httpTools.tools.length).toBeGreaterThan(0);

      // Closing the stdio pipe must not kill the process; HTTP still answers.
      child.stdin.end();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(child.exitCode).toBeNull();
      expect((await http.listTools()).tools).toHaveLength(httpTools.tools.length);
    } finally {
      await http?.close().catch(() => {});
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
      rl.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 30_000);
});
