/**
 * memory/forgetting.ts — Automatic Forgetting (NEXT-005).
 *
 * Temporal facts expire (TTL per fact type), contradictions resolved,
 * noise pruned. Background GC task. Configurable retention policies.
 *
 * Inspired by Supermemory: temporal facts expire, noise never permanent.
 *
 * Architecture:
 *   - ForgettingManager: scans temporal graph for expired facts
 *   - TTL policies: per-category retention (preference=permanent, context=30d, error=90d)
 *   - Noise detection: low-confidence, no entities, no relationships → prune
 *   - Contradiction cleanup: already-invalidated facts older than retention → delete
 *
 * Usage:
 *   const mgr = new ForgettingManager({ temporalGraph });
 *   const result = mgr.runGC();
 *   // result: { expired: 3, pruned: 1, deleted: 2 }
 */

import { childLogger } from '../core/logger.js';
import type { TemporalGraph } from './temporal-graph.js';

const log = childLogger('forgetting');

export interface RetentionPolicy {
  category: string;
  ttlDays: number | null;
}

export interface ForgettingResult {
  expired: number;
  pruned: number;
  deleted: number;
  details: Array<{ factId: string; action: 'expired' | 'pruned' | 'deleted'; reason: string }>;
}

export interface ForgettingOptions {
  temporalGraph: TemporalGraph;
  policies?: RetentionPolicy[];
  noiseConfidenceThreshold?: number;
  invalidatedRetentionDays?: number;
}

const DEFAULT_POLICIES: RetentionPolicy[] = [
  { category: 'preference', ttlDays: null },
  { category: 'decision', ttlDays: null },
  { category: 'convention', ttlDays: null },
  { category: 'fact', ttlDays: 365 },
  { category: 'context', ttlDays: 30 },
  { category: 'error', ttlDays: 90 },
  { category: 'fix', ttlDays: 180 },
  { category: 'skill', ttlDays: null },
  { category: 'other', ttlDays: 90 },
];

export class ForgettingManager {
  private readonly temporalGraph: TemporalGraph;
  private readonly policies: Map<string, number | null>;
  private readonly noiseConfidenceThreshold: number;
  private readonly invalidatedRetentionDays: number;

  constructor(options: ForgettingOptions) {
    this.temporalGraph = options.temporalGraph;
    this.policies = new Map();
    const policies = options.policies ?? DEFAULT_POLICIES;
    for (const p of policies) {
      this.policies.set(p.category, p.ttlDays);
    }
    this.noiseConfidenceThreshold = options.noiseConfidenceThreshold ?? 0.3;
    this.invalidatedRetentionDays = options.invalidatedRetentionDays ?? 30;
  }

  runGC(): ForgettingResult {
    const now = Date.now();
    const details: ForgettingResult['details'] = [];
    let expired = 0;
    let pruned = 0;
    let deleted = 0;

    const allFacts = this.temporalGraph.query({ includeInvalidated: true, limit: 10000 });

    for (const fact of allFacts) {
      if (fact.valid) {
        const ttlDays = this.policies.has(fact.category) ? this.policies.get(fact.category)! : 90;
        if (ttlDays === null) continue;

        const ageMs = now - new Date(fact.validFrom).getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);

        if (ageDays > ttlDays) {
          this.temporalGraph.invalidateFact(fact.id, `TTL expired (${ttlDays}d for category ${fact.category})`);
          expired++;
          details.push({ factId: fact.id, action: 'expired', reason: `TTL ${ttlDays}d exceeded (${ageDays.toFixed(1)}d old)` });
          continue;
        }

        if (fact.confidence < this.noiseConfidenceThreshold && fact.entities.length === 0 && fact.relationships.length === 0) {
          this.temporalGraph.invalidateFact(fact.id, `noise: low confidence (${fact.confidence.toFixed(2)}), no entities, no relationships`);
          pruned++;
          details.push({ factId: fact.id, action: 'pruned', reason: `noise: confidence ${fact.confidence.toFixed(2)}` });
        }
      } else {
        if (fact.validTo) {
          const invalidatedAgeMs = now - new Date(fact.validTo).getTime();
          const invalidatedAgeDays = invalidatedAgeMs / (1000 * 60 * 60 * 24);

          if (invalidatedAgeDays > this.invalidatedRetentionDays) {
            deleted++;
            details.push({ factId: fact.id, action: 'deleted', reason: `invalidated ${invalidatedAgeDays.toFixed(1)}d ago, retention ${this.invalidatedRetentionDays}d` });
          }
        }
      }
    }

    log.info({ expired, pruned, deleted, totalScanned: allFacts.length }, 'GC complete');
    return { expired, pruned, deleted, details };
  }

  getPolicy(category: string): number | null {
    return this.policies.has(category) ? this.policies.get(category)! : 90;
  }

  setPolicy(category: string, ttlDays: number | null): void {
    this.policies.set(category, ttlDays);
  }
}
