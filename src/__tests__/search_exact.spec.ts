import { describe, it, expect } from 'vitest';
import { extractAnchors, hybridSearch, type VectorSearchAdapter } from '../search/index.js';
import type { SearchResult } from '../types.js';

type Item = { id: string; text: string; item: { title: string } };
const make = (id: string, text: string): Item => ({ id, text, item: { title: id } });

const docs: Item[] = [
  make('exact', '- `common/messages/en/common.php:300`: key is overwritten by the en catalogue'),
  make('cluster', 'ALB locales live in common/messages/<loc>/*.php, untranslated means empty string'),
  make('ticket', 'DEV-7613 fixed the webhook retry logic'),
  make('symbol', 'SplitIdentifiers handles camelCase boundaries'),
];

const adapter: VectorSearchAdapter<{ title: string }> = {
  search: async (_q, items) => items.map((it, i) => ({ id: it.id, score: 0.9 - i * 0.1, item: it.item })) as SearchResult<{ title: string }>[],
};

describe('anchor extraction', () => {
  it('finds paths, symbols and ticket ids', () => {
    const anchors = extractAnchors('see common/messages/en/common.php:300, DEV-7613 and Api::normalizeDealStageSemantic');
    expect(anchors).toContain('common/messages/en/common.php:300');
    expect(anchors).toContain('dev-7613');
    expect(anchors).toContain('api::normalizedealstagesemantic');
  });

  it('returns nothing for natural language', () => {
    expect(extractAnchors('как удалить документ навсегда')).toEqual([]);
  });
});

describe('verbatim channel', () => {
  it('puts the document with the exact path first, ahead of vector leaders', async () => {
    const results = await hybridSearch('common/messages/en/common.php:300', docs, { limit: 4, vectorAdapter: adapter });
    expect(results[0].id).toBe('exact');
    expect(results[0].exactMatches).toBeGreaterThan(0);
  });

  it('prefers the ticket match for an id query', async () => {
    const results = await hybridSearch('DEV-7613', docs, { limit: 4, vectorAdapter: adapter });
    expect(results[0].id).toBe('ticket');
  });

  it('keeps normal ordering for queries without anchors', async () => {
    const results = await hybridSearch('how are locales stored', docs, { limit: 4, vectorAdapter: adapter });
    expect(results.every((r) => r.exactMatches === undefined)).toBe(true);
  });

  it('does not promote documents that only share generic tokens', async () => {
    const results = await hybridSearch('common/messages/en/common.php:300', docs, { limit: 4, vectorAdapter: adapter });
    expect(results.find((r) => r.id === 'cluster')?.exactMatches).toBeUndefined();
  });
});

describe('anchor-only lookup', () => {
  it('returns nothing when a bare ticket id is absent from the base', async () => {
    const results = await hybridSearch('DEV-7158', docs, { limit: 5, vectorAdapter: adapter });
    expect(results).toEqual([]);
  });

  it('still finds a bare ticket id that exists', async () => {
    const results = await hybridSearch('DEV-7613', docs, { limit: 5, vectorAdapter: adapter });
    expect(results[0].id).toBe('ticket');
  });

  it('does not suppress results when the query has extra words', async () => {
    const results = await hybridSearch('what happened in DEV-7158', docs, { limit: 5, vectorAdapter: adapter });
    expect(results.length).toBeGreaterThan(0);
  });
});
