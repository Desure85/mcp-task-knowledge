/**
 * Y-03a — контракты эмбеддингов и чанкинга.
 *
 * Файловый провайдер — тонкое делегирование адаптеру, поэтому тест гоняет fake-адаптер: он
 * доказывает делегирование, порядок батчей и честный `CAPABILITY_UNAVAILABLE`, когда модель не
 * загружена. Паритет с реальной ONNX-моделью требует модели, которой в CI нет; вместо этого
 * проверяется отключённый адаптер и паритет чанкинга с функциями, которыми уже пользуется поиск.
 */

import { describe, it, expect } from 'vitest';
import {
  EmbeddingError,
  collectionId,
  fingerprintKey,
  type EmbeddingFingerprint,
  type IndexingService,
  type IndexingStatus,
  type VectorRecord,
  type VectorStore,
} from '../src/search/contracts.js';
import {
  FILE_CHUNKING_VERSION,
  createFileChunkingStrategy,
  createFileEmbeddingProvider,
  fileEmbeddingFingerprint,
} from '../src/search/embeddings-file.js';
import { buildChunksForDoc, chunkText } from '../src/search/index.js';
import { OnnxVectorAdapter } from '../src/search/vector.js';

const FINGERPRINT: EmbeddingFingerprint = {
  modelId: 'fixture.onnx:1234',
  dimension: 4,
  pooling: 'mean',
  queryPrefix: 'task: search result | query: ',
  docPrefix: 'title: none | text:',
};

function fakeAdapter(ready = true) {
  const calls: Array<{ texts: string[]; kind: 'query' | 'doc' }> = [];
  return {
    calls,
    isReady: () => ready,
    fingerprint: () => ({ ...FINGERPRINT }),
    async embed(texts: string[], kind: 'query' | 'doc'): Promise<Float32Array[]> {
      calls.push({ texts, kind });
      return texts.map((text, index) => Float32Array.from([text.length, index, 0.5, 1]));
    },
  };
}

describe('Y-03a: embedding fingerprint', () => {
  it('is stable for the same configuration', () => {
    expect(fileEmbeddingFingerprint()).toEqual(fileEmbeddingFingerprint());
  });

  it('changes the collection key when any identity field changes', () => {
    const base = fileEmbeddingFingerprint();
    const key = fingerprintKey(base);
    expect(fingerprintKey({ ...base, modelId: `${base.modelId}+` })).not.toBe(key);
    expect(fingerprintKey({ ...base, dimension: base.dimension + 1 })).not.toBe(key);
    expect(fingerprintKey({ ...base, pooling: base.pooling === 'mean' ? 'cls' : 'mean' })).not.toBe(key);
    expect(fingerprintKey({ ...base, queryPrefix: 'q: ' })).not.toBe(key);
    expect(fingerprintKey({ ...base, docPrefix: 'd: ' })).not.toBe(key);
  });

  it('provider returns a copy of the fingerprint, not a live view', () => {
    const provider = createFileEmbeddingProvider(fakeAdapter(), { fingerprint: FINGERPRINT });
    const first = provider.fingerprint();
    first.dimension = 999;
    expect(provider.fingerprint().dimension).toBe(FINGERPRINT.dimension);
  });
});

describe('Y-03a: file embedding provider delegates to the adapter', () => {
  it('passes the query verbatim and returns the adapter vector', async () => {
    const adapter = fakeAdapter();
    const provider = createFileEmbeddingProvider(adapter, { fingerprint: FINGERPRINT });

    const vector = await provider.embedQuery('hello');
    expect(Array.from(vector)).toEqual([5, 0, 0.5, 1]);
    expect(adapter.calls).toEqual([{ texts: ['hello'], kind: 'query' }]);
  });

  it('batches documents in order and skips the adapter for an empty batch', async () => {
    const adapter = fakeAdapter();
    const provider = createFileEmbeddingProvider(adapter, { fingerprint: FINGERPRINT });

    expect(await provider.embedDocuments([])).toEqual([]);
    expect(adapter.calls).toHaveLength(0);

    const vectors = await provider.embedDocuments(['a', 'bb']);
    expect(vectors.map((vector) => Array.from(vector)[0])).toEqual([1, 2]);
    expect(adapter.calls).toEqual([{ texts: ['a', 'bb'], kind: 'doc' }]);
  });

  it('reports CAPABILITY_UNAVAILABLE instead of empty vectors when the model is off', async () => {
    const provider = createFileEmbeddingProvider(fakeAdapter(false), { fingerprint: FINGERPRINT });

    expect(provider.isReady()).toBe(false);
    await expect(provider.embedQuery('x')).rejects.toBeInstanceOf(EmbeddingError);
    await expect(provider.embedDocuments(['x'])).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
    });
  });

  it('a real adapter without a loaded model is honestly unavailable', async () => {
    const adapter = new OnnxVectorAdapter<unknown>(384);
    expect(adapter.isReady()).toBe(false);

    const fingerprint = adapter.fingerprint();
    expect(fingerprint.dimension).toBe(384);
    expect(fingerprintKey(fingerprint)).toContain('|384|');

    const provider = createFileEmbeddingProvider(adapter, { fingerprint });
    await expect(provider.embedDocuments(['x'])).rejects.toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
    });
  });
});

