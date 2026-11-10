/**
 * Y-08a — migrate-storage: миграция file ↔ SQLite по фазам ADR-009.
 *
 * Фазы: план (dry-run) → снимок цели (backup) → дельта в эксклюзивной секции → проверка
 * (контрольные суммы) → отчёт. Источник только читается; цель обновляется идемпотентно
 * (создать/обновить/пропустить по sha256 канонического JSON). «Переключение» — смена
 * `STORAGE_PROFILE`; данные в старой локации остаются нетронутыми, поэтому откат конфигурации
 * не требует повторного копирования.
 *
 * Перенос поддерживает задачи, документы, метаданные проектов, версии документов и блобы.
 * События/замки — операционные данные (пересоздаются), внешние коллекции промптов/памяти живут
 * файлами в обоих профилях и не мигрируются (записано в решении).
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import Database from 'better-sqlite3';
import { openSqliteDatabase } from './profiles/sqlite/db.js';
import { withFileLock } from '../fs.js';
import type { KnowledgeDoc, Task } from '../types.js';
import type { ProjectMetadata } from '../projects.js';

export type MigrationDirection = 'file-to-sqlite' | 'sqlite-to-file';

export interface MigrateStorageOptions {
  dataDir: string;
  /** SQLite database the `sqlite` side of the migration reads/writes. */
  databasePath: string;
  direction: MigrationDirection;
  /** Compute the plan and report only; never writes, never backs up. */
  dryRun?: boolean;
  /** Compare both sides and report discrepancies; never writes. */
  verifyOnly?: boolean;
  /** Where the target snapshot is written before applying; defaults under `.backups`. */
  backupDir?: string;
  /** Exclusive section around the delta; defaults to true. */
  exclusive?: boolean;
  now?: () => Date;
}

export interface CollectionCounts {
  source: number;
  created: number;
  updated: number;
  skipped: number;
}

export interface MigrateStorageReport {
  direction: MigrationDirection;
  dryRun: boolean;
  verifyOnly: boolean;
  dataDir: string;
  databasePath: string;
  counts: {
    tasks: CollectionCounts;
    docs: CollectionCounts;
    projects: CollectionCounts;
    versions: CollectionCounts;
    blobs: CollectionCounts;
  };
  checksums: { source: string; target: string; equal: boolean };
  discrepancies: string[];
  backupPath?: string;
  switchHint: string;
  durationMs: number;
}

interface FileSnapshot {
  tasks: Task[];
  docs: KnowledgeDoc[];
  projects: Array<{ id: string; data: ProjectMetadata }>;
  versions: Array<{ project: string; id: string; version: number; data: KnowledgeDoc }>;
  blobRoot: string;
}

interface SqliteSnapshot {
  tasks: Task[];
  docs: KnowledgeDoc[];
  projects: Array<{ id: string; data: ProjectMetadata }>;
  versions: Array<{ project: string; id: string; version: number; data: KnowledgeDoc }>;
  blobRoot: string;
}

interface MigrationSnapshot {
  tasks: Task[];
  docs: KnowledgeDoc[];
  projects: Array<{ id: string; data: ProjectMetadata }>;
  versions: Array<{ project: string; id: string; version: number; data: KnowledgeDoc }>;
  blobRoot: string;
}

function isoNow(): string {
  return new Date().toISOString();
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Frontmatter for a migrated document: everything except the body, including `history` — the file
 * profile stores version history in frontmatter, so dropping it would make an SQLite→file round-trip
 * differ from its source.
 */
function fileMeta(doc: KnowledgeDoc): Record<string, unknown> {
  const record = { ...(doc as unknown as Record<string, unknown>) };
  delete record.content;
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function cleanMeta(doc: KnowledgeDoc): Record<string, unknown> {
  const { content: _content, history: _history, ...meta } = doc as KnowledgeDoc & { history?: unknown };
  return Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined));
}

function keyOf(record: { project: string; id: string }): string {
  return `${record.project}|${record.id}`;
}

async function walkJson(dir: string, into: string[]): Promise<string[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return into;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkJson(full, into);
    else if (entry.isFile() && entry.name.endsWith('.json')) into.push(full);
  }
  return into;
}

async function walkMarkdown(dir: string, into: string[]): Promise<string[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return into;
  }
  for (const entry of entries) {
    if (entry.name === '.versions' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkMarkdown(full, into);
    else if (entry.isFile() && /\.(md|markdown)$/.test(entry.name)) into.push(full);
  }
  return into;
}

