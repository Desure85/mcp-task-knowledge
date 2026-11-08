/**
 * SC-02d — read-only inspection of the derived metadata index (`DATA_DIR/.index/metadata.db`).
 *
 * The index is a cache, so the only interesting question is "does it still match the files?".
 * This module answers it without writing anything: rows come from the database, the file side is
 * a `readdir` + `stat` walk (no JSON/frontmatter parsing), and both sides are matched by the
 * stored `rel_path`.
 *
 * Four findings, as decided in `docs/dev-cycle/decisions/2026-11-07-1437-sc02-sqlite-index.md`:
 *
 *   - `orphan`  — an index row whose file is gone (repairable: `reindex`);
 *   - `missing` — a file that has no index row (the file was added out of band);
 *   - `drift`   — the same file with a different `mtime_ms` (edited out of band);
 *   - `count`   — `projects.file_count` disagrees with the rows actually present.
 *
 * Nothing here is fatal: the index is derived, the files stay the source of truth, so
 * `doctor` reports these as warnings and `reindex` fixes them.
 *
 * Sizes are not compared: the schema stores `mtime_ms` but not `size`, and the completeness
 * invariant never needed it. Adding a `size` column would bump `METADATA_INDEX_SCHEMA_VERSION`
 * and force a rebuild for a signal `mtime` already carries; see the decision record.
 */

import path from 'node:path';
import { promises as fsp } from 'node:fs';
import type BetterSqlite3 from 'better-sqlite3';
import {
  METADATA_INDEX_DIR,
  METADATA_INDEX_FILE,
  METADATA_INDEX_SCHEMA_VERSION,
} from '../storage/metadata-index.js';

type SqliteDatabase = BetterSqlite3.Database;

export interface IndexInspectPaths {
  dataDir: string;
  tasksDir: string;
  knowledgeDir: string;
}

export interface IndexInspectOptions {
  /** How many entries of each finding to keep in the report. Defaults to 20. */
  samples?: number;
  /**
   * Walk the file side (`readdir` + `stat`). Defaults to `true`; `doctor` turns it off when
   * `.index/` does not exist yet, because then there is nothing to compare and the walk would
   * make a doctor run on a large corpus pay for a second full pass.
   */
  walk?: boolean;
}

export type IndexFindingKind = 'task' | 'doc';

export interface IndexSample {
  kind: IndexFindingKind;
  /** Row id when the finding comes from the index, file name when it comes from disk. */
  id: string;
  /** Path relative to `DATA_DIR`, always with `/` separators. */
  relPath: string;
  project: string | null;
  detail?: string;
}

export interface IndexProjectState {
  project: string;
  /** Rows of this project present in the index. */
  rows: number;
  /** `projects.file_count` from the last fill/rebuild, `null` when the project is untracked. */
  fileCount: number | null;
  syncedAt: string | null;
  /** Same invariant `isProjectComplete` uses: tracked, counts equal, index not dirty. */
  complete: boolean;
}

export interface IndexInspection {
  available: boolean;
  /** Why the index is unavailable (`STORAGE_INDEX=off`, missing file, corrupt database). */
  reason?: string;
  path: string;
  schemaVersion: string | null;
  supportedSchemaVersion: number;
  dataDir: string | null;
  dataDirMatch: boolean;
  dirty: boolean | null;
  builtAt: string | null;
  rows: { tasks: number; docs: number };
  files: { tasks: number; docs: number };
  projects: IndexProjectState[];
  orphans: IndexSample[];
  missing: IndexSample[];
  drift: IndexSample[];
  counts: { orphans: number; missing: number; drift: number; countDrift: number };
  /** Total indexed rows that no file backs, across all projects. */
  totals: { rows: number; files: number };
}

interface IndexRow {
  id: string;
  project: string;
  relPath: string;
  mtimeMs: number;
  kind: IndexFindingKind;
}

interface FileEntry {
  mtimeMs: number;
  kind: IndexFindingKind;
  project: string;
}

/** Windows and POSIX paths must compare equal: the index stores native separators. */
function normalizeRel(relPath: string): string {
  return relPath.split(path.sep).join('/');
}

function isDotName(name: string): boolean {
  return name.startsWith('.');
}

