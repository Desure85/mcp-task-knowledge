import { describe, it, expect, vi } from 'vitest';
import { TtlLruCache } from '../search/cache.js';

describe('TtlLruCache', () => {
  it('returns values until the ttl expires', () => {
    vi.useFakeTimers();
    const cache = new TtlLruCache<string, number>(10, 60_000);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    vi.advanceTimersByTime(60_001);
    expect(cache.get('a')).toBeUndefined();
    vi.useRealTimers();
  });

  it('evicts the least recently used entry', () => {
    const cache = new TtlLruCache<string, number>(2, 60_000);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  it('treats ttl 0 as disabled', () => {
    const cache = new TtlLruCache<string, number>(10, 0);
    cache.set('a', 1);
    expect(cache.get('a')).toBeUndefined();
  });
});
