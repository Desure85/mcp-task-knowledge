/**
 * behavioral/auto-heal.ts — Auto-heal worker (BM-007).
 *
 * Polls unresolved failures and generates repair patches from proven fixes
 * of the same shape of failure (error type + message similarity).
 *
 * - `auto_heal_trigger` — explicit trigger: `trigger()` runs one pass.
 * - `auto_heal_status` — check: `status()` returns counters + recent patches.
 * - Patch = comment-annotated diff built from historical resolutions.
 *
 * Usage:
 *   const worker = new AutoHealWorker(failures, resolutions);
 *   const patches = worker.trigger();        // explicit pass
 *   worker.applyPatch(patches[0].patchId);   // resolves the failure
 *   worker.start(60_000);                    // background polling
 *   worker.stop();
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { childLogger } from '../core/logger.js';
import type { FailureLogger } from './failure-logging.js';
import type { ResolutionLogger } from './resolution-logging.js';
import type { FailureRecord } from './failure-logging.js';
import type { ResolutionRecord } from './resolution-logging.js';

const log = childLogger('auto-heal');

// ─── Types ────────────────────────────────────────────────────────

export type PatchStatus = 'suggested' | 'applied' | 'rejected';

export interface SourceResolution {
  resolutionId: string;
  approach: string;
  similarity: number;
}

export interface RepairPatch {
  /** Unique patch ID. */
  patchId: string;
  /** Failure being healed. */
  failureId: string;
  /** Linked intent memory ID. */
  memoryId: string;
  /** Error type of the failure. */
  errorType: string;
  /** Error message of the failure. */
  message: string;
  /** Comment-annotated diff (suggestion). */
  diff: string;
  /** Proven fixes the patch is based on. */
  sources: SourceResolution[];
  /** Patch lifecycle status. */
  status: PatchStatus;
  /** When the patch was generated (ISO 8601). */
  generatedAt: string;
  /** When the patch was applied (ISO 8601). */
  appliedAt?: string;
}

export interface AutoHealOptions {
  /** Similarity threshold for a fix to count as proven. Default: 0.3. */
  similarityThreshold?: number;
  /** Max patches per trigger pass. Default: 10. */
  maxPatchesPerRun?: number;
  /** Poll interval in ms (used by start()). Default: 60_000. */
  pollIntervalMs?: number;
}

export interface TriggerFilter {
  failureId?: string;
  errorType?: string;
}

export interface AutoHealStatus {
  /** Whether background polling is running. */
  running: boolean;
  /** Last trigger time (ISO 8601). */
  lastRunAt?: string;
  /** Total number of trigger passes. */
  runs: number;
  /** Current number of unresolved failures. */
  unresolvedFailures: number;
  /** Patches generated in total. */
  patchesGenerated: number;
  /** Patches applied (failures resolved). */
  patchesApplied: number;
  /** Patches rejected. */
  patchesRejected: number;
  /** Recent patches (newest first). */
  recentPatches: RepairPatch[];
}

// ─── Storage ──────────────────────────────────────────────────────

interface AutoHealStorage {
  patches: RepairPatch[];
  runs: number;
  lastRunAt?: string;
}

// ─── AutoHealWorker ───────────────────────────────────────────────

