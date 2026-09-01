/**
 * memory/evolution.ts — Memory Evolution (NEXT-003).
 *
 * When a new fact is added, check existing memories for semantic overlap
 * and update their context/attributes. Inspired by A-MEM (Zettelkasten).
 *
 * Architecture:
 *   - MemoryEvolver: checks new fact against existing facts
 *   - Semantic overlap: Jaccard similarity on words + entity overlap
 *   - Evolution actions: link (add relationship), merge (combine content),
 *     supersede (invalidate old via temporal graph)
 *   - Integration: called after memory_extract or memory_temporal_add
 *
 * Usage:
 *   const evolver = new MemoryEvolver({ temporalGraph });
 *   const result = evolver.evolve(newFactId);
 *   // result: { linked: [...], merged: [...], superseded: [...] }
 */

import { childLogger } from '../core/logger.js';
import type { TemporalGraph, TemporalFact } from './temporal-graph.js';

const log = childLogger('memory-evolution');

export interface EvolutionResult {
  newFactId: string;
  linked: Array<{ factId: string; similarity: number }>;
  merged: Array<{ factId: string; mergedContent: string }>;
  superseded: Array<{ factId: string; reason: string }>;
  totalAffected: number;
}

export interface EvolutionOptions {
  temporalGraph: TemporalGraph;
  similarityThreshold?: number;
  entityOverlapThreshold?: number;
}

function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = new Set([...a].filter((w) => b.has(w)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

function entityOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a.map((e) => e.toLowerCase()));
  const setB = new Set(b.map((e) => e.toLowerCase()));
  const intersection = new Set([...setA].filter((e) => setB.has(e)));
  return intersection.size / Math.max(setA.size, setB.size);
}

function isContradiction(factA: TemporalFact, factB: TemporalFact): boolean {
  const negationPatterns = [
    /\b(not|no longer|never|don't|doesn't|didn't|stopped|removed|replaced)\b/i,
    /\b(changed|switched|migrated|deprecated)\b/i,
  ];

  const combined = `${factA.statement} ${factB.statement}`;
  return negationPatterns.some((p) => p.test(combined));
}

export class MemoryEvolver {
  private readonly temporalGraph: TemporalGraph;
  private readonly similarityThreshold: number;
  private readonly entityOverlapThreshold: number;

  constructor(options: EvolutionOptions) {
    this.temporalGraph = options.temporalGraph;
    this.similarityThreshold = options.similarityThreshold ?? 0.3;
    this.entityOverlapThreshold = options.entityOverlapThreshold ?? 0.3;
  }

  evolve(newFactId: string): EvolutionResult {
    const newFact = this.temporalGraph.getFact(newFactId);
    if (!newFact) {
      return { newFactId, linked: [], merged: [], superseded: [], totalAffected: 0 };
    }

    const allFacts = this.temporalGraph.query({ includeInvalidated: false, limit: 500 });
    const existingFacts = allFacts.filter((f) => f.id !== newFactId);

    const newWords = wordSet(newFact.statement);
    const linked: Array<{ factId: string; similarity: number }> = [];
    const merged: Array<{ factId: string; mergedContent: string }> = [];
    const superseded: Array<{ factId: string; reason: string }> = [];

    for (const existing of existingFacts) {
      const existingWords = wordSet(existing.statement);
      const sim = jaccard(newWords, existingWords);
      const entOverlap = entityOverlap(newFact.entities, existing.entities);
      const combinedScore = Math.max(sim, entOverlap * 0.5);

      if (combinedScore < this.similarityThreshold) continue;

      if (isContradiction(newFact, existing)) {
        this.temporalGraph.addRelationship(newFactId, existing.id, 'contradicts', {
          similarity: combinedScore,
        });
        this.temporalGraph.invalidateFact(existing.id, `superseded by ${newFactId}: contradiction detected`);
        this.temporalGraph.addRelationship(newFactId, existing.id, 'supersedes', {
          reason: 'contradiction',
        });
        superseded.push({ factId: existing.id, reason: 'contradiction detected' });
        log.info({ newFactId, oldFactId: existing.id, score: combinedScore }, 'fact superseded via contradiction');
      } else if (sim >= this.similarityThreshold && entOverlap >= this.entityOverlapThreshold) {
        const mergedContent = `${existing.statement}\n\nRelated: ${newFact.statement}`;
        merged.push({ factId: existing.id, mergedContent });
        this.temporalGraph.addRelationship(newFactId, existing.id, 'related', {
          similarity: combinedScore,
          merged: true,
        });
        log.info({ newFactId, existingId: existing.id, score: combinedScore }, 'facts linked via semantic overlap');
      } else {
        linked.push({ factId: existing.id, similarity: combinedScore });
        this.temporalGraph.addRelationship(newFactId, existing.id, 'related', {
          similarity: combinedScore,
        });
      }
    }

    const totalAffected = linked.length + merged.length + superseded.length;
    log.info({ newFactId, linked: linked.length, merged: merged.length, superseded: superseded.length }, 'evolution complete');

    return { newFactId, linked, merged, superseded, totalAffected };
  }
}
