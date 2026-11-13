import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASELINE = {
  ops: { tasks_list: { medianMs: 28 }, knowledge_list: { medianMs: 33 } },
  coldStartMs: 967,
  caps: { tasks_list: 500, knowledge_list: 500, coldStartMs: 5000, rssAfterLoadMb: 3072 },
};
const ROOT = mkdtempSync(join(tmpdir(), 'spec-tr09-'));

function runGate(result: unknown): { ok: boolean; violations: Array<{ op: string; reason: string }> } {
  const r = join(ROOT, 'result.json');
  writeFileSync(r, JSON.stringify(result));
  const out = join(ROOT, 'gate.json');
  spawnSync(process.execPath, ['scripts/bench/gate-scale.mjs', '--result', r, '--out', out], { stdio: 'ignore' });
  return JSON.parse(readFileSync(out, 'utf8')) as { ok: boolean; violations: Array<{ op: string; reason: string }> };
}

function result(tasks = 28, knowledge = 33, coldStartMs = 967, rssAfterLoadMb = 2200) {
  return {
    ok: true,
    coldStartMs,
    rssAfterLoadMb,
    ops: {
      tasks_list: { status: 'ok', medianMs: tasks },
      knowledge_list: { status: 'ok', medianMs: knowledge },
    },
  };
}

describe('TR-09 scale gate CLI', () => {
  beforeAll(() => { writeFileSync(join(ROOT, 'baseline.json'), JSON.stringify(BASELINE)); });
  afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

  it('passes at baseline', () => {
    expect(runGate(result())).toMatchObject({ ok: true, violations: [] });
  });

  it('fails on 2x regression and absolute caps', () => {
    expect(runGate(result(57)).violations).toContainEqual(expect.objectContaining({ op: 'tasks_list' }));
    expect(runGate(result(600)).violations.some((v) => v.reason.includes('cap 500'))).toBe(true);
    expect(runGate(result(28, 33, 6000)).violations).toContainEqual(expect.objectContaining({ op: 'coldStartMs' }));
  });

  it('fails on the RSS ceiling', () => {
    expect(runGate(result(28, 33, 967, 4000)).violations).toContainEqual(
      expect.objectContaining({ op: 'rssAfterLoadMb', reason: expect.stringContaining('cap 3072') }),
    );
  });
});
