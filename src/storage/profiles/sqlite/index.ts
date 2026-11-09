/**
 * Y-05a — SQLite-профиль за контрактами ADR-009.
 *
 * Y-05a1 покрывает задачи и документы: CRUD, страницы, жизненный цикл, дерево задач. Остальные
 * коллекции (проекты, промпты, память, события, история, замки, поиск, векторы) ещё не реализованы —
 * профиль честно отвечает `CAPABILITY_UNAVAILABLE`, а не пустыми данными, и не публикует их в
 * манифесте. Векторные коллекции появятся после подтверждения `sqlite-vec` на Y-05b; поиск/история/
 * замки — там же.
 *
 * Данные — канонические JSON-записи в таблицах `tasks`/`docs`; идентичность `(project, id)`. В отличие
 * от файлового профиля, здесь нет git-истории и FTS: манифест это объявляет, а не замалчивает.
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  StoreError,
  type CreateDocInput,
  type CreateTaskInput,
  type DocListFilter,
  type DocPage,
  type DocPageOptions,
  type DocPatch,
  type DocStore,
  type DocVersionInfo,
  type ProjectStore,
  type PromptStore,
  type SearchProvider,
  type StorageProfile,
  type TaskListFilter,
  type TaskPage,
  type TaskPageOptions,
  type TaskPatch,
  type TaskStore,
  type EntityEventEntry,
  type EventLogStore,
  type SnapshotRecord,
  type HistoryProvider,
  type LockProvider,
  type MemoryStore,
} from '../../contracts.js';
import type { VectorStore } from '../../../search/contracts.js';
import type { KnowledgeDoc, KnowledgeDocMeta, Task, TaskTreeNode } from '../../../types.js';
import { DEFAULT_PROJECT } from '../../../config.js';
import { isValidProjectId } from '../../../projects.js';
import type { ProjectDetail, ProjectInfo, ProjectMetadata } from '../../../projects.js';
import {
  DEFAULT_PROJECT_STATUSES,
  normalizeInitialStatuses,
  normalizeStatuses,
  normalizeTransitions,
  resolveCloseStatus,
} from '../../../workflow.js';
import type { ProjectWorkflow } from '../../../workflow.js';
import path from 'node:path';
import { openSqliteDatabase, type SqliteDatabase } from './db.js';
import { probeSqliteVec } from './vec-gate.js';
import { createSqliteVectorStore } from './vector-store.js';
import { createFileIndexingService } from '../../../search/indexing-service.js';
import { createFileChunkingStrategy } from '../../../search/embeddings-file.js';
import type { EmbeddingProvider } from '../../../search/contracts.js';
import { FileMemoryStore, FilePromptStore } from '../file/index.js';
import { buildTextForDoc, buildTextForTask } from '../../../search/index.js';

export interface SqliteProfileOptions {
  /** SQLite database file; caller owns the path (ADR-009 rule 1). */
  databasePath: string;
  /** How long `withLock` waits for a busy key before failing; defaults to 10s. */
  lockTimeoutMs?: number;
  /** Embedding provider factory; when present the profile exposes the indexing queue. */
  embeddingProvider?: () => Promise<EmbeddingProvider | undefined>;
  /** Manifest of indexed content hashes; defaults to `<db dir>/index-manifest.json`. */
  indexingManifestPath?: string;
  /** External-provider policy applied before items enter the queue (Y-04a). */
  externalPolicy?: (item: {
    store: string;
    kind: 'task' | 'doc' | 'chunk';
    project: string;
    id: string;
    text: string;
    trustLevel?: 'system' | 'user' | 'external';
  }) => { allowed: boolean; reason?: string };
  /** Test/ops override for the sqlite-vec gate; defaults to probing the real extension. */
  vecAvailable?: boolean;
}

function isoNow(): string {
  return new Date().toISOString();
}

function unavailable(what: string): never {
  throw new StoreError('CAPABILITY_UNAVAILABLE', `sqlite profile does not implement ${what} yet (Y-05a2)`);
}

function unavailableObject<T extends object>(what: string): T {
  return new Proxy({} as T, {
    get: () => () => unavailable(what),
  });
}

