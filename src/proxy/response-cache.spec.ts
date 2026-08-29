/**
 * proxy/response-cache.spec.ts — Tests for ETag response cache (DX-005).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ResponseCache } from './response-cache.js';

describe('DX-005: ResponseCache', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('misses then hits on same key', () => {
    const cache = new ResponseCache();
    expect(cache.get('tasks_list', { project: 'mcp' })).toBeUndefined();
    cache.set('tasks_list', { project: 'mcp' }, { tasks: [] });
    const hit = cache.get('tasks_list', { project: 'mcp' });
    expect(hit?.value).toEqual({ tasks: [] });
    expect(cache.stats().hits).toBe(1);
    expect(cache.stats().misses).toBe(1);
  });

  it('different params produce different entries', () => {
    const cache = new ResponseCache();
    cache.set('search_tasks', { query: 'a' }, { r: 1 });
    cache.set('search_tasks', { query: 'b' }, { r: 2 });
    expect(cache.size).toBe(2);
    expect(cache.get('search_tasks', { query: 'a' })?.value).toEqual({ r: 1 });
  });

  it('entries expire after TTL', () => {
    vi.useFakeTimers();
    const cache = new ResponseCache({ ttlMs: 100 });
    cache.set('t', {}, 'v');
    expect(cache.get('t', {})?.value).toBe('v');
    vi.advanceTimersByTime(150);
    expect(cache.get('t', {})).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('etag is stable for same value, differs for different', () => {
    expect(ResponseCache.etag({ a: 1 })).toBe(ResponseCache.etag({ a: 1 }));
    expect(ResponseCache.etag({ a: 1 })).not.toBe(ResponseCache.etag({ a: 2 }));
  });

  it('invalidate removes entries by tool prefix', () => {
    const cache = new ResponseCache();
    cache.set('tasks_create', {}, 'c');
    cache.set('tasks_list', {}, 'l');
    cache.set('knowledge_list', {}, 'k');
    const removed = cache.invalidate('tasks_');
    expect(removed).toBe(2);
    expect(cache.get('tasks_create', {})).toBeUndefined();
    expect(cache.get('tasks_list', {})).toBeUndefined();
    expect(cache.get('knowledge_list', {})?.value).toBe('k');
  });

  it('evicts oldest entry over maxEntries', () => {
    const cache = new ResponseCache({ maxEntries: 3 });
    cache.set('a', {}, 1);
    cache.set('b', {}, 2);
    cache.set('c', {}, 3);
    cache.set('d', {}, 4); // evicts 'a'
    expect(cache.size).toBe(3);
    expect(cache.get('a', {})).toBeUndefined();
    expect(cache.get('d', {})?.value).toBe(4);
  });

  it('clear removes everything', () => {
    const cache = new ResponseCache();
    cache.set('a', {}, 1);
    cache.set('b', {}, 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.stats().invalidations).toBe(0);
  });
});
