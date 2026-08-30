/**
 * sync/conflict-resolver.spec.ts — Tests for 3-way merge (SYNC-003)
 */

import { describe, it, expect } from 'vitest';
import { threeWayMerge } from './conflict-resolver.js';

describe('SYNC-003: 3-way merge', () => {
  it('no conflict when local == remote', () => {
    const result = threeWayMerge({
      base: { title: 'old', status: 'pending' },
      local: { title: 'new', status: 'pending' },
      remote: { title: 'new', status: 'pending' },
    });
    expect(result.conflict).toBe(false);
    expect(result.merged.title).toBe('new');
  });

  it('no conflict when only local changed', () => {
    const result = threeWayMerge({
      base: { title: 'old', status: 'pending' },
      local: { title: 'local-change', status: 'pending' },
      remote: { title: 'old', status: 'pending' },
    });
    expect(result.conflict).toBe(false);
    expect(result.merged.title).toBe('local-change');
  });

  it('no conflict when only remote changed', () => {
    const result = threeWayMerge({
      base: { title: 'old', status: 'pending' },
      local: { title: 'old', status: 'pending' },
      remote: { title: 'old', status: 'closed' },
    });
    expect(result.conflict).toBe(false);
    expect(result.merged.status).toBe('closed');
  });

  it('conflict when both changed differently', () => {
    const result = threeWayMerge({
      base: { title: 'old', status: 'pending' },
      local: { title: 'local', status: 'pending' },
      remote: { title: 'remote', status: 'pending' },
    });
    expect(result.conflict).toBe(true);
    expect(result.conflictingFields).toContain('title');
  });

  it('last-write-wins uses timestamps', () => {
    const result = threeWayMerge({
      base: { title: 'old', updatedAt: '2026-01-01T00:00:00.000Z' },
      local: { title: 'local', updatedAt: '2026-01-02T00:00:00.000Z' },
      remote: { title: 'remote', updatedAt: '2026-01-03T00:00:00.000Z' },
    }, 'last-write-wins');
    expect(result.merged.title).toBe('remote'); // remote is newer
  });

  it('local-wins strategy takes local on conflict', () => {
    const result = threeWayMerge({
      base: { title: 'old' },
      local: { title: 'local' },
      remote: { title: 'remote' },
    }, 'local-wins');
    expect(result.merged.title).toBe('local');
  });

  it('remote-wins strategy takes remote on conflict', () => {
    const result = threeWayMerge({
      base: { title: 'old' },
      local: { title: 'local' },
      remote: { title: 'remote' },
    }, 'remote-wins');
    expect(result.merged.title).toBe('remote');
  });

  it('manual strategy sets null on conflict', () => {
    const result = threeWayMerge({
      base: { title: 'old' },
      local: { title: 'local' },
      remote: { title: 'remote' },
    }, 'manual');
    expect(result.merged.title).toBeNull();
  });

  it('handles null base (first sync)', () => {
    const result = threeWayMerge({
      base: null,
      local: { title: 'local', tags: ['a'] },
      remote: { title: 'remote', tags: ['a'] },
    });
    expect(result.conflict).toBe(true);
    expect(result.conflictingFields).toContain('title');
    expect(result.merged.tags).toEqual(['a']); // non-conflicting
  });

  it('handles nested objects (top-level field conflict)', () => {
    const result = threeWayMerge({
      base: { meta: { author: 'old', version: 1 } },
      local: { meta: { author: 'local', version: 1 } },
      remote: { meta: { author: 'old', version: 2 } },
    });
    // meta is a single field at top level — both changed it → conflict
    expect(result.conflict).toBe(true);
    expect(result.conflictingFields).toContain('meta');
    // last-write-wins: no timestamps on root → takes remote
    expect(result.merged.meta.version).toBe(2);
  });
});
