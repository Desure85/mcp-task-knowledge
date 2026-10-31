#!/usr/bin/env node
/**
 * scripts/bench/seed-scale.mjs — synthetic dataset generator for scale benchmarks.
 *
 * Writes files DIRECTLY in the on-disk format the server reads (no server needed):
 *   <out>/tasks/<project>/<id>.json        — one pretty-printed JSON per task
 *   <out>/knowledge/<project>/<id>.md      — frontmatter + markdown body per doc
 *   <out>/memory/temporal-graph.json       — optional temporal-graph seed (--facts N)
 *
 * Deterministic for a given --seed, so two runs produce byte-identical corpora and
 * benchmark numbers stay comparable across machines/dates.
 *
 * NOT part of CI and NOT part of `npm test`. See scripts/bench/README.md.
 *
 * Usage:
 *   node scripts/bench/seed-scale.mjs --n 10000 --out /tmp/mcp-scale/data-10000
 *   node scripts/bench/seed-scale.mjs --n 100000 --out /tmp/x --facts 100000 --seed 7
 *   node scripts/bench/seed-scale.mjs --n 1000 --out /tmp/x --docs-only
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

// ─── args ───────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    n: 0,
    out: '',
    project: 'bench',
    seed: 20261031,
    facts: 0,
    tasks: true,
    docs: true,
    concurrency: 64,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '--n': out.n = Number(next()); break;
      case '--out': out.out = next(); break;
      case '--project': out.project = next(); break;
      case '--seed': out.seed = Number(next()); break;
      case '--facts': out.facts = Number(next()); break;
      case '--concurrency': out.concurrency = Number(next()); break;
      case '--tasks-only': out.docs = false; break;
      case '--docs-only': out.tasks = false; break;
      case '--quiet': out.quiet = true; break;
      case '-h':
      case '--help':
        console.log(
          'usage: node scripts/bench/seed-scale.mjs --n <count> --out <DATA_DIR> [--project p] [--seed s] [--facts n] [--tasks-only|--docs-only] [--concurrency 64] [--quiet]',
        );
        process.exit(0);
        break;
      default:
        throw new Error(`unknown arg: ${a}`);
    }
  }
  if (!out.out) throw new Error('--out is required (isolated DATA_DIR)');
  if (!Number.isFinite(out.n) || out.n < 0) throw new Error('--n must be a non-negative number');
  if (!Number.isFinite(out.facts) || out.facts < 0) throw new Error('--facts must be >= 0');
  return out;
}

// ─── deterministic PRNG (mulberry32) ────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** UUID-v4-shaped deterministic id: stable, sortable by counter, unique per run. */
function makeId(index, rand) {
  const tail = (index >>> 0).toString(16).padStart(8, '0');
  const rnd = Math.floor(rand() * 0xffffffff).toString(16).padStart(8, '0');
  return `b3e1a2c4-${rnd.slice(0, 4)}-4${rnd.slice(4, 7)}-8${tail.slice(0, 3)}-${tail}${rnd.slice(0, 4)}`;
}

// ─── plausible content ──────────────────────────────────────────────

const STATUSES = ['pending', 'in_progress', 'completed', 'closed', 'blocked'];
const STATUS_WEIGHTS = [0.38, 0.22, 0.24, 0.12, 0.04];
const PRIORITIES = ['low', 'medium', 'high'];
const PRIORITY_WEIGHTS = [0.25, 0.55, 0.2];
const TAG_POOL = [
  'backend', 'frontend', 'infra', 'search', 'storage', 'api', 'docs', 'perf',
  'security', 'mcp', 'ui', 'bench', 'bug', 'feature', 'refactor', 'test',
  'sqlite', 'index', 'pagination', 'memory', 'graph', 'docker', 'ci', 'release',
  'task', 'knowledge', 'prompt', 'agent', 'sync', 'cluster',
];
const TYPES = ['component', 'api', 'schemas', 'routes', 'overview', 'runbook', 'adr', 'note'];
const VERBS = ['Add', 'Fix', 'Refactor', 'Document', 'Investigate', 'Optimize', 'Remove', 'Introduce', 'Harden', 'Measure'];
const NOUNS = [
  'cursor pagination', 'BM25 index', 'task tree rendering', 'knowledge frontmatter parsing',
  'temporal graph persistence', 'claim lease sweeper', 'dashboard aggregation', 'search cache',
  'file lock contention', 'atomic write path', 'dependency cycle detection', 'embedding warmup',
  'project status transitions', 'bulk archive flow', 'git history layer', 'rate limiter',
  'auth gate decision', 'stdio transport handshake', 'streamable HTTP session', 'web UI board',
];
const WORDS = (
  'the task index query storage search document project cursor offset pagination limit filter ' +
  'metadata frontmatter markdown chunk embedding vector lexical corpus latency throughput memory ' +
  'filesystem directory inode readdir stat cache lock lease claim graph node edge cluster shard ' +
  'archive trash retention snapshot version commit transaction atomic rename write read parse ' +
  'server client transport session token auth role scope tenant workspace dashboard briefing ' +
  'board column kanban virtual list render paint layout svg node edge zoom detail legend'
).split(/\s+/);

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length) % arr.length];
}

