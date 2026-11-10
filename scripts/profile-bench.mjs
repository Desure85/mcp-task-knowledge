#!/usr/bin/env node
/**
 * Gate §5.5 (этап Y) — профильный benchmark на 100k: hit@1, medianMs, RSS.
 *
 * Usage:
 *   node scripts/profile-bench.mjs --count 100000 --queries 50
 *   node scripts/profile-bench.mjs --profile file --count 100000   # internal child mode
 *
 * Parent sequentially spawns one child per profile so RSS is measured on a clean process:
 *   - file:   100k JSON tasks written directly into a temp DATA_DIR, then the profile's FTS fill;
 *   - sqlite: 100k rows inserted directly, then the profile's FTS fill;
 *   - postgres: 100k rows inserted in batches, then the profile's FTS fill (POSTGRES_URL required).
 * Queries are unique planted tokens (marker-<i>) and the top-1 candidate must be the task that owns
 * the token; latency is the median over sampled queries. RSS is the process RSS after the index was
 * built (absolute) and the delta from the process start.
 *
 * Output: docs/benchmarks/profiles-100k.{json,md} (committed as the §5.5 artefact).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
function arg(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

const count = Number(arg('count', '100000'));
const queries = Number(arg('queries', '50'));
const profileArg = arg('profile', undefined);
const repoRoot = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

if (profileArg) {
  await runProfile(profileArg);
  process.exit(0);
}

const results = [];
for (const profile of ['file', 'sqlite', 'postgres']) {
  if (profile === 'postgres' && !process.env.POSTGRES_URL) {
    console.error('skipping postgres: POSTGRES_URL is not set');
    continue;
  }
  console.error(`[profile-bench] running ${profile} (${count} tasks)…`);
  const child = spawnSync(
    process.execPath,
    [new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--profile', profile, '--count', String(count), '--queries', String(queries)],
    {
      cwd: repoRoot,
      env: { ...process.env, TEMP: path.join(repoRoot, '..', '.tmp'), TMP: path.join(repoRoot, '..', '.tmp') },
      encoding: 'utf8',
      timeout: 30 * 60 * 1000,
    },
  );
  if (child.status !== 0) {
    console.error(child.stderr?.slice(-4000));
    process.exit(1);
  }
  const line = child.stdout.trim().split('\n').filter(Boolean).at(-1);
  results.push(JSON.parse(line));
}

const docsDir = path.join(repoRoot, 'docs', 'benchmarks');
fs.mkdirSync(docsDir, { recursive: true });
fs.writeFileSync(path.join(docsDir, 'profiles-100k.json'), `${JSON.stringify({ count, queries, generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
const rows = results
  .map((entry) => `| ${entry.profile} | ${entry.hitAt1.toFixed(3)} | ${entry.medianMs.toFixed(2)} | ${entry.p95Ms.toFixed(2)} | ${entry.rssMb.toFixed(1)} | ${entry.rssDeltaMb.toFixed(1)} | ${entry.seedMs} | ${entry.indexMs} |`)
  .join('\n');
const markdown = `# Профильный benchmark: 100k задач

Сгенерировано \`scripts/profile-bench.mjs\` (${new Date().toISOString()}).

| Профиль | hit@1 | medianMs | p95Ms | RSS, MB | RSS delta, MB | seed, ms | index, ms |
|---|---|---|---|---|---|---|---|
${rows}

- **hit@1** — доля запросов, где top-1 кандидат совпал с задачей, в которую внедрён уникальный токен
  \`marker-<i>\` (${queries} запросов, равномерно по корпусу).
- **medianMs/p95Ms** — латентность одного запроса кандидатов через профильный \`SearchProvider\`.
- **RSS** — процесс после построения индекса; **RSS delta** — от старта процесса.
- **seed/index** — подготовка корпуса и построение полнотекстового индекса; в латентность запросов не входят.
- Корпус: 100k задач с уникальными токенами в title; эмбеддинги не используются (\`EMBEDDINGS_MODE=none\`),
  поэтому это сравнение полнотекстового поиска профилей, а не векторного.
- Postgres-строка требует \`POSTGRES_URL\`; без неё скрипт пропускает профиль и таблица неполна.
`;
fs.writeFileSync(path.join(docsDir, 'profiles-100k.md'), markdown);
console.log(markdown);
console.log(JSON.stringify(results, null, 2));

async function runProfile(profile) {
  const startedRss = process.memoryUsage().rss;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `profile-bench-${profile}-`));
  process.env.DATA_DIR = tempDir;
  process.env.EMBEDDINGS_MODE = 'none';
  process.env.STORAGE_PROFILE = profile;
  const { createFileProfile } = await import(new URL('../dist/storage/profiles/file/index.js', import.meta.url).href);
  const { createSqliteProfile } = await import(new URL('../dist/storage/profiles/sqlite/index.js', import.meta.url).href);
  const { createPostgresProfile } = await import(new URL('../dist/storage/profiles/postgres/index.js', import.meta.url).href);

  const project = 'bench';
  const now = new Date().toISOString();
  let profileHandle;
  let indexMs = 0;
  let seedMs = 0;
  let closeFileIndexes = () => {};

  try {
    if (profile === 'file') {
      const tasksDir = path.join(tempDir, 'tasks', project);
      fs.mkdirSync(tasksDir, { recursive: true });
      const seedStarted = performance.now();
      for (let index = 0; index < count; index += 1) {
        const task = benchTask(project, index, now);
        fs.writeFileSync(path.join(tasksDir, `${task.id}.json`), JSON.stringify(task), 'utf8');
      }
      seedMs = Math.round(performance.now() - seedStarted);
      profileHandle = createFileProfile();
      // The file profile's SearchProvider uses the process-wide metadata/FTS indexes, exactly like
      // the server does. Without these two lines it reports available() === false and the fill would
      // never complete (the smoke run caught that).
      const meta = await import(new URL('../dist/storage/metadata-index.js', import.meta.url).href);
      const fts = await import(new URL('../dist/search/fts-index.js', import.meta.url).href);
      const ftsIndexer = await import(new URL('../dist/search/fts-indexer.js', import.meta.url).href);
      const metadataIndex = meta.createMetadataIndex({ dataDir: tempDir });
      if (metadataIndex) meta.setActiveMetadataIndex(metadataIndex);
      const ftsIndex = fts.FtsSearchIndex.open(path.join(tempDir, meta.METADATA_INDEX_DIR, meta.METADATA_INDEX_FILE));
      ftsIndexer.setActiveFtsIndex(ftsIndex);
      closeFileIndexes = () => {
        ftsIndexer.setActiveFtsIndex(undefined);
        ftsIndex.close?.();
        meta.setActiveMetadataIndex(undefined);
        metadataIndex?.close?.();
      };
    } else if (profile === 'sqlite') {
      const { openSqliteDatabase } = await import(new URL('../dist/storage/profiles/sqlite/db.js', import.meta.url).href);
      const databasePath = path.join(tempDir, 'bench.sqlite');
      const handle = openSqliteDatabase(databasePath);
      const insert = handle.db.prepare('insert into tasks(project, id, data) values(?,?,?)');
      const seedStarted = performance.now();
      handle.db.transaction(() => {
        for (let index = 0; index < count; index += 1) {
          const task = benchTask(project, index, now);
          insert.run(project, task.id, JSON.stringify(task));
        }
      })();
      handle.close();
      seedMs = Math.round(performance.now() - seedStarted);
      profileHandle = createSqliteProfile({ databasePath });
    } else {
      const { default: pg } = await import('pg');
      const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL });
      await pool.query('truncate tasks, docs, doc_versions, projects, search_index, search_state');
      const seedStarted = performance.now();
      const batchSize = 500;
      for (let base = 0; base < count; base += batchSize) {
        const values = [];
        const params = [];
        for (let offset = 0; offset < batchSize && base + offset < count; offset += 1) {
          const task = benchTask(project, base + offset, now);
          values.push(`($${params.length + 1},$${params.length + 2},$${params.length + 3})`);
          params.push(project, task.id, JSON.stringify(task));
        }
        await pool.query(`insert into tasks(project, id, data) values ${values.join(',')}`, params);
      }
      await pool.end();
      seedMs = Math.round(performance.now() - seedStarted);
      profileHandle = await createPostgresProfile({ connectionString: process.env.POSTGRES_URL, blobsDir: path.join(tempDir, 'blobs') });
    }

    const indexStarted = performance.now();
    profileHandle.search.ensureIndexed(project);
    const deadline = Date.now() + 20 * 60 * 1000;
    while (!profileHandle.search.isIndexComplete(project)) {
      if (Date.now() > deadline) throw new Error(`index build timeout for ${profile}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    indexMs = Math.round(performance.now() - indexStarted);

    const store = profileHandle.search.taskStoreId();
    const sample = [];
    for (let queryIndex = 0; queryIndex < queries; queryIndex += 1) {
      sample.push(Math.floor(((queryIndex + 0.5) * count) / queries));
    }
    const latencies = [];
    let hits = 0;
    for (const index of sample) {
      const id = `bench-${index}`;
      const query = `marker-${index}`;
      const started = performance.now();
      const candidates = (await profileHandle.search.candidatesAsync?.({ store, kind: 'task', project, query, limit: 5 })) ??
        profileHandle.search.candidates({ store, kind: 'task', project, query, limit: 5 });
      latencies.push(performance.now() - started);
      if (candidates[0]?.id === id) hits += 1;
    }
    latencies.sort((a, b) => a - b);
    const medianMs = latencies[Math.floor(latencies.length / 2)];
    const p95Ms = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];
    const rss = process.memoryUsage().rss;
    const result = {
      profile,
      count,
      queries,
      seedMs,
      indexMs,
      hitAt1: hits / sample.length,
      medianMs,
      p95Ms,
      rssMb: rss / 1024 / 1024,
      rssDeltaMb: (rss - startedRss) / 1024 / 1024,
    };
    console.log(JSON.stringify(result));
  } finally {
    try {
      closeFileIndexes();
      profileHandle?.close?.();
    } catch {
      // best-effort
    }
    if (profile === 'postgres' && process.env.POSTGRES_URL) {
      const { default: pg } = await import('pg');
      const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL });
      await pool.query('truncate tasks, docs, doc_versions, projects, search_index, search_state').catch(() => undefined);
      await pool.end();
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Windows may hold index locks for a moment; the benchmark result is already emitted.
    }
  }
}

function benchTask(project, index, now) {
  return {
    id: `bench-${index}`,
    project,
    title: `bench task ${index} marker-${index}`,
    description: `corpus row ${index} for profile latency measurement`,
    status: 'todo',
    priority: 'medium',
    tags: ['bench'],
    createdAt: now,
    updatedAt: now,
    archived: false,
    trashed: false,
  };
}
