#!/usr/bin/env node
// scripts/devcycle.mjs — development-cycle control for the mcp-task-knowledge loop.
//
// The command is split into two kinds of work, and the split is the contract:
//
//   PROBES (read-only)  status, next, state get, report
//     No writes to the repository, no `git fetch`, no LoopX turn consumption.
//     Safe to run from a cron and safe to run twice.
//
//   ACTIONS (mutating)  state enable|disable, log, tick
//     `tick` takes a single-writer lock, refuses to run while the loop is
//     disabled, and is the only place that fetches from origin.
//
// Exit codes: 0 ok, 1 error, 2 bad arguments, 3 skipped (disabled or locked).
//
// Env:
//   DEVCYCLE_REPO        repository root (default: process.cwd())
//   DEVCYCLE_BACKLOG     BACKLOG file (default: <repo>/BACKLOG.md)
//   DEVCYCLE_STATE_DIR   local state dir (default: <repo>/.devcycle, gitignored)
//   DEVCYCLE_REGISTRY    LoopX registry (default: <repo>/.loopx/registry.json)
//   DEVCYCLE_GOAL_ID     LoopX goal (default: mcp-task-knowledge-goal)
//   DEVCYCLE_AGENT_ID    LoopX agent (default: claude-controller)
//   DEVCYCLE_DB          OpenCode database (default: ~/.local/share/opencode/opencode.db)
//   DEVCYCLE_LOCK_STALE_MS  lock age after which it is considered stale (default 30 min)
//
// Usage: node scripts/devcycle.mjs <command> [options]

import { parseArgs } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parseBacklog, selectNext } from './lib/devcycle-backlog.mjs';
import {
  acquireLock,
  appendLog,
  readState,
  resolveStateDir,
  writeState,
} from './lib/devcycle-state.mjs';
import {
  execText,
  probeDecisions,
  probeGitHub,
  probeLoopx,
  probeSessions,
  probeWorktrees,
} from './lib/devcycle-probe.mjs';

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_USAGE = 2;
const EXIT_SKIP = 3;

const USAGE = `devcycle — управление циклом разработки

Пробы (только чтение, ничего не меняют):
  status [--json] [--fetch]        состояние цикла: LoopX, PR/CI, сессии, worktree, решения
  next [--json] [--limit N]        следующий пункт BACKLOG по правилам очереди
  state get [--json]               локальное состояние цикла
  report [--json]                  отчёт: решения, открытые и смерженные PR, CI master

Действия:
  state enable [--cron-id ID]      включить цикл (записать since)
  state disable [--reason TEXT]    остановить цикл (записать причину)
  log "<текст>"                    дописать строку в .devcycle/log.md
  tick [--dry-run] [--json]        один тик: lock, проверка state, git fetch, лог

Опции:
  --backlog <path>   путь к BACKLOG.md (по умолчанию $DEVCYCLE_BACKLOG или ./BACKLOG.md)
  --json             машиночитаемый вывод (стабильная схема)
  --help             эта справка

Коды возврата: 0 — ok, 1 — ошибка, 2 — неверные аргументы, 3 — пропуск (цикл выключен или lock занят).
`;

function fail(message, code = EXIT_ERROR) {
  process.stderr.write(`devcycle: ${message}\n`);
  process.exit(code);
}

function repoDir() {
  return path.resolve(process.env.DEVCYCLE_REPO || process.cwd());
}

function backlogPath(options) {
  if (options.backlog) return path.resolve(options.backlog);
  if (process.env.DEVCYCLE_BACKLOG) return path.resolve(process.env.DEVCYCLE_BACKLOG);
  return path.join(repoDir(), 'BACKLOG.md');
}

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function stamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

async function loadBacklog(file) {
  let markdown;
  try {
    markdown = await fs.readFile(file, 'utf8');
  } catch (error) {
    fail(`не читается BACKLOG (${file}): ${error?.code ?? error?.message}`);
  }
  return parseBacklog(markdown);
}

