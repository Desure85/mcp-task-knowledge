/**
 * SC-03b — keeps the FTS5 index in step with storage writes.
 *
 * The index is derived (owner decision Y-09): the files stay the source of truth, so a failed
 * index write is logged and flagged (`search_meta.dirty`), never thrown back into the caller.
 * `reindex --data` repairs it and clears the flag.
 *
 * Two rules that the read path (SC-03c) depends on:
 *   - the indexed text comes from `buildTextForTask`/`buildTextForDoc`, the same builders the
 *     in-memory BM25 uses, so switching the read path does not change recall;
 *   - the index holds the searchable corpus only: archived/trashed rows are removed and come
 *     back on restore (the FTS schema has no archived column, and adding one would let archived
 *     documents leak into results).
 *
 * Identity is `(store, kind, id)` — see `resolveStoreId`. A deployment can have tasks and
 * knowledge on different roots, so each kind carries its own store.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { KNOWLEDGE_DIR, TASKS_DIR } from '../config.js';
import { childLogger } from '../core/logger.js';
import {
  awaitProjectIndexed,
  ensureProjectIndexed,
  getActiveMetadataIndex,
  resolveProjectIndexDirs,
  type ProjectIndexDirs,
} from '../storage/metadata-index.js';
import type { KnowledgeDocMeta, Task } from '../types.js';
import { buildTextForDoc, buildTextForTask } from './index.js';
import { FtsSearchIndex, resolveStoreId, type FtsKind, type FtsRecord } from './fts-index.js';

const log = childLogger('search:fts-indexer');

let activeIndex: FtsSearchIndex | undefined;

export function taskStoreId(): string {
  return resolveStoreId(TASKS_DIR);
}

export function knowledgeStoreId(): string {
  return resolveStoreId(KNOWLEDGE_DIR);
}

/** Registers (or clears) the index used by storage write hooks. One per process. */
export function setActiveFtsIndex(index: FtsSearchIndex | null | undefined): void {
  activeIndex = index ?? undefined;
}

export function getActiveFtsIndex(): FtsSearchIndex | undefined {
  return activeIndex;
}

export type FtsProjectFillState = 'disabled' | 'complete' | 'running' | 'error' | 'idle';

/**
 * SC-03c: prove that `search_fts` holds every searchable row of the project before the read
 * path is allowed to answer from it. Three independent sides must agree, because each one has
 * been seen to drift on its own: the metadata index proves the files were enumerated, the FTS
 * dirty flag proves no write was lost, and the row counts prove the two indexes describe the
 * same corpus. Archived/trashed rows are excluded on both sides: FTS never stores them, while
 * the metadata tables do.
 */
export function isProjectFtsComplete(project: string): boolean {
  const index = activeIndex;
  if (!index) return false;
  try {
    if (index.isDirty()) return false;
    const meta = getActiveMetadataIndex();
    if (!meta || !meta.isProjectComplete(project)) return false;
    const expectedTasks = meta.listTasks({ project, countOnly: true, excludeArchived: true, excludeTrashed: true }).total;
    const expectedDocs = meta.listDocs({ project, countOnly: true, excludeArchived: true, excludeTrashed: true }).total;
    const tasks = index.projectCounts(taskStoreId(), project);
    const docs = index.projectCounts(knowledgeStoreId(), project);
    return tasks.tasks === expectedTasks && docs.docs === expectedDocs;
  } catch (err) {
    log.warn({ err, project }, 'FTS completeness check failed — search keeps the in-memory path');
    return false;
  }
}

const fills = new Map<string, Promise<void>>();
const fillErrors = new Map<string, string>();

export function getProjectFtsFillState(project: string): FtsProjectFillState {
  if (!activeIndex) return 'disabled';
  if (fills.has(project)) return 'running';
  if (fillErrors.has(project)) return 'error';
  return isProjectFtsComplete(project) ? 'complete' : 'idle';
}

/**
 * Starts one background fill per project, mirroring `ensureProjectIndexed`: the request that
 * triggered it keeps the file-scan path, so a first search after a bulk import never blocks on
 * a corpus walk. A dirty index is deliberately not filled here — only a full `reindex` can
 * prove that no unrelated row is missing.
 */
