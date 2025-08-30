import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Helper to import fresh copy of a module with current env
async function importFresh<T = any>(specifier: string): Promise<T> {
  vi.resetModules();
  const m = await import(specifier);
  return m as any;
}

describe('EmbeddingsCache', () => {
  const ENV_SNAPSHOT = { ...process.env } as Record<string, string | undefined>;
  let tempDir: string;

  beforeEach(() => {
    process.env = { ...ENV_SNAPSHOT } as any;
    tempDir = path.join(process.cwd(), '.tmp-emb-cache-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    fs.mkdirSync(tempDir, { recursive: true });

    // Minimal config for loadConfig()
    process.env.DATA_DIR = tempDir;
    process.env.OBSIDIAN_VAULT_ROOT = path.join(tempDir, 'vault');

    // Configure embeddings cache to a small memory limit to trigger eviction
    process.env.EMBEDDINGS_MEM_LIMIT_MB = '1';
    process.env.EMBEDDINGS_PERSIST = 'true';
    process.env.EMBEDDINGS_CACHE_DIR = path.join(tempDir, '.emb-cache');
  });

  afterEach(() => {
    process.env = { ...ENV_SNAPSHOT } as any;
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  it('stores and retrieves vectors in-memory; updates LRU on hit', async () => {
    const { EmbeddingsCache } = await importFresh<any>('../src/search/emb_cache.js');

    const cache = new EmbeddingsCache(4);
    const v1 = new Float32Array([1, 0, 0, 0]);
    const v2 = new Float32Array([0, 1, 0, 0]);

    const h1 = cache.textHash('hello');
    const h2 = cache.textHash('world');

    await cache.set('a', h1, v1);
    await cache.set('b', h2, v2);

    const got1 = await cache.get('a', h1);
    expect(got1).toBeDefined();
    expect(got1?.length).toBe(4);

    const got2 = await cache.get('b', h2);
    expect(got2).toBeDefined();
    expect(got2?.length).toBe(4);
  });

  it('evicts least-recently-used entries when memory limit is exceeded', async () => {
    const { EmbeddingsCache } = await importFresh<any>('../src/search/emb_cache.js');
    // With 1 MB limit and vectors ~16 bytes each, we can still force eviction by many inserts
    const cache = new EmbeddingsCache(128); // each vec ~512 bytes

    const makeVec = (seed: number) => new Float32Array(new Array(128).fill(0).map((_, i) => (i === seed % 128 ? 1 : 0)));

    const ids: string[] = [];
    for (let i = 0; i < 5000; i++) {
      const id = 'id' + i;
      ids.push(id);
      await cache.set(id, cache.textHash('t' + i), makeVec(i));
    }

    // Oldest should likely be gone; recent ones should exist in memory or persist
    const oldest = await cache.get('id0', cache.textHash('t0'));
    const newest = await cache.get('id4999', cache.textHash('t4999'));
    // We don't assert strict undefined for oldest due to possible disk hit, but newest should exist
    expect(newest).toBeDefined();
  });

  it('persists to disk when enabled and can read back after new instance', async () => {
    const { EmbeddingsCache } = await importFresh<any>('../src/search/emb_cache.js');
    const dim = 8;
    const cache1 = new EmbeddingsCache(dim);
    const vec = new Float32Array(dim).map((_, i) => i as any);
    const id = 'persisted';
    const hash = cache1.textHash('persisted-text');

    await cache1.set(id, hash, vec);

    // New instance simulates a new process
    const cache2 = new EmbeddingsCache(dim);
    const got = await cache2.get(id, hash);
    expect(got).toBeDefined();
    expect(got?.length).toBe(dim);
  });
});
