#!/usr/bin/env node
/**
 * scripts/bench/sqlite-index-bench.mjs — SC-02 прототип-замер SQLite-индекса метаданных.
 *
 * ЭТО БЕНЧ, А НЕ РЕАЛИЗАЦИЯ. Скрипт не входит в `npm test` и в CI (как и остальные файлы
 * `scripts/bench/`). Он строит производный SQLite-индекс по тем же файлам, что читает сервер,
 * и меряет стоимость операций, которые SC-02 должен ускорить:
 *
 *   - построение индекса целиком (rebuild, строки/с, размер БД);
 *   - страница списка с фильтром и курсором `(mtime_ms desc, id asc)` — порядок SC-01;
 *   - count-only;
 *   - стоимость чтения ТОЛЬКО страницы файлов (что останется после индекса);
 *   - проверка «свежести» при старте (stat каталога проекта vs readdir+count);
 *   - стоимость upsert одной строки (запись задачи/документа).
 *
 * Для сравнения «до» скрипт умеет подгрузить собранный `dist/storage/{tasks,knowledge}.js`
 * с `DATA_DIR=<data>` и замерить текущий файловый путь in-process (см. `--before`).
 *
 * Usage:
 *   npm run build
 *   node scripts/bench/sqlite-index-bench.mjs --data /tmp/sc02/data-100k --reps 7 \
 *     --out /tmp/sc02/after-100k.json [--before] [--project bench] [--limit 50] [--db <path>]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import matter from 'gray-matter';

// ─── args ───────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    data: '',
    project: 'bench',
    reps: 7,
    limit: 50,
    out: '',
    db: '',
    before: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '--data': out.data = next(); break;
      case '--project': out.project = next(); break;
      case '--reps': out.reps = Number(next()); break;
      case '--limit': out.limit = Number(next()); break;
      case '--out': out.out = next(); break;
      case '--db': out.db = next(); break;
      case '--before': out.before = true; break;
      case '-h':
      case '--help':
        console.log('usage: node scripts/bench/sqlite-index-bench.mjs --data <DATA_DIR> [--reps 7] [--limit 50] [--out file] [--db file] [--before]');
        process.exit(0);
        break;
      default:
        throw new Error(`unknown arg: ${a}`);
    }
  }
  if (!out.data) throw new Error('--data is required');
  return out;
}

// ─── helpers ────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowMs = () => Number(process.hrtime.bigint() / 1000n) / 1000;

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function p95(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

async function measure(fn, reps) {
  await fn(); // warm-up (JIT, prepared stmt cache, page cache)
  const times = [];
  for (let r = 0; r < reps; r++) {
    const t0 = nowMs();
    const value = await fn();
    times.push(nowMs() - t0);
    if (value !== undefined && r === reps - 1) return { medianMs: median(times), p95Ms: p95(times), times, value };
  }
  return { medianMs: median(times), p95Ms: p95(times), times };
}

// ─── schema ─────────────────────────────────────────────────────────

/**
 * Схема намеренно повторяет контракт SC-02 из BACKLOG: id, project, status, priority,
 * type, parent_id, updated_at, tags. Дополнительно хранятся:
 *   - mtime_ms — ключ страницы SC-01 (курсор `{k: mtimeMs, id}`), поэтому порядок
 *     индекса и файлового пути совпадает байт-в-байт;
 *   - rel_path — путь относительно DATA_DIR, чтобы поддерживать оба layout'а
 *     (tasks/<project>/<id>.json и legacy tasks/<id>.json) и будущее шардирование SC-06;
 *   - archived/trashed — фильтры по умолчанию в list-путях.
 * Теги вынесены в отдельную таблицу: фильтр `tag=` по индексу, а не LIKE по JSON-строке.
 */
const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;

CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  project     TEXT NOT NULL,
  status      TEXT NOT NULL,
  priority    TEXT,
  type        TEXT NOT NULL DEFAULT 'task',
  parent_id   TEXT,
  updated_at  TEXT,
  mtime_ms    REAL NOT NULL,
  archived    INTEGER NOT NULL DEFAULT 0,
  trashed     INTEGER NOT NULL DEFAULT 0,
  rel_path    TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX idx_tasks_page        ON tasks(project, mtime_ms DESC, id ASC);
