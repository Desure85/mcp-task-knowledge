/**
 * tests/support/server-process.ts — shared lifecycle helpers for suites that
 * spawn the compiled server (`node dist/index.js`).
 *
 * Two failure modes used to leak long-lived orphan servers:
 *   1. a test timed out while `client.connect()` was still pending, so the
 *      `finally` that closed the transport was never reached;
 *   2. `child.kill('SIGTERM')` was fired without waiting for the exit, so a
 *      slow/late shutdown left the process behind.
 *
 * Every spawn in tests should go through `spawnTrackedServer()` (or
 * `trackServer()` for clients that spawn internally) and every teardown path
 * through `terminateServer()`, which waits for the exit and escalates to
 * SIGKILL after a grace period. The orphan guard
 * (`tests/support/orphan-guard.ts`) additionally fails the run if anything
 * still survives.
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const liveChildren = new Set<ChildProcess>();

/** Register a child so process-level safety nets can SIGKILL it on exit. */
export function trackServer<T extends ChildProcess>(child: T): T {
  liveChildren.add(child);
  child.once('exit', () => liveChildren.delete(child));
  return child;
}

/** Spawn `node <args>` and register the child in the live set. */
export function spawnTrackedServer(args: string[], options: SpawnOptions): ChildProcess {
  return trackServer(spawn('node', args, options));
}

/** Reserve an ephemeral port from the OS so parallel servers never collide. */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        if (port <= 0) reject(new Error('could not reserve a free port'));
        else resolve(port);
      });
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/**
 * Terminate a server child deterministically: SIGTERM, wait up to `graceMs`
 * for the exit event, then SIGKILL and wait up to 2s more. Idempotent.
 */
export async function terminateServer(
  child: ChildProcess | null | undefined,
  graceMs = 4000,
): Promise<void> {
  if (!child) return;
  liveChildren.delete(child);
  if (hasExited(child) || child.pid === undefined) return;

  const exited = new Promise<boolean>((resolve) => {
    if (hasExited(child)) resolve(true);
    else child.once('exit', () => resolve(true));
  });

  try {
    child.kill('SIGTERM');
  } catch {
    /* already gone */
  }

  const timedOut = await Promise.race([exited.then(() => false), delay(graceMs).then(() => true)]);
  if (!timedOut) return;

  try {
    child.kill('SIGKILL');
  } catch {
    /* already gone */
  }
  await Promise.race([exited, delay(2000)]);
}

/** Terminate every child still registered as live (use in afterAll). */
export async function terminateTrackedServers(): Promise<void> {
  for (const child of [...liveChildren]) {
    await terminateServer(child);
  }
}

/** Synchronous last-resort cleanup for process exit handlers. */
export function killTrackedServersSync(): void {
  for (const child of liveChildren) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
  liveChildren.clear();
}

process.once('exit', killTrackedServersSync);

export interface ServerProcess {
  pid: number;
  ppid: number;
  cwd: string;
  ports: number[];
}

function readListeningPortsByInode(): Map<string, number> {
  const inodes = new Map<string, number>();
  for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let raw: string;
    try {
      raw = fs.readFileSync(table, 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n').slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 10) continue;
      if (fields[3] !== '0A') continue; // TCP_LISTEN only
      const local = fields[1];
      const colon = local.lastIndexOf(':');
      if (colon < 0) continue;
      const port = Number.parseInt(local.slice(colon + 1), 16);
      if (Number.isFinite(port)) inodes.set(fields[9], port);
    }
  }
  return inodes;
}

function portsOf(pid: number, byInode: Map<string, number>): number[] {
  const ports = new Set<number>();
  let fds: string[];
  try {
    fds = fs.readdirSync(`/proc/${pid}/fd`);
  } catch {
    return [];
  }
  for (const fd of fds) {
    let target: string;
    try {
      target = fs.readlinkSync(`/proc/${pid}/fd/${fd}`);
    } catch {
      continue;
    }
    const match = /^socket:\[(\d+)\]$/.exec(target);
    if (!match) continue;
    const port = byInode.get(match[1]);
    if (port !== undefined) ports.add(port);
  }
  return [...ports].sort((a, b) => a - b);
}

function isServerProcess(pid: number): boolean {
  let argv: string[];
  try {
    argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
  } catch {
    return false;
  }
  if (argv.length === 0) return false;
  // `argv[0]` is already resolved to an absolute path in /proc/<pid>/cmdline.
  if (!/^node(js)?(\.exe)?$/i.test(path.basename(argv[0]))) return false;
  return argv.some((arg) => /(^|[/\\])dist[/\\]index\.js$/.test(arg));
}

function listServersViaProc(root: string): ServerProcess[] {
  const byInode = readListeningPortsByInode();
  const found: ServerProcess[] = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === process.pid) continue;
    if (!isServerProcess(pid)) continue;
    let cwd: string;
    try {
      cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      continue;
    }
    if (cwd !== root) continue;
    let ppid = 0;
    try {
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      const match = /^PPid:\s+(\d+)$/m.exec(status);
      if (match) ppid = Number(match[1]);
    } catch {
      /* keep 0 */
    }
    found.push({ pid, ppid, cwd, ports: portsOf(pid, byInode) });
  }
  return found;
}

/**
 * Process discovery is Linux-first (CI and the owner's machines are Linux).
 * On other platforms return an empty list rather than failing the run.
 */
export function listServerProcesses(root: string = process.cwd()): ServerProcess[] {
  if (!fs.existsSync('/proc/self/cwd')) return [];
  try {
    return listServersViaProc(root);
  } catch {
    return [];
  }
}
