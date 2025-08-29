#!/usr/bin/env node
// scripts/prompts.mjs
// Unified tool: index | validate | export-json | export-md
// - Scans data/prompts/prompts/**/*.json
// - Validates minimal contract
// - Builds index.json
// - Exports JSON/Markdown
import { promises as fs } from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(REPO_ROOT, '.');
// Base data dir resolution with preference for repo-local .data/ and fallback to data/
const ENV_DATA_DIR = process.env.DATA_DIR ? path.resolve(process.cwd(), process.env.DATA_DIR) : null;
let BASE_DATA_DIR = ENV_DATA_DIR || path.join(PROJECT_ROOT, '.data');
try {
  // If env not set and .data/ is missing, fallback to data/
  if (!ENV_DATA_DIR) {
    await fs.access(BASE_DATA_DIR);
  }
} catch {
  BASE_DATA_DIR = ENV_DATA_DIR || path.join(PROJECT_ROOT, 'data');
}
// Prompts base dir: env override MCP_PROMPTS_DIR or DATA_DIR/prompts with legacy fallback to DATA_DIR/mcp/prompts
let PROMPTS_BASE_DIR = process.env.MCP_PROMPTS_DIR
  ? path.resolve(process.cwd(), process.env.MCP_PROMPTS_DIR)
  : path.join(BASE_DATA_DIR, 'prompts');
try {
  // If primary doesn't exist, fallback to legacy
  await fs.access(PROMPTS_BASE_DIR);
} catch {
  const legacy = path.join(BASE_DATA_DIR, 'mcp', 'prompts');
  try {
    await fs.access(legacy);
    PROMPTS_BASE_DIR = legacy;
  } catch {}
}

// --- Passive feedback helpers (JSONL ingestion, sentiment, edit distance) ---
function levenshtein(a, b) {
  if (a == null) a = '';
  if (b == null) b = '';
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      dp[j] = Math.min(
        dp[j] + 1,         // deletion
        dp[j - 1] + 1,     // insertion
        prev + cost        // substitution
      );
      prev = temp;
    }
  }
  return dp[n];
}

function simpleSentiment(s, thumb) {
  // Prefer explicit thumb signal if present
  if (thumb === 'up') return 'pos';
  if (thumb === 'down') return 'neg';
  const text = (s || '').toLowerCase();
  if (!text) return 'neu';
  const POS = ['спасибо', 'класс', 'супер', 'отлично', 'хорошо', 'полезно', 'great', 'thanks', 'helpful', 'awesome', 'perfect'];
  const NEG = ['плохо', 'неправильно', 'ужас', 'ерунда', 'бред', 'не помогло', "didn't help", 'bad', 'wrong', 'terrible'];
  for (const w of POS) { if (text.includes(w)) return 'pos'; }
  for (const w of NEG) { if (text.includes(w)) return 'neg'; }
  return 'neu';
}

async function readJsonlFile(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out = [];
    for (const ln of lines) {
      try { out.push(JSON.parse(ln)); } catch {}
    }
    return out;
  } catch { return []; }
}

// Project name
const CURRENT_PROJECT = process.env.CURRENT_PROJECT || 'mcp';

// Project-scoped prompts dir tree
const DATA_DIR = path.join(PROMPTS_BASE_DIR, CURRENT_PROJECT);
const PROMPTS_DIR = path.join(DATA_DIR, 'prompts');
const VERSIONS_DIR = path.join(DATA_DIR, 'versions');
const EXPERIMENTS_DIR = path.join(DATA_DIR, 'experiments');
const QUALITY_DIR = path.join(DATA_DIR, 'quality');
const EXPORTS_DIR = path.join(DATA_DIR, 'exports');
const EXPORTS_JSON_DIR = path.join(EXPORTS_DIR, 'json');
const EXPORTS_MD_DIR = path.join(EXPORTS_DIR, 'markdown');
const EXPORTS_CATALOG_DIR = path.join(EXPORTS_DIR, 'catalog');
const RULES_DIR = path.join(DATA_DIR, 'rules');
const WORKFLOWS_DIR = path.join(DATA_DIR, 'workflows');
const TEMPLATES_DIR = path.join(DATA_DIR, 'templates');
const POLICIES_DIR = path.join(DATA_DIR, 'policies');
const EXPORTS_BUILDS_DIR = path.join(EXPORTS_DIR, 'builds');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const VALIDATION_REPORT = path.join(QUALITY_DIR, 'validation.json');

const ALLOWED_STATUS = new Set(['draft', 'review', 'published', 'deprecated']);

