/**
 * memory/dreaming.ts — Sleep-time/Dreaming Agent (NEXT-006).
 *
 * Async memory refinement during idle periods.
 * Inspired by Letta/Supermemory: background worker for dedup, merge, summarise.
 *
 * Architecture:
 *   - DreamingAgent: runs periodically, refines memory layers
 *   - Operations: dedup (Jaccard), merge (combine similar), summarise (compress old)
 *   - Integration: uses LayeredMemory + TemporalGraph + ContextDistiller
 *   - Non-blocking: runs in background, doesn't block MCP tools
 *
 * Usage:
 *   const agent = new DreamingAgent({ layeredMemory, temporalGraph });
 *   agent.start(60000); // run every 60s
 *   agent.stop();
 *   const result = agent.runOnce(); // manual trigger
 */

import { childLogger } from '../core/logger.js';
import type { LayeredMemory, LayeredFact } from './layers.js';
import type { TemporalGraph } from './temporal-graph.js';

const log = childLogger('dreaming-agent');

export interface DreamingResult {
  deduplicated: number;
  merged: number;
  summarised: number;
  promoted: number;
  durationMs: number;
}

export interface DreamingOptions {
  layeredMemory?: LayeredMemory;
  temporalGraph?: TemporalGraph;
  dedupThreshold?: number;
  mergeThreshold?: number;
}

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function jaccard(a: string, b: string): number {
  const setA = new Set(normalize(a).split(' '));
  const setB = new Set(normalize(b).split(' '));
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = new Set([...setA].filter((w) => setB.has(w)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

export class DreamingAgent {
  private readonly layeredMemory: LayeredMemory | null;
  private readonly temporalGraph: TemporalGraph | null;
  private readonly dedupThreshold: number;
  private readonly mergeThreshold: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: DreamingOptions = {}) {
    this.layeredMemory = options.layeredMemory ?? null;
    this.temporalGraph = options.temporalGraph ?? null;
    this.dedupThreshold = options.dedupThreshold ?? 0.8;
    this.mergeThreshold = options.mergeThreshold ?? 0.5;
  }

  runOnce(): DreamingResult {
    const startTime = Date.now();
    let deduplicated = 0;
    let merged = 0;
    let summarised = 0;
    let promoted = 0;

    if (this.layeredMemory) {
      const convFacts = this.layeredMemory.getLayer('conversation');
      const sessFacts = this.layeredMemory.getLayer('session');

      const dedupResult = this.dedupLayer(convFacts);
      deduplicated += dedupResult;

      const mergeResult = this.mergeLayer(convFacts);
      merged += mergeResult;

      const promoteResult = this.layeredMemory.promoteAll('conversation', 'session');
      promoted += promoteResult;

      const sessDedup = this.dedupLayer(sessFacts);
      deduplicated += sessDedup;
    }

    if (this.temporalGraph) {
      const facts = this.temporalGraph.query({ includeInvalidated: false, limit: 500 });
      const dedupResult = this.dedupTemporalFacts(facts);
      deduplicated += dedupResult;
    }

    const durationMs = Date.now() - startTime;
    log.info({ deduplicated, merged, summarised, promoted, durationMs }, 'dreaming cycle complete');

    return { deduplicated, merged, summarised, promoted, durationMs };
  }

  private dedupLayer(facts: LayeredFact[]): number {
    let count = 0;
    for (let i = 0; i < facts.length; i++) {
      for (let j = i + 1; j < facts.length; j++) {
        const sim = jaccard(facts[i].statement, facts[j].statement);
        if (sim >= this.dedupThreshold) {
          if (this.layeredMemory) {
            this.layeredMemory.invalidate(facts[i].layer, facts[j].id);
          }
          count++;
        }
      }
    }
    return count;
  }

  private mergeLayer(facts: LayeredFact[]): number {
    let count = 0;
    for (let i = 0; i < facts.length; i++) {
      for (let j = i + 1; j < facts.length; j++) {
        const sim = jaccard(facts[i].statement, facts[j].statement);
        if (sim >= this.mergeThreshold && sim < this.dedupThreshold) {
          if (this.layeredMemory) {
            const merged = `${facts[i].statement} — also: ${facts[j].statement}`;
            this.layeredMemory.add(facts[i].layer, {
              statement: merged,
              category: facts[i].category,
              confidence: Math.max(facts[i].confidence, facts[j].confidence),
              tags: [...new Set([...facts[i].tags, ...facts[j].tags])],
            });
            this.layeredMemory.invalidate(facts[i].layer, facts[i].id);
            this.layeredMemory.invalidate(facts[j].layer, facts[j].id);
          }
          count++;
        }
      }
    }
    return count;
  }

  private dedupTemporalFacts(facts: Array<{ id: string; statement: string }>): number {
    let count = 0;
    for (let i = 0; i < facts.length; i++) {
      for (let j = i + 1; j < facts.length; j++) {
        const sim = jaccard(facts[i].statement, facts[j].statement);
        if (sim >= this.dedupThreshold) {
          if (this.temporalGraph) {
            this.temporalGraph.invalidateFact(facts[j].id, `dreaming dedup: ${sim.toFixed(2)} similarity with ${facts[i].id}`);
          }
          count++;
        }
      }
    }
    return count;
  }

  start(intervalMs: number = 60000): void {
    if (this.timer) return;
    log.info({ intervalMs }, 'dreaming agent started');
    this.timer = setInterval(() => {
      this.runOnce();
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info('dreaming agent stopped');
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }
}