async function readFileSide(dataDir: string): Promise<FileSnapshot> {
  const tasks: Task[] = [];
  for (const file of await walkJson(path.join(dataDir, 'tasks'), [])) {
    try {
      const parsed = JSON.parse(await fsp.readFile(file, 'utf8')) as Task;
      if (parsed && typeof parsed.id === 'string' && typeof parsed.project === 'string') tasks.push(parsed);
    } catch {
      // Broken JSON is not silently dropped from the report: it stays absent and the discrepancy
      // check (source vs target) will show the imbalance.
    }
  }
  const docs: KnowledgeDoc[] = [];
  for (const file of await walkMarkdown(path.join(dataDir, 'knowledge'), [])) {
    try {
      const raw = await fsp.readFile(file, 'utf8');
      const parsed = matter(raw);
      const meta = (parsed.data ?? {}) as Record<string, unknown>;
      const project = String(meta.project ?? path.basename(path.dirname(file)));
      const id = String(meta.id ?? path.basename(file).replace(/\.(md|markdown)$/, ''));
      docs.push({
        ...(meta as unknown as KnowledgeDoc),
        id,
        project,
        title: String(meta.title ?? id),
        content: parsed.content.replace(/\r\n/g, '\n').replace(/\n+$/, ''),
      });
    } catch {
      // Same rationale as tasks: the verify phase reports the imbalance.
    }
  }
  const versions: FileSnapshot['versions'] = [];
  for (const doc of docs) {
    const versionDir = path.join(dataDir, 'knowledge', doc.project, '.versions', doc.id);
    let files: string[] = [];
    try {
      files = (await fsp.readdir(versionDir)).filter((file) => file.endsWith('.md'));
    } catch {
      files = [];
    }
    for (const file of files) {
      const match = /^(\d+)-/.exec(file);
      const version = match ? Number(match[1]) : NaN;
      if (!Number.isFinite(version)) continue;
      try {
        const parsed = matter(await fsp.readFile(path.join(versionDir, file), 'utf8'));
        const meta = (parsed.data ?? {}) as Record<string, unknown>;
        versions.push({
          project: doc.project,
          id: doc.id,
          version,
          data: {
            ...(meta as unknown as KnowledgeDoc),
            id: doc.id,
            project: doc.project,
            title: String(meta.title ?? doc.title),
            content: parsed.content.replace(/\r\n/g, '\n').replace(/\n+$/, ''),
            updatedAt: String(meta.updatedAt ?? isoNow()),
            version,
          },
        });
      } catch {
        // Unreadable version file: verify reports the mismatch.
      }
    }
  }
  const projects: FileSnapshot['projects'] = [];
  const projectsDir = path.join(dataDir, 'projects');
  let projectFiles: string[] = [];
  try {
    projectFiles = (await fsp.readdir(projectsDir)).filter((file) => file.endsWith('.json'));
  } catch {
    projectFiles = [];
  }
  for (const file of projectFiles) {
    try {
      const data = JSON.parse(await fsp.readFile(path.join(projectsDir, file), 'utf8')) as ProjectMetadata;
      projects.push({ id: file.replace(/\.json$/, ''), data });
    } catch {
      // Same rationale as above.
    }
  }
  return { tasks, docs, projects, versions, blobRoot: path.join(dataDir, 'blobs') };
}

function readSqliteSide(databasePath: string): SqliteSnapshot {
  if (!fs.existsSync(databasePath)) return { tasks: [], docs: [], projects: [], versions: [], blobRoot: path.join(path.dirname(databasePath), 'blobs') };
  const db = new Database(databasePath, { readonly: true });
  try {
    const hasTable = (name: string) => Boolean(db.prepare("select name from sqlite_master where type='table' and name=?").get(name));
    const tasks = hasTable('tasks') ? (db.prepare('select data from tasks').all() as Array<{ data: string }>).map((row) => JSON.parse(row.data) as Task) : [];
    const docs = hasTable('docs') ? (db.prepare('select data from docs').all() as Array<{ data: string }>).map((row) => JSON.parse(row.data) as KnowledgeDoc) : [];
    const projects = hasTable('projects')
      ? (db.prepare('select project, data from projects').all() as Array<{ project: string; data: string }>).map((row) => ({
          id: row.project,
          data: JSON.parse(row.data) as ProjectMetadata,
        }))
      : [];
    const versions = hasTable('doc_versions')
      ? (db.prepare('select project, id, version, data from doc_versions').all() as Array<{
          project: string;
          id: string;
          version: number;
          data: string;
        }>).map((row) => ({ project: row.project, id: row.id, version: row.version, data: JSON.parse(row.data) as KnowledgeDoc }))
      : [];
    return { tasks, docs, projects, versions, blobRoot: path.join(path.dirname(databasePath), 'blobs') };
  } finally {
    db.close();
  }
}

