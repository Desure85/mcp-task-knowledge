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
// Domain types of the modules this contract abstracts. Both are wire-visible shapes today, and
// duplicating them here would let the contract and the tools drift apart.
import type { ProjectDetail, ProjectInfo, ProjectMetadata, ProjectMetaUpdates } from '../projects.js';
import type { ProjectWorkflow } from '../workflow.js';
import type {
  AddFactInput,
  FactRelationType,
  TemporalFact,
  TemporalQuery,
} from '../memory/temporal-graph.js';
import type { DynamicFact, ProfileUpdateInput, UserProfile } from '../memory/user-profile.js';
import type { LayeredFact, LayeredMemoryOptions, MemoryLayer } from '../memory/layers.js';
import type { SessionDecision, SessionMemoryOptions, SessionRecord } from '../memory/session-memory.js';

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
  collections: Array<'tasks' | 'docs' | 'projects' | 'prompts' | 'memory' | 'events' | 'history' | 'locks'>;
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

// ─── Project metadata (Y-02b) ───────────────────────────────────────────────

/**
 * Project metadata and workflow behind the contract. The returned shapes are the current ones —
 * Y-02 changes the access seam, not the wire format, so `paths` stays until a separate
 * wire-contract change removes filesystem paths from tool responses (ADR-009 rule 2 is a target,
 * not something this increment may silently change).
 */
export interface ProjectStore {
  list(getCurrent: () => string): Promise<ProjectInfo[]>;
  detail(projectId: string, getCurrent: () => string): Promise<ProjectDetail | null>;
  create(projectId: string, description?: string): Promise<ProjectInfo>;
  remove(projectId: string, force: boolean): Promise<{ deleted: boolean; message: string }>;
  readMetadata(projectId: string): Promise<ProjectMetadata | null>;
  updateMetadata(projectId: string, updates: ProjectMetaUpdates): Promise<ProjectMetadata | null>;
  workflow(project: string): Promise<ProjectWorkflow>;
}

// ─── Event log (Y-02b) ──────────────────────────────────────────────────────

export interface EntityEventEntry {
  eventId: number;
  entityId: string;
  entityType: 'task' | 'knowledge';
  operation: 'create' | 'update' | 'delete';
  snapshot: Record<string, unknown> | null;
  timestamp: string;
  version: number;
}

export interface SnapshotRecord {
  entityId: string;
  entityType: 'task' | 'knowledge';
  state: Record<string, unknown> | null;
  lastEventId: number;
  timestamp: string;
}

/**
 * Event log over the profile. The file profile keeps it in `storagePath` (a directory the caller
 * passes, ADR-009 rule 1) and rewrites it atomically per append; SQLite/Postgres profiles will keep\n * it in a table.
 */
export interface EventLogStore {
  append(
    entityId: string,
    entityType: 'task' | 'knowledge',
    operation: 'create' | 'update' | 'delete',
    snapshot: Record<string, unknown> | null,
    version: number,
  ): EntityEventEntry;
  since(eventId: number, limit?: number): EntityEventEntry[];
  snapshot(entityId: string): SnapshotRecord | undefined;
  snapshots(): SnapshotRecord[];
  compact(): { compacted: number; remaining: number };
}

// ─── History and locks (Y-02b) ──────────────────────────────────────────────

/** Entities whose versions the profile can expose. The file profile has document versions only. */
export type HistoryKind = 'doc' | 'task';

/**
 * Versions of an entity. The file profile stores document snapshots in `.versions` (TD-005);
 * task history is git's business (stage R) and is not exposed here — asking for it must raise
 * `CAPABILITY_UNAVAILABLE`, never return an empty list that looks like "no versions".
 */
export interface HistoryProvider {
  list(project: string, kind: HistoryKind, id: string): Promise<DocVersionInfo[]>;
  restore(project: string, kind: HistoryKind, id: string, version: number): Promise<KnowledgeDoc | null>;
}