export function ensureProjectFtsIndexed(project: string): void {
  const index = activeIndex;
  if (!index || fills.has(project)) return;
  try {
    if (index.isDirty() || isProjectFtsComplete(project)) return;
  } catch (err) {
    log.warn({ err, project }, 'FTS fill skipped — completeness check failed');
    return;
  }

  const fill = (async () => {
    const dirs = await resolveProjectIndexDirs(project, { tasksDir: TASKS_DIR, knowledgeDir: KNOWLEDGE_DIR });
    if (getActiveMetadataIndex()) {
      ensureProjectIndexed(project, dirs);
      await awaitProjectIndexed(project);
    }
    const rebuilt = await rebuildFtsIndex(index, { tasksDir: TASKS_DIR, knowledgeDir: KNOWLEDGE_DIR }, { project, dirs });
    fillErrors.delete(project);
    log.info({ project, ...rebuilt }, 'FTS project filled');
  })().catch((err: unknown) => {
    fillErrors.set(project, err instanceof Error ? err.message : String(err));
    log.warn({ err, project }, 'FTS project fill failed — search keeps the in-memory path');
  }).finally(() => {
    fills.delete(project);
  });

  fills.set(project, fill);
}

/** Test helper: wait for the background fill of one project. */
export async function awaitProjectFtsIndexed(project: string): Promise<void> {
  const inflight = fills.get(project);
  if (inflight) await inflight;
}

function noteFailure(err: unknown, op: string, context: Record<string, unknown>): void {
  log.warn({ err, op, ...context }, 'FTS index write failed — files stay the source of truth');
  try {
    activeIndex?.markDirty(`${op}: ${err instanceof Error ? err.message : String(err)}`);
  } catch (dirtyErr) {
    log.warn({ err: dirtyErr, op }, 'FTS index dirty flag failed');
  }
}

function remove(kind: FtsKind, store: string, id: string, op: string): void {
  const index = activeIndex;
  if (!index) return;
  try {
    index.remove(store, kind, id);
  } catch (err) {
    noteFailure(err, op, { id, store });
  }
}

/** Upsert a task, or drop it when it is no longer part of the searchable corpus. */
export function noteTaskWritten(task: Task): void {
  const index = activeIndex;
  if (!index) return;
  const store = taskStoreId();
  try {
    if (task.archived || task.trashed) {
      index.remove(store, 'task', task.id);
      return;
    }
    index.upsert([
      {
        store,
        kind: 'task',
        id: task.id,
        project: task.project,
        updatedAt: task.updatedAt,
        text: buildTextForTask(task),
      },
    ]);
  } catch (err) {
    noteFailure(err, 'task write', { id: task.id, project: task.project });
  }
}

export function noteTaskRemoved(_project: string, id: string): void {
  remove('task', taskStoreId(), id, 'task delete');
}

/** Upsert a knowledge document, or drop it when archived/trashed. */
export function noteDocWritten(project: string, doc: KnowledgeDocMeta, content: string): void {
  const index = activeIndex;
  if (!index) return;
  const store = knowledgeStoreId();
  try {
    if (doc.archived || doc.trashed) {
      index.remove(store, 'doc', doc.id);
      return;
    }
    index.upsert([
      {
        store,
        kind: 'doc',
        id: doc.id,
        project: doc.project || project,
        updatedAt: doc.updatedAt,
        text: buildTextForDoc({ ...doc, content }),
      },
    ]);
  } catch (err) {
    noteFailure(err, 'doc write', { id: doc.id, project });
  }
}

export function noteDocRemoved(_project: string, id: string): void {
  remove('doc', knowledgeStoreId(), id, 'doc delete');
}

/** Project deletion removes whole directories, so per-row hooks never run. */
export function noteProjectRemoved(project: string): void {
  const index = activeIndex;
  if (!index) return;
  for (const [kind, store] of [
    ['task', taskStoreId()],
    ['doc', knowledgeStoreId()],
  ] as const) {
    try {
      index.removeProject(store, project);
    } catch (err) {
      noteFailure(err, `${kind} project delete`, { project });
    }
  }
}

export interface FtsRebuildPaths {
  tasksDir: string;
  knowledgeDir: string;
}

export interface FtsRebuildResult {
  tasks: number;
  docs: number;
  skipped: number;
  ms: number;
}

function isDotName(name: string): boolean {
  return name.startsWith('.');
}

