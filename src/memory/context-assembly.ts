/**
 * memory/context-assembly.ts — Smart Context Assembly (NEXT-007).
 *
 * Token-budget-aware selection of facts/summaries/observations.
 * Inspired by Zep: RRF fusion of BM25+vector+entity, token-budget-aware.
 *
 * Architecture:
 *   - ContextAssembler: fuses multiple retrieval signals
 *   - Sources: knowledge base (BM25+vector), temporal graph, user profile, entity graph
 *   - RRF (Reciprocal Rank Fusion): merge ranked lists into unified ranking
 *   - Token budget: select top items until budget exhausted
 *   - Output: compact <context> block for system prompt
 *
 * Usage:
 *   const assembler = new ContextAssembler({ searchFn, temporalGraph, profileMgr });
 *   const context = await assembler.assemble({
 *     query: 'how does auth work',
 *     project: 'my-project',
 *     userId: 'alice',
 *     tokenBudget: 2000,
 *   });
 */

import { childLogger } from '../core/logger.js';
import type { TemporalGraph } from './temporal-graph.js';
import type { ProfileManager } from './user-profile.js';

const log = childLogger('context-assembly');

// ─── Types ──────────────────────────────────────────────────────────

/** A single retrieval result from any source. */
export interface ContextItem {
  /** Unique ID. */
  id: string;
  /** Title/label. */
  title: string;
  /** Content text. */
  content: string;
  /** Source type. */
  source: 'knowledge' | 'temporal' | 'profile' | 'entity' | 'behavioral';
  /** Relevance score from source (0..1). */
  sourceScore: number;
  /** Fused RRF score. */
  rrfScore?: number;
  /** Tags. */
  tags?: string[];
  /** Estimated token count. */
  tokens?: number;
}

/** Input for context assembly. */
export interface AssemblyInput {
  /** Query text. */
  query: string;
  /** Project name. */
  project?: string;
  /** User ID for profile injection. */
  userId?: string;
  /** Token budget for output (default: 2000). */
  tokenBudget?: number;
  /** Maximum items to include (default: 20). */
  maxItems?: number;
  /** Whether to include temporal graph facts. */
  includeTemporal?: boolean;
  /** Whether to include user profile. */
  includeProfile?: boolean;
  /** Minimum RRF score threshold. */
  minScore?: number;
}

/** Result of context assembly. */
export interface AssemblyResult {
  /** Selected context items. */
  items: ContextItem[];
  /** Total estimated tokens. */
  totalTokens: number;
  /** Assembled context block (XML). */
  contextBlock: string;
  /** Sources used. */
  sources: string[];
  /** Assembly duration in ms. */
  durationMs: number;
}

/** Search function type (delegates to existing search infrastructure). */
export type SearchFn = (query: string, project: string, limit: number) => Promise<
  Array<{ id: string; title: string; content: string; score: number; tags?: string[] }>
>;

// ─── RRF (Reciprocal Rank Fusion) ───────────────────────────────────

/**
 * Fuse multiple ranked lists using Reciprocal Rank Fusion.
 * RRF score = sum(1 / (k + rank_i)) for each list i.
 * k=60 is the standard constant.
 */
function rrfFuse(
  rankedLists: Array<{ id: string; rank: number; sourceScore: number }>[],
  k: number = 60,
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const list of rankedLists) {
    for (const item of list) {
      const rrf = 1 / (k + item.rank);
      scores.set(item.id, (scores.get(item.id) ?? 0) + rrf);
    }
  }

  return scores;
}

/** Rough token estimate: ~3 chars per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/** Truncate text to approximately maxTokens. */
function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 3;
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars - 3) + '...';
}

// ─── ContextAssembler ───────────────────────────────────────────────

export class ContextAssembler {
  private readonly searchFn: SearchFn | null;
  private readonly temporalGraph: TemporalGraph | null;
  private readonly profileMgr: ProfileManager | null;

  constructor(options: {
    searchFn?: SearchFn;
    temporalGraph?: TemporalGraph;
    profileMgr?: ProfileManager;
  }) {
    this.searchFn = options.searchFn ?? null;
    this.temporalGraph = options.temporalGraph ?? null;
    this.profileMgr = options.profileMgr ?? null;
  }

