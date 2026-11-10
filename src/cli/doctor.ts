/**
 * doctor --data — read-only integrity scan of DATA_DIR (DX-17).
 *
 * Scans every *.json / *.md under the tasks, knowledge and projects
 * directories and reports:
 *   - corrupt JSON files
 *   - tasks with missing required fields / id↔filename / project↔dir mismatch
 *   - knowledge docs with unparseable frontmatter, missing id/project,
 *     or files at KNOWLEDGE_DIR root with no project dir (orphans)
 *   - project metadata files that are corrupt, id-mismatched, or invalid
 *   - project dirs without metadata (and vice versa) — warnings
 *
 * `--fix` performs ONLY trivial, non-destructive repairs:
 *   - fill missing `id` / `project` in task JSON (derived from path)
 *   - fill missing `id` / `project` in knowledge frontmatter
 * Nothing is ever deleted, moved, or reformatted. Corrupt JSON is
 * reported but never auto-repaired.
 *
 * Exit codes: 0 = clean, 1 = issues found (or remain after --fix),
 *             2 = usage error / crash.
 */

import path from 'node:path';
import { promises as fsp } from 'node:fs';
import fg from 'fast-glob';
import matter from 'gray-matter';
import { pathExists, readText, writeJson, writeText } from '../fs.js';
import { PROJECT_ID_RE } from '../projects.js';
import { readSchemaManifest, CURRENT_SCHEMA } from '../services/schema-version.js';
import type { Task } from '../types.js';
import { inspectIndex, formatIndexSection, type IndexInspection } from './index-inspect.js';
import { inspectActiveStorageProfile, type StorageProfileSummary } from './storage-profile-inspect.js';
import {
  inspectSqliteStorage,
  type SqliteStorageReport,
} from '../storage/profiles/sqlite/diagnostics.js';

// ── Report model ────────────────────────────────────────────────────

export type IssueLevel = 'error' | 'warn' | 'fixed';

export interface DoctorIssue {
  level: IssueLevel;
  check: string;
  /** Path relative to DATA_DIR for readability. */
  file: string;
  detail: string;
}

export interface DoctorReport {
  dataDir: string;
  scanned: { json: number; md: number };
  /** DX-18: on-disk schema vs the version this build supports. */
  schema: { found: number | 'none'; current: number };
  /** SC-02d: state of the derived metadata index, when it was inspected. */
  index?: IndexInspection;
  /** Y-05c: SQLite-profile state, when `STORAGE_PROFILE=sqlite`. */
  sqlite?: SqliteStorageReport;
  /** Gate §5.6: active profile, its manifest and capabilities (honest, incl. errors). */
  storage?: StorageProfileSummary;
  issues: DoctorIssue[];
  errors: number;
  warnings: number;
  fixed: number;
}

export interface DoctorPaths {
  dataDir: string;
  tasksDir: string;
  knowledgeDir: string;
  /** DATA_DIR/projects — where <id>.json metadata files live. */
  projectsMetaDir: string;
}

export interface DoctorOptions {
  fix?: boolean;
}

const TASK_REQUIRED_FIELDS: ReadonlyArray<keyof Task> = [
  'id',
  'project',
  'title',
  'status',
  'priority',
  'createdAt',
  'updatedAt',
];

const DEFAULT_STATUSES = new Set(['pending', 'in_progress', 'blocked', 'completed', 'closed']);
const VALID_PRIORITIES = new Set(['low', 'medium', 'high']);

function rel(dataDir: string, p: string): string {
  return path.relative(dataDir, p) || p;
}