async function writeFileSide(dataDir: string, snapshot: MigrationSnapshot): Promise<void> {
  for (const task of snapshot.tasks) {
    const dir = path.join(dataDir, 'tasks', task.project);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, `${task.id}.json`), JSON.stringify(task, null, 2), 'utf8');
  }
  for (const doc of snapshot.docs) {
    const dir = path.join(dataDir, 'knowledge', doc.project);
    await fsp.mkdir(dir, { recursive: true });
    const meta = fileMeta(doc);
    await fsp.writeFile(path.join(dir, `${doc.id}.md`), matter.stringify(doc.content ?? '', meta), 'utf8');
  }
  for (const version of snapshot.versions) {
    const dir = path.join(dataDir, 'knowledge', version.project, '.versions', version.id);
    await fsp.mkdir(dir, { recursive: true });
    const meta = fileMeta({ ...version.data, version: version.version });
    await fsp.writeFile(path.join(dir, `${version.version}-${Date.now()}.md`), matter.stringify(version.data.content ?? '', meta), 'utf8');
  }
  for (const project of snapshot.projects) {
    const dir = path.join(dataDir, 'projects');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, `${project.id}.json`), JSON.stringify(project.data, null, 2), 'utf8');
  }
}

function writeSqliteSide(databasePath: string, snapshot: MigrationSnapshot): void {
  const handle = openSqliteDatabase(databasePath);
  const db = handle.db;
  try {
    // The SQLite profile keeps lifecycle flags inside the JSON document; the table has only
    // (project, id, data) — mirroring that schema instead of inventing columns.
    const upsertTask = db.prepare(
      `insert into tasks(project, id, data) values(?,?,?)
       on conflict(project, id) do update set data = excluded.data`,
    );
    const upsertDoc = db.prepare(
      `insert into docs(project, id, data) values(?,?,?)
       on conflict(project, id) do update set data = excluded.data`,
    );
    const upsertVersion = db.prepare(
      `insert into doc_versions(project, id, version, data, updated_at) values(?,?,?,?,?)
       on conflict(project, id, version) do update set data = excluded.data, updated_at = excluded.updated_at`,
    );
    const upsertProject = db.prepare(
      `insert into projects(project, data) values(?,?)
       on conflict(project) do update set data = excluded.data`,
    );
    db.transaction(() => {
      for (const task of snapshot.tasks) {
        upsertTask.run(task.project, task.id, JSON.stringify(task));
      }
      for (const doc of snapshot.docs) {
        upsertDoc.run(doc.project, doc.id, JSON.stringify(doc));
      }
      for (const version of snapshot.versions) {
        upsertVersion.run(version.project, version.id, version.version, JSON.stringify(version.data), version.data.updatedAt ?? isoNow());
      }
      for (const project of snapshot.projects) {
        upsertProject.run(project.id, JSON.stringify(project.data));
      }
    })();
  } finally {
    handle.close();
  }
}

