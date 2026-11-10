/**
 * Y-06a1 — Postgres-профиль: Store-коллекции (задачи, документы, проекты, история, журнал, замки).
 *
 * Контракт тот же, что у файлового/SQLite-профилей; JSONB-документы хранят ровно те объекты, которые
 * отдают инструменты, поэтому wire-формат от профиля не зависит. Транзакции настоящие: замки берут
 * `pg_advisory_xact_lock` на выделенном соединении, поэтому сериализация работает между процессами.
 *
 * Ограничения, записанные в решении Y-06a1 (а не выданные за реализацию):
 * - `SearchProvider` в контракте синхронный, а `pg` — асинхронный; поиск (tsvector+pg_trgm) делается
 *   отдельным инкрементом Y-06a2 с честным async-адаптером/кэшем. Сейчас `fullText=false` и пустые
 *   кандидаты.
 * - `EventLogStore` тоже синхронный: журнал обслуживается write-behind кэшем (durable-вставка идёт
 *   следом), это зафиксировано в решении.
 * - `pgvector` в окружении нет — векторы остаются `CAPABILITY_UNAVAILABLE` до гейта Y-06b.
 * - Claims задач, как и в SQLite-профиле Y-05a1, объявлены недоступными (`CAPABILITY_UNAVAILABLE`).
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { StoreError } from '../../contracts.js';
import type {
  ClaimActor,
  ClaimTaskResult,
  CreateDocInput,
  CreateTaskInput,
  DocListFilter,
  DocPage,
  DocPageOptions,
  DocPatch,
  DocStore,
  DocVersionInfo,
  EntityEventEntry,
  EventLogStore,
  HistoryProvider,
  LockProvider,
  ProjectStore,
  ReleaseTaskResult,
  RenewTaskResult,
  SnapshotRecord,
  StorageProfile,
  TaskListFilter,
  TaskPage,
  TaskPageOptions,
  TaskPatch,
  TaskStore,
} from '../../contracts.js';
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
import { openPostgresDatabase, type PostgresDatabase } from './db.js';
import { buildTextForDoc, buildTextForTask } from '../../../search/index.js';
import type { SearchIndexFillState, SearchProvider } from '../../contracts.js';
import { FileMemoryStore, FilePromptStore } from '../file/index.js';
import { createFileBlobProvider } from '../../blobs/file-blob-provider.js';

export interface PostgresProfileOptions {
  /** libpq connection string, caller-provided (ADR-009 rule 1). */
  connectionString: string;
  maxConnections?: number;
  /** Root for the profile's local `blobs` collection; caller-provided. */
  blobsDir?: string;
  /** Test hook: skip `create extension pg_trgm` when the role cannot install it. */
  manageExtensions?: boolean;
}

function isoNow(): string {
  return new Date().toISOString();
}

function cleanObject<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) if (entry !== undefined) out[key] = entry;
  return out as T;
}

function docMeta(doc: KnowledgeDoc): KnowledgeDocMeta {
  const { content: _content, history: _history, ...rest } = doc as KnowledgeDoc & { history?: unknown };
  return rest as KnowledgeDocMeta;
}

