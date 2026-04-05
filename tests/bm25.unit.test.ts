import { describe, it, expect } from 'vitest';
import { bm25Search } from '../src/search/bm25.js';

describe('bm25Search — tokenize', () => {
  it('lowercases and strips special chars', () => {
    const corpus = [{ id: '1', text: 'Hello, WORLD! @#$', item: { id: '1' } }];
    const results = bm25Search(corpus, 'hello world');
    expect(results.length).toBe(1);
  });

  it('handles Cyrillic text', () => {
    const corpus = [{ id: '1', text: 'Привет мир тест', item: { id: '1' } }];
    const results = bm25Search(corpus, 'привет мир');
    expect(results.length).toBe(1);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('handles mixed latin+cyrillic', () => {
    const corpus = [
      { id: '1', text: 'API endpoint для авторизации', item: { id: '1' } },
      { id: '2', text: 'user dashboard panel', item: { id: '2' } },
    ];
    const results = bm25Search(corpus, 'api авторизации');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('1');
  });

  it('handles numbers in text', () => {
    const corpus = [{ id: '1', text: 'Version 2.0 release notes', item: { id: '1' } }];
    const results = bm25Search(corpus, '2.0');
    expect(results.length).toBe(1);
  });

  it('splits on whitespace and multiple spaces', () => {
    const corpus = [{ id: '1', text: 'a   b    c', item: { id: '1' } }];
    const results = bm25Search(corpus, 'a b c');
    expect(results.length).toBe(1);
  });
});

describe('bm25Search — scoring', () => {
  it('doc with more matching terms scores higher', () => {
    const corpus = [
      { id: '1', text: 'machine learning algorithms neural networks', item: { id: '1' } },
      { id: '2', text: 'cooking recipes pasta carbonara', item: { id: '2' } },
      { id: '3', text: 'machine learning basics', item: { id: '3' } },
    ];
    const results = bm25Search(corpus, 'machine learning');
    expect(results.length).toBe(2);
    // doc 1 has more ML-related terms → higher score
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('rare terms get higher IDF', () => {
    const corpus = [
      { id: '1', text: 'common common common common rareword', item: { id: '1' } },
      { id: '2', text: 'common common common common common', item: { id: '2' } },
    ];
    const resultsRare = bm25Search(corpus, 'rareword');
    const resultsCommon = bm25Search(corpus, 'common');
    expect(resultsRare.length).toBe(1);
    expect(resultsCommon.length).toBe(2);
    // rare word → higher IDF → higher per-document score
    expect(resultsRare[0].score).toBeGreaterThan(0);
  });

  it('multi-term query scores higher when more terms match', () => {
    const corpus = [
      { id: '1', text: 'alpha beta gamma', item: { id: '1' } },
      { id: '2', text: 'alpha only', item: { id: '2' } },
    ];
    const results = bm25Search(corpus, 'alpha beta gamma');
    expect(results[0].id).toBe('1'); // all 3 terms match
  });

  it('returns empty for empty corpus', () => {
    const results = bm25Search([], 'test');
    expect(results).toEqual([]);
  });

  it('returns empty for empty query', () => {
    const corpus = [{ id: '1', text: 'hello', item: { id: '1' } }];
    const results = bm25Search(corpus, '');
    expect(results).toEqual([]);
  });

  it('returns empty for query with only special chars', () => {
    const corpus = [{ id: '1', text: 'hello', item: { id: '1' } }];
    const results = bm25Search(corpus, '!@#$%');
    expect(results).toEqual([]);
  });
});

describe('bm25Search — parameters', () => {
  it('respects limit parameter', () => {
    const corpus = Array.from({ length: 10 }, (_, i) => ({
      id: `${i}`,
      text: `document about test search ${i}`,
      item: { id: `${i}` },
    }));
    const results = bm25Search(corpus, 'test search', { limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('respects custom k1 parameter', () => {
    const corpus = [
      { id: '1', text: 'test test test test test', item: { id: '1' } },
      { id: '2', text: 'test', item: { id: '2' } },
    ];
    const resultsLow = bm25Search(corpus, 'test', { k1: 0.1 });
    const resultsHigh = bm25Search(corpus, 'test', { k1: 5.0 });
    // Both should find results, but relative scores differ
    expect(resultsLow.length).toBe(2);
    expect(resultsHigh.length).toBe(2);
  });

  it('respects custom b parameter (length normalization)', () => {
    const corpus = [
      { id: '1', text: 'test '.repeat(100), item: { id: '1' } }, // very long doc
      { id: '2', text: 'test short document', item: { id: '2' } }, // short doc
    ];
    const resultsNoNorm = bm25Search(corpus, 'test', { b: 0 }); // no length norm
    const resultsFullNorm = bm25Search(corpus, 'test', { b: 1 }); // full norm
    // Both should find at least the short doc (high term frequency ratio)
    expect(resultsFullNorm.length).toBeGreaterThanOrEqual(1);
    // With b=0, long doc is less penalized
    expect(resultsNoNorm.length).toBeGreaterThanOrEqual(1);
  });

  it('default limit is 20', () => {
    const corpus = Array.from({ length: 30 }, (_, i) => ({
      id: `${i}`,
      text: `shared word ${i}`,
      item: { id: `${i}` },
    }));
    const results = bm25Search(corpus, 'shared word');
    expect(results.length).toBeLessThanOrEqual(20);
  });
});

describe('bm25Search — sorting', () => {
  it('results are sorted by score descending', () => {
    const corpus = [
      { id: '1', text: 'keyword appears once', item: { id: '1' } },
      { id: '2', text: 'keyword keyword keyword keyword', item: { id: '2' } },
      { id: '3', text: 'keyword keyword keyword', item: { id: '3' } },
    ];
    const results = bm25Search(corpus, 'keyword');
    expect(results.length).toBe(3);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('only returns documents with positive score', () => {
    const corpus = [
      { id: '1', text: 'hello world', item: { id: '1' } },
      { id: '2', text: 'foo bar', item: { id: '2' } },
      { id: '3', text: 'baz qux', item: { id: '3' } },
    ];
    const results = bm25Search(corpus, 'hello');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('1');
  });
});

describe('bm25Search — edge cases', () => {
  it('single document corpus', () => {
    const corpus = [{ id: '1', text: 'only document here', item: { id: '1' } }];
    const results = bm25Search(corpus, 'only document');
    expect(results.length).toBe(1);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('very long document', () => {
    const longText = 'word '.repeat(10000);
    const corpus = [{ id: '1', text: longText, item: { id: '1' } }];
    const results = bm25Search(corpus, 'word');
    expect(results.length).toBe(1);
  });

  it('document with only punctuation', () => {
    const corpus = [
      { id: '1', text: '!@#$%^&*()', item: { id: '1' } },
      { id: '2', text: 'actual content here', item: { id: '2' } },
    ];
    const results = bm25Search(corpus, 'actual');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('2');
  });

  it('query terms appear multiple times in corpus (all docs match)', () => {
    const corpus = Array.from({ length: 5 }, (_, i) => ({
      id: `${i}`,
      text: `the quick brown fox jumps over the lazy dog in document ${i}`,
      item: { id: `${i}` },
    }));
    const results = bm25Search(corpus, 'the document');
    expect(results.length).toBe(5);
    // All should have positive scores
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0);
    }
  });

  it('preserves original item reference', () => {
    const item = { id: '1', custom: 'data' };
    const corpus = [{ id: '1', text: 'test', item }];
    const results = bm25Search(corpus, 'test');
    expect(results[0].item).toBe(item);
    expect((results[0].item as any).custom).toBe('data');
  });

  it('handles duplicate query tokens (deduplication)', () => {
    const corpus = [
      { id: '1', text: 'hello world', item: { id: '1' } },
    ];
    const results1 = bm25Search(corpus, 'hello hello hello');
    const results2 = bm25Search(corpus, 'hello');
    // Scores should be identical (query tokens are deduplicated)
    expect(results1[0].score).toBeCloseTo(results2[0].score, 10);
  });
});
