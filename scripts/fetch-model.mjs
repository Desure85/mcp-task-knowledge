#!/usr/bin/env node
/**
 * Downloads an ONNX embedding model into the directory the server auto-detects.
 *
 * Usage:
 *   node scripts/fetch-model.mjs              # list presets
 *   node scripts/fetch-model.mjs gemma-q4     # ~200 MB, best quality on RU/EN/code
 *   node scripts/fetch-model.mjs labse-int8   # ~120 MB, legacy baseline
 *   node scripts/fetch-model.mjs <preset> --dir /custom/models
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PRESETS = {
  'gemma-q4': {
    label: 'EmbeddingGemma-2 (q4, 100+ languages, best on mixed RU/EN + code)',
    files: [
      ['onnx/model_q4.onnx', 'onnx/model_q4.onnx'],
      ['onnx/model_q4.onnx_data', 'onnx/model_q4.onnx_data'],
      ['tokenizer.json', 'tokenizer.json'],
      ['tokenizer_config.json', 'tokenizer_config.json'],
      ['config.json', 'config.json'],
      ['special_tokens_map.json', 'special_tokens_map.json'],
    ],
    env: {
      EMBEDDINGS_MODEL_PATH: 'onnx/model_q4.onnx',
      EMBEDDINGS_DIM: '768',
      EMBEDDINGS_QUERY_PREFIX: 'task: search result | query:',
      EMBEDDINGS_DOC_PREFIX: 'title: none | text:',
    },
  },
  'labse-int8': {
    label: 'LaBSE (int8, multilingual, legacy baseline)',
    files: [
      ['onnx/model_int8.onnx', 'encoder.onnx'],
      ['tokenizer.json', 'tokenizer.json'],
      ['tokenizer_config.json', 'tokenizer_config.json'],
      ['config.json', 'config.json'],
      ['special_tokens_map.json', 'special_tokens_map.json'],
    ],
    env: {
      EMBEDDINGS_MODEL_PATH: 'encoder.onnx',
      EMBEDDINGS_DIM: '768',
    },
  },
};

const args = process.argv.slice(2);
const dirFlag = args.indexOf('--dir');
const customDir = dirFlag >= 0 ? args[dirFlag + 1] : undefined;
const presetName = args.find((a) => !a.startsWith('--') && a !== customDir);

const defaultDir = path.join(os.homedir(), '.local', 'share', 'mcp-task-knowledge', 'models');

if (!presetName || !PRESETS[presetName]) {
  console.log('Available presets:\n');
  for (const [name, p] of Object.entries(PRESETS)) console.log(`  ${name.padEnd(12)} ${p.label}`);
  console.log('\nUsage: node scripts/fetch-model.mjs <preset> [--dir DIR]');
  console.log(`Default target: ${defaultDir}`);
  process.exit(presetName ? 1 : 0);
}

const preset = PRESETS[presetName];
const target = path.join(customDir || defaultDir, presetName);
const repo = presetName === 'gemma-q4' ? 'onnx-community/embeddinggemma-2-ONNX' : 'Xenova/LaBSE';

console.log(`Downloading ${preset.label}\n  source: ${repo}\n  target: ${target}\n`);

for (const [remote, local] of preset.files) {
  const url = `https://huggingface.co/${repo}/resolve/main/${remote}`;
  const out = path.join(target, local);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (fs.existsSync(out) && fs.statSync(out).size > 0) {
    console.log(`  skip   ${local} (already present)`);
    continue;
  }
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    const critical = remote.endsWith('.onnx') || remote.endsWith('.onnx_data');
    if (!critical && res.status === 404) {
      console.log(`  skip   ${local} (not in ${repo})`);
      continue;
    }
    throw new Error(`${remote}: HTTP ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(out, buffer);
  console.log(`  saved  ${local} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
}

const envLines = Object.entries(preset.env).map(([key, value]) => {
  const resolved = key.endsWith('_PATH') ? path.join(target, value) : value;
  return `${key}=${resolved.includes(' ') ? `"${resolved}"` : resolved}`;
});
console.log('\nAdd to the server environment:\n');
for (const line of envLines) console.log(`  ${line}`);
console.log('\nThe server also finds the model automatically if it lives under one of:');
console.log('  /app/models, <repo>/models, $DATA_DIR/models, ~/.local/share/mcp-task-knowledge/models');