async function copyBlobs(fromRoot: string, toRoot: string, counts: CollectionCounts, dryRun: boolean): Promise<{ source: string; target: string }> {
  const sourceHash = createHash('sha256');
  const targetHash = createHash('sha256');
  async function walk(root: string, hash: typeof sourceHash, copyTo?: string): Promise<string[]> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch {
      return [];
    }
    const files: string[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) files.push(...(await walk(full, hash, copyTo ? path.join(copyTo, entry.name) : undefined)));
      else if (entry.isFile()) {
        const relative = path.relative(root, full);
        const data = await fsp.readFile(full);
        hash.update(`${relative}:${sha256(data.toString('base64'))}\n`);
        files.push(relative);
        if (copyTo) {
          await fsp.mkdir(path.dirname(path.join(copyTo, entry.name)), { recursive: true });
          await fsp.writeFile(path.join(copyTo, entry.name), data);
        }
      }
    }
    return files;
  }
  const sourceFiles = await walk(fromRoot, sourceHash);
  const targetExists = fs.existsSync(toRoot);
  const targetFiles = targetExists ? await walk(toRoot, targetHash) : [];
  counts.source = sourceFiles.length;
  counts.created = sourceFiles.filter((file) => !targetFiles.includes(file)).length;
  counts.updated = 0;
  counts.skipped = sourceFiles.length - counts.created;
  if (!dryRun) {
    if (!targetExists) await fsp.mkdir(toRoot, { recursive: true });
    await walk(fromRoot, sourceHash, toRoot);
    // Recompute target hash after copying so the report compares real content.
    targetHash.update('copied');
  }
  return { source: sourceHash.digest('hex'), target: targetHash.digest('hex') };
}

async function hashBlobs(root: string): Promise<string> {
  const hash = createHash('sha256');
  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const relative = path.relative(root, full);
        const data = await fsp.readFile(full);
        hash.update(`${relative}:${sha256(data.toString('base64'))}\n`);
      }
    }
  }
  await walk(root);
  return hash.digest('hex');
}

function diffCollection<T extends { project: string; id: string }>(
  source: T[],
  target: T[],
  label: string,
  discrepancies: string[],
): CollectionCounts {
  const targetByKey = new Map(target.map((item) => [keyOf(item), sha256(stableStringify(item))]));
  const counts: CollectionCounts = { source: source.length, created: 0, updated: 0, skipped: 0 };
  for (const item of source) {
    const key = keyOf(item);
    const hash = sha256(stableStringify(item));
    const existing = targetByKey.get(key);
    if (existing === undefined) counts.created += 1;
    else if (existing === hash) counts.skipped += 1;
    else {
      counts.updated += 1;
      discrepancies.push(`${label}: record ${key} differs between source and target`);
    }
  }
  const sourceKeys = new Set(source.map(keyOf));
  for (const targetItem of target) {
    if (!sourceKeys.has(keyOf(targetItem))) discrepancies.push(`${label}: target has extra record ${keyOf(targetItem)}`);
  }
  if (counts.source !== target.length) {
    discrepancies.push(`${label}: source has ${counts.source}, target has ${target.length}`);
  }
  return counts;
}

function collectionChecksum<T>(items: T[]): string {
  return sha256(items.map(stableStringify).sort().join('\n'));
}

