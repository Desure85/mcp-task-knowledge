/**
 * behavioral/repair-brief.spec.ts — Tests for RepairBrief (BM-005).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { IntentCapture } from './intent-capture.js';
import { RuntimeObservation } from './runtime-observation.js';
import { FailureLogger } from './failure-logging.js';
import { ResolutionLogger } from './resolution-logging.js';
import { RepairBrief } from './repair-brief.js';

let testDir: string;

describe('BM-005: RepairBrief', () => {
  let intents: IntentCapture;
  let observations: RuntimeObservation;
  let failures: FailureLogger;
  let resolutions: ResolutionLogger;
  let brief: RepairBrief;

  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `rb-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    intents = new IntentCapture({ storagePath: testDir });
    observations = new RuntimeObservation({ storagePath: testDir });
    failures = new FailureLogger({ storagePath: testDir });
    resolutions = new ResolutionLogger({ storagePath: testDir });
    brief = new RepairBrief(intents, observations, failures, resolutions);
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('assemble()', () => {
    it('returns null for unknown intent', () => {
      const result = brief.assemble('intent-unknown');
      expect(result).toBeNull();
    });

    it('assembles brief for an intent with no failures', () => {
      const intent = intents.record({
        prompt: 'Add feature X',
        file: 'src/feature.ts',
        contentHash: 'sha256:abc',
      });

      const result = brief.assemble(intent.memoryId);
      expect(result).not.toBeNull();
      expect(result!.intent.memoryId).toBe(intent.memoryId);
      expect(result!.failures).toEqual([]);
      expect(result!.runtimeTraces).toEqual([]);
    });

    it('includes runtime traces', () => {
      const intent = intents.record({
        prompt: 'Add auth',
        file: 'src/auth.ts',
        contentHash: 'sha256:abc',
      });
      observations.record({
        memoryId: intent.memoryId,
        functionName: 'authenticate',
        args: { user: 'alice' },
        durationMs: 42,
        success: true,
      });

      const result = brief.assemble(intent.memoryId);
      expect(result!.runtimeTraces.length).toBe(1);
      expect(result!.runtimeTraces[0].functionName).toBe('authenticate');
    });

    it('includes failures', () => {
      const intent = intents.record({
        prompt: 'Add auth',
        file: 'src/auth.ts',
        contentHash: 'sha256:abc',
      });
      failures.log({
        memoryId: intent.memoryId,
        errorType: 'TypeError',
        message: 'Cannot read x of undefined',
      });

      const result = brief.assemble(intent.memoryId);
      expect(result!.failures.length).toBe(1);
      expect(result!.failures[0].errorType).toBe('TypeError');
    });

    it('includes resolutions for failures', () => {
      const intent = intents.record({
        prompt: 'Add auth',
        file: 'src/auth.ts',
        contentHash: 'sha256:abc',
      });
      const failure = failures.log({
        memoryId: intent.memoryId,
        errorType: 'TypeError',
        message: 'Cannot read x of undefined',
      });
      const resolution = resolutions.log({
        failureId: failure.failureId,
        fixingMemoryId: intent.memoryId,
        approach: 'Added null check',
      });
      failures.resolve(failure.failureId, resolution.resolutionId);

      const result = brief.assemble(intent.memoryId);
      expect(result!.resolutions.length).toBe(1);
      expect(result!.resolutions[0].approach).toBe('Added null check');
    });

    it('finds similar past fixes', () => {
      // First intent: had a failure that was resolved
      const intent1 = intents.record({
        prompt: 'Add auth',
        file: 'src/auth.ts',
        contentHash: 'sha256:abc',
      });
      const failure1 = failures.log({
        memoryId: intent1.memoryId,
        errorType: 'TypeError',
        message: 'Cannot read property x of undefined',
      });
      resolutions.log({
        failureId: failure1.failureId,
        fixingMemoryId: intent1.memoryId,
        approach: 'Added null check before access',
      });

      // Second intent: has a similar failure (same error type, similar message)
      const intent2 = intents.record({
        prompt: 'Add cache',
        file: 'src/cache.ts',
        contentHash: 'sha256:def',
      });
      failures.log({
        memoryId: intent2.memoryId,
        errorType: 'TypeError',
        message: 'Cannot read property y of undefined',
      });

      const result = brief.assemble(intent2.memoryId);
      expect(result!.similarFixes.length).toBeGreaterThan(0);
      expect(result!.similarFixes[0].resolution.approach).toContain('null check');
    });

    it('does not include self in similar fixes', () => {
      const intent = intents.record({
        prompt: 'Add auth',
        file: 'src/auth.ts',
        contentHash: 'sha256:abc',
      });
      const failure = failures.log({
        memoryId: intent.memoryId,
        errorType: 'TypeError',
        message: 'Cannot read x of undefined',
      });
      const resolution = resolutions.log({
        failureId: failure.failureId,
        fixingMemoryId: intent.memoryId,
        approach: 'Added null check',
      });
      failures.resolve(failure.failureId, resolution.resolutionId);

      const result = brief.assemble(intent.memoryId);
      // The current failure's own resolution should not appear in similarFixes
      expect(result!.similarFixes.length).toBe(0);
    });

    it('generates formatted brief text', () => {
      const intent = intents.record({
        prompt: 'Add auth',
        file: 'src/auth.ts',
        contentHash: 'sha256:abc',
      });
      failures.log({
        memoryId: intent.memoryId,
        errorType: 'TypeError',
        message: 'Cannot read x of undefined',
      });

      const result = brief.assemble(intent.memoryId);
      expect(result!.brief).toContain('Repair Brief');
      expect(result!.brief).toContain('src/auth.ts');
      expect(result!.brief).toContain('Add auth');
      expect(result!.brief).toContain('TypeError');
    });
  });

  describe('assembleForLatestFailure()', () => {
    it('returns null when no failures exist', () => {
      expect(brief.assembleForLatestFailure()).toBeNull();
    });

    it('assembles brief for the most recent failure', () => {
      const intent = intents.record({
        prompt: 'Add auth',
        file: 'src/auth.ts',
        contentHash: 'sha256:abc',
      });
      failures.log({
        memoryId: intent.memoryId,
        errorType: 'Error',
        message: 'Something went wrong',
      });

      const result = brief.assembleForLatestFailure();
      expect(result).not.toBeNull();
      expect(result!.intent.memoryId).toBe(intent.memoryId);
    });
  });

  describe('assembleForUnresolved()', () => {
    it('returns empty array when no unresolved failures', () => {
      expect(brief.assembleForUnresolved()).toEqual([]);
    });

    it('returns briefs for all unresolved failures', () => {
      const intent1 = intents.record({ prompt: 'A', file: 'a.ts', contentHash: 'h1' });
      const intent2 = intents.record({ prompt: 'B', file: 'b.ts', contentHash: 'h2' });
      failures.log({ memoryId: intent1.memoryId, errorType: 'Error', message: 'a' });
      failures.log({ memoryId: intent2.memoryId, errorType: 'Error', message: 'b' });

      const results = brief.assembleForUnresolved();
      expect(results.length).toBe(2);
    });

    it('deduplicates by memory ID', () => {
      const intent = intents.record({ prompt: 'A', file: 'a.ts', contentHash: 'h1' });
      failures.log({ memoryId: intent.memoryId, errorType: 'Error', message: 'a' });
      failures.log({ memoryId: intent.memoryId, errorType: 'Error', message: 'b' });

      const results = brief.assembleForUnresolved();
      expect(results.length).toBe(1);
    });
  });

  describe('similarity scoring', () => {
    it('high similarity for same error type and similar message', () => {
      const intent1 = intents.record({ prompt: 'A', file: 'a.ts', contentHash: 'h1' });
      const f1 = failures.log({ memoryId: intent1.memoryId, errorType: 'TypeError', message: 'Cannot read property x of undefined' });
      resolutions.log({ failureId: f1.failureId, fixingMemoryId: intent1.memoryId, approach: 'Fix 1' });

      const intent2 = intents.record({ prompt: 'B', file: 'b.ts', contentHash: 'h2' });
      failures.log({ memoryId: intent2.memoryId, errorType: 'TypeError', message: 'Cannot read property y of undefined' });

      const result = brief.assemble(intent2.memoryId);
      expect(result!.similarFixes[0].similarity).toBeGreaterThan(0.5);
    });

    it('low similarity for different error types', () => {
      const intent1 = intents.record({ prompt: 'A', file: 'a.ts', contentHash: 'h1' });
      const f1 = failures.log({ memoryId: intent1.memoryId, errorType: 'TypeError', message: 'null reference' });
      resolutions.log({ failureId: f1.failureId, fixingMemoryId: intent1.memoryId, approach: 'Fix 1' });

      const intent2 = intents.record({ prompt: 'B', file: 'b.ts', contentHash: 'h2' });
      failures.log({ memoryId: intent2.memoryId, errorType: 'RangeError', message: 'out of bounds' });

      const result = brief.assemble(intent2.memoryId);
      // Different error type, no word overlap → low similarity
      if (result!.similarFixes.length > 0) {
        expect(result!.similarFixes[0].similarity).toBeLessThan(0.5);
      }
    });
  });
});
