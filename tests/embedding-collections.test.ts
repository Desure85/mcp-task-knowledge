/**
 * Y-03b — коллекции векторов и двойное чтение.
 *
 * Проверяем ровно требования ADR-009: коллекция адресуется отпечатком + версией чанкинга + версией
 * сборки текста; векторы разных коллекций не смешиваются; при смене модели запрос читает обе
 * коллекции, не сливая оценки, и добирает из старой только то, чего нет в новой.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BUILD_TEXT_VERSION,
  collectionId,
  fingerprintKey,
  type VectorCollectionInfo,
  type VectorRecord,
} from '../src/search/contracts.js';
import { createFileVectorStore } from '../src/search/vector-store-file.js';
import { dualReadSearch } from '../src/search/dual-read.js';
import { activeEmbeddingCollection, buildEmbeddingsStatus } from '../src/search/embeddings-status.js';
import { FILE_CHUNKING_VERSION } from '../src/search/embeddings-file.js';
import { createFileProfile } from '../src/storage/profiles/file/index.js';
import { KNOWLEDGE_DIR, TASKS_DIR } from '../src/config.js';

const FINGERPRINT_A = 'model-a.onnx:100|4|mean|q: |d: ';
const FINGERPRINT_B = 'model-b.onnx:200|4|mean|q: |d: ';
const COLLECTION_A = collectionId(FINGERPRINT_A, FILE_CHUNKING_VERSION);
const COLLECTION_B = collectionId(FINGERPRINT_B, FILE_CHUNKING_VERSION);

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'y03b-vectors-'));
}

function vectorRecord(
  id: string,
  vector: number[],
  options: { fingerprint?: string; collection?: string; store?: string; kind?: VectorRecord['kind']; project?: string } = {},
): VectorRecord {
  const fingerprint = options.fingerprint ?? FINGERPRINT_A;
  return {
    store: options.store ?? 'knowledge',
    kind: options.kind ?? 'doc',
    project: options.project ?? 'p',
    id,
    fingerprint,
    collection: options.collection ?? collectionId(fingerprint, FILE_CHUNKING_VERSION),
    collectionMeta: { chunkingVersion: FILE_CHUNKING_VERSION, buildTextVersion: BUILD_TEXT_VERSION },
    vector: Float32Array.from(vector),
  };
}

describe('Y-03b: collection addressing', () => {
  it('addresses a collection by fingerprint, chunking version and build-text version', () => {
    const base = collectionId(FINGERPRINT_A, FILE_CHUNKING_VERSION);
    expect(base).toBe(collectionId(FINGERPRINT_A, FILE_CHUNKING_VERSION, BUILD_TEXT_VERSION));
    expect(collectionId(FINGERPRINT_B, FILE_CHUNKING_VERSION)).not.toBe(base);
    expect(collectionId(FINGERPRINT_A, `${FILE_CHUNKING_VERSION}:size=500`)).not.toBe(base);
    expect(collectionId(FINGERPRINT_A, FILE_CHUNKING_VERSION, 'build-text:v2')).not.toBe(base);
  });

  it('keeps a stable active collection for the same configuration', () => {
    const config = { embeddings: { mode: 'none' as const } };
    expect(activeEmbeddingCollection(config)).toBe(activeEmbeddingCollection(config));
    expect(activeEmbeddingCollection(config)).not.toBe(activeEmbeddingCollection({ embeddings: { mode: 'none', queryPrefix: 'q: ' } }));
  });
});

describe('Y-03b: file vector store keeps collections separate', () => {
  it('stores, queries and counts vectors per collection', async () => {
    const store = createFileVectorStore({ root: tempRoot() });
    await store.upsert([
      vectorRecord('doc-1', [1, 0, 0, 0]),
      vectorRecord('doc-2', [0, 1, 0, 0]),
      vectorRecord('doc-1', [1, 0, 0, 0], { fingerprint: FINGERPRINT_B }),
    ]);

    const activeHits = await store.query(Float32Array.from([1, 0, 0, 0]), {
      collection: COLLECTION_A,
      fingerprint: FINGERPRINT_A,
      limit: 10,
    });
    expect(activeHits.map((hit) => hit.id)).toEqual(['doc-1', 'doc-2']);
    expect(activeHits.every((hit) => hit.fingerprint === FINGERPRINT_A)).toBe(true);

    const previousHits = await store.query(Float32Array.from([1, 0, 0, 0]), {
      collection: COLLECTION_B,
      fingerprint: FINGERPRINT_B,
      limit: 10,
    });
    expect(previousHits.map((hit) => hit.id)).toEqual(['doc-1']);

    const stats = await store.stats();
    expect(stats.total).toBe(3);
    expect(stats.collections[COLLECTION_A]).toBe(2);
    expect(stats.collections[COLLECTION_B]).toBe(1);

    const infos = await store.collections();
    expect(infos).toHaveLength(2);
    expect(infos.find((info) => info.id === COLLECTION_A)).toMatchObject({
      fingerprint: FINGERPRINT_A,
      chunkingVersion: FILE_CHUNKING_VERSION,
      buildTextVersion: BUILD_TEXT_VERSION,
      vectors: 2,
    });
  });

  it('deletes by identity and clears one collection by fingerprint', async () => {
    const store = createFileVectorStore({ root: tempRoot() });
    await store.upsert([
      vectorRecord('doc-1', [1, 0, 0, 0]),
      vectorRecord('doc-2', [0, 1, 0, 0]),
      vectorRecord('doc-1', [1, 0, 0, 0], { fingerprint: FINGERPRINT_B }),
    ]);

    // Same identity lives in both collections: deletion removes it everywhere.
    await store.delete('knowledge', 'doc', ['doc-1']);
    expect((await store.stats()).total).toBe(1);
    expect(await store.query(Float32Array.from([1, 0, 0, 0]), {
      collection: COLLECTION_A,
      fingerprint: FINGERPRINT_A,
      limit: 10,
    })).toHaveLength(1);

    await store.clear({ fingerprint: FINGERPRINT_B });
    const remaining = await store.collections();
    expect(remaining.map((info) => info.id)).toEqual([COLLECTION_A]);
    expect(remaining[0].vectors).toBe(1);
  });

  it('is wired into the file profile under a caller-owned root', async () => {
    const root = tempRoot();
    const profile = createFileProfile({ tasksDir: TASKS_DIR, knowledgeDir: KNOWLEDGE_DIR, vectorsDir: root });
    await profile.vectors.upsert([vectorRecord('doc-1', [1, 0, 0, 0])]);
    const stats = await profile.vectors.stats();
    expect(stats.total).toBe(1);
    expect(stats.collections[COLLECTION_A]).toBe(1);
    // Caller-owned root: the store writes there (directory names are hashes of collection ids,
    // because ids contain characters that are illegal in Windows paths).
    expect(fs.readdirSync(root)).toHaveLength(1);
  });
});

describe('Y-03b: dual read across collections', () => {
  async function seededStore() {
    const store = createFileVectorStore({ root: tempRoot() });
    await store.upsert([
      // Active collection knows doc-1 only, and with a mediocre score.
      vectorRecord('doc-1', [0, 1, 0, 0]),
      // Previous collection knows doc-1 (perfect score) and doc-2 (which the active lacks).
      vectorRecord('doc-1', [1, 0, 0, 0], { fingerprint: FINGERPRINT_B }),
      vectorRecord('doc-2', [1, 0, 0, 0], { fingerprint: FINGERPRINT_B }),
    ]);
    return store;
  }

  it('returns active hits first and previous-only hits marked as previous', async () => {
    const store = await seededStore();
    const result = await dualReadSearch({
      store,
      query: Float32Array.from([1, 0, 0, 0]),
      active: { id: COLLECTION_A, fingerprint: FINGERPRINT_A },
      previous: { id: COLLECTION_B, fingerprint: FINGERPRINT_B },
      limit: 10,
    });
    expect(result.hits.map((hit) => `${hit.id}:${hit.collection}`)).toEqual(['doc-1:active', 'doc-2:previous']);
    expect(result.coverage).toEqual({ active: 1, previous: 1, activeCoversAll: false });
  });

  it('does not fuse scores across collections', async () => {
    const store = await seededStore();
    const result = await dualReadSearch({
      store,
      query: Float32Array.from([1, 0, 0, 0]),
      active: { id: COLLECTION_A, fingerprint: FINGERPRINT_A },
      previous: { id: COLLECTION_B, fingerprint: FINGERPRINT_B },
      limit: 10,
    });
    const activeHit = result.hits.find((hit) => hit.collection === 'active')!;
    const previousHit = result.hits.find((hit) => hit.collection === 'previous')!;
    // The previous hit has the perfect score, yet stays after the active hit: no cross-collection sort.
    expect(activeHit.score).toBeLessThan(previousHit.score);
    expect(result.hits[0].collection).toBe('active');
    expect(previousHit.score).toBeCloseTo(1, 5);
  });

  it('never duplicates a document that exists in both collections', async () => {
    const store = await seededStore();
    const result = await dualReadSearch({
      store,
      query: Float32Array.from([1, 0, 0, 0]),
      active: { id: COLLECTION_A, fingerprint: FINGERPRINT_A },
      previous: { id: COLLECTION_B, fingerprint: FINGERPRINT_B },
      limit: 10,
    });
    expect(result.hits.filter((hit) => hit.id === 'doc-1')).toHaveLength(1);
  });

  it('reports full coverage when the previous collection adds nothing', async () => {
    const store = createFileVectorStore({ root: tempRoot() });
    await store.upsert([
      vectorRecord('doc-1', [1, 0, 0, 0]),
      vectorRecord('doc-1', [1, 0, 0, 0], { fingerprint: FINGERPRINT_B }),
    ]);
    const result = await dualReadSearch({
      store,
      query: Float32Array.from([1, 0, 0, 0]),
      active: { id: COLLECTION_A, fingerprint: FINGERPRINT_A },
      previous: { id: COLLECTION_B, fingerprint: FINGERPRINT_B },
      limit: 10,
    });
    expect(result.hits.map((hit) => hit.collection)).toEqual(['active']);
    expect(result.coverage.activeCoversAll).toBe(true);
  });

  it('falls back to the previous collection when the active one is empty', async () => {
    const store = createFileVectorStore({ root: tempRoot() });
    await store.upsert([vectorRecord('doc-2', [1, 0, 0, 0], { fingerprint: FINGERPRINT_B })]);
    const result = await dualReadSearch({
      store,
      query: Float32Array.from([1, 0, 0, 0]),
      active: { id: COLLECTION_A, fingerprint: FINGERPRINT_A },
      previous: { id: COLLECTION_B, fingerprint: FINGERPRINT_B },
      limit: 10,
    });
    expect(result.hits.map((hit) => `${hit.id}:${hit.collection}`)).toEqual(['doc-2:previous']);
    expect(result.coverage).toEqual({ active: 0, previous: 1, activeCoversAll: false });
  });
});

describe('Y-03b: embeddings_status reports both collections', () => {
  it('marks the configured collection active and the rest read-only', () => {
    const config = { embeddings: { mode: 'none' as const } };
    const activeId = activeEmbeddingCollection(config);
    const activeInfo: VectorCollectionInfo = {
      id: activeId,
      fingerprint: fingerprintKey({ modelId: 'm', dimension: 4, pooling: 'mean', queryPrefix: '', docPrefix: '' }),
      chunkingVersion: FILE_CHUNKING_VERSION,
      buildTextVersion: BUILD_TEXT_VERSION,
      vectors: 3,
      active: false,
      readOnly: false,
    };
    const oldInfo: VectorCollectionInfo = { ...activeInfo, id: 'old-collection', vectors: 2 };
    const payload = buildEmbeddingsStatus({
      config,
      adapterInitAttempted: true,
      adapterReady: false,
      warmup: { state: 'idle' } as never,
      collections: [activeInfo, oldInfo],
    }) as {
      activeCollection: string;
      collectionCount: number;
      collections: Array<{ id: string; active: boolean; readOnly: boolean; vectors: number }>;
    };
    expect(payload.activeCollection).toBe(activeId);
    expect(payload.collectionCount).toBe(2);
    expect(payload.collections).toEqual([
      expect.objectContaining({ id: activeId, active: true, readOnly: false, vectors: 3 }),
      expect.objectContaining({ id: 'old-collection', active: false, readOnly: true, vectors: 2 }),
    ]);
  });
});
