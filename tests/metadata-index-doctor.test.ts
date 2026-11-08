/**
 * SC-02d — `doctor` index section and the `reindex` command.
 *
 * The index is derived, so every case here is about one question: "does the index still
 * match the files, and can `reindex` make it match again?" Tests run against a fixture
 * DATA_DIR in a tmp dir: no server, no config module (the CLI takes paths explicitly).
 *
 * Covered (DoD SC-02d):
 *   - a deleted file shows up as an orphan, an added file as a missing row;
 *   - edited files show up as `mtime` drift;
 *   - `reindex --project` and a full `reindex` heal all three and mark projects complete;
 *   - `reindex --verify` reports drift and writes nothing;
 *   - `doctor` (with and without `--fix`) never writes to the index;
 *   - `.index/` never enters a backup archive.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import matter from 'gray-matter';
import { inspectIndex } from '../src/cli/index-inspect.js';
import { runDoctorCli, formatReport, type DoctorPaths } from '../src/cli/doctor.js';
import { runReindexCli } from '../src/cli/reindex.js';
import { createMetadataIndex, resolveProjectIndexDirs } from '../src/storage/metadata-index.js';
import { createBackupArchive, readBackupArchive } from '../src/services/backup-archive.js';

let ROOT: string;
let PATHS: DoctorPaths;

async function write(file: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content, 'utf-8');
}

function taskJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'task-1',
    project: 'acme',
    title: 'T',
    status: 'pending',
    priority: 'medium',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });
}

function docMd(meta: Record<string, unknown> = {}, body = 'hello'): string {
  const clean: Record<string, unknown> = {
    id: 'doc-1',
    project: 'acme',
    title: 'D',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...meta,
  };
  for (const key of Object.keys(clean)) if (clean[key] === undefined) delete clean[key];
  return matter.stringify(body, clean);
}

const taskFile = (id: string) => path.join(PATHS.tasksDir, 'acme', `${id}.json`);
const docFile = (id: string) => path.join(PATHS.knowledgeDir, 'acme', `${id}.md`);
const indexDb = () => path.join(ROOT, '.index', 'metadata.db');

/** Build the index the way the server does on the first page read. */
async function fillIndex(project = 'acme'): Promise<void> {
  const index = createMetadataIndex({ dataDir: ROOT });
  if (!index) throw new Error('metadata index unavailable in test environment');
  try {
    const dirs = await resolveProjectIndexDirs(project, {
      tasksDir: PATHS.tasksDir,
      knowledgeDir: PATHS.knowledgeDir,
    });
    await index.fillProject({ project, dirs });
  } finally {
    index.close();
  }
}

/** Read `meta` straight from the database to prove the CLI did not write. */
function readMeta(): Map<string, string> {
  const db = new Database(indexDb(), { readonly: true });
  try {
    const rows = db.prepare('SELECT key, value FROM meta').all() as Array<{ key: string; value: string }>;
    return new Map(rows.map((row) => [row.key, row.value]));
  } finally {
    db.close();
  }
}

beforeEach(async () => {
  ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'sc02d-doctor-'));
  PATHS = {
    dataDir: ROOT,
    tasksDir: path.join(ROOT, 'tasks'),
    knowledgeDir: path.join(ROOT, 'knowledge'),
    projectsMetaDir: path.join(ROOT, 'projects'),
  };
  await write(taskFile('task-1'), taskJson({ id: 'task-1' }));
  await write(taskFile('task-2'), taskJson({ id: 'task-2', title: 'Second' }));
  await write(docFile('doc-1'), docMd({ id: 'doc-1' }));
  await fillIndex();
});

afterEach(async () => {
  await fsp.rm(ROOT, { recursive: true, force: true });
});

describe('inspectIndex', () => {
  it('reports rows, files and a complete project for a matching index', async () => {
    const state = await inspectIndex(PATHS);
    expect(state.available).toBe(true);
    expect(state.rows).toEqual({ tasks: 2, docs: 1 });
    expect(state.files).toEqual({ tasks: 2, docs: 1 });
    expect(state.counts).toEqual({ orphans: 0, missing: 0, drift: 0, countDrift: 0 });
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0]).toMatchObject({ project: 'acme', rows: 3, fileCount: 3, complete: true });
    expect(state.dirty).toBe(false);
  });

  it('reports a deleted file as an orphan and an added file as missing', async () => {
    await fsp.rm(taskFile('task-2'));
    await write(taskFile('task-3'), taskJson({ id: 'task-3' }));

    const state = await inspectIndex(PATHS);
    expect(state.counts.orphans).toBe(1);
    expect(state.orphans[0]).toMatchObject({ kind: 'task', id: 'task-2' });
    expect(state.counts.missing).toBe(1);
    expect(state.missing[0]).toMatchObject({ kind: 'task', id: 'task-3' });
    // Adding one file and deleting another leaves the row count (and `file_count`) unchanged,
    // so the count invariant still holds — drift is only visible in the per-file comparison.
    expect(state.counts.countDrift).toBe(0);
  });

  it('reports an out-of-band edit as mtime drift', async () => {
    const later = new Date(Date.now() + 60_000);
    await fsp.utimes(taskFile('task-1'), later, later);

    const state = await inspectIndex(PATHS);
    expect(state.counts.drift).toBe(1);
    expect(state.drift[0]).toMatchObject({ kind: 'task', id: 'task-1' });
  });

  it('reports an absent index as unavailable without throwing', async () => {
    await fsp.rm(path.join(ROOT, '.index'), { recursive: true, force: true });
    const state = await inspectIndex(PATHS);
    expect(state.available).toBe(false);
    expect(state.reason).toBeTruthy();
    expect(state.files).toEqual({ tasks: 2, docs: 1 });
  });
});

