#!/usr/bin/env node
/**
 * Y-05c — сравнение file- и sqlite-профилей на одинаковой нагрузке.
 *
 * Меряет create/list/page/get/update и печатает таблицу. По умолчанию 10 000 задач;
 * `--count 100000` — заявленный в плане размер (файловый прогон на 100k занимает минуты).
 * Запуск: `npm run build && node scripts/storage-bench.mjs --count 10000`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function parseArgs(argv) {
  const options = { count: 10_000, profile: 'both', json: false, ops: ['create', 'list', 'page', 'get', 'update'] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--count') options.count = Number(argv[++index]);
    else if (arg === '--profile') options.profile = argv[++index];
    else if (arg === '--ops') options.ops = String(argv[++index]).split(',').map((entry) => entry.trim());
    else if (arg === '--json') options.json = true;
    else {
      console.error(`unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(options.count) || options.count <= 0) {
    console.error('--count must be a positive number');
    process.exit(2);
  }
  return options;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function makeIds(prefix, count) {
  return Array.from({ length: Math.min(count, 1000) }, (_, index) => `${prefix}-${index}`);
}

async function benchProfile(label, profile, count, ops) {
  const timings = {};
  const created = [];
  let started = performance.now();
  for (let index = 0; index < count; index += 1) {
    created.push(
      await profile.tasks.create({
        project: 'bench',
        title: `task ${index}`,
        description: `benchmark corpus item ${index}`,
        tags: ['bench'],
      }),
    );
  }
  timings.create_ms = performance.now() - started;
  if (!ops.includes('list') && !ops.includes('page') && !ops.includes('get') && !ops.includes('update')) {
    timings.items = count;
    return timings;
  }

  started = performance.now();
  const all = await profile.tasks.list({ project: 'bench' });
  timings.list_ms = performance.now() - started;
  if (all.length !== count) throw new Error(`${label}: list returned ${all.length}, expected ${count}`);
  if (!ops.includes('page') && !ops.includes('get') && !ops.includes('update')) {
    timings.items = count;
    return timings;
  }

  // First-page latency, measured five times. Cursor semantics differ between profiles (the file
  // profile's `keys` are opaque index keys, not task ids), so pagination depth is measured by the
  // profile's own contract tests, not by this micro-benchmark.
  const pageTimes = [];
  for (let page = 0; page < 5; page += 1) {
    const pageStarted = performance.now();
    const result = await profile.tasks.page('bench', { limit: 100 });
    pageTimes.push(performance.now() - pageStarted);
    if (result.items.length !== 100) throw new Error('page did not return 100 items');
  }
  if (ops.includes('page')) timings.page_first100_ms = median(pageTimes);
  if (!ops.includes('get') && !ops.includes('update')) {
    timings.items = count;
    return timings;
  }

  const sample = created.filter((_, index) => index % Math.max(1, Math.floor(count / 200)) === 0).slice(0, 200);
  started = performance.now();
  for (const task of sample) {
    const fetched = await profile.tasks.get('bench', task.id);
    if (!fetched) throw new Error(`${label}: get(${task.id}) returned null`);
  }
  if (ops.includes('get')) timings.get200_ms = performance.now() - started;

  started = performance.now();
  for (const task of sample.slice(0, 100)) {
    await profile.tasks.update('bench', task.id, { description: `updated ${task.id}` });
  }
  if (ops.includes('update')) timings.update100_ms = performance.now() - started;

  timings.items = count;
  return timings;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const results = {};
  // The config module resolves DATA_DIR at import time (and the sqlite profile imports it for the
  // default project id), so both profiles get an isolated temp root before any dynamic import.
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-bench-base-'));
  process.env.DATA_DIR = baseDir;
  process.env.OBSIDIAN_VAULT_ROOT = path.join(baseDir, 'vault');
  process.env.EMBEDDINGS_MODE = 'none';

  if (options.profile === 'both' || options.profile === 'file') {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-bench-file-'));
    const { createFileProfile } = await import('../dist/storage/profiles/file/index.js');
    const profile = createFileProfile();
    results.file = await benchProfile('file', profile, options.count, options.ops);
    profile.close?.();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  if (options.profile === 'both' || options.profile === 'sqlite') {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-bench-sqlite-'));
    const { createSqliteProfile } = await import('../dist/storage/profiles/sqlite/index.js');
    const profile = createSqliteProfile({ databasePath: path.join(dataDir, 'storage.sqlite') });
    results.sqlite = await benchProfile('sqlite', profile, options.count, options.ops);
    profile.close?.();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  const rows = ['| operation | file (ms) | sqlite (ms) | speedup |', '|---|---:|---:|---:|'];
  for (const key of Object.keys(results.file ?? results.sqlite)) {
    if (key === 'items') continue;
    const fileValue = results.file?.[key];
    const sqliteValue = results.sqlite?.[key];
    const speedup =
      typeof fileValue === 'number' && typeof sqliteValue === 'number' && sqliteValue > 0
        ? `${(fileValue / sqliteValue).toFixed(2)}x`
        : '-';
    rows.push(`| ${key} | ${fileValue?.toFixed(1) ?? '-'} | ${sqliteValue?.toFixed(1) ?? '-'} | ${speedup} |`);
  }
  console.log(`items: ${options.count}`);
  console.log(rows.join('\n'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
