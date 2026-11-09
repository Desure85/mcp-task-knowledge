/**
 * tests/search-perf.test.ts — Load/performance tests for BM25 search (Q-006)
 *
 * Verifies BM25 scales predictably on realistic corpora:
 *   - per-document cost stays flat as the corpus grows (index lookup is O(1) per doc)
 *   - 10k and 50k searches stay under load-tolerant ceilings
 *   - result quality is stable (top hit contains query term)
 *   - limit is honored
 *
 * Why medians and per-doc ratios instead of one wall-clock sample: a single
 * Date.now() sample taken while the machine runs other jobs was measured 6-7x
 * slower than idle (50k: ~1s idle, up to 7s under contention), so an absolute
 * bound was a load test of the CI box, not of the search. A warm median removes
 * JIT/scheduler outliers, and the per-doc ratio is load-invariant: both sides
 * of the comparison are measured under the same pressure. Absolute ceilings are
 * kept as a coarse net for uniform regressions (a >10x slowdown still fails).
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
      parts.push(vocab[Math.floor(seed / 65536) % vocab.length]);
    }
    if (i % 3 === 0) parts.push(needle);
    docs.push({ id: `doc-${i}`, text: parts.join(' '), item: { n: i } });
  }
  return docs;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const SAMPLES = 3;

/** Yield to the event loop between samples: a long sync search starves the
 * worker's RPC channel, which vitest reports as an onTaskUpdate timeout. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Median of warm samples: one untimed call absorbs JIT and lazy allocation. */
async function measureMedianMs(run: () => void): Promise<number> {
  run();
  const samples: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    await yieldToEventLoop();
    const started = performance.now();
    run();
    samples.push(performance.now() - started);
  }
  return median(samples);
}

/** Idle cost is ~0.02ms/doc for both 10k and 50k; ceilings sit ~20x above it. */
const MAX_MS_PER_10K = 4000;
const MAX_MS_PER_50K = 12_000;
const MAX_PER_DOC_GROWTH = 3;

/**
 * Q-006 stability fix: CI neighbours cause CPU contention that drifts on a seconds scale, so a
 * small-then-large sequential pair can compare a quiet run with a throttled one (observed 3.6x on
 * the same code). Measuring the two corpora **interleaved, round by round**, cancels that drift:
 * each ratio is computed from measurements taken microseconds apart, and the median ratio is
 * robust to a single stalled round while still catching a super-linear regression.
 */
async function measurePerDocGrowth(
  small: ReturnType<typeof makeCorpus>,
  large: ReturnType<typeof makeCorpus>,
  rounds = 5,
): Promise<number> {
  bm25Search(small, 'needle', { limit: 20 }); // warm JIT and allocations for both sizes
  bm25Search(large, 'needle', { limit: 20 });
  const ratios: number[] = [];
  for (let round = 0; round < rounds; round += 1) {
    await yieldToEventLoop();
    const smallStarted = performance.now();
    bm25Search(small, 'needle', { limit: 20 });
    const smallMs = performance.now() - smallStarted;
    await yieldToEventLoop();
    const largeStarted = performance.now();
    bm25Search(large, 'needle', { limit: 20 });
    const largeMs = performance.now() - largeStarted;
    if (smallMs <= 0) continue;
    ratios.push(largeMs / large.length / (smallMs / small.length));
  }
  return median(ratios);
}

describe('Q-006: BM25 load tests', () => {
  it('searches 10k docs under the load-tolerant ceiling', async () => {
    const corpus = makeCorpus(10_000);
    const elapsed = await measureMedianMs(() => bm25Search(corpus, 'needle', { limit: 20 }));

    const results = bm25Search(corpus, 'needle', { limit: 20 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(20);
    expect(elapsed).toBeLessThan(MAX_MS_PER_10K);
  }, 120_000);

  it('keeps per-document cost flat when the corpus grows fivefold', async () => {
    const small = makeCorpus(2_000);
    const large = makeCorpus(10_000);
    const growth = await measurePerDocGrowth(small, large);

    expect(growth).toBeLessThan(MAX_PER_DOC_GROWTH);
  }, 180_000);

  it('searches 50k docs under the load-tolerant ceiling', async () => {
    const corpus = makeCorpus(50_000);
    const elapsed = await measureMedianMs(() => bm25Search(corpus, 'needle word7', { limit: 10 }));

    const results = bm25Search(corpus, 'needle word7', { limit: 10 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(10);
    expect(elapsed).toBeLessThan(MAX_MS_PER_50K);
  }, 180_000);

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

  it('single-term query is faster than multi-term on same corpus', async () => {
    const corpus = makeCorpus(20_000);
    const singleMs = await measureMedianMs(() => bm25Search(corpus, 'needle', { limit: 10 }));
    const multiMs = await measureMedianMs(() => bm25Search(corpus, 'needle word1 word2', { limit: 10 }));

    // Multi-term may be equal but should not be dramatically slower (no blowup)
    expect(multiMs).toBeLessThan(singleMs * 5 + 1000);
  }, 180_000);
});