/** Critical sections and exclusive access. */
export interface LockProvider {
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

// ─── Prompts (Y-02c) ────────────────────────────────────────────────────────

export interface PromptVersionRef {
  version: string;
  path: string;
  latest: boolean;
}

export interface PromptSourceFile {
  id: string;
  version: string;
  /** `metadata.kind` of the source item (`prompt`, `rule`, `workflow`, …); defaults to `prompt`. */
  kind: string;
  path: string;
}

export interface PromptRecord extends PromptSourceFile {
  data: Record<string, unknown>;
}

/**
 * Prompt storage. Sources are one JSON file per id+version under `PROMPTS_DIR/<project>/`
 * (`prompts`, `rules`, `workflows`, `templates`, `policies`); the generated catalog and build
 * artifacts are read through the same contract. Writing prompts stays in the tools until the
 * registrar moves onto the profile (Y-02d) — this increment must not change how files are named
 * or validated.
 */
export interface PromptStore {
  list(project: string): Promise<PromptSourceFile[]>;
  get(project: string, id: string, version?: string): Promise<PromptRecord | null>;
  versions(project: string, id: string): Promise<PromptVersionRef[]>;
  catalog(project: string): Promise<Record<string, unknown> | null>;
  buildItems(project: string): Promise<Array<{ id: string; text: string; item: Record<string, unknown> }>>;
}

// ─── Memory (Y-02d) ─────────────────────────────────────────────────────────

export interface TemporalStats {
  totalFacts: number;
  validFacts: number;
  invalidatedFacts: number;
  categories: Record<string, number>;
}

export interface LayeredStats {
  conversation: { total: number; valid: number };
  session: { total: number; valid: number };
  user: { total: number; valid: number };
}

/**
 * Temporal fact graph. Methods are synchronous because the file implementation is synchronous;
 * a database-backed profile may return the same shapes from a sync driver (SQLite) or expose a
 * separate async contract in Y-05 — the call sites are what matter here.
 */
export interface TemporalMemoryStore {
  addFact(input: AddFactInput): TemporalFact;
  invalidateFact(factId: string, reason: string): boolean;
  getFact(factId: string): TemporalFact | null;
  queryAtTime(atTime: string): TemporalFact[];
  query(query: TemporalQuery): TemporalFact[];
  getFactHistory(factId: string): TemporalFact[];
  addRelationship(
    sourceId: string,
    targetId: string,
    type: FactRelationType,
    metadata?: Record<string, unknown>,
  ): boolean;
  getRelatedFacts(factId: string, type?: FactRelationType): TemporalFact[];
  stats(): TemporalStats;
  clear(): void;
}

/** User profiles: static facts plus time-ordered dynamic facts. */
export interface ProfileMemoryStore {
  getProfile(userId: string): UserProfile | null;
  updateProfile(userId: string, input: ProfileUpdateInput): UserProfile;
  getValidDynamicFacts(userId: string): DynamicFact[];
  buildContextBlock(userId: string, maxTokens?: number): string;
  listUsers(): string[];
  deleteProfile(userId: string): boolean;
}

/** Layered memory: conversation → session → user, with promotion between layers. */
export interface LayeredMemoryStore {
  add(
    layer: MemoryLayer,
    input: { statement: string; category?: string; confidence?: number; tags?: string[] },
  ): LayeredFact;
  get(layer: MemoryLayer, factId: string): LayeredFact | null;
  getLayer(layer: MemoryLayer): LayeredFact[];
  promote(from: MemoryLayer, to: MemoryLayer, factId: string): boolean;
  promoteAll(from: MemoryLayer, to: MemoryLayer): number;
  invalidate(layer: MemoryLayer, factId: string): boolean;
  clearLayer(layer: MemoryLayer): number;
  stats(): LayeredStats;
}

/** Session memory: summaries, decisions and conventions of past work sessions. */
export interface SessionMemoryStore {
  saveSession(record: Omit<SessionRecord, 'id'>): SessionRecord;
  getLastSession(): SessionRecord | undefined;
  getSession(id: string): SessionRecord | undefined;
  getSessions(limit?: number): SessionRecord[];
  getDecisions(): SessionDecision[];
  getDecisionsByTag(tag: string): SessionDecision[];
  getConventions(): string[];
  addConvention(convention: string): void;
  search(query: string): SessionRecord[];
  getSessionsInRange(startISO: string, endISO: string): SessionRecord[];
  getContextSummary(lastN?: number): string;
  deleteSession(id: string): boolean;
  clear(): void;
}

/**
 * Memory subsystem behind the profile. Every store is created for a path the caller names
 * (ADR-009 rule 1) — memory files are not tied to `DATA_DIR` and the profile must not assume it.
 */
export interface MemoryStore {
  temporal(storagePath: string): TemporalMemoryStore;
  profiles(storagePath: string): ProfileMemoryStore;
  layered(options: LayeredMemoryOptions): LayeredMemoryStore;
  session(options?: SessionMemoryOptions): SessionMemoryStore;
}

/** What a profile exposes to `AppContainer` and, through it, to the tool modules. */
export interface StorageProfile {
  manifest: StoreManifest;
  tasks: TaskStore;
  docs: DocStore;
  project: ProjectStore;
  prompts: PromptStore;
  memory: MemoryStore;
  /** Event logs are created per log file, so the profile hands out a factory. */
  events(storagePath: string): EventLogStore;
  history: HistoryProvider;
  locks: LockProvider;
  close?(): void;
}
