#!/usr/bin/env node
/**
 * L1 verification of knowledge-base facts: are their anchors still alive?
 *
 * Cheap by design — the repository is indexed once (git index + suffix map + line
 * counts), then every fact is checked against that index. Semantic verification
 * (does the fact still *mean* the same) stays a manual step for used facts.
 *
 * Statuses written back to `tags` as `state:<status>`:
 *   verified       at least one anchor resolves in the current checkout
 *   pending-merge  not in the checkout, but present on a ticket branch (DEV-1234-…)
 *   stale          no anchor resolves anywhere
 *   no-anchor      the fact carries no file/symbol anchor at all
 *
 * Budgets: --limit N (facts) and --budget-ms (wall clock, default 120s). Facts not
 * reached are reported as `skipped` and never written.
 *
 * Usage:
 *   node scripts/verify-memory.mjs --repo ~/work/ALB --project agent-memory [--write] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PATH_RE = /([\w@.+-]+(?:\/[\w@.+-]+)+\.(?:php|md|json|ya?ml|sh|ts|tsx|js|mjs|sql))(?::(\d+)(?:-(\d+))?)?/g;
const BARE_FILE_RE = /(?<![\w/])([\w@.+-]+\.(?:php|md|json|ya?ml|sh|ts|tsx|js|mjs|sql))(?::(\d+)(?:-(\d+))?)?/g;
const CLASS_RE = /\b([A-Z][A-Za-z0-9_]+)::([a-zA-Z0-9_]+)\b/g;
const TICKET_RE = /\b(?:DEV|BT|AUD|FRONT)-\d+\b/;

/**
 * Extract path and `Class::method` anchors from a fact's title + content.
 * With `repoTops` (first path segments of the git index), a path outside the repo's
 * top-level dirs (`/tmp/x.php`, `~/.zshrc`) is weak: illustrative, not an anchor.
 */
export function anchorsOf(text, repoTops) {
  const out = [];
  const seen = new Set();
  const push = (anchor) => {
    const key = JSON.stringify(anchor);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(anchor);
  };
  for (const m of String(text ?? '').matchAll(PATH_RE)) {
    const top = m[1].split('/')[0];
    push({ kind: 'path', file: m[1], from: m[2] ? Number(m[2]) : null, to: m[3] ? Number(m[3]) : null, strong: repoTops ? repoTops.has(top) : true });
  }
  for (const m of String(text ?? '').matchAll(BARE_FILE_RE)) {
    // A bare filename with a line number still asserts a repo location; one without it
    // is often just an artifact name in prose ("article-compact.md"), so it is weak:
    // it can confirm a fact but never makes one stale.
    push({ kind: 'path', file: m[1], from: m[2] ? Number(m[2]) : null, to: m[3] ? Number(m[3]) : null, strong: Boolean(m[2]) });
  }
  for (const m of String(text ?? '').matchAll(CLASS_RE)) {
    push({ kind: 'symbol', className: m[1], method: m[2], strong: true });
  }
  return out;
}

/** Map every path suffix to the tracked files that end with it (longest suffix wins). */
export function buildSuffixIndex(files) {
  const index = new Map();
  for (const file of files) {
    const parts = file.split('/');
    for (let i = 1; i <= Math.min(parts.length, 3); i++) {
      const suffix = parts.slice(-i).join('/');
      const bucket = index.get(suffix) ?? [];
      bucket.push(file);
      index.set(suffix, bucket);
    }
  }
  return index;
}

