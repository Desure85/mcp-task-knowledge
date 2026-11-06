/**
 * MU-01: single-writer guard for `DATA_DIR` (`.server.lock`).
 *
 * `withFileLock` (fs.ts) only serializes writers inside ONE process. Two
 * servers on the same DATA_DIR each hold their own in-memory map, so their
 * read-modify-write cycles interleave and the later write silently drops the
 * earlier change (reproduced: 56/60 lost updates on the pre-MU-01 code).
 *
 * This module makes the ownership exclusive across processes:
 *
 *   - the lock file appears atomically WITH its payload (`tmp` + `fs.link`,
 *     the Q-016 idiom from `scripts/lib/devcycle-state.mjs`): a contender sees
 *     either no file (and may win) or a complete payload (and backs off).
 *     Filesystems without hard links fall back to `wx`.
 *   - the holder is identified by a random `token`, not by pid: release and
 *     reclaim only remove a file that still carries OUR token, so a process
 *     that lost a race can never delete the successor's lock.
 *   - a lock is stale when the holder process is gone (`kill(pid,0)`; EPERM
 *     means alive), or when the pid was reused. Pid reuse is detected by
 *     comparing the process start time from `/proc/<pid>/stat` (field 22)
 *     together with `btime` from `/proc/stat`. Both are stored as one opaque
 *     string; they are never converted back into a wall-clock date.
 *   - a lock written by another hostname (shared/network filesystem) is never
 *     removed automatically — we cannot prove that process is dead.
 *   - a lock file that cannot be parsed is left alone for a grace period and
 *     then reclaimed with a warning: a crash mid-write must not brick the
 *     directory forever.
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { childLogger } from './core/logger.js';

const log = childLogger('storage-lock');

/** Lock file name inside DATA_DIR. */
export const SERVER_LOCK_FILENAME = '.server.lock';

/** Suffix of the short-lived file that serializes reclaim of a stale lock. */
const RECLAIM_SUFFIX = '.reclaim';

/** An unparsable lock older than this is treated as a crashed write. */
const UNREADABLE_GRACE_MS = 60_000;

const MAX_ACQUIRE_ATTEMPTS = 5;
const RETRY_DELAY_MS = 50;

/** Error codes meaning "this filesystem cannot create hard links". */
const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOSYS', 'EOPNOTSUPP', 'ENOTSUP', 'EXDEV', 'EMLINK']);

/** Stable machine-readable failure codes. */
export type ServerLockErrorCode =
  | 'SERVER_LOCK_HELD'
  | 'SERVER_LOCK_FOREIGN_HOST'
  | 'SERVER_LOCK_UNREADABLE'
  | 'SERVER_LOCK_UNVERIFIABLE';

/** Payload written into `DATA_DIR/.server.lock`. */
export interface ServerLockHolder {
  pid: number;
  hostname: string;
  /** Process start time (ISO 8601), not the moment the lock was taken. */
  startedAt: string;
  transport: string;
  version: string;
  /** Random ownership token — the only thing release/reclaim may match on. */
  token: string;
  /**
   * Opaque process identity (`<btime>:<starttime>`), used to tell a live
   * holder from a reused pid. null when the platform has no /proc.
   */
  processIdentity: string | null;
}

/** Thrown when this process must not write to DATA_DIR. */
export class ServerLockError extends Error {
  readonly code: ServerLockErrorCode;
  readonly lockPath: string;
  readonly holder: ServerLockHolder | null;
  /** Process exit code for the CLI entry point. */
  readonly exitCode = 1;

  constructor(
    code: ServerLockErrorCode,
    message: string,
    lockPath: string,
    holder: ServerLockHolder | null = null,
  ) {
    super(message);
    this.name = 'ServerLockError';
    this.code = code;
    this.lockPath = lockPath;
    this.holder = holder;
  }
}

