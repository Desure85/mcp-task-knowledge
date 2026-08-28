/**
 * rules/policy-engine.spec.ts — Tests for PolicyEngine (RL-003).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RuleManager } from './rule-manager.js';
import { PolicyEngine } from './policy-engine.js';
import type { PolicyRule } from './policy-engine.js';

let testDir: string;
let manager: RuleManager;
let engine: PolicyEngine;

const POLICY_JSON = JSON.stringify([
  {
    id: 'no-console-ts',
    name: 'No console in TypeScript',
    severity: 'warn',
    when: [
      { field: 'file', op: 'matches', pattern: '*.ts' },
      { field: 'content', op: 'matches', pattern: 'console\\.' },
    ],
    then: 'Remove console.log/error from TypeScript files.',
    tags: ['clean-code'],
  },
  {
    id: 'no-secrets',
    name: 'No secrets in code',
    severity: 'error',
    when: [
      { field: 'content', op: 'matches', pattern: '(api[_-]?key|password)\\s*=' },
    ],
    then: 'Move secrets to environment variables.',
  },
]);

describe('RL-003: PolicyEngine', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `policy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    manager = new RuleManager({ storagePath: testDir });
    engine = new PolicyEngine(manager, { scope: 'project' });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('parsePolicy()', () => {
    it('parses valid policy JSON', () => {
      const policies = engine.parsePolicy(POLICY_JSON);
      expect(policies).toHaveLength(2);
      expect(policies[0].id).toBe('no-console-ts');
      expect(policies[0].when).toHaveLength(2);
    });

    it('throws on invalid JSON', () => {
      expect(() => engine.parsePolicy('{not json')).toThrow(/invalid policy JSON/);
    });

    it('throws on structurally invalid policy', () => {
      expect(() => engine.parsePolicy(JSON.stringify([{ id: 'x' }]))).toThrow(/invalid policy/);
    });
  });

  describe('validatePolicy()', () => {
    it('returns errors for missing fields', () => {
      const errors = engine.validatePolicy({} as PolicyRule);
      expect(errors).toEqual(expect.arrayContaining(['id required', 'name required', 'when (non-empty array) required', 'then required']));
    });

    it('returns errors for bad severity', () => {
      const errors = engine.validatePolicy({
        id: 'x', name: 'x', when: [{ field: 'a' }], then: 'do', severity: 'bogus' as never,
      });
      expect(errors).toContain('severity must be error|warn|info, got bogus');
    });

    it('accepts a valid policy', () => {
      const errors = engine.validatePolicy({
        id: 'x', name: 'x', when: [{ field: 'file', op: 'matches', pattern: '*.ts' }], then: 'do',
      });
      expect(errors).toEqual([]);
    });
  });

  describe('loadPolicies()', () => {
    it('converts policies to rules with policy frontmatter', () => {
      const rules = engine.loadPolicies(engine.parsePolicy(POLICY_JSON));
      expect(rules).toHaveLength(2);

      const rule = manager.get('project:no-console-in-typescript')!;
      expect(rule).toBeDefined();
      expect(rule.frontmatter.policy).toBe(true);
      expect(rule.frontmatter.policyId).toBe('no-console-ts');
      expect(rule.severity).toBe('warn');
      expect(rule.body).toContain('Remove console.log');
    });

    it('upserts instead of throwing on re-load', () => {
      engine.loadPolicies(engine.parsePolicy(POLICY_JSON));
      const rules = engine.loadPolicies(engine.parsePolicy(POLICY_JSON));
      expect(rules).toHaveLength(2);
      expect(manager.count).toBe(2);
    });

    it('loadPoliciesFromDir reads *.policy.json files', () => {
      writeFileSync(join(testDir, 'team.policy.json'), POLICY_JSON);
      writeFileSync(join(testDir, 'ignore.txt'), 'nope');
      const rules = engine.loadPoliciesFromDir(testDir);
      expect(rules).toHaveLength(2);
    });

    it('loadPoliciesFromDir returns empty for missing dir', () => {
      expect(engine.loadPoliciesFromDir(join(testDir, 'nope'))).toEqual([]);
    });
  });

  describe('evaluate()', () => {
    beforeEach(() => {
      engine.loadPolicies(engine.parsePolicy(POLICY_JSON));
    });

    it('matches when all conditions are true (AND)', () => {
      const results = engine.evaluate({ file: 'src/a.ts', content: 'console.log(1)' });
      const matched = results.filter((r) => r.matched);
      expect(matched).toHaveLength(1);
      expect(matched[0].policy.id).toBe('no-console-ts');
      expect(matched[0].severity).toBe('warn');
    });

    it('does not match when one condition is false', () => {
      const results = engine.evaluate({ file: 'src/a.ts', content: 'const x = 1;' });
      expect(results.every((r) => !r.matched)).toBe(true);
    });

    it('supports glob file patterns', () => {
      const results = engine.evaluate({ file: 'lib/util.ts', content: 'console.error(1)' });
      expect(results.filter((r) => r.matched)[0].policy.id).toBe('no-console-ts');
    });

    it('supports error-severity policies', () => {
      const results = engine.evaluate({ file: '.env', content: 'password=hunter2' });
      const matched = results.filter((r) => r.matched);
      expect(matched).toHaveLength(1);
      expect(matched[0].policy.id).toBe('no-secrets');
      expect(matched[0].severity).toBe('error');
    });

    it('evaluateMatches returns only matched policies', () => {
      const matched = engine.evaluateMatches({ file: 'src/a.ts', content: 'console.log(1)' });
      expect(matched).toHaveLength(1);
    });
  });

  describe('condition operators', () => {
    it('supports eq / neq / exists / in', () => {
      engine.loadPolicies([
        {
          id: 'ops',
          name: 'Ops',
          when: [
            { field: 'env', op: 'eq', value: 'prod' },
            { field: 'dryRun', op: 'neq', value: true },
            { field: 'owner', op: 'exists' },
            { field: 'region', op: 'in', value: ['eu', 'us'] },
          ],
          then: 'check',
        },
      ]);

      const ok = engine.evaluate({ env: 'prod', dryRun: false, owner: 'team-a', region: 'eu' });
      expect(ok[0].matched).toBe(true);

      const bad = engine.evaluate({ env: 'prod', dryRun: true, owner: 'team-a', region: 'eu' });
      expect(bad[0].matched).toBe(false);
    });

    it('resolves nested paths', () => {
      engine.loadPolicies([
        {
          id: 'nested',
          name: 'Nested',
          when: [{ field: 'args.id', op: 'eq', value: 'task-1' }],
          then: 'check',
        },
      ]);
      const results = engine.evaluate({ args: { id: 'task-1' } });
      expect(results[0].matched).toBe(true);
    });
  });
});
