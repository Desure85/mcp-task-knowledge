// scripts/lib/devcycle-probe.mjs — read-only probes for `devcycle status`.
//
// Every probe returns { available: true, ... } or { available: false, reason }.
// A probe never throws: a missing tool, an unauthenticated gh, an absent LoopX
// registry or an unreadable database must degrade to "n/a" and keep the exit
// code at 0. That contract is what makes `status` safe to run from a cron.
//
// Probes are strictly read-only: no writes to the repository, no git fetch, no
// LoopX turn consumption (`loopx turn plan`, not `loopx quota should-run`).

import { execFileSync } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 20_000;
const FAILING = new Set([
  'FAILURE',
  'CANCELLED',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'ERROR',
]);
const PENDING = new Set(['PENDING', 'IN_PROGRESS', 'QUEUED', 'EXPECTED', 'WAITING', 'REQUESTED']);

function unavailable(reason) {
  return { available: false, reason };
}

function firstLine(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
}

/**
 * Run a command and parse stdout as JSON. Never throws.
 * @returns {{ok: true, data: any} | {ok: false, reason: string}}
 */
export function execJson(command, args, options = {}) {
  try {
    const stdout = execFileSync(command, args, {
      encoding: 'utf8',
      timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // sqlite3 -json prints nothing for an empty result set; that is data, not a failure.
    if (options.emptyAsArray && stdout.trim() === '') return { ok: true, data: [] };
    return { ok: true, data: JSON.parse(stdout) };
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: false, reason: `${command} не найден в PATH` };
    if (error?.killed || error?.signal) return { ok: false, reason: `${command} не ответил за отведённое время` };
    const detail = firstLine(error?.stderr) ?? firstLine(error?.message) ?? 'неизвестная ошибка';
    return { ok: false, reason: `${command}: ${detail}` };
  }
}

/** Run a command and return trimmed stdout. Never throws. */
export function execText(command, args, options = {}) {
  try {
    const stdout = execFileSync(command, args, {
      encoding: 'utf8',
      timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, data: stdout.trim() };
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: false, reason: `${command} не найден в PATH` };
    const detail = firstLine(error?.stderr) ?? firstLine(error?.message) ?? 'неизвестная ошибка';
    return { ok: false, reason: `${command}: ${detail}` };
  }
}

/** Summarise a GitHub statusCheckRollup array. */
export function summariseChecks(rollup) {
  const entries = Array.isArray(rollup) ? rollup : [];
  const counts = { total: entries.length, pass: 0, fail: 0, pending: 0 };
  for (const entry of entries) {
    const state = String(entry?.conclusion ?? entry?.state ?? '').toUpperCase();
    if (FAILING.has(state)) counts.fail += 1;
    else if (!state || PENDING.has(state)) counts.pending += 1;
    else counts.pass += 1;
  }
  counts.state = counts.fail > 0 ? 'red' : counts.pending > 0 ? 'pending' : counts.total > 0 ? 'green' : 'none';
  return counts;
}

function isBotBranch(headRefName) {
  // Branch names seen in this repository: `dependabot/npm_and_yarn/...` and `imgbot`.
  return /^(dependabot|imgbot)(\/|$)/i.test(String(headRefName ?? ''));
}

/** Open pull requests with their CI state (dependabot/imgbot filtered out). */
export function probeGitHub(repoDir, options = {}) {
  const list = execJson(
    'gh',
    [
      'pr',
      'list',
      '--state',
      'open',
      '--limit',
      '50',
      '--json',
      'number,title,headRefName,headRefOid,mergeStateStatus,statusCheckRollup',
    ],
    { cwd: repoDir, timeout: options.timeout },
  );
  if (!list.ok) return unavailable(list.reason);

  const openPrs = list.data
    .filter((pr) => !isBotBranch(pr.headRefName))
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      branch: pr.headRefName,
      sha: pr.headRefOid,
      mergeStateStatus: pr.mergeStateStatus ?? null,
      checks: summariseChecks(pr.statusCheckRollup),
    }));

  const merged = execJson(
    'gh',
    ['pr', 'list', '--state', 'merged', '--limit', '20', '--json', 'number,title,mergedAt,headRefName'],
    { cwd: repoDir, timeout: options.timeout },
  );

  const since = Date.now() - 24 * 60 * 60 * 1000;
  const mergedLast24h = merged.ok
    ? merged.data
        .filter((pr) => !isBotBranch(pr.headRefName))
        .filter((pr) => Date.parse(pr.mergedAt ?? 0) >= since)
        .map((pr) => ({ number: pr.number, title: pr.title, mergedAt: pr.mergedAt }))
    : [];

  return {
    available: true,
    openPrs,
    mergedLast24h,
    mergedAvailable: merged.ok,
    mergedReason: merged.ok ? null : merged.reason,
    master: probeMasterCi(repoDir, options),
  };
}

