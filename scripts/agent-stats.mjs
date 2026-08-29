#!/usr/bin/env node
// scripts/agent-stats.mjs — Agent performance tracking from git history (AI-007)
//
// Analyzes commits matching a Session ID pattern ([S-...]) or a date range:
//   - commits count, PRs merged (via squash merge commits), files changed
//   - tasks completed (BACKLOG IDs mentioned in commit messages)
//   - velocity: commits per hour, lines per commit
//
// Usage:
//   node scripts/agent-stats.mjs --session S-20260829-a1b2
//   node scripts/agent-stats.mjs --since "2026-08-28 22:00" --until "2026-08-29 09:00"
//   node scripts/agent-stats.mjs --days 1

import { execFileSync } from 'node:child_process';

function parseArgs(argv) {
  const opts = { session: null, since: null, until: null, days: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--session') opts.session = argv[++i] ?? null;
    else if (a === '--since') opts.since = argv[++i] ?? null;
    else if (a === '--until') opts.until = argv[++i] ?? null;
    else if (a === '--days') opts.days = Number(argv[++i] ?? 1);
  }
  return opts;
}

function gitLog(args) {
  try {
    return execFileSync('git', ['log', ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch {
    return '';
  }
}

const opts = parseArgs(process.argv.slice(2));

// Build git log args
const logArgs = ['--pretty=format:%H|%an|%ad|%s', '--date=iso'];
if (opts.session) {
  logArgs.push(`--grep=${opts.session}`);
} else {
  if (opts.since) logArgs.push(`--since="${opts.since}"`);
  if (opts.until) logArgs.push(`--until="${opts.until}"`);
  if (opts.days && !opts.since) logArgs.push(`--since="${opts.days} days ago"`);
}
logArgs.push('--all');

const output = gitLog(logArgs);
if (!output.trim()) {
  console.log('No commits found for the given filters.');
  process.exit(0);
}

const commits = output.split('\n').filter(Boolean).map((line) => {
  const [hash, author, date, ...rest] = line.split('|');
  return { hash: hash.trim(), author: author.trim(), date: date.trim(), subject: rest.join('|').trim() };
});

// PRs = squash-merge commits "(#NNN)"
const prs = new Set();
const taskIds = new Set();
for (const c of commits) {
  const prMatch = c.subject.match(/#(\d+)\)\s*$/);
  if (prMatch) prs.add(Number(prMatch[1]));
  const taskMatches = c.subject.matchAll(/\b((?:TD|Q|BM|AI|SK|RL|WF|MEM|UI|OC|MR|CFG|D)-\d{2,4})\b/g);
  for (const m of taskMatches) taskIds.add(m[1]);
}

// Lines changed per commit (diff stat)
let insertions = 0;
let deletions = 0;
for (const c of commits) {
  const stat = gitLog(['--format=', `--numstat`, c.hash, '-1']);
  for (const line of stat.split('\n')) {
    const m = line.match(/^(\d+)\s+(\d+)\s/);
    if (m) {
      insertions += Number(m[1]);
      deletions += Number(m[2]);
    }
  }
}

// Time span
const dates = commits.map((c) => new Date(c.date).getTime()).sort((a, b) => a - b);
const spanMs = dates.length > 1 ? dates[dates.length - 1] - dates[0] : 0;
const spanHours = spanMs / 3_600_000;

console.log('=== Agent performance ===');
console.log(`Commits:          ${commits.length}`);
console.log(`PRs merged:       ${prs.size}`);
console.log(`Tasks touched:    ${taskIds.size} (${[...taskIds].slice(0, 12).join(', ')}${taskIds.size > 12 ? '…' : ''})`);
console.log(`Insertions:       ${insertions}`);
console.log(`Deletions:        ${deletions}`);
console.log(`Lines/commit:     ${commits.length ? Math.round((insertions + deletions) / commits.length) : 0}`);
console.log(`Time span:        ${spanHours.toFixed(1)} h`);
console.log(`Commits/hour:     ${spanHours > 0 ? (commits.length / spanHours).toFixed(1) : '—'}`);
console.log(`First commit:     ${dates.length ? new Date(dates[0]).toISOString().slice(0, 16) : '—'}`);
console.log(`Last commit:      ${dates.length ? new Date(dates[dates.length - 1]).toISOString().slice(0, 16) : '—'}`);