CREATE INDEX idx_tasks_status_page ON tasks(project, status, mtime_ms DESC, id ASC);
CREATE INDEX idx_tasks_type_page   ON tasks(project, type, mtime_ms DESC, id ASC);
CREATE INDEX idx_tasks_parent_page ON tasks(project, parent_id, mtime_ms DESC, id ASC);
CREATE INDEX idx_tasks_priority    ON tasks(project, priority, mtime_ms DESC, id ASC);

CREATE TABLE task_tags (
  task_id TEXT NOT NULL,
  tag     TEXT NOT NULL,
  PRIMARY KEY (task_id, tag)
) WITHOUT ROWID;
CREATE INDEX idx_task_tags_tag ON task_tags(tag, task_id);

CREATE TABLE docs (
  id          TEXT PRIMARY KEY,
  project     TEXT NOT NULL,
  title       TEXT,
  type        TEXT,
  parent_id   TEXT,
  trust_level TEXT,
  updated_at  TEXT,
  mtime_ms    REAL NOT NULL,
  archived    INTEGER NOT NULL DEFAULT 0,
  trashed     INTEGER NOT NULL DEFAULT 0,
  rel_path    TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX idx_docs_page        ON docs(project, mtime_ms DESC, id ASC);
CREATE INDEX idx_docs_type_page   ON docs(project, type, mtime_ms DESC, id ASC);
CREATE INDEX idx_docs_parent_page ON docs(project, parent_id, mtime_ms DESC, id ASC);

CREATE TABLE doc_tags (
  doc_id TEXT NOT NULL,
  tag    TEXT NOT NULL,
  PRIMARY KEY (doc_id, tag)
) WITHOUT ROWID;
CREATE INDEX idx_doc_tags_tag ON doc_tags(tag, doc_id);

CREATE TABLE projects (
  project     TEXT PRIMARY KEY,
  dir_mtime_ms REAL NOT NULL,
  file_count  INTEGER NOT NULL,
  synced_at   TEXT NOT NULL
) WITHOUT ROWID;
`;

// ─── build ──────────────────────────────────────────────────────────

async function collectTaskFiles(dataDir, project) {
  const modern = path.join(dataDir, 'tasks', project);
  const legacy = path.join(dataDir, 'tasks');
  const dir = existsSync(modern) ? modern : legacy;
  if (!existsSync(dir)) return { dir, files: [] };
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
  return { dir, files };
}

async function collectDocFiles(dataDir, project) {
  const modern = path.join(dataDir, 'knowledge', project);
  const legacy = path.join(dataDir, 'knowledge');
  const dir = existsSync(modern) ? modern : legacy;
  if (!existsSync(dir)) return { dir, files: [] };
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md'));
  return { dir, files };
}

function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('temp_store = MEMORY');
  return db;
}

async function buildIndex(db, dataDir, project, taskDirInfo, docDirInfo) {
  const t0 = nowMs();

  db.exec(SCHEMA);
  const insertTask = db.prepare(
    `INSERT INTO tasks (id, project, status, priority, type, parent_id, updated_at, mtime_ms, archived, trashed, rel_path)
     VALUES (@id, @project, @status, @priority, @type, @parent_id, @updated_at, @mtime_ms, @archived, @trashed, @rel_path)`,
  );
  const insertTaskTag = db.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag) VALUES (?, ?)');
  const insertDoc = db.prepare(
    `INSERT INTO docs (id, project, title, type, parent_id, trust_level, updated_at, mtime_ms, archived, trashed, rel_path)
     VALUES (@id, @project, @title, @type, @parent_id, @trust_level, @updated_at, @mtime_ms, @archived, @trashed, @rel_path)`,
  );
  const insertDocTag = db.prepare('INSERT OR IGNORE INTO doc_tags (doc_id, tag) VALUES (?, ?)');

  const loadTasks = db.transaction((rows) => {
    for (const r of rows) {
      insertTask.run(r);
      for (const tag of r.tags || []) insertTaskTag.run(r.id, tag);
    }
  });
  const loadDocs = db.transaction((rows) => {
    for (const r of rows) {
      insertDoc.run(r);
      for (const tag of r.tags || []) insertDocTag.run(r.id, tag);
    }
  });

  // ── tasks ──
  const tTasks0 = nowMs();
  const taskChunks = [];
  let taskRows = 0;
  const taskBatch = [];
  const taskMetas = await mapLimit(taskDirInfo.files, 64, async (f) => {
    const file = path.join(taskDirInfo.dir, f);
    const st = await fs.stat(file);
    const task = JSON.parse(await fs.readFile(file, 'utf-8'));
    return {
      id: task.id || f.slice(0, -5),
      project: task.project || project,
      status: String(task.status ?? 'pending'),
      priority: task.priority ?? null,
      type: task.type ?? 'task',
      parent_id: task.parentId ?? null,
      updated_at: task.updatedAt ?? null,
      mtime_ms: st.mtimeMs,
      archived: task.archived ? 1 : 0,
      trashed: task.trashed ? 1 : 0,
      rel_path: path.relative(dataDir, file),
      tags: Array.isArray(task.tags) ? task.tags : [],
    };
  });
  for (const m of taskMetas) {
    taskBatch.push(m);
    taskRows++;
    if (taskBatch.length >= 2000) {
      taskChunks.push(taskBatch.splice(0));
    }
  }
  if (taskBatch.length) taskChunks.push(taskBatch.splice(0));
  for (const chunk of taskChunks) loadTasks(chunk);
  // Sanity: the batches must all be consumed before COMMIT (transaction bound per chunk).
  const tTasks1 = nowMs();

  // ── docs ──
  const tDocs0 = nowMs();
  const docChunks = [];
  const docBatch = [];
  let docRows = 0;
  const docMetas = await mapLimit(docDirInfo.files, 64, async (f) => {
    const file = path.join(docDirInfo.dir, f);
    const st = await fs.stat(file);
    const parsed = matter(await fs.readFile(file, 'utf-8'));
    const meta = parsed.data || {};
    return {
      id: meta.id || f.slice(0, -3),
      project: meta.project || project,
      title: meta.title ?? null,
      type: meta.type ?? null,
      parent_id: meta.parentId ?? null,
      trust_level: meta.trustLevel ?? null,
      updated_at: meta.updatedAt ?? null,
      mtime_ms: st.mtimeMs,
      archived: meta.archived ? 1 : 0,
      trashed: meta.trashed ? 1 : 0,
      rel_path: path.relative(dataDir, file),
      tags: Array.isArray(meta.tags) ? meta.tags : [],
    };
  });
  for (const m of docMetas) {
    docBatch.push(m);
    docRows++;
    if (docBatch.length >= 2000) docChunks.push(docBatch.splice(0));
  }
  if (docBatch.length) docChunks.push(docBatch.splice(0));
  for (const chunk of docChunks) loadDocs(chunk);
  const tDocs1 = nowMs();

  db.prepare('INSERT OR REPLACE INTO projects (project, dir_mtime_ms, file_count, synced_at) VALUES (?, ?, ?, ?)').run(
    project,
    (await fs.stat(taskDirInfo.dir)).mtimeMs,
    taskDirInfo.files.length,
    new Date().toISOString(),
  );
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('schema_version', '1');

  const total = nowMs() - t0;
  return {
    totalMs: Math.round(total),
    tasks: { rows: taskRows, parseMs: Math.round(tTasks1 - tTasks0), rowsPerSec: Math.round(taskRows / ((tTasks1 - tTasks0) / 1000)) },
    docs: { rows: docRows, parseMs: Math.round(tDocs1 - tDocs0), rowsPerSec: Math.round(docRows / ((tDocs1 - tDocs0) / 1000)) },
  };
}

// ─── queries ────────────────────────────────────────────────────────

const TASK_PAGE_SQL = {
  plain: `SELECT id, rel_path, mtime_ms FROM tasks
          WHERE project = ? AND archived = 0 AND trashed = 0
          ORDER BY mtime_ms DESC, id ASC LIMIT ?`,
  status: `SELECT id, rel_path, mtime_ms FROM tasks
           WHERE project = ? AND archived = 0 AND trashed = 0 AND status = ?
           ORDER BY mtime_ms DESC, id ASC LIMIT ?`,
  tag: `SELECT t.id, t.rel_path, t.mtime_ms FROM tasks t
        JOIN task_tags g ON g.task_id = t.id AND g.tag = ?
        WHERE t.project = ? AND t.archived = 0 AND t.trashed = 0
        ORDER BY t.mtime_ms DESC, t.id ASC LIMIT ?`,
  cursor: `SELECT id, rel_path, mtime_ms FROM tasks
           WHERE project = ? AND archived = 0 AND trashed = 0
             AND (mtime_ms < ? OR (mtime_ms = ? AND id > ?))
           ORDER BY mtime_ms DESC, id ASC LIMIT ?`,
};

const DOC_PAGE_SQL = {
  plain: `SELECT id, rel_path, mtime_ms FROM docs
          WHERE project = ? AND archived = 0 AND trashed = 0
          ORDER BY mtime_ms DESC, id ASC LIMIT ?`,
  tag: `SELECT d.id, d.rel_path, d.mtime_ms FROM docs d
        JOIN doc_tags g ON g.doc_id = d.id AND g.tag = ?
        WHERE d.project = ? AND d.archived = 0 AND d.trashed = 0
        ORDER BY d.mtime_ms DESC, d.id ASC LIMIT ?`,
};

function readTaskRows(dataDir, rows) {
  return Promise.all(rows.map(async (r) => {
    const task = JSON.parse(await fs.readFile(path.join(dataDir, r.rel_path), 'utf-8'));
    return { ...task, type: task.type ?? 'task', id: task.id ?? r.id };
  }));
}

function readDocRows(dataDir, rows) {
  return Promise.all(rows.map(async (r) => {
    const parsed = matter(await fs.readFile(path.join(dataDir, r.rel_path), 'utf-8'));
    const meta = parsed.data || {};
    return { ...meta, id: meta.id ?? r.id };
  }));
}

async function runIndexBench(db, dataDir, project, limit, reps) {
  const stmtPlain = db.prepare(TASK_PAGE_SQL.plain);
  const stmtStatus = db.prepare(TASK_PAGE_SQL.status);
  const stmtTag = db.prepare(TASK_PAGE_SQL.tag);
  const stmtCursor = db.prepare(TASK_PAGE_SQL.cursor);
  const stmtCount = db.prepare('SELECT count(*) AS n FROM tasks WHERE project = ? AND archived = 0 AND trashed = 0');
  const stmtDocPlain = db.prepare(DOC_PAGE_SQL.plain);
  const stmtDocTag = db.prepare(DOC_PAGE_SQL.tag);

  const results = {};

  results.tasksPageSqlOnly = await measure(() => stmtPlain.all(project, limit + 1), reps);
  results.tasksPageWithFiles = await measure(async () => {
    const rows = stmtPlain.all(project, limit + 1);
    const page = rows.slice(0, limit);
    return readTaskRows(dataDir, page);
  }, reps);
  results.tasksPageFilteredStatus = await measure(async () => {
    const rows = stmtStatus.all(project, 'pending', limit + 1);
    return readTaskRows(dataDir, rows.slice(0, limit));
  }, reps);
  results.tasksPageFilteredTag = await measure(async () => {
    const rows = stmtTag.all('perf', project, limit + 1);
    return readTaskRows(dataDir, rows.slice(0, limit));
  }, reps);
  results.tasksCountOnly = await measure(() => stmtCount.get(project), reps);

  const firstPage = stmtPlain.all(project, limit + 1).slice(0, limit);
  const last = firstPage[firstPage.length - 1];
  results.tasksPageCursor = await measure(async () => {
    const rows = stmtCursor.all(project, last.mtime_ms, last.mtime_ms, last.id, limit + 1);
    return readTaskRows(dataDir, rows.slice(0, limit));
  }, reps);

  results.docsPageSqlOnly = await measure(() => stmtDocPlain.all(project, limit + 1), reps);
  results.docsPageWithFiles = await measure(async () => {
    const rows = stmtDocPlain.all(project, limit + 1);
    return readDocRows(dataDir, rows.slice(0, limit));
  }, reps);
  results.docsPageFilteredTag = await measure(async () => {
    const rows = stmtDocTag.all('perf', project, limit + 1);
    return readDocRows(dataDir, rows.slice(0, limit));
  }, reps);

  // Одна запись: upsert строки + тегов (как в критической секции writeJson → index).
  const upsert = db.transaction((row) => {
    db.prepare(
      `INSERT INTO tasks (id, project, status, priority, type, parent_id, updated_at, mtime_ms, archived, trashed, rel_path)
       VALUES (@id, @project, @status, @priority, @type, @parent_id, @updated_at, @mtime_ms, 0, 0, @rel_path)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status, priority = excluded.priority, type = excluded.type,
         parent_id = excluded.parent_id, updated_at = excluded.updated_at, mtime_ms = excluded.mtime_ms`,
    ).run(row);
    db.prepare('DELETE FROM task_tags WHERE task_id = ?').run(row.id);
    for (const t of row.tags || []) db.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag) VALUES (?, ?)').run(row.id, t);
  });
  const sample = firstPage[0];
  results.upsertOne = await measure(() => {
    upsert({
      id: sample.id,
      project,
      status: 'pending',
      priority: 'medium',
      type: 'task',
      parent_id: null,
      updated_at: new Date().toISOString(),
      mtime_ms: Date.now(),
      rel_path: sample.rel_path,
      tags: ['bench', 'perf'],
    });
  }, Math.max(reps, 20));

  return results;
}

// ─── startup sync cost ──────────────────────────────────────────────

async function runSyncBench(db, dataDir, project, taskDirInfo) {
  const getProj = db.prepare('SELECT project, dir_mtime_ms, file_count FROM projects WHERE project = ?');
  const out = {};
  out.dirStatOnly = await measure(async () => (await fs.stat(taskDirInfo.dir)).mtimeMs, 15);
  out.dirStatAndCount = await measure(async () => {
    const st = await fs.stat(taskDirInfo.dir);
    const files = await fs.readdir(taskDirInfo.dir);
    const row = getProj.get(project);
    return { sameMtime: row ? st.mtimeMs === row.dir_mtime_ms : false, count: files.length };
  }, 9);
  out.dbOpenAndPragma = await measure(() => {
    const probe = new Database(path.join(dataDir, '.index-bench', 'probe.db'));
    probe.pragma('journal_mode = WAL');
    probe.pragma('busy_timeout = 5000');
    probe.prepare('SELECT 1').get();
    probe.close();
    return true;
  }, 7);
  await fs.rm(path.join(dataDir, '.index-bench', 'probe.db'), { force: true }).catch(() => {});
  await fs.rm(path.join(dataDir, '.index-bench', 'probe.db-wal'), { force: true }).catch(() => {});
  await fs.rm(path.join(dataDir, '.index-bench', 'probe.db-shm'), { force: true }).catch(() => {});
  return out;
}

// ─── before: current file path in-process ───────────────────────────

async function runBeforeBench(dataDir, project, limit, reps) {
  process.env.DATA_DIR = dataDir;
  process.env.CURRENT_PROJECT = project;
  process.env.EMBEDDINGS_MODE = 'none';
  // Dynamic `import()` of an absolute path needs a URL: on Windows a bare
  // `C:\...` string is parsed as the `c:` protocol and the loader refuses it.
  const storage = await import(
    pathToFileURL(path.resolve(import.meta.dirname, '../../dist/storage/tasks.js')).href
  );
  const knowledge = await import(
    pathToFileURL(path.resolve(import.meta.dirname, '../../dist/storage/knowledge.js')).href
  );
  const out = {};
  out.tasksPage = await measure(
    () => storage.listTasksPage(project, { limit, includeArchived: false, includeTrashed: false }),
    reps,
  );
  out.tasksPageFilteredStatus = await measure(
    () => storage.listTasksPage(project, { limit, status: 'pending' }),
    Math.min(reps, 3),
  );
  out.tasksPageFilteredTag = await measure(
    () => storage.listTasksPage(project, { limit, tag: 'perf' }),
    Math.min(reps, 3),
  );
  out.tasksCountOnly = await measure(
    () => storage.listTasksPage(project, { limit, countOnly: true }),
    Math.min(reps, 3),
  );
  out.docsPage = await measure(
    () => knowledge.listDocsPage(project, { limit, includeArchived: false, includeTrashed: false }),
    reps,
  );
  return out;
}

// ─── main ───────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = path.resolve(args.data);
  const dbPath = path.resolve(args.db || path.join(dataDir, '.index-bench', 'metadata.db'));

  const taskDirInfo = await collectTaskFiles(dataDir, args.project);
  const docDirInfo = await collectDocFiles(dataDir, args.project);
  if (!taskDirInfo.files.length && !docDirInfo.files.length) {
    throw new Error(`no seeded data under ${dataDir} (project ${args.project})`);
  }

  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) await fs.rm(dbPath + suffix, { force: true });

  const db = openDb(dbPath);
  const build = await buildIndex(db, dataDir, args.project, taskDirInfo, docDirInfo);
  db.pragma('wal_checkpoint(TRUNCATE)');

  const dbStat = await fs.stat(dbPath);
  const rows = db.prepare('SELECT count(*) AS n FROM tasks').get().n;
  const docs = db.prepare('SELECT count(*) AS n FROM docs').get().n;
  const tagRows = db.prepare('SELECT count(*) AS n FROM task_tags').get().n;

  const index = await runIndexBench(db, dataDir, args.project, args.limit, args.reps);
  const sync = await runSyncBench(db, dataDir, args.project, taskDirInfo);

  db.close();

  let before = null;
  if (args.before) {
    try {
      const raw = await runBeforeBench(dataDir, args.project, args.limit, Math.min(args.reps, 3));
      // Только тайминги: сами страницы в отчёт не пишем (это десятки КБ на элемент).
      before = Object.fromEntries(
        Object.entries(raw).map(([k, v]) => [k, typeof v?.medianMs === 'number' ? { medianMs: Number(v.medianMs.toFixed(2)), p95Ms: Number(v.p95Ms.toFixed(2)) } : v]),
      );
    } catch (err) {
      before = { error: String(err && err.message ? err.message : err) };
    }
  }

  const pick = (m) => (m && typeof m.medianMs === 'number' ? { medianMs: Number(m.medianMs.toFixed(2)), p95Ms: Number(m.p95Ms.toFixed(2)) } : m);
  const report = {
    ok: true,
    n: args.project ? Math.max(rows, docs) : 0,
    dataDir,
    dbPath,
    dbBytes: dbStat.size,
    rows: { tasks: rows, docs, taskTags: tagRows },
    rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    build,
    index: Object.fromEntries(Object.entries(index).map(([k, v]) => [k, pick(v)])),
    sync: Object.fromEntries(Object.entries(sync).map(([k, v]) => [k, pick(v)])),
    before,
    startedAt: new Date().toISOString(),
  };

  if (args.out) {
    await fs.mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
    await fs.writeFile(path.resolve(args.out), JSON.stringify(report, null, 2), 'utf8');
  }

  console.log(JSON.stringify(report, null, 2));
  // Не оставляем WAL-файлы: db закрыт и чекпойнтнут, но -shm может остаться.
  await fs.rm(dbPath + '-shm', { force: true }).catch(() => {});
  await sleep(10);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