describe('Y-03a: chunking strategy is the search chunking, versioned', () => {
  const doc = { id: 'doc-1', title: 'Title', content: 'x'.repeat(4500), tags: ['t'] };

  it('produces the same windows and ids as buildChunksForDoc', () => {
    const strategy = createFileChunkingStrategy();
    const expected = buildChunksForDoc(doc as never).map((chunk, ordinal) => ({
      id: chunk.id,
      text: chunk.text,
      ordinal,
    }));
    expect(strategy.chunk(doc)).toEqual(expected);
    expect(strategy.chunk(doc)).toHaveLength(chunkText(doc.content).length);
  });

  it('is deterministic and versioned by options', () => {
    expect(createFileChunkingStrategy().version).toBe(FILE_CHUNKING_VERSION);

    const smaller = createFileChunkingStrategy({ chunkSize: 500, chunkOverlap: 50 });
    expect(smaller.version).not.toBe(FILE_CHUNKING_VERSION);
    expect(smaller.chunk(doc)).toEqual(smaller.chunk(doc));
    expect(smaller.chunk(doc).length).toBeGreaterThan(createFileChunkingStrategy().chunk(doc).length);
  });

  it('keeps a short document as a single #0 chunk', () => {
    const short = { id: 'doc-2', title: 'Short', content: 'tiny' };
    const chunks = createFileChunkingStrategy().chunk(short);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ id: 'doc-2#0', ordinal: 0 });
  });
});

describe('Y-03a: VectorStore and IndexingService are implementable contracts', () => {
  it('a fake vector store satisfies the interface', async () => {
    const records: VectorRecord[] = [];
    const store: VectorStore = {
      async upsert(batch) {
        records.push(...batch);
      },
      async delete(_store, _kind, ids) {
        for (const id of ids) {
          const index = records.findIndex((record) => record.id === id);
          if (index >= 0) records.splice(index, 1);
        }
      },
      async query(vector, options) {
        return records
          .filter((record) => record.fingerprint === options.fingerprint)
          .map((record) => ({
            store: record.store,
            kind: record.kind,
            project: record.project,
            id: record.id,
            score: record.vector.length === vector.length ? 1 : 0,
            fingerprint: record.fingerprint,
          }));
      },
      async stats(fingerprint) {
        const collections: Record<string, number> = {};
        for (const record of records) {
          if (fingerprint && record.fingerprint !== fingerprint) continue;
          collections[record.fingerprint] = (collections[record.fingerprint] ?? 0) + 1;
        }
        return { collections, total: records.length };
      },
      async clear(options) {
        if (!options?.fingerprint) records.length = 0;
      },
    };

    const fingerprint = fingerprintKey(FINGERPRINT);
    await store.upsert([
      {
        store: 'tasks',
        kind: 'task',
        project: 'p',
        id: 't1',
        fingerprint,
        collection: collectionId(fingerprint, FILE_CHUNKING_VERSION),
        vector: Float32Array.from([1, 0]),
      },
    ]);
    expect(await store.stats(fingerprint)).toEqual({ collections: { [fingerprint]: 1 }, total: 1 });
    expect(await store.query(Float32Array.from([1, 0]), { fingerprint })).toHaveLength(1);
    await store.delete('tasks', 'task', ['t1']);
    expect(await store.stats()).toEqual({ collections: {}, total: 0 });
  });

  it('a fake indexing service satisfies the interface', async () => {
    const states: IndexingStatus[] = [];
    const service: IndexingService = {
      async ensureIndexed(project) {
        states.push({
          state: 'running',
          fingerprint: fingerprintKey(FINGERPRINT),
          project,
          total: 2,
          done: 0,
          queued: 2,
          ratePerSec: 0,
        });
        return { queued: 2, done: 0 };
      },
      status(project) {
        return project ? states.filter((state) => state.project === project) : states;
      },
      pause() {
        for (const state of states) state.state = 'paused';
      },
      resume() {
        for (const state of states) state.state = 'running';
      },
    };

    expect(await service.ensureIndexed('p')).toEqual({ queued: 2, done: 0 });
    expect(service.status('p')).toHaveLength(1);
    service.pause();
    expect(service.status('p')[0].state).toBe('paused');
    service.resume();
    expect(service.status()[0].state).toBe('running');
  });
});
