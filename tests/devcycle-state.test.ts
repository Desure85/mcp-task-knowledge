/**
 * tests/devcycle-state.test.ts — state machine, single-writer lock, degradation
 * contract, read-only guarantee and command/code drift.
 *
 * These are the properties that make the loop safe to leave unattended:
 * a stale cron tick must be a no-op after `stop`, two overlapping ticks must not
 * both run, a missing tool must degrade to "n/a" with exit 0, and a probe must
 * not change the working tree.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

const execFileP = promisify(execFile);
const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, 'scripts', 'devcycle.mjs');
const LOCK_MODULE = path.join(ROOT, 'scripts', 'lib', 'devcycle-state.mjs');
const COMMAND_FILE = path.join(ROOT, '.claude', 'commands', 'devcycle.md');
const SUBCOMMANDS = ['status', 'next', 'state', 'log', 'tick', 'report'];

const tempDirs: string[] = [];

async function makeStateDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devcycle-state-'));
  tempDirs.push(dir);
  return dir;
}

type Run = { code: number; stdout: string; stderr: string };
type LockHolder = { pid: number; startedAt: number };

/**
 * Barrier for the overlap test: wait until a *readable* lock is on disk.
 *
 * Polling instead of sleeping keeps the test independent of process start-up
 * jitter: on a loaded CI runner two spawned children can be tens or hundreds of
 * milliseconds apart, so "spawn both at once" never actually guaranteed that the
 * second tick met a held lock. Waiting for the observable lock state does.
 */
