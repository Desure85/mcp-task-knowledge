/**
 * rules/rule-evaluator.spec.ts — Tests for RuleEvaluator (RL-002).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { RuleManager } from './rule-manager.js';
import { RuleEvaluator } from './rule-evaluator.js';
import type { RuleScope } from './types.js';

let testDir: string;
let manager: RuleManager;

function seedRules(): void {
  manager.create({
    name: 'delete-guard',
    description: 'Guard destructive deletes',
    scope: 'global',
    severity: 'error',
    body: 'Prevent destructive deletes without explicit confirmation.',
    frontmatter: {
      targets: ['tasks:delete', 'tasks:bulk-delete'],
      check: 'input',
      schema: {
        type: 'object',
        required: ['confirm'],
        properties: {
          confirm: { type: 'boolean' },
          id: { type: 'string', pattern: '^[a-z0-9-]+$' },
        },
      },
    },
  });
  manager.create({
    name: 'no-dangerous-shell',
    description: 'Deny dangerous shell patterns',
    scope: 'global',
    severity: 'error',
    body: 'Reject dangerous shell commands.',
    frontmatter: {
      targets: ['exec'],
      deny: ['rm -rf', 'mkfs'],
    },
  });
  manager.create({
    name: 'output-shape',
    description: 'Validate tool output shape',
    scope: 'global',
    severity: 'warn',
    body: 'Tool output must be an object with an id.',
    frontmatter: {
      targets: ['search'],
      check: 'output',
      schema: {
        type: 'object',
        required: ['id'],
      },
    },
  });
  manager.create({
    name: 'limit-batch',
    description: 'Batch size limits',
    scope: 'global',
    severity: 'warn',
    body: 'Batch operations limited to 100 items.',
    frontmatter: {
      targets: ['tasks:*'],
      schema: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'object' }, maxLength: 100 },
        },
      },
    },
  });
  manager.create({
    name: 'status-enum',
    description: 'Status must be in allowed set',
    scope: 'global',
    severity: 'error',
    body: 'Task status must be one of the allowed values.',
    frontmatter: {
      targets: ['tasks:update'],
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'in_progress', 'done'] },
        },
      },
    },
  });
}

describe('RL-002: RuleEvaluator', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `rule-eval-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    manager = new RuleManager({ storagePath: testDir });
    seedRules();
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('evaluateInput()', () => {
    it('passes when args satisfy the rule schema', () => {
      const evaluator = new RuleEvaluator(manager);
      const result = evaluator.evaluateInput('project', 'tasks:delete', { confirm: true, id: 'task-1' });
      expect(result.pass).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.violations).toEqual([]);
    });

    it('blocks on a missing required field', () => {
      const evaluator = new RuleEvaluator(manager);
      const result = evaluator.evaluateInput('project', 'tasks:delete', { id: 'task-1' });
      expect(result.pass).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.violations[0]).toMatchObject({
        ruleId: 'global:delete-guard',
        path: 'input.confirm',
        message: 'missing required field: confirm',
      });
    });

    it('blocks on a wrong type', () => {
      const evaluator = new RuleEvaluator(manager);
      const result = evaluator.evaluateInput('project', 'tasks:delete', { confirm: 'yes' });
      expect(result.blocked).toBe(true);
      expect(result.violations.some((v) => v.message.includes('expected boolean, got string'))).toBe(true);
    });

    it('rejects values outside the enum', () => {
      const evaluator = new RuleEvaluator(manager);
      const result = evaluator.evaluateInput('project', 'tasks:update', { status: 'bogus' });
      expect(result.blocked).toBe(true);
      expect(result.violations[0].path).toBe('input.status');
    });

    it('rejects values not matching a pattern', () => {
      const evaluator = new RuleEvaluator(manager);
      const result = evaluator.evaluateInput('project', 'tasks:delete', { confirm: true, id: 'BAD ID!' });
      expect(result.blocked).toBe(true);
      expect(result.violations[0].path).toBe('input.id');
    });

    it('flags deny patterns', () => {
      const evaluator = new RuleEvaluator(manager);
      const result = evaluator.evaluateInput('project', 'exec', { command: 'rm -rf /' });
      expect(result.blocked).toBe(true);
      expect(result.violations[0].ruleId).toBe('global:no-dangerous-shell');
    });

    it('applies wildcard targets', () => {
      const evaluator = new RuleEvaluator(manager);
      const result = evaluator.evaluateInput('project', 'tasks:bulk-create', { items: [{ id: 'a' }] });
      // limit-batch targets "tasks:*" — matched; no violation for small batch
      expect(result.pass).toBe(true);
    });

    it('passes for tools with no matching rules', () => {
      const evaluator = new RuleEvaluator(manager);
      const result = evaluator.evaluateInput('project', 'knowledge:get', { id: 'x' });
      expect(result.pass).toBe(true);
      expect(result.blocked).toBe(false);
    });
  });

  describe('evaluateOutput()', () => {
    it('validates output shape in output phase', () => {
      const evaluator = new RuleEvaluator(manager);
      const result = evaluator.evaluateOutput('project', 'search', { query: 'x' });
      expect(result.pass).toBe(false);
      // warn severity → not blocked
      expect(result.blocked).toBe(false);
      expect(result.violations[0]).toMatchObject({
        ruleId: 'global:output-shape',
        path: 'output.id',
        severity: 'warn',
      });
    });

    it('does not apply output rules to the input phase', () => {
      const evaluator = new RuleEvaluator(manager);
      const result = evaluator.evaluateInput('project', 'search', { query: 'x' });
      expect(result.pass).toBe(true);
    });
  });

  describe('array constraints', () => {
    it('flags arrays over maxLength', () => {
      const evaluator = new RuleEvaluator(manager);
      const items = Array.from({ length: 101 }, (_, i) => ({ id: `x${i}` }));
      const result = evaluator.evaluateInput('project', 'tasks:bulk-create', { items });
      expect(result.violations.some((v) => v.path === 'input.items' && v.message.includes('maxLength'))).toBe(true);
      // wildcard target matched: ruleId is global:limit-batch
      expect(result.violations.some((v) => v.ruleId === 'global:limit-batch')).toBe(true);
    });
  });

  describe('inheritance', () => {
    it('project rule overrides global rule by name', () => {
      manager.create({
        name: 'delete-guard',
        description: 'Project-level delete guard',
        scope: 'project',
        severity: 'warn',
        body: 'Project override: confirmation optional.',
        frontmatter: {
          targets: ['tasks:delete'],
          schema: { type: 'object', required: [] },
        },
      });

      const evaluator = new RuleEvaluator(manager);
      const result = evaluator.evaluateInput('project', 'tasks:delete', {});
      // Global rule (requires confirm) overridden by project rule
      expect(result.pass).toBe(true);
      expect(result.blocked).toBe(false);
    });
  });
});
