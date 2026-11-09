/**
 * reindex — rebuild the derived metadata index (`DATA_DIR/.index/metadata.db`) from files.
 *
 * SC-02d. The index is a cache, never a source of truth: this command throws it away and
 * rebuilds it from `tasks/` and `knowledge/`, so it is the repair step for everything
 * `doctor` reports about the index (orphans, missing files, `mtime` drift, a dirty flag,
 * a schema-version change, or a lost `.index/` directory).
 *
 * Usage:
 *   node dist/index.js reindex --data [--project <p>] [--verify] [--force] [--json]
 *
 * Modes:
 *   (default)   rebuild every project from files, then mark the projects complete;
 *   --project p rebuild only p (its rows are replaced, other projects are untouched);
 *   --verify    compare index with files and report; never writes;
 *   --force     rebuild even when every project is already complete.
 *
 * Concurrency: a rebuild writes the index, so the command takes the same `DATA_DIR`
 * server lock the server does (MU-01) and refuses to run against a live server instead of
 * racing it. `--verify` is read-only and takes no lock.
 *
 * Exit codes: 0 ok (or nothing to do), 1 drift found by `--verify`, 2 usage error / crash /
 * DATA_DIR owned by a running server.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  createMetadataIndex,
  METADATA_INDEX_DIR,
  METADATA_INDEX_FILE,
  resolveProjectIndexDirs,
  type MetadataIndex,
  type StorageIndexMode,
} from '../storage/metadata-index.js';
import { acquireServerLock, ServerLockError, type ServerLockHandle } from '../storage-lock.js';
import { inspectIndex, formatIndexSection, type IndexInspection } from './index-inspect.js';
import { FtsSearchIndex } from '../search/fts-index.js';
import { rebuildFtsIndex, type FtsRebuildResult } from '../search/fts-indexer.js';
import { checkSchemaVersion } from '../services/schema-version.js';
import {
  inspectSqliteStorage,
  rebuildSqliteStorageIndexes,
  type SqliteReindexReport,
} from '../storage/profiles/sqlite/diagnostics.js';

export interface ReindexPaths {
  dataDir: string;
  tasksDir: string;
  knowledgeDir: string;
}

export interface ReindexOptions {
  /** Resolved `STORAGE_INDEX` mode; `off` makes the command a no-op with an explanation. */
  storageIndexMode?: StorageIndexMode;
}

export interface ReindexReport {
  mode: 'rebuild' | 'project' | 'verify';
  dataDir: string;
  project?: string;
  forced: boolean;
  /** Set when the command deliberately did nothing, with the reason. */
  skipped?: string;
  tasks?: number;
  docs?: number;
  batches?: number;
  ms?: number;
  markedProjects?: number;
  /** SC-03b: rows written to the FTS5 index by this run. */
  fts?: FtsRebuildResult;
  /** State of the index after the command (or the state `--verify` examined). */
  inspection?: IndexInspection;
  /** Y-05c: set when the SQLite storage profile handled the command. */
  storageProfile?: 'sqlite';
  sqlite?: SqliteReindexReport | { warnings: string[] };
}

export interface ReindexCliResult {
  exitCode: number;
  text: string;
  report?: ReindexReport;
}

const USAGE = `Usage: mcp-task-knowledge reindex --data [--project <name>] [--verify] [--force] [--json]

  --data            Rebuild DATA_DIR/.index/metadata.db from files (required)
  --project <name>  Rebuild one project only; other projects keep their rows
  --verify          Compare the index with the files and report; writes nothing
  --force           Rebuild even when every project is already complete
  --json            Machine-readable JSON report instead of text

Exit codes: 0 ok / nothing to do, 1 drift found by --verify, 2 usage error, crash, or DATA_DIR
owned by a running server.`;

interface ParsedArgs {
  help: boolean;
  data: boolean;
  json: boolean;
  verify: boolean;
  force: boolean;
  project?: string;
  error?: string;
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = { help: false, data: false, json: false, verify: false, force: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--data':
        parsed.data = true;
        break;
      case '--json':
        parsed.json = true;
        break;
      case '--verify':
        parsed.verify = true;
        break;
      case '--force':
        parsed.force = true;
        break;
      case '--project': {
        const value = args[++i];
        if (value === undefined || value.startsWith('--')) {
          return { ...parsed, error: 'reindex: --project needs a value' };
        }
        parsed.project = value;
        break;
      }
      default:
        if (arg.startsWith('--project=')) {
          const value = arg.slice('--project='.length);
          if (value === '') return { ...parsed, error: 'reindex: --project needs a value' };
          parsed.project = value;
          break;
        }
        return { ...parsed, error: `reindex: unknown flag(s): ${arg}` };
    }
  }
  if (!parsed.help && !parsed.data) return { ...parsed, error: 'reindex: missing required --data flag' };
  return parsed;
}