async function listSubdirs(dir: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

// ── Tasks scan ──────────────────────────────────────────────────────

async function projectStatusIds(paths: DoctorPaths, project: string | undefined): Promise<Set<string>> {
  if (!project) return DEFAULT_STATUSES;
  try {
    const raw = JSON.parse(await readText(path.join(paths.projectsMetaDir, `${project}.json`))) as { statuses?: unknown };
    if (Array.isArray(raw.statuses) && raw.statuses.length > 0) {
      const ids = raw.statuses
        .map((status) => (status && typeof status === 'object' ? (status as { id?: unknown }).id : undefined))
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      if (ids.length > 0) return new Set([...ids, 'blocked']);
    }
  } catch {
    // No metadata / unreadable metadata: default set.
  }
  return DEFAULT_STATUSES;
}

async function scanTaskFile(
  filePath: string,
  projectFromDir: string | undefined,
  paths: DoctorPaths,
  fix: boolean,
  issues: DoctorIssue[],
  statusCache: Map<string, Set<string>>,
): Promise<void> {
  const relFile = rel(paths.dataDir, filePath);
  const stem = path.basename(filePath, '.json');

  let raw: string;
  try {
    raw = await readText(filePath);
  } catch (e) {
    issues.push({ level: 'error', check: 'unreadable-file', file: relFile, detail: (e as Error).message });
    return;
  }

  let task: Partial<Task>;
  try {
    task = JSON.parse(raw) as Partial<Task>;
  } catch (e) {
    issues.push({ level: 'error', check: 'corrupt-json', file: relFile, detail: (e as Error).message });
    return;
  }
  if (task === null || typeof task !== 'object' || Array.isArray(task)) {
    issues.push({ level: 'error', check: 'corrupt-json', file: relFile, detail: 'top-level value is not an object' });
    return;
  }

  // Missing required fields — id/project are fixable (derivable from path).
  let mutated = false;
  for (const field of TASK_REQUIRED_FIELDS) {
    const v = task[field];
    const missing = v === undefined || v === null || (typeof v === 'string' && v.length === 0);
    if (!missing) continue;

    if (field === 'id' && fix) {
      task.id = stem;
      mutated = true;
      issues.push({ level: 'fixed', check: 'missing-field', file: relFile, detail: `id ← filename '${stem}'` });
    } else if (field === 'project' && fix && projectFromDir) {
      task.project = projectFromDir;
      mutated = true;
      issues.push({ level: 'fixed', check: 'missing-field', file: relFile, detail: `project ← dir '${projectFromDir}'` });
    } else {
      issues.push({ level: 'error', check: 'missing-field', file: relFile, detail: `required field '${field}' is missing or empty` });
    }
  }

  // id ↔ filename stem
  if (typeof task.id === 'string' && task.id.length > 0 && task.id !== stem) {
    issues.push({ level: 'error', check: 'id-mismatch', file: relFile, detail: `id '${task.id}' ≠ filename '${stem}'` });
  }

  // project ↔ directory (modern layout only — flat legacy files carry their own project)
  if (projectFromDir && typeof task.project === 'string' && task.project.length > 0 && task.project !== projectFromDir) {
    issues.push({ level: 'error', check: 'project-mismatch', file: relFile, detail: `project '${task.project}' ≠ dir '${projectFromDir}'` });
  }

  // project id validity (warn — legacy ids may predate PROJECT_ID_RE)
  if (typeof task.project === 'string' && task.project.length > 0 && !PROJECT_ID_RE.test(task.project)) {
    issues.push({ level: 'warn', check: 'invalid-project-id', file: relFile, detail: `project '${task.project}' does not match ${PROJECT_ID_RE.source}` });
  }

  // enum sanity against the project's own status set
  const project = task.project || projectFromDir;
  let allowedStatuses = project ? statusCache.get(project) : undefined;
  if (project && !allowedStatuses) {
    allowedStatuses = await projectStatusIds(paths, project);
    statusCache.set(project, allowedStatuses);
  }
  if (typeof task.status === 'string' && task.status.length > 0 && allowedStatuses && !allowedStatuses.has(task.status)) {
    issues.push({ level: 'warn', check: 'invalid-status', file: relFile, detail: `status '${task.status}' not in ${[...allowedStatuses].join('|')}` });
  }
  if (typeof task.priority === 'string' && task.priority.length > 0 && !VALID_PRIORITIES.has(task.priority)) {
    issues.push({ level: 'warn', check: 'invalid-priority', file: relFile, detail: `priority '${task.priority}' not in ${[...VALID_PRIORITIES].join('|')}` });
  }

  if (mutated) {
    await writeJson(filePath, task);
  }
}

// ── Knowledge scan ──────────────────────────────────────────────────

async function scanKnowledgeFile(
  filePath: string,
  projectFromDir: string | undefined,
  paths: DoctorPaths,
  fix: boolean,
  issues: DoctorIssue[],
): Promise<void> {
  const relFile = rel(paths.dataDir, filePath);
  const stem = path.basename(filePath).replace(/\.(md|markdown)$/i, '');

  let raw: string;
  try {
    raw = await readText(filePath);
  } catch (e) {
    issues.push({ level: 'error', check: 'unreadable-file', file: relFile, detail: (e as Error).message });
    return;
  }

  let fm: matter.GrayMatterFile<string>;
  try {
    fm = matter(raw);
  } catch (e) {
    issues.push({ level: 'error', check: 'bad-frontmatter', file: relFile, detail: (e as Error).message });
    return;
  }

  const meta = (fm.data ?? {}) as Record<string, unknown>;
  let mutated = false;

  // id — derivable from filename
  if (typeof meta.id !== 'string' || meta.id.length === 0) {
    if (fix) {
      meta.id = stem;
      mutated = true;
      issues.push({ level: 'fixed', check: 'missing-field', file: relFile, detail: `id ← filename '${stem}'` });
    } else {
      issues.push({ level: 'error', check: 'missing-field', file: relFile, detail: `frontmatter 'id' missing (derivable: '${stem}')` });
    }
  } else if (meta.id !== stem) {
    issues.push({ level: 'warn', check: 'id-mismatch', file: relFile, detail: `id '${meta.id}' ≠ filename '${stem}'` });
  }

  // project — derivable from dir; file at root = orphan
  if (typeof meta.project !== 'string' || meta.project.length === 0) {
    if (projectFromDir) {
      if (fix) {
        meta.project = projectFromDir;
        mutated = true;
        issues.push({ level: 'fixed', check: 'missing-field', file: relFile, detail: `project ← dir '${projectFromDir}'` });
      } else {
        issues.push({ level: 'error', check: 'missing-field', file: relFile, detail: `frontmatter 'project' missing (derivable: '${projectFromDir}')` });
      }
    } else {
      issues.push({ level: 'warn', check: 'knowledge-orphan', file: relFile, detail: 'doc at knowledge root — no project dir' });
    }
  } else if (projectFromDir && meta.project !== projectFromDir) {
    issues.push({ level: 'warn', check: 'project-mismatch', file: relFile, detail: `project '${meta.project}' ≠ dir '${projectFromDir}'` });
  }

  // title is required by KnowledgeDocMeta
  if (typeof meta.title !== 'string' || meta.title.length === 0) {
    issues.push({ level: 'warn', check: 'missing-field', file: relFile, detail: `frontmatter 'title' missing` });
  }

  if (mutated) {
    await writeText(filePath, matter.stringify(fm.content, meta));
  }
}

// ── Projects scan ───────────────────────────────────────────────────

async function scanProjects(paths: DoctorPaths, issues: DoctorIssue[]): Promise<void> {
  const metaIds = new Set<string>();

  if (await pathExists(paths.projectsMetaDir)) {
    const files = await fg('*.json', { cwd: paths.projectsMetaDir, dot: false });
    for (const f of files) {
      const filePath = path.join(paths.projectsMetaDir, f);
      const relFile = rel(paths.dataDir, filePath);
      const stem = path.basename(f, '.json');
      metaIds.add(stem);

      let parsed: unknown;
      try {
        parsed = JSON.parse(await readText(filePath));
      } catch (e) {
        issues.push({ level: 'error', check: 'corrupt-json', file: relFile, detail: (e as Error).message });
        continue;
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        issues.push({ level: 'error', check: 'corrupt-json', file: relFile, detail: 'top-level value is not an object' });
        continue;
      }
      const meta = parsed as Record<string, unknown>;
      if (typeof meta.id === 'string' && meta.id.length > 0 && meta.id !== stem) {
        issues.push({ level: 'error', check: 'id-mismatch', file: relFile, detail: `id '${meta.id}' ≠ filename '${stem}'` });
      }
      if (!PROJECT_ID_RE.test(stem)) {
        issues.push({ level: 'warn', check: 'invalid-project-id', file: relFile, detail: `project id '${stem}' does not match ${PROJECT_ID_RE.source}` });
      }
    }
  }

  // Cross-check: dirs without metadata, metadata without dirs.
  const taskDirs = new Set(await listSubdirs(paths.tasksDir));
  const knowledgeDirs = new Set(await listSubdirs(paths.knowledgeDir));
  const dirIds = new Set([...taskDirs, ...knowledgeDirs]);

  for (const id of dirIds) {
    if (!metaIds.has(id)) {
      issues.push({ level: 'warn', check: 'project-no-metadata', file: id, detail: 'project dir exists but projects/<id>.json missing' });
    }
  }
  for (const id of metaIds) {
    if (!dirIds.has(id)) {
      issues.push({ level: 'warn', check: 'project-no-data', file: `projects/${id}.json`, detail: 'metadata exists but no tasks/knowledge dirs' });
    }
  }
}

// ── Index section (SC-02d) ─────────────────────────────────────────

/**
 * SC-02d: the derived metadata index. `doctor` never writes to it — `--fix` repairs data,
 * the index is repaired by `reindex` — so every finding here is a warning, not an error:
 * the files remain the source of truth and a stale index only costs speed.
 */
async function inspectIndexForReport(paths: DoctorPaths, issues: DoctorIssue[]): Promise<IndexInspection> {
  const indexPath = path.join(paths.dataDir, '.index');
  const built = await pathExists(indexPath);
  const index = await inspectIndex(paths, { walk: built });
  if (!index.available) {
    // A never-built index is a normal state (fresh DATA_DIR, or STORAGE_INDEX=off): only an
    // existing but unreadable file is worth a warning.
    if (await pathExists(index.path)) {
      issues.push({
        level: 'warn',
        check: 'index-unavailable',
        file: rel(paths.dataDir, index.path),
        detail: index.reason ?? 'unknown reason',
      });
    }
    return index;
  }

  const file = rel(paths.dataDir, index.path);
  const example = (samples: Array<{ relPath: string }>) =>
    samples.length > 0 ? `, e.g. ${samples.slice(0, 2).map((sample) => sample.relPath).join(', ')}` : '';

  if (index.dirty) {
    issues.push({
      level: 'warn',
      check: 'index-dirty',
      file,
      detail: 'a write to the index failed; `reindex --data` clears the flag',
    });
  }
  if (index.schemaVersion !== String(index.supportedSchemaVersion)) {
    issues.push({
      level: 'warn',
      check: 'index-schema',
      file,
      detail: `schema ${index.schemaVersion ?? 'none'} != supported ${index.supportedSchemaVersion}; rebuild on next boot`,
    });
  }
  if (!index.dataDirMatch) {
    issues.push({
      level: 'warn',
      check: 'index-foreign',
      file,
      detail: `data_dir is ${index.dataDir ?? 'unset'}, not ${paths.dataDir}; index rebuilds on next boot`,
    });
  }
  if (index.counts.orphans > 0) {
    issues.push({
      level: 'warn',
      check: 'index-orphan',
      file,
      detail: `${index.counts.orphans} index rows without a file${example(index.orphans)}`,
    });
  }
  if (index.counts.missing > 0) {
    issues.push({
      level: 'warn',
      check: 'index-missing-file',
      file,
      detail: `${index.counts.missing} files without an index row${example(index.missing)}`,
    });
  }
  if (index.counts.drift > 0) {
    issues.push({
      level: 'warn',
      check: 'index-mtime-drift',
      file,
      detail: `${index.counts.drift} files edited out of band${example(index.drift)}`,
    });
  }
  if (index.counts.countDrift > 0) {
    issues.push({
      level: 'warn',
      check: 'index-count-drift',
      file,
      detail: `${index.counts.countDrift} projects with a wrong file_count`,
    });
  }
  const incomplete = index.projects.filter((project) => !project.complete);
  if (incomplete.length > 0) {
    issues.push({
      level: 'warn',
      check: 'index-incomplete',
      file,
      detail: `projects served from files until filled: ${incomplete.map((project) => project.project).join(', ')}`,
    });
  }

  const fts = index.fts;
  if (!fts.available) {
    issues.push({
      level: 'warn',
      check: 'fts-unavailable',
      file,
      detail: `${fts.reason ?? 'unknown reason'}; \`reindex --data\` builds it`,
    });
  } else {
    if (fts.dirty) {
      issues.push({
        level: 'warn',
        check: 'fts-dirty',
        file,
        detail: `a write to the search index failed${fts.dirtyReason ? ` (${fts.dirtyReason})` : ''}; \`reindex --data\` clears the flag`,
      });
    }
    if (fts.counts.missingRows > 0 || fts.counts.extraRows > 0) {
      issues.push({
        level: 'warn',
        check: 'fts-drift',
        file,
        detail: `${fts.counts.missingRows} searchable rows missing, ${fts.counts.extraRows} extra`,
      });
    }
    if (fts.counts.staleTerms > 0) {
      issues.push({
        level: 'warn',
        check: 'fts-stale-terms',
        file,
        detail: `${fts.counts.staleTerms} rows whose terms no longer match the file${example(fts.samples)}`,
      });
    }
  }
  return index;
}

// ── Top-level scan ──────────────────────────────────────────────────

/**
 * Scan DATA_DIR for integrity problems. Pure read-only unless `fix` is set,
 * in which case only derivable id/project fields are filled in.
 */
export async function scanDataDir(paths: DoctorPaths, opts: DoctorOptions = {}): Promise<DoctorReport> {
  const fix = opts.fix === true;
  const issues: DoctorIssue[] = [];
  const scanned = { json: 0, md: 0 };

  // Tasks: modern per-project dirs + legacy flat files at root.
  const statusCache = new Map<string, Set<string>>();
  if (await pathExists(paths.tasksDir)) {
    for (const project of await listSubdirs(paths.tasksDir)) {
      const dir = path.join(paths.tasksDir, project);
      for (const f of await fg('*.json', { cwd: dir, dot: false })) {
        scanned.json++;
        await scanTaskFile(path.join(dir, f), project, paths, fix, issues, statusCache);
      }
    }
    for (const f of await fg('*.json', { cwd: paths.tasksDir, dot: false, deep: 1 })) {
      scanned.json++;
      await scanTaskFile(path.join(paths.tasksDir, f), undefined, paths, fix, issues, statusCache);
    }
  }

  // Knowledge: modern per-project dirs + legacy flat files at root.
  if (await pathExists(paths.knowledgeDir)) {
    for (const project of await listSubdirs(paths.knowledgeDir)) {
      const dir = path.join(paths.knowledgeDir, project);
      for (const f of await fg('*.{md,markdown}', { cwd: dir, dot: false })) {
        scanned.md++;
        await scanKnowledgeFile(path.join(dir, f), project, paths, fix, issues);
      }
    }
    for (const f of await fg('*.{md,markdown}', { cwd: paths.knowledgeDir, dot: false, deep: 1 })) {
      scanned.md++;
      await scanKnowledgeFile(path.join(paths.knowledgeDir, f), undefined, paths, fix, issues);
    }
  }

  await scanProjects(paths, issues);

  // SC-02d: derived index state (read-only; repaired by `reindex`, never by `--fix`).
  const index = await inspectIndexForReport(paths, issues);

  // Y-05c: when the SQLite profile is active its state lives in one database file, not in the
  // file-derived metadata index — inspect it separately and surface its warnings as doctor issues.
  let sqlite: SqliteStorageReport | undefined;
  if ((process.env.STORAGE_PROFILE ?? 'file').trim().toLowerCase() === 'sqlite') {
    const databasePath = path.join(paths.dataDir, '.index', 'storage.sqlite');
    try {
      sqlite = inspectSqliteStorage(databasePath);
      for (const warning of sqlite.warnings) {
        issues.push({
          level: 'warn',
          check: warning.split(':')[0],
          file: '.index/storage.sqlite',
          detail: warning,
        });
      }
    } catch (error) {
      issues.push({
        level: 'error',
        check: 'sqlite-profile',
        file: '.index/storage.sqlite',
        detail: (error as Error).message,
      });
    }
  }

  // DX-18: schema-version drift. Missing manifest is reported in the
  // `schema.found` field only — not an issue, since pre-DX-18 installs
  // legitimately have none. Only an actual version mismatch is flagged.
  const manifest = await readSchemaManifest(paths.dataDir);
  const schemaFound = manifest?.schema ?? 'none';
  if (manifest !== undefined) {
    if (manifest.schema > CURRENT_SCHEMA) {
      issues.push({ level: 'error', check: 'schema-version', file: '.schema-version', detail: `schema ${manifest.schema} > supported ${CURRENT_SCHEMA} — data written by newer package` });
    } else if (manifest.schema < CURRENT_SCHEMA) {
      issues.push({ level: 'warn', check: 'schema-version', file: '.schema-version', detail: `schema ${manifest.schema} < ${CURRENT_SCHEMA} — migration pending on next boot` });
    }
  }

  let storage: StorageProfileSummary | undefined;
  try {
    storage = await inspectActiveStorageProfile(paths.dataDir);
    if (storage.error) {
      issues.push({ level: 'warn', check: 'storage-profile', file: 'STORAGE_PROFILE', detail: storage.error });
    }
  } catch (error) {
    issues.push({ level: 'warn', check: 'storage-profile', file: 'STORAGE_PROFILE', detail: (error as Error).message });
  }

  return {
    dataDir: paths.dataDir,
    scanned,
    schema: { found: schemaFound, current: CURRENT_SCHEMA },
    index,
    sqlite,
    storage,
    issues,
    errors: issues.filter((i) => i.level === 'error').length,
    warnings: issues.filter((i) => i.level === 'warn').length,
    fixed: issues.filter((i) => i.level === 'fixed').length,
  };
}

// ── Formatting ──────────────────────────────────────────────────────

export function formatReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push(`DATA_DIR: ${report.dataDir}`);
  lines.push(`Scanned: ${report.scanned.json} json, ${report.scanned.md} md`);
  lines.push(`Schema: ${report.schema.found} (supported: ${report.schema.current})`);
  if (report.index) lines.push(...formatIndexSection(report.index));
  if (report.storage) {
    const s = report.storage;
    lines.push(`Storage profile: ${s.profile}${s.error ? ` (${s.error})` : ''}`);
    if (!s.error) {
      lines.push(`Storage collections: ${s.collections.join(', ')}`);
      lines.push(`Storage capabilities: ${Object.entries(s.capabilities).map(([key, value]) => `${key}=${value}`).join(' ')}`);
      lines.push(`Storage roots: tasks=${s.roots.tasks ?? '-'} knowledge=${s.roots.knowledge ?? '-'}`);
    }
  }
  if (report.sqlite) {
    const s = report.sqlite;
    lines.push(
      `SQLite profile: ${s.databasePath}${s.exists ? '' : ' (missing)'} — ` +
        `tasks=${s.counts.tasks} docs=${s.counts.docs} projects=${s.counts.projects} ` +
        `vectors=${s.counts.vectorRows} fts=${s.counts.ftsRows}`,
    );
    lines.push(
      `SQLite runtime: node=${s.node} sqlite=${s.sqlite} fts5=${s.fts5 ? 'yes' : 'no'} ` +
        `sqlite-vec=${s.vec.available ? s.vec.version ?? 'yes' : 'unavailable (brute-force fallback)'} ` +
        `schema=${s.schemaVersion ?? 'unknown'}`,
    );
  }

  const groups = new Map<string, DoctorIssue[]>();
  for (const issue of report.issues) {
    const key = `${issue.level}:${issue.check}`;
    const list = groups.get(key) ?? [];
    list.push(issue);
    groups.set(key, list);
  }

  const levelOrder: Record<IssueLevel, number> = { error: 0, warn: 1, fixed: 2 };
  const tag: Record<IssueLevel, string> = { error: 'ERROR', warn: 'WARN', fixed: 'FIXED' };
  const sorted = [...groups.entries()].sort(
    ([a], [b]) => levelOrder[a.split(':')[0] as IssueLevel] - levelOrder[b.split(':')[0] as IssueLevel] || a.localeCompare(b),
  );

  for (const [key, list] of sorted) {
    const [level, check] = key.split(':') as [IssueLevel, string];
    const files = list.map((i) => (i.detail ? `${i.file} (${i.detail})` : i.file)).join(', ');
    lines.push(`[${tag[level]}] ${check}: ${list.length} — ${files}`);
  }

  lines.push(
    `doctor --data: ${report.errors} errors, ${report.warnings} warnings, ${report.fixed} fixed — exit ${report.errors > 0 ? 1 : 0}`,
  );
  return lines.join('\n');
}

