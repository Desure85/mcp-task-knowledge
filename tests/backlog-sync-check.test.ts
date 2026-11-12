import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { canonicalStatus, parseBacklog } from '../scripts/backlog-sync-check.mjs';

const SCRIPT = path.resolve('scripts/backlog-sync-check.mjs');
const dirs: string[] = [];

async function fixture(task: unknown | null, backlogStatus = 'done') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aa09-'));
  dirs.push(root);
  const data = path.join(root, 'data');
  const tasks = path.join(data, 'tasks', 'mcp');
  await fs.mkdir(tasks, { recursive: true });
  if (task) await fs.writeFile(path.join(tasks, 'task.json'), JSON.stringify(task));
  const backlog = path.join(root, 'BACKLOG.md');
  await fs.writeFile(
    backlog,
    `| ID | Задача | Приоритет | Статус | Этап | Notes |\n|---|---|---|---|---|---|\n| T-002 | TCP/Unix multi-client сервер | medium | **${backlogStatus}** ✅ | 1.2 | T-001 ✅ |\n`,
  );
  const map = path.join(root, 'map.json');
  await fs.writeFile(map, JSON.stringify({ 'T-002': { taskTitle: '1.2 TCP/Unix сервер (multi-client)' } }));
  return { root, data, backlog, map };
}

function run(fx: Awaited<ReturnType<typeof fixture>>, extra: string[] = []) {
  return spawnSync(
    process.execPath,
    [SCRIPT, '--data', fx.data, '--project', 'mcp', '--backlog', fx.backlog, '--map', fx.map, ...extra],
    { cwd: path.resolve('.'), encoding: 'utf8' },
  );
}

afterEach(async () => {
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

describe('AA-09 backlog sync checker', () => {
  it('normalizes BACKLOG and tracker statuses', () => {
    expect(canonicalStatus('**done** ✅')).toBe('done');
    expect(canonicalStatus('completed')).toBe('done');
    expect(canonicalStatus('in progress')).toBe('in_progress');
    expect(canonicalStatus('todo')).toBe('pending');
    expect(canonicalStatus('wip')).toBe('in_progress');
    expect(canonicalStatus('')).toBe('unknown');
    const rows = parseBacklog('| ID | Задача | P | Статус | D | N |\n| T-002 | x | medium | **done** ✅ | 1 | y |');
    expect(rows.get('T-002')?.status).toBe('done');
  });

  it('returns 0 discrepancies for matching done task', async () => {
    const fx = await fixture({ id: 't1', title: '1.2 TCP/Unix сервер (multi-client)', status: 'completed' });
    const r = run(fx);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('0 расхождений');
  });

  it('reports a status mismatch and exits 1', async () => {
    const fx = await fixture({ id: 't1', title: '1.2 TCP/Unix сервер (multi-client)', status: 'pending' });
    const r = run(fx);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('MISMATCH T-002');
    expect(r.stdout).toContain('BACKLOG=done, tracker=pending');
  });

  it('reports a missing tracker task and stays read-only', async () => {
    const fx = await fixture(null);
    const before = await fs.readFile(fx.backlog, 'utf8');
    const hash = crypto.createHash('sha256').update(before).digest('hex');
    const r = run(fx);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('нет задачи в трекере');
    expect(await fs.readFile(fx.backlog, 'utf8')).toBe(before);
    expect(crypto.createHash('sha256').update(await fs.readFile(fx.backlog)).digest('hex')).toBe(hash);
  });

  it('emits machine-readable JSON', async () => {
    const fx = await fixture({ id: 't1', title: '1.2 TCP/Unix сервер (multi-client)', status: 'closed' });
    const r = run(fx, ['--json']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.checked).toBe(1);
    expect(parsed.mismatches).toEqual([]);
  });
});