/** Project names present on disk, so "nothing to do" can be decided without a full walk. */
async function listProjects(paths: ReindexPaths): Promise<string[]> {
  const projects = new Set<string>();
  for (const root of [paths.tasksDir, paths.knowledgeDir]) {
    try {
      const entries = await fsp.readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) projects.add(entry.name);
      }
    } catch {
      // A missing root simply has no projects.
    }
  }
  return [...projects].sort();
}

function render(inspection: IndexInspection): string {
  return formatIndexSection(inspection).join('\n');
}

function driftProblems(inspection: IndexInspection): string[] {
  const problems: string[] = [];
  if (!inspection.available) return [`index unavailable: ${inspection.reason ?? 'unknown reason'}`];
  if (inspection.schemaVersion !== String(inspection.supportedSchemaVersion)) {
    problems.push(`schema ${inspection.schemaVersion} != supported ${inspection.supportedSchemaVersion}`);
  }
  if (!inspection.dataDirMatch) problems.push('data_dir does not point at this DATA_DIR');
  if (inspection.dirty) problems.push('dirty flag is set (a write to the index failed)');
  if (inspection.counts.orphans > 0) problems.push(`${inspection.counts.orphans} index rows without a file`);
  if (inspection.counts.missing > 0) problems.push(`${inspection.counts.missing} files without an index row`);
  if (inspection.counts.drift > 0) problems.push(`${inspection.counts.drift} files with a stale mtime`);
  if (inspection.counts.countDrift > 0) problems.push(`${inspection.counts.countDrift} projects with a wrong file_count`);
  const incomplete = inspection.projects.filter((project) => !project.complete);
  if (incomplete.length > 0) {
    problems.push(`incomplete projects: ${incomplete.map((project) => project.project).join(', ')}`);
  }
  const fts = inspection.fts;
  if (!fts.available) {
    problems.push(`search index unavailable: ${fts.reason ?? 'unknown reason'}`);
  } else {
    if (fts.dirty) problems.push(`search index is dirty${fts.dirtyReason ? ` (${fts.dirtyReason})` : ''}`);
    if (fts.counts.missingRows > 0) problems.push(`${fts.counts.missingRows} searchable rows missing from the search index`);
    if (fts.counts.extraRows > 0) problems.push(`${fts.counts.extraRows} extra rows in the search index`);
    if (fts.counts.staleTerms > 0) problems.push(`${fts.counts.staleTerms} search index rows with stale terms`);
  }
  return problems;
}

/**
 * Cheap skip decision for `reindex --data`: no file walk, at most a few sample reads. The
 * search index counts as clean only when it exists, is not dirty and its per-store counts
 * match the metadata index (a never-built FTS index must be built, not skipped).
 */
async function ftsCoverageClean(paths: ReindexPaths): Promise<boolean> {
  const quick = await inspectIndex(paths, { walk: false, samples: 5 });
  const fts = quick.fts;
  return fts.available && !fts.dirty && fts.counts.missingRows === 0 &&
    fts.counts.extraRows === 0 && fts.counts.staleTerms === 0;
}

async function runVerify(
  paths: ReindexPaths,
  parsed: ParsedArgs,
): Promise<ReindexCliResult> {
  const inspection = await inspectIndex(paths);
  const report: ReindexReport = {
    mode: 'verify',
    dataDir: paths.dataDir,
    forced: parsed.force,
    inspection,
  };
  const problems = driftProblems(inspection);
  const lines = [render(inspection)];
  if (problems.length === 0) {
    lines.push('verify: index matches the files');
  } else {
    lines.push(`verify: ${problems.length} problem(s)`);
    for (const problem of problems) lines.push(`  - ${problem}`);
    lines.push('verify: run `reindex --data` to rebuild the index from files');
  }
  const text = parsed.json ? JSON.stringify(report, null, 2) : lines.join('\n');
  return { exitCode: problems.length === 0 ? 0 : 1, text, report };
}

