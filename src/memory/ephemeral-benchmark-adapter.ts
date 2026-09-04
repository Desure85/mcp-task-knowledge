/**
 * ephemeral-benchmark-adapter.ts — Ephemeral in-memory MemoryAdapter for the
 * benchmark harness MCP tool (WIRE-007).
 *
 * Keyword-match retrieval over an in-process Map. No persistence, no network,
 * no side effects — a `clear()` resets all state. Runs are millisecond-scale,
 * which keeps the synchronous `memory_benchmark_run` tool CI-friendly.
 *
 * For real-instance runs against a live server (BM25/vector path) use the
 * `npm run benchmark` CLI (NEXT2-007), not this adapter.
 */

import type {
  BenchmarkFact,
  BenchmarkResult,
  MemoryAdapter,
  MemoryScope,
} from './benchmarks.js';

/**
 * Ephemeral in-memory adapter with simple keyword-match retrieval.
 */
export class EphemeralBenchmarkAdapter implements MemoryAdapter {
  readonly name = 'ephemeral-inmemory';
  private readonly store = new Map<string, BenchmarkFact>();
  private counter = 0;

  async add(item: BenchmarkFact): Promise<string> {
    const id = item.id ?? `ephemeral-${this.counter++}`;
    this.store.set(id, { ...item, id });
    return id;
  }

  async search(
    query: string,
    opts?: { limit?: number; scope?: MemoryScope },
  ): Promise<BenchmarkResult[]> {
    const limit = opts?.limit ?? 10;
    const queryWords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    if (queryWords.length === 0) return [];

    return Array.from(this.store.values())
      .map((item) => {
        const haystack = `${item.content} ${item.title ?? ''}`.toLowerCase();
        let hits = 0;
        for (const word of queryWords) {
          if (haystack.includes(word)) hits += 1;
        }
        const result: BenchmarkResult = {
          id: item.id ?? '',
          content: item.content,
          title: item.title,
          score: hits / queryWords.length,
          tags: item.tags,
        };
        return result;
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async get(id: string): Promise<BenchmarkFact | null> {
    return this.store.get(id) ?? null;
  }

  async invalidate(id: string): Promise<void> {
    const item = this.store.get(id);
    if (item) {
      this.store.set(id, { ...item, validTo: new Date().toISOString() });
    }
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}