/** Resolve an anchor's file against the git index; exact match first, then suffix. */
export function resolveRepoPath(file, index, fileSet) {
  if (!file) return undefined;
  const normalized = file.replace(/^\.\//, '');
  if (fileSet?.has(normalized)) return normalized;
  const bucket = index.get(normalized);
  if (!bucket || bucket.length === 0) return undefined;
  if (bucket.length === 1) return bucket[0];
  return bucket.slice().sort((a, b) => a.length - b.length)[0];
}

/** Line range check — an anchor pointing past EOF means the fact drifted. */
export function lineInRange(from, to, lineCount) {
  if (!from) return true;
  if (!lineCount) return false;
  if (from > lineCount) return false;
  if (to && to > lineCount) return false;
  return true;
}

/** Ticket referenced by a fact (DEV-1234, BT-12, …), if any. */
export function ticketOf(text) {
  const m = String(text ?? '').match(TICKET_RE);
  return m ? m[0] : null;
}

/** Branch names belonging to a ticket: exact name or `<ticket>-<slug>`. */
export function branchesFor(ticket, branches) {
  if (!ticket) return [];
  return branches.filter((b) => b === ticket || b.startsWith(`${ticket}-`) || b.startsWith(`${ticket}_`));
}

// ── git access with memoization and a hard call budget ───────────────

function makeGit(repo, maxCalls) {
  const memo = new Map();
  let calls = 0;
  const git = (args) => {
    const key = args.join('\u0000');
    if (memo.has(key)) return memo.get(key);
    if (calls >= maxCalls) throw new Error(`git call budget exhausted (${maxCalls})`);
    calls += 1;
    let out = '';
    try {
      out = execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
    } catch {
      out = '';
    }
    memo.set(key, out);
    return out;
  };
  return { git, calls: () => calls };
}

function buildRepoIndex(repo, git, budgetMs, startedAt) {
  const files = git(['ls-files']).split('\n').filter(Boolean);
  const fileSet = new Set(files);
  const suffixIndex = buildSuffixIndex(files);
  const lineCounts = new Map();
  const lineCount = (rel) => {
    if (lineCounts.has(rel)) return lineCounts.get(rel);
    let count = 0;
    if (Date.now() - startedAt > budgetMs) {
      lineCounts.set(rel, 0);
      return 0;
    }
    try {
      count = fs.readFileSync(path.join(repo, rel), 'utf8').split('\n').length;
    } catch {
      count = 0;
    }
    lineCounts.set(rel, count);
    return count;
  };
  const repoTops = new Set(files.map((f) => f.split('/')[0]));
  return { files, fileSet, suffixIndex, lineCount, repoTops };
}

function checkPath(anchor, index) {
  const rel = resolveRepoPath(anchor.file, index.suffixIndex, index.fileSet);
  if (!rel) return { status: 'missing', reason: 'file not in git index' };
  if (!lineInRange(anchor.from, anchor.to, index.lineCount(rel))) {
    return { status: 'missing', rel, reason: 'line out of range' };
  }
  return { status: 'verified', rel };
}

function checkSymbol(anchor, git) {
  const hits = git(['grep', '-l', '-E', `(class|interface|trait)\\s+${anchor.className}\\b`, '--', '*.php'])
    .split('\n')
    .filter(Boolean);
  if (hits.length === 0) return { status: 'missing', reason: 'class not found' };
  for (const file of hits) {
    const body = git(['grep', '-l', '-E', `function\\s+${anchor.method}\\s*\\(`, '--', file]);
    if (body.trim()) return { status: 'verified', rel: file };
  }
  return { status: 'missing', reason: 'method not found' };
}

function checkAnchors(anchors, index, git) {
  for (const anchor of anchors) {
    const result = anchor.kind === 'path' ? checkPath(anchor, index) : checkSymbol(anchor, git);
    if (result.status === 'verified') return result;
  }
  return { status: 'missing' };
}

/** Is any anchor present on a branch of the fact's ticket? */
function onTicketBranch(text, anchors, git, branchFiles) {
  const ticket = ticketOf(text);
  if (!ticket) return false;
  const branches = branchesFor(ticket, git(['for-each-ref', '--format=%(refname:short)', 'refs/heads']).split('\n').filter(Boolean));
  for (const branch of branches.slice(0, 5)) {
    let files = branchFiles.get(branch);
    if (!files) {
      files = new Set(git(['ls-tree', '-r', '--name-only', branch]).split('\n').filter(Boolean));
      branchFiles.set(branch, files);
    }
    const suffixIndex = buildSuffixIndex([...files]);
    for (const anchor of anchors) {
      if (anchor.kind === 'path') {
        if (resolveRepoPath(anchor.file, suffixIndex, files)) return true;
      } else if (git(['grep', '-l', '-E', `function\\s+${anchor.method}\\s*\\(`, branch, '--', '*.php']).trim()) {
        return true;
      }
    }
  }
  return false;
}

export function classifyFact(text, index, git) {
  const anchors = anchorsOf(text, index.repoTops);
  if (anchors.length === 0) return { status: 'no-anchor', anchors };
  const direct = checkAnchors(anchors, index, git);
  if (direct.status === 'verified') return { status: 'verified', anchors, rel: direct.rel };
  if (!anchors.some((a) => a.strong)) return { status: 'no-anchor', anchors };
  const branchFiles = new Map();
  if (onTicketBranch(text, anchors, git, branchFiles)) return { status: 'pending-merge', anchors };
  return { status: 'stale', anchors };
}

// ── MCP client ───────────────────────────────────────────────────────

function rpcClient(child) {
  let buf = '';
  const pending = new Map();
  let nextId = 1;
  child.stdout.on('data', (c) => {
    buf += c.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && pending.has(msg.id)) {
          pending.get(msg.id)(msg);
          pending.delete(msg.id);
        }
      } catch {}
    }
  });
  const call = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  return { call };
}

