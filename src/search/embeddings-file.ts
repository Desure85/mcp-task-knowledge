/**
 * Y-03a — файловая реализация EmbeddingProvider и ChunkingStrategy.
 *
 * Не меняет поведение текущего адаптера: провайдер делегирует его публичным методам, стратегия
 * чанкинга делегирует существующим `chunkText`/`buildChunksForDoc`. Проводка в `SearchProvider`
 * (Y-03c) и коллекции с отпечатком (Y-03b) появятся отдельными инкрементами.
 */

import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { loadConfig } from '../config.js';
import { buildChunksForDoc, chunkText, type ChunkingOptions } from './index.js';
import { readPoolingConfig, resolvePooling, type PoolingMode } from './vector.js';
import {
  EmbeddingError,
  type ChunkingStrategy,
  type EmbeddingFingerprint,
  type EmbeddingProvider,
} from './contracts.js';

/** The part of the vector adapter the provider needs; kept narrow so tests can inject a fake. */
export interface EmbeddingAdapterLike {
  isReady(): boolean;
  fingerprint(): EmbeddingFingerprint;
  embed(texts: string[], kind: 'query' | 'doc'): Promise<Float32Array[]>;
}

/** Fingerprint of the configured model, derived exactly like the adapter derives its cache salt. */
export function fileEmbeddingFingerprint(cfg = loadConfig()): EmbeddingFingerprint {
  const configuredModel = cfg.embeddings.modelPath ?? '';
  let modelId = basename(configuredModel || 'model');
  try {
    modelId = `${basename(configuredModel)}:${statSync(configuredModel).size}`;
  } catch {
    // Missing model is a valid configuration (mode=none): keep the basename so the fingerprint,
    // and therefore the collection key, stays stable instead of throwing at startup.
  }
  const withSpace = (prefix?: string) => {
    const trimmed = (prefix ?? '').trim();
    return trimmed ? `${trimmed} ` : '';
  };
  const pooling = resolvePooling(
    process.env.EMBEDDINGS_POOLING,
    readPoolingConfig(cfg.embeddings.modelPath),
  ) as PoolingMode;
  return {
    modelId,
    dimension: cfg.embeddings.dim ?? 0,
    pooling,
    queryPrefix: withSpace(cfg.embeddings.queryPrefix),
    docPrefix: withSpace(cfg.embeddings.docPrefix),
  };
}

/** File-profile embedding provider: a thin delegation over the adapter (Y-03a). */
export function createFileEmbeddingProvider(
  adapter: EmbeddingAdapterLike,
  options?: { fingerprint?: EmbeddingFingerprint },
): EmbeddingProvider {
  const fingerprint = { ...(options?.fingerprint ?? fileEmbeddingFingerprint()) };
  if (!fingerprint.dimension) fingerprint.dimension = 0;
  const ready = () => adapter.isReady();
  const unavailable = () =>
    new EmbeddingError(
      'CAPABILITY_UNAVAILABLE',
      'embeddings are not available: mode=none or the model failed to load',
    );
  return {
    fingerprint: () => ({ ...fingerprint }),
    isReady: ready,
    async embedQuery(text: string): Promise<Float32Array> {
      if (!ready()) throw unavailable();
      const [vector] = await adapter.embed([text], 'query');
      if (!vector) throw new EmbeddingError('INVALID_INPUT', 'provider returned no vector for the query');
      return vector;
    },
    async embedDocuments(texts: string[]): Promise<Float32Array[]> {
      if (texts.length === 0) return [];
      if (!ready()) throw unavailable();
      return adapter.embed(texts, 'doc');
    },
  };
}

/** Version of the file chunking strategy; part of the collection address (ADR-009). */
export const FILE_CHUNKING_VERSION = 'file-chunking:v1:size=2000:overlap=200';

/**
 * File chunking strategy: same windows and ids the two-stage search already produces.
 * `chunk(doc).map(c => c.text)` equals `buildChunksForDoc(doc).map(c => c.text)`.
 */
export function createFileChunkingStrategy(options?: ChunkingOptions): ChunkingStrategy {
  const version = options
    ? `${FILE_CHUNKING_VERSION}:size=${options.chunkSize ?? 2000}:overlap=${options.chunkOverlap ?? 200}`
    : FILE_CHUNKING_VERSION;
  return {
    version,
    chunk(doc) {
      const built = buildChunksForDoc(
        { id: doc.id, title: doc.title, content: doc.content, tags: doc.tags } as never,
        options,
      );
      return built.map((chunk, ordinal) => ({ id: chunk.id, text: chunk.text, ordinal }));
    },
  };
}

