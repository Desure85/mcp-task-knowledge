/**
 * behavioral/auto-heal.ts — Auto-heal worker (BM-007).
 *
 * Background worker that polls unresolved failures and generates repair
 * patches out of historical memory: proven fixes of the same failure shape.
 *
 * MCP tools:
 *   `auto_heal_trigger` — explicit poll cycle, returns generated patches.
 *   `auto_heal_status`  — worker state, counters, generated patches.
 *
 * A patch is a comment-annotated diff derived from proven fixes; it is a
 * suggestion for the agent, never applied automatically.
 *
 * Usage:
 *   const worker = new AutoHealWorker(brief, failures, { intervalMs: 60_000 });
 *   worker.start();
 *   const patches = worker.trigger();
 */

import type { RepairBrief, RepairBriefResult, SimilarFix } from './repair-brief.js';
import type { FailureLogger, FailureRecord } from './failure-logging.js';
import { childLogger } from '../core/logger.js';

const log = childLogger('auto-heal');

// ─── Types ────────────────────────────────────────────────────────

export interface RepairPatch {
  /** Unique patch ID. */
  patchId: string;
  /** Failure this patch addresses. */
  failureId: string;
  /** Intent that produced the failing code. */
  memoryId: string;
  /** File the patch targets. */
  file: string;
  /** Fix approach taken from the proven fix. */
  approach: string;
  /** Confidence (0-1) — similarity of the proven fix to this failure. */
  confidence: number;
  /** Resolutions the patch was distilled from, best first. */
  sourceResolutionIds: string[];
  /** Comment-annotated diff for the agent to review. */
  diff: string;
  /** When the patch was generated (ISO 8601). */
  createdAt: string;
}

export interface AutoHealStatus {
  /** Whether the background poll loop is active. */
  running: boolean;
  /** Poll interval of the background loop. */
  intervalMs: number;
  /** Minimum confidence a proven fix needs to produce a patch. */
  minConfidence: number;
  /** Number of completed poll cycles. */
  runs: number;
  /** When the last cycle ran (ISO 8601), null if never. */
  lastRunAt: string | null;
  /** Currently unresolved failures. */
  unresolvedFailures: number;
  /** Failures with no proven fix above `minConfidence`. */
  unhealable: number;
  /** All patches held by the worker. */
  patches: RepairPatch[];
}

export interface AutoHealWorkerOptions {
  /** Poll interval for `start()` (default 60s). */
  intervalMs?: number;
  /** Minimum similarity of a proven fix to emit a patch (default 0.5). */
  minConfidence?: number;
  /** Maximum patches retained; oldest are dropped (default 50). */
  maxPatches?: number;
}

// ─── AutoHealWorker ───────────────────────────────────────────────

export class AutoHealWorker {
  private readonly intervalMs: number;
  private readonly minConfidence: number;
  private readonly maxPatches: number;

  private timer: ReturnType<typeof setInterval> | null = null;
  private patches: RepairPatch[] = [];
  /** failureId → patchId, so a failure is never patched twice. */
  private readonly patched = new Map<string, string>();
  private runs = 0;
  private lastRunAt: string | null = null;
  private unhealable = 0;

  constructor(
    private readonly brief: RepairBrief,
    private readonly failures: FailureLogger,
    options?: AutoHealWorkerOptions,
  ) {
    this.intervalMs = options?.intervalMs ?? 60_000;
    this.minConfidence = options?.minConfidence ?? 0.5;
    this.maxPatches = options?.maxPatches ?? 50;
  }