async function waitForLock(dir: string, timeoutMs = 30_000): Promise<LockHolder> {
  const file = path.join(dir, 'lock.json');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as LockHolder;
      if (Number.isInteger(parsed?.pid) && Number.isFinite(parsed?.startedAt)) return parsed;
    } catch {
      // not created yet, or observed mid-write: keep polling
    }
    if (Date.now() > deadline) throw new Error(`lock.json was not readable within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function run(
  args: string[],
  env: Record<string, string> = {},
  extra: { timeout?: number } = {},
): Promise<Run> {
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      timeout: extra.timeout ?? 90_000,
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number | string; stdout?: string; stderr?: string };
    return {
      code: typeof failed.code === 'number' ? failed.code : 1,
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? '',
    };
  }
}

/**
 * Children for the lock races: a real OS process importing the real lock module.
 * `acquireLock` guards a tick, so the race must be measured across processes —
 * `Promise.all` inside one process shares an event loop and cannot show a
 * file-visibility window between two writers.
 */
const CONTENDER_SOURCE = `
const [mod, dir, startAtRaw] = process.argv.slice(1);
const fsp = (await import('node:fs')).promises;
const { acquireLock } = await import(mod);
const startAt = Number(startAtRaw);
while (Date.now() < startAt) { /* tight spin: align the start of all contenders */ }
const lock = await acquireLock(dir, { staleMs: 600000 });
process.stdout.write(JSON.stringify({ pid: process.pid, ok: lock.ok, holderPid: lock.ok ? null : lock.holder.pid }) + '\\n');
if (lock.ok) {
  // Stay alive until the round ends: an exited holder is legitimately stale, so
  // a later contender would be allowed to reclaim its lock.
  const marker = dir + '/round-done';
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await fsp.stat(marker).then(() => true, () => false)) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
`;

/**
 * Regression fixture for the lost-update window: the first `fs.writeFile` is
 * replaced by `open(..., 'wx')` + signal + wait + write. On the old code that
 * first call is the lock itself, so lock.json is visible while still empty and a
 * second process takes it; both then report success. On the fixed code the pause
 * covers a private temp file that is not the lock yet.
 */
const SLOW_WRITER_SOURCE = `
const [mod, dir, openedFlag, peerDoneFlag, selfDoneFlag] = process.argv.slice(1);
const fsp = (await import('node:fs')).promises;
const original = fsp.writeFile;
let first = true;
fsp.writeFile = async (target, data, options) => {
  if (!first) return original(target, data, options);
  first = false;
  const handle = await fsp.open(target, 'wx');
  await original(openedFlag, 'opened');
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await fsp.stat(peerDoneFlag).then(() => true, () => false)) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await handle.writeFile(data);
  await handle.close();
};
const { acquireLock } = await import(mod);
let result = { ok: false };
try {
  result = { ok: (await acquireLock(dir, { staleMs: 600000 })).ok };
} finally {
  await original(selfDoneFlag, 'done');
}
process.stdout.write(JSON.stringify(result) + '\\n');
`;

/** Second process of the regression fixture; stays alive until the slow one finishes. */
const COMPANION_SOURCE = `
const [mod, dir, peerDoneFlag, selfDoneFlag] = process.argv.slice(1);
const fsp = (await import('node:fs')).promises;
const { acquireLock } = await import(mod);
const lock = await acquireLock(dir, { staleMs: 600000 });
await fsp.writeFile(peerDoneFlag, 'peer-done');
process.stdout.write(JSON.stringify({ pid: process.pid, ok: lock.ok }) + '\\n');
const deadline = Date.now() + 20000;
while (Date.now() < deadline) {
  if (await fsp.stat(selfDoneFlag).then(() => true, () => false)) break;
  await new Promise((resolve) => setTimeout(resolve, 5));
}
`;

const GRACE_PROBE_SOURCE = `
const [mod, dir] = process.argv.slice(1);
const { acquireLock, UNREADABLE_LOCK_GRACE_MS } = await import(mod);
const fresh = await acquireLock(dir, { staleMs: 600000 });
const afterGrace = await acquireLock(dir, { staleMs: 600000, now: Date.now() + UNREADABLE_LOCK_GRACE_MS + 5000 });
process.stdout.write(JSON.stringify({
  fresh: { ok: fresh.ok, holder: fresh.ok ? null : fresh.holder },
  afterGrace: { ok: afterGrace.ok },
}) + '\\n');
`;

const RELEASE_PROBE_SOURCE = `
const [mod, dir] = process.argv.slice(1);
const fsp = (await import('node:fs')).promises;
const { acquireLock } = await import(mod);
const lock = await acquireLock(dir, { staleMs: 600000 });
await lock.release();
const afterOwn = await fsp.stat(dir + '/lock.json').then(() => 'exists', () => 'gone');
const second = await acquireLock(dir, { staleMs: 600000 });
await fsp.writeFile(dir + '/lock.json', JSON.stringify({ pid: process.pid, startedAt: Date.now(), token: 'foreign' }) + '\\n');
await second.release();
const afterForeign = await fsp.readFile(dir + '/lock.json', 'utf8').catch(() => null);
process.stdout.write(JSON.stringify({ afterOwn, afterForeign }) + '\\n');
`;

type SpawnedChild = { first: Promise<Record<string, unknown>>; done: Promise<number> };

/** Spawn a throwaway node process that imports the real lock module. */
function spawnModuleChild(source: string, args: string[]): SpawnedChild {
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, ...args], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = child.stdout;
  const err = child.stderr;
  if (!out || !err) throw new Error('child stdio was not piped');
  let stdout = '';
  let stderr = '';
  let settled = false;
  let resolveFirst: (value: Record<string, unknown>) => void = () => {};
  const first = new Promise<Record<string, unknown>>((resolve) => {
    resolveFirst = resolve;
  });
  out.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
    if (settled) return;
    const line = stdout.split('\n').find((item) => item.trim().startsWith('{'));
    if (!line) return;
    settled = true;
    resolveFirst(JSON.parse(line) as Record<string, unknown>);
  });
  err.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const done = new Promise<number>((resolve) => {
    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        resolveFirst({ error: `no result on stdout (exit ${code}): ${stderr || stdout}` });
      }
      resolve(code ?? 1);
    });
  });
  return { first, done };
}

/** Wait for a file to appear (the fixture's signal that a step has been reached). */
async function waitForFile(file: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fs.stat(file).then(() => true, () => false)) return;
    if (Date.now() > deadline) throw new Error(`${path.basename(file)} did not appear within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('devcycle state machine', () => {
  it('enable records since and cron, disable records the reason', async () => {
    const dir = await makeStateDir();
    const enabled = await run(['state', 'enable', '--cron-id', 'cron-test', '--json'], {
      DEVCYCLE_STATE_DIR: dir,
    });
    expect(enabled.code).toBe(0);
    const afterEnable = JSON.parse(enabled.stdout).state;
    expect(afterEnable.enabled).toBe(true);
    expect(afterEnable.since).toBeTruthy();
    expect(afterEnable.cronId).toBe('cron-test');

    const disabled = await run(['state', 'disable', '--reason', 'тест', '--json'], {
      DEVCYCLE_STATE_DIR: dir,
    });
    expect(disabled.code).toBe(0);
    const afterDisable = JSON.parse(disabled.stdout).state;
    expect(afterDisable.enabled).toBe(false);
    expect(afterDisable.stopReason).toBe('тест');
  });

  it('refuses to tick while the loop is disabled', async () => {
    const dir = await makeStateDir();
    await run(['state', 'enable'], { DEVCYCLE_STATE_DIR: dir });
    await run(['state', 'disable', '--reason', 'стоп'], { DEVCYCLE_STATE_DIR: dir });

    const tick = await run(['tick', '--json'], { DEVCYCLE_STATE_DIR: dir });
    expect(tick.code).toBe(3);
    expect(JSON.parse(tick.stdout).skipped).toBe('disabled');

    const log = await fs.readFile(path.join(dir, 'log.md'), 'utf8');
    expect(log).not.toContain('Тик выполнен');
    expect(log).toContain('цикл выключен');
  });

  it('ticks when enabled', async () => {
    const dir = await makeStateDir();
    await run(['state', 'enable'], { DEVCYCLE_STATE_DIR: dir });
    const tick = await run(['tick', '--dry-run', '--json'], { DEVCYCLE_STATE_DIR: dir });
    expect(tick.code).toBe(0);
    expect(JSON.parse(tick.stdout).plan.dryRun).toBe(true);
  });
});

