import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isStopword, reloadStopwords } from '../search/stopwords.js';
import { bm25Search } from '../search/bm25.js';

const STOPWORDS_FILE = path.join(process.env.DATA_DIR as string, 'stopwords.txt');

const cleanup = () => {
  delete process.env.BM25_STOPWORDS;
  delete process.env.BM25_MIN_IDF_RATIO;
  try {
    fs.unlinkSync(STOPWORDS_FILE);
  } catch {}
  reloadStopwords();
};

afterEach(cleanup);

describe('stopwords', () => {
  it('filters common English and Russian words out of the box', () => {
    expect(isStopword('how')).toBe(true);
    expect(isStopword('the')).toBe(true);
    expect(isStopword('как')).toBe(true);
    expect(isStopword('storage')).toBe(false);
    expect(isStopword('хранилище')).toBe(false);
  });

  it('accepts extra words from DATA_DIR/stopwords.txt', () => {
    fs.writeFileSync(STOPWORDS_FILE, '# project jargon\nkubernetes\n  Sidekiq  # case-insensitive\n');
    reloadStopwords();

    expect(isStopword('kubernetes')).toBe(true);
    expect(isStopword('sidekiq')).toBe(true);
  });

  it('accepts extra words from BM25_STOPWORDS', () => {
    process.env.BM25_STOPWORDS = 'minio, retry';
    reloadStopwords();

    expect(isStopword('minio')).toBe(true);
    expect(isStopword('retry')).toBe(true);
  });
});

describe('corpus-driven IDF gate', () => {
  const corpus = Array.from({ length: 40 }, (_, i) => ({
    id: `d${i}`,
    text: i === 0 ? 'rare marker' : 'common filler',
    item: { id: `d${i}` },
  }));

  it('drops query terms that appear in almost every document', () => {
    const results = bm25Search(corpus, 'common rare', { limit: 40 });

    expect(results.map((r) => r.id)).toEqual(['d0']);
  });

  it('keeps such terms when the gate is disabled', () => {
    process.env.BM25_MIN_IDF_RATIO = '0';
    const results = bm25Search(corpus, 'common rare', { limit: 40 });

    expect(results.length).toBeGreaterThan(1);
  });
});
