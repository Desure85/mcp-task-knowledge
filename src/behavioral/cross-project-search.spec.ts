/**
 * behavioral/cross-project-search.spec.ts — Tests for CrossProjectSearch (BM-009).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { FailureLogger } from './failure-logging.js';
import { ResolutionLogger } from './resolution-logging.js';
import { CrossProjectSearch } from './cross-project-search.js';
import type { ProjectMemory } from './cross-project-search.js';

let testDir: string;
let failuresA: FailureLogger;
let resolutionsA: ResolutionLogger;
let failuresB: FailureLogger;
let resolutionsB: ResolutionLogger;
let search: CrossProjectSearch;

describe('BM-009: CrossProjectSearch', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `cross-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    failuresA = new FailureLogger({ storagePath: join(testDir, 'a') });
    resolutionsA = new ResolutionLogger({ storagePath: join(testDir, 'a') });
    failuresB = new FailureLogger({ storagePath: join(testDir, 'b') });
    resolutionsB = new ResolutionLogger({ storagePath: join(testDir, 'b') });

    // Repo A: a bug was fixed once
    const failureA = failuresA.log({
      memoryId: 'intent-a',
      errorType: 'TypeError',
      message: 'Cannot read property name of undefined object',
    });
    const resolutionA = resolutionsA.log({
      failureId: failureA.failureId,
      fixingMemoryId: 'intent-fixer-a',
      approach: 'use optional chaining for nested access',
    });
    failuresA.resolve(failureA.failureId, resolutionA.resolutionId);

    // Repo B: an unresolved similar failure + an unrelated resolved one
    failuresB.log({
      memoryId: 'intent-b',
      errorType: 'TypeError',
      message: 'Cannot read property name of null value',
    });
    const failureB2 = failuresB.log({
      memoryId: 'intent-b2',
      errorType: 'RangeError',
      message: 'Maximum call stack size exceeded while walking the tree',
    });
    const resolutionB2 = resolutionsB.log({
      failureId: failureB2.failureId,
      fixingMemoryId: 'intent-fixer-b',
      approach: 'convert recursion to iteration',
    });
    failuresB.resolve(failureB2.failureId, resolutionB2.resolutionId);

    const projects: ProjectMemory[] = [
      { id: 'repo-a', failures: failuresA, resolutions: resolutionsA },
      { id: 'repo-b', failures: failuresB, resolutions: resolutionsB },
    ];
    search = new CrossProjectSearch({ projects });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('searchFailures()', () => {
    it('finds failures across all projects', () => {
      const hits = search.searchFailures('Cannot read property name');
      expect(hits.length).toBe(2);
      const projects = new Set(hits.map((h) => h.projectId));
      expect(projects).toEqual(new Set(['repo-a', 'repo-b']));
    });

    it('matches by error type', () => {
      const hits = search.searchFailures('RangeError');
      expect(hits).toHaveLength(1);
      expect(hits[0].projectId).toBe('repo-b');
    });

    it('returns empty for no matches', () => {
      expect(search.searchFailures('zzz-nothing')).toEqual([]);
    });
  });

  describe('searchResolutions()', () => {
    it('finds fixes by approach text across projects', () => {
      const hits = search.searchResolutions('optional chaining');
      expect(hits).toHaveLength(1);
      expect(hits[0].projectId).toBe('repo-a');
      expect(hits[0].resolution?.approach).toContain('optional chaining');
    });

    it('attaches the resolved failure', () => {
      const hits = search.searchResolutions('iteration');
      expect(hits[0].failure.errorType).toBe('RangeError');
    });
  });

  describe('findProvenFixes()', () => {
    it('finds a proven fix from another project for the same failure shape', () => {
      // A developer in repo B hits the same TypeError — repo A already fixed it
      const hits = search.findProvenFixes('TypeError', 'Cannot read property name of undefined object');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].projectId).toBe('repo-a');
      expect(hits[0].similarity).toBeGreaterThan(0.5);
      expect(hits[0].resolution?.approach).toContain('optional chaining');
    });

    it('does not return unresolved failures as proven fixes', () => {
      // repo-b's unresolved TypeError should not be returned as a fix
      const hits = search.findProvenFixes('TypeError', 'Cannot read property name');
      expect(hits.every((h) => h.failure.resolved)).toBe(true);
      expect(hits.every((h) => h.projectId === 'repo-a')).toBe(true);
    });

    it('respects minSimilarity', () => {
      const loose = search.findProvenFixes('Error', 'failure', { minSimilarity: 0 });
      const strict = search.findProvenFixes('Error', 'failure', { minSimilarity: 0.9 });
      expect(strict.length).toBeLessThan(loose.length);
    });

    it('sorts by similarity descending', () => {
      const hits = search.findProvenFixes('TypeError', 'Cannot read property name of undefined object', { minSimilarity: 0 });
      for (let i = 1; i < hits.length; i++) {
        expect(hits[i - 1].similarity!).toBeGreaterThanOrEqual(hits[i].similarity!);
      }
    });
  });

  describe('projectIds', () => {
    it('lists known projects', () => {
      expect(search.projectIds).toEqual(['repo-a', 'repo-b']);
    });
  });
});
