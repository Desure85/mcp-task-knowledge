/**
 * memory/context-distiller.ts — Context distillation (MEM-003).
 *
 * Auto-summarizes raw session context into actionable knowledge and
 * compresses old sessions. Heuristic-based (no LLM dependency):
 * topic extraction by keyword frequency, decision/convention aggregation,
 * file-usage tracking, time-span computation.
 *
 * Usage:
 *   const distiller = new ContextDistiller();
 *   const knowledge = distiller.distill(memory.getSessions(10));
 *   const result = distiller.compressOldSessions(memory, { keepRecent: 5 });
 */

import type { SessionMemory } from './session-memory.js';
import type { SessionRecord, SessionDecision } from './session-memory.js';
import { childLogger } from '../core/logger.js';

const log = childLogger('context-distiller');

// ─── Types ────────────────────────────────────────────────────────

export interface DistilledKnowledge {
  /** Source session IDs (oldest first). */
  sessionIds: string[];
  /** Span start (ISO 8601). */
  from: string;
  /** Span end (ISO 8601). */
  to: string;
  /** Top topics (frequency-ranked keywords). */
  topics: string[];
  /** Key decisions across sessions. */
  decisions: SessionDecision[];
  /** Unique conventions discovered. */
  conventions: string[];
  /** Unique files touched. */
  filesTouched: string[];
  /** One-paragraph distilled summary. */
  summary: string;
}

export interface DistillerOptions {
  /** Max topics to extract. Default: 8. */
  maxTopics?: number;
  /** Extra stop words (merged with defaults). */
  stopWords?: string[];
}

export interface CompressOptions {
  /** Keep the N most recent sessions uncompressed. Default: 3. */
  keepRecent?: number;
  /** Compress sessions older than this ISO timestamp (alternative to keepRecent). */
  olderThan?: string;
}

export interface CompressResult {
  /** Distilled knowledge from the compressed (removed) sessions. */
  compressed: DistilledKnowledge[];
  /** Session IDs removed from memory. */
  removed: string[];
}

// Default stop words (generic English + dev vocabulary).
const DEFAULT_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'for', 'with', 'from', 'this', 'that',
  'was', 'were', 'have', 'has', 'had', 'been', 'being', 'into', 'about',
  'after', 'before', 'over', 'under', 'again', 'more', 'most', 'some', 'such',
  'work', 'done', 'task', 'tasks', 'issue', 'issues', 'fix', 'fixed', 'using',
  'made', 'make', 'implemented', 'implementation', 'also', 'will', 'can', 'could',
  'should', 'would', 'new', 'now', 'still', 'next', 'added', 'via', 'per', 'like',
]);

// ─── ContextDistiller ─────────────────────────────────────────────

export class ContextDistiller {
  private readonly maxTopics: number;
  private readonly stopWords: Set<string>;

  constructor(options?: DistillerOptions) {
    this.maxTopics = options?.maxTopics ?? 8;
    this.stopWords = new Set([...DEFAULT_STOP_WORDS, ...(options?.stopWords ?? [])]);
  }

  /**
   * Distill raw sessions into actionable knowledge.
   */
  distill(sessions: SessionRecord[]): DistilledKnowledge {
    if (sessions.length === 0) {
      return {
        sessionIds: [], from: '', to: '', topics: [],
        decisions: [], conventions: [], filesTouched: [], summary: 'No sessions to distill.',
      };
    }

    const sorted = [...sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const sessionIds = sorted.map((s) => s.id);
    const from = sorted[0].startedAt;
    const to = sorted[sorted.length - 1].endedAt || sorted[sorted.length - 1].startedAt;

    const decisions = sorted.flatMap((s) => s.decisions);
    const conventions = Array.from(new Set(sorted.flatMap((s) => s.conventions)));
    const filesTouched = Array.from(new Set(sorted.flatMap((s) => s.filesModified)));
    const topics = this.extractTopics(sorted);

    const summary = this.buildSummary(sessionIds.length, from, to, topics, decisions, conventions);

    return { sessionIds, from, to, topics, decisions, conventions, filesTouched, summary };
  }

  /**
   * Distill a single session.
   */
  distillSession(session: SessionRecord): DistilledKnowledge {
    return this.distill([session]);
  }

  /**
   * Compress old sessions in memory into distilled knowledge.
   * Old sessions are removed from the store (replaced by knowledge).
   */
  compressOldSessions(memory: SessionMemory, options?: CompressOptions): CompressResult {
    const sessions = memory.getSessions(); // newest first
    if (sessions.length === 0) return { compressed: [], removed: [] };

    let oldSessions: SessionRecord[];
    if (options?.olderThan) {
      const cutoff = new Date(options.olderThan).getTime();
      oldSessions = sessions.filter((s) => new Date(s.endedAt || s.startedAt).getTime() < cutoff);
    } else {
      const keepRecent = options?.keepRecent ?? 3;
      oldSessions = sessions.slice(keepRecent); // sessions beyond the recent ones
    }
    if (oldSessions.length === 0) return { compressed: [], removed: [] };

    // Group old sessions into one knowledge block
    const knowledge = this.distill(oldSessions);
    const removed = oldSessions.map((s) => s.id);
    for (const id of removed) {
      memory.deleteSession(id);
    }
    log.info({ removed: removed.length, keptRecent: sessions.length - removed.length }, 'old sessions compressed');
    return { compressed: [knowledge], removed };
  }

  // ─── Internal ───────────────────────────────────────────────────

  private extractTopics(sessions: SessionRecord[]): string[] {
    const freq = new Map<string, number>();

    const addText = (text: string): void => {
      const words = text.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
      for (const word of words) {
        if (this.stopWords.has(word)) continue;
        freq.set(word, (freq.get(word) ?? 0) + 1);
      }
    };

    for (const session of sessions) {
      addText(session.summary);
      for (const step of session.nextSteps) addText(step);
      for (const decision of session.decisions) addText(`${decision.title} ${decision.decision}`);
    }

    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, this.maxTopics)
      .map(([word]) => word);
  }

  private buildSummary(
    count: number,
    from: string,
    to: string,
    topics: string[],
    decisions: SessionDecision[],
    conventions: string[],
  ): string {
    const lines: string[] = [
      `Distilled from ${count} session(s) (${from} → ${to}).`,
    ];
    if (topics.length > 0) {
      lines.push(`Topics: ${topics.join(', ')}.`);
    }
    if (decisions.length > 0) {
      lines.push(`Key decisions: ${decisions.map((d) => d.title).join('; ')}.`);
    }
    if (conventions.length > 0) {
      lines.push(`Conventions: ${conventions.join('; ')}.`);
    }
    return lines.join(' ');
  }
}