async function commandStatus(options) {
  const repo = repoDir();
  const stateDir = resolveStateDir(process.env, repo);

  if (options.fetch) {
    // Opt-in only: a probe must not change the working tree or refs by itself.
    const fetched = execText('git', ['fetch', 'origin'], { cwd: repo, timeout: 60_000 });
    if (!fetched.ok) process.stderr.write(`devcycle: fetch не удался: ${fetched.reason}\n`);
  }

  const state = await readState(stateDir);
  const loopx = probeLoopx(repo, process.env);
  const github = probeGitHub(repo);
  const sessions = probeSessions(repo, process.env);
  const worktrees = probeWorktrees(repo);
  const decisions = await probeDecisions(repo);

  const payload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    repo,
    cycle: {
      available: true,
      stateDir,
      enabled: Boolean(state.enabled),
      since: state.since ?? null,
      cronId: state.cronId ?? null,
      stopReason: state.stopReason ?? null,
      lastTick: state.lastTick ?? null,
      lastResult: state.lastResult ?? null,
    },
    loopx,
    github,
    sessions,
    worktrees,
    decisions,
  };

  if (options.json) {
    printJson(payload);
    return EXIT_OK;
  }

  const out = [];
  out.push(`Репозиторий: ${repo}`);
  out.push(
    `Цикл: ${state.enabled ? 'включён' : 'остановлен'}` +
      `${state.since ? `, с ${stamp(state.since)}` : ''}` +
      `${state.cronId ? `, cron ${state.cronId}` : ', cron не записан'}` +
      `${state.stopReason ? `, причина остановки: ${state.stopReason}` : ''}` +
      `${state.lastTick ? `, последний тик ${stamp(state.lastTick)}` : ''}`,
  );

  if (loopx.available) {
    out.push(
      `LoopX: решение ${loopx.decision ?? '—'}, открытых todo ${loopx.openCount ?? '—'}` +
        `${loopx.selectedTodo ? `, выбран ${loopx.selectedTodo.id} (${loopx.selectedTodo.priority})` : ''}` +
        ` — ${loopx.staleWarning}`,
    );
  } else {
    out.push(`LoopX: n/a (${loopx.reason})`);
  }

  if (github.available) {
    const prs = github.openPrs.length
      ? github.openPrs
          .map((pr) => `#${pr.number} ${pr.branch} CI ${pr.checks.state} ${pr.mergeStateStatus ?? '—'}`)
          .join('; ')
      : 'нет открытых PR';
    out.push(`GitHub: ${prs}`);
    if (github.master.available) {
      const ci = github.master.ci;
      out.push(
        `master: ${github.master.sha?.slice(0, 7)} от ${stamp(github.master.committedAt)}` +
          (github.master.ageMinutes != null ? ` (${github.master.ageMinutes} мин назад)` : '') +
          (ci?.available
            ? `, CI ${ci.state} (${ci.total} прогонов${ci.running ? `, идёт ${ci.running}` : ''}${ci.failed?.length ? `, красных ${ci.failed.length}` : ''})`
            : `, CI n/a (${ci?.reason ?? 'нет данных'})`),
      );
    } else {
      out.push(`master: n/a (${github.master.reason})`);
    }
  } else {
    out.push(`GitHub: n/a (${github.reason})`);
  }

  if (sessions.available) {
    if (sessions.items.length === 0) out.push('OpenCode: сессий проекта нет');
    else {
      const items = sessions.items
        .slice(0, 5)
        .map(
          (item) =>
            `${item.id.slice(0, 12)} «${item.title}» — тишина ${item.lastPartAgeMinutes ?? '?'} мин`,
        )
        .join('; ');
      out.push(`OpenCode (по базе, без моста): ${items}`);
    }
  } else {
    out.push(`OpenCode: n/a (${sessions.reason})`);
  }

  if (worktrees.available) {
    const items = worktrees.items
      .map(
        (item) =>
          `${path.basename(item.path)}: ${item.branch ?? 'detached'}` +
          `${item.dirty == null ? ' dirty?' : item.dirty ? ` dirty=${item.dirty}` : ' clean'}` +
          `${item.behind == null ? '' : `, ahead ${item.ahead}/behind ${item.behind}`}`,
      )
      .join('; ');
    out.push(`Worktrees (${worktrees.items.length}): ${items}`);
  } else {
    out.push(`Worktrees: n/a (${worktrees.reason})`);
  }

  out.push(
    decisions.available
      ? `Решения (последние ${decisions.items.length}): ${decisions.items.join(' | ') || '—'}`
      : `Решения: n/a (${decisions.reason})`,
  );

  process.stdout.write(`${out.join('\n')}\n`);
  return EXIT_OK;
}

