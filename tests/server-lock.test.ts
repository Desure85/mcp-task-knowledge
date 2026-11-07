/**
 * MU-01: one process owns a DATA_DIR.
 *
 * Cases a-g from the assignment, each with a revert-check documented in the
 * decision record:
 *   a) a second server process on the same DATA_DIR refuses to start
 *   b) 20 simultaneous acquirers -> exactly one wins
 *   c) kill -9 of the owner -> the next start reclaims the stale lock
 *   d) a reused pid is not mistaken for a live holder
 *   e) a graceful stop removes the lock
 *   f) a lock from another hostname is never removed automatically
 *   g) the original lost-update probe no longer loses writes
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { assertDistFresh } from './support/dist-guard.js';
import {
  spawnTrackedServer,
  terminateTrackedServers,
} from './support/server-process.js';
import {
  acquireServerLock,
  isProcessAlive,
  readProcessIdentity,
  SERVER_LOCK_FILENAME,
  ServerLockError,
  shouldAcquireServerLock,
  type ServerLockHolder,
} from '../src/storage-lock.js';

assertDistFresh();

const ROOT = process.cwd();
const DATA_DIRS: string[] = [];

function serverEnv(dataDir: string): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) inherited[key] = value;
  }
  return {
    ...inherited,
    DATA_DIR: dataDir,
    EMBEDDINGS_MODE: 'none',
    CATALOG_ENABLED: 'false',
    MCP_RATE_LIMIT_MAX_TOKENS: '1000000',
    MCP_RATE_LIMIT_BURST_MAX_TOKENS: '1000000',
    MCP_RATE_LIMIT_REFILL_PER_SEC: '1000000',
  };
}

async function makeDataDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mu01-lock-'));
  DATA_DIRS.push(dir);
  return dir;
}

function lockPath(dataDir: string): string {
  return path.join(dataDir, SERVER_LOCK_FILENAME);
}

async function readLock(dataDir: string): Promise<ServerLockHolder> {
  return JSON.parse(await fs.readFile(lockPath(dataDir), 'utf8')) as ServerLockHolder;
}

async function waitFor<T>(what: string, probe: () => Promise<T | undefined>, timeoutMs = 15000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function tightWaitForLock(dataDir: string, timeoutMs = 15000): Promise<ServerLockHolder> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (fsSync.existsSync(lockPath(dataDir))) return readLock(dataDir);
    if (Date.now() > deadline) throw new Error('timed out waiting for the lock file');
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

async function waitForLock(dataDir: string): Promise<ServerLockHolder> {
  return waitFor('the lock file', async () => (fsSync.existsSync(lockPath(dataDir)) ? readLock(dataDir) : undefined));
}

const captured = new Map<ChildProcess, { stdout: string; stderr: string }>();

function capture(child: ChildProcess): ChildProcess {
  const buffer = { stdout: '', stderr: '' };
  captured.set(child, buffer);
  child.stdout?.on('data', (chunk) => { buffer.stdout += String(chunk); });
  child.stderr?.on('data', (chunk) => { buffer.stderr += String(chunk); });
  return child;
}

function spawnServer(dataDir: string): ChildProcess {
  return capture(spawnTrackedServer(['dist/index.js'], {
    cwd: ROOT,
    env: serverEnv(dataDir),
    stdio: ['pipe', 'pipe', 'pipe'],
  }));
}

function outputOf(child: ChildProcess): { stdout: string; stderr: string } {
  return captured.get(child) ?? { stdout: '', stderr: '' };
}

function waitForExit(child: ChildProcess, timeoutMs = 20000): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timer = setTimeout(() => reject(new Error('timed out waiting for the child to exit')), timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

const INITIALIZE_REQUEST = `${JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'mu01-lock-test', version: '0.0.0' },
  },
})}\n`;

/**
 * Readiness = the server answered MCP `initialize`. Polling the lock file is not
 * enough: the lock is created slightly BEFORE the SIGTERM handler is armed, so a
 * signal sent at "lock exists" can hit the default disposition and leave the file
 * behind (measured: 27/60 vs 0/40 with a ready server).
 */
async function waitForServerReady(child: ChildProcess, timeoutMs = 20000): Promise<void> {
  if (!child.stdin) throw new Error('server was spawned without a stdin pipe');
  child.stdin.write(INITIALIZE_REQUEST);
  await waitFor('the MCP initialize response', async () => {
    const answered = outputOf(child).stdout
      .split('\n')
      .some((line) => line.includes('"id":1') && line.includes('"result"'));
    return answered ? true : undefined;
  }, timeoutMs);
}

