/**
 * behavioral/failure-logging.spec.ts — Tests for FailureLogger (BM-003).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { FailureLogger } from './failure-logging.js';
import { RuntimeObservation } from './runtime-observation.js';

let testDir: string;

describe('BM-003: FailureLogger', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `fail-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('log()', () => {
    it('logs a failure with all fields', () => {
      const logger = new FailureLogger({ storagePath: testDir });
      const failure = logger.log({
        memoryId: 'intent-abc',
        errorType: 'TypeError',
        message: 'Cannot read property x of undefined',
        stack: 'TypeError: ...\n  at fn (...)',
        context: { input: 'test' },
      });

      expect(failure.failureId).toMatch(/^fail-/);
      expect(failure.errorType).toBe('TypeError');
      expect(failure.message).toContain('Cannot read');
      expect(failure.resolved).toBe(false);
    });

    it('includes timestamp', () => {
      const logger = new FailureLogger({ storagePath: testDir });
      const failure = logger.log({
        memoryId: 'm1', errorType: 'Error', message: 'test',
      });
      expect(new Date(failure.timestamp).getTime()).not.toBeNaN();
    });
  });

  describe('getByMemoryId()', () => {
    it('returns failures for an intent', () => {
      const logger = new FailureLogger({ storagePath: testDir });
      logger.log({ memoryId: 'm1', errorType: 'Error', message: 'a' });
      logger.log({ memoryId: 'm2', errorType: 'Error', message: 'b' });
      logger.log({ memoryId: 'm1', errorType: 'Error', message: 'c' });

      expect(logger.getByMemoryId('m1').length).toBe(2);
    });
  });

  describe('resolve()', () => {
    it('marks a failure as resolved', () => {
      const logger = new FailureLogger({ storagePath: testDir });
      const f = logger.log({ memoryId: 'm1', errorType: 'Error', message: 'test' });
      expect(logger.resolve(f.failureId, 'res-123')).toBe(true);

      const resolved = logger.get(f.failureId);
      expect(resolved?.resolved).toBe(true);
      expect(resolved?.resolutionId).toBe('res-123');
    });

    it('returns false for unknown failure', () => {
      const logger = new FailureLogger({ storagePath: testDir });
      expect(logger.resolve('unknown', 'res-123')).toBe(false);
    });
  });

  describe('getUnresolved() and getResolved()', () => {
    it('separates resolved and unresolved', () => {
      const logger = new FailureLogger({ storagePath: testDir });
      const f1 = logger.log({ memoryId: 'm1', errorType: 'Error', message: 'a' });
      const f2 = logger.log({ memoryId: 'm1', errorType: 'Error', message: 'b' });
      logger.resolve(f1.failureId, 'res-1');

      expect(logger.getUnresolved().length).toBe(1);
      expect(logger.getResolved().length).toBe(1);
    });
  });

  describe('search()', () => {
    it('searches in message', () => {
      const logger = new FailureLogger({ storagePath: testDir });
      logger.log({ memoryId: 'm1', errorType: 'TypeError', message: 'null reference' });
      logger.log({ memoryId: 'm2', errorType: 'RangeError', message: 'out of bounds' });

      expect(logger.search('null').length).toBe(1);
    });

    it('searches in error type', () => {
      const logger = new FailureLogger({ storagePath: testDir });
      logger.log({ memoryId: 'm1', errorType: 'TypeError', message: 'a' });
      logger.log({ memoryId: 'm2', errorType: 'RangeError', message: 'b' });

      expect(logger.search('TypeError').length).toBe(1);
    });
  });

  describe('getStats()', () => {
    it('returns correct statistics', () => {
      const logger = new FailureLogger({ storagePath: testDir });
      logger.log({ memoryId: 'm1', errorType: 'TypeError', message: 'a' });
      logger.log({ memoryId: 'm2', errorType: 'TypeError', message: 'b' });
      logger.log({ memoryId: 'm3', errorType: 'RangeError', message: 'c' });

      const stats = logger.getStats();
      expect(stats.total).toBe(3);
      expect(stats.unresolved).toBe(3);
      expect(stats.byErrorType['TypeError']).toBe(2);
      expect(stats.byErrorType['RangeError']).toBe(1);
    });
  });

  describe('validation with observations', () => {
    it('logs warning when no snapshots exist for intent', () => {
      const logger = new FailureLogger({ storagePath: testDir });
      const obs = new RuntimeObservation({ storagePath: testDir });
      // No snapshots recorded for 'intent-xyz'
      const failure = logger.log({
        memoryId: 'intent-xyz',
        errorType: 'Error',
        message: 'test',
      }, obs);
      // Should still log the failure (just with a warning)
      expect(failure.failureId).toBeDefined();
    });
  });

  describe('persistence', () => {
    it('persists across instances', () => {
      const logger1 = new FailureLogger({ storagePath: testDir });
      logger1.log({ memoryId: 'm1', errorType: 'Error', message: 'test' });

      const logger2 = new FailureLogger({ storagePath: testDir });
      expect(logger2.count).toBe(1);
    });
  });

  describe('delete() and clear()', () => {
    it('deletes a failure', () => {
      const logger = new FailureLogger({ storagePath: testDir });
      const f = logger.log({ memoryId: 'm1', errorType: 'Error', message: 'test' });
      expect(logger.delete(f.failureId)).toBe(true);
      expect(logger.count).toBe(0);
    });

    it('clears all failures', () => {
      const logger = new FailureLogger({ storagePath: testDir });
      logger.log({ memoryId: 'm1', errorType: 'Error', message: 'a' });
      logger.clear();
      expect(logger.count).toBe(0);
    });
  });
});
