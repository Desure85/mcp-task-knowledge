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
import { randomUUID } from 'node:crypto';
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

/**
 * How long an unparsable lock (empty or half-written) is trusted as HELD.
 *
 * A lock written by the fallback path below (`open` + write, no hard links) is
 * briefly visible as an empty file. A contender that observed that window used
 * to call it stale, delete the live lock and take it too — two ticks, two
 * merges. Within the grace window such a file is reported as busy instead.
 */
export const UNREADABLE_LOCK_GRACE_MS = 5_000;

/** Error codes meaning "this filesystem cannot create hard links". */
const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOSYS', 'EOPNOTSUPP', 'ENOTSUP', 'EXDEV', 'EMLINK']);

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

/**
 * Read a lock file as ONE inode: content, parse result and mtime come from the
 * same open handle, so a replacement in flight cannot mix two generations.
 * @returns {Promise<{exists: boolean, holder: null | {pid: number, startedAt: number, token: string | null}, mtimeMs: number | null}>}
 */
async function readLockSnapshot(file) {
  let handle;
  try {
    handle = await fs.open(file, 'r');
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, holder: null, mtimeMs: null };
    throw error;
  }
  try {
    const raw = await handle.readFile('utf8');
    const stat = await handle.stat();
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const valid = Number.isInteger(parsed?.pid) && Number.isFinite(parsed?.startedAt);
    return {
      exists: true,
      holder: valid
        ? {
            pid: parsed.pid,
            startedAt: parsed.startedAt,
            token: typeof parsed.token === 'string' ? parsed.token : null,
          }
        : null,
      mtimeMs: stat.mtimeMs,
    };
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * Decide whether an observed lock can be taken over.
 *
 * A parsed holder is stale when its process is gone or when it outlived
 * `staleMs`. An unparsable file names no holder, so it is held for `graceMs`
 * (measured by mtime) and only then reclaimed.
 */
function classifyLock(snapshot, now, staleMs, graceMs) {
  if (snapshot.holder) {
    const { pid, startedAt } = snapshot.holder;
    const ageMs = now - startedAt;
    return { stale: !pidAlive(pid) || ageMs > staleMs, holder: { pid, startedAt, ageMs } };
  }
  const mtimeMs = snapshot.mtimeMs ?? now;
  const ageMs = Math.max(0, now - mtimeMs);
  return { stale: ageMs > graceMs, holder: { pid: -1, startedAt: mtimeMs, ageMs } };
}

/**
 * Create a lock file atomically WITH its content.
 *
 * `fs.link` makes the directory entry appear already pointing at a complete
 * inode, so a contender never observes "file exists, content missing": it sees
 * either no file (and may win) or the whole payload (and backs off). `writeFile`
 * with `wx` cannot promise that — it creates an empty inode first.
 *
 * @returns {Promise<boolean>} true when this call created the file
 */
async function createLockFile(file, payload) {
  const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.writeFile(tmp, payload, 'utf8');
    try {
      await fs.link(tmp, file);
      return true;
    } catch (error) {
      if (error?.code === 'EEXIST') return false;
      if (!LINK_UNSUPPORTED.has(error?.code)) throw error;
      // Filesystem without hard links: exclusive create, then content. Readers
      // may see the empty inode for a moment; classifyLock reports a fresh
      // unparsable lock as held, so nobody reclaims it inside that window.
      try {
        await fs.writeFile(file, payload, { encoding: 'utf8', flag: 'wx' });
        return true;
      } catch (fallbackError) {
        if (fallbackError?.code === 'EEXIST') return false;
        throw fallbackError;
      }
    }
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

/**
 * Remove a lock file only while it still carries OUR token.
 * A pid check alone is not enough: the file may have been reclaimed and belong
 * to a new owner by the time we get here.
 */
async function removeIfOwned(file, token) {
  const snapshot = await readLockSnapshot(file);
  if (!snapshot.exists || snapshot.holder?.token !== token) return false;
  await fs.rm(file, { force: true });
  return true;
}

/** A reclaimer that crashed must not block reclaims forever. */
async function dropAbandonedGuard(guardPath, now, staleMs, graceMs) {
  const snapshot = await readLockSnapshot(guardPath);
  if (!snapshot.exists) return;
  const { stale } = classifyLock(snapshot, now, staleMs, graceMs);
  if (!stale) return;
  if (snapshot.holder?.token) await removeIfOwned(guardPath, snapshot.holder.token);
  else await fs.rm(guardPath, { force: true });
}

/**
 * Try to take the single-writer lock.
 * A lock is stale when its holder is gone or when it is older than staleMs.
 * An unparsable lock is stale only after UNREADABLE_LOCK_GRACE_MS.
 * @returns {Promise<{ok: true, release: () => Promise<void>} | {ok: false, holder: {pid: number, startedAt: number, ageMs: number}}>}
 */
export async function acquireLock(dir, options = {}) {
  await ensureDir(dir);
  const pid = options.pid ?? process.pid;
  const now = options.now ?? Date.now();
  const staleMs = options.staleMs ?? 30 * 60 * 1000;
  const graceMs = options.unreadableGraceMs ?? UNREADABLE_LOCK_GRACE_MS;
  const target = lockPath(dir);
  const token = randomUUID();
  const payload = `${JSON.stringify({ pid, startedAt: now, token })}\n`;
  const taken = () => ({
    ok: true,
    release: async () => {
      await removeIfOwned(target, token);
    },
  });

  if (await createLockFile(target, payload)) return taken();

  let snapshot = await readLockSnapshot(target);
  if (!snapshot.exists) {
    // The file vanished between our link and our read (a holder released it):
    // this is not a defeated contender, one more attempt is safe.
    if (await createLockFile(target, payload)) return taken();
    snapshot = await readLockSnapshot(target);
  }
  let state = classifyLock(snapshot, now, staleMs, graceMs);
  if (!state.stale) return { ok: false, holder: state.holder };

  // Reclaim under an exclusive guard: without it two reclaimers can each
  // delete the other's fresh lock and both report success.
  const guardPath = `${target}.reclaim`;
  const guardToken = randomUUID();
  const guardPayload = `${JSON.stringify({ pid, startedAt: now, token: guardToken })}\n`;
  if (!(await createLockFile(guardPath, guardPayload))) {
    await dropAbandonedGuard(guardPath, now, staleMs, graceMs);
    return { ok: false, holder: state.holder };
  }
  try {
    // Re-inspect inside the guard: the holder we judged stale may have been
    // replaced by a live one while we waited for the guard.
    snapshot = await readLockSnapshot(target);
    state = classifyLock(snapshot, now, staleMs, graceMs);
    if (snapshot.exists && state.stale) await fs.rm(target, { force: true });
    if (await createLockFile(target, payload)) return taken();
    const after = classifyLock(await readLockSnapshot(target), now, staleMs, graceMs);
    return { ok: false, holder: after.holder };
  } finally {
    await removeIfOwned(guardPath, guardToken);
  }
}
