/**
 * tests/thin-proxy-shim.test.ts — MU-08 acceptance.
 *
 * Real http core + real `bridge` processes over stdio. Every assertion maps to
 * a DoD clause; the revert-check mutations are recorded in the decision file.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { assertDistFresh } from './support/dist-guard.js';
import {
  spawnTrackedServer,
  terminateServer,
  terminateTrackedServers,
  getFreePort,
  trackServer,
} from './support/server-process.js';
import { BRIDGE_EXIT } from '../src/cli/bridge.js';

assertDistFresh();

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.test-tmp', 'mu08-shim');
const JWT_SECRET = 'mu08-shim-jwt-secret-32-bytes-min!!';
const PASSWORD = 'mu08-shim-pass';
const IDLE_MS = 5000;

interface Shim {
  child: ChildProcess;
  client: Client;
  transport: ChildStdioTransport;
}

class ChildStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  readonly stderr: string[] = [];
  private readonly buffer = new ReadBuffer();

  constructor(private readonly child: ChildProcess) {
    child.stdout?.on('data', (chunk: Buffer) => {
      this.buffer.append(chunk);
      let message: JSONRPCMessage | null;
      while ((message = this.buffer.readMessage()) !== null) this.onmessage?.(message);
    });
    child.stderr?.on('data', (chunk: Buffer) => this.stderr.push(chunk.toString()));
    child.once('exit', () => this.onclose?.());
  }

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    this.child.stdin?.write(serializeMessage(message));
  }

  async close(): Promise<void> {
    this.child.stdin?.end();
  }
}

function baseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, LOG_LEVEL: 'error', EMBEDDINGS_MODE: 'none' };
  delete env.DATA_DIR;
  delete env.MCP_PROXY_UPSTREAM;
  delete env.MCP_PROXY_TOKEN;
  return env;
}

function health(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/healthz', timeout: 500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitForHealth(port: number, child: ChildProcess, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('core exited before becoming healthy');
    if (await health(port)) return;
  }
  throw new Error('core did not become healthy');
}

async function login(port: number): Promise<string> {
  const body = JSON.stringify({ username: 'admin', password: PASSWORD });
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/auth/login', method: 'POST', headers: { 'content-type': 'application/json' } },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as { token?: string; data?: { token?: string } };
            const token = parsed.token ?? parsed.data?.token;
            if (!token) reject(new Error('login response carried no token'));
            else resolve(token);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

async function startCore(port: number, dataDir: string): Promise<ChildProcess> {
  return spawnTrackedServer(['dist/index.js'], {
    cwd: ROOT,
    env: {
      ...baseEnv(),
      DATA_DIR: dataDir,
      MCP_TRANSPORT: 'http',
      MCP_HOST: '127.0.0.1',
      MCP_PORT: String(port),
      JWT_SECRET,
      MCP_LOGIN_USER: 'admin',
      MCP_LOGIN_PASSWORD: PASSWORD,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function spawnShim(url: string, token: string, dataDir?: string): Promise<Shim> {
  const env = baseEnv();
  env.MCP_PROXY_TOKEN = token;
  if (dataDir) env.DATA_DIR = dataDir;
  const child = spawnTrackedServer(['dist/index.js', 'bridge', '--url', url], {
    cwd: ROOT,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const transport = new ChildStdioTransport(child);
  const client = new Client({ name: 'mu08-test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return { child, client, transport };
}

function textResult(result: { content?: Array<{ text?: string }> }): Record<string, unknown> {
  const text = result.content?.find((part) => typeof part.text === 'string')?.text ?? '';
  return JSON.parse(text) as Record<string, unknown>;
}

async function callOk(client: Client, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  const payload = textResult(result as { content?: Array<{ text?: string }> });
  expect(payload.ok, `${name} failed: ${JSON.stringify(payload)}`).toBe(true);
  return payload.data as Record<string, unknown>;
}

function waitExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('process did not exit in time')), timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

function waitPortFree(port: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const server = http.createServer();
      server.once('error', () => {
        if (Date.now() > deadline) reject(new Error('port stayed busy'));
        else setTimeout(attempt, 100);
      });
      server.listen(port, '127.0.0.1', () => server.close(() => resolve()));
    };
    attempt();
  });
}

function shimMaps(pid: number | undefined): string {
  if (!pid || process.platform !== 'linux') return '';
  try {
    return fs.readFileSync(`/proc/${pid}/maps`, 'utf8');
  } catch {
    return '';
  }
}

interface ChildProc {
  pid: number;
  cmd: string;
}

function procChildren(ppid: number): ChildProc[] {
  const out: ChildProc[] = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const status = fs.readFileSync(`/proc/${entry}/status`, 'utf8');
      const match = /^PPid:\s+(\d+)$/m.exec(status);
      if (!match || Number(match[1]) !== ppid) continue;
      const cmd = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ');
      out.push({ pid: Number(entry), cmd });
    } catch {
      /* the child exited while we were reading */
    }
  }
  return out;
}

