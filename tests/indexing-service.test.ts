/**
 * Y-03c — файловый IndexingService: холодный старт, идемпотентность по хэшу содержимого, пауза,
 * прогресс/скорость и масштабная проба на 10k.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectionId,
  fingerprintKey,
  type EmbeddingProvider,
  type VectorRecord,
  type VectorStore,
} from '../src/search/contracts.js';
import { createFileIndexingService, type IndexingItem } from '../src/search/indexing-service.js';
import { createFileVectorStore } from '../src/search/vector-store-file.js';
import { FILE_CHUNKING_VERSION, createFileChunkingStrategy } from '../src/search/embeddings-file.js';
import { buildEmbeddingsStatus } from '../src/search/embeddings-status.js';
import { createFileProfile } from '../src/storage/profiles/file/index.js';
import { KNOWLEDGE_DIR, TASKS_DIR } from '../src/config.js';

const FINGERPRINT = { modelId: 'fake.onnx:1', dimension: 4, pooling: 'mean' as const, queryPrefix: '', docPrefix: '' };
const COLLECTION = collectionId(fingerprintKey(FINGERPRINT), FILE_CHUNKING_VERSION);

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'y03c-indexing-'));
}

function fakeProvider() {
  const calls: string[][] = [];
  const provider: EmbeddingProvider = {
    fingerprint: () => ({ ...FINGERPRINT }),
    isReady: () => true,
    async embedQuery(text: string) {
      return Float32Array.from([text.length, 0, 0, 0]);
    },
    async embedDocuments(texts: string[]) {
      calls.push([...texts]);
      return texts.map((text) => Float32Array.from([text.length, 0, 0, 0]));
    },
  };
  return { provider, calls };
}

function corpus(count: number, project = 'p'): IndexingItem[] {
  return Array.from({ length: count }, (_, index) => ({
    store: 'knowledge',
    kind: 'doc' as const,
    project,
    id: `doc-${index}`,
    text: `text ${index}`,
  }));
}

function memoryStore(): VectorStore & { records: VectorRecord[] } {
  const records: VectorRecord[] = [];
  return {
    records,
    async upsert(batch) {
      for (const record of batch) {
        const index = records.findIndex(
          (existing) => existing.store === record.store && existing.kind === record.kind && existing.id === record.id,
        );
        if (index >= 0) records[index] = record;
        else records.push(record);
      }
    },
    async delete(_store, _kind, ids) {
      for (const id of ids) {
        const index = records.findIndex((record) => record.id === id);
        if (index >= 0) records.splice(index, 1);
      }
    },
    async query(vector, options) {
      return records
        .filter((record) => record.collection === options.collection)
        .map((record) => ({
          store: record.store,
          kind: record.kind,
          project: record.project,
          id: record.id,
          score: record.vector.length === vector.length ? 1 : 0,
          fingerprint: record.fingerprint,
        }));
    },
    async stats() {
      return { collections: {}, total: records.length };
    },
    async clear() {
      records.length = 0;
    },
  };
}

describe('Y-03c: indexing service', () => {
  it('does not block the caller while the provider resolves (cold start)', async () => {
    let releaseProvider: (value: EmbeddingProvider) => void = () => {};
    const pending = new Promise<EmbeddingProvider>((resolve) => {
      releaseProvider = resolve;
    });
    const { provider } = fakeProvider();
    const store = memoryStore();
    const service = createFileIndexingService({
      store,
      chunker: createFileChunkingStrategy(),
      provider: () => pending,
      collect: async () => corpus(4),
    });

    const startedAt = Date.now();
    const result = await service.ensureIndexed('p');
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(result.queued).toBe(4);
    expect(service.status('p')[0]).toMatchObject({ state: 'running', done: 0 });

    releaseProvider(provider);
    await service.drain();
    expect(service.status('p')[0]).toMatchObject({ state: 'idle', done: 4 });
  });

  it('writes vectors into the addressed collection', async () => {
    const { provider } = fakeProvider();
    const store = memoryStore();
    const service = createFileIndexingService({
      store,
      chunker: createFileChunkingStrategy(),
      provider: async () => provider,
      collect: async () => corpus(3),
    });
    await service.ensureIndexed('p');
    await service.drain();

    expect(store.records).toHaveLength(3);
    expect(store.records.every((record) => record.collection === COLLECTION)).toBe(true);
    expect(store.records.every((record) => record.fingerprint === fingerprintKey(FINGERPRINT))).toBe(true);
    expect(store.records[0].collectionMeta).toEqual({
      chunkingVersion: FILE_CHUNKING_VERSION,
      buildTextVersion: expect.any(String),
    });
  });

  it('re-indexing unchanged content adds no embedding work (content-hash idempotency)', async () => {
    const { provider, calls } = fakeProvider();
    const store = memoryStore();
    const items = corpus(5);
    const service = createFileIndexingService({
      store,
      chunker: createFileChunkingStrategy(),
      provider: async () => provider,
      collect: async () => items,
    });

    await service.ensureIndexed('p');
    await service.drain();
    expect(calls.flat()).toHaveLength(5);

    await service.ensureIndexed('p');
    await service.drain();
    expect(calls.flat()).toHaveLength(5);
    // `done` counts processed items (cumulative), `skipped` shows the work avoided on the rerun.
    expect(service.status('p')[0]).toMatchObject({ total: 5, done: 10, skipped: 5, queued: 0 });
  });

  it('re-embeds only the item whose content changed', async () => {
    const { provider, calls } = fakeProvider();
    const store = memoryStore();
    let items = corpus(4);
    const service = createFileIndexingService({
      store,
      chunker: createFileChunkingStrategy(),
      provider: async () => provider,
      collect: async () => items,
    });
    await service.ensureIndexed('p');
    await service.drain();
    calls.length = 0;

    items = items.map((item) => (item.id === 'doc-2' ? { ...item, text: 'changed content' } : item));
    await service.ensureIndexed('p');
    await service.drain();
    expect(calls.flat()).toEqual(['changed content']);
  });

  it('pause keeps the queue and resume finishes it', async () => {
    const { provider } = fakeProvider();
    const store = memoryStore();
    const service = createFileIndexingService({
      store,
      chunker: createFileChunkingStrategy(),
      provider: async () => provider,
      collect: async () => corpus(8),
      batchSize: 1,
    });
    await service.ensureIndexed('p');
    service.pause();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const paused = service.status('p')[0];
    expect(paused.state).toBe('paused');
    expect(paused.queued).toBeGreaterThan(0);
    expect(paused.done).toBeLessThan(8);

    service.resume();
    await service.drain();
    expect(service.status('p')[0]).toMatchObject({ state: 'idle', done: 8, queued: 0 });
  });

  it('reports an honest disabled/error state when embeddings are unavailable', async () => {
    const service = createFileIndexingService({
      store: memoryStore(),
      chunker: createFileChunkingStrategy(),
      provider: async () => undefined,
      collect: async () => corpus(2),
    });
    await service.ensureIndexed('p');
    await service.drain();
    const status = service.status('p')[0];
    expect(status.state).toBe('error');
    expect(status.lastError).toMatch(/not available/i);
  });

  it('computes progress and rate with the injected clock', async () => {
    const { provider } = fakeProvider();
    let clock = 1_000;
    const service = createFileIndexingService({
      store: memoryStore(),
      chunker: createFileChunkingStrategy(),
      provider: async () => provider,
      collect: async () => corpus(10),
      now: () => (clock += 10),
    });
    await service.ensureIndexed('p');
    await service.drain();
    const status = service.status('p')[0];
    expect(status).toMatchObject({ state: 'idle', total: 10, done: 10 });
    expect(status.ratePerSec).toBeGreaterThan(0);
  });

  it('resumes from a persisted manifest without re-embedding', async () => {
    const root = tempRoot();
    const manifestPath = path.join(root, 'index-manifest.json');
    const first = fakeProvider();
    const store = createFileVectorStore({ root });
    const firstService = createFileIndexingService({
      store,
      chunker: createFileChunkingStrategy(),
      provider: async () => first.provider,
      collect: async () => corpus(3),
      manifestPath,
    });
    await firstService.ensureIndexed('p');
    await firstService.drain();
    expect(first.calls.flat()).toHaveLength(3);

    const second = fakeProvider();
    const secondService = createFileIndexingService({
      store: createFileVectorStore({ root }),
      chunker: createFileChunkingStrategy(),
      provider: async () => second.provider,
      collect: async () => corpus(3),
      manifestPath,
    });
    await secondService.ensureIndexed('p');
    await secondService.drain();
    expect(second.calls.flat()).toHaveLength(0);
    expect(secondService.status('p')[0].skipped).toBe(3);
  });

  it('indexes 10k items through the queue (scale smoke)', async () => {
    const { provider, calls } = fakeProvider();
    const store = memoryStore();
    const service = createFileIndexingService({
      store,
      chunker: createFileChunkingStrategy(),
      provider: async () => provider,
      collect: async () => corpus(10_000),
      batchSize: 64,
    });
    const startedAt = Date.now();
    await service.ensureIndexed('p');
    await service.drain();
    const elapsedMs = Date.now() - startedAt;
    expect(service.status('p')[0]).toMatchObject({ total: 10_000, done: 10_000, queued: 0 });
    expect(store.records).toHaveLength(10_000);
    expect(calls).toHaveLength(Math.ceil(10_000 / 64));
    expect(elapsedMs).toBeLessThan(60_000);
    // Recorded in the Y-03c decision: this is a smoke bound, not a throughput guarantee.
    expect(elapsedMs).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it('is wired into the file profile when a provider factory is supplied', async () => {
    const { provider } = fakeProvider();
    const root = tempRoot();
    const project = `y03c-${process.pid}`;
    const profile = createFileProfile({
      tasksDir: TASKS_DIR,
      knowledgeDir: KNOWLEDGE_DIR,
      vectorsDir: root,
      embeddingProvider: async () => provider,
    });
    expect(profile.indexing).toBeDefined();

    const doc = await profile.docs.create({ project, title: 'indexed doc', content: 'hello world' });
    await profile.indexing!.ensureIndexed(project);
    await (profile.indexing as unknown as { drain(): Promise<void> }).drain();

    const stats = await profile.vectors.stats();
    expect(stats.total).toBeGreaterThanOrEqual(1);
    expect(stats.collections[COLLECTION]).toBeGreaterThanOrEqual(1);
    await profile.docs.deletePermanent(project, doc.id);
  });

  it('embeddings_status carries the queue', () => {
    const payload = buildEmbeddingsStatus({
      config: { embeddings: { mode: 'none' } },
      adapterInitAttempted: false,
      adapterReady: false,
      warmup: [],
      collections: [],
      indexing: [
        { state: 'running', fingerprint: 'fp', project: 'p', total: 10, done: 4, queued: 6, ratePerSec: 12.5 },
      ],
    }) as { indexing: Array<{ state: string; queued: number }> };
    expect(payload.indexing).toEqual([
      expect.objectContaining({ state: 'running', queued: 6 }),
    ]);
  });
});
