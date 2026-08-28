/**
 * behavioral/repair-brief.ts — Repair brief (BM-005).
 *
 * MCP tool `get_repair_brief` — assembles structured context for fixing:
 *   intent + runtime traces + failures + proven fixes from similar past errors.
 * One MCP call instead of manual search.
 *
 * Fuses: intent + runtime + failure + suggested fix approach.
 *
 * Usage:
 *   const brief = new RepairBrief(intentCapture, runtimeObs, failureLogger, resolutionLogger);
 *   const result = brief.assemble('intent-abc123');
 *   // result.brief contains structured context for the AI agent
 */

import type { IntentCapture } from './intent-capture.js';
import type { RuntimeObservation } from './runtime-observation.js';
import type { FailureLogger } from './failure-logging.js';
import type { ResolutionLogger } from './resolution-logging.js';
import type { IntentRecord } from './intent-capture.js';
import type { RuntimeSnapshot } from './runtime-observation.js';
import type { FailureRecord } from './failure-logging.js';
import type { ResolutionRecord } from './resolution-logging.js';
import { childLogger } from '../core/logger.js';

const log = childLogger('repair-brief');

// ─── Types ────────────────────────────────────────────────────────

export interface RepairBriefResult {
  /** The intent being repaired. */
  intent: IntentRecord;
  /** Runtime snapshots for this intent. */
  runtimeTraces: RuntimeSnapshot[];
  /** Failures for this intent. */
  failures: FailureRecord[];
  /** Resolutions for failures of this intent. */
  resolutions: ResolutionRecord[];
  /** Similar past failures (from other intents) with proven fixes. */
  similarFixes: SimilarFix[];
  /** Formatted brief text for the AI agent. */
  brief: string;
}

export interface SimilarFix {
  /** The similar failure. */
  failure: FailureRecord;
  /** The resolution that fixed it. */
  resolution: ResolutionRecord;
  /** Similarity score (0-1). */
  similarity: number;
}

// ─── RepairBrief ──────────────────────────────────────────────────

export class RepairBrief {
  constructor(
    private readonly intents: IntentCapture,
    private readonly observations: RuntimeObservation,
    private readonly failures: FailureLogger,
    private readonly resolutions: ResolutionLogger,
  ) {}

  /**
   * Assemble a repair brief for an intent.
   */
  assemble(memoryId: string): RepairBriefResult | null {
    const intent = this.intents.get(memoryId);
    if (!intent) {
      log.warn({ memoryId }, 'intent not found');
      return null;
    }

    const runtimeTraces = this.observations.getByMemoryId(memoryId);
    const failures = this.failures.getByMemoryId(memoryId);

    // Get resolutions for all failures of this intent
    const resolutions: ResolutionRecord[] = [];
    for (const failure of failures) {
      const res = this.resolutions.getByFailureId(failure.failureId);
      if (res) resolutions.push(res);
    }

    // Find similar past failures with proven fixes
    const similarFixes = this.findSimilarFixes(failures);

    // Generate formatted brief
    const brief = this.formatBrief(intent, runtimeTraces, failures, resolutions, similarFixes);

    return { intent, runtimeTraces, failures, resolutions, similarFixes, brief };
  }

  /**
   * Assemble a brief for the most recent failure.
   */
  assembleForLatestFailure(): RepairBriefResult | null {
    const allFailures = this.failures.list();
    if (allFailures.length === 0) return null;

    const latest = allFailures[0];
    return this.assemble(latest.memoryId);
  }

  /**
   * Assemble a brief for all unresolved failures.
   */
  assembleForUnresolved(): RepairBriefResult[] {
    const unresolved = this.failures.getUnresolved();
    const results: RepairBriefResult[] = [];
    const seen = new Set<string>();

    for (const failure of unresolved) {
      if (seen.has(failure.memoryId)) continue;
      seen.add(failure.memoryId);
      const result = this.assemble(failure.memoryId);
      if (result) results.push(result);
    }

    return results;
  }

  // ─── Internal ───────────────────────────────────────────────────

