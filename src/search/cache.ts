/**
 * Small LRU with per-entry TTL. Used for two things: query embeddings (expensive,
 * ~47 ms each) and ranked id lists (cheap to slice, expensive to recompute).
 */
export class TtlLruCache<K, V> {
  private entries = new Map<K, { value: V; expiresAt: number }>();

  constructor(private readonly maxEntries: number, private readonly ttlMs: number) {}

  get(key: K): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as K;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
