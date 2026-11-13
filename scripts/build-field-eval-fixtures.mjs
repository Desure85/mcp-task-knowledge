/**
 * KE-06: build durable field-eval fixtures from a repository's JSON i18n catalogs.
 *
 * This is source-agnostic on purpose: ALB's `common/messages` is PHP, so this
 * script supports JSON catalogs (`src/i18n/messages/<lang>.json`) and fails
 * loudly for unsupported source layouts instead of inventing translations.
 *
 * Outputs:
 *   gold_fields.json          [{ name, desc, type, group }]
 *   multilingual_labels.json  [{ group, en, ru, ... }]
 *   manifest.json             source/commit/counts/languages/required/partial
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function flatten(value, prefix = '', out = new Map()) {
  if (typeof value === 'string') {
    out.set(prefix, value);
    return out;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, child] of Object.entries(value)) {
    flatten(child, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

export function loadCatalogs(labelDir) {
  if (!fs.existsSync(labelDir)) throw new Error(`catalog directory not found: ${labelDir}`);
  const files = fs.readdirSync(labelDir).filter((file) => file.endsWith('.json')).sort();
  if (files.length < 2) throw new Error(`at least 2 language catalogs required, found ${files.length}`);
  const catalogs = {};
  for (const file of files) {
    const lang = path.basename(file, '.json');
    const parsed = JSON.parse(fs.readFileSync(path.join(labelDir, file), 'utf8'));
    catalogs[lang] = flatten(parsed);
  }
  return catalogs;
}

export function buildFixtures(catalogs) {
  const langs = Object.keys(catalogs).sort();
  if (langs.length < 2) throw new Error('at least 2 languages required');
  const keys = [...new Set(langs.flatMap((lang) => [...catalogs[lang].keys()]))].sort();
  if (keys.length === 0) throw new Error('no string leaves found in catalogs');

  const primary = catalogs.en ? 'en' : langs[0];
  const gold = keys.map((name) => ({
    name,
    desc: catalogs[primary].get(name) ?? catalogs[langs[0]].get(name) ?? '',
    type: 'ui-string',
    group: name.split('.')[0] || 'root',
  }));
  const labels = keys.map((name) => {
    const entry = { group: name.split('.')[0] || 'root' };
    for (const lang of langs) {
      const value = catalogs[lang].get(name);
      if (value) entry[lang] = value;
    }
    return entry;
  });
  return { langs, gold, labels };
}

export function assertLanguages(langs, required = []) {
  const missing = required.filter((lang) => !langs.includes(lang));
  if (missing.length) throw new Error(`missing required languages: ${missing.join(', ')}`);
  return missing;
}

function gitCommit(repo) {
  try {
    return execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

function main() {
  const args = process.argv.slice(2);
  const get = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };
  const repo = path.resolve(get('repo', '.'));
  const outDir = path.resolve(get('out', 'scripts/fixtures/field-eval'));
  const labelDir = path.resolve(repo, get('label-dir', 'src/i18n/messages'));
  const required = (get('require-langs', '') || '').split(',').map((s) => s.trim()).filter(Boolean);

  const catalogs = loadCatalogs(labelDir);
  const { langs, gold, labels } = buildFixtures(catalogs);
  const missing = assertLanguages(langs, required);
  const manifest = {
    source: get('source-url', repo.replace(/\\/g, '/')),
    commit: gitCommit(repo),
    catalogDir: path.relative(repo, labelDir).replace(/\\/g, '/'),
    createdAt: get('created-at', new Date().toISOString()),
    languages: langs,
    requiredLanguages: required,
    missingLanguages: missing,
    partial: required.length > 0 && missing.length > 0,
    fields: gold.length,
    labels: labels.length,
    sha256: {
      gold: createHash('sha256').update(JSON.stringify(gold)).digest('hex'),
      labels: createHash('sha256').update(JSON.stringify(labels)).digest('hex'),
    },
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'gold_fields.json'), `${JSON.stringify(gold, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(outDir, 'multilingual_labels.json'), `${JSON.stringify(labels, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`field-eval fixtures: ${gold.length} fields, ${langs.length} languages (${langs.join(', ')})`);
  if (required.length) console.log(`required languages: ${required.join(', ')}${missing.length ? ` (missing ${missing.join(', ')})` : ' (all present)'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.url.replace('file:///', ''))) {
  main();
}
