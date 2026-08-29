/**
 * proxy/response-cache.ts — ETag-based response cache (DX-005)
 *
 * Caches upstream tool responses by (tool, params) key with a TTL.
 * Entries carry an ETag (hash of the payload) so consumers can do
 * conditional requests; write operations invalidate matching entries.
 */

import { createHash } from 'node:crypto';

export interface CacheEntry<T> {
  value: T;
  etag: string;
  cachedAt: number;
  expiresAt: number;
}

export interface ResponseCacheOptions {
  /** Default TTL ms (default: 30_000). */
  ttlMs?: number;
  /** Max entries (default: 500, LRU eviction). */
  maxEntries?: number;
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  invalidations: number;
}

export class ResponseCache {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private hits = 0;
  private misses = 0;
  private invalidations = 0;

  constructor(options: ResponseCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 30_000;
    this.maxEntries = options.maxEntries ?? 500;
  }

  /** Cache key from tool name + params (stable JSON). */
  static key(tool: string, params: unknown): string {
    return `${tool}:${JSON.stringify(params ?? {})}`;
  }

  /** Compute an ETag for a value (short sha256). */
  static etag(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 16);
  }

  /** Get a fresh entry, or undefined if missing/expired. */
  get<T>(tool: string, params: unknown): CacheEntry<T> | undefined {
    const key = ResponseCache.key(tool, params);
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry;
  }

  /** Store a value (computes ETag). */
  set<T>(tool: string, params: unknown, value: T, ttlMs?: number): CacheEntry<T> {
    const key = ResponseCache.key(tool, params);
    const now = Date.now();
    const entry: CacheEntry<T> = {
      value,
      etag: ResponseCache.etag(value),
      cachedAt: now,
      expiresAt: now + (ttlMs ?? this.ttlMs),
    };
    this.store.set(key, entry as CacheEntry<unknown>);
    // LRU-ish eviction: drop oldest when over capacity
    if (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest) this.store.delete(oldest);
    }
    return entry;
  }

  /** Invalidate entries whose tool name starts with the prefix (e.g. write ops). */
  invalidate(toolPrefix: string): number {
    let count = 0;
    for (const key of this.store.keys()) {
      const tool = key.slice(0, key.indexOf(':'));
      if (tool.startsWith(toolPrefix)) {
        this.store.delete(key);
        count++;
      }
    }
    if (count > 0) this.invalidations += count;
    return count;
  }

  /** Clear everything. */
  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  stats(): CacheStats {
    return { size: this.store.size, hits: this.hits, misses: this.misses, invalidations: this.invalidations };
  }
}
