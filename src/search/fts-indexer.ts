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

function docContent(raw: string): { meta: KnowledgeDocMeta; content: string } {
  const parsed = matter(raw);
  const content = parsed.content.endsWith('\n') ? parsed.content.slice(0, -1) : parsed.content;
  return { meta: parsed.data as unknown as KnowledgeDocMeta, content };
}

/**
 * Full rebuild from files. `reindex --data` is the only caller: the server never pays for a
 * corpus walk, and the repair path is allowed to parse every file it indexes. With `project`
 * only that project's rows are replaced, and the global dirty flag is left alone.
 */
export async function rebuildFtsIndex(
  index: FtsSearchIndex,
  paths: FtsRebuildPaths,
  options: { project?: string } = {},
): Promise<FtsRebuildResult> {
  const startedAt = Date.now();
  const taskStore = resolveStoreId(paths.tasksDir);
  const docStore = resolveStoreId(paths.knowledgeDir);
  const records: FtsRecord[] = [];
  let skipped = 0;

  for (const { file, project } of await listCandidateFiles(paths.tasksDir, '.json', options.project)) {
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
      records.push({
        store: taskStore,
        kind: 'task',
        id: task.id,
        project: task.project || project,
        updatedAt: task.updatedAt ?? '',
        text: buildTextForTask(task),
      });
    } catch (err) {
      skipped++;
      log.warn({ err, file }, 'FTS rebuild skipped an unreadable task file');
    }
  }

  for (const { file, project } of await listCandidateFiles(paths.knowledgeDir, '.md', options.project)) {
    try {
      const { meta, content } = docContent(await fsp.readFile(file, 'utf8'));
      const id = meta?.id ?? path.basename(file, '.md');
      if (meta?.archived || meta?.trashed) {
        skipped++;
        continue;
      }
      records.push({
        store: docStore,
        kind: 'doc',
        id,
        project: meta?.project || project,
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
