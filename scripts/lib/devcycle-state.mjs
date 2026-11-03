// scripts/lib/devcycle-state.mjs — loop state, atomic writes, single-writer lock.
//
// The state file is loop CONTROL only (enabled/since/cronId/stopReason/lastTick).
// It is never a copy of the queue: `next` always re-reads BACKLOG.md, so the tool
// cannot become a second source of truth.
//
// Writes are atomic (temp file + rename) for the same reason storage writes are:
// a crash mid-write must not leave a half-written state that silently disables
// the loop or, worse, claims it is running.

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const STATE_VERSION = 1;

export const DEFAULT_STATE = Object.freeze({
  version: STATE_VERSION,
  enabled: false,
  since: null,
  cronId: null,
  stopReason: null,
  lastTick: null,
  lastResult: null,
});

/** Resolve the local state directory (gitignored, never committed). */
export function resolveStateDir(env = process.env, cwd = process.cwd()) {
  return env.DEVCYCLE_STATE_DIR ? path.resolve(env.DEVCYCLE_STATE_DIR) : path.join(cwd, '.devcycle');
}

export function statePath(dir) {
  return path.join(dir, 'state.json');
}

export function lockPath(dir) {
  return path.join(dir, 'lock.json');
}

export function logPath(dir) {
  return path.join(dir, 'log.md');
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

/** Read state; a missing or broken file yields defaults (never throws). */
export async function readState(dir) {
  try {
    const raw = await fs.readFile(statePath(dir), 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

/**
 * Merge a patch into the state file and write it atomically.
 * @returns {Promise<object>} the new state
 */
export async function writeState(dir, patch) {
  await ensureDir(dir);
  const current = await readState(dir);
  const next = { ...current, ...patch, version: STATE_VERSION, updatedAt: new Date().toISOString() };
  const target = statePath(dir);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, target);
  return next;
}

/** Append one timestamped line to the loop log. */
export async function appendLog(dir, text) {
  await ensureDir(dir);
  const stamp = new Date().toISOString();
  await fs.appendFile(logPath(dir), `- ${stamp} ${String(text).replace(/\s+$/, '')}\n`, 'utf8');
  return `${stamp} ${text}`;
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return error?.code === 'EPERM';
  }
}

async function readLock(dir) {
  try {
    const raw = await fs.readFile(lockPath(dir), 'utf8');
    const parsed = JSON.parse(raw);
    if (!Number.isInteger(parsed?.pid) || !Number.isFinite(parsed?.startedAt)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Try to take the single-writer lock.
 * A lock is stale when its holder is gone or when it is older than staleMs.
 * @returns {Promise<{ok: true, release: () => Promise<void>} | {ok: false, holder: {pid: number, startedAt: number, ageMs: number}}>}
 */
export async function acquireLock(dir, options = {}) {
  await ensureDir(dir);
  const pid = options.pid ?? process.pid;
  const now = options.now ?? Date.now();
  const staleMs = options.staleMs ?? 30 * 60 * 1000;
  const target = lockPath(dir);

  const write = async () => {
    await fs.writeFile(target, `${JSON.stringify({ pid, startedAt: now })}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
  };

  try {
    await write();
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const holder = await readLock(dir);
    const ageMs = holder ? now - holder.startedAt : Number.POSITIVE_INFINITY;
    const stale = !holder || !pidAlive(holder.pid) || ageMs > staleMs;
    if (!stale) {
      return {
        ok: false,
        holder: { pid: holder.pid, startedAt: holder.startedAt, ageMs },
      };
    }
    // Reclaim: remove the stale lock and try once more. If another process wins
    // the race, `wx` fails again and we report it as a live holder.
    await fs.rm(target, { force: true });
    try {
      await write();
    } catch (retryError) {
      if (retryError?.code !== 'EEXIST') throw retryError;
      const other = await readLock(dir);
      return {
        ok: false,
        holder: {
          pid: other?.pid ?? -1,
          startedAt: other?.startedAt ?? now,
          ageMs: other ? now - other.startedAt : 0,
        },
      };
    }
  }

  return {
    ok: true,
    release: async () => {
      const holder = await readLock(dir);
      if (!holder || holder.pid === pid) await fs.rm(target, { force: true });
    },
  };
}
