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

const VALID_STATUSES = new Set(['pending', 'in_progress', 'blocked', 'completed', 'closed']);
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

async function scanTaskFile(
  filePath: string,
  projectFromDir: string | undefined,
  paths: DoctorPaths,
  fix: boolean,
  issues: DoctorIssue[],
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

  // enum sanity
  if (typeof task.status === 'string' && task.status.length > 0 && !VALID_STATUSES.has(task.status)) {
    issues.push({ level: 'warn', check: 'invalid-status', file: relFile, detail: `status '${task.status}' not in ${[...VALID_STATUSES].join('|')}` });
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
  if (await pathExists(paths.tasksDir)) {
    for (const project of await listSubdirs(paths.tasksDir)) {
      const dir = path.join(paths.tasksDir, project);
      for (const f of await fg('*.json', { cwd: dir, dot: false })) {
        scanned.json++;
        await scanTaskFile(path.join(dir, f), project, paths, fix, issues);
      }
    }
    for (const f of await fg('*.json', { cwd: paths.tasksDir, dot: false, deep: 1 })) {
      scanned.json++;
      await scanTaskFile(path.join(paths.tasksDir, f), undefined, paths, fix, issues);
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

  return {
    dataDir: paths.dataDir,
    scanned,
    schema: { found: schemaFound, current: CURRENT_SCHEMA },
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
