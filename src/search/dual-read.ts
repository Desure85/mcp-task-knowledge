/**
 * Y-03b — двойное чтение по двум коллекциям (ADR-009 §«Двойное чтение при смене модели»).
 *
 * Оценки разных моделей несравнимы, поэтому они не сливаются: сначала идут хиты активной
 * коллекции (в её собственном порядке), затем — документы, которых в активной коллекции ещё нет,
 * помеченные как `previous`. Документ, найденный в активной коллекции, никогда не дублируется
 * хитом из старой: правило покрытия — «нашёлся в новой, учитывается по новой».
 */

import type { VectorMatch, VectorStore } from './contracts.js';

export interface CollectionRef {
  id: string;
  fingerprint: string;
}

export interface DualReadOptions {
  store: VectorStore;
  query: Float32Array;
  active: CollectionRef;
  previous?: CollectionRef;
  limit: number;
  project?: string;
  kind?: 'task' | 'doc' | 'chunk';
  minScore?: number;
}

export interface DualReadHit extends VectorMatch {
  /** Which collection produced this hit. Scores across collections are not comparable. */
  collection: 'active' | 'previous';
}

export interface DualReadResult {
  hits: DualReadHit[];
  coverage: {
    active: number;
    previous: number;
    /** True when the active collection answered every hit the previous one would have. */
    activeCoversAll: boolean;
  };
}

function identityOf(match: VectorMatch): string {
  return `${match.store}|${match.kind}|${match.project}|${match.id}`;
}

export async function dualReadSearch(options: DualReadOptions): Promise<DualReadResult> {
  const activeHits = await options.store.query(options.query, {
    collection: options.active.id,
    fingerprint: options.active.fingerprint,
    limit: options.limit,
    project: options.project,
    kind: options.kind,
    minScore: options.minScore,
  });
  const active: DualReadHit[] = activeHits.map((hit) => ({ ...hit, collection: 'active' }));
  if (!options.previous) {
    return { hits: active, coverage: { active: active.length, previous: 0, activeCoversAll: true } };
  }

  const previousHits = await options.store.query(options.query, {
    collection: options.previous.id,
    fingerprint: options.previous.fingerprint,
    limit: options.limit,
    project: options.project,
    kind: options.kind,
    minScore: options.minScore,
  });
  const activeIds = new Set(activeHits.map(identityOf));
  const previousOnly: DualReadHit[] = previousHits
    .filter((hit) => !activeIds.has(identityOf(hit)))
    .map((hit) => ({ ...hit, collection: 'previous' }));

  return {
    // No cross-collection score sort: the two score scales are incomparable (ADR-009).
    hits: [...active, ...previousOnly],
    coverage: {
      active: active.length,
      previous: previousOnly.length,
      activeCoversAll: previousOnly.length === 0,
    },
  };
}
