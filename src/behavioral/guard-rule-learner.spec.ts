/**
 * behavioral/guard-rule-learner.spec.ts — Tests for GuardRuleLearner (BM-010).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { FailureLogger } from './failure-logging.js';
import { ResolutionLogger } from './resolution-logging.js';
import { GuardRuleLearner } from './guard-rule-learner.js';
import { RuleManager } from '../rules/rule-manager.js';
import { RuleEvaluator } from '../rules/rule-evaluator.js';

let testDir: string;
let failures: FailureLogger;
let resolutions: ResolutionLogger;
let rules: RuleManager;
let learner: GuardRuleLearner;

function seedResolvedFailure(overrides?: { errorType?: string; message?: string; approach?: string }): string {
  const failure = failures.log({
    memoryId: 'intent-x',
    errorType: overrides?.errorType ?? 'TypeError',
    message: overrides?.message ?? 'Cannot read property name of undefined object',
  });
  const resolution = resolutions.log({
    failureId: failure.failureId,
    fixingMemoryId: 'intent-fixer',
    approach: overrides?.approach ?? 'use optional chaining',
  });
  failures.resolve(failure.failureId, resolution.resolutionId);
  return failure.failureId;
}

describe('BM-010: GuardRuleLearner', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `learner-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    failures = new FailureLogger({ storagePath: testDir });
    resolutions = new ResolutionLogger({ storagePath: testDir });
    rules = new RuleManager({ storagePath: testDir });
    learner = new GuardRuleLearner(failures, resolutions, rules);
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('learn()', () => {
    it('distills a resolved failure into a guard rule', () => {
      seedResolvedFailure();
      const result = learner.learn();

      expect(result.learned).toHaveLength(1);
      expect(result.skipped).toBe(0);

      const rule = result.learned[0];
      expect(rule.id).toBe('global:guard-typeerror');
      expect(rule.severity).toBe('error');
      expect(rule.body).toBe('use optional chaining');
      expect(rule.frontmatter.guard).toBe(true);
      expect((rule.frontmatter.learnedFrom as { failureId: string }).failureId).toBeTruthy();
      expect(Array.isArray(rule.frontmatter.deny)).toBe(true);
    });

    it('ignores unresolved failures', () => {
      failures.log({
        memoryId: 'intent-y',
        errorType: 'RangeError',
        message: 'Maximum call stack size exceeded',
      });
      const result = learner.learn();
      expect(result.learned).toEqual([]);
      // unresolved failures are not candidates at all
      expect(result.skipped).toBe(0);
      expect(learner.listLearnedRules()).toEqual([]);
    });

    it('is idempotent across passes', () => {
      seedResolvedFailure();
      learner.learn();
      const second = learner.learn();
      expect(second.learned).toEqual([]);
      expect(learner.listLearnedRules()).toHaveLength(1);
      expect(rules.count).toBe(1);
    });

    it('updates an existing rule instead of duplicating', () => {
      seedResolvedFailure({ message: 'Cannot read property name of undefined object', approach: 'v1 fix' });
      learner.learn();

      // A new failure of the same shape with a better fix
      const f2 = failures.log({
        memoryId: 'intent-z',
        errorType: 'TypeError',
        message: 'Cannot read property name of null object',
      });
      const r2 = resolutions.log({
        failureId: f2.failureId,
        fixingMemoryId: 'intent-fixer-2',
        approach: 'v2 fix with null guard',
      });
      failures.resolve(f2.failureId, r2.resolutionId);

      const result = learner.learn();
      expect(result.learned).toHaveLength(1);
      expect(rules.count).toBe(1);
      expect(rules.get('global:guard-typeerror')!.body).toBe('v2 fix with null guard');
    });
  });

  describe('learnFromFailure()', () => {
    it('learns from a specific failure', () => {
      const id = seedResolvedFailure();
      const rule = learner.learnFromFailure(id);
      expect(rule).not.toBeNull();
      expect(rule!.frontmatter.deny).toHaveLength(1);
    });

    it('returns null for an unresolved failure', () => {
      const failure = failures.log({ memoryId: 'i', errorType: 'Error', message: 'boom happened' });
      expect(learner.learnFromFailure(failure.failureId)).toBeNull();
    });

    it('returns null when there is no resolution', () => {
      const failure = failures.log({ memoryId: 'i', errorType: 'Error', message: 'boom happened' });
      failures.resolve(failure.failureId, 'missing-resolution');
      expect(learner.learnFromFailure(failure.failureId)).toBeNull();
    });
  });

  describe('learned rules are enforceable (RL-002)', () => {
    it('the deny pattern fires on matching code', () => {
      seedResolvedFailure({
        errorType: 'TypeError',
        message: 'Cannot read property name of undefined object',
        approach: 'use optional chaining',
      });
      learner.learn();

      const evaluator = new RuleEvaluator(rules);
      const hit = evaluator.evaluateInput('global', 'file:write', { content: 'const name = user.name;' });
      // 'name' keyword appears in the deny pattern (message keyword)
      expect(hit.violations.length).toBeGreaterThan(0);
      expect(hit.violations[0].message).toContain('known failure pattern');

      const clean = evaluator.evaluateInput('global', 'file:write', { content: 'const x = 42;' });
      expect(clean.violations).toEqual([]);
    });

    it('respects the configured scope', () => {
      seedResolvedFailure();
      const scoped = new GuardRuleLearner(failures, resolutions, rules, { scope: 'project' });
      scoped.learn();
      expect(rules.get('project:guard-typeerror')).toBeDefined();
    });
  });
});