function procRunning(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0];
    return state !== 'Z';
  } catch {
    return false;
  }
}

async function waitForText(read: () => string, needle: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (read().includes(needle)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return read().includes(needle);
}

async function waitGone(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!procRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !procRunning(pid);
}

describe.sequential('MU-08 stdio→http bridge', () => {
  let core: ChildProcess;
  let corePort = 0;
  let coreData = '';
  let url = '';
  let token = '';
  let httpClient: Client;
  let shimA: Shim;
  let shimB: Shim;
  let embeddingsBefore: Record<string, unknown>;

  beforeAll(async () => {
    await fsp.rm(TMP, { recursive: true, force: true });
    coreData = path.join(TMP, 'core');
    await fsp.mkdir(coreData, { recursive: true });

    corePort = await getFreePort();
    url = `http://127.0.0.1:${corePort}/mcp`;
    core = await startCore(corePort, coreData);
    await waitForHealth(corePort, core);
    token = await login(corePort);

    httpClient = new Client({ name: 'mu08-http-client', version: '1.0.0' }, { capabilities: {} });
    await httpClient.connect(new StreamableHTTPClientTransport(new URL(url)));
    await httpClient.callTool({ name: 'mcp.authenticate', arguments: { token } });

    embeddingsBefore = await callOk(httpClient, 'embeddings_status', {});
    shimA = await spawnShim(url, token);
    shimB = await spawnShim(url, token);
  }, 60_000);

  afterAll(async () => {
    await Promise.allSettled([shimA?.client.close(), shimB?.client.close()]);
    await Promise.allSettled([httpClient?.close()]);
    await terminateTrackedServers();
    await fsp.rm(TMP, { recursive: true, force: true });
  });

  it('(a) one task created through shim A is readable through shim B and the HTTP client', async () => {
    const created = await callOk(shimA.client, 'tasks_create', { title: 'MU-08 shared task', project: 'mcp' });
    const id = String(created.id);
    expect(id.length).toBeGreaterThan(0);

    const viaB = await callOk(shimB.client, 'tasks_get', { id });
    const viaHttp = await callOk(httpClient, 'tasks_get', { id });
    expect(viaB.id).toBe(id);
    expect(viaHttp.id).toBe(id);
  });

  it('(b) kill -9 shim A leaves the core and shim B intact, and the core keeps the DATA_DIR lock', async () => {
    shimA.child.kill('SIGKILL');
    await waitExit(shimA.child, IDLE_MS);

    expect(await health(corePort)).toBe(true);
    expect(core.exitCode).toBeNull();
    const listed = textResult(
      (await shimB.client.callTool({ name: 'tasks_list', arguments: {} })) as { content?: Array<{ text?: string }> },
    ) as { ok?: boolean; data?: unknown };
    expect(listed.ok).toBe(true);
    expect(Array.isArray(listed.data)).toBe(true);
    expect(fs.existsSync(path.join(coreData, '.server.lock'))).toBe(true);

    const contenderPort = await getFreePort();
    const contender = await startCore(contenderPort, coreData);
    let stderr = '';
    contender.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    await waitExit(contender, IDLE_MS);
    expect(contender.exitCode).not.toBe(0);
    expect(stderr).toContain('SERVER_LOCK_HELD');
  }, 30_000);

  it('(c) after a core restart the shim answers a real tool call within 5 s', async () => {
    core.kill('SIGKILL');
    await waitExit(core, IDLE_MS);
    await waitPortFree(corePort);

    core = await startCore(corePort, coreData);
    await waitForHealth(corePort, core);

    await httpClient.close();
    httpClient = new Client({ name: 'mu08-http-client', version: '1.0.0' }, { capabilities: {} });
    await httpClient.connect(new StreamableHTTPClientTransport(new URL(url)));
    await httpClient.callTool({ name: 'mcp.authenticate', arguments: { token } });

    const started = Date.now();
    const call = callOk(shimB.client, 'project_list', {});
    const result = await Promise.race([
      call,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('shim did not recover within 5 s')), IDLE_MS)),
    ]);
    expect(Array.isArray(result.projects)).toBe(true);
    expect(Date.now() - started).toBeLessThanOrEqual(IDLE_MS);
  }, 40_000);

  it('(d) shims do not re-initialise embeddings and never load the model', async () => {
    const embeddingsAfter = await callOk(httpClient, 'embeddings_status', {});
    expect(embeddingsAfter.adapterInitAttempted).toBe(embeddingsBefore.adapterInitAttempted);
    expect(embeddingsAfter.adapterReady).toBe(embeddingsBefore.adapterReady);
    expect(embeddingsAfter.warmup).toEqual(embeddingsBefore.warmup);

    if (process.platform === 'linux') {
      const maps = shimMaps(shimB.child.pid);
      expect(maps.length).toBeGreaterThan(0);
      expect(maps).not.toMatch(/onnxruntime/i);
      expect(maps).not.toMatch(/\.onnx/i);
    }
  });

  it('(e) shim does not create .server.lock or write into DATA_DIR', async () => {
    const shimData = path.join(TMP, 'shim-data');
    await fsp.mkdir(shimData, { recursive: true });

    const isolated = await spawnShim(url, token, shimData);
    try {
      await callOk(isolated.client, 'project_list', {});
    } finally {
      await isolated.client.close().catch(() => undefined);
      await waitExit(isolated.child, IDLE_MS).catch(() => undefined);
    }

    expect(fs.readdirSync(shimData)).toEqual([]);
    expect(fs.existsSync(path.join(shimData, '.server.lock'))).toBe(false);
  }, 30_000);

  it('(f) closing stdin terminates the shim with exit code 0', async () => {
    await shimB.client.close();
    await waitExit(shimB.child, IDLE_MS);
    expect(shimB.child.exitCode).toBe(0);
  }, 15_000);

  it('(g) a wrong token exits with AUTH before the client sends anything', async () => {
    const wrong = 'mu08-wrong-token-do-not-log';
    const child = spawnTrackedServer(['dist/index.js', 'bridge', '--url', url], {
      cwd: ROOT,
      env: { ...baseEnv(), MCP_PROXY_TOKEN: wrong },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdinStayedOpen = child.stdin !== null && !child.stdin.destroyed && !child.stdin.writableEnded;
    expect(stdinStayedOpen).toBe(true);

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    await waitExit(child, IDLE_MS);
    expect(BRIDGE_EXIT.AUTH).toBe(4);
    expect(child.exitCode).toBe(BRIDGE_EXIT.AUTH);
    expect(stderr).toMatch(/authentication failed/i);
    expect(stderr).not.toContain(wrong);
  }, 20_000);

  const linuxIt = process.platform === 'linux' ? it : it.skip;

  linuxIt('(h) a dead parent terminates the shim while stdin is still open', async () => {
    const wrapper = trackServer(spawn('bash', ['-c', 'sleep 60 | node dist/index.js bridge --url "$0"', url], {
      cwd: ROOT,
      env: { ...baseEnv(), MCP_PROXY_TOKEN: token },
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
    let wrapperErr = '';
    wrapper.stdout?.resume();
    wrapper.stderr?.on('data', (chunk: Buffer) => { wrapperErr += chunk.toString(); });

    let shimPid = 0;
    let sleepPid = 0;
    try {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && shimPid === 0) {
        for (const child of procChildren(wrapper.pid ?? 0)) {
          if (child.cmd.includes('dist/index.js') && child.cmd.includes('bridge')) shimPid = child.pid;
          else if (child.cmd.includes('sleep 60')) sleepPid = child.pid;
        }
        if (!shimPid) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(shimPid).toBeGreaterThan(0);
      expect(await waitForText(() => wrapperErr, 'stdio bridge ready', 10_000)).toBe(true);

      wrapper.kill('SIGKILL');
      await waitExit(wrapper, IDLE_MS);

      expect(await waitGone(shimPid, 3000)).toBe(true);
      expect(wrapperErr).toMatch(/parent exited/);
    } finally {
      if (procRunning(shimPid)) process.kill(shimPid, 'SIGKILL');
      if (procRunning(sleepPid)) process.kill(sleepPid, 'SIGKILL');
      await terminateServer(wrapper, 1000).catch(() => undefined);
    }
  }, 25_000);

  it('(i) a foreign secret in --url query never reaches stdout or stderr', async () => {
    const secret = 'SECRET-Q-55555';
    const child = spawnTrackedServer(
      ['dist/index.js', 'bridge', '--url', `http://127.0.0.1:9/mcp?probe=${secret}`],
      { cwd: ROOT, env: { ...baseEnv(), MCP_PROXY_TOKEN: token }, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString(); });

    await waitExit(child, 20_000);
    expect(child.exitCode).toBe(BRIDGE_EXIT.UPSTREAM);
    expect(output).not.toContain(secret);
  }, 30_000);

  it('(j) credentials in --url are rejected as a usage error without echoing them', async () => {
    const password = 'PASSWD-LEAK-4242';
    const child = spawnTrackedServer(
      ['dist/index.js', 'bridge', '--url', `http://user:${password}@127.0.0.1:1/mcp`],
      { cwd: ROOT, env: { ...baseEnv(), MCP_PROXY_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString(); });

    await waitExit(child, IDLE_MS);
    expect(child.exitCode).toBe(BRIDGE_EXIT.USAGE);
    expect(output).toContain('credentials in the URL are not supported');
    expect(output).not.toContain(password);
  }, 20_000);

  it('(k) the connected-to line hides a query secret on a successful connect', async () => {
    const secret = 'SECRET-CONNECT-777';
    const child = spawnTrackedServer(
      ['dist/index.js', 'bridge', '--url', `${url}?probe=${secret}`],
      { cwd: ROOT, env: { ...baseEnv(), MCP_PROXY_TOKEN: token }, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stderr = '';
    child.stdout?.resume();
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    expect(await waitForText(() => stderr, 'stdio bridge ready', 15_000)).toBe(true);
    expect(stderr).toMatch(/connected to/);
    expect(stderr).not.toContain(secret);

    child.stdin?.end();
    await waitExit(child, IDLE_MS);
    expect(child.exitCode).toBe(0);
  }, 25_000);

  it('(l) pino transport errors never carry a raw credentials URL', async () => {
    const password = 'PASSWD-LOG-9999';
    const script = path.join(TMP, 'log-probe.mjs');
    await fsp.writeFile(script, `
import { ProxyBootstrap, DEFAULT_PROXY_CONFIG } from ${JSON.stringify(path.join(ROOT, 'dist/proxy/index.js'))};
const config = {
  ...DEFAULT_PROXY_CONFIG,
  enabled: true,
  upstream: { ...DEFAULT_PROXY_CONFIG.upstream, url: 'http://user:${password}@127.0.0.1:1/mcp', maxReconnects: 0 },
  auth: { mode: 'static-token', token: 'configured-token-xyz' },
};
new ProxyBootstrap(config).start().catch(() => setTimeout(() => process.exit(0), 300));
`);
    const child = trackServer(spawn('node', [script], {
      cwd: ROOT,
      env: { ...baseEnv(), LOG_LEVEL: 'error' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
    let stderr = '';
    child.stdout?.resume();
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    await waitExit(child, 15_000);
    expect(stderr).toMatch(/proxy:bootstrap/);
    expect(stderr).not.toContain(password);
  }, 25_000);
});
