import type { KnowledgeDoc, Task, SearchResult } from '../types.js';
import { bm25Search } from './bm25.js';

export interface VectorSearchAdapter<T> {
  // Optional adapter; if provided, used alongside BM25 and merged
  search(query: string, items: Array<{ id: string; text: string; item: T }>, opts?: { limit?: number }): Promise<SearchResult<T>[]>;
}

export async function searchBM25Only<T>(query: string, items: Array<{ id: string; text: string; item: T }>, limit = 20) {
  return bm25Search(items, query, { limit });
}

export async function hybridSearch<T>(
  query: string,
  items: Array<{ id: string; text: string; item: T }>,
  options?: { limit?: number; vectorAdapter?: VectorSearchAdapter<T> }
): Promise<SearchResult<T>[]> {
  const limit = options?.limit ?? 20;
  const bm25 = bm25Search(items, query, { limit });
  if (!options?.vectorAdapter) return bm25;
  try {
    const vec = await options.vectorAdapter.search(query, items, { limit });
    // Merge by id with score max
    const map = new Map<string, SearchResult<T>>();
    for (const r of [...bm25, ...vec]) {
      const existing = map.get(r.id);
      if (!existing || r.score > existing.score) map.set(r.id, r);
    }
    return Array.from(map.values()).sort((a, b) => b.score - a.score).slice(0, limit);
  } catch {
    return bm25;
  }
}

export function buildTextForTask(t: Task): string {
  return [t.title, t.description || '', (t.tags || []).join(' '), (t.links || []).join(' '), t.status, t.priority].join('\n');
}

export function buildTextForDoc(d: KnowledgeDoc): string {
  return [d.title, (d.tags || []).join(' '), d.content].join('\n');
}

// --- Two-stage (prefilter -> chunked) search for big knowledge docs ---

export interface ChunkingOptions {
  // Target size of chunk in characters (approx). Defaults to 2000.
  chunkSize?: number;
  // Overlap between adjacent chunks in characters. Defaults to 200.
  chunkOverlap?: number;
}

export interface TwoStageKnowledgeSearchOptions extends ChunkingOptions {
  // How many docs to pass to the second stage (chunked) search. Defaults to 30.
  prefilterLimit?: number;
  // Final result size to return. Defaults to 20.
  limit?: number;
  // Optional vector adapter for hybrid search per-chunk.
  vectorAdapter?: VectorSearchAdapter<{ doc: KnowledgeDoc; chunkIndex: number }>;
}

export function chunkText(text: string, opts?: ChunkingOptions): string[] {
  const size = Math.max(1, opts?.chunkSize ?? 2000);
  const overlap = Math.max(0, Math.min(size - 1, opts?.chunkOverlap ?? 200));
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + size);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - overlap;
  }
  return chunks;
}

export function buildChunksForDoc(d: KnowledgeDoc, opts?: ChunkingOptions): Array<{ id: string; text: string; item: { doc: KnowledgeDoc; chunkIndex: number } }> {
  const baseId = d.id;
  const chunks = chunkText(d.content || '', opts);
  if (chunks.length === 1) {
    return [{ id: `${baseId}#0`, text: buildTextForDoc(d), item: { doc: d, chunkIndex: 0 } }];
  }
  return chunks.map((c, idx) => ({ id: `${baseId}#${idx}`, text: [d.title, (d.tags || []).join(' '), c].join('\n'), item: { doc: d, chunkIndex: idx } }));
}

// Stage 1: doc-level BM25 to select top-M docs. Stage 2: chunked hybrid search only within those docs.
export async function twoStageHybridKnowledgeSearch(
  query: string,
  docs: KnowledgeDoc[],
  options?: TwoStageKnowledgeSearchOptions
): Promise<SearchResult<KnowledgeDoc>[]> {
  const prefilterLimit = options?.prefilterLimit ?? 30;
  const finalLimit = options?.limit ?? 20;

  // Stage 1: doc-level BM25
  const docItems = docs.map((d) => ({ id: d.id, text: buildTextForDoc(d), item: d }));
  const stage1 = await searchBM25Only(query, docItems, prefilterLimit);
  const stage1Docs = stage1.map((r) => r.item);

  // Stage 2: chunk within top-M docs
  const perDocChunks = stage1Docs.flatMap((d) => buildChunksForDoc(d, options));
  const chunkResults = await hybridSearch(query, perDocChunks, { limit: Math.max(finalLimit * 3, 50), vectorAdapter: options?.vectorAdapter });

  // Aggregate back to documents by taking the best chunk score per doc
  const bestByDoc = new Map<string, SearchResult<KnowledgeDoc>>();
  for (const r of chunkResults) {
    const docId = r.item.doc.id;
    const existing = bestByDoc.get(docId);
    const projected: SearchResult<KnowledgeDoc> = { id: docId, score: r.score, item: r.item.doc };
    if (!existing || projected.score > existing.score) bestByDoc.set(docId, projected);
  }
  return Array.from(bestByDoc.values()).sort((a, b) => b.score - a.score).slice(0, finalLimit);
}
