/**
 * behavioral/runtime-observation.spec.ts — Tests for RuntimeObservation (BM-002).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { RuntimeObservation } from './runtime-observation.js';

let testDir: string;

describe('BM-002: RuntimeObservation', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `obs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('record()', () => {
    it('records a successful execution', () => {
      const obs = new RuntimeObservation({ storagePath: testDir });
      const snap = obs.record({
        memoryId: 'intent-abc',
        functionName: 'authenticate',
        args: { user: 'alice' },
        returnValue: { success: true },
        durationMs: 42,
        success: true,
      });

      expect(snap.snapshotId).toMatch(/^snap-/);
      expect(snap.success).toBe(true);
      expect(snap.durationMs).toBe(42);
      expect(snap.returnValue).toEqual({ success: true });
    });

    it('records a failed execution', () => {
      const obs = new RuntimeObservation({ storagePath: testDir });
      const snap = obs.record({
        memoryId: 'intent-abc',
        functionName: 'authenticate',
        args: { user: 'alice' },
        durationMs: 10,
        success: false,
        error: 'Invalid credentials',
        stackTrace: 'Error: Invalid credentials\n  at authenticate (...)',
      });

      expect(snap.success).toBe(false);
      expect(snap.error).toBe('Invalid credentials');
      expect(snap.stackTrace).toContain('authenticate');
    });

    it('includes timestamp', () => {
      const obs = new RuntimeObservation({ storagePath: testDir });
      const snap = obs.record({
        memoryId: 'intent-abc', functionName: 'test', args: {}, durationMs: 1, success: true,
      });
      expect(new Date(snap.timestamp).getTime()).not.toBeNaN();
    });
  });

  describe('getByMemoryId()', () => {
    it('returns snapshots linked to an intent', () => {
      const obs = new RuntimeObservation({ storagePath: testDir });
      obs.record({ memoryId: 'intent-a', functionName: 'fn1', args: {}, durationMs: 1, success: true });
      obs.record({ memoryId: 'intent-b', functionName: 'fn2', args: {}, durationMs: 1, success: true });
      obs.record({ memoryId: 'intent-a', functionName: 'fn3', args: {}, durationMs: 1, success: true });

      expect(obs.getByMemoryId('intent-a').length).toBe(2);
    });
  });

  describe('getByFunction()', () => {
    it('returns snapshots for a function', () => {
      const obs = new RuntimeObservation({ storagePath: testDir });
      obs.record({ memoryId: 'm1', functionName: 'auth', args: {}, durationMs: 1, success: true });
      obs.record({ memoryId: 'm2', functionName: 'cache', args: {}, durationMs: 1, success: true });
      obs.record({ memoryId: 'm3', functionName: 'auth', args: {}, durationMs: 1, success: false });

      expect(obs.getByFunction('auth').length).toBe(2);
    });
  });

  describe('getFailures()', () => {
    it('returns only failed snapshots', () => {
      const obs = new RuntimeObservation({ storagePath: testDir });
      obs.record({ memoryId: 'm1', functionName: 'fn', args: {}, durationMs: 1, success: true });
      obs.record({ memoryId: 'm2', functionName: 'fn', args: {}, durationMs: 1, success: false });

      expect(obs.getFailures().length).toBe(1);
    });

    it('getFailuresByMemoryId filters by intent', () => {
      const obs = new RuntimeObservation({ storagePath: testDir });
      obs.record({ memoryId: 'm1', functionName: 'fn', args: {}, durationMs: 1, success: false });
      obs.record({ memoryId: 'm2', functionName: 'fn', args: {}, durationMs: 1, success: false });

      expect(obs.getFailuresByMemoryId('m1').length).toBe(1);
    });
  });

  describe('getStats()', () => {
    it('returns correct statistics', () => {
      const obs = new RuntimeObservation({ storagePath: testDir });
      obs.record({ memoryId: 'm1', functionName: 'auth', args: {}, durationMs: 10, success: true });
      obs.record({ memoryId: 'm2', functionName: 'auth', args: {}, durationMs: 30, success: false });
      obs.record({ memoryId: 'm3', functionName: 'cache', args: {}, durationMs: 5, success: true });

      const stats = obs.getStats();
      expect(stats.total).toBe(3);
      expect(stats.successCount).toBe(2);
      expect(stats.failureCount).toBe(1);
      expect(stats.avgDurationMs).toBeCloseTo(15, 0);
      expect(stats.byFunction['auth'].count).toBe(2);
      expect(stats.byFunction['auth'].successRate).toBeCloseTo(0.5);
      expect(stats.byFunction['cache'].count).toBe(1);
    });
  });

  describe('persistence', () => {
    it('persists across instances', () => {
      const obs1 = new RuntimeObservation({ storagePath: testDir });
      obs1.record({ memoryId: 'm1', functionName: 'fn', args: {}, durationMs: 1, success: true });

      const obs2 = new RuntimeObservation({ storagePath: testDir });
      expect(obs2.count).toBe(1);
    });
  });

  describe('delete() and clear()', () => {
    it('deletes a snapshot', () => {
      const obs = new RuntimeObservation({ storagePath: testDir });
      const snap = obs.record({ memoryId: 'm1', functionName: 'fn', args: {}, durationMs: 1, success: true });
      expect(obs.delete(snap.snapshotId)).toBe(true);
      expect(obs.count).toBe(0);
    });

    it('clears all snapshots', () => {
      const obs = new RuntimeObservation({ storagePath: testDir });
      obs.record({ memoryId: 'm1', functionName: 'fn', args: {}, durationMs: 1, success: true });
      obs.clear();
      expect(obs.count).toBe(0);
    });
  });

  describe('maxSnapshots limit', () => {
    it('trims old snapshots', () => {
      const obs = new RuntimeObservation({ storagePath: testDir, maxSnapshots: 3 });
      for (let i = 0; i < 5; i++) {
        obs.record({ memoryId: `m${i}`, functionName: 'fn', args: {}, durationMs: 1, success: true });
      }
      expect(obs.count).toBe(3);
    });
  });
});