function buildTaskTree(tasks: Task[]): TaskTreeNode[] {
  const nodes = new Map<string, TaskTreeNode>();
  for (const task of tasks) nodes.set(task.id, { ...task, children: [] });
  const roots: TaskTreeNode[] = [];
  for (const task of tasks) {
    const node = nodes.get(task.id)!;
    if (task.parentId && nodes.has(task.parentId)) nodes.get(task.parentId)!.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function descendantsOf(tasks: Task[], rootId: string): Task[] {
  const byParent = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.parentId) continue;
    const list = byParent.get(task.parentId) ?? [];
    list.push(task);
    byParent.set(task.parentId, list);
  }
  const out: Task[] = [];
  const walk = (id: string) => {
    for (const child of byParent.get(id) ?? []) {
      out.push(child);
      walk(child.id);
    }
  };
  walk(rootId);
  return out;
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

export async function createPostgresProfile(options: PostgresProfileOptions): Promise<StorageProfile> {
  if (!options.connectionString.trim()) {
    throw new StoreError('CONFIG_MISMATCH', 'postgres profile requires POSTGRES_URL', {
      hint: 'export POSTGRES_URL=postgres://user:pass@host:5432/db',
    });
  }
  const database: PostgresDatabase = await openPostgresDatabase({
    connectionString: options.connectionString,
    maxConnections: options.maxConnections,
    manageExtensions: options.manageExtensions,
  });
  const { pool } = database;

  // ─── tasks ───────────────────────────────────────────────────────────────
  async function readTask(project: string, id: string): Promise<Task | null> {
    const result = await pool.query('select data from tasks where project = $1 and id = $2', [project, id]);
    return result.rows[0] ? (result.rows[0].data as Task) : null;
  }

  async function writeTask(task: Task): Promise<Task> {
    await pool.query(
      `insert into tasks(project, id, data, archived, trashed, updated_at) values($1,$2,$3,$4,$5,now())
       on conflict(project, id) do update set data = excluded.data, archived = excluded.archived,
         trashed = excluded.trashed, updated_at = now()`,
      [task.project, task.id, JSON.stringify(task), Boolean(task.archived), Boolean(task.trashed)],
    );
    void indexTaskRow(task);
    return task;
  }

  async function patchTask(project: string, id: string, patch: Record<string, unknown>): Promise<Task | null> {
    const current = await readTask(project, id);
    if (!current) return null;
    const next = { ...current, ...patch, id, project, updatedAt: isoNow() } as Task;
    return writeTask(next);
  }

  async function listTasks(filter?: TaskListFilter): Promise<Task[]> {
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (filter?.project) {
      params.push(filter.project);
      clauses.push(`project = $${params.length}`);
    }
    if (filter?.status) {
      params.push(filter.status);
      clauses.push(`data->>'status' = $${params.length}`);
    }
    if (filter?.type) {
      params.push(filter.type);
      clauses.push(`data->>'type' = $${params.length}`);
    }
    if (filter?.tag) {
      params.push(filter.tag);
      clauses.push(`data->'tags' ? $${params.length}`);
    }
    if (!filter?.includeArchived) clauses.push('archived = false');
    if (!filter?.includeTrashed) clauses.push('trashed = false');
    const where = clauses.length > 0 ? `where ${clauses.join(' and ')}` : '';
    const result = await pool.query(`select data from tasks ${where} order by data->>'id' asc`, params);
    return result.rows.map((row) => row.data as Task);
  }

  async function pageTasks(project: string, options: TaskPageOptions): Promise<TaskPage> {
    const params: unknown[] = [project];
    const clauses = ['project = $1'];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      clauses.push(sql.replace('?', `$${params.length}`));
    };
    if (options.status) add("data->>'status' = ?", options.status);
    if (options.type) add("data->>'type' = ?", options.type);
    if (options.priority) add("data->>'priority' = ?", options.priority);
    if (options.parentId) add("data->>'parentId' = ?", options.parentId);
    if (options.tag) add("data->'tags' ? ?", options.tag);
    if (options.updatedSince) add('updated_at >= ?', options.updatedSince);
    if (!options.includeArchived) clauses.push('archived = false');
    if (!options.includeTrashed) clauses.push('trashed = false');
    const where = `where ${clauses.join(' and ')}`;
    const count = await pool.query(`select count(*)::int as total from tasks ${where}`, params);
    if (options.countOnly) {
      return { items: [], keys: [], total: count.rows[0].total, totalExact: true, hasMore: false };
    }
    const queryParams = [...params];
    let sql = `select data from tasks ${where}`;
    if (options.cursor) {
      queryParams.push(options.cursor);
      sql += ` and data->>'id' > $${queryParams.length}`;
    }
    queryParams.push(options.limit);
    sql += ` order by data->>'id' asc limit $${queryParams.length}`;
    const result = await pool.query(sql, queryParams);
    const items = result.rows.map((row) => row.data as Task);
    return {
      items,
      keys: items.map((task) => task.id),
      total: count.rows[0].total,
      totalExact: true,
      hasMore: items.length === options.limit && items.length < count.rows[0].total,
    };
  }

  const tasks: TaskStore = {
    list: (filter) => listTasks(filter),
    page: (project, pageOptions) => pageTasks(project, pageOptions),
    get: (project, id) => readTask(project, id),
    async create(input: CreateTaskInput): Promise<Task> {
      const now = isoNow();
      const task: Task = cleanObject({
        id: randomUUID(),
        project: input.project,
        title: input.title,
        description: input.description,
        status: input.status ?? 'todo',
        type: input.type,
        priority: input.priority ?? 'medium',
        tags: input.tags ?? [],
        links: input.links ?? [],
        createdAt: now,
        updatedAt: now,
        parentId: input.parentId,
        archived: false,
        trashed: false,
      }) as Task;
      return writeTask(task);
    },
    update: (project, id, patch: TaskPatch) => patchTask(project, id, patch as Record<string, unknown>),
    close: (project, id) => patchTask(project, id, { status: 'done' }),
    archive: (project, id) => patchTask(project, id, { archived: true, archivedAt: isoNow() }),
    trash: (project, id) => patchTask(project, id, { trashed: true, trashedAt: isoNow() }),
    async restore(project, id) {
      const current = await readTask(project, id);
      if (!current) return null;
      const { archived: _archived, trashed: _trashed, archivedAt: _archivedAt, trashedAt: _trashedAt, ...rest } = current;
      return patchTask(project, id, { ...rest, archived: false, trashed: false });
    },
    async deletePermanent(project, id) {
      const result = await pool.query('delete from tasks where project = $1 and id = $2', [project, id]);
      await deleteSearchRow(TASK_SEARCH_STORE, 'task', project, id);
      await refreshTaskCount(project);
      return (result.rowCount ?? 0) > 0;
    },
    async tree(filter) {
      return buildTaskTree(await listTasks(filter));
    },
    async closeWithCascade(project, id, cascade = false) {
      const all = await listTasks({ project, includeArchived: true, includeTrashed: true });
      if (!all.some((task) => task.id === id)) return { root: null, cascaded: [] };
      const root = await patchTask(project, id, { status: 'done' });
      const cascaded: Task[] = [];
      if (cascade) {
        for (const child of descendantsOf(all, id)) {
          const updated = await patchTask(child.project, child.id, { status: 'done' });
          if (updated) cascaded.push(updated);
        }
      }
      return { root, cascaded };
    },
    async subtree(project, rootId) {
      const tree = buildTaskTree(await listTasks({ project, includeArchived: true, includeTrashed: true }));
      const find = (nodes: TaskTreeNode[]): TaskTreeNode | null => {
        for (const node of nodes) {
          if (node.id === rootId) return node;
          const nested = find(node.children);
          if (nested) return nested;
        }
        return null;
      };
      return find(tree);
    },
    async children(project, parentId) {
      const result = await pool.query("select data from tasks where project = $1 and data->>'parentId' = $2 order by data->>'id' asc", [
        project,
        parentId,
      ]);
      return result.rows.map((row) => row.data as Task);
    },
    claim: unavailableClaim('claim'),
    renewClaim: unavailableClaim('renewClaim'),
    releaseClaim: unavailableClaim('releaseClaim'),
  };

  // ─── docs ────────────────────────────────────────────────────────────────
  async function readDoc(project: string, id: string): Promise<KnowledgeDoc | null> {
    const result = await pool.query('select data from docs where project = $1 and id = $2', [project, id]);
    return result.rows[0] ? (result.rows[0].data as KnowledgeDoc) : null;
  }

  async function writeDoc(doc: KnowledgeDoc, recordVersion = true): Promise<KnowledgeDoc> {
    await pool.query(
      `insert into docs(project, id, data, archived, trashed, updated_at) values($1,$2,$3,$4,$5,now())
       on conflict(project, id) do update set data = excluded.data, archived = excluded.archived,
         trashed = excluded.trashed, updated_at = now()`,
      [doc.project, doc.id, JSON.stringify(doc), Boolean(doc.archived), Boolean(doc.trashed)],
    );
    void indexDocRow(doc);
    if (recordVersion) {
      await pool.query('insert into doc_versions(project, id, version, data) values($1,$2,$3,$4) on conflict do nothing', [
        doc.project,
        doc.id,
        doc.version ?? 1,
        JSON.stringify(doc),
      ]);
    }
    return doc;
  }

  async function patchDoc(project: string, id: string, patch: Record<string, unknown>): Promise<KnowledgeDoc | null> {
    const current = await readDoc(project, id);
    if (!current) return null;
    const version = (current.version ?? 1) + 1;
    const next = { ...current, ...patch, id, project, version, updatedAt: isoNow() } as KnowledgeDoc;
    return writeDoc(next);
  }

  async function listDocs(filter?: DocListFilter): Promise<KnowledgeDocMeta[]> {
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (filter?.project) {
      params.push(filter.project);
      clauses.push(`project = $${params.length}`);
    }
    if (filter?.tag) {
      params.push(filter.tag);
      clauses.push(`data->'tags' ? $${params.length}`);
    }
    if (!filter?.includeArchived) clauses.push('archived = false');
    if (!filter?.includeTrashed) clauses.push('trashed = false');
    const where = clauses.length > 0 ? `where ${clauses.join(' and ')}` : '';
    const result = await pool.query(`select data from docs ${where} order by data->>'id' asc`, params);
    return result.rows.map((row) => docMeta(row.data as KnowledgeDoc));
  }

  async function pageDocs(project: string, options: DocPageOptions): Promise<DocPage> {
    const params: unknown[] = [project];
    const clauses = ['project = $1'];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      clauses.push(sql.replace('?', `$${params.length}`));
    };
    if (options.tag) add("data->'tags' ? ?", options.tag);
    if (options.type) add("data->>'type' = ?", options.type);
    if (options.parentId) add("data->>'parentId' = ?", options.parentId);
    if (!options.includeArchived) clauses.push('archived = false');
    if (!options.includeTrashed) clauses.push('trashed = false');
    const where = `where ${clauses.join(' and ')}`;
    const count = await pool.query(`select count(*)::int as total from docs ${where}`, params);
    if (options.countOnly) {
      return { items: [], keys: [], total: count.rows[0].total, totalExact: true, hasMore: false };
    }
    const queryParams = [...params];
    let sql = `select data from docs ${where}`;
    if (options.cursor) {
      queryParams.push(options.cursor);
      sql += ` and data->>'id' > $${queryParams.length}`;
    }
    queryParams.push(options.limit);
    sql += ` order by data->>'id' asc limit $${queryParams.length}`;
    const result = await pool.query(sql, queryParams);
    const items = result.rows.map((row) => docMeta(row.data as KnowledgeDoc));
    return {
      items,
      keys: items.map((item) => item.id),
      total: count.rows[0].total,
      totalExact: true,
      hasMore: items.length === options.limit && items.length < count.rows[0].total,
    };
  }

  const docs: DocStore = {
    list: (filter) => listDocs(filter),
    page: (project, options) => pageDocs(project, options),
    read: (project, id) => readDoc(project, id),
    async create(input: CreateDocInput): Promise<KnowledgeDoc> {
      const now = isoNow();
      const doc: KnowledgeDoc = cleanObject({
        id: randomUUID(),
        project: input.project,
        title: input.title,
        content: input.content,
        tags: input.tags ?? [],
        source: input.source,
        parentId: input.parentId,
        type: input.type,
        trustLevel: input.trustLevel,
        createdAt: now,
        updatedAt: now,
        archived: false,
        trashed: false,
        version: 1,
      }) as KnowledgeDoc;
      return writeDoc(doc);
    },
    update: (project, id, patch: DocPatch) => patchDoc(project, id, patch as Record<string, unknown>),
    archive: (project, id) => patchDoc(project, id, { archived: true, archivedAt: isoNow() }),
    trash: (project, id) => patchDoc(project, id, { trashed: true, trashedAt: isoNow() }),
    async restore(project, id) {
      const current = await readDoc(project, id);
      if (!current) return null;
      const { archived: _archived, trashed: _trashed, archivedAt: _archivedAt, trashedAt: _trashedAt, ...rest } = current;
      return patchDoc(project, id, { ...rest, archived: false, trashed: false });
    },
    async deletePermanent(project, id) {
      const result = await pool.query('delete from docs where project = $1 and id = $2', [project, id]);
      await pool.query('delete from doc_versions where project = $1 and id = $2', [project, id]);
      await deleteSearchRow(DOC_SEARCH_STORE, 'doc', project, id);
      return (result.rowCount ?? 0) > 0;
    },
    async versions(project, id) {
      const result = await pool.query('select version, data from doc_versions where project = $1 and id = $2 order by version asc', [project, id]);
      return result.rows.map((row) => ({
        version: row.version as number,
        updatedAt: (row.data as KnowledgeDoc).updatedAt,
        title: (row.data as KnowledgeDoc).title,
      }));
    },
    async restoreVersion(project, id, version) {
      const result = await pool.query('select data from doc_versions where project = $1 and id = $2 and version = $3', [project, id, version]);
      if (!result.rows[0]) return null;
      return patchDoc(project, id, result.rows[0].data as Record<string, unknown>);
    },
  };

  // ─── search (Y-06a2: tsvector + pg_trgm) ─────────────────────────────────
  const TASK_SEARCH_STORE = 'postgres:tasks';
  const DOC_SEARCH_STORE = 'postgres:docs';
  interface SearchStateEntry {
    complete: boolean;
    running: boolean;
    dirty: boolean;
  }
  const searchStates = new Map<string, SearchStateEntry>();
  const taskCounts = new Map<string, number>();

  async function setSearchState(project: string, state: SearchStateEntry): Promise<void> {
    searchStates.set(project, state);
    await pool.query(
      `insert into search_state(project, complete, dirty, updated_at) values($1,$2,$3,now())
       on conflict(project) do update set complete = excluded.complete, dirty = excluded.dirty, updated_at = now()`,
      [project, state.complete, state.dirty],
    );
  }

  async function upsertSearchRow(
    storeId: string,
    kind: 'task' | 'doc',
    project: string,
    id: string,
    title: string,
    body: string,
  ): Promise<void> {
    await pool.query(
      `insert into search_index(store, kind, project, id, title, body) values($1,$2,$3,$4,$5,$6)
       on conflict(store, kind, project, id) do update set title = excluded.title, body = excluded.body`,
      [storeId, kind, project, id, title, body],
    );
  }

  async function deleteSearchRow(storeId: string, kind: 'task' | 'doc', project: string, id: string): Promise<void> {
    await pool.query('delete from search_index where store = $1 and kind = $2 and project = $3 and id = $4', [
      storeId,
      kind,
      project,
      id,
    ]);
  }

  async function refreshTaskCount(project: string): Promise<void> {
    const result = await pool.query(
      'select count(*)::int as total from tasks where project = $1 and archived = false and trashed = false',
      [project],
    );
    taskCounts.set(project, result.rows[0].total as number);
  }

  async function indexTaskRow(task: Task): Promise<void> {
    try {
      if (task.archived || task.trashed) await deleteSearchRow(TASK_SEARCH_STORE, 'task', task.project, task.id);
      else await upsertSearchRow(TASK_SEARCH_STORE, 'task', task.project, task.id, task.title, buildTextForTask(task));
      await refreshTaskCount(task.project);
    } catch {
      searchStates.set(task.project, {
        ...(searchStates.get(task.project) ?? { complete: false, running: false, dirty: false }),
        dirty: true,
      });
    }
  }

  async function indexDocRow(doc: KnowledgeDoc): Promise<void> {
    try {
      if (doc.archived || doc.trashed) await deleteSearchRow(DOC_SEARCH_STORE, 'doc', doc.project, doc.id);
      else await upsertSearchRow(DOC_SEARCH_STORE, 'doc', doc.project, doc.id, doc.title, buildTextForDoc(doc));
    } catch {
      searchStates.set(doc.project, {
        ...(searchStates.get(doc.project) ?? { complete: false, running: false, dirty: false }),
        dirty: true,
      });
    }
  }

  async function rebuildProjectSearch(project: string): Promise<void> {
    const current = searchStates.get(project);
    if (current?.running) return;
    searchStates.set(project, { complete: false, running: true, dirty: false });
    try {
      await setSearchState(project, { complete: false, running: true, dirty: false });
      const [projectTasks, projectDocs] = await Promise.all([
        listTasks({ project, includeArchived: true, includeTrashed: true }),
        listDocs({ project, includeArchived: true, includeTrashed: true }),
      ]);
      await pool.query('delete from search_index where project = $1 and store in ($2, $3)', [
        project,
        TASK_SEARCH_STORE,
        DOC_SEARCH_STORE,
      ]);
      let liveTasks = 0;
      for (const task of projectTasks as Task[]) {
        if (task.archived || task.trashed) continue;
        liveTasks += 1;
        await upsertSearchRow(TASK_SEARCH_STORE, 'task', project, task.id, task.title, buildTextForTask(task));
      }
      for (const meta of projectDocs as KnowledgeDocMeta[]) {
        if (meta.archived || meta.trashed) continue;
        const doc = await readDoc(meta.project, meta.id);
        if (doc) await upsertSearchRow(DOC_SEARCH_STORE, 'doc', project, doc.id, doc.title, buildTextForDoc(doc));
      }
      taskCounts.set(project, liveTasks);
      searchStates.set(project, { complete: true, running: false, dirty: false });
      await setSearchState(project, { complete: true, running: false, dirty: false });
    } catch {
      searchStates.set(project, { complete: false, running: false, dirty: true });
      await setSearchState(project, { complete: false, running: false, dirty: true }).catch(() => undefined);
    }
  }

  async function searchCandidates(input: {
    store: string;
    kind: 'task' | 'doc';
    project: string;
    query: string;
    limit: number;
  }): Promise<Array<{ id: string; project: string; score: number }>> {
    const trgm = database.trgm;
    const similarity = trgm ? "similarity(title || ' ' || body, $1)" : '0';
    const fallback = trgm ? "or similarity(title || ' ' || body, $1) > 0.15" : '';
    const result = await pool.query(
      `with query as (select plainto_tsquery('simple', $1) as tsq)
       select id, project, ts_rank(tsv, query.tsq) as rank, ${similarity} as sim
       from search_index, query
       where store = $2 and kind = $3 and project = $4
         and (tsv @@ query.tsq ${fallback})
       order by (ts_rank(tsv, query.tsq) + 0.5 * (${similarity})) desc, id asc
       limit $5`,
      [input.query, input.store, input.kind, input.project, input.limit],
    );
    return result.rows.map((row) => ({
      id: row.id as string,
      project: row.project as string,
      score: Number(row.rank) + 0.5 * Number(row.sim),
    }));
  }

  const search: SearchProvider = {
    available: () => true,
    dirty: () => [...searchStates.values()].some((state) => state.dirty),
    isIndexComplete: (project) => Boolean(searchStates.get(project)?.complete),
    fillState: (project): SearchIndexFillState => {
      const state = searchStates.get(project);
      if (!state) return 'idle';
      if (state.running) return 'running';
      if (state.dirty) return 'error';
      return state.complete ? 'complete' : 'idle';
    },
    ensureIndexed: (project) => {
      if (searchStates.get(project)?.running) return;
      void rebuildProjectSearch(project);
    },
    // The synchronous facade cannot query Postgres; the registrar prefers candidatesAsync below.
    candidates: () => [],
    candidatesAsync: (input) => searchCandidates(input),
    taskStoreId: () => TASK_SEARCH_STORE,
    docStoreId: () => DOC_SEARCH_STORE,
    countTasks: (project) => taskCounts.get(project),
  };

  // ─── projects and history ────────────────────────────────────────────────
  async function readProjectMetadata(projectId: string): Promise<ProjectMetadata | null> {
    const result = await pool.query('select data from projects where project = $1', [projectId]);
    return result.rows[0] ? (result.rows[0].data as ProjectMetadata) : null;
  }

  async function projectInfo(project: string, metadata: ProjectMetadata | null, current: string): Promise<ProjectInfo> {
    const counts = await pool.query(
      `select
         (select count(*)::int from tasks where project = $1) as tasks,
         (select count(*)::int from docs where project = $1) as docs`,
      [project],
    );
    return {
      id: project,
      isDefault: project === DEFAULT_PROJECT,
      isCurrent: project === current,
      paths: { tasks: '', knowledge: '' },
      hasTasks: counts.rows[0].tasks > 0,
      hasKnowledge: counts.rows[0].docs > 0,
      taskCount: counts.rows[0].tasks,
      knowledgeCount: counts.rows[0].docs,
      ...(metadata?.description === undefined ? {} : { description: metadata.description }),
      ...(metadata?.createdAt === undefined ? {} : { createdAt: metadata.createdAt }),
    } as ProjectInfo;
  }

  const projectStore: ProjectStore = {
    async list(getCurrent) {
      const current = getCurrent();
      const result = await pool.query('select project, data from projects order by project asc');
      return Promise.all(result.rows.map((row) => projectInfo(row.project as string, row.data as ProjectMetadata, current)));
    },
    async detail(projectId, getCurrent) {
      const metadata = await readProjectMetadata(projectId);
      if (!metadata) return null;
      const info = await projectInfo(projectId, metadata, getCurrent());
      const projectTasks = (await listTasks({ project: projectId })) as Task[];
      const projectDocs = (await listDocs({ project: projectId })) as KnowledgeDocMeta[];
      const byStatus: Record<string, number> = {};
      const byPriority: Record<string, number> = {};
      for (const task of projectTasks) {
        byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
        byPriority[task.priority] = (byPriority[task.priority] ?? 0) + 1;
      }
      const byType: Record<string, number> = {};
      for (const doc of projectDocs) byType[doc.type ?? 'unknown'] = (byType[doc.type ?? 'unknown'] ?? 0) + 1;
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
      } as ProjectDetail;
    },
    async create(projectId, description) {
      if (!isValidProjectId(projectId)) throw new StoreError('CONFLICT', `invalid project id '${projectId}'`);
      if (await readProjectMetadata(projectId)) throw new StoreError('CONFLICT', `project ${projectId} already exists`);
      const now = isoNow();
      const metadata = cleanObject({ description, createdAt: now, updatedAt: now }) as ProjectMetadata;
      await pool.query('insert into projects(project, data, updated_at) values($1,$2,now())', [projectId, JSON.stringify(metadata)]);
      return projectInfo(projectId, metadata, projectId);
    },
    async remove(projectId, force) {
      if (!(await readProjectMetadata(projectId))) return { deleted: false, message: `project ${projectId} does not exist` };
      const counts = await pool.query(
        'select (select count(*)::int from tasks where project=$1) as tasks, (select count(*)::int from docs where project=$1) as docs',
        [projectId],
      );
      const taskCount = counts.rows[0].tasks as number;
      const docCount = counts.rows[0].docs as number;
      if (!force && (taskCount > 0 || docCount > 0)) {
        return { deleted: false, message: `project ${projectId} still has ${taskCount} tasks and ${docCount} documents (use force)` };
      }
      await pool.query('delete from tasks where project = $1', [projectId]);
      await pool.query('delete from docs where project = $1', [projectId]);
      await pool.query('delete from doc_versions where project = $1', [projectId]);
      await pool.query('delete from search_index where project = $1', [projectId]);
      await pool.query('delete from search_state where project = $1', [projectId]);
      taskCounts.delete(projectId);
      searchStates.delete(projectId);
      const result = await pool.query('delete from projects where project = $1', [projectId]);
      return { deleted: (result.rowCount ?? 0) > 0, message: `project ${projectId} deleted` };
    },
    readMetadata: (projectId) => readProjectMetadata(projectId),
    async updateMetadata(projectId, updates) {
      const existing = await readProjectMetadata(projectId);
      if (!existing) return null;
      const merged = cleanObject({
        ...existing,
        ...(updates as Partial<ProjectMetadata>),
        createdAt: existing.createdAt,
        updatedAt: isoNow(),
      }) as ProjectMetadata;
      await pool.query('update projects set data = $2, updated_at = now() where project = $1', [projectId, JSON.stringify(merged)]);
      return merged;
    },
    async workflow(project) {
      return workflowFor(await readProjectMetadata(project));
    },
  };

  const historyProvider: HistoryProvider = {
    async list(project, kind, id) {
      if (kind === 'task') {
        throw new StoreError('CAPABILITY_UNAVAILABLE', 'The postgres profile has no task history', { capability: 'history', kind });
      }
      return docs.versions(project, id);
    },
    async restore(project, kind, id, version) {
      if (kind === 'task') {
        throw new StoreError('CAPABILITY_UNAVAILABLE', 'The postgres profile has no task history', { capability: 'history', kind });
      }
      return docs.restoreVersion(project, id, version);
    },
  };

  // ─── event log (write-behind) / locks ────────────────────────────────────
  const events = (storagePath: string): EventLogStore => new PostgresEventLog(pool, storagePath);

  const locks: LockProvider = {
    async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
      // Advisory transaction lock: correct across processes, released on commit/rollback.
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
        const result = await fn();
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };

  const prompts = new FilePromptStore();
  const memory = new FileMemoryStore();
  const blobs = createFileBlobProvider({ root: options.blobsDir ?? path.join(process.cwd(), '.postgres-blobs') });

  const profile: StorageProfile = {
    manifest: {
      profile: 'postgres',
      capabilities: { transactions: true, history: true, fullText: true, vectors: false, efficientListing: true },
      roots: {},
      collections: ['tasks', 'docs', 'projects', 'prompts', 'memory', 'events', 'history', 'locks', 'blobs'],
    },
    tasks,
    docs,
    project: projectStore,
    prompts,
    search,
    vectors: {
      upsert: () => Promise.reject(new StoreError('CAPABILITY_UNAVAILABLE', 'Postgres vectors require pgvector (Y-06b)', { capability: 'vectors' })),
      delete: () => Promise.reject(new StoreError('CAPABILITY_UNAVAILABLE', 'Postgres vectors require pgvector (Y-06b)', { capability: 'vectors' })),
      query: () => Promise.reject(new StoreError('CAPABILITY_UNAVAILABLE', 'Postgres vectors require pgvector (Y-06b)', { capability: 'vectors' })),
      stats: () => Promise.resolve({ collections: {}, total: 0 }),
      clear: () => Promise.reject(new StoreError('CAPABILITY_UNAVAILABLE', 'Postgres vectors require pgvector (Y-06b)', { capability: 'vectors' })),
    },
    blobs,
    memory,
    events,
    history: historyProvider,
    locks,
    close: () => {
      void database.close();
    },
  };
  return profile;
}