// ── CLI entry ───────────────────────────────────────────────────────

const USAGE = `Usage: mcp-task-knowledge doctor --data [--fix] [--json]

  --data   Scan DATA_DIR for integrity problems (required)
  --fix    Fill trivially derivable fields (task/knowledge id, project)
  --json   Machine-readable JSON report instead of text

Exit codes: 0 clean, 1 issues found, 2 usage error / crash.`;

export interface DoctorCliResult {
  exitCode: number;
  report?: DoctorReport;
  text: string;
}

/**
 * Parse `doctor` argv (args AFTER the 'doctor' word) and run the scan.
 * Returns a result object — the caller decides how to print/exit so this
 * stays unit-testable.
 */
export async function runDoctorCli(
  args: string[],
  paths: DoctorPaths,
): Promise<DoctorCliResult> {
  const hasData = args.includes('--data');
  const fix = args.includes('--fix');
  const json = args.includes('--json');
  const help = args.includes('--help') || args.includes('-h');

  if (help || args.length === 0) {
    return { exitCode: 0, text: USAGE };
  }
  if (!hasData) {
    return { exitCode: 2, text: `doctor: missing required --data flag\n\n${USAGE}` };
  }
  const unknown = args.filter((a) => !['--data', '--fix', '--json'].includes(a));
  if (unknown.length > 0) {
    return { exitCode: 2, text: `doctor: unknown flag(s): ${unknown.join(' ')}\n\n${USAGE}` };
  }

  try {
    const report = await scanDataDir(paths, { fix });
    const text = json ? JSON.stringify(report, null, 2) : formatReport(report);
    return { exitCode: report.errors > 0 ? 1 : 0, report, text };
  } catch (e) {
    return { exitCode: 2, text: `doctor: scan crashed: ${(e as Error).message}` };
  }
}