function probeMasterCi(repoDir, options = {}) {
  const sha = execText('git', ['rev-parse', 'origin/master'], { cwd: repoDir, timeout: options.timeout });
  const date = execText('git', ['log', '-1', '--format=%cI', 'origin/master'], {
    cwd: repoDir,
    timeout: options.timeout,
  });
  if (!sha.ok) return unavailable(sha.reason);

  const runs = execJson(
    'gh',
    [
      'run',
      'list',
      '--branch',
      'master',
      '--limit',
      '20',
      '--json',
      'headSha,status,conclusion,workflowName',
    ],
    { cwd: repoDir, timeout: options.timeout },
  );

  const base = {
    available: true,
    sha: sha.data,
    committedAt: date.ok ? date.data : null,
    ageMinutes: date.ok ? Math.max(0, Math.round((Date.now() - Date.parse(date.data)) / 60000)) : null,
  };
  if (!runs.ok) return { ...base, ci: unavailable(runs.reason) };

  const mine = runs.data.filter((run) => run.headSha === sha.data);
  const running = mine.filter((run) => run.status !== 'completed').length;
  const failed = mine.filter((run) => run.status === 'completed' && FAILING.has(String(run.conclusion).toUpperCase()));
  return {
    ...base,
    ci: {
      available: true,
      total: mine.length,
      running,
      failed: failed.map((run) => `${run.workflowName}: ${run.conclusion}`),
      state: running > 0 ? 'pending' : failed.length > 0 ? 'red' : mine.length > 0 ? 'green' : 'none',
    },
  };
}

/**
 * LoopX goal state through the READ-ONLY planner (`loopx turn plan`).
 * `loopx quota should-run` is deliberately not used: it records a turn.
 */
export function probeLoopx(repoDir, env = process.env, options = {}) {
  const registry = env.DEVCYCLE_REGISTRY
    ? path.resolve(env.DEVCYCLE_REGISTRY)
    : path.join(repoDir, '.loopx', 'registry.json');
  if (!existsSync(registry)) return unavailable(`нет registry LoopX: ${registry}`);
  const goalId = env.DEVCYCLE_GOAL_ID || 'mcp-task-knowledge-goal';
  const agentId = env.DEVCYCLE_AGENT_ID || 'claude-controller';

  const plan = execJson(
    'loopx',
    [
      '--registry',
      registry,
      '--format',
      'json',
      'turn',
      'plan',
      '--goal-id',
      goalId,
      '--agent-id',
      agentId,
      '--host',
      'claude-code',
    ],
    { cwd: repoDir, timeout: options.timeout },
  );
  if (!plan.ok) return unavailable(plan.reason);

  const envelope = plan.data?.turn_envelope ?? {};
  const selected = plan.data?.route?.selected_todo ?? null;
  return {
    available: true,
    goalId,
    agentId,
    decision: envelope.decision ?? null,
    shouldRun: envelope.should_run ?? null,
    reason: envelope.reason ?? null,
    openCount: envelope.open_count ?? null,
    selectedTodo: selected ? { id: selected.todo_id, priority: selected.priority, status: selected.status } : null,
    recommendedAction: envelope.action?.recommended_action ?? null,
    staleWarning: 'очередь LoopX может отставать от git; next считается по BACKLOG.md',
  };
}

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function resolveDbPath(env) {
  if (env.DEVCYCLE_DB) return path.resolve(env.DEVCYCLE_DB);
  return path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
}

/**
 * Project sessions and their pulse, read straight from the OpenCode database.
 * Queries are session-scoped on purpose: the database is tens of gigabytes and
 * `part` only has an index on session_id — scanning `data` would hang a cron.
 */