function pickWeighted(rand, arr, weights) {
  let r = rand();
  for (let i = 0; i < arr.length; i++) {
    r -= weights[i];
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}

function tagsFor(rand, max = 4) {
  const count = Math.floor(rand() * (max + 1));
  const tags = new Set();
  for (let i = 0; i < count; i++) tags.add(pick(rand, TAG_POOL));
  return [...tags];
}

/** Sentence-ish text of roughly `approxBytes` UTF-8 bytes (ASCII only → 1 byte/char). */
function textOfBytes(rand, approxBytes) {
  const parts = [];
  let bytes = 0;
  while (bytes < approxBytes) {
    const sentence = [];
    const words = 6 + Math.floor(rand() * 12);
    for (let i = 0; i < words; i++) sentence.push(pick(rand, WORDS));
    sentence[0] = sentence[0][0].toUpperCase() + sentence[0].slice(1);
    const line = sentence.join(' ') + '.';
    parts.push(line);
    bytes += line.length + 1;
  }
  return parts.join(' ').slice(0, approxBytes);
}

function isoAgo(rand, maxDays) {
  const now = Date.UTC(2026, 9, 31, 8, 0, 0); // fixed reference → deterministic
  const days = rand() * maxDays;
  return new Date(now - Math.round(days * 86_400_000)).toISOString();
}

// ─── writers ────────────────────────────────────────────────────────

async function pool(items, limit, worker) {
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      await worker(i);
    }
  });
  await Promise.all(runners);
}

async function seedTasks({ n, dir, project, rand, concurrency }) {
  await fs.mkdir(dir, { recursive: true });
  const ids = [];
  const files = [];
  for (let i = 0; i < n; i++) ids.push(makeId(i, rand));

  for (let i = 0; i < n; i++) {
    const id = ids[i];
    const status = pickWeighted(rand, STATUSES, STATUS_WEIGHTS);
    const createdAt = isoAgo(rand, 720);
    const updatedAt = isoAgo(rand, 90);
    const task = {
      id,
      project,
      title: `${pick(rand, VERBS)} ${pick(rand, NOUNS)} (${i + 1})`,
      status,
      priority: pickWeighted(rand, PRIORITIES, PRIORITY_WEIGHTS),
      tags: tagsFor(rand),
      createdAt,
      updatedAt,
      archived: false,
      trashed: false,
    };
    if (rand() < 0.6) task.description = textOfBytes(rand, 40 + Math.floor(rand() * 500));
    // ~15% subtasks: parent is an earlier task (keeps depth shallow on average)
    if (i > 0 && rand() < 0.15) task.parentId = ids[Math.floor(rand() * i)];
    // ~10% carry dependencies on earlier tasks
    if (i > 0 && rand() < 0.1) {
      const deps = new Set();
      const count = 1 + Math.floor(rand() * 3);
      for (let d = 0; d < count; d++) deps.add(ids[Math.floor(rand() * i)]);
      task.dependsOn = [...deps];
    }
    if (rand() < 0.02) {
      task.archived = true;
      task.archivedAt = updatedAt;
    }
    if (rand() < 0.01) {
      task.trashed = true;
      task.trashedAt = updatedAt;
    }
    files.push({ file: path.join(dir, `${id}.json`), body: JSON.stringify(task, null, 2) });
  }

  await pool(files, concurrency, async (i) => {
    await fs.writeFile(files[i].file, files[i].body, 'utf-8');
  });
  return { ids, bytes: files.reduce((s, f) => s + Buffer.byteLength(f.body), 0) };
}