function unavailableClaim<K extends 'claim' | 'renewClaim' | 'releaseClaim'>(method: K): TaskStore[K] {
  return (() => {
    throw new StoreError('CAPABILITY_UNAVAILABLE', `The postgres profile does not implement ${method} yet`, {
      capability: 'claims',
      method,
    });
  }) as TaskStore[K];
}

/**
 * Synchronous `EventLogStore` over an asynchronous Postgres pool.
 *
 * The contract is synchronous (file/SQLite drivers), so Postgres keeps the log in memory and persists
 * appends/deletes write-behind. Callers see durable-in-process semantics immediately; `flush()` exists
 * for tests/close so the persistence is observable instead of implicit. This mismatch is recorded in
 * the Y-06a1 decision as a design gap that needs an async event-log contract.
 */
export class PostgresEventLog implements EventLogStore {
  private entries: EntityEventEntry[] = [];
  private snapshotsById = new Map<string, SnapshotRecord>();
  private loaded: Promise<void>;
  private pending: Promise<unknown> = Promise.resolve();
  private nextEventId = 1;

  constructor(
    private readonly pool: PostgresDatabase['pool'],
    private readonly logPath: string,
  ) {
    this.loaded = this.load();
  }

  private async load(): Promise<void> {
    const events = await this.pool.query('select id, data from events where path = $1 order by id asc', [this.logPath]);
    const fromDatabase = events.rows.map((row) => row.data as EntityEventEntry);
    const merged = new Map<number, EntityEventEntry>();
    for (const entry of fromDatabase) merged.set(entry.eventId, entry);
    for (const entry of this.entries) merged.set(entry.eventId, entry);
    this.entries = [...merged.values()].sort((a, b) => a.eventId - b.eventId);
    this.nextEventId = (this.entries.at(-1)?.eventId ?? 0) + 1;
    const snapshots = await this.pool.query('select entity_id, data from snapshots where path = $1', [this.logPath]);
    for (const row of snapshots.rows) {
      const record = row.data as SnapshotRecord;
      const existing = this.snapshotsById.get(row.entity_id as string);
      if (!existing || existing.lastEventId <= record.lastEventId) this.snapshotsById.set(row.entity_id as string, record);
    }
  }

