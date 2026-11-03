/**
 * tests/devcycle-next.test.ts — queue selection for `devcycle next`.
 *
 * Two things are asserted here:
 *   1. The queue rules on small inline fixtures (priority, dependencies, gates,
 *      blocked/deferred, unknown dependency IDs, lettered sub-items).
 *   2. Parser parity with the repository's own counter, `npm run backlog:check`.
 *      Parity is the external judge: two independent implementations must agree
 *      on pending/blocked/deferred, and the only allowed difference in total is
 *      the rows check-backlog cannot match because its ID regex forbids digits
 *      in the prefix (`NEXT2-008`), which this parser does support.
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

const HEADER = [
  '| ID | Задача | Приоритет | Статус | Зависимости | Что делать |',
  '|----|--------|-----------|--------|-------------|------------|',
].join('\n');

const tempDirs: string[] = [];

async function makeBacklog(rows: string[]): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devcycle-next-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'BACKLOG.md');
  await fs.writeFile(file, `# BACKLOG\n\n## Этап T\n\n${HEADER}\n${rows.join('\n')}\n`, 'utf8');
  return file;
}

async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      timeout: 90_000,
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

type NextPayload = {
  counts: { total: number; done: number; pending: number; blocked: number; deferred: number };
  chosen: { id: string; priority: string | null } | null;
  skipped: Array<{ id: string; reason: string }>;
  skippedTotal: number;
};

async function nextJson(backlog: string): Promise<NextPayload> {
  const result = await run(['next', '--json', '--backlog', backlog]);
  expect(result.code, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as NextPayload;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('devcycle next: queue rules', () => {
  it('prefers high over medium and low regardless of file order', async () => {
    const file = await makeBacklog([
      '| T-001 | низкий | low | pending | — | x |',
      '| T-002 | средний | medium | pending | — | x |',
      '| T-003 | высокий | high | pending | — | x |',
    ]);
    const payload = await nextJson(file);
    expect(payload.chosen?.id).toBe('T-003');
  });

  it('prefers critical over high, the top step the repository already uses', async () => {
    const file = await makeBacklog([
      '| T-001 | высокий | high | pending | — | x |',
      '| T-002 | критический | critical | pending | — | x |',
    ]);
    const payload = await nextJson(file);
    expect(payload.chosen?.id).toBe('T-002');
  });

  it('keeps file order inside one priority', async () => {
    const file = await makeBacklog([
      '| T-001 | первый | high | pending | — | x |',
      '| T-002 | второй | high | pending | — | x |',
    ]);
    const payload = await nextJson(file);
    expect(payload.chosen?.id).toBe('T-001');
  });

  it('skips an item whose dependency is not done and names the dependency', async () => {
    const file = await makeBacklog([
      '| T-001 | база | high | pending | — | x |',
      '| T-002 | зависимый | high | pending | T-001 | x |',
    ]);
    const payload = await nextJson(file);
    expect(payload.chosen?.id).toBe('T-001');
    expect(payload.skipped.map((item) => item.id)).toContain('T-002');
    expect(payload.skipped.find((item) => item.id === 'T-002')?.reason).toContain('T-001');
  });

  it('allows an item whose dependency is done', async () => {
    const file = await makeBacklog([
      '| T-001 | база | high | done | — | x |',
      '| T-002 | зависимый | high | pending | T-001 | x |',
    ]);
    const payload = await nextJson(file);
    expect(payload.chosen?.id).toBe('T-002');
  });

  it('treats a dependency ID that is absent from the file as not done', async () => {
    const file = await makeBacklog(['| T-002 | зависимый | high | pending | T-999 | x |']);
    const payload = await nextJson(file);
    expect(payload.chosen).toBeNull();
    expect(payload.skipped[0]?.reason).toContain('T-999');
  });

  it('skips owner gates and design markers written in the dependencies column', async () => {
    const file = await makeBacklog([
      '| T-001 | гейт | high | pending | Гейт владельца: судьба данных | x |',
      '| T-002 | проработка | high | pending | Проработка (design): ADR | x |',
      '| T-003 | обычный | low | pending | — | x |',
    ]);
    const payload = await nextJson(file);
    expect(payload.chosen?.id).toBe('T-003');
    expect(payload.skipped.map((item) => item.id)).toEqual(['T-001', 'T-002']);
  });

  it('skips blocked and deferred items', async () => {
    const file = await makeBacklog([
      '| T-001 | блок | high | blocked | — | x |',
      '| T-002 | отложен | high | deferred | — | x |',
    ]);
    const payload = await nextJson(file);
    expect(payload.chosen).toBeNull();
    expect(payload.skipped.map((item) => item.reason)).toEqual([
      'статус blocked',
      'статус deferred',
    ]);
  });

  it('ignores lettered sub-items', async () => {
    const file = await makeBacklog(['| T-001a | суб-пункт | high | pending | — | x |']);
    const payload = await nextJson(file);
    expect(payload.counts.total).toBe(0);
    expect(payload.chosen).toBeNull();
  });

  it('returns null on an empty queue without failing', async () => {
    const file = await makeBacklog([]);
    const result = await run(['next', '--json', '--backlog', file]);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as NextPayload;
    expect(payload.chosen).toBeNull();
    expect(payload.counts.pending).toBe(0);
  });

  it('expands dependency ranges instead of reading only the endpoints', async () => {
    const file = await makeBacklog([
      '| T-001 | один | high | done | — | x |',
      '| T-002 | два | high | pending | — | x |',
      '| T-003 | три | high | pending | T-001..T-002 | x |',
    ]);
    const payload = await nextJson(file);
    expect(payload.chosen?.id).toBe('T-002');
    expect(payload.skipped.find((item) => item.id === 'T-003')?.reason).toContain('T-002');
  });
});

describe('devcycle next: parity with the repository counter', () => {
  it('agrees with npm run backlog:check on pending/blocked/deferred', async () => {
    const check = await execFileP('npm', ['run', '-s', 'backlog:check'], { cwd: ROOT, timeout: 90_000 });
    const match = check.stdout.match(
      /summary OK: (\d+) total, (\d+) done, (\d+) wip, (\d+) pending, (\d+) blocked, (\d+) deferred/,
    );
    expect(match, `unexpected backlog:check output: ${check.stdout}`).not.toBeNull();
    const [, total, done, , pending, blocked, deferred] = match!.map(Number);

    const payload = await nextJson(path.join(ROOT, 'BACKLOG.md'));

    // check-backlog's row regex is /^\|\s*[A-Z]+-\d+\s*\|/ and therefore cannot
    // see IDs with a digit in the prefix (NEXT2-008). Count those independently
    // and require the totals to differ by exactly that many rows.
    const markdown = await fs.readFile(path.join(ROOT, 'BACKLOG.md'), 'utf8');
    const digitPrefixRows = markdown
      .split('\n')
      .filter((line) => /^\|\s*[A-Z][A-Z0-9]*\d[A-Z0-9]*-\d+\s*\|/.test(line)).length;

    expect(payload.counts.pending).toBe(pending);
    expect(payload.counts.blocked).toBe(blocked);
    expect(payload.counts.deferred).toBe(deferred);
    expect(payload.counts.total).toBe(total + digitPrefixRows);
    expect(payload.counts.done).toBe(done + digitPrefixRows);
  }, 120_000);
});
