/**
 * behavioral/intent-capture.spec.ts — Tests for IntentCapture (BM-001).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { IntentCapture } from './intent-capture.js';

let testDir: string;

describe('BM-001: IntentCapture', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `intent-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('record()', () => {
    it('records a new intent and returns memory ID', () => {
      const cap = new IntentCapture({ storagePath: testDir });
      const result = cap.record({
        prompt: 'Add rate limiting',
        file: 'src/auth.ts',
        contentHash: 'sha256:abc123',
      });

      expect(result.memoryId).toMatch(/^intent-/);
      expect(result.duplicate).toBe(false);
      expect(result.record.prompt).toBe('Add rate limiting');
      expect(result.record.file).toBe('src/auth.ts');
    });

    it('is idempotent — same input returns duplicate', () => {
      const cap = new IntentCapture({ storagePath: testDir });
      const input = {
        prompt: 'Add rate limiting',
        file: 'src/auth.ts',
        contentHash: 'sha256:abc123',
      };

      const r1 = cap.record(input);
      const r2 = cap.record(input);

      expect(r1.duplicate).toBe(false);
      expect(r2.duplicate).toBe(true);
      expect(r1.memoryId).toBe(r2.memoryId);
    });

    it('different prompts produce different memory IDs', () => {
      const cap = new IntentCapture({ storagePath: testDir });
      const r1 = cap.record({ prompt: 'Add rate limiting', file: 'src/auth.ts', contentHash: 'sha256:abc' });
      const r2 = cap.record({ prompt: 'Add TLS support', file: 'src/auth.ts', contentHash: 'sha256:abc' });

      expect(r1.memoryId).not.toBe(r2.memoryId);
    });

    it('different files produce different memory IDs', () => {
      const cap = new IntentCapture({ storagePath: testDir });
      const r1 = cap.record({ prompt: 'Add rate limiting', file: 'src/auth.ts', contentHash: 'sha256:abc' });
      const r2 = cap.record({ prompt: 'Add rate limiting', file: 'src/api.ts', contentHash: 'sha256:abc' });

      expect(r1.memoryId).not.toBe(r2.memoryId);
    });

    it('different content hashes produce different memory IDs', () => {
      const cap = new IntentCapture({ storagePath: testDir });
      const r1 = cap.record({ prompt: 'Add rate limiting', file: 'src/auth.ts', contentHash: 'sha256:abc' });
      const r2 = cap.record({ prompt: 'Add rate limiting', file: 'src/auth.ts', contentHash: 'sha256:def' });

      expect(r1.memoryId).not.toBe(r2.memoryId);
    });

    it('stores context and tags', () => {
      const cap = new IntentCapture({ storagePath: testDir });
      const result = cap.record({
        prompt: 'Add rate limiting',
        file: 'src/auth.ts',
        contentHash: 'sha256:abc',
        context: { task: 'SEC-005', session: 's-123' },
        tags: ['security', 'auth'],
      });

      expect(result.record.context).toEqual({ task: 'SEC-005', session: 's-123' });
      expect(result.record.tags).toEqual(['security', 'auth']);
    });

    it('includes timestamp', () => {
      const cap = new IntentCapture({ storagePath: testDir });
      const result = cap.record({
        prompt: 'Test',
        file: 'test.ts',
        contentHash: 'sha256:abc',
      });

      expect(result.record.timestamp).toBeDefined();
      expect(new Date(result.record.timestamp).getTime()).not.toBeNaN();
    });
  });

  describe('persistence', () => {
    it('persists across instances', () => {
      const cap1 = new IntentCapture({ storagePath: testDir });
      cap1.record({ prompt: 'Test', file: 'test.ts', contentHash: 'sha256:abc' });

      const cap2 = new IntentCapture({ storagePath: testDir });
      expect(cap2.count).toBe(1);
    });
  });

  describe('get()', () => {
    it('retrieves an intent by memory ID', () => {
      const cap = new IntentCapture({ storagePath: testDir });
      const result = cap.record({ prompt: 'Test', file: 'test.ts', contentHash: 'sha256:abc' });
      const found = cap.get(result.memoryId);
      expect(found?.prompt).toBe('Test');
    });

    it('returns undefined for unknown ID', () => {
      const cap = new IntentCapture({ storagePath: testDir });
      expect(cap.get('intent-unknown')).toBeUndefined();
    });
  });

  describe('list()', () => {
    it('lists all intents sorted by timestamp', () => {
      const cap = new IntentCapture({ storagePath: testDir });
      cap.record({ prompt: 'A', file: 'a.ts', contentHash: 'h1' });
      cap.record({ prompt: 'B', file: 'b.ts', contentHash: 'h2' });
      cap.record({ prompt: 'C', file: 'c.ts', contentHash: 'h3' });

      const list = cap.list();
      expect(list.length).toBe(3);
      // Sorted by timestamp (all close, but order should be A, B, C)
      expect(list[0].prompt).toBe('A');
    });

    it('filters by file', () => {
      const cap = new IntentCapture({ storagePath: testDir });
      cap.record({ prompt: 'A', file: 'a.ts', contentHash: 'h1' });
      cap.record({ prompt: 'B', file: 'b.ts', contentHash: 'h2' });
      cap.record({ prompt: 'C', file: 'a.ts', contentHash: 'h3' });

      const list = cap.list({ file: 'a.ts' });
      expect(list.length).toBe(2);
      expect(list.every((r) => r.file === 'a.ts')).toBe(true);
    });

    it('filters by tag', () => {
      const cap = new IntentCapture({ storagePath: testDir });
      cap.record({ prompt: 'A', file: 'a.ts', contentHash: 'h1', tags: ['security'] });
      cap.record({ prompt: 'B', file: 'b.ts', contentHash: 'h2', tags: ['performance'] });
      cap.record({ prompt: 'C', file: 'c.ts', contentHash: 'h3', tags: ['security'] });

      const list = cap.list({ tag: 'security' });
      expect(list.length).toBe(2);
    });
  });

  describe('search()', () => {
    it('searches in prompt text', () => {
      const cap = new IntentCapture({ storagePath: testDir });
      cap.record({ prompt: 'Add rate limiting to auth', file: 'a.ts', contentHash: 'h1' });
      cap.record({ prompt: 'Fix TLS certificate', file: 'b.ts', contentHash: 'h2' });

      expect(cap.search('rate').length).toBe(1);
      expect(cap.search('TLS').length).toBe(1);
    });

    it('search is case-insensitive', () => {
      const cap = new IntentCapture({ storagePath: testDir });
      cap.record({ prompt: 'Add RATE LIMITING', file: 'a.ts', contentHash: 'h1' });
      expect(cap.search('rate').length).toBe(1);
    });
  });

  describe('getByFile() and getByTag()', () => {
    it('getByFile returns intents for a file', () => {
      const cap = new IntentCapture({ storagePath: testDir });
      cap.record({ prompt: 'A', file: 'auth.ts', contentHash: 'h1' });
      cap.record({ prompt: 'B', file: 'other.ts', contentHash: 'h2' });

      expect(cap.getByFile('auth.ts').length).toBe(1);
    });

    it('getByTag returns intents with a tag', () => {
      const cap = new IntentCapture({ storagePath: testDir });
      cap.record({ prompt: 'A', file: 'a.ts', contentHash: 'h1', tags: ['bugfix'] });
      cap.record({ prompt: 'B', file: 'b.ts', contentHash: 'h2', tags: ['feature'] });

      expect(cap.getByTag('bugfix').length).toBe(1);
    });
  });

  describe('delete()', () => {
    it('deletes an intent', () => {
      const cap = new IntentCapture({ storagePath: testDir });
      const r = cap.record({ prompt: 'Test', file: 'test.ts', contentHash: 'h1' });
      expect(cap.delete(r.memoryId)).toBe(true);
      expect(cap.get(r.memoryId)).toBeUndefined();
    });

    it('returns false for unknown ID', () => {
      const cap = new IntentCapture({ storagePath: testDir });
      expect(cap.delete('unknown')).toBe(false);
    });
  });

  describe('count and clear()', () => {
    it('count returns number of intents', () => {
      const cap = new IntentCapture({ storagePath: testDir });
      cap.record({ prompt: 'A', file: 'a.ts', contentHash: 'h1' });
      cap.record({ prompt: 'B', file: 'b.ts', contentHash: 'h2' });
      expect(cap.count).toBe(2);
    });

    it('clear removes all intents', () => {
      const cap = new IntentCapture({ storagePath: testDir });
      cap.record({ prompt: 'A', file: 'a.ts', contentHash: 'h1' });
      cap.clear();
      expect(cap.count).toBe(0);
    });
  });

  describe('computeContentHash()', () => {
    it('computes SHA-256 hash of content', () => {
      const hash = IntentCapture.computeContentHash('hello world');
      expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it('produces different hashes for different content', () => {
      const h1 = IntentCapture.computeContentHash('hello');
      const h2 = IntentCapture.computeContentHash('world');
      expect(h1).not.toBe(h2);
    });

    it('produces same hash for same content', () => {
      const h1 = IntentCapture.computeContentHash('hello');
      const h2 = IntentCapture.computeContentHash('hello');
      expect(h1).toBe(h2);
    });
  });
});
