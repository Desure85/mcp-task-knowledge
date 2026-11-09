/**
 * Y-03a — контракты эмбеддингов и векторного слоя.
 *
 * ADR-009 §«Отпечаток модели эмбеддингов»: отпечаток — это идентичность модели, а не ключ кэша.
 * Коллекция адресуется `отпечаток + версия стратегии чанкинга + версия сборки текста` (последние
 * два появятся в Y-03b); смена любого из трёх создаёт новую коллекцию, смешивать векторы разных
 * коллекций нельзя.
 *
 * Эти интерфейсы отделены от `src/storage/contracts.ts`: хранилище отвечает за данные, поиск — за
 * эмбеддинги и векторы. Файловые реализации живут в `embeddings-file.ts` (Y-03a) и появятся для
 * VectorStore/IndexingService в Y-03b/Y-03c.
 */

export type PoolingMode = 'model' | 'cls' | 'mean';

/** Identity of an embedding model, stored with every vector (ADR-009). */
export interface EmbeddingFingerprint {
  /** Model file name + size (`basename:size`), not just the configured path. */
  modelId: string;
  /** Vector dimension inferred from the model or the real vector length. */
  dimension: number;
  pooling: PoolingMode;
  /** Instruction prefixes are part of the identity: they change the vector space. */
  queryPrefix: string;
  docPrefix: string;
}

/** Stable collection key: two fingerprints with the same key produce comparable vectors. */
export function fingerprintKey(fingerprint: EmbeddingFingerprint): string {
  return [
    fingerprint.modelId,
    fingerprint.dimension,
    fingerprint.pooling,
    fingerprint.queryPrefix,
    fingerprint.docPrefix,
  ].join('|');
}

/** Errors a provider may raise; the code is the contract, the message is for humans. */
export class EmbeddingError extends Error {
  constructor(
    readonly code: 'CAPABILITY_UNAVAILABLE' | 'INVALID_INPUT',
    message: string,
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

/** What a store needs from an embedding model. */
export interface EmbeddingProvider {
  fingerprint(): EmbeddingFingerprint;
  isReady(): boolean;
  /** One query vector; throws `EmbeddingError(CAPABILITY_UNAVAILABLE)` when the model is off/not loaded. */
  embedQuery(text: string): Promise<Float32Array>;
  /** Document vectors, same order as the input; batched by the implementation. */
  embedDocuments(texts: string[]): Promise<Float32Array[]>;
}

/** A vector as stored by a VectorStore: identity plus the collection it belongs to. */
/**
 * Y-03b: version of the text builder whose output was embedded. A change here creates a new
 * collection, exactly like a model change (ADR-009 rule 2).
 */
export const BUILD_TEXT_VERSION = 'build-text:v1';

/** Collection address: fingerprint + chunking version + build-text version (ADR-009 rule 2). */
export function collectionId(
  fingerprint: string,
  chunkingVersion: string,
  buildTextVersion: string = BUILD_TEXT_VERSION,
): string {
  return `${fingerprint}::${chunkingVersion}::${buildTextVersion}`;
}

export interface VectorCollectionInfo {
  id: string;
  fingerprint: string;
  chunkingVersion: string;
  buildTextVersion: string;
  vectors: number;
  /** True for the collection the current configuration would write to. */
  active: boolean;
  /** Old collections keep serving reads but never receive writes (ADR-009 dual read). */
  readOnly: boolean;
}

export interface VectorRecord {
  /** `(store, kind, id)` — the same identity the storage profile uses. */
  store: string;
  kind: 'task' | 'doc' | 'chunk';
  project: string;
  id: string;
  /** `fingerprintKey()` of the model that produced the vector. */
  fingerprint: string;
  /** Collection the vector belongs to: `collectionId(fingerprint, chunking, buildText)`. */
  collection: string;
  /** Versions that completed the collection address; stored once with the collection descriptor. */
  collectionMeta?: { chunkingVersion: string; buildTextVersion: string };
  vector: Float32Array;
}

export interface VectorQueryOptions {
  limit?: number;
  /** Explicit collection to read; when omitted the store falls back to `fingerprint`. */
  collection?: string;
  project?: string;
  kind?: VectorRecord['kind'];
  /** Only vectors of this collection; a store must never mix collections (ADR-009). */
  fingerprint: string;
  minScore?: number;
}

export interface VectorMatch {
  store: string;
  kind: VectorRecord['kind'];
  project: string;
  id: string;
  score: number;
  fingerprint: string;
}

/** Vector persistence, addressed by collection (Y-05/Y-06 implement SQLite/Postgres). */
export interface VectorStore {
  upsert(records: VectorRecord[]): Promise<void>;
  delete(store: string, kind: VectorRecord['kind'], ids: string[]): Promise<void>;
  query(vector: Float32Array, options: VectorQueryOptions): Promise<VectorMatch[]>;
  stats(fingerprint?: string): Promise<{ collections: Record<string, number>; total: number }>;
  clear(options?: { fingerprint?: string }): Promise<void>;
}

/** Chunking is versioned because a strategy change creates a new collection (ADR-009). */
export interface ChunkingStrategy {
  version: string;
  chunk(doc: { id: string; title: string; content: string; tags?: string[] }): Array<{
    id: string;
    text: string;
    ordinal: number;
  }>;
}

/** Queue/progress surface for the indexing service (`embeddings_status` reads it). */
export interface IndexingStatus {
  state: 'idle' | 'running' | 'paused' | 'error' | 'disabled';
  fingerprint: string;
  project?: string;
  total: number;
  done: number;
  queued: number;
  ratePerSec: number;
  lastError?: string;
}

/** Background indexing of a corpus; implementations decide persistence and batching. */
export interface IndexingService {
  ensureIndexed(project: string): Promise<{ queued: number; done: number }>;
  status(project?: string): IndexingStatus[];
  pause(): void;
  resume(): void;
}
