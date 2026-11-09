/**
 * Y-03c — файловый IndexingService: очередь, идемпотентность по хэшу содержимого, пауза и прогресс.
 *
 * ADR-009: индексация — отдельная от поиска и провайдера сущность. Очередь живёт в памяти, факт
 * индексации — в манифесте (переживает рестарт), поэтому повторный запуск не переделывает уже
 * векторизованное. Холодный старт не блокирует запрос: `ensureIndexed` только ставит элементы в
 * очередь, эмбеддинги считаются в фоне и только для тех, чей хэш в этой коллекции изменился.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  BUILD_TEXT_VERSION,
  collectionId,
  fingerprintKey,
  type ChunkingStrategy,
  type EmbeddingProvider,
  type IndexingService,
  type IndexingStatus,
  type VectorRecord,
  type VectorStore,
} from './contracts.js';

export interface IndexingItem {
  store: string;
  kind: 'task' | 'doc' | 'chunk';
  project: string;
  id: string;
  text: string;
  /** Trust level of the source document (ADR-009 external-provider policy). */
  trustLevel?: 'system' | 'user' | 'external';
}

export interface FileIndexingServiceOptions {
  /** Vector collections to write into (caller-owned root configured at the store). */
  store: VectorStore;
  /** Chunking strategy whose version is part of the collection address. */
  chunker: ChunkingStrategy;
  /** Lazy provider: called on the first batch, so a cold start never loads the model. */
  provider: () => Promise<EmbeddingProvider | undefined>;
  /** Corpus loader; called by `ensureIndexed(project)`. */
  collect: (project: string) => Promise<IndexingItem[]>;
  /** Manifest path for content hashes; omit for in-memory-only idempotency (tests). */
  manifestPath?: string;
  /** Batch size for `provider.embedDocuments`; defaults to 16. */
  batchSize?: number;
  /** Clock injection for deterministic rate measurements in tests. */
  now?: () => number;
  /**
   * Y-04a: external-provider policy. Items it refuses never enter the queue, so their texts cannot
   * leave the machine by accident; they are counted as `blocked` in the status.
   */
  externalPolicy?: (item: IndexingItem) => { allowed: boolean; reason?: string };
}

export interface FileIndexingService extends IndexingService {
  /** Enqueue the project's corpus; returns immediately (cold start must not block search). */
  ensureIndexed(project: string): Promise<{ queued: number; done: number; skipped: number }>;
  /** Await the current queue (tests and graceful shutdown). */
  drain(): Promise<void>;
  /** Whether the provider factory has been invoked at least once. */
  providerRequested(): boolean;
}

interface QueueEntry {
  item: IndexingItem;
  project: string;
}

interface ProjectProgress {
  total: number;
  done: number;
  skipped: number;
  blocked: number;
  embeddings: number;
  startedAt?: number;
  lastError?: string;
}

function identityOf(item: IndexingItem): string {
  return `${item.store}|${item.kind}|${item.project}|${item.id}`;
}