  private persist(fn: () => Promise<unknown>): void {
    this.pending = this.pending.then(fn).catch(() => undefined);
  }

  async flush(): Promise<void> {
    await this.loaded;
    await this.pending;
  }

  append(
    entityId: string,
    entityType: 'task' | 'knowledge',
    operation: 'create' | 'update' | 'delete',
    snapshot: Record<string, unknown> | null,
    version: number,
  ): EntityEventEntry {
    const eventId = this.nextEventId;
    const entry: EntityEventEntry = {
      eventId,
      entityId,
      entityType,
      operation,
      snapshot,
      timestamp: isoNow(),
      version,
    };
    this.nextEventId = eventId + 1;
    this.entries.push(entry);
    const record: SnapshotRecord = { entityId, entityType, state: snapshot, lastEventId: eventId, timestamp: entry.timestamp };
    this.snapshotsById.set(entityId, record);
    this.persist(async () => {
      await this.pool.query('insert into events(path, id, data) values($1,$2,$3)', [this.logPath, eventId, JSON.stringify(entry)]);
      await this.pool.query(
        `insert into snapshots(path, entity_id, data) values($1,$2,$3)
         on conflict(path, entity_id) do update set data = excluded.data`,
        [this.logPath, entityId, JSON.stringify(record)],
      );
    });
    return entry;
  }

  since(eventId: number, limit?: number): EntityEventEntry[] {
    const filtered = this.entries.filter((entry) => entry.eventId > eventId);
    return limit === undefined ? filtered : filtered.slice(0, limit);
  }

  snapshot(entityId: string): SnapshotRecord | undefined {
    return this.snapshotsById.get(entityId);
  }

  snapshots(): SnapshotRecord[] {
    return [...this.snapshotsById.values()];
  }

  compact(): { compacted: number; remaining: number } {
    const lastEventId = Math.max(0, ...[...this.snapshotsById.values()].map((snapshot) => snapshot.lastEventId));
    const before = this.entries.length;
    this.entries = this.entries.filter((entry) => entry.eventId > lastEventId);
    const removed = before - this.entries.length;
    this.persist(async () => {
      await this.pool.query('delete from events where path = $1 and id <= $2', [this.logPath, lastEventId]);
    });
    return { compacted: removed, remaining: this.entries.length };
  }
}