describe('doctor index section', () => {
  it('prints the index section and reports orphans as warnings, not errors', async () => {
    await fsp.rm(taskFile('task-2'));
    const result = await runDoctorCli(['--data'], PATHS);

    expect(result.exitCode).toBe(0);
    expect(result.report?.index?.counts.orphans).toBe(1);
    const orphanIssue = result.report?.issues.find((issue) => issue.check === 'index-orphan');
    expect(orphanIssue?.level).toBe('warn');
    expect(orphanIssue?.detail).toContain('1 index rows without a file');
    expect(formatReport(result.report!)).toContain('Index: 2 tasks + 1 docs in 2 files');
  });

  it('does not write to the index, with or without --fix', async () => {
    await fsp.rm(taskFile('task-2'));
    const before = readMeta();

    await runDoctorCli(['--data'], PATHS);
    await runDoctorCli(['--data', '--fix'], PATHS);

    const after = readMeta();
    expect(after.get('built_at')).toBe(before.get('built_at'));
    expect(after.get('dirty')).toBe(before.get('dirty'));
    expect((await inspectIndex(PATHS)).counts.orphans).toBe(1);
  });
});

describe('reindex', () => {
  it('heals orphans and missing rows for one project (--project)', async () => {
    await fsp.rm(taskFile('task-2'));
    await write(taskFile('task-3'), taskJson({ id: 'task-3' }));

    const result = await runReindexCli(['--data', '--project', 'acme'], PATHS);
    expect(result.exitCode).toBe(0);
    expect(result.report?.mode).toBe('project');
    expect(result.report?.tasks).toBe(2);

    const state = await inspectIndex(PATHS);
    expect(state.counts).toEqual({ orphans: 0, missing: 0, drift: 0, countDrift: 0 });
    expect(state.projects[0].complete).toBe(true);
  });

  it('rebuilds every project and marks it complete (no --project)', async () => {
    await fsp.rm(path.join(ROOT, '.index'), { recursive: true, force: true });

    const result = await runReindexCli(['--data', '--force'], PATHS);
    expect(result.exitCode).toBe(0);
    expect(result.report?.mode).toBe('rebuild');
    expect(result.report?.tasks).toBe(2);
    expect(result.report?.docs).toBe(1);
    expect(result.report?.markedProjects).toBe(1);

    const state = await inspectIndex(PATHS);
    expect(state.available).toBe(true);
    expect(state.counts).toEqual({ orphans: 0, missing: 0, drift: 0, countDrift: 0 });
    expect(state.projects[0].complete).toBe(true);
  });

  it('skips a rebuild when every project is already complete, unless --force', async () => {
    const skipped = await runReindexCli(['--data'], PATHS);
    expect(skipped.exitCode).toBe(0);
    expect(skipped.report?.skipped).toContain('already complete');
    expect(skipped.report?.tasks).toBeUndefined();

    const forced = await runReindexCli(['--data', '--force'], PATHS);
    expect(forced.exitCode).toBe(0);
    expect(forced.report?.tasks).toBe(2);
  });

  it('--verify reports drift, exits 1 and writes nothing', async () => {
    await fsp.rm(taskFile('task-2'));
    const before = readMeta();

    const result = await runReindexCli(['--data', '--verify'], PATHS);
    expect(result.exitCode).toBe(1);
    expect(result.report?.mode).toBe('verify');
    expect(result.text).toContain('1 problem(s)');

    expect(readMeta().get('built_at')).toBe(before.get('built_at'));
    expect((await inspectIndex(PATHS)).counts.orphans).toBe(1);
  });

  it('--verify exits 0 on a matching index', async () => {
    const result = await runReindexCli(['--data', '--verify'], PATHS);
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('index matches the files');
  });

  it('is a no-op when STORAGE_INDEX=off', async () => {
    const result = await runReindexCli(['--data'], PATHS, { storageIndexMode: 'off' });
    expect(result.exitCode).toBe(0);
    expect(result.report?.skipped).toContain('STORAGE_INDEX=off');
  });

  it('rejects unknown flags and a missing --project value', async () => {
    expect((await runReindexCli(['--data', '--bogus'], PATHS)).exitCode).toBe(2);
    expect((await runReindexCli(['--data', '--project'], PATHS)).exitCode).toBe(2);
    expect((await runReindexCli([], PATHS)).exitCode).toBe(2);
  });
});

describe('backup exclusion', () => {
  it('keeps .index out of the archive', async () => {
    const { archivePath } = await createBackupArchive({ dataDir: ROOT, label: 'sc02d' });
    const read = await readBackupArchive(archivePath);

    expect(read.manifest.excluded).toContain('.index');
    expect(read.manifest.entries.map((entry) => entry.path).some((p) => p.startsWith('.index/'))).toBe(false);
    // The data itself is still there.
    expect(read.manifest.entries.map((entry) => entry.path)).toContain('tasks/acme/task-1.json');
  });
});
