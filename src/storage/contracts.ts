/**
 * Y-02 (ADR-009) — storage contracts and the file profile.
 *
 * ADR-009 (`docs/adr/0009-pluggable-storage-and-embeddings.md`) fixes the profiles and the
 * interfaces behind them. This module is the first increment of Y-02: the contract for the two
 * biggest collections (tasks and knowledge documents) plus the file-profile implementation that
 * delegates to the current `src/storage/tasks.ts` / `src/storage/knowledge.ts`.
 *
 * Why a delegation layer instead of a rewrite: Y-02 must not change behaviour, wire format, file
 * layout or index schemas — the contract tests prove the new seam returns exactly what the old
 * functions return. Moving prompts, memory, project metadata, the event log, history and locks
 * behind the same seam is the rest of Y-02, and the call sites switch over to the profile in a
 * separate increment, so no single PR both introduces the seam and rewires the whole server.
 *
 * Contract rules from ADR-009 §"Общие правила контрактов" that are enforced here:
 *   1. the interface does not know `DATA_DIR` — the root is passed by the caller and checked
 *      against the configured one by the file profile (`assertRootMatchesConfig`);
 *   2. filesystem paths never appear in tool responses — this layer returns domain objects only;
 *   3. missing capability is an explicit `StoreError` (`CAPABILITY_UNAVAILABLE`), never a silent
 *      degradation;
 *   4. one contract test suite per profile (`tests/storage-contract.test.ts`);
 *   5. record identity in derived stores is `(store, kind, id)`; `project` + `id` is not identity.
 */

import type {
  KnowledgeDoc,
  KnowledgeDocMeta,
  Task,
  TaskClaim,
  TaskTreeNode,
  TrustLevel,
} from '../types.js';

/** ADR-009 §"Возможности профиля": what a profile promises, checked by the contract tests. */
export interface StoreCapabilities {
  /** Several records applied atomically with rollback. */
  transactions: boolean;
  /** The profile stores entity versions itself (file profile: `.versions` directory). */
  history: boolean;
  /** Full-text search without a full scan (file profile: derived FTS5 index). */
  fullText: boolean;
  /** Storing and querying vectors (file profile: on-disk cache, Y-03 splits it out). */
  vectors: boolean;
  /** Page and count without reading content (file profile: metadata index, SC-02). */
  efficientListing: boolean;
}

/** Profile manifest — read by diagnostics so a human sees what the profile really does. */
export interface StoreManifest {
  /** `file` for the files-and-git profile; `sqlite` / `postgres` later (Y-05, Y-06). */
  profile: string;
  capabilities: StoreCapabilities;
  /** Normalised storage roots this profile serves (`resolveStoreId`). */
  roots: {
    tasks?: string;
    knowledge?: string;
  };
  /** Collections this profile currently implements behind the contract. */
  collections: Array<'tasks' | 'docs'>;
}

export type StoreErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'CAPABILITY_UNAVAILABLE' | 'CONFIG_MISMATCH';

/** Domain error of the storage contract: never a bare "file does not exist". */
export class StoreError extends Error {
  readonly code: StoreErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: StoreErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
    if (details) this.details = details;
  }
}

// ─── Tasks ──────────────────────────────────────────────────────────────────

export interface TaskListFilter {
  project?: string;
  status?: string;
  type?: string;
  tag?: string;
  includeArchived?: boolean;
  includeTrashed?: boolean;
}

export interface TaskPageOptions {
  limit: number;
  cursor?: string | null;
  status?: string;
  tag?: string;
  priority?: string;
  parentId?: string;
  type?: string;
  /** ISO date: only tasks with `updatedAt >= value`. */
  updatedSince?: string;
  includeArchived?: boolean;
  includeTrashed?: boolean;
  countOnly?: boolean;
}

export interface TaskPage {
  items: Task[];
  keys: string[];
  total: number;
  totalExact: boolean;
  hasMore: boolean;
}

export interface CreateTaskInput {
  project: string;
  title: string;
  description?: string;
  priority?: Task['priority'];
  status?: string;
  type?: string;
  tags?: string[];
  links?: string[];
  parentId?: string;
}

export type TaskPatch = Partial<Omit<Task, 'id' | 'project' | 'createdAt'>>;