function cleanObject<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export function createSqliteProfile(options: SqliteProfileOptions): StorageProfile {
  if (!options.databasePath) {
    throw new StoreError('CONFIG_MISMATCH', 'sqlite profile requires databasePath');
  }
  const handle: SqliteDatabase = openSqliteDatabase(options.databasePath);
  const { db } = handle;

  // ─── tasks ───────────────────────────────────────────────────────────────
  const selectTask = db.prepare('select data from tasks where project = ? and id = ?');
  const selectProjectTasks = db.prepare('select data from tasks where project = ? order by rowid');
  const selectAllTasks = db.prepare('select data from tasks order by rowid');
  const upsertTask = db.prepare(
    'insert into tasks(project, id, data) values(?, ?, ?) on conflict(project, id) do update set data = excluded.data',
  );
  const deleteTask = db.prepare('delete from tasks where project = ? and id = ?');

  function readTask(project: string, id: string): Task | null {
    const row = selectTask.get(project, id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Task) : null;
  }

  function writeTask(task: Task): void {
    upsertTask.run(task.project, task.id, JSON.stringify(cleanObject(task)));
  }

  function readAllTasks(project?: string): Task[] {
    const rows = (project ? selectProjectTasks.all(project) : selectAllTasks.all()) as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data) as Task);
  }

  function matchesTaskFilter(task: Task, filter: TaskListFilter | TaskPageOptions): boolean {
    if (filter.status && task.status !== filter.status) return false;
    if ('type' in filter && filter.type && task.type !== filter.type) return false;
    if (filter.tag && !(task.tags ?? []).includes(filter.tag)) return false;
    if ('priority' in filter && filter.priority && task.priority !== filter.priority) return false;
    if ('parentId' in filter && filter.parentId !== undefined && task.parentId !== filter.parentId) return false;
    if ('updatedSince' in filter && filter.updatedSince && task.updatedAt < filter.updatedSince) return false;
    if (!filter.includeArchived && task.archived) return false;
    if (!filter.includeTrashed && task.trashed) return false;
    return true;
  }

  function taskSort(a: Task, b: Task): number {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }

  const tasks: TaskStore = {
    async list(filter: TaskListFilter = {}): Promise<Task[]> {
      return readAllTasks(filter.project)
        .filter((task) => matchesTaskFilter(task, filter))
        .sort(taskSort);
    },
    async page(project: string, pageOptions: TaskPageOptions): Promise<TaskPage> {
      const matching = readAllTasks(project)
        .filter((task) => matchesTaskFilter(task, pageOptions))
        .sort(taskSort);
      const cursorIndex = pageOptions.cursor
        ? matching.findIndex((task) => task.id === pageOptions.cursor)
        : -1;
      const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
      const items = pageOptions.countOnly ? [] : matching.slice(start, start + pageOptions.limit);
      const remaining = matching.length - start;
      return {
        items,
        keys: items.map((task) => task.id),
        total: matching.length,
        totalExact: true,
        hasMore: remaining > pageOptions.limit,
      };
    },
    async get(project: string, id: string): Promise<Task | null> {
      return readTask(project, id);
    },
    async create(input: CreateTaskInput): Promise<Task> {
      if (!input.title || !input.title.trim()) {
        throw new StoreError('CONFLICT', 'task title is required');
      }
      const now = isoNow();
      const task: Task = cleanObject({
        id: randomUUID(),
        project: input.project,
        title: input.title,
        description: input.description,
        status: (input.status ?? 'todo') as Task['status'],
        type: input.type,
        priority: input.priority ?? 'medium',
        tags: input.tags,
        links: input.links,
        parentId: input.parentId,
        createdAt: now,
        updatedAt: now,
      });
      writeTask(task);
      indexTask(task);
      return task;
    },
    async update(project: string, id: string, patch: TaskPatch): Promise<Task | null> {
      const existing = readTask(project, id);
      if (!existing) return null;
      const merged: Task = cleanObject({
        ...existing,
        ...patch,
        id: existing.id,
        project: existing.project,
        createdAt: existing.createdAt,
        updatedAt: isoNow(),
      });
      writeTask(merged);
      indexTask(merged);
      return merged;
    },
    async close(project: string, id: string): Promise<Task | null> {
      return tasks.update(project, id, { status: 'done' });
    },
    async archive(project: string, id: string): Promise<Task | null> {
      return tasks.update(project, id, { archived: true, archivedAt: isoNow() });
    },
    async trash(project: string, id: string): Promise<Task | null> {
      return tasks.update(project, id, { trashed: true, trashedAt: isoNow() });
    },
    async restore(project: string, id: string): Promise<Task | null> {
      const existing = readTask(project, id);
      if (!existing) return null;
      const restored: Task = cleanObject({
        ...existing,
        archived: undefined,
        trashed: undefined,
        archivedAt: undefined,
        trashedAt: undefined,
        updatedAt: isoNow(),
      });
      writeTask(restored);
      indexTask(restored);
      return restored;
    },
    async deletePermanent(project: string, id: string): Promise<boolean> {
      const changed = deleteTask.run(project, id).changes > 0;
      if (changed) removeIndexed(TASK_STORE, 'task', project, id);
      return changed;
    },
    async tree(filter: TaskListFilter = {}): Promise<TaskTreeNode[]> {
      const all = await tasks.list({ ...filter, includeArchived: true, includeTrashed: true });
      const byParent = new Map<string | undefined, Task[]>();
      for (const task of all) {
        const list = byParent.get(task.parentId) ?? [];
        list.push(task);
        byParent.set(task.parentId, list);
      }
      const build = (parentId: string | undefined, seen: Set<string>): TaskTreeNode[] =>
        (byParent.get(parentId) ?? [])
          .filter((task) => !seen.has(task.id))
          .sort(taskSort)
          .map((task) => ({ ...task, children: build(task.id, new Set([...seen, task.id])) }));
      return build(undefined, new Set());
    },
    async closeWithCascade(project: string, id: string, cascade = false): Promise<{ root: Task | null; cascaded: Task[] }> {
      const root = readTask(project, id);
      if (!root) return { root: null, cascaded: [] };
      const all = readAllTasks(project);
      const cascaded: Task[] = [];
      if (cascade) {
        const collect = (parentId: string, seen: Set<string>): Task[] => {
          const result: Task[] = [];
          for (const child of all.filter((task) => task.parentId === parentId)) {
            if (seen.has(child.id)) continue;
            seen.add(child.id);
            result.push(child, ...collect(child.id, seen));
          }
          return result;
        };
        cascaded.push(...collect(root.id, new Set([root.id])));
      }
      const now = isoNow();
      const updatedRoot: Task = { ...root, status: 'done', updatedAt: now };
      writeTask(updatedRoot);
      const closed: Task[] = [];
      for (const descendant of cascaded) {
        const updated: Task = { ...descendant, status: 'done', updatedAt: now };
        writeTask(updated);
        closed.push(updated);
      }
      return { root: updatedRoot, cascaded: closed };
    },
    async subtree(project: string, rootId: string): Promise<TaskTreeNode | null> {
      const root = readTask(project, rootId);
      if (!root) return null;
      const all = readAllTasks(project);
      const build = (task: Task, seen: Set<string>): TaskTreeNode => ({
        ...task,
        children: all
          .filter((child) => child.parentId === task.id && !seen.has(child.id))
          .sort(taskSort)
          .map((child) => build(child, new Set([...seen, task.id]))),
      });
      return build(root, new Set());
    },
    async children(project: string, parentId: string): Promise<Task[]> {
      return readAllTasks(project)
        .filter((task) => task.parentId === parentId && !task.archived && !task.trashed)
        .sort(taskSort);
    },
    async claim(): Promise<never> {
      return unavailable('task claims');
    },
    async renewClaim(): Promise<never> {
      return unavailable('task claims');
    },
    async releaseClaim(): Promise<never> {
      return unavailable('task claims');
    },
  };

  // ─── docs ────────────────────────────────────────────────────────────────
  const selectDoc = db.prepare('select data from docs where project = ? and id = ?');
  const selectProjectDocs = db.prepare('select data from docs where project = ? order by rowid');
  const selectAllDocs = db.prepare('select data from docs order by rowid');
  const upsertDoc = db.prepare(
    'insert into docs(project, id, data) values(?, ?, ?) on conflict(project, id) do update set data = excluded.data',
  );
  const deleteDoc = db.prepare('delete from docs where project = ? and id = ?');

  function readDoc(project: string, id: string): KnowledgeDoc | null {
    const row = selectDoc.get(project, id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as KnowledgeDoc) : null;
  }

  function metaOf(doc: KnowledgeDoc): KnowledgeDocMeta {
    const { content: _content, ...meta } = doc;
    return meta;
  }

  function writeDoc(doc: KnowledgeDoc): void {
    upsertDoc.run(doc.project, doc.id, JSON.stringify(cleanObject(doc)));
  }

  function readAllDocs(project?: string): KnowledgeDoc[] {
    const rows = (project ? selectProjectDocs.all(project) : selectAllDocs.all()) as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data) as KnowledgeDoc);
  }

  function matchesDocFilter(doc: KnowledgeDoc, filter: DocListFilter | DocPageOptions): boolean {
    if (filter.tag && !(doc.tags ?? []).includes(filter.tag)) return false;
    if ('type' in filter && filter.type && doc.type !== filter.type) return false;
    if ('parentId' in filter && filter.parentId !== undefined && doc.parentId !== filter.parentId) return false;
    if (!filter.includeArchived && doc.archived) return false;
    if (!filter.includeTrashed && doc.trashed) return false;
    return true;
  }

  function docSort(a: KnowledgeDoc, b: KnowledgeDoc): number {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }

  const selectDocVersions = db.prepare(
    'select version, data, updated_at from doc_versions where project = ? and id = ? order by version',
  );
  const selectDocVersion = db.prepare('select data from doc_versions where project = ? and id = ? and version = ?');
  const maxDocVersion = db.prepare(
    'select coalesce(max(version), 0) as version from doc_versions where project = ? and id = ?',
  );
  const insertDocVersion = db.prepare(
    'insert into doc_versions(project, id, version, data, updated_at) values(?, ?, ?, ?, ?)',
  );

  function recordDocVersion(doc: KnowledgeDoc): void {
    const row = maxDocVersion.get(doc.project, doc.id) as { version: number };
    insertDocVersion.run(doc.project, doc.id, row.version + 1, JSON.stringify(doc), doc.updatedAt);
  }

  const docs: DocStore = {
    async list(filter: DocListFilter = {}): Promise<KnowledgeDocMeta[]> {
      return readAllDocs(filter.project)
        .filter((doc) => matchesDocFilter(doc, filter))
        .sort(docSort)
        .map(metaOf);
    },
    async page(project: string, pageOptions: DocPageOptions): Promise<DocPage> {
      const matching = readAllDocs(project)
        .filter((doc) => matchesDocFilter(doc, pageOptions))
        .sort(docSort);
      const cursorIndex = pageOptions.cursor ? matching.findIndex((doc) => doc.id === pageOptions.cursor) : -1;
      const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
      const items = pageOptions.countOnly ? [] : matching.slice(start, start + pageOptions.limit).map(metaOf);
      return {
        items,
        keys: items.map((doc) => doc.id),
        total: matching.length,
        totalExact: true,
        hasMore: matching.length - start > pageOptions.limit,
      };
    },
    async read(project: string, id: string): Promise<KnowledgeDoc | null> {
      return readDoc(project, id);
    },
    async create(input: CreateDocInput): Promise<KnowledgeDoc> {
      const now = isoNow();
      const doc: KnowledgeDoc = cleanObject({
        id: randomUUID(),
        project: input.project,
        title: input.title,
        content: input.content,
        tags: input.tags,
        source: input.source,
        parentId: input.parentId,
        type: input.type,
        trustLevel: input.trustLevel,
        createdAt: now,
        updatedAt: now,
      });
      writeDoc(doc);
      recordDocVersion(doc);
      indexDoc(doc);
      return doc;
    },
    async update(project: string, id: string, patch: DocPatch): Promise<KnowledgeDoc | null> {
      const existing = readDoc(project, id);
      if (!existing) return null;
      const merged: KnowledgeDoc = cleanObject({
        ...existing,
        ...patch,
        id: existing.id,
        project: existing.project,
        createdAt: existing.createdAt,
        updatedAt: isoNow(),
      });
      writeDoc(merged);
      recordDocVersion(merged);
      indexDoc(merged);
      return merged;
    },
    async archive(project: string, id: string): Promise<KnowledgeDoc | null> {
      return docs.update(project, id, { archived: true, archivedAt: isoNow() });
    },
    async trash(project: string, id: string): Promise<KnowledgeDoc | null> {
      return docs.update(project, id, { trashed: true, trashedAt: isoNow() });
    },
    async restore(project: string, id: string): Promise<KnowledgeDoc | null> {
      const existing = readDoc(project, id);
      if (!existing) return null;
      const restored: KnowledgeDoc = cleanObject({
        ...existing,
        archived: undefined,
        trashed: undefined,
        archivedAt: undefined,
        trashedAt: undefined,
        updatedAt: isoNow(),
      });
      writeDoc(restored);
      return restored;
    },
    async deletePermanent(project: string, id: string): Promise<boolean> {
      const changed = deleteDoc.run(project, id).changes > 0;
      if (changed) removeIndexed(DOC_STORE, 'doc', project, id);
      return changed;
    },
    async versions(project: string, id: string): Promise<DocVersionInfo[]> {
      const rows = selectDocVersions.all(project, id) as Array<{ version: number; data: string; updated_at: string }>;
      return rows.map((row) => {
        const snapshot = JSON.parse(row.data) as KnowledgeDoc;
        return { version: row.version, updatedAt: row.updated_at, title: snapshot.title };
      });
    },
    async restoreVersion(project: string, id: string, version: number): Promise<KnowledgeDoc | null> {
      const row = selectDocVersion.get(project, id, version) as { data: string } | undefined;
      if (!row) return null;
      const snapshot = JSON.parse(row.data) as KnowledgeDoc;
      const restored: KnowledgeDoc = { ...snapshot, project, id, updatedAt: isoNow() };
      writeDoc(restored);
      recordDocVersion(restored);
      indexDoc(restored);
      return restored;
    },
  };

  // ─── projects (Y-05a2) ──────────────────────────────────────────────────
  const selectProject = db.prepare('select data from projects where project = ?');
  const selectAllProjects = db.prepare('select project, data from projects order by project');
  const upsertProject = db.prepare(
    'insert into projects(project, data) values(?, ?) on conflict(project) do update set data = excluded.data',
  );
  const deleteProjectRow = db.prepare('delete from projects where project = ?');
  const deleteProjectTasks = db.prepare('delete from tasks where project = ?');
  const deleteProjectDocs = db.prepare('delete from docs where project = ?');
  const deleteProjectVersions = db.prepare('delete from doc_versions where project = ?');
  const countProjectTasks = db.prepare('select count(*) as total from tasks where project = ?');
  const countProjectDocs = db.prepare('select count(*) as total from docs where project = ?');

  function readProjectMetadataRow(project: string): ProjectMetadata | null {
    const row = selectProject.get(project) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as ProjectMetadata) : null;
  }

  function workflowFor(metadata: ProjectMetadata | null): ProjectWorkflow {
    const statuses = normalizeStatuses(metadata?.statuses ?? DEFAULT_PROJECT_STATUSES);
    const transitions = normalizeTransitions(metadata?.transitions ?? {}, statuses);
    const initialStatuses = normalizeInitialStatuses(metadata?.initialStatuses, statuses);
    return {
      statuses,
      transitions,
      closeStatus: resolveCloseStatus(statuses, metadata?.closeStatus),
      initialStatuses,
      isDefault: !metadata?.statuses || metadata.statuses.length === 0,
    };
  }

  function projectInfo(project: string, metadata: ProjectMetadata | null, current: string): ProjectInfo {
    const taskCount = (countProjectTasks.get(project) as { total: number }).total;
    const knowledgeCount = (countProjectDocs.get(project) as { total: number }).total;
    return {
      id: project,
      isDefault: project === DEFAULT_PROJECT,
      isCurrent: project === current,
      // ADR-009 target removes filesystem paths from responses; the sqlite profile has no such
      // paths, so it reports empty ones rather than inventing file locations (recorded decision).
      paths: { tasks: '', knowledge: '' },
      hasTasks: taskCount > 0,
      hasKnowledge: knowledgeCount > 0,
      taskCount,
      knowledgeCount,
      description: metadata?.description,
      createdAt: metadata?.createdAt,
    };
  }

  const projectStore: ProjectStore = {
    async list(getCurrent: () => string): Promise<ProjectInfo[]> {
      const current = getCurrent();
      const rows = selectAllProjects.all() as Array<{ project: string; data: string }>;
      return rows.map((row) => projectInfo(row.project, JSON.parse(row.data) as ProjectMetadata, current));
    },
    async detail(projectId: string, getCurrent: () => string): Promise<ProjectDetail | null> {
      const metadata = readProjectMetadataRow(projectId);
      if (!metadata) return null;
      const info = projectInfo(projectId, metadata, getCurrent());
      const projectTasks = readAllTasks(projectId).filter((task) => !task.archived && !task.trashed);
      const byStatus: Record<string, number> = {};
      const byPriority: Record<string, number> = {};
      for (const task of projectTasks) {
        byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
        byPriority[task.priority] = (byPriority[task.priority] ?? 0) + 1;
      }
      const projectDocs = readAllDocs(projectId).filter((doc) => !doc.archived && !doc.trashed);
      const byType: Record<string, number> = {};
      for (const doc of projectDocs) {
        const type = doc.type ?? 'unknown';
        byType[type] = (byType[type] ?? 0) + 1;
      }
      return {
        ...info,
        taskStats: {
          total: projectTasks.length,
          byStatus,
          byPriority,
          recent: projectTasks
            .slice()
            .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
            .slice(0, 5)
            .map((task) => ({ id: task.id, title: task.title, status: task.status, updatedAt: task.updatedAt })),
        },
        knowledgeStats: {
          total: projectDocs.length,
          byType,
          recent: projectDocs
            .slice()
            .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
            .slice(0, 5)
            .map((doc) => ({ id: doc.id, title: doc.title, updatedAt: doc.updatedAt })),
        },
        metadata,
      };
    },
    async create(projectId: string, description?: string): Promise<ProjectInfo> {
      if (!isValidProjectId(projectId)) {
        throw new StoreError('CONFLICT', `invalid project id '${projectId}'`);
      }
      if (readProjectMetadataRow(projectId)) {
        throw new StoreError('CONFLICT', `project ${projectId} already exists`);
      }
      const now = isoNow();
      const metadata = cleanObject({ description, createdAt: now, updatedAt: now }) as ProjectMetadata;
      upsertProject.run(projectId, JSON.stringify(metadata));
      return projectInfo(projectId, metadata, projectId);
    },
    async remove(projectId: string, force: boolean): Promise<{ deleted: boolean; message: string }> {
      if (!readProjectMetadataRow(projectId)) {
        return { deleted: false, message: `project ${projectId} does not exist` };
      }
      const taskCount = (countProjectTasks.get(projectId) as { total: number }).total;
      const docCount = (countProjectDocs.get(projectId) as { total: number }).total;
      if (!force && (taskCount > 0 || docCount > 0)) {
        return {
          deleted: false,
          message: `project ${projectId} still has ${taskCount} tasks and ${docCount} documents (use force)`,
        };
      }
      deleteProjectTasks.run(projectId);
      deleteProjectDocs.run(projectId);
      deleteProjectVersions.run(projectId);
      clearProjectIndex(projectId);
      deleteProjectRow.run(projectId);
      return { deleted: true, message: `project ${projectId} deleted` };
    },
    async readMetadata(projectId: string): Promise<ProjectMetadata | null> {
      return readProjectMetadataRow(projectId);
    },
    async updateMetadata(projectId: string, updates: Record<string, unknown>): Promise<ProjectMetadata | null> {
      const existing = readProjectMetadataRow(projectId);
      if (!existing) return null;
      const merged = cleanObject({
        ...existing,
        ...(updates as Partial<ProjectMetadata>),
        createdAt: existing.createdAt,
        updatedAt: isoNow(),
      }) as ProjectMetadata;
      upsertProject.run(projectId, JSON.stringify(merged));
      return merged;
    },
    async workflow(project: string): Promise<ProjectWorkflow> {
      return workflowFor(readProjectMetadataRow(project));
    },
  };

  // ─── history (Y-05a2) ────────────────────────────────────────────────────
  const historyProvider: HistoryProvider = {
    async list(project: string, kind: 'doc' | 'task', id: string) {
      if (kind === 'task') {
        return unavailable('task history (git stage R)') as never;
      }
      const rows = selectDocVersions.all(project, id) as Array<{ version: number; data: string; updated_at: string }>;
      return rows.map((row) => {
        const snapshot = JSON.parse(row.data) as KnowledgeDoc;
        return { version: row.version, updatedAt: row.updated_at, title: snapshot.title };
      });
    },
    async restore(project: string, kind: 'doc' | 'task', id: string, version: number): Promise<KnowledgeDoc | null> {
      if (kind === 'task') {
        return unavailable('task history (git stage R)') as never;
      }
      const row = selectDocVersion.get(project, id, version) as { data: string } | undefined;
      if (!row) return null;
      const snapshot = JSON.parse(row.data) as KnowledgeDoc;
      const restored: KnowledgeDoc = { ...snapshot, project, id, updatedAt: isoNow() };
      writeDoc(restored);
      recordDocVersion(restored);
      indexDoc(restored);
      return restored;
    },
  };

  // ─── event log (Y-05a3) ────────────────────────────────────────────────
  const selectEventsSince = db.prepare(
    'select event_id, entity_id, entity_type, operation, snapshot, version, timestamp from events where log_path = ? and event_id > ? order by event_id limit ?',
  );
  const selectAllEvents = db.prepare(
    'select event_id, entity_id, entity_type, operation, snapshot, version, timestamp from events where log_path = ? order by event_id',
  );
  // The counter must survive compaction: snapshots remember the last event id even after the
  // events themselves are garbage-collected, exactly like sync/event-log.ts keeps nextEventId.
  const nextEventId = db.prepare(
    'select coalesce(max(value), 0) + 1 as next from (select max(event_id) as value from events where log_path = ? union all select max(last_event_id) as value from snapshots where log_path = ?)',
  );
  const insertEvent = db.prepare(
    'insert into events(log_path, event_id, entity_id, entity_type, operation, snapshot, version, timestamp) values(?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const selectSnapshotRow = db.prepare(
    'select entity_id, entity_type, state, last_event_id, timestamp from snapshots where log_path = ? and entity_id = ?',
  );
  const selectSnapshots = db.prepare(
    'select entity_id, entity_type, state, last_event_id, timestamp from snapshots where log_path = ? order by entity_id',
  );
  const upsertSnapshot = db.prepare(
    'insert into snapshots(log_path, entity_id, entity_type, state, last_event_id, timestamp) values(?, ?, ?, ?, ?, ?) on conflict(log_path, entity_id) do update set entity_type = excluded.entity_type, state = excluded.state, last_event_id = excluded.last_event_id, timestamp = excluded.timestamp',
  );
  const deleteEventsThrough = db.prepare('delete from events where log_path = ? and event_id <= ?');
  const countEvents = db.prepare('select count(*) as total from events where log_path = ?');

  type EventRow = {
    event_id: number;
    entity_id: string;
    entity_type: 'task' | 'knowledge';
    operation: 'create' | 'update' | 'delete';
    snapshot: string | null;
    version: number;
    timestamp: string;
  };

  function toEventEntry(row: EventRow): EntityEventEntry {
    return {
      eventId: row.event_id,
      entityId: row.entity_id,
      entityType: row.entity_type,
      operation: row.operation,
      snapshot: row.snapshot ? (JSON.parse(row.snapshot) as Record<string, unknown>) : null,
      version: row.version,
      timestamp: row.timestamp,
    };
  }

  function eventLogFor(storagePath: string): EventLogStore {
    return {
      append(entityId, entityType, operation, snapshot, version): EntityEventEntry {
        const next = (nextEventId.get(storagePath, storagePath) as { next: number }).next;
        const timestamp = isoNow();
        insertEvent.run(
          storagePath,
          next,
          entityId,
          entityType,
          operation,
          snapshot === null ? null : JSON.stringify(snapshot),
          version,
          timestamp,
        );
        return { eventId: next, entityId, entityType, operation, snapshot, timestamp, version };
      },
      since(eventId, limit = 100) {
        return (selectEventsSince.all(storagePath, eventId, limit) as EventRow[]).map(toEventEntry);
      },
      snapshot(entityId): SnapshotRecord | undefined {
        const row = selectSnapshotRow.get(storagePath, entityId) as
          | { entity_id: string; entity_type: 'task' | 'knowledge'; state: string | null; last_event_id: number; timestamp: string }
          | undefined;
        if (!row) return undefined;
        return {
          entityId: row.entity_id,
          entityType: row.entity_type,
          state: row.state ? (JSON.parse(row.state) as Record<string, unknown>) : null,
          lastEventId: row.last_event_id,
          timestamp: row.timestamp,
        };
      },
      snapshots(): SnapshotRecord[] {
        const rows = selectSnapshots.all(storagePath) as Array<{
          entity_id: string;
          entity_type: 'task' | 'knowledge';
          state: string | null;
          last_event_id: number;
          timestamp: string;
        }>;
        return rows.map((row) => ({
          entityId: row.entity_id,
          entityType: row.entity_type,
          state: row.state ? (JSON.parse(row.state) as Record<string, unknown>) : null,
          lastEventId: row.last_event_id,
          timestamp: row.timestamp,
        }));
      },
      compact(): { compacted: number; remaining: number } {
        // Mirrors sync/event-log.ts: the latest event per entity becomes a snapshot, then events up
        // to the newest snapshot point are garbage-collected.
        const events = (selectAllEvents.all(storagePath) as EventRow[]).map(toEventEntry);
        const latest = new Map<string, EntityEventEntry>();
        for (const event of events) latest.set(event.entityId, event);
        for (const event of latest.values()) {
          upsertSnapshot.run(
            storagePath,
            event.entityId,
            event.entityType,
            event.snapshot === null ? null : JSON.stringify(event.snapshot),
            event.eventId,
            event.timestamp,
          );
        }
        const maxSnapshotEventId = Math.max(0, ...([...latest.values()].map((event) => event.eventId)));
        const compacted = deleteEventsThrough.run(storagePath, maxSnapshotEventId).changes;
        const remaining = (countEvents.get(storagePath) as { total: number }).total;
        return { compacted, remaining };
      },
    };
  }

  // ─── locks (Y-05a3) ──────────────────────────────────────────────────────
  const LOCK_LEASE_MS = 30_000;
  const lockTimeoutMs = options.lockTimeoutMs ?? 10_000;
  const acquireLock = db.prepare(
    'insert into locks(key, owner, expires_at) values(?, ?, ?) on conflict(key) do update set owner = excluded.owner, expires_at = excluded.expires_at where locks.expires_at <= ?',
  );
  const releaseLock = db.prepare('delete from locks where key = ? and owner = ?');

  const locks: LockProvider = {
    async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const owner = randomUUID();
      const deadline = Date.now() + lockTimeoutMs;
      for (;;) {
        const now = Date.now();
        const acquired = acquireLock.run(key, owner, now + LOCK_LEASE_MS, now).changes > 0;
        if (acquired) break;
        if (Date.now() >= deadline) {
          throw new StoreError('CONFLICT', 'lock timeout for key ' + key);
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      try {
        return await fn();
      } finally {
        releaseLock.run(key, owner);
      }
    },
  };

  // ─── FTS5 search provider (Y-05b1) ─────────────────────────────────────
  const TASK_STORE = 'sqlite:tasks';
  const DOC_STORE = 'sqlite:docs';

  const insertFtsRow = db.prepare(
    'insert into search_fts(store, kind, project, id, title, body) values(?, ?, ?, ?, ?, ?)',
  );
  // FTS5 rows are deleted through their rowid: filtering on UNINDEXED columns makes SQLite scan the
  // whole FTS table, which turns a bulk write into O(n^2) (measured: 10k sqlite creates 36s, 100k did
  // not finish in the session budget before this fix).
  const deleteFtsByRowid = db.prepare('delete from search_fts where rowid = ?');
  const selectFtsKey = db.prepare('select rowid from search_fts_keys where store = ? and kind = ? and project = ? and id = ?');
  const insertFtsKey = db.prepare(
    'insert into search_fts_keys(store, kind, project, id, rowid) values(?, ?, ?, ?, ?) on conflict(store, kind, project, id) do update set rowid = excluded.rowid',
  );
  const deleteFtsKey = db.prepare('delete from search_fts_keys where store = ? and kind = ? and project = ? and id = ?');
  const selectProjectKeys = db.prepare('select rowid from search_fts_keys where project = ?');
  const deleteProjectKeys = db.prepare('delete from search_fts_keys where project = ?');
  const selectFtsState = db.prepare('select complete, dirty from search_index_state where project = ?');
  const upsertFtsState = db.prepare(
    'insert into search_index_state(project, complete, dirty, updated_at) values(?, ?, ?, ?) on conflict(project) do update set complete = excluded.complete, dirty = excluded.dirty, updated_at = excluded.updated_at',
  );

  function ftsBody(text: string, title: string): string {
    return title ? title + '\n' + text : text;
  }

  function dropIndexedRow(store: string, kind: 'task' | 'doc', project: string, id: string): void {
    const key = selectFtsKey.get(store, kind, project, id) as { rowid: number } | undefined;
    if (key) deleteFtsByRowid.run(key.rowid);
    deleteFtsKey.run(store, kind, project, id);
  }

  function indexTask(task: Task): void {
    try {
      dropIndexedRow(TASK_STORE, 'task', task.project, task.id);
      if (task.archived || task.trashed) return;
      const info = insertFtsRow.run(
        TASK_STORE,
        'task',
        task.project,
        task.id,
        task.title,
        ftsBody(buildTextForTask(task as never), task.title),
      );
      insertFtsKey.run(TASK_STORE, 'task', task.project, task.id, Number(info.lastInsertRowid));
    } catch {
      // A failed index write must not fail the mutation: the project is marked dirty instead.
      upsertFtsState.run(task.project, 0, 1, isoNow());
    }
  }

  function indexDoc(doc: KnowledgeDoc): void {
    try {
      dropIndexedRow(DOC_STORE, 'doc', doc.project, doc.id);
      if (doc.archived || doc.trashed) return;
      const info = insertFtsRow.run(
        DOC_STORE,
        'doc',
        doc.project,
        doc.id,
        doc.title,
        ftsBody(buildTextForDoc(doc as never), doc.title),
      );
      insertFtsKey.run(DOC_STORE, 'doc', doc.project, doc.id, Number(info.lastInsertRowid));
    } catch {
      upsertFtsState.run(doc.project, 0, 1, isoNow());
    }
  }

  function removeIndexed(store: string, kind: 'task' | 'doc', project: string, id: string): void {
    try {
      dropIndexedRow(store, kind, project, id);
    } catch {
      upsertFtsState.run(project, 0, 1, isoNow());
    }
  }

  function clearProjectIndex(project: string): void {
    const keys = selectProjectKeys.all(project) as Array<{ rowid: number }>;
    for (const key of keys) deleteFtsByRowid.run(key.rowid);
    deleteProjectKeys.run(project);
  }

  function rebuildProjectIndex(project: string): void {
    const now = isoNow();
    upsertFtsState.run(project, 0, 0, now);
    clearProjectIndex(project);
    for (const task of readAllTasks(project)) indexTask(task);
    for (const doc of readAllDocs(project)) indexDoc(doc);
    upsertFtsState.run(project, 1, 0, isoNow());
  }

  function ftsQuery(query: string): string | null {
    const trimmed = query.trim();
    if (!trimmed) return null;
    // Quote every token: raw FTS5 syntax from a user query must not produce errors.
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    return tokens.map((token) => '"' + token.replace(/"/g, '') + '"').join(' OR ');
  }

  const search: SearchProvider = {
    available: () => {
      try {
        db.prepare("select count(*) as total from search_fts where search_fts match 'probe'").get();
        return true;
      } catch {
        return false;
      }
    },
    dirty: () => {
      const row = db.prepare('select count(*) as total from search_index_state where dirty = 1').get() as { total: number };
      return row.total > 0;
    },
    isIndexComplete: (project) => {
      const row = selectFtsState.get(project) as { complete: number; dirty: number } | undefined;
      return Boolean(row && row.complete === 1 && row.dirty === 0);
    },
    fillState: (project) => {
      if (!search.available()) return 'disabled';
      const row = selectFtsState.get(project) as { complete: number; dirty: number } | undefined;
      if (!row) return 'idle';
      if (row.dirty === 1) return 'error';
      return row.complete === 1 ? 'complete' : 'idle';
    },
    ensureIndexed: (project) => {
      rebuildProjectIndex(project);
    },
    candidates: ({ store, kind, project, query, limit }) => {
      const match = ftsQuery(query);
      if (!match) return [];
      try {
        const rows = db
          .prepare(
            'select id, project, bm25(search_fts) as score from search_fts where search_fts match ? and store = ? and kind = ? and project = ? order by bm25(search_fts) limit ?',
          )
          .all(match, store, kind, project, limit) as Array<{ id: string; project: string; score: number }>;
        return rows.map((row) => ({ id: row.id, project: row.project, score: -row.score }));
      } catch {
        return [];
      }
    },
    taskStoreId: () => TASK_STORE,
    docStoreId: () => DOC_STORE,
    countTasks: (project) => {
      const row = db.prepare('select count(*) as total from tasks where project = ?').get(project) as { total: number };
      return row.total;
    },
  };

  const vectors = createSqliteVectorStore({
    db,
    vecAvailable: options.vecAvailable ?? probeSqliteVec(db).vec.available,
  });

  const profile: StorageProfile = {
    manifest: {
      profile: 'sqlite',
      capabilities: {
        transactions: true,
        history: true,
        fullText: true,
        vectors: true,
        efficientListing: false,
      },
      roots: {},
      collections: ['tasks', 'docs', 'projects', 'history', 'prompts', 'memory', 'events', 'locks'],
    },
    tasks,
    docs,
    project: projectStore,
    // Y-05a3: prompts stay file-sourced (their wire shape carries a real path), memory classes
    // already take caller-provided paths — reusing them is honest; a native SQLite store for
    // either would be a separate ADR-sized change, not a silent reinterpretation.
    prompts: new FilePromptStore(),
    search,
    vectors,
    memory: new FileMemoryStore(),
    events: (storagePath: string) => eventLogFor(storagePath),
    history: historyProvider,
    locks,
    close: () => handle.close(),
  };
  if (options.embeddingProvider) {
    const manifestPath =
      options.indexingManifestPath ??
      (options.databasePath === ':memory:'
        ? undefined
        : path.join(path.dirname(options.databasePath), 'index-manifest.json'));
    profile.indexing = createFileIndexingService({
      store: vectors,
      chunker: createFileChunkingStrategy(),
      provider: options.embeddingProvider,
      manifestPath,
      externalPolicy: options.externalPolicy,
      collect: async (project: string) => [
        ...readAllTasks(project)
          .filter((task) => !task.archived && !task.trashed)
          .map((task) => ({
            store: 'tasks',
            kind: 'task' as const,
            project,
            id: task.id,
            text: buildTextForTask(task),
          })),
        ...readAllDocs(project)
          .filter((doc) => !doc.archived && !doc.trashed)
          .map((doc) => ({
            store: 'knowledge',
            kind: 'doc' as const,
            project,
            id: doc.id,
            text: buildTextForDoc(doc),
            trustLevel: doc.trustLevel,
          })),
      ],
    });
  }
  return profile;
}


