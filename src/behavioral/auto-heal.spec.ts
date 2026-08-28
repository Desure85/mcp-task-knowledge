/**
 * behavioral/auto-heal.spec.ts — Tests for AutoHealWorker (BM-007).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { FailureLogger } from './failure-logging.js';
import { ResolutionLogger } from './resolution-logging.js';
import { AutoHealWorker } from './auto-heal.js';

let testDir: string;
let failures: FailureLogger;
let resolutions: ResolutionLogger;
let worker: AutoHealWorker;

function seedProvenFix(): void {
  // A previously resolved failure of the same shape
  const old = failures.log({
    memoryId: 'intent-old',
    errorType: 'TypeError',
    message: 'Cannot read property name of undefined',
  });
  const resolution = resolutions.log({
    failureId: old.failureId,
    fixingMemoryId: 'intent-fixer',
    approach: 'use optional chaining',
    failedApproaches: ['deep clone before access'],
    commitSha: 'abc123',
  });
  failures.resolve(old.failureId, resolution.resolutionId);
}

describe('BM-007: AutoHealWorker', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `heal-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    failures = new FailureLogger({ storagePath: testDir });
    resolutions = new ResolutionLogger({ storagePath: testDir });
    worker = new AutoHealWorker(failures, resolutions, { storagePath: testDir });
  });

  afterEach(() => {
    worker.stop();
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('trigger()', () => {
    it('generates a patch for a failure with a proven similar fix', () => {
      seedProvenFix();
      const failure = failures.log({
        memoryId: 'intent-new',
        errorType: 'TypeError',
        message: 'Cannot read property name of null',
      });

      const patches = worker.trigger();
      expect(patches.length).toBe(1);
      expect(patches[0].failureId).toBe(failure.failureId);
      expect(patches[0].sources[0].resolutionId).toBeTruthy();
      expect(patches[0].sources[0].similarity).toBeGreaterThan(0.5);
    });

    it('returns no patches when there are no proven fixes', () => {
      const failure = failures.log({
        memoryId: 'intent-new',
        errorType: 'TypeError',
        message: 'Cannot read property name of null',
      });

      const patches = worker.trigger();
      expect(patches).toEqual([]);
      expect(worker.status().unresolvedFailures).toBe(1);
      expect(failures.get(failure.failureId)?.resolved).toBe(false);
    });

    it('does not generate a patch when similarity is below threshold', () => {
      seedProvenFix();
      failures.log({
        memoryId: 'intent-unrelated',
        errorType: 'SyntaxError',
        message: 'Unexpected token in expression at position 42',
      });

      const patches = worker.trigger();
      expect(patches).toEqual([]);
    });

    it('respects the errorType filter', () => {
      seedProvenFix();
      failures.log({
        memoryId: 'intent-a',
        errorType: 'TypeError',
        message: 'Cannot read property name of null',
      });
      failures.log({
        memoryId: 'intent-b',
        errorType: 'RangeError',
        message: 'Maximum call stack size exceeded while walking',
      });

      const patches = worker.trigger({ errorType: 'RangeError' });
      expect(patches).toEqual([]);
    });

    it('does not duplicate patches for the same failure on repeated runs', () => {
      seedProvenFix();
      failures.log({
        memoryId: 'intent-new',
        errorType: 'TypeError',
        message: 'Cannot read property name of null',
      });

      worker.trigger();
      const second = worker.trigger();
      expect(second).toEqual([]);
      expect(worker.count).toBe(1);
    });

    it('respects maxPatchesPerRun', () => {
      seedProvenFix();
      failures.log({
        memoryId: 'intent-1',
        errorType: 'TypeError',
        message: 'Cannot read property name of null',
      });
      failures.log({
        memoryId: 'intent-2',
        errorType: 'TypeError',
        message: 'Cannot read property title of undefined',
      });

      const limited = new AutoHealWorker(failures, resolutions, {
        storagePath: testDir,
        maxPatchesPerRun: 1,
      });
      const patches = limited.trigger();
      expect(patches.length).toBe(1);
    });
  });

  describe('patch content', () => {
    it('produces a comment-annotated diff with failure and fix details', () => {
      seedProvenFix();
      const failure = failures.log({
        memoryId: 'intent-new',
        errorType: 'TypeError',
        message: 'Cannot read property name of null',
        context: { file: 'src/user.ts' },
      });

      const [patch] = worker.trigger();
      expect(patch.diff).toContain('# AUTO-HEAL PATCH');
      expect(patch.diff).toContain(failure.failureId);
      expect(patch.diff).toContain('TypeError');
      expect(patch.diff).toContain('use optional chaining');
      expect(patch.diff).toContain('src/user.ts');
      expect(patch.diff).toContain('deep clone before access'); // failed approaches
      expect(patch.diff).toContain('abc123'); // commit sha
      expect(patch.status).toBe('suggested');
    });
  });

  describe('applyPatch() / rejectPatch()', () => {
    it('applyPatch resolves the failure and marks the patch applied', () => {
      seedProvenFix();
      const failure = failures.log({
        memoryId: 'intent-new',
        errorType: 'TypeError',
        message: 'Cannot read property name of null',
      });

      const [patch] = worker.trigger();
      const ok = worker.applyPatch(patch.patchId);
      expect(ok).toBe(true);

      const updated = failures.get(failure.failureId)!;
      expect(updated.resolved).toBe(true);
      expect(updated.resolutionId).toBe(patch.sources[0].resolutionId);

      const stored = worker.getPatch(patch.patchId)!;
      expect(stored.status).toBe('applied');
      expect(stored.appliedAt).toBeTruthy();
    });

    it('cannot apply a patch twice', () => {
      seedProvenFix();
      failures.log({
        memoryId: 'intent-new',
        errorType: 'TypeError',
        message: 'Cannot read property name of null',
      });

      const [patch] = worker.trigger();
      expect(worker.applyPatch(patch.patchId)).toBe(true);
      expect(worker.applyPatch(patch.patchId)).toBe(false);
    });

    it('rejectPatch dismisses the suggestion', () => {
      seedProvenFix();
      failures.log({
        memoryId: 'intent-new',
        errorType: 'TypeError',
        message: 'Cannot read property name of null',
      });

      const [patch] = worker.trigger();
      expect(worker.rejectPatch(patch.patchId)).toBe(true);
      expect(worker.getPatch(patch.patchId)!.status).toBe('rejected');
      // failure stays unresolved
      expect(worker.status().unresolvedFailures).toBe(1);
    });
  });

  describe('status() / start() / stop()', () => {
    it('status() reports counters', () => {
      seedProvenFix();
      failures.log({
        memoryId: 'intent-new',
        errorType: 'TypeError',
        message: 'Cannot read property name of null',
      });

      worker.trigger();
      const status = worker.status();
      expect(status.runs).toBe(1);
      expect(status.lastRunAt).toBeTruthy();
      expect(status.patchesGenerated).toBe(1);
      expect(status.patchesApplied).toBe(0);
      expect(status.recentPatches.length).toBe(1);
      expect(status.running).toBe(false);
    });

    it('start()/stop() toggle background polling', () => {
      worker.start(10_000);
      expect(worker.status().running).toBe(true);
      worker.stop();
      expect(worker.status().running).toBe(false);
      // stop is idempotent
      worker.stop();
      expect(worker.status().running).toBe(false);
    });

    it('start() is idempotent', () => {
      worker.start(10_000);
      worker.start(5_000);
      expect(worker.status().running).toBe(true);
      worker.stop();
    });
  });
});