/** Handle returned by {@link acquireServerLock}. */
export interface ServerLockHandle {
  readonly path: string;
  readonly holder: ServerLockHolder;
  /** Async release, idempotent, token-checked. */
  release(): Promise<void>;
  /** Synchronous release for `process.on('exit')`. */
  releaseSync(): void;
}

export interface AcquireServerLockOptions {
  dataDir: string;
  transport: string;
  version: string;
  /** Defaults to `os.hostname()`. */
  hostname?: string;
  /** Defaults to `process.pid`. Overridden in tests. */
  pid?: number;
  /** Defaults to "does /proc/self/stat exist". Overridden in tests. */
  identitySupported?: boolean;
  /**
   * Remove the lock from a SIGINT/SIGTERM handler. Registered BEFORE the file is
   * created, so a signal that arrives while the lock is being claimed cannot kill
   * the process with the default disposition and leave the file behind.
   */
  releaseOnSignal?: boolean;
}

// ─── Platform helpers ────────────────────────────────────────────────

/** Whether a pid is alive; EPERM means the process exists but is owned by someone else. */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const PROCESS_IDENTITY_SUPPORTED = (() => {
  try {
    return fsSync.existsSync('/proc/self/stat');
  } catch {
    return false;
  }
})();

let cachedBootTime: string | null | undefined;

function readBootTime(): string | null {
  if (cachedBootTime !== undefined) return cachedBootTime;
  try {
    const stat = fsSync.readFileSync('/proc/stat', 'utf8');
    const line = stat.split('\n').find((l) => l.startsWith('btime '));
    cachedBootTime = line ? line.slice('btime '.length).trim() : null;
  } catch {
    cachedBootTime = null;
  }
  return cachedBootTime;
}

/**
 * Opaque identity of a running process: boot time + start time in clock ticks.
 * Equal strings mean "the same process instance"; a different string on a live
 * pid means the pid was reused. Returns null where /proc is unavailable.
 */
export function readProcessIdentity(pid: number): string | null {
  try {
    const stat = fsSync.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // comm (field 2) may contain spaces and parentheses; fields resume after
    // the LAST ')'. After that, field 3 (state) is index 0, so field 22
    // (starttime) is index 19.
    const close = stat.lastIndexOf(')');
    if (close < 0) return null;
    const fields = stat.slice(close + 2).split(' ');
    const starttime = fields[19];
    if (!starttime) return null;
    const btime = readBootTime();
    if (btime === null) return null;
    return `${btime}:${starttime}`;
  } catch {
    return null;
  }
}

// ─── Lock file primitives ────────────────────────────────────────────

export function serverLockPath(dataDir: string): string {
  return path.join(dataDir, SERVER_LOCK_FILENAME);
}

interface LockSnapshot {
  exists: boolean;
  holder: ServerLockHolder | null;
  mtimeMs: number | null;
}

function isServerLockHolder(value: unknown): value is ServerLockHolder {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.pid === 'number'
    && Number.isInteger(v.pid)
    && typeof v.hostname === 'string'
    && typeof v.startedAt === 'string'
    && typeof v.transport === 'string'
    && typeof v.version === 'string'
    && typeof v.token === 'string'
    && v.token.length > 0
  );
}

/** Read content + mtime from ONE handle so a replacement in flight cannot mix generations. */
async function readLockSnapshot(file: string): Promise<LockSnapshot> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(file, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false, holder: null, mtimeMs: null };
    }
    throw error;
  }
  try {
    const [stat, raw] = await Promise.all([handle.stat(), handle.readFile('utf8')]);
    let holder: ServerLockHolder | null = null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isServerLockHolder(parsed)) holder = parsed;
    } catch {
      // Unparsable payload: classifyLock decides by age.
    }
    return { exists: true, holder, mtimeMs: stat.mtimeMs };
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * Create a file atomically WITH its content.
 * `fs.link` makes the directory entry appear already pointing at a complete
 * inode, so a contender never observes "file exists, content missing".
 *
 * @returns true when this call created the file
 */
