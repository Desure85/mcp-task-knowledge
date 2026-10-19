import { describe, it, expect, vi } from 'vitest';
import { fuseRankings, hybridSearch, type VectorSearchAdapter } from '../search/index.js';
import type { SearchResult } from '../types.js';

type Item = { id: string; text: string; item: { title: string } };

const makeItem = (id: string, text: string): Item => ({ id, text, item: { title: id } });
const hit = (id: string, score: number): SearchResult<{ title: string }> => ({
  id,
  score,
  item: { title: id },
});

describe('fuseRankings (RRF)', () => {
  it('lifts a document ranked second by BM25 when the vector channel ranks it first', () => {
    const lexical = [hit('bm25-top', 9), hit('semantic-winner', 2)];
    const semantic = [hit('semantic-winner', 0.55)];

    const fused = fuseRankings(lexical, semantic, 5);

    expect(fused.map((r) => r.id)).toEqual(['semantic-winner', 'bm25-top']);
  });

  it('keeps the consensus document on top when both channels rank it well', () => {
    const lexical = [hit('both', 8), hit('lexical-only', 5)];
    const semantic = [hit('semantic-only', 0.7), hit('both', 0.6)];

    const fused = fuseRankings(lexical, semantic, 5);

    expect(fused[0].id).toBe('both');
  });

  it('normalizes the fused score to 1 for the top result and keeps raw channel scores', () => {
    const fused = fuseRankings([hit('a', 7.5)], [hit('a', 0.42)], 5);

    expect(fused[0].score).toBeCloseTo(1, 10);
    expect(fused[0].bm25Score).toBe(7.5);
    expect(fused[0].vectorScore).toBe(0.42);
  });

  it('drops zero and negative cosine matches from the semantic channel', () => {
    const fused = fuseRankings([hit('a', 1)], [hit('zero', 0), hit('negative', -0.2)], 5);

    expect(fused.map((r) => r.id)).toEqual(['a']);
  });

  it('truncates to the requested limit after fusion', () => {
    const lexical = Array.from({ length: 10 }, (_, i) => hit(`doc${i}`, 10 - i));

    expect(fuseRankings(lexical, [], 3)).toHaveLength(3);
  });
});

describe('hybridSearch', () => {
  const items: Item[] = [
    makeItem('storage-doc', 'documents storage cleanup'),
    makeItem('remove-doc', 'remove documents permanently'),
    makeItem('unrelated', 'billing invoices'),
  ];

  it('returns plain BM25 results when no vector adapter is configured', async () => {
    const results = await hybridSearch('remove documents storage', items, { limit: 5 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].bm25Score).toBeUndefined();
    expect(results[0].vectorScore).toBeUndefined();
  });

  it('uses the vector adapter to rerank and exposes both channel scores', async () => {
    const adapter: VectorSearchAdapter<{ title: string }> = {
      search: async () => [hit('unrelated', 0.9), hit('remove-doc', 0.8)],
    };

    const results = await hybridSearch('remove documents storage', items, {
      limit: 5,
      vectorAdapter: adapter,
    });

    const unrelated = results.find((r) => r.id === 'unrelated');
    expect(unrelated?.vectorScore).toBe(0.9);
    const lexicalTop = results.find((r) => r.bm25Score !== undefined);
    expect(lexicalTop).toBeDefined();
  });

  it('falls back to BM25 and reports the error when the adapter throws', async () => {
    const onVectorError = vi.fn();
    const adapter: VectorSearchAdapter<{ title: string }> = {
      search: async () => {
        throw new Error('embedding backend down');
      },
    };

    const results = await hybridSearch('remove documents storage', items, {
      limit: 5,
      vectorAdapter: adapter,
      onVectorError,
    });

    expect(onVectorError).toHaveBeenCalledTimes(1);
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns nothing for an empty item list', async () => {
    const adapter: VectorSearchAdapter<{ title: string }> = { search: async () => [] };

    await expect(hybridSearch('anything', [], { vectorAdapter: adapter })).resolves.toEqual([]);
  });
});

describe('lexical confidence floor', () => {
  it('ignores a weak lexical hit that would otherwise outrank the semantic winner', async () => {
    const items: Item[] = [
      makeItem('long-doc', `${'filler '.repeat(400)}storage`),
      makeItem('semantic-doc', 'archive removal'),
    ];
    const adapter: VectorSearchAdapter<{ title: string }> = {
      search: async () => [hit('semantic-doc', 0.64), hit('long-doc', 0.46)],
    };

    const results = await hybridSearch('how to permanently remove documents from storage', items, {
      limit: 5,
      vectorAdapter: adapter,
    });

    expect(results[0].id).toBe('semantic-doc');
  });

  it('keeps a confident lexical match in the fusion', async () => {
    const items: Item[] = [
      makeItem('exact-doc', 'archive trash restore flow'),
      makeItem('noise-doc', 'billing invoices'),
    ];
    const adapter: VectorSearchAdapter<{ title: string }> = {
      search: async () => [hit('noise-doc', 0.3)],
    };

    const results = await hybridSearch('archive trash restore flow', items, {
      limit: 5,
      vectorAdapter: adapter,
    });

    expect(results[0].id).toBe('exact-doc');
  });
});