export function createFileIndexingService(options: FileIndexingServiceOptions): FileIndexingService {
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? 16));
  const clock = options.now ?? (() => Date.now());
  const manifest = new Map<string, string>();
  const queue: QueueEntry[] = [];
  const progress = new Map<string, ProjectProgress>();
  let paused = false;
  let running = false;
  let providerRequested = false;
  let providerInstance: EmbeddingProvider | undefined;
  let manifestDirty = false;
  let disposed = false;

  function ensureProgress(project: string): ProjectProgress {
    const existing = progress.get(project);
    if (existing) return existing;
    const created: ProjectProgress = { total: 0, done: 0, skipped: 0, blocked: 0, embeddings: 0 };
    progress.set(project, created);
    return created;
  }

  function manifestKey(collection: string, item: IndexingItem): string {
    return `${collection}|${identityOf(item)}`;
  }

  function hashText(collection: string, item: IndexingItem): string {
    return createHash('sha1').update(`${collection}|${item.text}`).digest('hex');
  }

  async function loadManifest(): Promise<void> {
    if (!options.manifestPath) return;
    try {
      const raw = JSON.parse(await fs.readFile(options.manifestPath, 'utf8')) as {
        entries?: Record<string, string>;
      };
      for (const [key, value] of Object.entries(raw.entries ?? {})) manifest.set(key, value);
    } catch {
      // No manifest yet (first run) — nothing to load.
    }
  }

  async function saveManifest(): Promise<void> {
    if (!options.manifestPath || !manifestDirty) return;
    manifestDirty = false;
    const entries: Record<string, string> = {};
    for (const [key, value] of manifest) entries[key] = value;
    await fs.mkdir(path.dirname(options.manifestPath), { recursive: true });
    await fs.writeFile(options.manifestPath, JSON.stringify({ version: 1, entries }, null, 2), 'utf8');
  }

  async function ensureProvider(): Promise<EmbeddingProvider | undefined> {
    if (providerInstance) return providerInstance;
    if (!providerRequested) providerRequested = true;
    providerInstance = await options.provider();
    return providerInstance;
  }

  function statusFor(project: string): IndexingStatus {
    const state = ensureProgress(project);
    const queued = queue.filter((entry) => entry.project === project).length;
    const elapsedSec = state.startedAt ? Math.max(0.001, (clock() - state.startedAt) / 1000) : 0;
    const rate = elapsedSec > 0 ? Math.round((state.embeddings / elapsedSec) * 100) / 100 : 0;
    const serviceState: IndexingStatus['state'] = state.lastError
      ? 'error'
      : paused && queued > 0
        ? 'paused'
        : queued > 0 || running
          ? 'running'
          : providerInstance
            ? 'idle'
            : 'disabled';
    return {
      state: state.lastError ? 'error' : serviceState,
      fingerprint: providerInstance ? fingerprintKey(providerInstance.fingerprint()) : '',
      project,
      total: state.total,
      done: state.done,
      skipped: state.skipped,
      blocked: state.blocked,
      queued,
      ratePerSec: rate,
      lastError: state.lastError,
    };
  }

  async function processBatch(entries: QueueEntry[]): Promise<void> {
    const provider = await ensureProvider();
    const project = entries[0].project;
    const state = ensureProgress(project);
    if (!provider) {
      state.lastError = 'embeddings are not available (mode=none or the model failed to load)';
      return;
    }
    state.startedAt ??= clock();
    const fingerprint = fingerprintKey(provider.fingerprint());
    const collection = collectionId(fingerprint, options.chunker.version, BUILD_TEXT_VERSION);
    const misses = entries.filter((entry) => manifest.get(manifestKey(collection, entry.item)) !== hashText(collection, entry.item));
    state.skipped += entries.length - misses.length;
    if (misses.length > 0) {
      const vectors = await provider.embedDocuments(misses.map((entry) => entry.item.text));
      const records: VectorRecord[] = misses.map((entry, index) => ({
        store: entry.item.store,
        kind: entry.item.kind,
        project: entry.item.project,
        id: entry.item.id,
        fingerprint,
        collection,
        collectionMeta: { chunkingVersion: options.chunker.version, buildTextVersion: BUILD_TEXT_VERSION },
        vector: vectors[index],
      }));
      await options.store.upsert(records);
      for (const entry of misses) {
        manifest.set(manifestKey(collection, entry.item), hashText(collection, entry.item));
        manifestDirty = true;
      }
      state.embeddings += misses.length;
      await saveManifest();
    }
    state.done += entries.length;
  }

  async function runQueue(): Promise<void> {
    if (running || paused || disposed) return;
    running = true;
    try {
      while (!paused && queue.length > 0) {
        const batch = queue.splice(0, batchSize);
        try {
          await processBatch(batch);
        } catch (error) {
          const project = batch[0].project;
          const state = ensureProgress(project);
          state.lastError = error instanceof Error ? error.message : String(error);
          // Put the failed batch back so a later resume/ensureIndexed can retry it.
          queue.unshift(...batch);
          break;
        }
      }
    } finally {
      running = false;
      if (queue.length > 0 && !paused && !disposed) void runQueue();
    }
  }

  return {
    async ensureIndexed(project: string) {
      await loadManifest();
      const items = await options.collect(project);
      const state = ensureProgress(project);
      state.total = Math.max(state.total, items.length);
      const queuedIdentities = new Set(queue.map((entry) => identityOf(entry.item)));
      let queued = 0;
      for (const item of items) {
        const identity = identityOf(item);
        if (queuedIdentities.has(identity)) continue;
        if (options.externalPolicy) {
          const decision = options.externalPolicy(item);
          if (!decision.allowed) {
            state.blocked += 1;
            continue;
          }
        }
        queuedIdentities.add(identity);
        queue.push({ item, project });
        queued += 1;
      }
      if (queued > 0 && !paused) void runQueue();
      return { queued, done: 0, skipped: 0 };
    },

    status(project?: string) {
      const projects = project ? [project] : [...progress.keys()];
      return projects.map((name) => statusFor(name));
    },

    pause() {
      paused = true;
    },

    resume() {
      paused = false;
      if (queue.length > 0) void runQueue();
    },

    async drain() {
      while (!disposed && (queue.length > 0 || running)) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },

    providerRequested() {
      return providerRequested;
    },

    /** Stop background work (tests/graceful shutdown); pending items are dropped. */
    dispose() {
      disposed = true;
      queue.length = 0;
    },
  } as FileIndexingService & { dispose(): void };
}