  /**
   * Find similar past failures with proven fixes.
   * Similarity is based on error type and message overlap.
   */
  private findSimilarFixes(currentFailures: FailureRecord[]): SimilarFix[] {
    if (currentFailures.length === 0) return [];

    const allResolutions = this.resolutions.list();
    const similar: SimilarFix[] = [];

    for (const resolution of allResolutions) {
      const resolvedFailure = this.failures.get(resolution.failureId);
      if (!resolvedFailure) continue;

      // Skip if this resolution is for one of the current failures
      if (currentFailures.some((f) => f.failureId === resolvedFailure.failureId)) continue;

      // Calculate similarity for each current failure
      for (const current of currentFailures) {
        const similarity = this.calculateSimilarity(current, resolvedFailure);
        if (similarity > 0.3) {
          similar.push({
            failure: resolvedFailure,
            resolution,
            similarity,
          });
        }
      }
    }

    // Sort by similarity (highest first) and take top 5
    return similar.sort((a, b) => b.similarity - a.similarity).slice(0, 5);
  }

  /**
   * Calculate similarity between two failures (0-1).
   * Based on: same error type (+0.5) + word overlap in message (up to +0.5).
   */
  private calculateSimilarity(a: FailureRecord, b: FailureRecord): number {
    let score = 0;

    // Same error type
    if (a.errorType === b.errorType) {
      score += 0.5;
    }

    // Word overlap in message
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

  /**
   * Format the brief as readable text for the AI agent.
   */
  private formatBrief(
    intent: IntentRecord,
    traces: RuntimeSnapshot[],
    failures: FailureRecord[],
    resolutions: ResolutionRecord[],
    similarFixes: SimilarFix[],
  ): string {
    const lines: string[] = [
      '# Repair Brief',
      '',
      '## Intent',
      `- **File:** ${intent.file}`,
      `- **Prompt:** ${intent.prompt}`,
      `- **Content Hash:** ${intent.contentHash}`,
      `- **Captured:** ${intent.timestamp}`,
      '',
    ];

    if (traces.length > 0) {
      lines.push('## Runtime Traces');
      for (const trace of traces) {
        lines.push(`### ${trace.functionName} (${trace.durationMs}ms) — ${trace.success ? 'success' : 'FAILED'}`);
        if (trace.error) lines.push(`- **Error:** ${trace.error}`);
        if (trace.stackTrace) lines.push('- **Stack:**', '```', trace.stackTrace, '```');
        if (trace.args && Object.keys(trace.args).length > 0) {
          lines.push(`- **Args:** ${JSON.stringify(trace.args)}`);
        }
        lines.push('');
      }
    }

    if (failures.length > 0) {
      lines.push('## Failures');
      for (const f of failures) {
        const status = f.resolved ? '✅ RESOLVED' : '❌ UNRESOLVED';
        lines.push(`### ${f.errorType}: ${f.message} [${status}]`);
        if (f.stack) lines.push('- **Stack:**', '```', f.stack, '```');
        lines.push('');
      }
    }

    if (resolutions.length > 0) {
      lines.push('## Applied Fixes');
      for (const r of resolutions) {
        lines.push(`### Fix: ${r.approach}`);
        if (r.commitSha) lines.push(`- **Commit:** ${r.commitSha}`);
        if (r.prUrl) lines.push(`- **PR:** ${r.prUrl}`);
        if (r.failedApproaches && r.failedApproaches.length > 0) {
          lines.push('- **Failed approaches:**');
          for (const fa of r.failedApproaches) lines.push(`  - ${fa}`);
        }
        lines.push('');
      }
    }

    if (similarFixes.length > 0) {
      lines.push('## Similar Past Fixes (Recommended Approaches)');
      for (const sf of similarFixes) {
        lines.push(`### Similarity: ${Math.round(sf.similarity * 100)}%`);
        lines.push(`- **Past error:** ${sf.failure.errorType}: ${sf.failure.message}`);
        lines.push(`- **Fix that worked:** ${sf.resolution.approach}`);
        if (sf.resolution.commitSha) lines.push(`- **Commit:** ${sf.resolution.commitSha}`);
        lines.push('');
      }
    }

    return lines.join('\n');
  }
}