async function listEntries(dir: string): Promise<Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>> {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Mirror of the rebuild scanners (`scanTaskRows`/`scanDocRows`): for each root, one level of
 * project directories plus the legacy flat layout, dot-directories skipped, only the given
 * extensions. Duplicating the walk instead of reusing the scanners is deliberate — the scanners
 * parse every file, and `doctor` on 100k documents must not pay for parsing twice.
 */
async function walkFiles(
  root: string,
  extensions: readonly string[],
  kind: IndexFindingKind,
  dataDir: string,
): Promise<Map<string, FileEntry>> {
  const files = new Map<string, FileEntry>();
  const matches = (name: string) => extensions.some((ext) => name.endsWith(ext));

  const addFile = async (file: string, project: string) => {
    try {
      const st = await fsp.stat(file);
      files.set(normalizeRel(path.relative(dataDir, file)), { mtimeMs: st.mtimeMs, kind, project });
    } catch {
      // A file that vanished between readdir and stat is simply not there.
    }
  };

  for (const entry of await listEntries(root)) {
    if (entry.isDirectory()) {
      if (isDotName(entry.name)) continue;
      const dir = path.join(root, entry.name);
      for (const child of await listEntries(dir)) {
        if (!child.isFile() || !matches(child.name)) continue;
        await addFile(path.join(dir, child.name), entry.name);
      }
    } else if (entry.isFile() && matches(entry.name)) {
      // Legacy flat layout: the project comes from the file itself, which the index row carries.
      await addFile(path.join(root, entry.name), '');
    }
  }
  return files;
}

async function openReadOnly(dbPath: string): Promise<SqliteDatabase> {
  // Dynamic import: `better-sqlite3` is a native module, so a container built with
  // `--ignore-scripts` must be able to run `doctor` without the binding.
  const { default: Database } = await import('better-sqlite3');
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function readMeta(db: SqliteDatabase): Map<string, string> {
  const rows = db.prepare<[], { key: string; value: string }>('SELECT key, value FROM meta').all();
  return new Map(rows.map((row) => [row.key, row.value]));
}

function readRows(db: SqliteDatabase, table: 'tasks' | 'docs'): IndexRow[] {
  const rows = db
    .prepare<[], { id: string; project: string; rel_path: string; mtime_ms: number }>(
      `SELECT id, project, rel_path, mtime_ms FROM ${table}`,
    )
    .all();
  return rows.map((row) => ({
    id: row.id,
    project: row.project,
    relPath: normalizeRel(row.rel_path),
    mtimeMs: row.mtime_ms,
    kind: table === 'tasks' ? 'task' : 'doc',
  }));
}

interface ProjectsRow {
  project: string;
  file_count: number;
  synced_at: string | null;
}

function readProjects(db: SqliteDatabase): ProjectsRow[] {
  return db
    .prepare<[], ProjectsRow>('SELECT project, file_count, synced_at FROM projects')
    .all();
}

/**
 * Inspect the index against the files. Never throws for a missing or broken index: an
 * unavailable index is a finding, not a crash (`STORAGE_INDEX=off` is a supported mode).
 */
export async function inspectIndex(
  paths: IndexInspectPaths,
  options: IndexInspectOptions = {},
): Promise<IndexInspection> {
  const samples = Math.max(1, Math.trunc(options.samples ?? 20));
  const walk = options.walk !== false;
  const dbPath = path.join(paths.dataDir, METADATA_INDEX_DIR, METADATA_INDEX_FILE);
  const empty = (
    reason: string,
    extra: Partial<IndexInspection> = {},
  ): IndexInspection => ({
    available: false,
    reason,
    path: dbPath,
    schemaVersion: null,
    supportedSchemaVersion: METADATA_INDEX_SCHEMA_VERSION,
    dataDir: null,
    dataDirMatch: false,
    dirty: null,
    builtAt: null,
    rows: { tasks: 0, docs: 0 },
    files: { tasks: 0, docs: 0 },
    projects: [],
    orphans: [],
    missing: [],
    drift: [],
    counts: { orphans: 0, missing: 0, drift: 0, countDrift: 0 },
    totals: { rows: 0, files: 0 },
    ...extra,
  });

  const [taskFiles, docFiles] = walk
    ? await Promise.all([
        walkFiles(paths.tasksDir, ['.json'], 'task', paths.dataDir),
        walkFiles(paths.knowledgeDir, ['.md', '.markdown'], 'doc', paths.dataDir),
      ])
    : [new Map<string, FileEntry>(), new Map<string, FileEntry>()];
  const files = new Map<string, FileEntry>([...taskFiles, ...docFiles]);

  let db: SqliteDatabase;
  try {
    db = await openReadOnly(dbPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const reason = code === 'SQLITE_CANTOPEN' || code === 'ENOENT'
      ? 'index file is missing (reindex creates it)'
      : `index cannot be opened: ${(err as Error).message}`;
    return empty(reason, {
      files: { tasks: taskFiles.size, docs: docFiles.size },
      totals: { rows: 0, files: files.size },
    });
  }

  try {
    const meta = readMeta(db);
    const schemaVersion = meta.get('schema_version') ?? null;
    const dataDir = meta.get('data_dir') ?? null;
    const dirty = meta.get('dirty') === '1';
    const taskRows = readRows(db, 'tasks');
    const docRows = readRows(db, 'docs');
    const projectRows = readProjects(db);

    const rowsByRel = new Map<string, IndexRow>();
    for (const row of taskRows) rowsByRel.set(row.relPath, row);
    for (const row of docRows) rowsByRel.set(row.relPath, row);

    const orphans: IndexSample[] = [];
    const drift: IndexSample[] = [];
    const orphanCounts = { tasks: 0, docs: 0 };
    const driftCounts = { tasks: 0, docs: 0 };
    for (const [relPath, row] of rowsByRel) {
      const file = files.get(relPath);
      if (!file) {
        if (row.kind === 'task') orphanCounts.tasks++;
        else orphanCounts.docs++;
        if (orphans.length < samples) {
          orphans.push({ kind: row.kind, id: row.id, relPath, project: row.project });
        }
        continue;
      }
      if (Math.abs(file.mtimeMs - row.mtimeMs) > 1) {
        if (row.kind === 'task') driftCounts.tasks++;
        else driftCounts.docs++;
        if (drift.length < samples) {
          drift.push({
            kind: row.kind,
            id: row.id,
            relPath,
            project: row.project,
            detail: `mtime ${row.mtimeMs} -> ${file.mtimeMs}`,
          });
        }
      }
    }

    const missing: IndexSample[] = [];
    let missingTasks = 0;
    let missingDocs = 0;
    for (const [relPath, file] of files) {
      if (rowsByRel.has(relPath)) continue;
      if (file.kind === 'task') missingTasks++;
      else missingDocs++;
      if (missing.length < samples) {
        missing.push({
          kind: file.kind,
          id: path.basename(relPath, path.extname(relPath)),
          relPath,
          project: file.project || null,
        });
      }
    }

    const rowsByProject = new Map<string, number>();
    for (const row of taskRows) rowsByProject.set(row.project, (rowsByProject.get(row.project) ?? 0) + 1);
    for (const row of docRows) rowsByProject.set(row.project, (rowsByProject.get(row.project) ?? 0) + 1);

    const tracked = new Map(projectRows.map((row) => [row.project, row]));
    const projectStates: IndexProjectState[] = [];
    for (const project of new Set([...rowsByProject.keys(), ...tracked.keys()])) {
      const row = tracked.get(project);
      const rows = rowsByProject.get(project) ?? 0;
      projectStates.push({
        project,
        rows,
        fileCount: row ? row.file_count : null,
        syncedAt: row ? row.synced_at : null,
        complete: Boolean(row?.synced_at) && !dirty && rows === (row?.file_count ?? -1),
      });
    }
    projectStates.sort((a, b) => a.project.localeCompare(b.project));
    const countDrift = projectStates.filter(
      (state) => state.fileCount !== null && state.fileCount !== state.rows,
    ).length;

    return {
      available: true,
      path: dbPath,
      schemaVersion,
      supportedSchemaVersion: METADATA_INDEX_SCHEMA_VERSION,
      dataDir,
      dataDirMatch: dataDir === path.resolve(paths.dataDir),
      dirty,
      builtAt: meta.get('built_at') ?? null,
      rows: { tasks: taskRows.length, docs: docRows.length },
      files: { tasks: taskFiles.size, docs: docFiles.size },
      projects: projectStates,
      orphans,
      missing,
      drift,
      counts: {
        orphans: orphanCounts.tasks + orphanCounts.docs,
        missing: missingTasks + missingDocs,
        drift: driftCounts.tasks + driftCounts.docs,
        countDrift,
      },
      totals: { rows: taskRows.length + docRows.length, files: files.size },
    };
  } catch (err) {
    return empty(`index cannot be read: ${(err as Error).message}`, {
      files: { tasks: taskFiles.size, docs: docFiles.size },
      totals: { rows: 0, files: files.size },
    });
  } finally {
    try {
      db.close();
    } catch {
      // Closing a read-only handle cannot fail in a way worth reporting.
    }
  }
}

/** One-line-per-fact index section for the `doctor` text report. */
export function formatIndexSection(inspection: IndexInspection): string[] {
  const lines: string[] = [];
  if (!inspection.available) {
    lines.push(`Index: unavailable — ${inspection.reason ?? 'unknown reason'}`);
    return lines;
  }
  lines.push(
    `Index: ${inspection.rows.tasks} tasks + ${inspection.rows.docs} docs in ` +
      `${inspection.totals.files} files, schema ${inspection.schemaVersion} ` +
      `(supported ${inspection.supportedSchemaVersion}), dirty ${inspection.dirty ? 'yes' : 'no'}` +
      `${inspection.dataDirMatch ? '' : ' — data_dir mismatch'}`,
  );
  for (const project of inspection.projects) {
    lines.push(
      `  ${project.project}: rows ${project.rows}, file_count ${project.fileCount ?? 'untracked'}, ` +
        `${project.complete ? 'complete' : 'incomplete'}`,
    );
  }
  lines.push(
    `  drift: ${inspection.counts.orphans} orphans, ${inspection.counts.missing} missing files, ` +
      `${inspection.counts.drift} mtime, ${inspection.counts.countDrift} count`,
  );
  const render = (label: string, list: IndexSample[]) => {
    if (list.length === 0) return;
    const shown = list
      .slice(0, 3)
      .map((sample) => `${sample.relPath}${sample.detail ? ` (${sample.detail})` : ''}`)
      .join(', ');
    lines.push(`  ${label}: ${shown}${list.length > 3 ? ', …' : ''}`);
  };
  render('orphans', inspection.orphans);
  render('missing', inspection.missing);
  render('mtime drift', inspection.drift);
  return lines;
}