  /**
   * Start the background poll loop. Idempotent.
   */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.trigger();
      } catch (err) {
        log.error({ err }, 'auto-heal cycle failed');
      }
    }, this.intervalMs);
    this.timer.unref?.();
    log.info({ intervalMs: this.intervalMs }, 'auto-heal worker started');
  }

  /**
   * Stop the background poll loop. Idempotent.
   */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    log.info('auto-heal worker stopped');
  }

  /**
   * Run one poll cycle: generate patches for unresolved failures that have a
   * proven fix of the same shape. Returns the patches created by this cycle.
   */
  trigger(): RepairPatch[] {
    const created: RepairPatch[] = [];
    let unhealable = 0;

    for (const failure of this.failures.getUnresolved()) {
      if (this.patched.has(failure.failureId)) continue;

      const result = this.brief.assemble(failure.memoryId);
      if (!result) continue;

      const patch = this.buildPatch(failure, result);
      if (!patch) {
        unhealable++;
        continue;
      }

      this.patched.set(failure.failureId, patch.patchId);
      this.patches.push(patch);
      created.push(patch);
    }

    // Retain only the newest maxPatches
    if (this.patches.length > this.maxPatches) {
      for (const dropped of this.patches.splice(0, this.patches.length - this.maxPatches)) {
        this.patched.delete(dropped.failureId);
      }
    }

    this.runs++;
    this.lastRunAt = new Date().toISOString();
    this.unhealable = unhealable;
    log.info({ created: created.length, unhealable }, 'auto-heal cycle complete');

    return created;
  }

  /**
   * Current worker state.
   */
  status(): AutoHealStatus {
    return {
      running: this.timer !== null,
      intervalMs: this.intervalMs,
      minConfidence: this.minConfidence,
      runs: this.runs,
      lastRunAt: this.lastRunAt,
      unresolvedFailures: this.failures.getUnresolved().length,
      unhealable: this.unhealable,
      patches: [...this.patches],
    };
  }

  /**
   * Get a generated patch by ID.
   */
  getPatch(patchId: string): RepairPatch | undefined {
    return this.patches.find((p) => p.patchId === patchId);
  }

  /**
   * Patches generated for a failure (at most one per failure).
   */
  getPatchesForFailure(failureId: string): RepairPatch[] {
    return this.patches.filter((p) => p.failureId === failureId);
  }

  /**
   * All patches, newest first.
   */
  listPatches(limit?: number): RepairPatch[] {
    const patches = [...this.patches].reverse();
    return limit ? patches.slice(0, limit) : patches;
  }

  /**
   * Drop all generated patches so failures can be re-evaluated.
   */
  clearPatches(): void {
    this.patches = [];
    this.patched.clear();
  }

  // ─── Internal ───────────────────────────────────────────────────

  /**
   * Distill a patch from the best proven fix of the same failure shape.
   * Returns null when no proven fix clears `minConfidence`.
   */
  private buildPatch(failure: FailureRecord, result: RepairBriefResult): RepairPatch | null {
    const candidates = result.similarFixes
      .filter((sf) => sf.similarity >= this.minConfidence)
      .sort((a, b) => b.similarity - a.similarity);

    const best = candidates[0];
    if (!best) return null;

    return {
      patchId: `patch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      failureId: failure.failureId,
      memoryId: failure.memoryId,
      file: result.intent.file,
      approach: best.resolution.approach,
      confidence: best.similarity,
      sourceResolutionIds: candidates.map((sf) => sf.resolution.resolutionId),
      diff: this.formatDiff(failure, result, candidates),
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Comment-annotated diff: the target file plus the proven fix history that
   * motivates it. Hunks are advisory — the agent writes the actual change.
   */
  private formatDiff(
    failure: FailureRecord,
    result: RepairBriefResult,
    candidates: SimilarFix[],
  ): string {
    const best = candidates[0];
    const file = result.intent.file;
    const lines: string[] = [
      `--- a/${file}`,
      `+++ b/${file}`,
      '@@ auto-heal @@',
      `# Failure: ${failure.errorType}: ${failure.message}`,
      `# Intent: ${result.intent.prompt}`,
      `# Confidence: ${Math.round(best.similarity * 100)}% (proven fix of the same failure shape)`,
      '#',
      `# Apply this approach: ${best.resolution.approach}`,
    ];

    if (best.resolution.commitSha) lines.push(`# Proven in commit: ${best.resolution.commitSha}`);
    if (best.resolution.prUrl) lines.push(`# Proven in PR: ${best.resolution.prUrl}`);

    if (best.resolution.failedApproaches && best.resolution.failedApproaches.length > 0) {
      lines.push('#', '# Do NOT retry (failed before):');
      for (const fa of best.resolution.failedApproaches) lines.push(`#   - ${fa}`);
    }

    if (candidates.length > 1) {
      lines.push('#', '# Alternative proven fixes:');
      for (const alt of candidates.slice(1)) {
        lines.push(`#   - ${Math.round(alt.similarity * 100)}%: ${alt.resolution.approach}`);
      }
    }

    lines.push('#', '# Review before applying — this patch is a suggestion, not an applied change.');

    return lines.join('\n');
  }
}
