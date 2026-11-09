/**
 * Y-03b — статус эмбеддингов: активная коллекция и счётчики обеих коллекций (ADR-009 §«Двойное
 * чтение», п. 3: «результат несёт признак, из какой коллекции получен хит, и статус показывает
 * счётчики обеих коллекций»).
 */

import type { ServerConfig } from '../config.js';
import {
  BUILD_TEXT_VERSION,
  collectionId,
  fingerprintKey,
  type IndexingStatus,
  type VectorCollectionInfo,
} from './contracts.js';
import { FILE_CHUNKING_VERSION, fileEmbeddingFingerprint } from './embeddings-file.js';

export interface EmbeddingsStatusInput {
  config: Pick<ServerConfig, 'embeddings'>;
  adapterInitAttempted: boolean;
  adapterReady: boolean;
  warmup: unknown;
  collections: VectorCollectionInfo[];
  /** Background indexing status (Y-03c). */
  indexing?: IndexingStatus[];
  /** Y-04a: external-provider egress state; disabled by default. */
  external?: {
    enabled: boolean;
    provider: string;
    model?: string;
    baseUrl?: string;
    warning: string | null;
    /** Present only once the provider wrapper is created (true when configured). */
    stats?: { requests: number; texts: number; estimatedCostUsd: number };
  };
}

/** Collection the current configuration would write to. */
export function activeEmbeddingCollection(config: Pick<ServerConfig, 'embeddings'>): string {
  const fingerprint = fingerprintKey(fileEmbeddingFingerprint(config as ServerConfig));
  return collectionId(fingerprint, FILE_CHUNKING_VERSION, BUILD_TEXT_VERSION);
}

/**
 * Payload of `embeddings_status`. Old collections are reported as `readOnly`: they still serve
 * dual-read hits but never receive writes (ADR-009 rule: switch without silently reusing vectors).
 */
export function buildEmbeddingsStatus(input: EmbeddingsStatusInput): Record<string, unknown> {
  const activeCollection = activeEmbeddingCollection(input.config);
  const collections = input.collections.map((collection) => ({
    id: collection.id,
    fingerprint: collection.fingerprint,
    chunkingVersion: collection.chunkingVersion,
    buildTextVersion: collection.buildTextVersion,
    vectors: collection.vectors,
    active: collection.id === activeCollection,
    readOnly: collection.id !== activeCollection,
  }));
  return {
    mode: input.config.embeddings.mode,
    hasModelPath: Boolean(input.config.embeddings.modelPath),
    modelPath: input.config.embeddings.modelPath ?? null,
    dim: input.config.embeddings.dim ?? null,
    cacheDir: input.config.embeddings.cacheDir || null,
    activeCollection,
    collections,
    collectionCount: collections.length,
    indexing: input.indexing ?? [],
    external: input.external ?? { enabled: false, provider: 'none', warning: null },
    adapterInitAttempted: input.adapterInitAttempted,
    adapterReady: input.adapterReady,
    warmup: input.warmup,
  };
}