const payloadOf = (response, fallback) => {
  const text = response?.result?.content?.[0]?.text;
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const flag = (name) => argv.includes(`--${name}`);

  const REPO = path.resolve(arg('repo', process.cwd()));
  const PROJECT = arg('project', 'agent-memory');
  const SERVER = arg('server', path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js'));
  const WRITE = flag('write');
  const JSON_OUT = flag('json');
  const LIMIT = Number(arg('limit', '0')) || Infinity;
  const BUDGET_MS = Number(arg('budget-ms', '120000')) || 120000;
  const MAX_GIT_CALLS = Number(arg('max-git-calls', '5000')) || 5000;
  const startedAt = Date.now();

  const { git } = makeGit(REPO, MAX_GIT_CALLS);
  const index = buildRepoIndex(REPO, git, BUDGET_MS, startedAt);
  const mergedBranches = git(['branch', '--merged', 'HEAD']).split('\n').map((l) => l.replace(/^[* ]+/, '').trim()).filter(Boolean);

  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, MCP_TRANSPORT: 'stdio', LOG_LEVEL: 'silent', DATA_DIR: process.env.DATA_DIR ?? '/data' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr.on('data', () => {});
  const rpc = rpcClient(child);
  await rpc.call('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'verify-memory', version: '2.0' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const listed = payloadOf(await rpc.call('tools/call', { name: 'knowledge_list', arguments: { project: PROJECT } }), { data: [] });
  const docs = (listed.data ?? []).filter((d) => ['memory_facts', 'memory_fact', 'memory_pattern'].includes(d.type ?? '')).slice(0, LIMIT);

  const stats = { verified: 0, 'pending-merge': 0, stale: 0, 'no-anchor': 0, skipped: 0 };
  const samples = { stale: [], 'pending-merge': [], 'no-anchor': [], skipped: [] };
  const updates = [];
  let elapsedBudgetHit = false;

  for (const meta of docs) {
    if (Date.now() - startedAt > BUDGET_MS) {
      elapsedBudgetHit = true;
      stats.skipped += 1;
      if (samples.skipped.length < 5) samples.skipped.push(meta.title ?? meta.id);
      continue;
    }
    const full = payloadOf(await rpc.call('tools/call', { name: 'knowledge_get', arguments: { project: PROJECT, id: meta.id } }), {});
    const doc = full.data ?? full;
    const text = `${meta.title ?? ''}\n${doc.content ?? ''}`;
    const verdict = classifyFact(text, index, git);
    stats[verdict.status] += 1;
    if (samples[verdict.status] && samples[verdict.status].length < 5) samples[verdict.status].push(meta.title ?? meta.id);

    const baseTags = (meta.tags ?? []).filter((t) => !/^(state|verified|ok):/.test(String(t)));
    const tags = [...baseTags, `state:${verdict.status}`, `verified:${new Date().toISOString().slice(0, 10)}`];
    if (WRITE && JSON.stringify(tags) !== JSON.stringify(meta.tags ?? [])) updates.push({ id: meta.id, tags });
  }

  for (let i = 0; i < updates.length; i += 25) {
    await rpc.call('tools/call', { name: 'knowledge_bulk_update', arguments: { project: PROJECT, items: updates.slice(i, i + 25) } });
  }

  child.stdin.end();
  child.kill('SIGTERM');

  const total = docs.length;
  const report = {
    project: PROJECT,
    repo: REPO,
    facts: total,
    stats,
    elapsedMs: Date.now() - startedAt,
    budgetMs: BUDGET_MS,
    budgetExhausted: elapsedBudgetHit,
    mergedBranches: mergedBranches.length,
    written: WRITE ? updates.length : 0,
    samples,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const pct = (n) => `${((n / (total || 1)) * 100).toFixed(0)}%`;
  console.log(`проверено фактов: ${total} (проект ${PROJECT}, репо ${REPO})`);
  for (const key of ['verified', 'pending-merge', 'stale', 'no-anchor', 'skipped']) {
    console.log(`  ${key.padEnd(13)} ${stats[key]} (${pct(stats[key])})`);
  }
  if (elapsedBudgetHit) console.log(`  бюджет ${BUDGET_MS}ms исчерпан — часть фактов пропущена (statuses не записаны)`);
  for (const key of ['stale', 'pending-merge', 'no-anchor', 'skipped']) {
    if (samples[key].length) {
      console.log(`\n${key}:`);
      for (const title of samples[key]) console.log(`  · ${String(title).slice(0, 100)}`);
    }
  }
  console.log(`\n${WRITE ? `записано обновлений: ${updates.length}` : 'режим отчёта (--write чтобы записать статусы)'}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => {
    console.error('verify-memory failed:', e?.stack || e);
    process.exit(1);
  });
}