/**
 * Stop through the graceful path and prove it was graceful: a slow shutdown is
 * fine, a SIGKILL fallback or a missing exit is not. The old version delegated to
 * `terminateServer` (4 s grace, then SIGKILL) and then waited 15 s for the lock, so
 * under CPU pressure it silently measured shutdown speed instead of behaviour.
 */
async function stopGracefully(
  child: ChildProcess,
  timeoutMs = 30000,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const exited = waitForExit(child, timeoutMs).catch(() => {
    throw new Error(`server did not stop gracefully: no exit within ${timeoutMs} ms after SIGTERM`);
  });
  child.kill('SIGTERM');
  const exit = await exited;
  if (exit.signal === 'SIGKILL') {
    throw new Error('server did not stop gracefully: the process had to be killed with SIGKILL');
  }
  return exit;
}

async function expectLockRemoved(dataDir: string, context: string): Promise<void> {
  const present = await fs.access(lockPath(dataDir)).then(() => true, () => false);
  if (present) throw new Error(`${context}: the lock must be removed when the server stops gracefully`);
}

function writeLockSync(dataDir: string, holder: Partial<ServerLockHolder> & { token: string }): void {
  const full: ServerLockHolder = {
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: new Date().toISOString(),
    transport: 'test',
    version: '0.0.0',
    processIdentity: readProcessIdentity(process.pid),
    ...holder,
  };
  fsSync.writeFileSync(lockPath(dataDir), JSON.stringify(full, null, 2));
}