export function probeSessions(repoDir, env = process.env, options = {}) {
  const db = resolveDbPath(env);
  if (!existsSync(db)) return unavailable(`нет базы OpenCode: ${db}`);

  const limit = Number.isFinite(options.limit) ? options.limit : 10;
  // A worktree shares the main repository, and sessions are created in the main
  // folder, so look in both places instead of reporting "no sessions" from a
  // worktree that has none of its own.
  const directories = [repoDir];
  const commonDir = execText('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: repoDir,
    timeout: options.timeout,
  });
  if (commonDir.ok && commonDir.data) {
    const mainRoot = path.dirname(commonDir.data);
    if (mainRoot && mainRoot !== repoDir) directories.push(mainRoot);
  }
  const rows = execJson(
    'sqlite3',
    [
      '-readonly',
      '-json',
      db,
      `SELECT id, title, time_updated FROM session WHERE directory IN (${directories.map(sqlQuote).join(', ')}) AND time_archived IS NULL ORDER BY time_updated DESC LIMIT ${limit}`,
    ],
    { timeout: options.timeout, emptyAsArray: true },
  );
  if (!rows.ok) return unavailable(rows.reason);
  if (!Array.isArray(rows.data) || rows.data.length === 0) {
    return { available: true, items: [], inferred: true };
  }

  const ids = rows.data.map((row) => row.id).filter(Boolean);
  const pulse = execJson(
    'sqlite3',
    [
      '-readonly',
      '-json',
      db,
      `SELECT session_id, MAX(time_updated) AS last_part FROM part WHERE session_id IN (${ids.map(sqlQuote).join(', ')}) GROUP BY session_id`,
    ],
    { timeout: options.timeout, emptyAsArray: true },
  );

  const lastPart = new Map();
  if (pulse.ok && Array.isArray(pulse.data)) {
    for (const row of pulse.data) lastPart.set(row.session_id, row.last_part);
  }

  const now = Date.now();
  const items = rows.data.map((row) => {
    const last = lastPart.get(row.id) ?? row.time_updated ?? null;
    const ageMinutes = last ? Math.max(0, Math.round((now - Number(last)) / 60000)) : null;
    return {
      id: row.id,
      title: row.title,
      updatedAt: row.time_updated ? new Date(Number(row.time_updated)).toISOString() : null,
      lastPartAgeMinutes: ageMinutes,
      // Inferred only: without the bridge we cannot tell busy from idle, so we
      // report silence, not a guessed state.
      quiet: ageMinutes != null && ageMinutes >= 10,
    };
  });

  return { available: true, items, pulseAvailable: pulse.ok, inferred: true };
}

/** Worktrees of the repository with dirty/ahead/behind against origin/master. */
export function probeWorktrees(repoDir, options = {}) {
  const listed = execText('git', ['worktree', 'list', '--porcelain'], {
    cwd: repoDir,
    timeout: options.timeout,
  });
  if (!listed.ok) return unavailable(listed.reason);

  const blocks = listed.data.split('\n\n').filter(Boolean);
  const items = blocks.map((block) => {
    const lines = block.split('\n');
    const worktree = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length) ?? null;
    const branch =
      lines
        .find((line) => line.startsWith('branch '))
        ?.slice('branch '.length)
        .replace(/^refs\/heads\//, '') ?? null;
    const sha = lines.find((line) => line.startsWith('HEAD '))?.slice('HEAD '.length) ?? null;
    if (!worktree) return null;

    const status = execText('git', ['-C', worktree, 'status', '--porcelain'], { timeout: options.timeout });
    const counts = execText('git', ['-C', worktree, 'rev-list', '--left-right', '--count', 'origin/master...HEAD'], {
      timeout: options.timeout,
    });
    let behind = null;
    let ahead = null;
    if (counts.ok) {
      const [left, right] = counts.data.split(/\s+/);
      behind = Number(left);
      ahead = Number(right);
    }
    return {
      path: worktree,
      branch,
      sha,
      dirty: status.ok ? status.data.split('\n').filter(Boolean).length : null,
      behind,
      ahead,
      statusAvailable: status.ok && counts.ok,
    };
  });

  return { available: true, items: items.filter(Boolean) };
}

/** Last N entries of docs/dev-cycle/decisions-log.md. */
export async function probeDecisions(repoDir, options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : 3;
  const file = path.join(repoDir, 'docs', 'dev-cycle', 'decisions-log.md');
  try {
    const text = await fs.readFile(file, 'utf8');
    const entries = text
      .split('\n')
      .filter((line) => line.startsWith('### '))
      .slice(-limit)
      .reverse();
    return { available: true, items: entries.map((line) => line.slice(4).trim()) };
  } catch (error) {
    return unavailable(`нет журнала решений: ${error?.code ?? error?.message}`);
  }
}
