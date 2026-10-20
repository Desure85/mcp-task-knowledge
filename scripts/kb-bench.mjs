#!/usr/bin/env node
/**
 * Knowledge-base benchmark harness for the hardening goal (mcp-kb-hardening).
 *
 * Fixed, reproducible sets — no ad-hoc fixtures:
 *   docs     146 chunks of `docs/**\/*.md` (chunkSize=1700, overlap=170) — latency/RSS/index judge
 *   queries  hand-written mixed RU/EN/code questions (scripts/kb-bench-queries.json)
 *   labels   multilingual field labels (/tmp/field-eval-data/multilingual_labels.json) — quality judge
 *
 * Modes:
 *   build      create the `docs-bench` project fixture inside --dir
 *   retrieval  hit@1/3 + MRR over the docs fixture (bm25 | hybrid)
 *   labels     per-language top-1/top-3 over the label set (cross-lingual, no substring leak)
 *   latency    end-to-end stdio timings: initialize, cold first search, warm search, RSS
 *   component  in-process split: adapter init, index time, warm query time
 *
 * Every number printed here is meant to be comparable between runs: same fixtures,
 * same model env, same query strings. Reports go to docs/benchmarks/ (benchmarks/
 * is gitignored local output).
 *
 * Usage:
 *   node scripts/kb-bench.mjs build     --dir /tmp/kb-bench
 *   node scripts/kb-bench.mjs retrieval --dir /tmp/kb-bench --mode hybrid
 *   node scripts/kb-bench.mjs labels    --limit 120 --mode hybrid
 *   node scripts/kb-bench.mjs latency   --dir /tmp/kb-bench --mode cpu --fresh
 *   node scripts/kb-bench.mjs component --dir /tmp/kb-bench --mode cpu
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'dist');

const argv = process.argv.slice(2);
const MODE = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'help';
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const DIR = path.resolve(arg('dir', '/tmp/kb-bench'));
const PROJECT = arg('project', 'docs-bench');
const EMB_MODE = arg('mode', 'cpu'); // cpu | gpu | none
const CHUNK_SIZE = Number(arg('chunk-size', 1700));
const CHUNK_OVERLAP = Number(arg('chunk-overlap', 170));
const GOLD = arg('gold', '/tmp/field-eval-data/gold_fields.json');
const LABELS = arg('labels', '/tmp/field-eval-data/multilingual_labels.json');
const LIMIT = Number(arg('limit', '0')) || 0;

const GEMMA = path.join(os.homedir(), '.local/share/mcp-task-knowledge/models/gemma2-q4/onnx/model_q4.onnx');
const GEMMA_ENV = {
  EMBEDDINGS_MODEL_PATH: GEMMA,
  EMBEDDINGS_DIM: '768',
  EMBEDDINGS_QUERY_PREFIX: 'task: search result | query:',
  EMBEDDINGS_DOC_PREFIX: 'title: none | text:',
};

function embeddingsEnv(mode) {
  if (mode === 'none') return { EMBEDDINGS_MODE: 'none' };
  if (mode === 'auto') return { EMBEDDINGS_MODE: 'onnx-cpu', EMBEDDINGS_AUTODETECT: '1' };
  return {
    EMBEDDINGS_MODE: mode === 'gpu' ? 'onnx-gpu' : 'onnx-cpu',
    ...GEMMA_ENV,
    EMBEDDINGS_BATCH_SIZE: arg('batch', '16'),
  };
}

/** Apply benchmark env BEFORE importing dist modules: config.ts resolves paths at load. */
function applyEnv(dir, embeddings = 'none') {
  process.env.DATA_DIR = dir;
  process.env.OBSIDIAN_VAULT_ROOT = path.join(dir, 'vault');
  process.env.CURRENT_PROJECT = PROJECT;
  process.env.LOG_LEVEL = 'silent';
  process.env.CATALOG_ENABLED = '0';
  for (const [k, v] of Object.entries(embeddingsEnv(embeddings))) process.env[k] = v;
}

const imp = (p) => import(pathToFileURL(path.join(DIST, p)).href);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

/** Same algorithm as src/search/index.ts chunkText — the fixture must match prod chunking. */
function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const step = Math.max(1, size - overlap);
  if (text.length <= size) return [text];
  const out = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + size);
    out.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - overlap;
  }
  return out;
}

