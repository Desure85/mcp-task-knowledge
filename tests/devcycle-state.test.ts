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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

const execFileP = promisify(execFile);
const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, 'scripts', 'devcycle.mjs');
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