  /**
   * Assemble context from multiple sources with token-budget-aware selection.
   */
  async assemble(input: AssemblyInput): Promise<AssemblyResult> {
    const startTime = Date.now();
    const tokenBudget = input.tokenBudget ?? 2000;
    const maxItems = input.maxItems ?? 20;
    const minScore = input.minScore ?? 0.001;
    const project = input.project ?? 'default';
    const sources: string[] = [];
    const rankedLists: Array<{ id: string; rank: number; sourceScore: number }[]> = [];
    const allItems = new Map<string, ContextItem>();

    // ─── Source 1: Knowledge base search (BM25 + vector) ───────────
    if (this.searchFn) {
      try {
        const results = await this.searchFn(input.query, project, maxItems);
        sources.push('knowledge');
        const ranked = results.map((r, i) => ({ id: r.id, rank: i + 1, sourceScore: r.score }));
        rankedLists.push(ranked);

        for (const r of results) {
          allItems.set(r.id, {
            id: r.id,
            title: r.title,
            content: r.content,
            source: 'knowledge',
            sourceScore: r.score,
            tags: r.tags,
            tokens: estimateTokens(r.content),
          });
        }
      } catch (e) {
        log.warn({ error: e }, 'knowledge search failed');
      }
    }

    // ─── Source 2: Temporal graph facts ─────────────────────────────
    if (this.temporalGraph && input.includeTemporal !== false) {
      try {
        const facts = this.temporalGraph.query({ limit: maxItems, includeInvalidated: false });
        if (facts.length > 0) {
          sources.push('temporal');
          const ranked = facts.map((f, i) => ({ id: f.id, rank: i + 1, sourceScore: f.confidence }));
          rankedLists.push(ranked);

          for (const f of facts) {
            allItems.set(f.id, {
              id: f.id,
              title: f.statement,
              content: `[${f.category}] ${f.statement} (confidence: ${f.confidence.toFixed(2)})`,
              source: 'temporal',
              sourceScore: f.confidence,
              tags: f.tags,
              tokens: estimateTokens(f.statement),
            });
          }
        }
      } catch (e) {
        log.warn({ error: e }, 'temporal graph query failed');
      }
    }

    // ─── Source 3: User profile ─────────────────────────────────────
    if (this.profileMgr && input.userId && input.includeProfile !== false) {
      try {
        const context = this.profileMgr.buildContextBlock(input.userId, 200);
        if (context) {
          sources.push('profile');
          const profileId = `profile:${input.userId}`;
          allItems.set(profileId, {
            id: profileId,
            title: `User Profile: ${input.userId}`,
            content: context,
            source: 'profile',
            sourceScore: 1.0,
            tokens: estimateTokens(context),
          });
          rankedLists.push([{ id: profileId, rank: 1, sourceScore: 1.0 }]);
        }
      } catch (e) {
        log.warn({ error: e }, 'profile context failed');
      }
    }

    // ─── RRF Fusion ─────────────────────────────────────────────────
    const fusedScores = rrfFuse(rankedLists);

    // Apply RRF scores and filter
    const items: ContextItem[] = [];
    for (const [id, rrfScore] of fusedScores) {
      if (rrfScore < minScore) continue;
      const item = allItems.get(id);
      if (!item) continue;
      item.rrfScore = rrfScore;
      items.push(item);
    }

    // Sort by RRF score descending
    items.sort((a, b) => (b.rrfScore ?? 0) - (a.rrfScore ?? 0));

    // ─── Token-budget-aware selection ───────────────────────────────
    const selected: ContextItem[] = [];
    let usedTokens = 0;

    // Profile always goes first (always-on context)
    const profileItem = items.find((i) => i.source === 'profile');
    if (profileItem) {
      const truncated = truncateToTokens(profileItem.content, Math.min(200, tokenBudget));
      profileItem.content = truncated;
      profileItem.tokens = estimateTokens(truncated);
      usedTokens += profileItem.tokens;
      selected.push(profileItem);
    }

    // Then knowledge + temporal by RRF score
    for (const item of items) {
      if (item.source === 'profile') continue;
      if (selected.length >= maxItems) break;
      if (usedTokens >= tokenBudget) break;

      const remainingBudget = tokenBudget - usedTokens;
      const truncated = truncateToTokens(item.content, Math.min(item.tokens ?? 100, remainingBudget));
      item.content = truncated;
      item.tokens = estimateTokens(truncated);
      usedTokens += item.tokens;
      selected.push(item);
    }

    // ─── Build context block ────────────────────────────────────────
    const contextBlock = this.buildBlock(selected, input.query);

    const durationMs = Date.now() - startTime;
    log.info({
      itemsSelected: selected.length,
      totalTokens: usedTokens,
      sources,
      durationMs,
    }, 'context assembled');

    return {
      items: selected,
      totalTokens: usedTokens,
      contextBlock,
      sources,
      durationMs,
    };
  }

  /**
   * Build XML context block from selected items.
   */
  private buildBlock(items: ContextItem[], query: string): string {
    const lines: string[] = [
      `<context query="${query.replace(/"/g, '\\"')}">`,
    ];

    for (const item of items) {
      const sourceTag = `source="${item.source}"`;
      const scoreTag = item.rrfScore ? ` score="${item.rrfScore.toFixed(4)}"` : '';
      lines.push(`  <item ${sourceTag}${scoreTag}>`);
      lines.push(`    <title>${item.title}</title>`);
      lines.push(`    <content>${item.content}</content>`);
      lines.push(`  </item>`);
    }

    lines.push('</context>');
    return lines.join('\n');
  }
}
