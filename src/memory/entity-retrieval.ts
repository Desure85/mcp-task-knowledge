/**
 * memory/entity-retrieval.ts — Entity-linking Retrieval (NEXT-008).
 *
 * Entity matching as third retrieval signal (BM25 + vector + entity).
 * Inspired by Mem0: entities extracted from query, matched against
 * entity graph (MEM-002) and temporal graph facts, boost scores.
 *
 * Architecture:
 *   - EntityRetriever: extracts entities from query, matches against stored entities
 *   - Boost: items containing query entities get score boost
 *   - Integration: used by ContextAssembler as additional ranked list for RRF
 *
 * Usage:
 *   const retriever = new EntityRetriever({ temporalGraph });
 *   const results = retriever.retrieve('TypeScript auth JWT', 10);
 *   // results: items matching entities TypeScript, auth, JWT
 */

import { childLogger } from '../core/logger.js';
import type { TemporalGraph } from './temporal-graph.js';

const log = childLogger('entity-retrieval');

export interface EntityMatch {
  id: string;
  title: string;
  content: string;
  score: number;
  matchedEntities: string[];
  tags?: string[];
}

export interface EntityRetrievalOptions {
  temporalGraph?: TemporalGraph;
  knowledgeItems?: Array<{ id: string; title: string; content: string; tags?: string[]; entities?: string[] }>;
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these',
  'those', 'i', 'we', 'you', 'they', 'he', 'she', 'it', 'and', 'or',
  'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above',
  'below', 'up', 'down', 'out', 'off', 'over', 'under',
]);

function extractQueryEntities(query: string): string[] {
  const entities = new Set<string>();

  const caps = query.match(/\b[A-Z][a-zA-Z]{2,}\b/g);
  if (caps) {
    for (const c of caps) {
      if (!STOP_WORDS.has(c.toLowerCase())) {
        entities.add(c);
      }
    }
  }

  const tech = query.match(/\b[a-z]+[A-Z][a-zA-Z]+\b/g);
  if (tech) for (const t of tech) entities.add(t);

  const snake = query.match(/\b[a-z]+_[a-z_]+\b/g);
  if (snake) for (const s of snake) entities.add(s);

  const kebab = query.match(/\b[a-z]+-[a-z-]+\b/g);
  if (kebab) for (const k of kebab) entities.add(k);

  const quoted = query.match(/["'`]([^"'`]{3,50})["'`]/g);
  if (quoted) for (const q of quoted) entities.add(q.replace(/["'`]/g, ''));

  return Array.from(entities);
}

export class EntityRetriever {
  private readonly temporalGraph: TemporalGraph | null;
  private readonly knowledgeItems: Array<{ id: string; title: string; content: string; tags?: string[]; entities?: string[] }> | null;

  constructor(options: EntityRetrievalOptions = {}) {
    this.temporalGraph = options.temporalGraph ?? null;
    this.knowledgeItems = options.knowledgeItems ?? null;
  }

  retrieve(query: string, limit: number = 10): EntityMatch[] {
    const queryEntities = extractQueryEntities(query);
    if (queryEntities.length === 0) return [];

    log.info({ queryEntities, query }, 'entity retrieval started');

    const matches: EntityMatch[] = [];

    if (this.temporalGraph) {
      const facts = this.temporalGraph.query({ includeInvalidated: false, limit: 200 });
      for (const fact of facts) {
        const matchedEntities = fact.entities.filter((e) =>
          queryEntities.some((qe) => e.toLowerCase() === qe.toLowerCase()),
        );
        if (matchedEntities.length === 0) continue;

        const score = matchedEntities.length / queryEntities.length;
        matches.push({
          id: fact.id,
          title: fact.statement,
          content: `[${fact.category}] ${fact.statement}`,
          score,
          matchedEntities,
          tags: fact.tags,
        });
      }
    }

    if (this.knowledgeItems) {
      for (const item of this.knowledgeItems) {
        const itemEntities = item.entities ?? extractQueryEntities(`${item.title} ${item.content}`);
        const matchedEntities = itemEntities.filter((e) =>
          queryEntities.some((qe) => e.toLowerCase() === qe.toLowerCase()),
        );
        if (matchedEntities.length === 0) continue;

        const score = matchedEntities.length / queryEntities.length;
        matches.push({
          id: item.id,
          title: item.title,
          content: item.content,
          score,
          matchedEntities,
          tags: item.tags,
        });
      }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, limit);
  }
}