async function readdir(dir: string): Promise<Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>> {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Project directories one level below the root plus the legacy flat layout. */
async function listCandidateFiles(
  root: string,
  extension: string,
  project?: string,
): Promise<Array<{ file: string; project: string }>> {
  const out: Array<{ file: string; project: string }> = [];
  if (project) {
    const dir = path.join(root, project);
    for (const entry of await readdir(dir)) {
      if (entry.isFile() && entry.name.endsWith(extension)) {
        out.push({ file: path.join(dir, entry.name), project });
      }
    }
    return out;
  }
  for (const entry of await readdir(root)) {
    if (entry.isDirectory()) {
      if (isDotName(entry.name)) continue;
      const dir = path.join(root, entry.name);
      for (const child of await readdir(dir)) {
        if (child.isFile() && child.name.endsWith(extension)) {
          out.push({ file: path.join(dir, child.name), project: entry.name });
        }
      }
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      out.push({ file: path.join(root, entry.name), project: '' });
    }
  }
  return out;
}

async function listFilesAt(dir: string | null, extension: string): Promise<string[]> {
  if (!dir) return [];
  const out: string[] = [];
  for (const entry of await readdir(dir)) {
    if (entry.isFile() && entry.name.endsWith(extension)) out.push(path.join(dir, entry.name));
  }
  return out;
}

function docContent(raw: string): { meta: KnowledgeDocMeta; content: string } {
  const parsed = matter(raw);
  const content = parsed.content.endsWith('\n') ? parsed.content.slice(0, -1) : parsed.content;
  return { meta: parsed.data as unknown as KnowledgeDocMeta, content };
}

export interface FtsRebuildOptions {
  project?: string;
  /** Resolved project directories (SC-02c layout), so a lazy fill honours the legacy flat layout. */
  dirs?: ProjectIndexDirs;
}

/**
 * Full rebuild from files. `reindex --data` is the only caller: the server never pays for a
 * corpus walk, and the repair path is allowed to parse every file it indexes. With `project`
 * only that project's rows are replaced, and the global dirty flag is left alone.
 */
export async function rebuildFtsIndex(
  index: FtsSearchIndex,
  paths: FtsRebuildPaths,
  options: FtsRebuildOptions = {},
): Promise<FtsRebuildResult> {
  const startedAt = Date.now();
  const taskStore = resolveStoreId(paths.tasksDir);
  const docStore = resolveStoreId(paths.knowledgeDir);
  const records: FtsRecord[] = [];
  let skipped = 0;

  const taskFiles = options.dirs
    ? (await listFilesAt(options.dirs.tasksDir, '.json')).map((file) => ({
        file,
        project: options.dirs?.tasksLayout === 'project' ? options.project ?? '' : '',
      }))
    : await listCandidateFiles(paths.tasksDir, '.json', options.project);
  const taskFlat = options.dirs?.tasksLayout === 'flat';

  for (const { file, project } of taskFiles) {
    try {
      const task = JSON.parse(await fsp.readFile(file, 'utf8')) as Task;
      if (!task?.id) {
        skipped++;
        continue;
      }
      if (task.archived || task.trashed) {
        skipped++;
        continue;
      }
      const rowProject = task.project || project;
      if (taskFlat && options.project && rowProject !== options.project) {
        skipped++;
        continue;
      }
      records.push({
        store: taskStore,
        kind: 'task',
        id: task.id,
        project: rowProject,
        updatedAt: task.updatedAt ?? '',
        text: buildTextForTask(task),
      });
    } catch (err) {
      skipped++;
      log.warn({ err, file }, 'FTS rebuild skipped an unreadable task file');
    }
  }

  const docFiles = options.dirs
    ? (await listFilesAt(options.dirs.knowledgeDir, '.md')).map((file) => ({
        file,
        project: options.dirs?.knowledgeLayout === 'project' ? options.project ?? '' : '',
      }))
    : await listCandidateFiles(paths.knowledgeDir, '.md', options.project);
  const docFlat = options.dirs?.knowledgeLayout === 'flat';

  for (const { file, project } of docFiles) {
    try {
      const { meta, content } = docContent(await fsp.readFile(file, 'utf8'));
      const id = meta?.id ?? path.basename(file, '.md');
      if (meta?.archived || meta?.trashed) {
        skipped++;
        continue;
      }
      const rowProject = meta?.project || project;
      if (docFlat && options.project && rowProject !== options.project) {
        skipped++;
        continue;
      }
      records.push({
        store: docStore,
        kind: 'doc',
        id,
        project: rowProject,
        updatedAt: meta?.updatedAt ?? '',
        text: buildTextForDoc({ ...meta, id, content }),
      });
    } catch (err) {
      skipped++;
      log.warn({ err, file }, 'FTS rebuild skipped an unreadable knowledge file');
    }
  }

  if (options.project) {
    index.removeProject(taskStore, options.project);
    index.removeProject(docStore, options.project);
    index.upsert(records);
  } else {
    index.rebuild(records);
  }
  const tasks = records.filter((record) => record.kind === 'task').length;
  return { tasks, docs: records.length - tasks, skipped, ms: Date.now() - startedAt };
}
