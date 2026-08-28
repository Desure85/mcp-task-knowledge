/**
 * behavioral/auto-heal.spec.ts — Tests for AutoHealWorker (BM-007).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { IntentCapture } from './intent-capture.js';
import { RuntimeObservation } from './runtime-observation.js';
import { FailureLogger } from './failure-logging.js';
import { ResolutionLogger } from './resolution-logging.js';
import { RepairBrief } from './repair-brief.js';
import { AutoHealWorker } from './auto-heal.js';
import type { FailureRecord } from './failure-logging.js';

let testDir: string;

describe('BM-007: AutoHealWorker', () => {
  let intents: IntentCapture;
  let observations: RuntimeObservation;
  let failures: FailureLogger;
  let resolutions: ResolutionLogger;
  let brief: RepairBrief;
  let worker: AutoHealWorker;

  /** Log a failure, fix it, and mark it resolved — a proven fix in memory. */
  function provenFix(input: {
    prompt: string;
    file: string;
    errorType: string;
    message: string;
    approach: string;
    commitSha?: string;
    prUrl?: string;
    failedApproaches?: string[];
  }): void {
    const intent = intents.record({
      prompt: input.prompt,
      file: input.file,
      contentHash: `sha256:${input.file}`,
    });
    const failure = failures.log({
      memoryId: intent.memoryId,
      errorType: input.errorType,
      message: input.message,
    });
    const resolution = resolutions.log({
      failureId: failure.failureId,
      fixingMemoryId: intent.memoryId,
      approach: input.approach,
      commitSha: input.commitSha,
      prUrl: input.prUrl,
      failedApproaches: input.failedApproaches,
    });
    failures.resolve(failure.failureId, resolution.resolutionId);
  }

  /** Log an unresolved failure for a fresh intent. */
  function openFailure(input: {
    prompt: string;
    file: string;
    errorType: string;
    message: string;
  }): FailureRecord {
    const intent = intents.record({
      prompt: input.prompt,
      file: input.file,
      contentHash: `sha256:${input.file}-open`,
    });
    return failures.log({
      memoryId: intent.memoryId,
      errorType: input.errorType,
      message: input.message,
    });
  }

  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `ah-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    intents = new IntentCapture({ storagePath: testDir });
    observations = new RuntimeObservation({ storagePath: testDir });
    failures = new FailureLogger({ storagePath: testDir });
    resolutions = new ResolutionLogger({ storagePath: testDir });
    brief = new RepairBrief(intents, observations, failures, resolutions);
    worker = new AutoHealWorker(brief, failures, { intervalMs: 10 });
  });

  afterEach(() => {
    worker.stop();
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('trigger()', () => {
    it('generates nothing when there are no failures', () => {
      expect(worker.trigger()).toEqual([]);
    });

    it('generates nothing when no proven fix matches', () => {
      openFailure({
        prompt: 'Add auth',
        file: 'src/auth.ts',
        errorType: 'TypeError',
        message: 'cannot read property token of undefined',
      });

      expect(worker.trigger()).toEqual([]);
      expect(worker.status().unhealable).toBe(1);
    });

    it('generates a patch from a proven fix of the same shape', () => {
      provenFix({
        prompt: 'Parse config',
        file: 'src/config.ts',
        errorType: 'TypeError',
        message: 'cannot read property token of undefined',
        approach: 'guard against undefined session before reading token',
        commitSha: 'abc1234',
      });
      const failure = openFailure({
        prompt: 'Add auth',
        file: 'src/auth.ts',
        errorType: 'TypeError',
        message: 'cannot read property token of undefined',
      });

      const patches = worker.trigger();
      expect(patches).toHaveLength(1);
      expect(patches[0].failureId).toBe(failure.failureId);
      expect(patches[0].memoryId).toBe(failure.memoryId);
      expect(patches[0].file).toBe('src/auth.ts');
      expect(patches[0].approach).toBe('guard against undefined session before reading token');
      expect(patches[0].confidence).toBeGreaterThanOrEqual(0.5);
      expect(patches[0].sourceResolutionIds).toHaveLength(1);
    });

    it('skips fixes below minConfidence', () => {
      const strict = new AutoHealWorker(brief, failures, { minConfidence: 0.99 });
      provenFix({
        prompt: 'Parse config',
        file: 'src/config.ts',
        errorType: 'TypeError',
        message: 'cannot read property token of undefined',
        approach: 'add null guard',
      });
      openFailure({
        prompt: 'Add auth',
        file: 'src/auth.ts',
        errorType: 'TypeError',
        message: 'cannot read property session of undefined',
      });

      expect(strict.trigger()).toEqual([]);
      expect(strict.status().unhealable).toBe(1);
    });

    it('does not patch resolved failures', () => {
      provenFix({
        prompt: 'Parse config',
        file: 'src/config.ts',
        errorType: 'TypeError',
        message: 'cannot read property token of undefined',
        approach: 'add null guard',
      });

      expect(worker.trigger()).toEqual([]);
      expect(worker.status().unresolvedFailures).toBe(0);
    });

    it('patches each failure only once across cycles', () => {
      provenFix({
        prompt: 'Parse config',
        file: 'src/config.ts',
        errorType: 'RangeError',
        message: 'offset outside buffer bounds',
        approach: 'clamp offset to buffer length',
      });
      openFailure({
        prompt: 'Read frame',
        file: 'src/frame.ts',
        errorType: 'RangeError',
        message: 'offset outside buffer bounds',
      });

      expect(worker.trigger()).toHaveLength(1);
      expect(worker.trigger()).toHaveLength(0);
      expect(worker.status().patches).toHaveLength(1);
    });

    it('picks the highest-confidence proven fix and lists the rest as sources', () => {
      provenFix({
        prompt: 'Parse config',
        file: 'src/config.ts',
        errorType: 'RangeError',
        message: 'offset outside buffer bounds',
        approach: 'clamp offset to buffer length',
      });
      provenFix({
        prompt: 'Decode packet',
        file: 'src/packet.ts',
        errorType: 'RangeError',
        message: 'offset wrong',
        approach: 'validate offset argument',
      });
      openFailure({
        prompt: 'Read frame',
        file: 'src/frame.ts',
        errorType: 'RangeError',
        message: 'offset outside buffer bounds',
      });

      const [patch] = worker.trigger();
      expect(patch.approach).toBe('clamp offset to buffer length');
      expect(patch.sourceResolutionIds.length).toBeGreaterThan(1);
    });

    it('drops oldest patches beyond maxPatches', () => {
      const small = new AutoHealWorker(brief, failures, { maxPatches: 1 });
      provenFix({
        prompt: 'Parse config',
        file: 'src/config.ts',
        errorType: 'TypeError',
        message: 'cannot read property token of undefined',
        approach: 'add null guard',
      });
      openFailure({
        prompt: 'Add auth',
        file: 'src/auth.ts',
        errorType: 'TypeError',
        message: 'cannot read property token of undefined',
      });
      openFailure({
        prompt: 'Add session',
        file: 'src/session.ts',
        errorType: 'TypeError',
        message: 'cannot read property token of undefined',
      });

      small.trigger();
      expect(small.status().patches).toHaveLength(1);
    });
  });

  describe('diff', () => {
    beforeEach(() => {
      provenFix({
        prompt: 'Parse config',
        file: 'src/config.ts',
        errorType: 'TypeError',
        message: 'cannot read property token of undefined',
        approach: 'guard undefined session',
        commitSha: 'abc1234',
        prUrl: 'https://example.com/pr/7',
        failedApproaches: ['cast to any'],
      });
      openFailure({
        prompt: 'Add auth',
        file: 'src/auth.ts',
        errorType: 'TypeError',
        message: 'cannot read property token of undefined',
      });
    });

    it('annotates the target file and failure', () => {
      const [patch] = worker.trigger();
      expect(patch.diff).toContain('--- a/src/auth.ts');
      expect(patch.diff).toContain('+++ b/src/auth.ts');
      expect(patch.diff).toContain('TypeError: cannot read property token of undefined');
      expect(patch.diff).toContain('Add auth');
    });

    it('annotates the proven fix with its commit and PR', () => {
      const [patch] = worker.trigger();
      expect(patch.diff).toContain('guard undefined session');
      expect(patch.diff).toContain('abc1234');
      expect(patch.diff).toContain('https://example.com/pr/7');
    });

    it('warns about approaches that failed before', () => {
      const [patch] = worker.trigger();
      expect(patch.diff).toContain('Do NOT retry');
      expect(patch.diff).toContain('cast to any');
    });

    it('marks the patch as a suggestion', () => {
      const [patch] = worker.trigger();
      expect(patch.diff).toContain('Review before applying');
    });
  });

  describe('status()', () => {
    it('reports defaults before any cycle', () => {
      const status = worker.status();
      expect(status.running).toBe(false);
      expect(status.runs).toBe(0);
      expect(status.lastRunAt).toBeNull();
      expect(status.patches).toEqual([]);
    });

    it('counts cycles and records the last run', () => {
      worker.trigger();
      worker.trigger();
      const status = worker.status();
      expect(status.runs).toBe(2);
      expect(status.lastRunAt).not.toBeNull();
    });

    it('reports unresolved failures', () => {
      openFailure({
        prompt: 'Add auth',
        file: 'src/auth.ts',
        errorType: 'TypeError',
        message: 'boom',
      });
      expect(worker.status().unresolvedFailures).toBe(1);
    });

    it('returns a copy of the patch list', () => {
      const status = worker.status();
      status.patches.push({} as never);
      expect(worker.status().patches).toEqual([]);
    });
  });

  describe('start() / stop()', () => {
    it('reports running state', () => {
      expect(worker.status().running).toBe(false);
      worker.start();
      expect(worker.status().running).toBe(true);
      worker.stop();
      expect(worker.status().running).toBe(false);
    });

    it('is idempotent', () => {
      worker.start();
      worker.start();
      worker.stop();
      worker.stop();
      expect(worker.status().running).toBe(false);
    });

    it('polls on the configured interval', () => {
      vi.useFakeTimers();
      try {
        worker.start();
        vi.advanceTimersByTime(35);
        expect(worker.status().runs).toBe(3);
      } finally {
        worker.stop();
        vi.useRealTimers();
      }
    });

    it('keeps polling after a failing cycle', () => {
      vi.useFakeTimers();
      const boom = vi.spyOn(failures, 'getUnresolved').mockImplementation(() => {
        throw new Error('storage down');
      });
      try {
        worker.start();
        vi.advanceTimersByTime(25);
        boom.mockRestore();
        vi.advanceTimersByTime(10);
        expect(worker.status().runs).toBe(1);
      } finally {
        boom.mockRestore();
        worker.stop();
        vi.useRealTimers();
      }
    });
  });

  describe('patch lookup', () => {
    beforeEach(() => {
      provenFix({
        prompt: 'Parse config',
        file: 'src/config.ts',
        errorType: 'TypeError',
        message: 'cannot read property token of undefined',
        approach: 'add null guard',
      });
      openFailure({
        prompt: 'Add auth',
        file: 'src/auth.ts',
        errorType: 'TypeError',
        message: 'cannot read property token of undefined',
      });
    });

    it('finds a patch by ID', () => {
      const [patch] = worker.trigger();
      expect(worker.getPatch(patch.patchId)).toEqual(patch);
      expect(worker.getPatch('patch-unknown')).toBeUndefined();
    });

    it('finds patches by failure', () => {
      const [patch] = worker.trigger();
      expect(worker.getPatchesForFailure(patch.failureId)).toEqual([patch]);
      expect(worker.getPatchesForFailure('fail-unknown')).toEqual([]);
    });

    it('lists patches newest first with a limit', () => {
      openFailure({
        prompt: 'Add session',
        file: 'src/session.ts',
        errorType: 'TypeError',
        message: 'cannot read property token of undefined',
      });
      const created = worker.trigger();
      expect(created).toHaveLength(2);
      expect(worker.listPatches()[0]).toEqual(created[1]);
      expect(worker.listPatches(1)).toEqual([created[1]]);
    });

    it('re-evaluates failures after clearPatches()', () => {
      expect(worker.trigger()).toHaveLength(1);
      worker.clearPatches();
      expect(worker.status().patches).toEqual([]);
      expect(worker.trigger()).toHaveLength(1);
    });
  });
});