async function withIndexLock<T>(
  paths: ReindexPaths,
  mode: StorageIndexMode,
  fn: (index: MetadataIndex, fts: FtsSearchIndex | null) => Promise<T>,
): Promise<T> {
  let lock: ServerLockHandle | undefined;
  let index: MetadataIndex | undefined;
  let fts: FtsSearchIndex | undefined;
  try {
    lock = await acquireServerLock({ dataDir: paths.dataDir, transport: 'reindex', version: '' });
    const created = createMetadataIndex({ dataDir: paths.dataDir, mode });
    if (!created) throw new Error('metadata index is unavailable (STORAGE_INDEX=off or the file cannot be opened)');
    index = created;
    try {
      fts = FtsSearchIndex.open(path.join(paths.dataDir, METADATA_INDEX_DIR, METADATA_INDEX_FILE));
    } catch {
      fts = undefined;
    }
    return await fn(index, fts ?? null);
  } finally {
    try {
      fts?.close();
    } catch {
      // Closing is best effort: the lock release below is what matters.
    }
    try {
      index?.close();
    } catch {
      // Closing is best effort: the lock release below is what matters.
    }
    await lock?.release();
  }
}

async function runRebuild(
  paths: ReindexPaths,
  parsed: ParsedArgs,
  mode: StorageIndexMode,
): Promise<ReindexCliResult> {
  return withIndexLock(paths, mode, async (index, fts) => {
    // The offline repair path owns migrations: the next server boot then has nothing to
    // migrate and skips its post-migration full rebuild, which would block /healthz on a
    // large DATA_DIR. A project-only rebuild must not migrate, because it would leave the
    // other projects' search rows stale.
    if (!parsed.project) {
      await checkSchemaVersion({
        dataDir: paths.dataDir,
        tasksDir: paths.tasksDir,
        knowledgeDir: paths.knowledgeDir,
      });
    }
    if (parsed.project) {
      const dirs = await resolveProjectIndexDirs(parsed.project, {
        tasksDir: paths.tasksDir,
        knowledgeDir: paths.knowledgeDir,
      });
      if (!dirs.tasksDir && !dirs.knowledgeDir) {
        throw new Error(
          `project "${parsed.project}" has no tasks or knowledge directory under ${paths.dataDir}`,
        );
      }
      const filled = await index.fillProject({ project: parsed.project, dirs });
      const ftsRebuilt = fts
        ? await rebuildFtsIndex(fts, { tasksDir: paths.tasksDir, knowledgeDir: paths.knowledgeDir }, { project: parsed.project })
        : undefined;
      const inspection = await inspectIndex(paths);
      const report: ReindexReport = {
        mode: 'project',
        dataDir: paths.dataDir,
        project: parsed.project,
        forced: parsed.force,
        tasks: filled.tasks,
        docs: filled.docs,
        ms: filled.ms,
        fts: ftsRebuilt,
        inspection,
      };
      const text = parsed.json
        ? JSON.stringify(report, null, 2)
        : `reindex: project ${parsed.project} — ${filled.tasks} tasks, ${filled.docs} docs in ${filled.ms} ms` +
          `${ftsRebuilt ? `, search index ${ftsRebuilt.tasks + ftsRebuilt.docs} rows` : ''}\n${render(inspection)}`;
      return { exitCode: 0, text, report };
    }

    const projects = await listProjects(paths);
    const metadataComplete =
      projects.length > 0 && projects.every((project) => index.isProjectComplete(project));
    const ftsClean = fts
      ? await ftsCoverageClean(paths)
      : true;
    if (!parsed.force && metadataComplete && ftsClean) {
      const inspection = await inspectIndex(paths);
      const report: ReindexReport = {
        mode: 'rebuild',
        dataDir: paths.dataDir,
        forced: false,
        skipped: 'every project is already complete (pass --force to rebuild anyway)',
        inspection,
      };
      const text = parsed.json
        ? JSON.stringify(report, null, 2)
        : `reindex: nothing to do — ${report.skipped}\n${render(inspection)}`;
      return { exitCode: 0, text, report };
    }

    const rebuilt = await index.rebuild({
      tasksDir: paths.tasksDir,
      knowledgeDir: paths.knowledgeDir,
    });
    const ftsRebuilt = fts
      ? await rebuildFtsIndex(fts, { tasksDir: paths.tasksDir, knowledgeDir: paths.knowledgeDir })
      : undefined;
    const markedProjects = index.markProjectsComplete();
    const inspection = await inspectIndex(paths);
    const report: ReindexReport = {
      mode: 'rebuild',
      dataDir: paths.dataDir,
      forced: parsed.force,
      tasks: rebuilt.tasks,
      docs: rebuilt.docs,
      batches: rebuilt.batches,
      ms: rebuilt.ms,
      fts: ftsRebuilt,
      markedProjects,
      inspection,
    };
    const text = parsed.json
      ? JSON.stringify(report, null, 2)
      : `reindex: ${rebuilt.tasks} tasks + ${rebuilt.docs} docs in ${rebuilt.ms} ms ` +
        `(${rebuilt.batches} batches), ${markedProjects} projects marked complete` +
        `${ftsRebuilt ? `, search index ${ftsRebuilt.tasks + ftsRebuilt.docs} rows in ${ftsRebuilt.ms} ms` : ''}\n${render(inspection)}`;
    return { exitCode: 0, text, report };
  });
}