function cmpSemver(a, b) {
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const ai = pa[i] || 0;
    const bi = pb[i] || 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

async function exportCatalog(files) {
  const idx = await indexPrompts(files);
  const manifest = {
    generatedAt: idx.generatedAt,
    items: Object.fromEntries(
      Object.entries(idx.items).map(([id, rec]) => [
        id,
        {
          id: rec.id,
          kind: rec.kind || null,
          latest: rec.latest,
          versions: rec.versions,
          files: rec.files,
        },
      ])
    ),
  };
  const dest = path.join(EXPORTS_CATALOG_DIR, 'prompts.catalog.json');
  await fs.mkdir(EXPORTS_CATALOG_DIR, { recursive: true });
  await fs.writeFile(dest, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return { path: dest, count: Object.keys(manifest.items).length };
}
 

async function ensureDirs() {
  const dirs = [
    DATA_DIR,
    PROMPTS_DIR,
    VERSIONS_DIR,
    EXPERIMENTS_DIR,
    QUALITY_DIR,
    EXPORTS_DIR,
    EXPORTS_JSON_DIR,
    EXPORTS_MD_DIR,
    EXPORTS_CATALOG_DIR,
    RULES_DIR,
    WORKFLOWS_DIR,
    TEMPLATES_DIR,
    POLICIES_DIR,
    EXPORTS_BUILDS_DIR,
  ];
  for (const d of dirs) {
    await fs.mkdir(d, { recursive: true });
  }
}

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (e.isFile()) {
      yield full;
    }
  }
}

async function findPromptFiles() {
  // Only scan source dirs, not exports
  const sourceDirs = [PROMPTS_DIR, RULES_DIR, WORKFLOWS_DIR, TEMPLATES_DIR, POLICIES_DIR];
  const files = [];
  for (const dir of sourceDirs) {
    try { await fs.access(dir); } catch { continue; }
    for await (const f of walk(dir)) {
      if (f.endsWith('.json')) files.push(f);
    }
  }
  return files.sort();
}

function minimalValidatePrompt(o) {
  const errs = [];
  if (!o || typeof o !== 'object') {
    return ['Not an object'];
  }
  if (o.type !== 'prompt') errs.push('type must be "prompt"');
  if (!o.id || typeof o.id !== 'string') errs.push('id required string');
  if (!o.version || typeof o.version !== 'string') errs.push('version required string');
  if (!o.metadata || typeof o.metadata !== 'object') errs.push('metadata required object');
  else {
    if (!o.metadata.title) errs.push('metadata.title required');
    if (!o.metadata.domain) errs.push('metadata.domain required');
    if (!o.metadata.status || !ALLOWED_STATUS.has(o.metadata.status)) {
      errs.push('metadata.status must be one of ' + Array.from(ALLOWED_STATUS).join(','));
    }
    // optional kind for taxonomy: rule|workflow|template|policy|system|user|tool
    if (o.metadata.kind && typeof o.metadata.kind !== 'string') {
      errs.push('metadata.kind must be string if provided');
    }
  }
  const kind = o?.metadata?.kind || 'prompt';
  if (kind === 'workflow') {
    if (!Array.isArray(o.compose)) errs.push('compose array required for workflow');
  } else {
    if (!o.template || typeof o.template !== 'string') errs.push('template required string');
  }
  if (!Array.isArray(o.variables)) errs.push('variables must be array');
  return errs;
}

async function loadJson(file) {
  const raw = await fs.readFile(file, 'utf8');
  try { return JSON.parse(raw); } catch (e) {
    const err = new Error(`Invalid JSON in ${file}: ${e.message}`);
    err.code = 'EJSON';
    throw err;
  }
}

async function indexPrompts(files) {
  const index = { generatedAt: new Date().toISOString(), items: {} };
  for (const file of files) {
    let data; let errs = [];
    try {
      data = await loadJson(file);
      errs = minimalValidatePrompt(data);
    } catch (e) {
      errs = [e.message];
    }
    const id = data?.id || path.basename(file).replace(/\.json$/, '');
    const ver = data?.version || '0.0.0';
    if (!index.items[id]) index.items[id] = { id, versions: [], latest: null, files: [], kind: data?.metadata?.kind || null };
    index.items[id].versions.push(ver);
    index.items[id].files.push({ version: ver, path: path.relative(PROJECT_ROOT, file), errors: errs });
  }
  for (const it of Object.values(index.items)) {
    it.versions.sort(cmpSemver);
    it.latest = it.versions[it.versions.length - 1] || null;
  }
  return index;
}

