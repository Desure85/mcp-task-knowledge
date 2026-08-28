/**
 * behavioral/resolution-logging.spec.ts — Tests for ResolutionLogger (BM-004).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ResolutionLogger } from './resolution-logging.js';

let testDir: string;

describe('BM-004: ResolutionLogger', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `res-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('log()', () => {
    it('logs a resolution with all fields', () => {
      const logger = new ResolutionLogger({ storagePath: testDir });
      const res = logger.log({
        failureId: 'fail-abc',
        fixingMemoryId: 'intent-def',
        approach: 'Added null check before property access',
        failedApproaches: ['Tried optional chaining alone'],
        commitSha: 'abc1234',
        prUrl: 'https://github.com/repo/pull/1',
      });

      expect(res.resolutionId).toMatch(/^res-/);
      expect(res.approach).toContain('null check');
      expect(res.commitSha).toBe('abc1234');
      expect(res.failedApproaches?.length).toBe(1);
    });

    it('includes timestamp', () => {
      const logger = new ResolutionLogger({ storagePath: testDir });
      const res = logger.log({
        failureId: 'f1', fixingMemoryId: 'i1', approach: 'test',
      });
      expect(new Date(res.timestamp).getTime()).not.toBeNaN();
    });
  });

  describe('getByFailureId()', () => {
    it('returns resolution for a failure', () => {
      const logger = new ResolutionLogger({ storagePath: testDir });
      logger.log({ failureId: 'f1', fixingMemoryId: 'i1', approach: 'a' });
      logger.log({ failureId: 'f2', fixingMemoryId: 'i2', approach: 'b' });

      const res = logger.getByFailureId('f1');
      expect(res?.approach).toBe('a');
    });

    it('returns undefined for unknown failure', () => {
      const logger = new ResolutionLogger({ storagePath: testDir });
      expect(logger.getByFailureId('unknown')).toBeUndefined();
    });
  });

  describe('getByFixingMemoryId()', () => {
    it('returns resolutions by fixing intent', () => {
      const logger = new ResolutionLogger({ storagePath: testDir });
      logger.log({ failureId: 'f1', fixingMemoryId: 'i1', approach: 'a' });
      logger.log({ failureId: 'f2', fixingMemoryId: 'i1', approach: 'b' });
      logger.log({ failureId: 'f3', fixingMemoryId: 'i2', approach: 'c' });

      expect(logger.getByFixingMemoryId('i1').length).toBe(2);
    });
  });

  describe('search()', () => {
    it('searches in approach', () => {
      const logger = new ResolutionLogger({ storagePath: testDir });
      logger.log({ failureId: 'f1', fixingMemoryId: 'i1', approach: 'Added null check' });
      logger.log({ failureId: 'f2', fixingMemoryId: 'i2', approach: 'Used try/catch' });

      expect(logger.search('null').length).toBe(1);
    });

    it('searches in failed approaches', () => {
      const logger = new ResolutionLogger({ storagePath: testDir });
      logger.log({
        failureId: 'f1', fixingMemoryId: 'i1', approach: 'Fixed',
        failedApproaches: ['Tried restarting server'],
      });

      expect(logger.search('restarting').length).toBe(1);
    });
  });

  describe('getWithCommit() and getWithPR()', () => {
    it('returns resolutions with commit SHA', () => {
      const logger = new ResolutionLogger({ storagePath: testDir });
      logger.log({ failureId: 'f1', fixingMemoryId: 'i1', approach: 'a', commitSha: 'abc' });
      logger.log({ failureId: 'f2', fixingMemoryId: 'i2', approach: 'b' });

      expect(logger.getWithCommit().length).toBe(1);
    });

    it('returns resolutions with PR URL', () => {
      const logger = new ResolutionLogger({ storagePath: testDir });
      logger.log({ failureId: 'f1', fixingMemoryId: 'i1', approach: 'a', prUrl: 'https://...' });
      logger.log({ failureId: 'f2', fixingMemoryId: 'i2', approach: 'b' });

      expect(logger.getWithPR().length).toBe(1);
    });
  });

  describe('persistence', () => {
    it('persists across instances', () => {
      const logger1 = new ResolutionLogger({ storagePath: testDir });
      logger1.log({ failureId: 'f1', fixingMemoryId: 'i1', approach: 'test' });

      const logger2 = new ResolutionLogger({ storagePath: testDir });
      expect(logger2.count).toBe(1);
    });
  });

  describe('delete() and clear()', () => {
    it('deletes a resolution', () => {
      const logger = new ResolutionLogger({ storagePath: testDir });
      const res = logger.log({ failureId: 'f1', fixingMemoryId: 'i1', approach: 'test' });
      expect(logger.delete(res.resolutionId)).toBe(true);
      expect(logger.count).toBe(0);
    });

    it('clears all resolutions', () => {
      const logger = new ResolutionLogger({ storagePath: testDir });
      logger.log({ failureId: 'f1', fixingMemoryId: 'i1', approach: 'a' });
      logger.clear();
      expect(logger.count).toBe(0);
    });
  });
});