async function commandNext(options) {
  const file = backlogPath(options);
  const { items, counts } = await loadBacklog(file);
  const limit = options.limit == null ? 10 : Number(options.limit);
  if (!Number.isFinite(limit) || limit < 0) fail('--limit должен быть неотрицательным числом', EXIT_USAGE);
  const selection = selectNext(items, { limit });

  const payload = {
    ok: true,
    backlog: file,
    counts,
    chosen: selection.chosen
      ? {
          id: selection.chosen.id,
          title: selection.chosen.title,
          priority: selection.chosen.priority,
          status: selection.chosen.status,
          deps: selection.chosen.deps,
          section: selection.chosen.section,
        }
      : null,
    eligible: selection.eligible,
    skipped: selection.skipped,
    skippedTotal: selection.skippedTotal,
  };

  if (options.json) {
    printJson(payload);
    return EXIT_OK;
  }

  const out = [];
  out.push(`BACKLOG: ${file} (${counts.total} пунктов, pending ${counts.pending}, blocked ${counts.blocked}, deferred ${counts.deferred})`);
  if (selection.chosen) {
    const chosen = selection.chosen;
    out.push(`Следующий: ${chosen.id} — ${chosen.title}`);
    out.push(`  приоритет: ${chosen.priority ?? '—'}; зависимости: ${chosen.deps || '—'}; этап: ${chosen.section ?? '—'}`);
    out.push(
      `  причина: статус pending, приоритет ${chosen.priority ?? '—'} — старший из доступных, все зависимости done` +
        ` (всего подходящих: ${selection.eligible})`,
    );
  } else {
    out.push('Следующий: нет подходящих пунктов');
  }
  if (selection.skipped.length > 0) {
    out.push(`Пропущено ${selection.skippedTotal}:`);
    for (const item of selection.skipped) out.push(`  - ${item.id}: ${item.reason}`);
  }
  process.stdout.write(`${out.join('\n')}\n`);
  return EXIT_OK;
}

async function commandState(options) {
  const stateDir = resolveStateDir(process.env, repoDir());
  const action = options.positionals[0] ?? 'get';

  if (action === 'get') {
    const state = await readState(stateDir);
    if (options.json) printJson({ ok: true, stateDir, state });
    else {
      process.stdout.write(
        `Цикл: ${state.enabled ? 'включён' : 'остановлен'}` +
          `${state.since ? `, с ${stamp(state.since)}` : ''}` +
          `${state.cronId ? `, cron ${state.cronId}` : ''}` +
          `${state.stopReason ? `, причина: ${state.stopReason}` : ''}\n` +
          `state: ${path.join(stateDir, 'state.json')}\n`,
      );
    }
    return EXIT_OK;
  }

  if (action === 'enable') {
    const state = await writeState(stateDir, {
      enabled: true,
      since: new Date().toISOString(),
      stopReason: null,
      cronId: options['cron-id'] ?? null,
    });
    await appendLog(stateDir, `цикл включён${state.cronId ? `, cron ${state.cronId}` : ''}`);
    if (options.json) printJson({ ok: true, stateDir, state });
    else process.stdout.write(`Цикл включён${state.cronId ? `, cron ${state.cronId}` : ''}\n`);
    return EXIT_OK;
  }

  if (action === 'disable') {
    const state = await writeState(stateDir, {
      enabled: false,
      stopReason: options.reason ?? 'остановлено вручную',
    });
    await appendLog(stateDir, `цикл остановлен: ${state.stopReason}`);
    if (options.json) printJson({ ok: true, stateDir, state });
    else process.stdout.write(`Цикл остановлен: ${state.stopReason}\n`);
    return EXIT_OK;
  }

  fail(`неизвестное действие state: ${action}`, EXIT_USAGE);
  return EXIT_USAGE;
}

async function commandLog(options) {
  const text = options.positionals.join(' ').trim();
  if (!text) fail('log требует текст: devcycle log "<текст>"', EXIT_USAGE);
  const stateDir = resolveStateDir(process.env, repoDir());
  const line = await appendLog(stateDir, text);
  process.stdout.write(`${line}\n`);
  return EXIT_OK;
}

