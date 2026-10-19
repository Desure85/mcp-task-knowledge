import type { SearchResult } from '../types.js';
import { isStopword } from './stopwords.js';

/**
 * Relative IDF floor: a query term carrying less than this share of the most
 * informative term's IDF is ignored. This is the corpus-driven counterpart of the
 * stopword list — it adapts to any language and to the actual document collection,
 * so words like "how/to/from" need no entry in a hardcoded list on large corpora.
 */
function minIdfRatio(): number {
  const raw = Number(process.env.BM25_MIN_IDF_RATIO ?? 0.2);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0.2;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zA-Z0-9а-яА-ЯёЁ\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => !isStopword(token));
}

export function bm25Search<T>(
  corpus: Array<{ id: string; text: string; item: T }>,
  query: string,
  options?: { k1?: number; b?: number; limit?: number }
): SearchResult<T>[] {
  const k1 = options?.k1 ?? 1.5;
  const b = options?.b ?? 0.75;
  const limit = options?.limit ?? 20;

  const docs = corpus.map((d) => ({ ...d, tokens: tokenize(d.text) }));
  const N = docs.length || 1;
  const avgdl = docs.reduce((s, d) => s + d.tokens.length, 0) / N;

  const df = new Map<string, number>();
  for (const d of docs) {
    const seen = new Set<string>();
    for (const t of d.tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }

  const qTokens = Array.from(new Set(tokenize(query)));
  if (qTokens.length === 0) return [];
  const idfOf = (token: string): number => {
    const n_q = df.get(token) ?? 0.5;
    return Math.log(1 + (N - n_q + 0.5) / (n_q + 0.5));
  };
  const ratio = minIdfRatio();
  const maxIdf = Math.max(...qTokens.map(idfOf));
  const gated = ratio > 0 ? qTokens.filter((token) => idfOf(token) >= maxIdf * ratio) : qTokens;
  // Never gate away the whole query: a phrase made only of ubiquitous words should
  // still return something rather than an empty page.
  const queryTokens = gated.length > 0 ? gated : qTokens;
  const maxPossible = queryTokens.reduce((sum, token) => sum + idfOf(token) * (k1 + 1), 0);
  const results: Array<SearchResult<T>> = [];

  for (const d of docs) {
    let score = 0;
    const dl = d.tokens.length;
    const tf = new Map<string, number>();
    for (const t of d.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    for (const q of queryTokens) {
      const f = tf.get(q) ?? 0;
      if (f === 0) continue;
      const idf = idfOf(q);
      const denom = f + k1 * (1 - b + (b * dl) / avgdl);
      score += idf * ((f * (k1 + 1)) / denom);
    }

    if (score > 0) {
      const confidence = maxPossible > 0 ? score / maxPossible : 0;
      results.push({ id: d.id, score, item: d.item, bm25Confidence: confidence });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