async function createFileExclusive(file: string, payload: string): Promise<boolean> {
  const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.writeFile(tmp, payload, 'utf8');
    try {
      await fs.link(tmp, file);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      if (!LINK_UNSUPPORTED.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
      // No hard links on this filesystem: exclusive create, then content.
      // A reader may see the empty inode for a moment; classifyLock keeps a
      // fresh unparsable lock (grace period), so nobody reclaims that window.
      try {
        await fs.writeFile(file, payload, { encoding: 'utf8', flag: 'wx' });
        return true;
      } catch (fallbackError) {
        if ((fallbackError as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw fallbackError;
      }
    }
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

/** Remove a file only while it still carries OUR token. */
async function removeIfOwned(file: string, token: string): Promise<boolean> {
  const snapshot = await readLockSnapshot(file);
  if (!snapshot.exists || snapshot.holder?.token !== token) return false;
  await fs.rm(file, { force: true });
  return true;
}

function removeIfOwnedSync(file: string, token: string): boolean {
  try {
    const raw = fsSync.readFileSync(file, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isServerLockHolder(parsed) || parsed.token !== token) return false;
    fsSync.rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

// ─── Classification ──────────────────────────────────────────────────

type LockState = 'held' | 'stale' | 'foreign' | 'unreadable' | 'unverifiable' | 'gone';

interface Classification {
  state: LockState;
  reason: string;
  holder: ServerLockHolder | null;
}

function classifyLock(
  snapshot: LockSnapshot,
  hostname: string,
  now: number,
  identitySupported: boolean,
): Classification {
  if (!snapshot.exists) {
    return { state: 'gone', reason: 'no lock file', holder: null };
  }
  if (!snapshot.holder) {
    const ageMs = Math.max(0, now - (snapshot.mtimeMs ?? now));
    if (ageMs <= UNREADABLE_GRACE_MS) {
      return { state: 'unreadable', reason: 'unparsable lock inside grace period', holder: null };
    }
    if (!identitySupported) {
      return { state: 'unverifiable', reason: 'stale-detection is unavailable on this platform', holder: null };
    }
    return { state: 'stale', reason: 'unparsable lock older than grace period', holder: null };
  }
  const holder = snapshot.holder;
  if (holder.hostname !== hostname) {
    return { state: 'foreign', reason: `lock held by another host (${holder.hostname})`, holder };
  }
  if (!isProcessAlive(holder.pid)) {
    if (!identitySupported) {
      return { state: 'unverifiable', reason: `holder process ${holder.pid} is gone, but pid reuse cannot be ruled out here`, holder };
    }
    return { state: 'stale', reason: `holder process ${holder.pid} is gone`, holder };
  }
  const recorded = holder.processIdentity ?? null;
  const live = readProcessIdentity(holder.pid);
  if (recorded && live && recorded !== live) {
    return { state: 'stale', reason: `pid ${holder.pid} was reused by another process`, holder };
  }
  return { state: 'held', reason: `holder process ${holder.pid} is alive`, holder };
}

function describeHolder(holder: ServerLockHolder | null, lockPath: string): string {
  if (!holder) {
    return `lock file ${lockPath} exists but its owner is unknown. `
      + `If no server is running, delete it and start again.`;
  }
  return `DATA_DIR is already owned by another server process `
    + `(pid ${holder.pid}, host ${holder.hostname}, started ${holder.startedAt}, `
    + `transport ${holder.transport}, version ${holder.version}).`
    + `\nOnly one server process may write to a DATA_DIR. Stop that process first, `
    + `or connect an additional client through the stdio bridge instead of starting a second server.`
    + `\nIf you are sure no server is running, delete ${lockPath} and start again.`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Remove a lock that was classified stale. Serialized with a guard file so two
 * contenders cannot both reclaim; inside the guard the lock is classified again
 * and only removed when still stale, so a fresh lock created meanwhile survives.
 */
async function reclaimStaleLock(lockPath: string, hostname: string, identitySupported: boolean): Promise<void> {
  const guardPath = `${lockPath}${RECLAIM_SUFFIX}`;
  const guardToken = randomUUID();
  const guardPayload = JSON.stringify({
    pid: process.pid,
    hostname,
    startedAt: new Date().toISOString(),
    transport: 'reclaim',
    version: '0',
    token: guardToken,
    processIdentity: readProcessIdentity(process.pid),
  });

  const won = await createFileExclusive(guardPath, guardPayload);
  if (!won) {
    const guard = await readLockSnapshot(guardPath);
    const verdict = classifyLock(guard, hostname, Date.now(), identitySupported);
    if (verdict.state === 'stale' && guard.holder) {
      await removeIfOwned(guardPath, guard.holder.token);
    }
    // Somebody else is reclaiming right now — back off and retry the acquire loop.
    await delay(RETRY_DELAY_MS);
    return;
  }

  try {
    const current = await readLockSnapshot(lockPath);
    const verdict = classifyLock(current, hostname, Date.now(), identitySupported);
    if (verdict.state !== 'stale') return;
    await fs.rm(lockPath, { force: true });
    log.warn(
      { lockPath, reclaimedPid: verdict.holder?.pid ?? null, reason: verdict.reason },
      'reclaimed stale DATA_DIR lock',
    );
  } finally {
    await removeIfOwned(guardPath, guardToken);
  }
}

// ─── Acquire / release ───────────────────────────────────────────────

/**
 * Release the lock on SIGINT/SIGTERM. Installed BEFORE the claim, so the window
 * between "lock visible on disk" and "signal release armed" does not exist: the
 * handler removes the file only when it still carries OUR token (the claim may not
 * have reached fs.link yet — then there is nothing to remove), then re-raises the
 * signal so the exit status stays 128+signal.
 *
 * @returns uninstall function; must be called on release or failed acquire
 */
function installSignalRelease(lockPath: string, token: string): () => void {
  const removers: Array<() => void> = [];
  const uninstall = (): void => {
    while (removers.length > 0) removers.pop()?.();
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const handler = (): void => {
      removeIfOwnedSync(lockPath, token);
      uninstall();
      process.kill(process.pid, signal);
    };
    process.on(signal, handler);
    removers.push(() => process.removeListener(signal, handler));
  }
  return uninstall;
}

/** Handles already held by THIS process, keyed by resolved lock path (re-entrant within one process). */
const activeLocks = new Map<string, ServerLockHandle>();

/**
 * Read the server version for the lock payload without a hard dependency on
 * the config module (which throws when DATA_DIR is unset).
 */
async function resolveVersion(): Promise<string> {
  const fromEnv = process.env.npm_package_version;
  if (fromEnv) return fromEnv;
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    // src/storage-lock.ts -> repo root; dist/storage-lock.js -> repo root.
    const raw = await fs.readFile(path.join(here, '..', 'package.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const version = (parsed as { version?: unknown }).version;
    return typeof version === 'string' ? version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function makeHandle(
  lockPath: string,
  holder: ServerLockHolder,
  uninstallSignalRelease: () => void,
): ServerLockHandle {
  let released = false;
  const onExit = () => {
    if (!released) removeIfOwnedSync(lockPath, holder.token);
  };

  const handle: ServerLockHandle = {
    path: lockPath,
    holder,
    async release() {
      if (released) return;
      released = true;
      process.removeListener('exit', onExit);
      activeLocks.delete(lockPath);
      uninstallSignalRelease();
      await removeIfOwned(lockPath, holder.token);
    },
    releaseSync() {
      if (released) return;
      released = true;
      process.removeListener('exit', onExit);
      activeLocks.delete(lockPath);
      uninstallSignalRelease();
      removeIfOwnedSync(lockPath, holder.token);
    },
  };

  process.on('exit', onExit);
  return handle;
}

/**
 * Take the single-writer lock for `dataDir` or throw {@link ServerLockError}.
 * Re-entrant: a second call in the same process for the same directory returns
 * the already held handle.
 */
export async function acquireServerLock(options: AcquireServerLockOptions): Promise<ServerLockHandle> {
  const lockPath = serverLockPath(options.dataDir);
  const existing = activeLocks.get(lockPath);
  if (existing) return existing;

  const hostname = options.hostname ?? os.hostname();
  const pid = options.pid ?? process.pid;
  const identitySupported = options.identitySupported ?? PROCESS_IDENTITY_SUPPORTED;
  const version = options.version || (await resolveVersion());
  const holder: ServerLockHolder = {
    pid,
    hostname,
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    transport: options.transport,
    version,
    token: randomUUID(),
    processIdentity: identitySupported ? readProcessIdentity(pid) : null,
  };
  const payload = `${JSON.stringify(holder, null, 2)}\n`;
  const uninstallSignalRelease = options.releaseOnSignal
    ? installSignalRelease(lockPath, holder.token)
    : () => {};
  let acquired = false;

  try {
    await fs.mkdir(options.dataDir, { recursive: true });

    for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt++) {
      if (await createFileExclusive(lockPath, payload)) {
        acquired = true;
        const handle = makeHandle(lockPath, holder, uninstallSignalRelease);
        activeLocks.set(lockPath, handle);
        log.debug({ lockPath, pid }, 'DATA_DIR lock acquired');
        return handle;
      }

      const snapshot = await readLockSnapshot(lockPath);
      const verdict = classifyLock(snapshot, hostname, Date.now(), identitySupported);

      switch (verdict.state) {
        case 'gone':
          continue;
        case 'stale':
          await reclaimStaleLock(lockPath, hostname, identitySupported);
          continue;
        case 'held':
          throw new ServerLockError('SERVER_LOCK_HELD', describeHolder(verdict.holder, lockPath), lockPath, verdict.holder);
        case 'foreign':
          throw new ServerLockError(
            'SERVER_LOCK_FOREIGN_HOST',
            `${describeHolder(verdict.holder, lockPath)}`
            + `\nThe holder runs on another host, so it cannot be checked for liveness. `
            + `Remove ${lockPath} manually only after confirming that host is down.`,
            lockPath,
            verdict.holder,
          );
        case 'unverifiable':
          throw new ServerLockError(
            'SERVER_LOCK_UNVERIFIABLE',
            `${describeHolder(verdict.holder, lockPath)}`
            + `\nThis platform has no process start time, so a dead-looking pid may have been reused; `
            + `the lock is not removed automatically. Delete ${lockPath} manually only after confirming `
            + `that no server is running.`,
            lockPath,
            verdict.holder,
          );
        case 'unreadable':
          throw new ServerLockError(
            'SERVER_LOCK_UNREADABLE',
            `lock file ${lockPath} exists but has no readable owner yet. `
            + `Another server may be starting; retry in a few seconds. `
            + `If it persists, delete the file after confirming no server is running.`,
            lockPath,
            null,
          );
      }
    }

    throw new ServerLockError(
      'SERVER_LOCK_HELD',
      `could not acquire ${lockPath} after ${MAX_ACQUIRE_ATTEMPTS} attempts: `
      + `another process kept winning the race.`,
      lockPath,
      null,
    );
  } finally {
    if (!acquired) uninstallSignalRelease();
  }
}

/**
 * Whether this process should take the storage lock.
 *
 * The proxy/stdio-bridge mode (MU-08) forwards every call to an upstream HTTP
 * core and never opens its own storage, so it must not claim the directory.
 * `doctor` exits before AppContainer is constructed and therefore never gets
 * here (see src/index.ts).
 */
export function shouldAcquireServerLock(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (argv.includes('--proxy-upstream')) return false;
  if (env.MCP_PROXY_UPSTREAM && env.MCP_PROXY_UPSTREAM.trim() !== '') return false;
  return true;
}
