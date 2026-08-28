/**
 * behavioral/fts-search.spec.ts — Tests for FtsMemorySearch (BM-014).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { FtsMemorySearch } from './fts-search.js';
import type { FtsRecord } from './fts-search.js';

let testDir: string;

function makeFts(path?: string): FtsMemorySearch {
  return new FtsMemorySearch({ databasePath: path ?? ':memory:' });
}

const SAMPLE_INTENT = {
  memoryId: 'intent-abc1',
  prompt: 'Add rate limiting to auth endpoint',
  file: 'src/auth.ts',
  timestamp: '2026-01-15T10:00:00.000Z',
  tags: ['security', 'auth'],
  context: { task: 'SEC-005' },
};

const SAMPLE_FAILURE = {
  failureId: 'fail-001',
  memoryId: 'intent-abc1',
  errorType: 'TypeError',
  message: 'Cannot read property x of undefined in auth handler',
  stack: 'at AuthHandler.check (src/auth.ts:42:9)',
  timestamp: '2026-01-16T12:00:00.000Z',
  resolved: false,
  context: { input: 'bad request' },
};

const SAMPLE_RESOLUTION = {
  resolutionId: 'res-001',
  failureId: 'fail-001',
  fixingMemoryId: 'intent-abc1',
  approach: 'Added null check before property access in auth handler',
  failedApproaches: ['Tried optional chaining — still crashed'],
  timestamp: '2026-01-17T14:00:00.000Z',
  metadata: { commitSha: 'abc1234' },
};

describe('BM-014: FtsMemorySearch', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `fts-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('indexing', () => {
    it('indexes and counts records', () => {
      const fts = makeFts();
      fts.indexIntent(SAMPLE_INTENT);
      fts.indexFailure(SAMPLE_FAILURE);
      fts.indexResolution(SAMPLE_RESOLUTION);
      expect(fts.count).toBe(3);
      fts.close();
    });

    it('re-indexing the same rowId replaces the record', () => {
      const fts = makeFts();
      fts.indexIntent(SAMPLE_INTENT);
      fts.indexIntent({ ...SAMPLE_INTENT, prompt: 'Updated prompt about caching' });
      expect(fts.count).toBe(1);
      const res = fts.query({ query: 'caching' });
      expect(res.total).toBe(1);
      expect(res.rows[0].recordId).toBe('intent-abc1');
      fts.close();
    });

    it('removes records by rowId', () => {
      const fts = makeFts();
      fts.indexIntent(SAMPLE_INTENT);
      expect(fts.remove('intent:intent-abc1')).toBe(true);
      expect(fts.count).toBe(0);
      expect(fts.remove('intent:intent-abc1')).toBe(false);
      fts.close();
    });
  });

  describe('query — natural language search', () => {
    it('finds records by keyword', () => {
      const fts = makeFts();
      fts.indexIntent(SAMPLE_INTENT);
      fts.indexFailure(SAMPLE_FAILURE);
      fts.indexResolution(SAMPLE_RESOLUTION);

      const res = fts.query({ query: 'auth' });
      // intent (prompt), failure (message+stack), resolution (approach) all mention auth
      expect(res.total).toBeGreaterThanOrEqual(2);
      fts.close();
    });

    it('finds by multi-word phrase', () => {
      const fts = makeFts();
      fts.indexIntent(SAMPLE_INTENT);
      const res = fts.query({ query: 'rate limiting' });
      expect(res.total).toBe(1);
      expect(res.rows[0].kind).toBe('intent');
      fts.close();
    });

    it('returns empty for no matches', () => {
      const fts = makeFts();
      fts.indexIntent(SAMPLE_INTENT);
      const res = fts.query({ query: 'kubernetes' });
      expect(res.total).toBe(0);
      expect(res.rows).toEqual([]);
      fts.close();
    });

    it('sanitizes special characters in query', () => {
      const fts = makeFts();
      fts.indexIntent(SAMPLE_INTENT);
      // Slashes and parens would break FTS5 syntax if not sanitized
      const res = fts.query({ query: 'auth/endpoint (test)' });
      expect(res.total).toBeGreaterThanOrEqual(0); // no crash
      fts.close();
    });

    it('passes through raw FTS5 syntax when user provides quoted phrase', () => {
      const fts = makeFts();
      fts.indexIntent(SAMPLE_INTENT);
      const res = fts.query({ query: '"rate limiting"' });
      expect(res.total).toBe(1);
      fts.close();
    });
  });

  describe('query — filters', () => {
    beforeEach(() => {
      // populate in each test via closure
    });

    it('filters by kind', () => {
      const fts = makeFts();
      fts.indexIntent(SAMPLE_INTENT);
      fts.indexFailure(SAMPLE_FAILURE);
      fts.indexResolution(SAMPLE_RESOLUTION);

      const onlyFailures = fts.query({ query: 'auth', kind: 'failure' });
      expect(onlyFailures.total).toBe(1);
      expect(onlyFailures.rows[0].kind).toBe('failure');

      const onlyIntents = fts.query({ query: 'auth', kind: 'intent' });
      expect(onlyIntents.total).toBe(1);
      expect(onlyIntents.rows[0].kind).toBe('intent');
      fts.close();
    });

    it('filters by file_path', () => {
      const fts = makeFts();
      fts.indexIntent(SAMPLE_INTENT);
      fts.indexIntent({ ...SAMPLE_INTENT, memoryId: 'intent-2', file: 'src/other.ts' });

      const res = fts.query({ query: 'rate', filePath: 'src/auth.ts' });
      expect(res.total).toBe(1);
      expect(res.rows[0].recordId).toBe('intent-abc1');
      fts.close();
    });

    it('filters by status', () => {
      const fts = makeFts();
      fts.indexFailure(SAMPLE_FAILURE);
      fts.indexFailure({ ...SAMPLE_FAILURE, failureId: 'fail-2', resolved: true });

      const unresolved = fts.query({ query: 'TypeError', status: 'unresolved' });
      expect(unresolved.total).toBe(1);
      expect(unresolved.rows[0].recordId).toBe('fail-001');

      const resolved = fts.query({ query: 'TypeError', status: 'resolved' });
      expect(resolved.total).toBe(1);
      expect(resolved.rows[0].recordId).toBe('fail-2');
      fts.close();
    });

    it('filters by since/until date range', () => {
      const fts = makeFts();
      fts.indexIntent(SAMPLE_INTENT);          // 2026-01-15
      fts.indexFailure(SAMPLE_FAILURE);        // 2026-01-16
      fts.indexResolution(SAMPLE_RESOLUTION);  // 2026-01-17

      const since = fts.query({ query: 'auth', since: '2026-01-16T00:00:00.000Z' });
      expect(since.total).toBe(2); // failure + resolution

      const until = fts.query({ query: 'auth', until: '2026-01-16T23:59:59.000Z' });
      expect(until.total).toBe(2); // intent + failure

      const range = fts.query({
        query: 'auth',
        since: '2026-01-16T00:00:00.000Z',
        until: '2026-01-16T23:59:59.000Z',
      });
      expect(range.total).toBe(1); // failure only
      fts.close();
    });
  });

  describe('query — pagination', () => {
    it('paginates results', () => {
      const fts = makeFts();
      // Index 25 intents that all match "auth"
      for (let i = 0; i < 25; i++) {
        fts.indexIntent({
          ...SAMPLE_INTENT,
          memoryId: `intent-${i}`,
          timestamp: new Date(2026, 0, 15 + i).toISOString(),
        });
      }

      const page1 = fts.query({ query: 'auth', page: 1, pageSize: 10 });
      expect(page1.total).toBe(25);
      expect(page1.page).toBe(1);
      expect(page1.pageSize).toBe(10);
      expect(page1.totalPages).toBe(3);
      expect(page1.rows).toHaveLength(10);

      const page2 = fts.query({ query: 'auth', page: 2, pageSize: 10 });
      expect(page2.rows).toHaveLength(10);

      const page3 = fts.query({ query: 'auth', page: 3, pageSize: 10 });
      expect(page3.rows).toHaveLength(5);
      fts.close();
    });

    it('returns empty rows for out-of-range page', () => {
      const fts = makeFts();
      fts.indexIntent(SAMPLE_INTENT);
      const res = fts.query({ query: 'auth', page: 99, pageSize: 10 });
      expect(res.total).toBe(1);
      expect(res.rows).toEqual([]);
      fts.close();
    });
  });

  describe('query — result shape', () => {
    it('returns snippet in body field', () => {
      const fts = makeFts();
      fts.indexIntent(SAMPLE_INTENT);
      const res = fts.query({ query: 'rate' });
      expect(res.rows[0].body).toContain('rate');
      fts.close();
    });

    it('preserves metadata fields', () => {
      const fts = makeFts();
      fts.indexIntent(SAMPLE_INTENT);
      const res = fts.query({ query: 'rate' });
      const row = res.rows[0];
      expect(row.kind).toBe('intent');
      expect(row.recordId).toBe('intent-abc1');
      expect(row.filePath).toBe('src/auth.ts');
      expect(row.timestamp).toBe(SAMPLE_INTENT.timestamp);
      fts.close();
    });
  });

  describe('persistence', () => {
    it('persists index to disk', () => {
      const dbPath = join(testDir, 'fts.db');
      const fts1 = makeFts(dbPath);
      fts1.indexIntent(SAMPLE_INTENT);
      fts1.close();

      const fts2 = makeFts(dbPath);
      expect(fts2.count).toBe(1);
      const res = fts2.query({ query: 'rate' });
      expect(res.total).toBe(1);
      fts2.close();
    });
  });

  describe('raw FtsRecord indexing', () => {
    it('accepts raw FtsRecord objects', () => {
      const fts = makeFts();
      const record: FtsRecord = {
        rowId: 'custom:1',
        kind: 'intent',
        recordId: 'custom-1',
        filePath: 'src/x.ts',
        status: '',
        timestamp: '2026-02-01T00:00:00.000Z',
        body: 'custom searchable text about deployments',
      };
      fts.index(record);
      const res = fts.query({ query: 'deployments' });
      expect(res.total).toBe(1);
      expect(res.rows[0].recordId).toBe('custom-1');
      fts.close();
    });
  });
});
