/**
 * behavioral/code-lineage.spec.ts — Tests for CodeLineage (BM-006).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { IntentCapture } from './intent-capture.js';
import { CodeLineage } from './code-lineage.js';

let testDir: string;

describe('BM-006: CodeLineage', () => {
  let intents: IntentCapture;
  let lineage: CodeLineage;

  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `cl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    intents = new IntentCapture({ storagePath: testDir });
    lineage = new CodeLineage(intents);
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('trace()', () => {
    it('returns null for unknown intent', () => {
      expect(lineage.trace('intent-unknown')).toBeNull();
    });

    it('traces a root intent with no history', () => {
      const a = intents.record({ prompt: 'Create module', file: 'src/a.ts', contentHash: 'sha256:1' });

      const result = lineage.trace(a.memoryId);
      expect(result).not.toBeNull();
      expect(result!.parent).toBeNull();
      expect(result!.ancestors).toEqual([]);
      expect(result!.root.memoryId).toBe(a.memoryId);
      expect(result!.generation).toBe(0);
      expect(result!.descendants).toEqual([]);
    });

    it('traces parent → child → grandchild chain for one file', () => {
      const a = intents.record({ prompt: 'v1', file: 'src/a.ts', contentHash: 'sha256:1' });
      const b = intents.record({ prompt: 'v2', file: 'src/a.ts', contentHash: 'sha256:2' });
      const c = intents.record({ prompt: 'v3', file: 'src/a.ts', contentHash: 'sha256:3' });

      const result = lineage.trace(c.memoryId)!;
      expect(result.generation).toBe(2);
      expect(result.parent!.memoryId).toBe(b.memoryId);
      expect(result.ancestors.map((r) => r.memoryId)).toEqual([a.memoryId, b.memoryId]);
      expect(result.root.memoryId).toBe(a.memoryId);
    });

    it('includes the descendant subtree', () => {
      const a = intents.record({ prompt: 'v1', file: 'src/a.ts', contentHash: 'sha256:1' });
      const b = intents.record({ prompt: 'v2', file: 'src/a.ts', contentHash: 'sha256:2' });
      const c = intents.record({ prompt: 'v3', file: 'src/a.ts', contentHash: 'sha256:3' });

      const result = lineage.trace(a.memoryId)!;
      expect(result.descendants).toHaveLength(1);
      expect(result.descendants[0].intent.memoryId).toBe(b.memoryId);
      expect(result.descendants[0].generation).toBe(1);
      expect(result.descendants[0].children[0].intent.memoryId).toBe(c.memoryId);
      expect(result.descendants[0].children[0].generation).toBe(2);
    });

    it('formats a markdown lineage', () => {
      intents.record({ prompt: 'v1', file: 'src/a.ts', contentHash: 'sha256:1' });
      const b = intents.record({ prompt: 'v2 refactor', file: 'src/a.ts', contentHash: 'sha256:2' });

      const result = lineage.trace(b.memoryId)!;
      expect(result.lineage).toContain('# Code Lineage');
      expect(result.lineage).toContain('src/a.ts');
      expect(result.lineage).toContain('## Ancestors');
      expect(result.lineage).toContain('v2 refactor');
    });
  });

  describe('getParent()', () => {
    it('returns null for unknown intent', () => {
      expect(lineage.getParent('intent-unknown')).toBeNull();
    });

    it('prefers explicit parentMemoryId over file order', () => {
      const a = intents.record({ prompt: 'v1', file: 'src/a.ts', contentHash: 'sha256:1' });
      intents.record({ prompt: 'v2', file: 'src/a.ts', contentHash: 'sha256:2' });
      const c = intents.record({
        prompt: 'v3',
        file: 'src/a.ts',
        contentHash: 'sha256:3',
        context: { parentMemoryId: a.memoryId },
      });

      expect(lineage.getParent(c.memoryId)!.memoryId).toBe(a.memoryId);
    });

    it('links across files via explicit parentMemoryId', () => {
      const a = intents.record({ prompt: 'extract helper', file: 'src/a.ts', contentHash: 'sha256:1' });
      const b = intents.record({
        prompt: 'move helper',
        file: 'src/b.ts',
        contentHash: 'sha256:2',
        context: { parentMemoryId: a.memoryId },
      });

      expect(lineage.getParent(b.memoryId)!.memoryId).toBe(a.memoryId);
      expect(lineage.getChildren(a.memoryId).map((r) => r.memoryId)).toEqual([b.memoryId]);
    });

    it('links via previousHash when no explicit parent is set', () => {
      const a = intents.record({ prompt: 'v1', file: 'src/a.ts', contentHash: 'sha256:1' });
      intents.record({ prompt: 'v2', file: 'src/a.ts', contentHash: 'sha256:2' });
      const c = intents.record({
        prompt: 'revert to v1 shape',
        file: 'src/a.ts',
        contentHash: 'sha256:3',
        context: { previousHash: 'sha256:1' },
      });

      expect(lineage.getParent(c.memoryId)!.memoryId).toBe(a.memoryId);
    });

    it('ignores an explicit parent that does not exist', () => {
      const a = intents.record({ prompt: 'v1', file: 'src/a.ts', contentHash: 'sha256:1' });
      const b = intents.record({
        prompt: 'v2',
        file: 'src/a.ts',
        contentHash: 'sha256:2',
        context: { parentMemoryId: 'intent-missing' },
      });

      expect(lineage.getParent(b.memoryId)!.memoryId).toBe(a.memoryId);
    });

    it('does not link intents from unrelated files implicitly', () => {
      intents.record({ prompt: 'v1', file: 'src/a.ts', contentHash: 'sha256:1' });
      const other = intents.record({ prompt: 'v1', file: 'src/b.ts', contentHash: 'sha256:9' });

      expect(lineage.getParent(other.memoryId)).toBeNull();
    });
  });

  describe('getChildren()', () => {
    it('returns [] for unknown intent', () => {
      expect(lineage.getChildren('intent-unknown')).toEqual([]);
    });

    it('returns direct children only', () => {
      const a = intents.record({ prompt: 'v1', file: 'src/a.ts', contentHash: 'sha256:1' });
      const b = intents.record({ prompt: 'v2', file: 'src/a.ts', contentHash: 'sha256:2' });
      intents.record({ prompt: 'v3', file: 'src/a.ts', contentHash: 'sha256:3' });

      expect(lineage.getChildren(a.memoryId).map((r) => r.memoryId)).toEqual([b.memoryId]);
    });

    it('returns multiple children when several intents share a parent', () => {
      const a = intents.record({ prompt: 'v1', file: 'src/a.ts', contentHash: 'sha256:1' });
      const b = intents.record({
        prompt: 'branch 1', file: 'src/b.ts', contentHash: 'sha256:2',
        context: { parentMemoryId: a.memoryId },
      });
      const c = intents.record({
        prompt: 'branch 2', file: 'src/c.ts', contentHash: 'sha256:3',
        context: { parentMemoryId: a.memoryId },
      });

      expect(lineage.getChildren(a.memoryId).map((r) => r.memoryId).sort())
        .toEqual([b.memoryId, c.memoryId].sort());
    });
  });

  describe('getAncestors() / getRoot() / getDescendants()', () => {
    it('stops on a cyclic parent link', () => {
      const a = intents.record({ prompt: 'v1', file: 'src/a.ts', contentHash: 'sha256:1' });
      const b = intents.record({
        prompt: 'v2', file: 'src/b.ts', contentHash: 'sha256:2',
        context: { parentMemoryId: a.memoryId },
      });
      // Re-point a at b to create a cycle.
      const stored = intents.get(a.memoryId)!;
      stored.context.parentMemoryId = b.memoryId;

      expect(lineage.getAncestors(b.memoryId).map((r) => r.memoryId)).toEqual([a.memoryId]);
      expect(lineage.getRoot(b.memoryId)!.memoryId).toBe(a.memoryId);
    });

    it('returns null root for unknown intent', () => {
      expect(lineage.getRoot('intent-unknown')).toBeNull();
      expect(lineage.getDescendants('intent-unknown')).toEqual([]);
    });

    it('flattens descendants breadth-first', () => {
      const a = intents.record({ prompt: 'v1', file: 'src/a.ts', contentHash: 'sha256:1' });
      const b = intents.record({ prompt: 'v2', file: 'src/a.ts', contentHash: 'sha256:2' });
      const c = intents.record({ prompt: 'v3', file: 'src/a.ts', contentHash: 'sha256:3' });

      expect(lineage.getDescendants(a.memoryId).map((r) => r.memoryId)).toEqual([b.memoryId, c.memoryId]);
    });
  });

  describe('getFileLineage() / findByContentHash()', () => {
    it('returns the file chain oldest first', () => {
      const a = intents.record({ prompt: 'v1', file: 'src/a.ts', contentHash: 'sha256:1' });
      const b = intents.record({ prompt: 'v2', file: 'src/a.ts', contentHash: 'sha256:2' });
      intents.record({ prompt: 'other', file: 'src/b.ts', contentHash: 'sha256:9' });

      expect(lineage.getFileLineage('src/a.ts').map((r) => r.memoryId)).toEqual([a.memoryId, b.memoryId]);
    });

    it('finds an intent by content hash', () => {
      const a = intents.record({ prompt: 'v1', file: 'src/a.ts', contentHash: 'sha256:1' });

      expect(lineage.findByContentHash('sha256:1')!.memoryId).toBe(a.memoryId);
      expect(lineage.findByContentHash('sha256:none')).toBeNull();
    });
  });
});