export interface ClaimActor {
  /** MCP session id of the caller. */
  sessionId: string;
  userId?: string;
  client?: string;
  ttlSec?: number;
}

export type ClaimTaskResult =
  | { status: 'claimed' | 'renewed'; task: Task; claim: TaskClaim }
  | { status: 'claimed_by_other'; claim: TaskClaim }
  | { status: 'not_found' };

export type RenewTaskResult =
  | { status: 'renewed'; task: Task; claim: TaskClaim }
  | { status: 'not_claimed' }
  | { status: 'claimed_by_other'; claim: TaskClaim }
  | { status: 'not_found' };

export type ReleaseTaskResult =
  | { status: 'released'; task: Task }
  | { status: 'not_claimed'; task: Task }
  | { status: 'claimed_by_other'; claim: TaskClaim }
  | { status: 'not_found' };

/** Task collection contract (ADR-009, интерфейс Store → задачи). */
export interface TaskStore {
  list(filter?: TaskListFilter): Promise<Task[]>;
  page(project: string, options: TaskPageOptions): Promise<TaskPage>;
  get(project: string, id: string): Promise<Task | null>;
  create(input: CreateTaskInput): Promise<Task>;
  update(project: string, id: string, patch: TaskPatch): Promise<Task | null>;
  close(project: string, id: string): Promise<Task | null>;
  archive(project: string, id: string): Promise<Task | null>;
  trash(project: string, id: string): Promise<Task | null>;
  restore(project: string, id: string): Promise<Task | null>;
  deletePermanent(project: string, id: string): Promise<boolean>;
  tree(filter?: TaskListFilter): Promise<TaskTreeNode[]>;
  claim(project: string, id: string, actor: ClaimActor): Promise<ClaimTaskResult>;
  renewClaim(project: string, id: string, actor: ClaimActor): Promise<RenewTaskResult>;
  releaseClaim(project: string, id: string, actor: ClaimActor): Promise<ReleaseTaskResult>;
}

// ─── Knowledge documents ────────────────────────────────────────────────────

export interface DocListFilter {
  project?: string;
  tag?: string;
  includeArchived?: boolean;
  includeTrashed?: boolean;
}

export interface DocPageOptions {
  limit: number;
  cursor?: string | null;
  tag?: string;
  type?: string;
  parentId?: string;
  includeArchived?: boolean;
  includeTrashed?: boolean;
  countOnly?: boolean;
}

export interface DocPage {
  items: KnowledgeDocMeta[];
  keys: string[];
  total: number;
  totalExact: boolean;
  hasMore: boolean;
}

export interface CreateDocInput {
  project: string;
  title: string;
  content: string;
  tags?: string[];
  source?: string;
  parentId?: string;
  type?: string;
  trustLevel?: TrustLevel;
}

export type DocPatch = Partial<Omit<KnowledgeDoc, 'id' | 'project' | 'createdAt'>>;

export interface DocVersionInfo {
  version: number;
  updatedAt: string;
  title?: string;
}

/** Knowledge collection contract (ADR-009, интерфейс Store → знания). */
export interface DocStore {
  list(filter?: DocListFilter): Promise<KnowledgeDocMeta[]>;
  page(project: string, options: DocPageOptions): Promise<DocPage>;
  read(project: string, id: string): Promise<KnowledgeDoc | null>;
  create(input: CreateDocInput): Promise<KnowledgeDoc>;
  update(project: string, id: string, patch: DocPatch): Promise<KnowledgeDoc | null>;
  archive(project: string, id: string): Promise<KnowledgeDoc | null>;
  trash(project: string, id: string): Promise<KnowledgeDoc | null>;
  restore(project: string, id: string): Promise<KnowledgeDoc | null>;
  deletePermanent(project: string, id: string): Promise<boolean>;
  versions(project: string, id: string): Promise<DocVersionInfo[]>;
  restoreVersion(project: string, id: string, version: number): Promise<KnowledgeDoc | null>;
}

/** What a profile exposes to `AppContainer` and, through it, to the tool modules. */
export interface StorageProfile {
  manifest: StoreManifest;
  tasks: TaskStore;
  docs: DocStore;
  close?(): void;
}