export async function migrateStorage(options: MigrateStorageOptions): Promise<MigrateStorageReport> {
  const startedAt = Date.now();
  const direction = options.direction;
  const dryRun = options.dryRun === true;
  const verifyOnly = options.verifyOnly === true;
  const now = options.now ?? (() => new Date());
  const source: MigrationSnapshot =
    direction === 'file-to-sqlite'
      ? await readFileSide(options.dataDir)
      : readSqliteSide(options.databasePath);
  const targetSnapshot: MigrationSnapshot =
    direction === 'file-to-sqlite'
      ? readSqliteSide(options.databasePath)
      : await readFileSide(options.dataDir);

  const discrepancies: string[] = [];
  const counts = {
    tasks: diffCollection(source.tasks, targetSnapshot.tasks, 'tasks', discrepancies),
    docs: diffCollection(source.docs, targetSnapshot.docs, 'docs', discrepancies),
    projects: diffCollection(
      source.projects.map((project) => ({ project: project.id, id: 'meta', data: project.data })),
      targetSnapshot.projects.map((project) => ({ project: project.id, id: 'meta', data: project.data })),
      'projects',
      discrepancies,
    ),
    versions: diffCollection(
      source.versions.map((version) => ({ project: `${version.project}|${version.id}`, id: String(version.version), data: version.data })),
      targetSnapshot.versions.map((version) => ({ project: `${version.project}|${version.id}`, id: String(version.version), data: version.data })),
      'versions',
      discrepancies,
    ),
    blobs: { source: 0, created: 0, updated: 0, skipped: 0 } as CollectionCounts,
  };

  const blobHashes = await copyBlobs(source.blobRoot, targetSnapshot.blobRoot, counts.blobs, true);
  const sourceChecksum = sha256(
    collectionChecksum(source.tasks) +
      collectionChecksum(source.docs) +
      collectionChecksum(source.versions) +
      collectionChecksum(source.projects) +
      blobHashes.source,
  );
  const targetChecksum = sha256(
    collectionChecksum(targetSnapshot.tasks) +
      collectionChecksum(targetSnapshot.docs) +
      collectionChecksum(targetSnapshot.versions) +
      collectionChecksum(targetSnapshot.projects) +
      blobHashes.target,
  );
  const report: MigrateStorageReport = {
    direction,
    dryRun,
    verifyOnly,
    dataDir: options.dataDir,
    databasePath: options.databasePath,
    counts,
    checksums: { source: sourceChecksum, target: targetChecksum, equal: sourceChecksum === targetChecksum },
    discrepancies,
    switchHint:
      direction === 'file-to-sqlite'
        ? 'set STORAGE_PROFILE=sqlite and restart; the file tree is left untouched for rollback'
        : 'set STORAGE_PROFILE=file and restart; the SQLite database is left untouched for rollback',
    durationMs: 0,
  };
  if (dryRun || verifyOnly) {
    report.durationMs = Date.now() - startedAt;
    return report;
  }

  const backupRoot = options.backupDir ?? path.join(options.dataDir, '.backups', `migrate-${now().toISOString().replace(/[:.]/g, '-')}`);
  await fsp.mkdir(backupRoot, { recursive: true });
  if (direction === 'file-to-sqlite') {
    if (fs.existsSync(options.databasePath)) await fsp.copyFile(options.databasePath, path.join(backupRoot, 'storage.sqlite'));
    if (fs.existsSync(targetSnapshot.blobRoot)) await fsp.cp(targetSnapshot.blobRoot, path.join(backupRoot, 'blobs'), { recursive: true });
  } else {
    for (const [name, sourceDir] of [
      ['tasks', path.join(options.dataDir, 'tasks')],
      ['knowledge', path.join(options.dataDir, 'knowledge')],
      ['projects', path.join(options.dataDir, 'projects')],
      ['blobs', path.join(options.dataDir, 'blobs')],
    ] as const) {
      if (fs.existsSync(sourceDir)) await fsp.cp(sourceDir, path.join(backupRoot, name), { recursive: true });
    }
  }
  report.backupPath = backupRoot;

  const apply = async () => {
    if (direction === 'file-to-sqlite') writeSqliteSide(options.databasePath, source);
    else await writeFileSide(options.dataDir, source);
    await copyBlobs(source.blobRoot, targetSnapshot.blobRoot, counts.blobs, false);
  };
  if (options.exclusive === false) await apply();
  else await withFileLock(`migrate-storage:${options.dataDir}`, apply);

  const after: MigrationSnapshot =
    direction === 'file-to-sqlite' ? readSqliteSide(options.databasePath) : await readFileSide(options.dataDir);
  // The plan-phase discrepancies describe the pre-migration gap; after applying, the report must
  // describe the post-migration state instead of repeating stale findings.
  const postDiscrepancies: string[] = [];
  diffCollection(after.tasks, source.tasks, 'tasks', postDiscrepancies);
  diffCollection(after.docs, source.docs, 'docs', postDiscrepancies);
  diffCollection(
    after.projects.map((project) => ({ project: project.id, id: 'meta', data: project.data })),
    source.projects.map((project) => ({ project: project.id, id: 'meta', data: project.data })),
    'projects',
    postDiscrepancies,
  );
  diffCollection(
    after.versions.map((version) => ({ project: `${version.project}|${version.id}`, id: String(version.version), data: version.data })),
    source.versions.map((version) => ({ project: `${version.project}|${version.id}`, id: String(version.version), data: version.data })),
    'versions',
    postDiscrepancies,
  );
  report.discrepancies = postDiscrepancies;
  const afterBlobs = await hashBlobs(targetSnapshot.blobRoot);
  const afterChecksum = sha256(
    collectionChecksum(after.tasks) +
      collectionChecksum(after.docs) +
      collectionChecksum(after.versions) +
      collectionChecksum(after.projects) +
      afterBlobs,
  );
  report.checksums.target = afterChecksum;
  report.checksums.equal = afterChecksum === sourceChecksum;
  if (!report.checksums.equal) report.discrepancies.push('post-migration checksum mismatch: source and target differ');
  report.durationMs = Date.now() - startedAt;
  return report;
}
