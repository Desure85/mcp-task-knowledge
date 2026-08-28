/**
 * behavioral/cross-project-search.ts — Cross-project search (BM-009).
 *
 * `cross_project_search` — search failures and proven fixes ACROSS all
 * projects: a bug fixed once in repo A does not need to be rediscovered
 * in repo B. Guard rules / fixes learned in one project are applicable to
 * another project with the same shape of failure.
 *
 * Usage:
 *   const search = new CrossProjectSearch({
 *     projects: [
 *       { id: 'repo-a', failures: failuresA, resolutions: resolutionsA },
 *       { id: 'repo-b', failures: failuresB, resolutions: resolutionsB },
 *     ],
 *   });
 *   const hits = search.findProvenFixes('TypeError', 'Cannot read property name of undefined');
 */

import type { FailureLogger } from './failure-logging.js';
import type { ResolutionLogger } from './resolution-logging.js';
import type { FailureRecord } from './failure-logging.js';
import type { ResolutionRecord } from './resolution-logging.js';

// ─── Types ────────────────────────────────────────────────────────

export interface ProjectMemory {
  /** Project identifier. */
  id: string;
  /** Failures store for the project. */
  failures: FailureLogger;
  /** Resolutions store for the project. */
  resolutions: ResolutionLogger;
}

export interface CrossProjectHit {
  /** Project that owns the failure/fix. */
  projectId: string;
  /** The failure record. */
  failure: FailureRecord;
  /** Proven fix (resolution) when found. */
  resolution?: ResolutionRecord;
  /** Similarity 0-1 (only for findProvenFixes). */
  similarity?: number;
}

export interface FixSearchOptions {
  /** Minimum similarity. Default: 0.3. */
  minSimilarity?: number;
  /** Max results. Default: 10. */
  limit?: number;
}

// ─── CrossProjectSearch ───────────────────────────────────────────

export class CrossProjectSearch {
  private readonly projects: ProjectMemory[];

  constructor(options: { projects: ProjectMemory[] }) {
    this.projects = options.projects;
  }

  /**
   * Lexical search over failure messages/error types across all projects.
   */
  searchFailures(query: string, limit = 10): CrossProjectHit[] {
    const lower = query.toLowerCase();
    const hits: CrossProjectHit[] = [];

    for (const project of this.projects) {
      for (const failure of project.failures.list()) {
        if (
          failure.message.toLowerCase().includes(lower) ||
          failure.errorType.toLowerCase().includes(lower)
        ) {
          hits.push({ projectId: project.id, failure });
        }
      }
    }

    return hits.slice(0, limit);
  }

  /**
   * Lexical search over resolution approaches across all projects.
   */
  searchResolutions(query: string, limit = 10): CrossProjectHit[] {
    const lower = query.toLowerCase();
    const hits: CrossProjectHit[] = [];

    for (const project of this.projects) {
      for (const resolution of project.resolutions.list()) {
        if (resolution.approach.toLowerCase().includes(lower)) {
          const failure = project.failures.get(resolution.failureId);
          if (!failure) continue;
          hits.push({ projectId: project.id, failure, resolution });
        }
      }
    }

    return hits.slice(0, limit);
  }

  /**
   * Find proven fixes across all projects for a given failure shape.
   * A resolved failure in any project with the same error type + message
   * overlap counts as a proven fix.
   */
  findProvenFixes(errorType: string, message: string, options?: FixSearchOptions): CrossProjectHit[] {
    const minSimilarity = options?.minSimilarity ?? 0.3;
    const limit = options?.limit ?? 10;
    const target: Pick<FailureRecord, 'errorType' | 'message'> = { errorType, message };
    const hits: CrossProjectHit[] = [];

    for (const project of this.projects) {
      for (const failure of project.failures.list()) {
        if (!failure.resolved) continue;
        const similarity = this.calculateSimilarity(target, failure);
        if (similarity < minSimilarity) continue;
        const resolution = project.resolutions.get(failure.resolutionId ?? '');
        hits.push({ projectId: project.id, failure, resolution, similarity });
      }
    }

    return hits.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0)).slice(0, limit);
  }

  /**
   * All project IDs known to the search.
   */
  get projectIds(): string[] {
    return this.projects.map((p) => p.id);
  }

  // ─── Internal ───────────────────────────────────────────────────

  /**
   * Similarity (0-1): same error type (+0.5) + word overlap in message (up to +0.5).
   */
  private calculateSimilarity(
    a: { errorType: string; message: string },
    b: { errorType: string; message: string },
  ): number {
    let score = 0;
    if (a.errorType === b.errorType) score += 0.5;

    const wordsA = new Set(a.message.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
    const wordsB = new Set(b.message.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
    if (wordsA.size > 0 && wordsB.size > 0) {
      let common = 0;
      for (const w of wordsA) {
        if (wordsB.has(w)) common++;
      }
      score += (common / Math.max(wordsA.size, wordsB.size)) * 0.5;
    }

    return Math.min(score, 1);
  }
}
