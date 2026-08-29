#!/usr/bin/env node
// scripts/check-backlog.mjs — Validate BACKLOG.md summary consistency (AI-004)
//
// The "Итого" row at the bottom of BACKLOG.md must match the actual task rows
// in the status tables. A "task row" is a table line starting with "| ID |"
// (e.g. "| TD-010 | ... |") whose status column is one of the known statuses.
// Rows in the strategy/archive sections are excluded by skipping lines that
// are not between a "## " section header and the next one — we only count
// sections whose tables have a header row "| ID |".

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BACKLOG = resolve(process.cwd(), 'BACKLOG.md');
const STATUSES = new Set(['done', 'completed', 'closed', 'pending', 'in_progress', 'blocked', 'deferred', 'review', 'wip']);

function main() {
  const lines = readFileSync(BACKLOG, 'utf8').split('\n');

  const summaryIdx = lines.findIndex((l) => l.includes('| **Итого**'));
  if (summaryIdx < 0) {
    console.error('BACKLOG.md: no "Итого" summary row found');
    process.exit(1);
  }

  const summaryMatch = lines[summaryIdx].match(/\|\s*\*\*Итого\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|/);
  if (!summaryMatch) {
    console.error('BACKLOG.md: cannot parse "Итого" row');
    process.exit(1);
  }
  const [, total, done, wip, pending, blocked, deferred] = summaryMatch.map(Number);

  let actualTotal = 0;
  let actualDone = 0;
  let actualWip = 0;
  let actualPending = 0;
  let actualBlocked = 0;
  let actualDeferred = 0;

  let inTable = false;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      inTable = false;
      continue;
    }
    if (!line.startsWith('|')) continue;

    // Detect table header "| ID | Задача | ..." → subsequent rows count
    if (/^\|\s*ID\s*\|/.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    // Separator rows "|----|"
    if (/^\|[-:\s|]+\|$/.test(line)) continue;
    // Task row: "| PREFIX-NNN | ... | status |"
    if (!/^\|\s*[A-Z]+-\d+\s*\|/.test(line)) continue;

    const statusMatch = line.match(/\|\s*(done|completed|closed|pending|in_progress|blocked|deferred|review|wip)\s*\|/);
    if (!statusMatch) continue;
    const status = statusMatch[1];
    actualTotal++;
    if (['done', 'completed', 'closed'].includes(status)) actualDone++;
    else if (status === 'in_progress' || status === 'wip') actualWip++;
    else if (status === 'pending') actualPending++;
    else if (status === 'blocked') actualBlocked++;
    else if (status === 'deferred') actualDeferred++;
  }

  const errors = [];
  if (actualTotal !== total) errors.push(`total: summary=${total}, actual=${actualTotal}`);
  if (actualDone !== done) errors.push(`done: summary=${done}, actual=${actualDone}`);
  if (actualWip !== wip) errors.push(`wip: summary=${wip}, actual=${actualWip}`);
  if (actualPending !== pending) errors.push(`pending: summary=${pending}, actual=${actualPending}`);
  if (actualBlocked !== blocked) errors.push(`blocked: summary=${blocked}, actual=${actualBlocked}`);
  if (actualDeferred !== deferred) errors.push(`deferred: summary=${deferred}, actual=${actualDeferred}`);

  if (errors.length) {
    console.error('BACKLOG.md summary drift:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(`BACKLOG.md summary OK: ${total} total, ${done} done, ${wip} wip, ${pending} pending, ${blocked} blocked, ${deferred} deferred`);
}

main();
