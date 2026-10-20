#!/usr/bin/env node
/**
 * Field/language judge for the knowledge-base hardening goal.
 *
 * Measures the *model* side of retrieval quality on two fixed sets:
 *   1. 99 partner fields with types → top-1/top-3 group accuracy (21 'unclear' excluded)
 *   2. multilingual labels (2024 entries × de/en/es/fr/pl/pt/ru/tr) → per-language top-1
 *
 * Scoring is copied from the original ai-lab judge (same normalization, same
 * "same group = hit" rule), so numbers stay comparable across runs. Paths are
 * arguments now — this repo never reads from ai-lab.
 *
 * Usage:
 *   node scripts/field-eval.mjs --models gemma --limit 120
 *   node scripts/field-eval.mjs --models gemma,labse --gold /tmp/field-eval-data/gold_fields.json
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as ort from 'onnxruntime-node';
import { AutoTokenizer } from '@huggingface/transformers';

const MODELS = process.env.KB_MODELS_DIR || path.join(os.homedir(), '.local', 'share', 'mcp-task-knowledge', 'models');
const LANGS = ['ru', 'en', 'de', 'es', 'fr', 'pl', 'pt', 'tr'];

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const GOLD_PATH = arg('gold', '/tmp/field-eval-data/gold_fields.json');
const LABELS_PATH = arg('labels', '/tmp/field-eval-data/multilingual_labels.json');
const LIMIT = Number(arg('limit', '0')) || 0;
const MODELS_ARG = arg('models', 'gemma');

const normalizeName = (name) =>
  String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9а-яА-ЯёЁ]+/g, ' ')
    .toLowerCase()
    .trim();

const fieldText = (f) => `${normalizeName(f.name)} ${f.desc ?? ''} ${f.type ?? ''}`.replace(/\s+/g, ' ').trim();
const normalize = (v) => {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  const o = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) o[i] = v[i] / n;
  return o;
};
const cosine = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

async function makeEncoder({ dir, onnx, maxLen, qPrefix = '', dPrefix = '' }) {
  const tok = await AutoTokenizer.from_pretrained(dir);
  const session = await ort.InferenceSession.create(onnx);
  const multimodal = session.inputNames.includes('image_features');
  const encode = async (text) => {
    const e = await tok(text, { add_special_tokens: true });
    const ids = Array.from(e.input_ids.data).map(Number).slice(0, maxLen);
    const mask = Array.from(e.attention_mask.data).map(Number).slice(0, maxLen);
    const feeds = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      attention_mask: new ort.Tensor('int64', BigInt64Array.from(mask.map(BigInt)), [1, ids.length]),
    };
    if (session.inputNames.includes('token_type_ids')) feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(ids.length), [1, ids.length]);
    if (multimodal) {
      for (const k of ['image_features', 'video_features', 'audio_features']) {
        feeds[k] = new ort.Tensor('float32', new Float32Array(0), [0, 512]);
      }
    }
    const out = await session.run(feeds);
    if (out.sentence_embedding) return normalize(out.sentence_embedding.data);
    const t = out.last_hidden_state;
    const [, S, H] = t.dims;
    const d = t.data;
    const vec = new Float32Array(H);
    let cnt = 0;
    for (let i = 0; i < S; i++) {
      if (!mask[i]) continue;
      cnt++;
      for (let h = 0; h < H; h++) vec[h] += d[i * H + h];
    }
    for (let h = 0; h < H; h++) vec[h] /= cnt || 1;
    return normalize(vec);
  };
  return { doc: (t) => encode(dPrefix + t), query: (t) => encode(qPrefix + t) };
}

function rankOf(scores, isHit) {
  const sorted = scores.slice().sort((a, b) => b.score - a.score);
  const seen = new Set();
  const order = [];
  for (const item of sorted) {
    if (seen.has(item.entryId)) continue;
    seen.add(item.entryId);
    order.push(item);
  }
  const idx = order.findIndex(isHit);
  return idx < 0 ? Infinity : idx + 1;
}

async function evalGold(enc, fields) {
  const vecs = [];
  for (const f of fields) vecs.push(await enc.doc(fieldText(f)));
  let top1 = 0, top3 = 0, n = 0;
  for (let i = 0; i < fields.length; i++) {
    if (fields[i].group === 'unclear') continue;
    const qv = await enc.query(fieldText(fields[i]));
    const scores = fields.map((f, j) => ({ entryId: j, group: f.group, score: j === i ? -Infinity : cosine(qv, vecs[j]) }));
    const rank = rankOf(scores, (x) => x.group === fields[i].group);
    n++;
    if (rank === 1) top1++;
    if (rank <= 3) top3++;
  }
  return { n, top1, top3 };
}

function sampleStratified(rows, limit) {
  if (!limit || limit >= rows.length) return rows;
  const byGroup = new Map();
  for (const e of rows) {
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

async function evalMultilingual(enc, labels) {
  const items = [];
  for (let idx = 0; idx < labels.length; idx++) {
    for (const lang of LANGS) {
      if (!labels[idx][lang]) continue;
      items.push({ entryId: idx, lang, group: labels[idx].group, vec: await enc.doc(labels[idx][lang]) });
    }
  }
  const perLang = {};
  for (const lang of LANGS) {
    let top1 = 0, top3 = 0, n = 0;
    for (let idx = 0; idx < labels.length; idx++) {
      const q = labels[idx][lang];
      if (!q || labels[idx].group === 'unclear') continue;
      const qv = await enc.query(q);
      const scores = items
        .filter((it) => it.entryId !== idx)
        .map((it) => ({ entryId: it.entryId, group: it.group, score: cosine(qv, it.vec) }));
      const rank = rankOf(scores, (x) => x.group === labels[idx].group);
      n++;
      if (rank === 1) top1++;
      if (rank <= 3) top3++;
    }
    perLang[lang] = { n, top1, top1Pct: n ? Number(((top1 / n) * 100).toFixed(1)) : 0, top3Pct: n ? Number(((top3 / n) * 100).toFixed(1)) : 0 };
  }
  return perLang;
}

async function main() {
  const gold = JSON.parse(fs.readFileSync(GOLD_PATH, 'utf8'));
  const multi = sampleStratified(JSON.parse(fs.readFileSync(LABELS_PATH, 'utf8')), LIMIT);
  const settings = {
    labse: ['LaBSE', { dir: MODELS, onnx: `${MODELS}/encoder.onnx`, maxLen: 256 }],
    gemma: ['Gemma q4', { dir: `${MODELS}/gemma2-q4`, onnx: `${MODELS}/gemma2-q4/onnx/model_q4.onnx`, maxLen: 512, qPrefix: 'task: search result | query: ', dPrefix: 'title: none | text: ' }],
  };
  const report = { gold: gold.length, goldEvaluated: gold.filter((f) => f.group !== 'unclear').length, multilingual: multi.length, models: {} };
  for (const name of MODELS_ARG.split(',').map((s) => s.trim()).filter(Boolean)) {
    const setting = settings[name];
    if (!setting) throw new Error(`unknown model "${name}" (expected: ${Object.keys(settings).join(', ')})`);
    const [label, cfg] = setting;
    const enc = await makeEncoder(cfg);
    const g = await evalGold(enc, gold);
    const ml = multi.length > 1 ? await evalMultilingual(enc, multi) : null;
    report.models[name] = {
      label,
      gold: { n: g.n, top1: g.top1, top1Pct: Number(((g.top1 / g.n) * 100).toFixed(1)), top3: g.top3, top3Pct: Number(((g.top3 / g.n) * 100).toFixed(1)) },
      perLang: ml,
    };
    console.log(`${label}: gold top1 ${g.top1}/${g.n} (${((g.top1 / g.n) * 100).toFixed(0)}%) top3 ${g.top3}/${g.n}`);
    if (ml) {
      console.log(`${label}: ${LANGS.filter((l) => ml[l]?.n).map((l) => `${l} ${ml[l].top1}/${ml[l].n} (${ml[l].top1Pct}%)`).join(' | ')}`);
    }
  }
  if (argv.includes('--json-out')) {
    const out = argv[argv.indexOf('--json-out') + 1];
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
  }
}

main().catch((e) => {
  console.error('field-eval failed:', e?.stack || e);
  process.exit(1);
});
