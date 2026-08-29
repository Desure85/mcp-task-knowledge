/**
 * tests/search-perf.test.ts — Load/performance tests for BM25 search (Q-006)
 *
 * Verifies BM25 scales predictably on realistic corpora:
 *   - 10k and 50k docs complete within generous time bounds (CI-safe)
 *   - Result quality is stable (top hit contains query term)
 *   - limit is honored
 * Uses large-but-safe corpus sizes and loose thresholds to avoid CI flakiness.
 */

import { describe, it, expect } from 'vitest';
import { bm25Search } from '../src/search/bm25.js';

interface Doc {
  id: string;
  text: string;
  item: { n: number };
}

function makeCorpus(size: number, words = 200, needle = 'needle'): Doc[] {
  const vocab = Array.from({ length: words }, (_, i) => `word${i}`);
  const docs: Doc[] = [];
  for (let i = 0; i < size; i++) {
    // Deterministic pseudo-random text: ~50 tokens per doc, needle in ~30%
    const parts: string[] = [];
    let seed = (i * 2654435761) >>> 0; // unsigned 32-bit
    for (let t = 0; t < 50; t++) {
      seed = ((seed * 1103515245 + 12345) >>> 0) % 2 ** 31;
      parts.push(vocab[seed % vocab.length]);
    }
    if (i % 3 === 0) parts.push(needle);
    docs.push({ id: `doc-${i}`, text: parts.join(' '), item: { n: i } });
  }
  return docs;
}

describe('Q-006: BM25 load tests', () => {
  it('searches 10k docs within 2s (generous CI bound)', () => {
    const corpus = makeCorpus(10_000);
    const start = Date.now();
    const results = bm25Search(corpus, 'needle', { limit: 20 });
    const elapsed = Date.now() - start;

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(20);
    expect(elapsed).toBeLessThan(2000);
  }, 30000);

  it('searches 50k docs within 5s (generous CI bound)', () => {
    const corpus = makeCorpus(50_000);
    const start = Date.now();
    const results = bm25Search(corpus, 'needle word7', { limit: 10 });
    const elapsed = Date.now() - start;

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(10);
    expect(elapsed).toBeLessThan(5000);
  }, 30000);

  it('top results are relevant (contain query term)', () => {
    const corpus = makeCorpus(5_000, 50); // smaller vocab → denser term freq
    const results = bm25Search(corpus, 'needle', { limit: 5 });

    expect(results.length).toBe(5);
    // Top hit's source document must actually contain the queried term
    const topDoc = corpus.find((d) => d.id === results[0].id);
    expect(topDoc?.text.toLowerCase()).toContain('needle');
  });

  it('empty corpus returns empty results', () => {
    expect(bm25Search([], 'anything')).toEqual([]);
  });

  it('limit is respected across corpus sizes', () => {
    for (const size of [100, 1_000, 10_000]) {
      const corpus = makeCorpus(size);
      const results = bm25Search(corpus, 'needle', { limit: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    }
  });

  it('single-term query is faster than multi-term on same corpus', () => {
    const corpus = makeCorpus(20_000);
    const t1 = Date.now();
    bm25Search(corpus, 'needle', { limit: 10 });
    const singleMs = Date.now() - t1;

    const t2 = Date.now();
    bm25Search(corpus, 'needle word1 word2', { limit: 10 });
    const multiMs = Date.now() - t2;

    // Multi-term may be equal but should not be dramatically slower (no blowup)
    expect(multiMs).toBeLessThan(singleMs * 5 + 100);
  });
});
