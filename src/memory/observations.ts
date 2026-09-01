/**
 * memory/observations.ts — Observations/Pattern Detection (NEXT-018).
 *
 * Graph-based pattern surfacing — recurrences, co-occurrences, temporal patterns
 * from entity graph. Inspired by Zep: observations from graph structure.
 *
 * Architecture:
 *   - ObservationEngine: scans temporal graph for patterns
 *   - Pattern types: recurrence (same entity appears repeatedly),
 *     co-occurrence (entities appear together), temporal (facts cluster in time)
 *   - Output: structured observations with confidence and evidence
 *
 * Usage:
 *   const engine = new ObservationEngine({ temporalGraph });
 *   const observations = engine.detect();
 *   // observations: [{ type: 'recurrence', entity: 'TypeScript', count: 5, ... }]
 */

import { childLogger } from '../core/logger.js';
import type { TemporalGraph, TemporalFact } from './temporal-graph.js';

const log = childLogger('observations');

export type ObservationType = 'recurrence' | 'co_occurrence' | 'temporal_cluster' | 'category_trend';

export interface Observation {
  id: string;
  type: ObservationType;
  description: string;
  confidence: number;
  evidence: string[];
  entities?: string[];
  category?: string;
  count?: number;
  detectedAt: string;
}

export interface ObservationOptions {
  temporalGraph: TemporalGraph;
  minRecurrence?: number;
  minCoOccurrence?: number;
  minClusterSize?: number;
}

export class ObservationEngine {
  private readonly temporalGraph: TemporalGraph;
  private readonly minRecurrence: number;
  private readonly minCoOccurrence: number;
  private readonly minClusterSize: number;

  constructor(options: ObservationOptions) {
    this.temporalGraph = options.temporalGraph;
    this.minRecurrence = options.minRecurrence ?? 3;
    this.minCoOccurrence = options.minCoOccurrence ?? 2;
    this.minClusterSize = options.minClusterSize ?? 3;
  }

  detect(): Observation[] {
    const facts = this.temporalGraph.query({ includeInvalidated: false, limit: 10000 });
    const observations: Observation[] = [];

    observations.push(...this.detectRecurrences(facts));
    observations.push(...this.detectCoOccurrences(facts));
    observations.push(...this.detectTemporalClusters(facts));
    observations.push(...this.detectCategoryTrends(facts));

    log.info({ count: observations.length }, 'observations detected');
    return observations;
  }

  private detectRecurrences(facts: TemporalFact[]): Observation[] {
    const entityCounts = new Map<string, number>();
    for (const fact of facts) {
      for (const entity of fact.entities) {
        entityCounts.set(entity, (entityCounts.get(entity) ?? 0) + 1);
      }
    }

    const observations: Observation[] = [];
    for (const [entity, count] of entityCounts) {
      if (count >= this.minRecurrence) {
        const evidence = facts
          .filter((f) => f.entities.includes(entity))
          .map((f) => f.statement)
          .slice(0, 5);

        observations.push({
          id: `rec-${entity}-${Date.now()}`,
          type: 'recurrence',
          description: `Entity "${entity}" appears ${count} times across memory facts`,
          confidence: Math.min(count / 10, 1.0),
          evidence,
          entities: [entity],
          count,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    return observations;
  }

  private detectCoOccurrences(facts: TemporalFact[]): Observation[] {
    const coOccurrenceMap = new Map<string, number>();
    const pairEvidence = new Map<string, string[]>();

    for (const fact of facts) {
      const entities = fact.entities;
      for (let i = 0; i < entities.length; i++) {
        for (let j = i + 1; j < entities.length; j++) {
          const pair = [entities[i], entities[j]].sort().join('+');
          coOccurrenceMap.set(pair, (coOccurrenceMap.get(pair) ?? 0) + 1);
          if (!pairEvidence.has(pair)) pairEvidence.set(pair, []);
          pairEvidence.get(pair)!.push(fact.statement);
        }
      }
    }

    const observations: Observation[] = [];
    for (const [pair, count] of coOccurrenceMap) {
      if (count >= this.minCoOccurrence) {
        const entities = pair.split('+');
        observations.push({
          id: `co-${pair}-${Date.now()}`,
          type: 'co_occurrence',
          description: `Entities "${entities[0]}" and "${entities[1]}" co-occur ${count} times`,
          confidence: Math.min(count / 8, 1.0),
          evidence: (pairEvidence.get(pair) ?? []).slice(0, 5),
          entities,
          count,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    return observations;
  }

  private detectTemporalClusters(facts: TemporalFact[]): Observation[] {
    if (facts.length < this.minClusterSize) return [];

    const sorted = [...facts].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    const observations: Observation[] = [];

    let clusterStart = 0;
    for (let i = 1; i <= sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = i < sorted.length ? sorted[i] : null;

      if (!curr || this.daysBetween(prev.validFrom, curr.validFrom) > 7) {
        const clusterSize = i - clusterStart;
        if (clusterSize >= this.minClusterSize) {
          const clusterFacts = sorted.slice(clusterStart, i);
          const entities = [...new Set(clusterFacts.flatMap((f) => f.entities))];
          observations.push({
            id: `tc-${clusterStart}-${Date.now()}`,
            type: 'temporal_cluster',
            description: `${clusterSize} facts clustered within 7 days (${clusterFacts[0].validFrom.substring(0, 10)} to ${clusterFacts[clusterFacts.length - 1].validFrom.substring(0, 10)})`,
            confidence: Math.min(clusterSize / 15, 1.0),
            evidence: clusterFacts.map((f) => f.statement).slice(0, 5),
            entities,
            count: clusterSize,
            detectedAt: new Date().toISOString(),
          });
        }
        clusterStart = i;
      }
    }

    return observations;
  }

  private detectCategoryTrends(facts: TemporalFact[]): Observation[] {
    const categoryCounts = new Map<string, number>();
    for (const fact of facts) {
      categoryCounts.set(fact.category, (categoryCounts.get(fact.category) ?? 0) + 1);
    }

    const observations: Observation[] = [];
    for (const [category, count] of categoryCounts) {
      if (count >= this.minClusterSize) {
        const evidence = facts
          .filter((f) => f.category === category)
          .map((f) => f.statement)
          .slice(0, 3);

        observations.push({
          id: `ct-${category}-${Date.now()}`,
          type: 'category_trend',
          description: `Category "${category}" has ${count} facts — significant pattern`,
          confidence: Math.min(count / 20, 1.0),
          evidence,
          category,
          count,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    return observations;
  }

  private daysBetween(a: string, b: string): number {
    const ms = Math.abs(new Date(b).getTime() - new Date(a).getTime());
    return ms / (1000 * 60 * 60 * 24);
  }
}