describe('devcycle single-writer lock', () => {
  it('lets exactly one of two overlapping ticks run', async () => {
    const dir = await makeStateDir();
    await run(['state', 'enable'], { DEVCYCLE_STATE_DIR: dir });
    const env = { DEVCYCLE_STATE_DIR: dir, DEVCYCLE_TEST_HOLD_MS: '8000' };

    const firstTick = run(['tick', '--dry-run', '--json'], env);
    const holder = await waitForLock(dir);
    const second = await run(['tick', '--dry-run', '--json'], env);
    const first = await firstTick;

    expect([first.code, second.code].sort()).toEqual([0, 3]);
    expect(second.code).toBe(3);
    const skipped = JSON.parse(second.stdout);
    expect(skipped.skipped).toBe('locked');
    expect(skipped.holder.pid).toBe(holder.pid);
  }, 60_000);

  it('reclaims a stale lock whose holder is gone', async () => {
    const dir = await makeStateDir();
    await run(['state', 'enable'], { DEVCYCLE_STATE_DIR: dir });
    await fs.writeFile(
      path.join(dir, 'lock.json'),
      `${JSON.stringify({ pid: 999_999, startedAt: Date.now() - 60_000 })}\n`,
      'utf8',
    );

    const tick = await run(['tick', '--dry-run', '--json'], { DEVCYCLE_STATE_DIR: dir });
    expect(tick.code).toBe(0);
  });
});

describe('devcycle lock atomicity', () => {
  it('never grants the lock twice when a contender is slow between create and write', async () => {
    const dir = await makeStateDir();
    const flags = await makeStateDir();
    const openedFlag = path.join(flags, 'opened');
    const peerDoneFlag = path.join(flags, 'peer-done');
    const selfDoneFlag = path.join(flags, 'self-done');

    const slow = spawnModuleChild(SLOW_WRITER_SOURCE, [LOCK_MODULE, dir, openedFlag, peerDoneFlag, selfDoneFlag]);
    await waitForFile(openedFlag);
    const peer = spawnModuleChild(COMPANION_SOURCE, [LOCK_MODULE, dir, peerDoneFlag, selfDoneFlag]);

    const slowResult = await slow.first;
    const peerResult = await peer.first;
    expect(await slow.done).toBe(0);
    expect(await peer.done).toBe(0);
    expect(slowResult).not.toHaveProperty('error');
    expect(peerResult).not.toHaveProperty('error');
    expect([slowResult.ok, peerResult.ok].filter(Boolean)).toHaveLength(1);
  }, 60_000);

  it('grants the lock to exactly one of six concurrent processes', async () => {
    const rounds = 6;
    const contenders = 6;
    for (let round = 1; round <= rounds; round++) {
      const dir = await makeStateDir();
      const startAt = Date.now() + 400;
      const children = Array.from({ length: contenders }, () =>
        spawnModuleChild(CONTENDER_SOURCE, [LOCK_MODULE, dir, String(startAt)]),
      );
      const results = await Promise.all(children.map((child) => child.first));
      await fs.writeFile(path.join(dir, 'round-done'), 'x');
      const codes = await Promise.all(children.map((child) => child.done));

      expect(codes).toEqual(new Array<number>(contenders).fill(0));
      for (const result of results) expect(result).not.toHaveProperty('error');
      const winners = results.filter((result) => result.ok === true);
      expect(winners.length, `round ${round}: ${winners.length} processes were told ok:true`).toBe(1);
      const losers = results.filter((result) => result.ok === false);
      for (const loser of losers) expect(loser.holderPid).toBe(winners[0].pid);
    }
  }, 120_000);

  it('lets exactly one of six concurrent processes reclaim a stale lock', async () => {
    const rounds = 3;
    const contenders = 6;
    for (let round = 1; round <= rounds; round++) {
      const dir = await makeStateDir();
      await fs.writeFile(
        path.join(dir, 'lock.json'),
        `${JSON.stringify({ pid: 999_999, startedAt: Date.now() - 60_000, token: 'dead-holder' })}\n`,
        'utf8',
      );
      const startAt = Date.now() + 400;
      const children = Array.from({ length: contenders }, () =>
        spawnModuleChild(CONTENDER_SOURCE, [LOCK_MODULE, dir, String(startAt)]),
      );
      const results = await Promise.all(children.map((child) => child.first));
      await fs.writeFile(path.join(dir, 'round-done'), 'x');
      const codes = await Promise.all(children.map((child) => child.done));

      expect(codes).toEqual(new Array<number>(contenders).fill(0));
      for (const result of results) expect(result).not.toHaveProperty('error');
      const winners = results.filter((result) => result.ok === true);
      expect(winners.length, `round ${round}: ${winners.length} processes reclaimed the stale lock`).toBe(1);
    }
  }, 120_000);

  it('treats a fresh unreadable lock as busy and reclaims it only after the grace window', async () => {
    const dir = await makeStateDir();
    await fs.writeFile(path.join(dir, 'lock.json'), '', 'utf8');

    const probe = spawnModuleChild(GRACE_PROBE_SOURCE, [LOCK_MODULE, dir]);
    const result = await probe.first;
    expect(await probe.done).toBe(0);
    expect(result).not.toHaveProperty('error');

    const fresh = result.fresh as { ok: boolean; holder: { pid: number; ageMs: number } };
    expect(fresh.ok).toBe(false);
    expect(fresh.holder.pid).toBe(-1);
    expect((result.afterGrace as { ok: boolean }).ok).toBe(true);
  }, 60_000);

  it('releases only a lock that still carries its own token', async () => {
    const dir = await makeStateDir();
    const probe = spawnModuleChild(RELEASE_PROBE_SOURCE, [LOCK_MODULE, dir]);
    const result = await probe.first;
    expect(await probe.done).toBe(0);
    expect(result).not.toHaveProperty('error');
    expect(result.afterOwn).toBe('gone');
    expect(String(result.afterForeign)).toContain('foreign');
  }, 60_000);
});

