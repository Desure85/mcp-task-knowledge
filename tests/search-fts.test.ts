/**
 * SC-03a — FTS5 index over tasks and knowledge (storage layer).
 *
 * The point of the index is that query terms and indexed terms come from the *same* tokenizer as
 * the in-memory BM25 (`src/search/bm25.ts`), otherwise recall changes silently when the read path
 * switches over (SC-03c). These tests pin that parity together with filtering, upsert semantics
 * and schema handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { FtsSearchIndex, FTS_SCHEMA_VERSION, type FtsRecord } from '../src/search/fts-index.js';

let tmpDir: string;
let index: FtsSearchIndex;

function record(overrides: Partial<FtsRecord> & { id: string; text: string }): FtsRecord {
  return { kind: 'task', project: 'p', updatedAt: '2026-11-08T00:00:00.000Z', ...overrides };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc03a-'));
  index = FtsSearchIndex.open(path.join(tmpDir, 'search.db'));
});

afterEach(() => {
  index.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('SC-03a: tokenisation parity with in-memory BM25', () => {
  it('matches snake_case against camelCase and vice versa', () => {
    index.upsert([record({ id: 'a', text: 'call getUserProfile before saving' })]);
    expect(index.query({ q: 'get_user_profile' }).map((hit) => hit.id)).toEqual(['a']);

    index.upsert([record({ id: 'b', text: 'call get_user_profile before saving' })]);
    expect(index.query({ q: 'getUserProfile' }).map((hit) => hit.id)).toContain('b');
  });

  it('matches an inner segment of a camelCase identifier', () => {
    // Prefix expansion alone cannot rescue this: `getuserprofile` does not start with `user`, so
    // the case only passes when the index stores split identifiers (the BM25 tokenizer).
    index.upsert([record({ id: 'a', text: 'call getUserProfile before saving' })]);
    expect(index.query({ q: 'userProfile' }).map((hit) => hit.id)).toEqual(['a']);
  });

  it('matches acronym runs', () => {
    index.upsert([record({ id: 'a', text: 'the HTTPServer is down' })]);
    expect(index.query({ q: 'http server' }).map((hit) => hit.id)).toEqual(['a']);
  });

  it('matches a ticket id in both spellings', () => {
    index.upsert([record({ id: 'a', text: 'fixed in DEV-7613 yesterday' })]);
    expect(index.query({ q: 'DEV-7613' }).map((hit) => hit.id)).toEqual(['a']);
    expect(index.query({ q: 'dev 7613' }).map((hit) => hit.id)).toEqual(['a']);
  });

  it('matches Russian morphology-free terms', () => {
    index.upsert([record({ id: 'a', text: 'документы удаляются в архив' })]);
    expect(index.query({ q: 'документы архив' }).map((hit) => hit.id)).toEqual(['a']);
  });

  it('expands prefixes so `auth` finds `authentication`', () => {
    index.upsert([record({ id: 'a', text: 'the authentication module rejects expired tokens' })]);
    expect(index.query({ q: 'auth' }).map((hit) => hit.id)).toEqual(['a']);
  });

  it('returns nothing for a stopword-only query', () => {
    index.upsert([record({ id: 'a', text: 'the quick brown fox' })]);
    expect(index.query({ q: 'the and of' })).toEqual([]);
  });
});

describe('SC-03a: filtering and ranking', () => {
  it('filters by kind and project', () => {
    index.upsert([
      record({ id: 't1', text: 'auth token rotation', kind: 'task', project: 'alpha' }),
      record({ id: 'd1', text: 'auth token rotation', kind: 'doc', project: 'alpha' }),
      record({ id: 't2', text: 'auth token rotation', kind: 'task', project: 'beta' }),
    ]);
    expect(index.query({ q: 'auth rotation', kind: 'doc' }).map((hit) => `${hit.kind}:${hit.id}`)).toEqual(['doc:d1']);
    expect(index.query({ q: 'auth rotation', project: 'beta' }).map((hit) => hit.id)).toEqual(['t2']);
    expect(index.query({ q: 'auth rotation', kind: 'task', project: 'alpha' }).map((hit) => hit.id)).toEqual(['t1']);
  });

  it('ranks the document matching more query terms above a single-term match', () => {
    index.upsert([
      record({ id: 'both', text: 'authentication token rotation policy' }),
      record({ id: 'one', text: 'authentication guide' }),
    ]);
    const hits = index.query({ q: 'authentication token rotation' });
    expect(hits[0].id).toBe('both');
    expect(hits.map((hit) => hit.id)).toContain('one');
  });

  it('honours the limit', () => {
    const records = Array.from({ length: 10 }, (_, i) => record({ id: `r${i}`, text: `authentication ${i}` }));
    index.upsert(records);
    expect(index.query({ q: 'authentication', limit: 3 })).toHaveLength(3);
  });
});

describe('SC-03a: write semantics', () => {
  it('replaces the terms of an existing record', () => {
    index.upsert([record({ id: 'a', text: 'legacy behaviour' })]);
    expect(index.query({ q: 'legacy' })).toHaveLength(1);
    index.upsert([record({ id: 'a', text: 'modern behaviour' })]);
    expect(index.query({ q: 'legacy' })).toHaveLength(0);
    expect(index.query({ q: 'modern' }).map((hit) => hit.id)).toEqual(['a']);
    expect(index.stats().rows).toBe(1);
  });

  it('removes a single record', () => {
    index.upsert([record({ id: 'a', text: 'to be removed' }), record({ id: 'b', text: 'to be removed' })]);
    expect(index.remove('task', 'a')).toBe(true);
    expect(index.remove('task', 'a')).toBe(false);
    expect(index.query({ q: 'removed' }).map((hit) => hit.id)).toEqual(['b']);
  });

  it('rebuilds the whole index in one go', () => {
    index.upsert([record({ id: 'old', text: 'stale entry' })]);
    index.rebuild([record({ id: 'new', text: 'fresh entry' })]);
    expect(index.query({ q: 'stale' })).toEqual([]);
    expect(index.query({ q: 'fresh' }).map((hit) => hit.id)).toEqual(['new']);
    expect(index.stats().rows).toBe(1);
  });

  it('reports counts per kind', () => {
    index.upsert([record({ id: 't', text: 'a' }), record({ id: 'd', kind: 'doc', text: 'b' })]);
    const stats = index.stats();
    expect(stats).toMatchObject({ rows: 2, tasks: 1, docs: 1, schemaVersion: FTS_SCHEMA_VERSION });
    expect(stats.dbBytes).toBeGreaterThan(0);
  });
});

describe('SC-03a: schema handling', () => {
  it('drops and recreates the table when the stored schema version differs', () => {
    const file = path.join(tmpDir, 'versioned.db');
    const first = FtsSearchIndex.open(file);
    first.upsert([record({ id: 'a', text: 'before upgrade' })]);
    first.close();

    const raw = new Database(file);
    raw.prepare('UPDATE search_meta SET value = ? WHERE key = ?').run(String(FTS_SCHEMA_VERSION + 1), 'schema_version');
    raw.close();

    const second = FtsSearchIndex.open(file);
    expect(second.stats()).toMatchObject({ rows: 0, schemaVersion: FTS_SCHEMA_VERSION });
    expect(second.query({ q: 'upgrade' })).toEqual([]);
    second.close();
  });

  it('keeps data when the schema version matches', () => {
    const file = path.join(tmpDir, 'stable.db');
    const first = FtsSearchIndex.open(file);
    first.upsert([record({ id: 'a', text: 'survives restart' })]);
    first.close();

    const second = FtsSearchIndex.open(file);
    expect(second.query({ q: 'survives' }).map((hit) => hit.id)).toEqual(['a']);
    second.close();
  });
});