export class AutoHealWorker {
  private readonly failures: FailureLogger;
  private readonly resolutions: ResolutionLogger;
  private readonly similarityThreshold: number;
  private readonly maxPatchesPerRun: number;
  private readonly defaultPollIntervalMs: number;
  private readonly storagePath: string;
  private readonly filePath: string;
  private storage: AutoHealStorage;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    failures: FailureLogger,
    resolutions: ResolutionLogger,
    options?: AutoHealOptions & { storagePath?: string },
  ) {
    this.failures = failures;
    this.resolutions = resolutions;
    this.similarityThreshold = options?.similarityThreshold ?? 0.3;
    this.maxPatchesPerRun = options?.maxPatchesPerRun ?? 10;
    this.defaultPollIntervalMs = options?.pollIntervalMs ?? 60_000;
    this.storagePath = options?.storagePath ?? '.behavioral';
    this.filePath = join(this.storagePath, 'auto-heal.json');
    this.storage = this.load();
  }

  /**
   * Explicit trigger (`auto_heal_trigger`): one pass over unresolved failures.
   * Generates patches only for failures with proven similar fixes.
   */
  trigger(filter?: TriggerFilter): RepairPatch[] {
    let unresolved = this.failures.getUnresolved();
    if (filter?.failureId) unresolved = unresolved.filter((f) => f.failureId === filter.failureId);
    if (filter?.errorType) unresolved = unresolved.filter((f) => f.errorType === filter.errorType);

    const generated: RepairPatch[] = [];
    for (const failure of unresolved) {
      if (generated.length >= this.maxPatchesPerRun) break;
      if (this.hasExistingPatch(failure.failureId)) continue;

      const sources = this.findProvenFixes(failure);
      if (sources.length === 0) continue;

      const patch = this.buildPatch(failure, sources);
      this.storage.patches.push(patch);
      generated.push(patch);
    }

    this.storage.runs += 1;
    this.storage.lastRunAt = new Date().toISOString();
    this.save();
    log.info({ generated: generated.length }, 'auto-heal trigger pass finished');
    return generated;
  }

  /**
   * Status check (`auto_heal_status`).
   */
  status(): AutoHealStatus {
    const patches = this.storage.patches;
    return {
      running: this.running,
      lastRunAt: this.storage.lastRunAt,
      runs: this.storage.runs,
      unresolvedFailures: this.failures.getUnresolved().length,
      patchesGenerated: patches.length,
      patchesApplied: patches.filter((p) => p.status === 'applied').length,
      patchesRejected: patches.filter((p) => p.status === 'rejected').length,
      recentPatches: [...patches].reverse().slice(0, 10),
    };
  }

  /**
   * Start background polling.
   */
  start(intervalMs?: number): void {
    if (this.running) return;
    this.running = true;
    const interval = intervalMs ?? this.defaultPollIntervalMs;
    this.timer = setInterval(() => {
      try {
        this.trigger();
      } catch (err) {
        log.error({ err }, 'auto-heal background pass failed');
      }
    }, interval);
    log.info({ interval }, 'auto-heal worker started');
  }

  /**
   * Stop background polling.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info({}, 'auto-heal worker stopped');
  }

  /**
   * Apply a patch — marks it applied and resolves the failure.
   */
  applyPatch(patchId: string): boolean {
    const patch = this.storage.patches.find((p) => p.patchId === patchId);
    if (!patch || patch.status !== 'suggested') return false;

    patch.status = 'applied';
    patch.appliedAt = new Date().toISOString();
    const sourceResolution = patch.sources[0]?.resolutionId;
    if (sourceResolution) {
      this.failures.resolve(patch.failureId, sourceResolution);
    }
    this.save();
    log.info({ patchId, failureId: patch.failureId }, 'auto-heal patch applied');
    return true;
  }

  /**
   * Reject a patch — dismisses the suggestion.
   */
  rejectPatch(patchId: string): boolean {
    const patch = this.storage.patches.find((p) => p.patchId === patchId);
    if (!patch || patch.status !== 'suggested') return false;
    patch.status = 'rejected';
    this.save();
    log.info({ patchId }, 'auto-heal patch rejected');
    return true;
  }

  /**
   * Get a patch by ID.
   */
  getPatch(patchId: string): RepairPatch | undefined {
    return this.storage.patches.find((p) => p.patchId === patchId);
  }

  get count(): number {
    return this.storage.patches.length;
  }

  // ─── Internal ───────────────────────────────────────────────────

  private hasExistingPatch(failureId: string): boolean {
    return this.storage.patches.some((p) => p.failureId === failureId);
  }

  /**
   * Find proven fixes (resolutions) for the same shape of failure.
   */
  private findProvenFixes(failure: FailureRecord): SourceResolution[] {
    const sources: SourceResolution[] = [];

    for (const resolution of this.resolutions.list()) {
      const resolvedFailure = this.failures.get(resolution.failureId);
      if (!resolvedFailure || !resolvedFailure.resolved) continue;
      if (resolvedFailure.failureId === failure.failureId) continue;

      const similarity = this.calculateSimilarity(failure, resolvedFailure);
      if (similarity >= this.similarityThreshold) {
        sources.push({ resolutionId: resolution.resolutionId, approach: resolution.approach, similarity });
      }
    }

    return sources.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Similarity (0-1): same error type (+0.5) + word overlap in message (up to +0.5).
   */
  private calculateSimilarity(a: FailureRecord, b: FailureRecord): number {
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

  /**
   * Build a comment-annotated diff patch from proven fixes.
   */
  private buildPatch(failure: FailureRecord, sources: SourceResolution[]): RepairPatch {
    const best = sources[0];
    const lines: string[] = [
      '# AUTO-HEAL PATCH',
      `# failure: ${failure.failureId} (${failure.errorType}): ${failure.message}`,
      `# similarity: ${Math.round(best.similarity * 100)}% with proven fix`,
      `# proven fix: ${best.approach}`,
      `# source resolution: ${best.resolutionId}`,
      '',
      '# Suggested diff (comment-annotated):',
      '--- a/' + this.contextFile(failure) + '  (unresolved failure)',
      '+++ b/' + this.contextFile(failure) + '  (proposed fix)',
      '@@ -1 +1 @@',
      `-// BUG: ${failure.errorType}: ${failure.message}`,
      ...this.approachLines(best.approach, best),
      '',
      '# Review before applying. Apply via auto-heal applyPatch().',
    ];

    return {
      patchId: `patch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      failureId: failure.failureId,
      memoryId: failure.memoryId,
      errorType: failure.errorType,
      message: failure.message,
      diff: lines.join('\n'),
      sources,
      status: 'suggested',
      generatedAt: new Date().toISOString(),
    };
  }

  private contextFile(failure: FailureRecord): string {
    const file = failure.context?.file;
    return typeof file === 'string' && file ? file : 'unknown.ts';
  }

  private approachLines(approach: string, source: SourceResolution): string[] {
    const lines = ['+// FIX (proven): ' + approach];
    const resolution = this.resolutions.get(source.resolutionId);
    if (resolution?.commitSha) lines.push(`+// See commit: ${resolution.commitSha}`);
    if (resolution?.failedApproaches && resolution.failedApproaches.length > 0) {
      lines.push('+// Failed approaches to avoid:');
      for (const fa of resolution.failedApproaches) lines.push(`+//   - ${fa}`);
    }
    return lines;
  }

  private load(): AutoHealStorage {
    try {
      if (existsSync(this.filePath)) {
        const data = JSON.parse(readFileSync(this.filePath, 'utf8'));
        return {
          patches: data.patches ?? [],
          runs: data.runs ?? 0,
          lastRunAt: data.lastRunAt,
        };
      }
    } catch (err) {
      log.warn({ err }, 'failed to load auto-heal state, starting fresh');
    }
    return { patches: [], runs: 0 };
  }

  private save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.storage, null, 2), 'utf8');
    } catch (err) {
      log.error({ err }, 'failed to save auto-heal state');
    }
  }
}