/**
 * Parse `reindex` argv (args AFTER the 'reindex' word) and run the command.
 * Returns a result object — the caller prints and exits, so this stays unit-testable.
 */export async function runReindexCli(
  args: string[],
  paths: ReindexPaths,
  options: ReindexOptions = {},
): Promise<ReindexCliResult> {
  const parsed = parseArgs(args);
  if (parsed.help) return { exitCode: 0, text: USAGE };
  if (parsed.error) return { exitCode: 2, text: `${parsed.error}\n\n${USAGE}` };

  // Y-05c: the SQLite profile keeps its FTS/vector state inside the database, so the file-profile
  // metadata index reindex does not apply. Handle it through the SQLite diagnostics instead of
  // pretending a file reindex touched the database.
  const profileKind = (process.env.STORAGE_PROFILE ?? 'file').trim().toLowerCase();
  if (profileKind === 'sqlite') {
    const databasePath = path.join(paths.dataDir, '.index', 'storage.sqlite');
    try {
      if (parsed.verify) {
        const inspection = inspectSqliteStorage(databasePath);
        const report: ReindexReport = {
          mode: 'verify',
          dataDir: paths.dataDir,
          forced: parsed.force,
          storageProfile: 'sqlite',
          sqlite: { warnings: inspection.warnings },
          inspection: undefined,
        };
        const text = parsed.json
          ? JSON.stringify({ ...report, inspection }, null, 2)
          : [
              `reindex --verify (sqlite): ${databasePath}`,
              `tasks=${inspection.counts.tasks} docs=${inspection.counts.docs} fts=${inspection.counts.ftsRows}`,
              ...inspection.warnings.map((warning) => `  ${warning}`),
            ].join('\n');
        return { exitCode: inspection.warnings.length > 0 ? 1 : 0, text, report };
      }
      const rebuilt = await rebuildSqliteStorageIndexes(databasePath);
      const report: ReindexReport = {
        mode: 'rebuild',
        dataDir: paths.dataDir,
        forced: parsed.force,
        storageProfile: 'sqlite',
        sqlite: rebuilt,
        ms: rebuilt.durationMs,
      };
      const text = parsed.json
        ? JSON.stringify(report, null, 2)
        : [
            `reindex (sqlite): ${databasePath}`,
            `projects: ${rebuilt.projects}, indexed: ${rebuilt.indexed}, fts rows: ${rebuilt.ftsRows}`,
            `dirty before: ${rebuilt.dirtyBefore}, size: ${rebuilt.sizeBefore} → ${rebuilt.sizeAfter} bytes, ${rebuilt.durationMs}ms`,
          ].join('\n');
      return { exitCode: 0, text, report };
    } catch (err) {
      return { exitCode: 2, text: `reindex (sqlite): ${(err as Error).message}` };
    }
  }

  const mode = options.storageIndexMode ?? 'auto';
  if (mode === 'off') {
    const report: ReindexReport = {
      mode: parsed.verify ? 'verify' : 'rebuild',
      dataDir: paths.dataDir,
      forced: parsed.force,
      skipped: 'STORAGE_INDEX=off — the index is disabled for this DATA_DIR',
    };
    const text = parsed.json
      ? JSON.stringify(report, null, 2)
      : `reindex: ${report.skipped}\nSet STORAGE_INDEX=auto to build the metadata index.`;
    return { exitCode: 0, text, report };
  }

  try {
    return parsed.verify ? await runVerify(paths, parsed) : await runRebuild(paths, parsed, mode);
  } catch (err) {
    if (err instanceof ServerLockError) {
      return { exitCode: 2, text: `reindex: ${err.code}: ${err.message}` };
    }
    // Everything the command raises deliberately (no project directory, index disabled in
    // createMetadataIndex, a failed rebuild) already reads as a sentence with the cause.
    return { exitCode: 2, text: `reindex: ${(err as Error).message}` };
  }
}