const stripFrontmatter = (raw) => raw.replace(/^---[\s\S]*?---/, '').trim();
const titleOf = (raw, rel) => {
  const fm = raw.match(/^---[\s\S]*?---/);
  const t = fm && fm[0].match(/title:\s*['"]?(.+?)['"]?\s*$/m);
  const h1 = raw.match(/^#\s+(.+)$/m);
  return (t?.[1] || h1?.[1] || path.basename(rel, '.md')).trim();
};

async function buildFixture({ quiet = false } = {}) {
  const { createDoc, listDocs, deleteDocPermanent } = await imp('storage/knowledge.js');
  fs.mkdirSync(path.join(DIR, 'knowledge', PROJECT), { recursive: true });

  // Idempotent rebuild: drop previous fixture docs.
  const existing = await listDocs({ project: PROJECT, includeArchived: true, includeTrashed: true }).catch(() => []);
  for (const d of existing) {
    await (deleteDocPermanent ? deleteDocPermanent(PROJECT, d.id) : Promise.resolve());
  }

  const files = walk(path.join(ROOT, 'docs'))
    // Hardening reports are written into docs/benchmarks/ but are not product docs;
    // excluding only them keeps the fixture identical to the 146-chunk baseline.
    .filter((f) => f.endsWith('.md') && !/[\\/]benchmarks[\\/]kb-[^\\/]*\.md$/.test(f))
    .sort();
  const manifest = [];
  let total = 0;
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const body = stripFrontmatter(raw);
    const rel = path.relative(ROOT, file);
    const title = titleOf(raw, rel);
    const chunks = chunkText(body);
    for (let i = 0; i < chunks.length; i++) {
      const doc = await createDoc({
        project: PROJECT,
        title: `${title} [${rel}#${i}]`,
        content: chunks[i],
        tags: ['bench', 'docs', rel.split(path.sep)[0]],
        type: 'markdown',
        source: `bench:${rel}#${i}`,
      });
      manifest.push({ id: doc.id, file: rel, chunk: i, chars: chunks[i].length });
      total += chunks[i].length;
    }
  }
  fs.writeFileSync(
    path.join(DIR, 'kb-bench-manifest.json'),
    JSON.stringify({ createdAt: new Date().toISOString(), chunkSize: CHUNK_SIZE, chunkOverlap: CHUNK_OVERLAP, files: files.length, docs: manifest.length, chars: total, manifest }, null, 2),
  );
  if (!quiet) {
    console.log(`fixture: ${manifest.length} chunks from ${files.length} docs (${total} chars) in ${path.join(DIR, 'knowledge', PROJECT)}`);
  }
  return manifest;
}

function pct(x, n) {
  return n ? Number(((x / n) * 100).toFixed(1)) : 0;
}

async function loadItems() {
  const { listDocs, readDoc } = await imp('storage/knowledge.js');
  const { buildTextForDoc } = await imp('search/index.js');
  const metas = await listDocs({ project: PROJECT });
  const docs = [];
  for (const m of metas) {
    const d = await readDoc(PROJECT, m.id);
    if (d) docs.push(d);
  }
  return docs.map((d) => ({ id: d.id, text: buildTextForDoc(d), item: d }));
}

async function makeAdapter(mode) {
  if (mode === 'none') return undefined;
  const { getVectorAdapter } = await imp('search/vector.js');
  return getVectorAdapter();
}

async function runRetrieval() {
  const { hybridSearch } = await imp('search/index.js');
  const items = await loadItems();
  const byId = new Map(items.map((i) => [i.id, i.item]));
  const queries = JSON.parse(fs.readFileSync(path.join(HERE, 'kb-bench-queries.json'), 'utf8'));
  const adapter = await makeAdapter(EMB_MODE);

  const perLang = {};
  let hit1 = 0, hit3 = 0, mrr = 0, n = 0, missing = 0;
  const rows = [];
  // Fixture titles carry the source as `Title [docs/file.md#chunk]` — that survives
  // readDoc even when optional frontmatter fields are dropped.
  const srcOf = (item) => {
    const m = /\[([^\]\[]+)#\d+\]/.exec(item?.title ?? '');
    if (m) return m[1];
    return (item?.source ?? '').replace(/^bench:/, '').replace(/#\d+$/, '');
  };
  for (const q of queries) {
    const res = await hybridSearch(q.query, items, { limit: 10, vectorAdapter: adapter });
    const rankIdx = res.findIndex((r) => q.expect.includes(srcOf(byId.get(r.id))));
    const finalRank = rankIdx >= 0 ? rankIdx + 1 : 0;
    const bucket = perLang[q.lang] ?? (perLang[q.lang] = { n: 0, hit1: 0, hit3: 0, mrr: 0 });
    n += 1;
    bucket.n += 1;
    if (finalRank === 1) { hit1 += 1; bucket.hit1 += 1; }
    if (finalRank > 0 && finalRank <= 3) { hit3 += 1; bucket.hit3 += 1; }
    if (finalRank > 0) { mrr += 1 / finalRank; bucket.mrr += 1 / finalRank; }
    if (finalRank === 0) missing += 1;
    rows.push({ query: q.query, lang: q.lang, expect: q.expect, rank: finalRank, top1: res[0]?.item?.title ?? null });
  }
  const summary = {
    mode: EMB_MODE,
    docs: items.length,
    queries: n,
    hit1: pct(hit1, n),
    hit3: pct(hit3, n),
    mrr: Number((mrr / n).toFixed(3)),
    missed: missing,
    perLang: Object.fromEntries(
      Object.entries(perLang).map(([k, v]) => [k, { n: v.n, hit1: pct(v.hit1, v.n), hit3: pct(v.hit3, v.n), mrr: Number((v.mrr / v.n).toFixed(3)) }]),
    ),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (flag('verbose')) for (const r of rows) console.log(`${r.rank || 'MISS'} [${r.lang}] ${r.query} → ${r.top1}`);
  return summary;
}

/** Stratified sample: round-robin over groups so no single group dominates the slice. */
function sampleLabels(limit) {
  const labels = JSON.parse(fs.readFileSync(LABELS, 'utf8'));
  if (!limit || limit >= labels.length) return labels;
  const byGroup = new Map();
  for (const e of labels) {
    if (!byGroup.has(e.group)) byGroup.set(e.group, []);
    byGroup.get(e.group).push(e);
  }
  const buckets = [...byGroup.values()];
  const out = [];
  for (let i = 0; out.length < limit; i++) {
    for (const b of buckets) {
      if (b[i] && out.length < limit) out.push(b[i]);
    }
    if (buckets.every((b) => !b[i])) break;
  }
  return out;
}

async function runLabels() {
  const LANGS = ['ru', 'en', 'de', 'es', 'fr', 'pl', 'pt', 'tr'];
  const labels = sampleLabels(LIMIT);
  const adapter = await makeAdapter(EMB_MODE);
  const channel = arg('channel', adapter ? 'hybrid' : 'bm25');
  const { hybridSearch } = await imp('search/index.js');
  const items = [];
  const text = (v) => String(v ?? '').trim();
  for (let idx = 0; idx < labels.length; idx++) {
    for (const lang of LANGS) {
      const t = text(labels[idx][lang]);
      if (!t) continue;
      items.push({ id: `${idx}:${lang}`, text: t, item: { idx, lang, group: labels[idx].group } });
    }
  }
  // Pre-encode the whole index through the adapter so the per-query loop measures ranking only.
  if (adapter) {
    const t0 = Date.now();
    if (typeof adapter.warmup === 'function') await adapter.warmup(items);
    else await adapter.search('warmup', items, { limit: 1 });
    if (flag('verbose')) console.error(`index encoded in ${Date.now() - t0} ms`);
  }

  const perLang = {};
  for (const lang of LANGS) {
    let n = 0, top1 = 0, top3 = 0;
    for (let idx = 0; idx < labels.length; idx++) {
      const q = text(labels[idx][lang]);
      if (!q || labels[idx].group === 'unclear') continue;
      let res;
      if (channel === 'hybrid' || channel === 'bm25') {
        res = await hybridSearch(q, items, { limit: items.length, vectorAdapter: channel === 'hybrid' ? adapter : undefined });
      } else {
        res = await adapter.search(q, items, { limit: items.length });
      }
      // Group-level hit: every language variant of the entry carries the same group, so a
      // cross-lingual match (DE query → PT label) counts exactly like a same-language one.
      // The query's own entry is removed BEFORE ranking, exactly like the model judge does.
      const seen = new Set();
      const order = [];
      for (const r of res.sort((a, b) => b.score - a.score)) {
        if (r.item.idx === idx) continue;
        if (seen.has(r.item.idx)) continue;
        seen.add(r.item.idx);
        order.push(r.item);
      }
      const rank = order.findIndex((x) => x.group === labels[idx].group) + 1;
      n += 1;
      if (rank === 1) top1 += 1;
      if (rank > 0 && rank <= 3) top3 += 1;
    }
    perLang[lang] = { n, top1, top1Pct: pct(top1, n), top3Pct: pct(top3, n) };
  }
  const summary = { mode: adapter ? EMB_MODE : 'none', channel, entries: labels.length, indexRows: items.length, perLang };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

// ── stdio latency ────────────────────────────────────────────────────────────

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

function rssMB(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const m = status.match(/VmRSS:\s+(\d+)\s+kB/);
    return m ? Number((Number(m[1]) / 1024).toFixed(1)) : null;
  } catch {
    return null;
  }
}

async function runLatency() {
  if (flag('fresh')) {
    fs.rmSync(path.join(DIR, '.embeddings'), { recursive: true, force: true });
  }
  const queries = ['как устроен жизненный цикл запроса', 'atomic json write tmp rename', 'mcp1_search_knowledge_two_stage'];
  const env = {
    ...process.env,
    MCP_TRANSPORT: 'stdio',
    DATA_DIR: DIR,
    CURRENT_PROJECT: PROJECT,
    LOG_LEVEL: 'silent',
    CATALOG_ENABLED: '0',
    ...embeddingsEnv(EMB_MODE),
  };
  const startedAt = Date.now();
  const child = spawn(process.execPath, [path.join(DIST, 'index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c.toString(); });
  const rpc = rpcClient(child);

  const t0 = Date.now();
  await rpc.call('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'kb-bench', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const initMs = Date.now() - t0;

  const search = async (q) => {
    const s = Date.now();
    const res = await rpc.call('tools/call', { name: 'search_knowledge', arguments: { query: q, project: PROJECT, limit: 5 } });
    const data = JSON.parse(res?.result?.content?.[0]?.text ?? '{"data":[]}');
    return { ms: Date.now() - s, hits: (data.data ?? []).length };
  };

  let warmupWaitMs = null;
  let warmupStatus = null;
  if (flag('wait-warmup')) {
    const pollStart = Date.now();
    const deadline = pollStart + Number(arg('warmup-timeout', '300')) * 1000;
    for (;;) {
      const res = await rpc.call('tools/call', { name: 'embeddings_status', arguments: {} });
      const payload = JSON.parse(res?.result?.content?.[0]?.text ?? '{}').data ?? {};
      const st = (payload.warmup ?? []).find((x) => x.project === PROJECT);
      if (st) {
        warmupStatus = st;
        if (st.state === 'done' || st.state === 'error' || st.state === 'disabled') break;
      }
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    warmupWaitMs = Date.now() - pollStart;
  }

  const first = await search(queries[0]);
  const warm = [];
  for (const q of queries) warm.push((await search(q)).ms);  const rss = rssMB(child.pid);
  const cacheFiles = fs.existsSync(path.join(DIR, '.embeddings')) ? fs.readdirSync(path.join(DIR, '.embeddings')).filter((f) => f.endsWith('.bin')).length : 0;
  const totalMs = Date.now() - startedAt;
  child.stdin.end();
  child.kill('SIGTERM');

  const summary = {
    mode: EMB_MODE,
    docs: (await loadItems()).length,
    initMs,
    warmupWaitMs,
    warmup: warmupStatus,
    coldFirstSearchMs: first.ms,
    coldHits: first.hits,
    warmSearchMs: warm,
    warmMedianMs: warm.sort((a, b) => a - b)[Math.floor(warm.length / 2)],
    rssMB: rss,
    cacheVectors: cacheFiles,
    processUptimeMs: totalMs,
    stderrTail: stderr.trim().split('\n').slice(-3),
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

async function runIngest() {
  const env = {
    ...process.env,
    MCP_TRANSPORT: 'stdio',
    DATA_DIR: DIR,
    CURRENT_PROJECT: PROJECT,
    LOG_LEVEL: 'silent',
    CATALOG_ENABLED: '0',
    ...embeddingsEnv(EMB_MODE),
  };
  const child = spawn(process.execPath, [path.join(DIST, 'index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const rpc = rpcClient(child);
  await rpc.call('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'kb-bench', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const statusOf = async () => {
    const res = await rpc.call('tools/call', { name: 'embeddings_status', arguments: {} });
    const payload = JSON.parse(res?.result?.content?.[0]?.text ?? '{}').data ?? {};
    return (payload.warmup ?? []).find((x) => x.project === PROJECT) ?? null;
  };
  const waitFor = async (predicate, timeoutMs = 300_000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const st = await statusOf();
      if (st && predicate(st)) return st;
      if (Date.now() > deadline) return st;
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  const initial = await waitFor((st) => st.state === 'done' || st.state === 'error' || st.state === 'disabled');
  const before = initial?.total ?? 0;

  const token = `zkb${Date.now().toString(36)}`;
  const ingestStart = Date.now();
  await rpc.call('tools/call', {
    name: 'knowledge_bulk_create',
    arguments: {
      project: PROJECT,
      items: [{ title: `Ingest probe ${token}`, content: `Unique marker ${token} about warmup indexing.`, tags: ['bench'] }],
    },
  });
  const after = await waitFor((st) => st.state === 'done' && st.total >= before + 1);
  const ingestIndexMs = Date.now() - ingestStart;

  const searchStart = Date.now();
  const res = await rpc.call('tools/call', { name: 'search_knowledge', arguments: { query: token, project: PROJECT, limit: 3 } });
  const data = JSON.parse(res?.result?.content?.[0]?.text ?? '{"data":[]}');
  const searchMs = Date.now() - searchStart;
  const found = (data.data ?? []).some((r) => (r.item?.title ?? '').includes(token));

  child.stdin.end();
  child.kill('SIGTERM');

  const summary = {
    mode: EMB_MODE,
    docsBefore: before,
    docsAfter: after?.total ?? null,
    warmupStateAfterIngest: after?.state ?? null,
    ingestToIndexedMs: ingestIndexMs,
    searchAfterIngestMs: searchMs,
    newDocFound: found,
    warmupWaitMs: initial?.elapsedMs ?? null,
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

async function runComponent() {
  const { getVectorAdapter } = await imp('search/vector.js');
  const items = await loadItems();
  const tInit = Date.now();
  const adapter = await getVectorAdapter();
  const initMs = Date.now() - tInit;
  if (!adapter) {
    console.log(JSON.stringify({ mode: EMB_MODE, adapter: false, initMs, docs: items.length }, null, 2));
    return;
  }
  const tIndex = Date.now();
  if (typeof adapter.warmup === 'function') await adapter.warmup(items);
  else await adapter.search('index warmup', items, { limit: 1 });
  const indexMs = Date.now() - tIndex;
  const q = 'как устроен жизненный цикл запроса';
  const tQ = Date.now();
  await adapter.search(q, items, { limit: 5 });
  const warmQueryMs = Date.now() - tQ;
  const summary = { mode: EMB_MODE, adapter: true, docs: items.length, initMs, indexMs, warmQueryMs, rssMB: Number((process.memoryUsage().rss / 1048576).toFixed(1)) };
  console.log(JSON.stringify(summary, null, 2));
}

function help() {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n/, ''));
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.js'))) {
    console.error('dist/ is missing — run `npm run build` first');
    process.exit(1);
  }
  switch (MODE) {
    case 'build': {
      applyEnv(DIR, 'none');
      await buildFixture();
      break;
    }
    case 'retrieval': {
      applyEnv(DIR, EMB_MODE);
      await runRetrieval();
      break;
    }
    case 'labels': {
      applyEnv(path.join(os.tmpdir(), 'kb-bench-labels'), EMB_MODE);
      await runLabels();
      break;
    }
    case 'latency': {
      // The child process gets the env itself; the parent only needs DATA_DIR for loadItems().
      applyEnv(DIR, EMB_MODE);
      await runLatency();
      break;
    }
    case 'component': {
      applyEnv(DIR, EMB_MODE);
      await runComponent();
      break;
    }
    case 'ingest': {
      applyEnv(DIR, EMB_MODE);
      await runIngest();
      break;
    }
    default:
      help();
  }
}

main().catch((e) => {
  console.error('kb-bench failed:', e?.stack || e);
  process.exit(1);
});
