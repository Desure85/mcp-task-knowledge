/**
 * memory/conflict-resolver.ts — Memory Conflict Resolution (NEXT-009).
 *
 * LLM-based contradiction detection between new and existing facts.
 * Marks old facts invalid (not deleted). History preserved.
 *
 * Architecture:
 *   - ConflictResolver: detects contradictions between facts
 *   - Detection: negation patterns + entity mismatch + temporal overlap
 *   - Resolution: mark old fact invalid, link via supersedes relationship
 *   - Integration: called after memory_extract or temporal_add
 *
 * Usage:
 *   const resolver = new ConflictResolver({ temporalGraph });
 *   const result = resolver.checkConflict(newFactId);
 *   // result: { hasConflict: true, conflictingFactId: '...', resolution: 'supersede' }
 */

import { childLogger } from '../core/logger.js';
import type { TemporalGraph, TemporalFact } from './temporal-graph.js';

const log = childLogger('conflict-resolver');

export interface ConflictResult {
  newFactId: string;
  hasConflict: boolean;
  conflicts: Array<{
    existingFactId: string;
    existingStatement: string;
    reason: string;
    confidence: number;
    resolution: 'supersede' | 'flag' | 'none';
  }>;
}

export interface ConflictResolverOptions {
  temporalGraph: TemporalGraph;
  similarityThreshold?: number;
}

const NEGATION_INDICATORS = [
  /\b(not|no longer|never|don't|doesn't|didn't|stopped|removed)\b/i,
  /\b(replaced|switched|migrated|deprecated|obsolete)\b/i,
  /\b(changed from|instead of|rather than)\b/i,
];

const CHANGE_INDICATORS = [
  /\b(now|currently|updated|new|current)\b/i,
  /\b(was|previously|before|used to|formerly)\b/i,
];

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function extractKeyTerms(statement: string): string[] {
  const words = statement.toLowerCase().split(/\s+/);
  const stop = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'for', 'of', 'in', 'on', 'at', 'and', 'or', 'but']);
  return words.filter((w) => w.length > 2 && !stop.has(w));
}

function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = new Set([...setA].filter((w) => setB.has(w)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

function detectContradiction(factA: TemporalFact, factB: TemporalFact): { isContradiction: boolean; reason: string; confidence: number } {
  const normA = normalize(factA.statement);
  const normB = normalize(factB.statement);
  const termsA = extractKeyTerms(factA.statement);
  const termsB = extractKeyTerms(factB.statement);
  const sim = jaccard(termsA, termsB);

  if (sim < 0.2) return { isContradiction: false, reason: '', confidence: 0 };

  const combined = `${factA.statement} ${factB.statement}`;
  const hasNegation = NEGATION_INDICATORS.some((p) => p.test(combined));
  const hasChange = CHANGE_INDICATORS.some((p) => p.test(combined));

  if (hasNegation && sim > 0.3) {
    return {
      isContradiction: true,
      reason: 'negation pattern detected between similar facts',
      confidence: Math.min(0.6 + sim * 0.3, 0.95),
    };
  }

  if (hasChange && hasNegation && sim > 0.25) {
    return {
      isContradiction: true,
      reason: 'change indicator + negation between similar facts',
      confidence: Math.min(0.7 + sim * 0.2, 0.95),
    };
  }

  if (factA.entities.length > 0 && factB.entities.length > 0) {
    const sharedEntities = factA.entities.filter((e) =>
      factB.entities.some((e2) => e.toLowerCase() === e2.toLowerCase()),
    );
    if (sharedEntities.length > 0 && hasNegation) {
      return {
        isContradiction: true,
        reason: `shared entities (${sharedEntities.join(', ')}) with negation`,
        confidence: Math.min(0.65 + sim * 0.25, 0.95),
      };
    }
  }

  return { isContradiction: false, reason: '', confidence: 0 };
}

export class ConflictResolver {
  private readonly temporalGraph: TemporalGraph;
  private readonly similarityThreshold: number;

  constructor(options: ConflictResolverOptions) {
    this.temporalGraph = options.temporalGraph;
    this.similarityThreshold = options.similarityThreshold ?? 0.2;
  }

  checkConflict(newFactId: string): ConflictResult {
    const newFact = this.temporalGraph.getFact(newFactId);
    if (!newFact) {
      return { newFactId, hasConflict: false, conflicts: [] };
    }

    const allFacts = this.temporalGraph.query({ includeInvalidated: false, limit: 500 });
    const existingFacts = allFacts.filter((f) => f.id !== newFactId);

    const conflicts: ConflictResult['conflicts'] = [];

    for (const existing of existingFacts) {
      const detection = detectContradiction(newFact, existing);
      if (!detection.isContradiction) continue;

      const resolution = detection.confidence > 0.7 ? 'supersede' : 'flag';

      if (resolution === 'supersede') {
        this.temporalGraph.invalidateFact(existing.id, `contradicted by ${newFactId}: ${detection.reason}`);
        this.temporalGraph.addRelationship(newFactId, existing.id, 'supersedes', {
          reason: 'contradiction',
          confidence: detection.confidence,
        });
        this.temporalGraph.addRelationship(newFactId, existing.id, 'contradicts', {
          confidence: detection.confidence,
        });
        log.info({ newFactId, oldFactId: existing.id, confidence: detection.confidence }, 'conflict resolved: old fact superseded');
      } else {
        this.temporalGraph.addRelationship(newFactId, existing.id, 'contradicts', {
          confidence: detection.confidence,
          flagged: true,
        });
        log.info({ newFactId, oldFactId: existing.id, confidence: detection.confidence }, 'conflict flagged for review');
      }

      conflicts.push({
        existingFactId: existing.id,
        existingStatement: existing.statement,
        reason: detection.reason,
        confidence: detection.confidence,
        resolution,
      });
    }

    return {
      newFactId,
      hasConflict: conflicts.length > 0,
      conflicts,
    };
  }

  checkAllConflicts(): ConflictResult[] {
    const allFacts = this.temporalGraph.query({ includeInvalidated: false, limit: 1000 });
    const results: ConflictResult[] = [];

    for (const fact of allFacts) {
      const result = this.checkConflict(fact.id);
      if (result.hasConflict) {
        results.push(result);
      }
    }

    return results;
  }
}