describe('devcycle degradation contract', () => {
  it('reports n/a instead of failing when tools, registry and database are absent', async () => {
    const dir = await makeStateDir();
    const status = await run(['status', '--json'], {
      DEVCYCLE_STATE_DIR: dir,
      DEVCYCLE_REGISTRY: path.join(dir, 'missing-registry.json'),
      DEVCYCLE_DB: path.join(dir, 'missing.db'),
      PATH: '/nonexistent',
    });

    expect(status.code).toBe(0);
    const payload = JSON.parse(status.stdout);
    expect(payload.cycle.available).toBe(true);
    expect(payload.loopx.available).toBe(false);
    expect(payload.loopx.reason).toBeTruthy();
    expect(payload.github.available).toBe(false);
    expect(payload.sessions.available).toBe(false);
    expect(payload.worktrees.available).toBe(false);
  }, 60_000);
});

describe('devcycle probes are read-only', () => {
  it('leaves the working tree untouched after status and next', async () => {
    const before = await execFileP('git', ['status', '--short'], { cwd: ROOT });
    const status = await run(['status', '--json'], {}, { timeout: 120_000 });
    const next = await run(['next', '--json']);
    const after = await execFileP('git', ['status', '--short'], { cwd: ROOT });

    expect(status.code).toBe(0);
    expect(next.code).toBe(0);
    expect(after.stdout).toBe(before.stdout);
  }, 180_000);
});

describe('devcycle command/code drift', () => {
  it('references only implemented subcommands', async () => {
    const help = await run(['--help']);
    expect(help.code).toBe(0);
    for (const subcommand of SUBCOMMANDS) {
      expect(help.stdout).toContain(`  ${subcommand} `);
    }

    const doc = await fs.readFile(COMMAND_FILE, 'utf8');
    const referenced = [...doc.matchAll(/node scripts\/devcycle\.mjs ([a-z][a-z-]*)/g)].map(
      (match) => match[1],
    );
    expect(referenced.length).toBeGreaterThan(0);
    for (const subcommand of new Set(referenced)) {
      expect(SUBCOMMANDS, `${COMMAND_FILE} references an unknown subcommand`).toContain(subcommand);
    }

    const ACTIONS = ['status', 'start', 'resume', 'stop', 'tick', 'next', 'report', 'readiness', 'proposals'];
    const headings = [...doc.matchAll(/^## ([a-z]+)$/gm)].map((match) => match[1]);
    expect(new Set(headings)).toEqual(new Set(ACTIONS));

    const invoked = [...doc.matchAll(/\/devcycle ([a-z]+)/g)].map((match) => match[1]);
    expect(invoked.length).toBeGreaterThan(0);
    for (const action of new Set(invoked)) {
      expect(ACTIONS, `${COMMAND_FILE} invokes an unknown action`).toContain(action);
    }
  });
});