async function writeJson(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function renderMarkdown(prompt) {
  const md = [];
  md.push(`# ${prompt.metadata?.title || prompt.id}`);
  md.push('');
  md.push(`- id: ${prompt.id}`);
  md.push(`- version: ${prompt.version}`);
  md.push(`- domain: ${prompt.metadata?.domain || ''}`);
  md.push(`- status: ${prompt.metadata?.status || ''}`);
  const tags = Array.isArray(prompt.metadata?.tags) ? prompt.metadata.tags.join(', ') : '';
  if (tags) md.push(`- tags: ${tags}`);
  md.push('');
  md.push('## Template');
  md.push('');
  md.push('```');
  md.push(prompt.template || '');
  md.push('```');
  if (Array.isArray(prompt.variables) && prompt.variables.length) {
    md.push('');
    md.push('## Variables');
    md.push('');
    for (const v of prompt.variables) {
      md.push(`- ${v.name} (${v.type}) ${v.required ? '[required]' : ''} ${v.default !== undefined ? `default=${JSON.stringify(v.default)}` : ''}`.trim());
    }
  }
  if (Array.isArray(prompt.examples) && prompt.examples.length) {
    md.push('');
    md.push('## Examples');
    md.push('');
    for (const ex of prompt.examples) {
      md.push(`- ${ex.title || ex.id || ''}`);
    }
  }
  md.push('');
  return md.join('\n');
}

async function exportJson(files) {
  let count = 0;
  for (const file of files) {
    const base = path.basename(file);
    const dest = path.join(EXPORTS_JSON_DIR, base);
    await fs.copyFile(file, dest);
    count++;
  }
  return { count };
}

async function exportMarkdown(files) {
  let count = 0;
  for (const file of files) {
    let data;
    try { data = await loadJson(file); } catch { continue; }
    const baseName = path.basename(file, '.json');
    const dest = path.join(EXPORTS_MD_DIR, `${baseName}.md`);
    const md = renderMarkdown(data);
    await fs.writeFile(dest, md, 'utf8');
    count++;
  }
  return { count };
}

async function loadIndexOrBuild(files) {
  try {
    const raw = await fs.readFile(INDEX_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return indexPrompts(files);
  }
}

async function buildWorkflows(files) {
  const idx = await loadIndexOrBuild(files);
  const byId = new Map();
  for (const [id, rec] of Object.entries(idx.items || {})) {
    byId.set(id, rec);
  }
  let built = 0;
  for (const file of files) {
    let data;
    try { data = await loadJson(file); } catch { continue; }
    const kind = data?.metadata?.kind;
    if (kind !== 'workflow') continue;
    const steps = Array.isArray(data.compose) ? data.compose : [];
    const parts = [];
    for (const step of steps) {
      const refId = step?.ref;
      if (!refId) continue;
      const rec = byId.get(refId);
      if (!rec) continue;
      // pick the latest file path
      const latestVer = rec.latest || (rec.versions && rec.versions[rec.versions.length-1]);
      const fileEntry = rec.files.find((f) => f.version === latestVer) || rec.files[rec.files.length - 1];
      if (!fileEntry) continue;
      try {
        const refData = await loadJson(path.join(PROJECT_ROOT, fileEntry.path));
        parts.push(`# ${refData.metadata?.title || refData.id}\n\n${refData.template || ''}`);
      } catch {}
    }
    const combinedMd = parts.join('\n\n---\n\n');
    const baseName = path.basename(file, '.json');
    const outMd = path.join(EXPORTS_BUILDS_DIR, `${baseName}.md`);
    const outJson = path.join(EXPORTS_BUILDS_DIR, `${baseName}.json`);
    const builtObj = {
      type: 'prompt',
      id: `${data.id}::build`,
      version: data.version || '1.0.0',
      metadata: { ...(data.metadata||{}), kind: 'build' },
      template: combinedMd,
      variables: data.variables || [],
    };
    await fs.mkdir(path.dirname(outMd), { recursive: true });
    await fs.writeFile(outMd, combinedMd, 'utf8');
    await fs.writeFile(outJson, JSON.stringify(builtObj, null, 2) + '\n', 'utf8');
    built++;
  }
  return { built };
}

async function main() {
  const cmd = process.argv[2] || 'index';
  await ensureDirs();
  const files = await findPromptFiles();

  // helpers for arg parsing
  const rawArgs = process.argv.slice(3);
  function getFlag(name, def = false) {
    const k = `--${name}`;
    return rawArgs.includes(k) ? true : def;
  }
  function getOpt(name, def = null) {
    const k = `--${name}`;
    const i = rawArgs.indexOf(k);
    if (i >= 0 && rawArgs[i + 1]) return rawArgs[i + 1];
    // allow "--name=value"
    const pref = k + '=';
    const m = rawArgs.find((a) => a.startsWith(pref));
    if (m) return m.slice(pref.length);
    return def;
  }
  function getMulti(name) {
    const v = getOpt(name);
    if (!v) return [];
    return v.split(',').map((s) => s.trim()).filter(Boolean);
  }

  if (cmd === 'index') {
    const idx = await indexPrompts(files);
    await writeJson(INDEX_FILE, idx);
    console.log(`Indexed ${Object.keys(idx.items).length} prompt ids → ${path.relative(PROJECT_ROOT, INDEX_FILE)}`);
    return;
  }
  if (cmd === 'validate') {
    const report = [];
    for (const f of files) {
      try {
        const data = await loadJson(f);
        const errs = minimalValidatePrompt(data);
        report.push({ file: path.relative(PROJECT_ROOT, f), id: data.id, version: data.version, errors: errs });
      } catch (e) {
        report.push({ file: path.relative(PROJECT_ROOT, f), id: null, version: null, errors: [e.message] });
      }
    }
    await writeJson(VALIDATION_REPORT, { generatedAt: new Date().toISOString(), total: report.length, report });
    console.log(`Validation report: ${path.relative(PROJECT_ROOT, VALIDATION_REPORT)} (items=${report.length})`);
    return;
  }
  if (cmd === 'export-json') {
    const { count } = await exportJson(files);
    console.log(`Exported JSON files: ${count} → ${path.relative(PROJECT_ROOT, EXPORTS_JSON_DIR)}`);
    return;
  }
  if (cmd === 'export-md') {
    const { count } = await exportMarkdown(files);
    console.log(`Exported MD files: ${count} → ${path.relative(PROJECT_ROOT, EXPORTS_MD_DIR)}`);
    return;
  }
  if (cmd === 'catalog') {
    const { path: dest, count } = await exportCatalog(files);
    console.log(`Catalog exported (${count} ids) → ${path.relative(PROJECT_ROOT, dest)}`);
    return;
  }
  if (cmd === 'build') {
    const { built } = await buildWorkflows(files);
    console.log(`Built workflows: ${built} → ${path.relative(PROJECT_ROOT, EXPORTS_BUILDS_DIR)}`);
    return;
  }
  if (cmd === 'list') {
    // Build detailed entries per id/version with metadata for filtering
    const idx = await loadIndexOrBuild(files);
    const latestOnly = getFlag('latest', false);
    const kind = getOpt('kind');
    const status = getOpt('status');
    const domain = getOpt('domain');
    const tags = new Set(getMulti('tag'));
    const format = getOpt('format', 'json'); // json|table

    const entries = [];
    for (const [id, rec] of Object.entries(idx.items || {})) {
      // choose versions
      const versions = latestOnly && rec.latest ? [rec.latest] : rec.versions;
      for (const ver of versions) {
        const fileEntry = rec.files.find((f) => f.version === ver) || rec.files[rec.files.length - 1];
        if (!fileEntry) continue;
        let meta = null; let data = null;
        try {
          data = await loadJson(path.join(PROJECT_ROOT, fileEntry.path));
          meta = data?.metadata || {};
        } catch {}
        // filters
        if (kind && (meta?.kind || 'prompt') !== kind) continue;
        if (status && meta?.status !== status) continue;
        if (domain && meta?.domain !== domain) continue;
        if (tags.size) {
          const mtags = new Set(Array.isArray(meta?.tags) ? meta.tags : []);
          let ok = true;
          for (const t of tags) if (!mtags.has(t)) { ok = false; break; }
          if (!ok) continue;
        }
        entries.push({ id, version: ver, kind: meta?.kind || 'prompt', status: meta?.status || null, domain: meta?.domain || null, tags: Array.isArray(meta?.tags) ? meta.tags : [], file: fileEntry.path });
      }
    }
    if (format === 'table') {
      for (const e of entries) {
        console.log(`${e.id}\t${e.version}\t${e.kind}\t${e.status || ''}\t${e.domain || ''}\t${(e.tags||[]).join(',')}\t${e.file}`);
      }
    } else {
      console.log(JSON.stringify({ generatedAt: new Date().toISOString(), total: entries.length, items: entries }, null, 2));
    }
    return;
  }
  if (cmd === 'ab:report') {
    // Aggregate experiments and passive feedback from EXPERIMENTS_DIR and write a report
    async function* walkSafe(dir) {
      try { await fs.access(dir); } catch { return; }
      yield* walk(dir);
    }
    const experiments = [];
    const feedbackEvents = [];
    for await (const f of walkSafe(EXPERIMENTS_DIR)) {
      if (f.endsWith('.json')) {
        try {
          const obj = await loadJson(f);
          experiments.push({ file: path.relative(PROJECT_ROOT, f), ...obj });
        } catch {}
      } else if (f.endsWith('.jsonl')) {
        const arr = await readJsonlFile(f);
        for (const ev of arr) {
          feedbackEvents.push({ file: path.relative(PROJECT_ROOT, f), ...ev });
        }
      }
    }
    // Aggregation: A/B experiments (variants coverage)
    const byPrompt = {};
    for (const ex of experiments) {
      const pid = ex.promptId || ex.id || 'unknown';
      const a = ex.versionA || ex.variantA || ex.A || ex.a;
      const b = ex.versionB || ex.variantB || ex.B || ex.b;
      if (!byPrompt[pid]) byPrompt[pid] = { total: 0, variants: {} };
      byPrompt[pid].total++;
      for (const v of [a, b]) {
        if (!v) continue;
        byPrompt[pid].variants[v] = (byPrompt[pid].variants[v] || 0) + 1;
      }
    }
    // Aggregation: Passive feedback metrics
    // key = promptId|version|variant
    function keyOf(ev) {
      const pid = ev.promptId || ev.id || 'unknown';
      const ver = ev.version || ev.promptVersion || 'unknown';
      const varnt = ev.variant || ev.arm || ev.abVariant || null;
      return `${pid}|${ver}|${varnt ?? ''}`;
    }
    const metrics = new Map();
    for (const ev of feedbackEvents) {
      const k = keyOf(ev);
      if (!metrics.has(k)) metrics.set(k, {
        promptId: ev.promptId || ev.id || 'unknown',
        version: ev.version || ev.promptVersion || 'unknown',
        variant: ev.variant || ev.arm || ev.abVariant || null,
        total: 0,
        thumbs: { up: 0, down: 0, null: 0 },
        sentiment: { pos: 0, neg: 0, neu: 0 },
        edits: { count: 0, sum: 0, sumRate: 0 },
        copied: 0,
        abandoned: 0,
      });
      const m = metrics.get(k);
      m.total++;
      const thumb = ev?.signals?.thumb ?? null;
      if (thumb === 'up') m.thumbs.up++; else if (thumb === 'down') m.thumbs.down++; else m.thumbs.null++;
      const sent = simpleSentiment(ev?.userMessage, thumb);
      m.sentiment[sent]++;
      const out = ev?.modelOutput ?? '';
      const edit = ev?.userEdits ?? '';
      if (edit && typeof edit === 'string') {
        const d = levenshtein(String(out), String(edit));
        const rate = out ? d / String(out).length : (edit ? 1 : 0);
        m.edits.count++;
        m.edits.sum += d;
        m.edits.sumRate += rate;
      }
      if (ev?.signals?.copied) m.copied++;
      if (ev?.signals?.abandoned) m.abandoned++;
    }
    const feedback = [];
    for (const m of metrics.values()) {
      const accDen = m.thumbs.up + m.thumbs.down;
      const acceptance = accDen > 0 ? m.thumbs.up / accDen : null;
      const avgEdit = m.edits.count > 0 ? m.edits.sum / m.edits.count : null;
      const avgEditRate = m.edits.count > 0 ? m.edits.sumRate / m.edits.count : null;
      const copiedRate = m.total > 0 ? m.copied / m.total : null;
      const abandonedRate = m.total > 0 ? m.abandoned / m.total : null;
      feedback.push({
        promptId: m.promptId,
        version: m.version,
        variant: m.variant,
        total: m.total,
        acceptance,
        sentiment: m.sentiment,
        avgEdit,
        avgEditRate,
        copiedRate,
        abandonedRate,
        thumbs: m.thumbs,
      });
    }
    const report = {
      generatedAt: new Date().toISOString(),
      totalExperiments: experiments.length,
      totalFeedbackEvents: feedbackEvents.length,
      byPrompt,
      feedback,
    };
    await fs.mkdir(EXPORTS_CATALOG_DIR, { recursive: true });
    const dest = path.join(EXPORTS_CATALOG_DIR, 'experiments.report.json');
    await fs.writeFile(dest, JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(`A/B report (${experiments.length} exp, ${feedbackEvents.length} feedback) → ${path.relative(PROJECT_ROOT, dest)}`);
    return;
  }
  console.error(`Unknown command: ${cmd}`);
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