async function commandTick(options) {
  const repo = repoDir();
  const stateDir = resolveStateDir(process.env, repo);
  const staleMs = Number(process.env.DEVCYCLE_LOCK_STALE_MS ?? 30 * 60 * 1000);
  const lock = await acquireLock(stateDir, { staleMs: Number.isFinite(staleMs) ? staleMs : 30 * 60 * 1000 });

  if (!lock.ok) {
    const message = `skip: locked by pid ${lock.holder.pid} (${Math.round(lock.holder.ageMs / 1000)} с)`;
    await appendLog(stateDir, message);
    if (options.json) printJson({ ok: false, skipped: 'locked', holder: lock.holder });
    else process.stdout.write(`${message}\n`);
    return EXIT_SKIP;
  }

  try {
    const state = await readState(stateDir);
    if (!state.enabled) {
      const message = 'skip: цикл выключен (state.enabled=false)';
      await appendLog(stateDir, message);
      if (options.json) printJson({ ok: false, skipped: 'disabled', state });
      else process.stdout.write(`${message}\n`);
      return EXIT_SKIP;
    }

    const plan = {
      repo,
      dryRun: Boolean(options['dry-run']),
      fetched: false,
      next: null,
    };

    if (options['dry-run']) {
      const { items } = await loadBacklog(backlogPath(options));
      const selection = selectNext(items, { limit: 3 });
      plan.next = selection.chosen ? { id: selection.chosen.id, title: selection.chosen.title } : null;
      // Test-only knob: widens the lock window so a race test is deterministic.
      const hold = Number(process.env.DEVCYCLE_TEST_HOLD_MS ?? 0);
      if (Number.isFinite(hold) && hold > 0) await new Promise((resolve) => setTimeout(resolve, hold));
      if (options.json) printJson({ ok: true, plan });
      else {
        process.stdout.write(
          `Тик (dry-run): цикл включён, следующий пункт ${plan.next ? `${plan.next.id} — ${plan.next.title}` : 'нет'}\n`,
        );
      }
      return EXIT_OK;
    }

    const fetched = execText('git', ['fetch', 'origin'], { cwd: repo, timeout: 120_000 });
    plan.fetched = fetched.ok;
    if (!fetched.ok) {
      await appendLog(stateDir, `tick: git fetch не удался (${fetched.reason})`);
    }

    const { items } = await loadBacklog(backlogPath(options));
    const selection = selectNext(items, { limit: 3 });
    plan.next = selection.chosen ? { id: selection.chosen.id, title: selection.chosen.title } : null;

    const now = new Date().toISOString();
    const result = plan.next ? `next=${plan.next.id}` : 'next=none';
    await writeState(stateDir, { lastTick: now, lastResult: result });
    await appendLog(stateDir, `tick: ${result}${plan.fetched ? ', fetch ok' : ', fetch failed'}`);

    if (options.json) printJson({ ok: true, plan: { ...plan, at: now } });
    else process.stdout.write(`Тик выполнен: ${result}${plan.fetched ? ', fetch ok' : ', fetch не удался'}\n`);
    return EXIT_OK;
  } finally {
    await lock.release();
  }
}

async function commandReport(options) {
  const repo = repoDir();
  const github = probeGitHub(repo);
  const decisions = await probeDecisions(repo, { limit: 10 });

  const payload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    decisions,
    github,
  };
  if (options.json) {
    printJson(payload);
    return EXIT_OK;
  }

  const out = [];
  out.push('Отчёт цикла разработки');
  out.push('');
  out.push('Решения контролёра:');
  if (decisions.available && decisions.items.length > 0) {
    for (const item of decisions.items) out.push(`  - ${item}`);
  } else {
    out.push(`  n/a (${decisions.reason ?? 'записей нет'})`);
  }
  out.push('');
  if (!github.available) {
    out.push(`GitHub: n/a (${github.reason})`);
    process.stdout.write(`${out.join('\n')}\n`);
    return EXIT_OK;
  }
  out.push('Открытые PR:');
  if (github.openPrs.length === 0) out.push('  нет');
  for (const pr of github.openPrs) {
    out.push(
      `  - #${pr.number} ${pr.branch}: CI ${pr.checks.state} (pass ${pr.checks.pass}/${pr.checks.total}), ${pr.mergeStateStatus ?? '—'}`,
    );
  }
  out.push('');
  out.push('Смержено за 24 часа:');
  if (!github.mergedAvailable) out.push(`  n/a (${github.mergedReason})`);
  else if (github.mergedLast24h.length === 0) out.push('  нет');
  else for (const pr of github.mergedLast24h) out.push(`  - #${pr.number} ${pr.title} (${stamp(pr.mergedAt)})`);

  process.stdout.write(`${out.join('\n')}\n`);
  return EXIT_OK;
}

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: 'boolean', default: false },
        fetch: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        backlog: { type: 'string' },
        limit: { type: 'string' },
        reason: { type: 'string' },
        'cron-id': { type: 'string' },
        help: { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    process.stderr.write(`${USAGE}\n`);
    return fail(error?.message ?? 'неверные аргументы', EXIT_USAGE);
  }

  const { values, positionals } = parsed;
  if (values.help || positionals.length === 0) {
    process.stdout.write(USAGE);
    return values.help ? EXIT_OK : EXIT_USAGE;
  }

  const options = { ...values, positionals: positionals.slice(1), limit: values.limit };
  const command = positionals[0];

  switch (command) {
    case 'status':
      return commandStatus(options);
    case 'next':
      return commandNext(options);
    case 'state':
      return commandState(options);
    case 'log':
      return commandLog(options);
    case 'tick':
      return commandTick(options);
    case 'report':
      return commandReport(options);
    case 'help':
      process.stdout.write(USAGE);
      return EXIT_OK;
    default:
      process.stderr.write(`devcycle: неизвестная команда «${command}»\n${USAGE}`);
      return EXIT_USAGE;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`devcycle: ${error?.stack ?? error?.message ?? error}\n`);
    process.exitCode = EXIT_ERROR;
  });