async function seedDocs({ n, dir, project, rand, concurrency }) {
  await fs.mkdir(dir, { recursive: true });
  const ids = [];
  const files = [];
  for (let i = 0; i < n; i++) ids.push(makeId(i, rand));

  for (let i = 0; i < n; i++) {
    const id = ids[i];
    const createdAt = isoAgo(rand, 720);
    const meta = {
      id,
      project,
      title: `${pick(rand, NOUNS)} — ${pick(rand, TYPES)} ${i + 1}`,
      tags: tagsFor(rand),
      createdAt,
      updatedAt: isoAgo(rand, 90),
      type: pick(rand, TYPES),
      trustLevel: 'user',
      archived: false,
      trashed: false,
      version: 1,
    };
    // ~20% hierarchical docs
    if (i > 0 && rand() < 0.2) meta.parentId = ids[Math.floor(rand() * i)];
    if (rand() < 0.15) meta.source = `https://example.invalid/docs/${id}`;
    if (rand() < 0.02) {
      meta.archived = true;
      meta.archivedAt = meta.updatedAt;
    }
    // body 1–8 KB
    const target = 1024 + Math.floor(rand() * 7168);
    const body = `# ${meta.title}\n\n${textOfBytes(rand, target - meta.title.length)}\n`;
    files.push({ file: path.join(dir, `${id}.md`), body: matter.stringify(body, meta) });
  }

  await pool(files, concurrency, async (i) => {
    await fs.writeFile(files[i].file, files[i].body, 'utf-8');
  });
  return { ids, bytes: files.reduce((s, f) => s + Buffer.byteLength(f.body), 0) };
}

async function seedFacts({ n, out, rand }) {
  const dir = path.join(out, 'memory');
  await fs.mkdir(dir, { recursive: true });
  const facts = {};
  for (let i = 0; i < n; i++) {
    const id = makeId(i, rand);
    const recordedAt = isoAgo(rand, 365);
    facts[id] = {
      id,
      statement: `${pick(rand, VERBS)} ${pick(rand, NOUNS)} for ${pick(rand, TAG_POOL)} (fact ${i + 1})`,
      category: pick(rand, ['preference', 'decision', 'convention', 'fact', 'error', 'fix', 'skill']),
      confidence: Math.round((0.4 + rand() * 0.6) * 100) / 100,
      tags: tagsFor(rand, 2),
      entities: [`Entity${Math.floor(rand() * Math.max(10, n / 100))}`, pick(rand, TAG_POOL)],
      validFrom: recordedAt,
      recordedAt,
      valid: rand() > 0.15,
      relationships: [],
    };
  }
  const body = JSON.stringify({ facts, version: 1 }, null, 2);
  const file = path.join(dir, 'temporal-graph.json');
  await fs.writeFile(file, body, 'utf-8');
  return { bytes: Buffer.byteLength(body) };
}

// ─── main ───────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rand = mulberry32(args.seed);
  const out = path.resolve(args.out);
  const started = Date.now();
  const log = args.quiet ? () => {} : (...a) => console.error(...a);

  await fs.mkdir(out, { recursive: true });
  log(`seeding n=${args.n} into ${out} (project=${args.project}, seed=${args.seed})`);

  let taskBytes = 0;
  let docBytes = 0;
  if (args.tasks && args.n > 0) {
    const t0 = Date.now();
    const res = await seedTasks({
      n: args.n,
      dir: path.join(out, 'tasks', args.project),
      project: args.project,
      rand,
      concurrency: args.concurrency,
    });
    taskBytes = res.bytes;
    log(`  tasks: ${args.n} files, ${(taskBytes / 1048576).toFixed(1)} MiB, ${Date.now() - t0} ms`);
  }
  if (args.docs && args.n > 0) {
    const t0 = Date.now();
    const res = await seedDocs({
      n: args.n,
      dir: path.join(out, 'knowledge', args.project),
      project: args.project,
      rand,
      concurrency: args.concurrency,
    });
    docBytes = res.bytes;
    log(`  docs: ${args.n} files, ${(docBytes / 1048576).toFixed(1)} MiB, ${Date.now() - t0} ms`);
  }
  let factBytes = 0;
  if (args.facts > 0) {
    const t0 = Date.now();
    const res = await seedFacts({ n: args.facts, out, rand });
    factBytes = res.bytes;
    log(`  facts: ${args.facts}, graph ${(factBytes / 1048576).toFixed(1)} MiB, ${Date.now() - t0} ms`);
  }

  const summary = {
    ok: true,
    out,
    project: args.project,
    seed: args.seed,
    tasks: args.tasks ? args.n : 0,
    docs: args.docs ? args.n : 0,
    facts: args.facts,
    bytes: { tasks: taskBytes, docs: docBytes, facts: factBytes, total: taskBytes + docBytes + factBytes },
    elapsedMs: Date.now() - started,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