afterAll(async () => {
  await terminateTrackedServers();
  for (const dir of DATA_DIRS) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

describe('MU-01: single writer per DATA_DIR', () => {
  it('a) a second server process on the same DATA_DIR refuses to start', { timeout: 60000 }, async () => {
    const dataDir = await makeDataDir();
    const first = spawnServer(dataDir);
    const holder = await waitForLock(dataDir);
    expect(holder.pid).toBe(first.pid);

    const second = spawnServer(dataDir);
    const exit = await waitForExit(second);
    const { stderr } = outputOf(second);

    expect(exit.code).not.toBeNull();
    expect(exit.code).not.toBe(0);
    expect(stderr).toContain('SERVER_LOCK_HELD');
    expect(stderr).toContain(`pid ${first.pid}`);
    expect(stderr).toContain(lockPath(dataDir));

    await waitForServerReady(first);
    const firstExit = await stopGracefully(first);
    expect(firstExit.signal).toBe('SIGTERM');
    await expectLockRemoved(dataDir, 'graceful stop');
  });

  it('b) 20 simultaneous acquirers: exactly one wins', { timeout: 90000 }, async () => {
    const dataDir = await makeDataDir();
    const startFile = path.join(dataDir, 'start');
    const script = `
      import fs from 'node:fs';
      import { acquireServerLock } from './dist/storage-lock.js';
      fs.writeFileSync(process.env.READY_FILE, '1');
      const deadline = Date.now() + 20000;
      while (!fs.existsSync(process.env.START_FILE)) {
        if (Date.now() > deadline) process.exit(3);
        await new Promise((r) => setTimeout(r, 1));
      }
      try {
        const lock = await acquireServerLock({ dataDir: process.env.DATA_DIR, transport: 'race', version: '0.0.0' });
        process.stdout.write('WON\\n');
        await new Promise((r) => setTimeout(r, 500));
        await lock.release();
      } catch (error) {
        process.stdout.write('LOCKED:' + (error.code ?? 'UNKNOWN') + '\\n');
      }
    `;
    const contenders = Array.from({ length: 20 }, (_, index) => capture(spawnTrackedServer(
      ['--input-type=module', '-e', script],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          DATA_DIR: dataDir,
          START_FILE: startFile,
          READY_FILE: path.join(dataDir, `ready-${index}`),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )));

    // Release all contenders within the same tick: the claim must be atomic, not merely fast.
    await waitFor('20 ready contenders', async () => {
      const ready = (await fs.readdir(dataDir)).filter((name) => name.startsWith('ready-')).length;
      return ready === 20 ? true : undefined;
    });
    await fs.writeFile(startFile, 'go');

    const outputs = await Promise.all(contenders.map(async (child) => {
      await waitForExit(child);
      return outputOf(child).stdout;
    }));

    const won = outputs.filter((out) => out.includes('WON')).length;
    const locked = outputs.filter((out) => out.includes('LOCKED:')).length;
    expect(won).toBe(1);
    expect(locked).toBe(19);

    await expect(fs.access(lockPath(dataDir))).rejects.toThrow();
  });

  it('h) an uncaught exception still releases the lock', { timeout: 60000 }, async () => {
    const dataDir = await makeDataDir();
    const script = `
      import { acquireServerLock } from './dist/storage-lock.js';
      await acquireServerLock({ dataDir: process.env.DATA_DIR, transport: 'test', version: '0.0.0' });
      setTimeout(() => { throw new Error('boom'); }, 10);
    `;
    const child = capture(spawnTrackedServer(
      ['--input-type=module', '-e', script],
      { cwd: ROOT, env: { ...process.env, DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] },
    ));
    const exit = await waitForExit(child);
    expect(exit.code).not.toBe(0);
    await expect(fs.access(lockPath(dataDir))).rejects.toThrow();
  });

  it('c) kill -9 of the owner: the next start reclaims the stale lock', { timeout: 60000 }, async () => {
    const dataDir = await makeDataDir();
    const first = spawnServer(dataDir);
    const before = await waitForLock(dataDir);
    expect(before.pid).toBe(first.pid);

    first.kill('SIGKILL');
    await waitForExit(first);
    expect(isProcessAlive(before.pid)).toBe(false);
    await expect(fs.access(lockPath(dataDir))).resolves.toBeUndefined();

    const second = spawnServer(dataDir);
    const after = await waitFor('a reclaimed lock', async () => {
      const current = await readLock(dataDir);
      return current.pid === second.pid ? current : undefined;
    });
    expect(after.token).not.toBe(before.token);

    await waitForServerReady(second);
    const secondExit = await stopGracefully(second);
    expect(secondExit.signal).toBe('SIGTERM');
    await expectLockRemoved(dataDir, 'graceful stop');
  });

  it('d) a reused pid is not mistaken for a live holder', { timeout: 30000 }, async () => {
    const reusedPidDir = await makeDataDir();
    writeLockSync(reusedPidDir, { token: 'stale-token', processIdentity: 'boot:1' });
    const lock = await acquireServerLock({ dataDir: reusedPidDir, transport: 'test', version: '0.0.0' });
    expect(lock.holder.token).not.toBe('stale-token');
    await lock.release();

    const unknownPidDir = await makeDataDir();
    writeLockSync(unknownPidDir, { token: 'stale-token', processIdentity: null });
    await expect(acquireServerLock({ dataDir: unknownPidDir, transport: 'test', version: '0.0.0' }))
      .rejects.toMatchObject({ code: 'SERVER_LOCK_HELD' });

    const samePidDir = await makeDataDir();
    writeLockSync(samePidDir, { token: 'live-token' });
    await expect(acquireServerLock({ dataDir: samePidDir, transport: 'test', version: '0.0.0' }))
      .rejects.toBeInstanceOf(ServerLockError);

    // Off Linux there is no process start time, so a dead pid may have been reused:
    // the owner's decision is to never reclaim automatically, only to explain.
    const noIdentitySupportDir = await makeDataDir();
    writeLockSync(noIdentitySupportDir, { token: 'unverifiable-token', pid: 2147483646, processIdentity: null });
    await expect(acquireServerLock({
      dataDir: noIdentitySupportDir,
      transport: 'test',
      version: '0.0.0',
      identitySupported: false,
    })).rejects.toMatchObject({ code: 'SERVER_LOCK_UNVERIFIABLE' });
    expect((await readLock(noIdentitySupportDir)).token).toBe('unverifiable-token');
  });

  it('e) a graceful stop removes the lock', { timeout: 120000 }, async () => {
    const dataDir = await makeDataDir();
    const server = spawnServer(dataDir);
    await waitForLock(dataDir);
    await waitForServerReady(server);

    const exit = await stopGracefully(server);
    expect(exit.signal).toBe('SIGTERM');
    await expectLockRemoved(dataDir, 'graceful stop');
  });

  it('j) SIGTERM in the lock-creation window still releases the lock', { timeout: 180000 }, async () => {
    const iterations = 20;
    for (let i = 0; i < iterations; i++) {
      const dataDir = await makeDataDir();
      const child = spawnServer(dataDir);
      // Densest possible observation of "the lock file now exists" — no timers.
      await tightWaitForLock(dataDir);
      child.kill('SIGTERM');
      const exit = await waitForExit(child, 20000);

      expect(exit.signal, `iteration ${i + 1}/${iterations}: the server must exit via the signal handler`).toBe('SIGTERM');
      await expectLockRemoved(dataDir, `iteration ${i + 1}/${iterations}: SIGTERM during startup`);
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });

  it('f) a lock from another hostname is never removed automatically', { timeout: 30000 }, async () => {
    const dataDir = await makeDataDir();
    writeLockSync(dataDir, { token: 'remote-token', hostname: 'another-host' });

    await expect(acquireServerLock({ dataDir, transport: 'test', version: '0.0.0' }))
      .rejects.toMatchObject({ code: 'SERVER_LOCK_FOREIGN_HOST' });

    const after = await readLock(dataDir);
    expect(after.token).toBe('remote-token');
    expect(after.hostname).toBe('another-host');
  });

  it('g) the lost-update probe no longer loses writes', { timeout: 120000 }, async () => {
    const dataDir = await makeDataDir();
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['dist/index.js'],
      cwd: ROOT,
      env: { ...serverEnv(dataDir) },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'mu01-probe', version: '0.0.1' });
    await client.connect(transport);

    const call = async (name: string, args: Record<string, unknown>) => {
      const res = await client.callTool({ name, arguments: args });
      const text = (res.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? '';
      const env = JSON.parse(text) as { ok: boolean; data?: Record<string, unknown>; error?: { message: string } };
      if (res.isError || !env.ok) throw new Error(`${name}: ${env.error?.message ?? text}`);
      return env;
    };

    try {
      const created = await call('tasks_create', { project: 'mcp', title: 'MU-01 probe' });
      const id = String(created.data?.id);
      const taskFile = path.join(dataDir, 'tasks', 'mcp', `${id}.json`);

      const second = spawnServer(dataDir);
      const exit = await waitForExit(second);
      const { stderr } = outputOf(second);
      expect(exit.code).not.toBe(0);
      expect(stderr).toContain('SERVER_LOCK_HELD');

      const holder = await readLock(dataDir);
      expect(holder.pid).toBe(transport.pid);
      expect(holder.pid).not.toBe(second.pid);

      let mismatches = 0;
      const priorities = ['high', 'medium', 'low'];
      for (let i = 1; i <= 40; i++) {
        const priority = priorities[i % priorities.length];
        await call('tasks_update', { project: 'mcp', id, description: `A${i}` });
        await call('tasks_update', { project: 'mcp', id, priority });
        const onDisk = JSON.parse(await fs.readFile(taskFile, 'utf8')) as { description?: string; priority?: string };
        if (onDisk.description !== `A${i}` || onDisk.priority !== priority) mismatches++;
      }
      expect(mismatches).toBe(0);
    } finally {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
    }
  });
});

describe('MU-01: lock primitives', () => {
  it('treats EPERM as alive and rejects impossible pids', () => {
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(1.5)).toBe(false);
    expect(isProcessAlive(2147483646)).toBe(false);
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
    });
    expect(isProcessAlive(123)).toBe(true);
    kill.mockRestore();
  });

  it('describes this process identity and returns null for a missing one', () => {
    expect(readProcessIdentity(process.pid)).toMatch(/^\d+:\d+$/);
    expect(readProcessIdentity(2147483646)).toBeNull();
  });

  it('retries when the lock disappears between the claim and the read', async () => {
    const dataDir = await makeDataDir();
    const link = vi.spyOn(fs, 'link').mockRejectedValueOnce(
      Object.assign(new Error('exists'), { code: 'EEXIST' }),
    );
    const lock = await acquireServerLock({ dataDir, transport: 'test', version: '0.0.0' });
    link.mockRestore();
    expect(lock.holder.pid).toBe(process.pid);
    await lock.release();
  });

  it('falls back to wx where hard links are unsupported', async () => {
    const dataDir = await makeDataDir();
    const link = vi.spyOn(fs, 'link').mockRejectedValue(
      Object.assign(new Error('not supported'), { code: 'EPERM' }),
    );
    const lock = await acquireServerLock({ dataDir, transport: 'test', version: '0.0.0' });
    link.mockRestore();
    expect((await readLock(dataDir)).token).toBe(lock.holder.token);
    await lock.release();
  });

  it('reports a held lock instead of crashing when wx hits an existing file', async () => {
    const dataDir = await makeDataDir();
    writeLockSync(dataDir, { token: 'existing-token' });
    const link = vi.spyOn(fs, 'link').mockRejectedValue(
      Object.assign(new Error('not supported'), { code: 'EPERM' }),
    );
    await expect(acquireServerLock({ dataDir, transport: 'test', version: '0.0.0' }))
      .rejects.toMatchObject({ code: 'SERVER_LOCK_HELD' });
    link.mockRestore();
    expect((await readLock(dataDir)).token).toBe('existing-token');
  });

  it('propagates an unexpected link error', async () => {
    const dataDir = await makeDataDir();
    const link = vi.spyOn(fs, 'link').mockRejectedValueOnce(
      Object.assign(new Error('permission denied'), { code: 'EACCES' }),
    );
    await expect(acquireServerLock({ dataDir, transport: 'test', version: '0.0.0' }))
      .rejects.toThrow('permission denied');
    link.mockRestore();
  });

  it('refuses while an unparsable lock is inside the grace period', async () => {
    const dataDir = await makeDataDir();
    await fs.writeFile(lockPath(dataDir), 'not json', 'utf8');
    await expect(acquireServerLock({ dataDir, transport: 'test', version: '0.0.0' }))
      .rejects.toMatchObject({ code: 'SERVER_LOCK_UNREADABLE' });
    expect(await fs.readFile(lockPath(dataDir), 'utf8')).toBe('not json');
  });

  it('reclaims a truncated lock once the grace period has passed', async () => {
    const dataDir = await makeDataDir();
    await fs.writeFile(lockPath(dataDir), 'not json', 'utf8');
    const old = new Date(Date.now() - 120_000);
    await fs.utimes(lockPath(dataDir), old, old);
    const lock = await acquireServerLock({ dataDir, transport: 'test', version: '0.0.0' });
    await lock.release();
  });

  it('never reclaims an unparsable lock where pid reuse cannot be ruled out', async () => {
    const dataDir = await makeDataDir();
    await fs.writeFile(lockPath(dataDir), 'not json', 'utf8');
    const old = new Date(Date.now() - 120_000);
    await fs.utimes(lockPath(dataDir), old, old);
    await expect(acquireServerLock({
      dataDir,
      transport: 'test',
      version: '0.0.0',
      identitySupported: false,
    })).rejects.toMatchObject({ code: 'SERVER_LOCK_UNVERIFIABLE' });
  });

  it('removes an abandoned reclaim guard left by a dead reclaimer', async () => {
    const dataDir = await makeDataDir();
    writeLockSync(dataDir, { token: 'stale-token', pid: 2147483646, processIdentity: 'boot:1' });
    fsSync.writeFileSync(
      `${lockPath(dataDir)}.reclaim`,
      JSON.stringify({
        pid: 2147483646,
        hostname: os.hostname(),
        startedAt: new Date().toISOString(),
        transport: 'reclaim',
        version: '0',
        token: 'dead-guard',
        processIdentity: 'boot:1',
      }),
    );

    const lock = await acquireServerLock({ dataDir, transport: 'test', version: '0.0.0' });
    expect(lock.holder.pid).toBe(process.pid);
    expect(fsSync.existsSync(`${lockPath(dataDir)}.reclaim`)).toBe(false);
    await lock.release();
  });

  it('is re-entrant per process and drops the file on release', async () => {
    const dataDir = await makeDataDir();
    const first = await acquireServerLock({ dataDir, transport: 'test', version: '0.0.0' });
    expect(await acquireServerLock({ dataDir, transport: 'test', version: '0.0.0' })).toBe(first);

    await first.release();
    await first.release();
    await expect(fs.access(lockPath(dataDir))).rejects.toThrow();

    const second = await acquireServerLock({ dataDir, transport: 'test', version: '0.0.0' });
    expect(second.holder.token).not.toBe(first.holder.token);
    second.releaseSync();
    second.releaseSync();
    await expect(fs.access(lockPath(dataDir))).rejects.toThrow();
  });

  it('release keeps a lock that a successor already took over', async () => {
    const dataDir = await makeDataDir();
    const lock = await acquireServerLock({ dataDir, transport: 'test', version: '0.0.0' });
    writeLockSync(dataDir, { token: 'successor-token' });
    await lock.release();
    expect((await readLock(dataDir)).token).toBe('successor-token');
    await fs.rm(lockPath(dataDir), { force: true });
  });

  it('releaseSync keeps a lock that a successor already took over', async () => {
    const dataDir = await makeDataDir();
    const lock = await acquireServerLock({ dataDir, transport: 'test', version: '0.0.0' });
    writeLockSync(dataDir, { token: 'successor-token' });
    lock.releaseSync();
    expect((await readLock(dataDir)).token).toBe('successor-token');
    await fs.rm(lockPath(dataDir), { force: true });
  });

  it('backs off while another process holds the reclaim guard', async () => {
    const dataDir = await makeDataDir();
    writeLockSync(dataDir, { token: 'stale-token', pid: 2147483646, processIdentity: 'boot:1' });
    fsSync.writeFileSync(
      `${lockPath(dataDir)}.reclaim`,
      JSON.stringify({
        pid: process.pid,
        hostname: os.hostname(),
        startedAt: new Date().toISOString(),
        transport: 'reclaim',
        version: '0',
        token: 'guard-token',
        processIdentity: readProcessIdentity(process.pid),
      }),
    );
    await expect(acquireServerLock({ dataDir, transport: 'test', version: '0.0.0' }))
      .rejects.toMatchObject({ code: 'SERVER_LOCK_HELD' });
  });

  it('takes the version from the environment, then from package.json, then falls back', async () => {
    const dataDir = await makeDataDir();
    const previous = process.env.npm_package_version;
    try {
      process.env.npm_package_version = '9.9.9-test';
      const fromEnv = await acquireServerLock({ dataDir, transport: 'test', version: '' });
      expect(fromEnv.holder.version).toBe('9.9.9-test');
      await fromEnv.release();

      delete process.env.npm_package_version;
      const fromPackage = await acquireServerLock({ dataDir, transport: 'test', version: '' });
      expect(fromPackage.holder.version).toMatch(/^\d+\.\d+\.\d+/);
      await fromPackage.release();

      const read = vi.spyOn(fs, 'readFile').mockRejectedValueOnce(new Error('no package.json'));
      const fallback = await acquireServerLock({ dataDir, transport: 'test', version: '' });
      read.mockRestore();
      expect(fallback.holder.version).toBe('0.0.0');
      await fallback.release();
    } finally {
      if (previous === undefined) delete process.env.npm_package_version;
      else process.env.npm_package_version = previous;
    }
  });

  it('arms the signal release before the claim and removes it on release', async () => {
    const dataDir = await makeDataDir();
    const before = process.listenerCount('SIGTERM');
    const lock = await acquireServerLock({
      dataDir,
      transport: 'test',
      version: '0.0.0',
      releaseOnSignal: true,
    });
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);
    expect(process.listenerCount('SIGINT')).toBeGreaterThan(0);

    await lock.release();
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });

  it('removes the signal release when the claim fails', async () => {
    const dataDir = await makeDataDir();
    writeLockSync(dataDir, { token: 'live-token' });
    const before = process.listenerCount('SIGTERM');
    await expect(acquireServerLock({
      dataDir,
      transport: 'test',
      version: '0.0.0',
      releaseOnSignal: true,
    })).rejects.toMatchObject({ code: 'SERVER_LOCK_HELD' });
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });

  it('does not add a second signal release on a re-entrant acquire', async () => {
    const dataDir = await makeDataDir();
    const first = await acquireServerLock({
      dataDir,
      transport: 'test',
      version: '0.0.0',
      releaseOnSignal: true,
    });
    const withHandler = process.listenerCount('SIGTERM');
    const second = await acquireServerLock({
      dataDir,
      transport: 'test',
      version: '0.0.0',
      releaseOnSignal: true,
    });
    expect(second).toBe(first);
    expect(process.listenerCount('SIGTERM')).toBe(withHandler);
    await first.release();
  });

  it('skips the lock only in proxy mode', () => {
    expect(shouldAcquireServerLock(['node', 'dist/index.js'], {})).toBe(true);
    expect(shouldAcquireServerLock(['node', 'dist/index.js', '--proxy-upstream'], {})).toBe(false);
    expect(shouldAcquireServerLock(['node', 'dist/index.js'], { MCP_PROXY_UPSTREAM: 'http://core' })).toBe(false);
    expect(shouldAcquireServerLock(['node', 'dist/index.js'], { MCP_PROXY_UPSTREAM: '   ' })).toBe(true);
  });
});
