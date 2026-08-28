/**
 * rules/rule-packs.spec.ts — Tests for built-in rule packs (RL-004).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { RuleManager } from './rule-manager.js';
import { RuleEvaluator } from './rule-evaluator.js';
import {
  rulePacks, listRulePacks, getRulePack, buildRulesFromPack, installRulePack,
} from './rule-packs.js';

let testDir: string;
let manager: RuleManager;

describe('RL-004: Built-in rule packs', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `rule-pack-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    manager = new RuleManager({ storagePath: testDir });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('listRulePacks() / getRulePack()', () => {
    it('returns all 5 built-in packs', () => {
      const packs = listRulePacks();
      expect(packs.map((p) => p.id).sort()).toEqual([
        'python-style', 'react-conventions', 'security-rules',
        'team-standards', 'ts-strict',
      ]);
    });

    it('returns a pack by id with default scope', () => {
      const pack = getRulePack('security-rules');
      expect(pack).toBeDefined();
      expect(pack!.defaultScope).toBe('global');
      expect(pack!.rules.length).toBeGreaterThan(0);
    });

    it('returns undefined for unknown id', () => {
      expect(getRulePack('nope')).toBeUndefined();
    });
  });

  describe('buildRulesFromPack()', () => {
    it('throws on unknown pack', () => {
      expect(() => buildRulesFromPack('nope')).toThrow(/pack not found/);
    });

    it('builds valid CreateRuleInput entries', () => {
      const inputs = buildRulesFromPack('ts-strict');
      expect(inputs.length).toBe(2);
      expect(inputs[0]).toMatchObject({
        name: 'no-implicit-any',
        scope: 'project',
        severity: 'warn',
      });
      expect(inputs[0].frontmatter?.targets).toBeDefined();
    });

    it('honors a scope override', () => {
      const inputs = buildRulesFromPack('security-rules', 'user');
      expect(inputs.every((i) => i.scope === 'user')).toBe(true);
    });
  });

  describe('installRulePack()', () => {
    it('installs all rules of a pack', () => {
      const result = installRulePack(manager, 'security-rules');
      expect(result.installed).toHaveLength(3);
      expect(result.skipped).toEqual([]);
      expect(manager.get('global:no-secrets-in-code')).toBeDefined();
      expect(manager.count).toBe(3);
    });

    it('skips existing rules without overwrite', () => {
      installRulePack(manager, 'security-rules');
      const second = installRulePack(manager, 'security-rules');
      expect(second.installed).toEqual([]);
      expect(second.skipped).toHaveLength(3);
      expect(manager.count).toBe(3);
    });

    it('overwrites existing rules when requested', () => {
      installRulePack(manager, 'security-rules');
      const overwritten = installRulePack(manager, 'security-rules', { overwrite: true });
      expect(overwritten.installed).toHaveLength(3);
      expect(manager.count).toBe(3);
    });
  });

  describe('pack rules work with RuleEvaluator (RL-002)', () => {
    it('security-rules blocks hardcoded secrets', () => {
      installRulePack(manager, 'security-rules');
      const evaluator = new RuleEvaluator(manager);
      const result = evaluator.evaluateInput('global', 'file:write', { content: 'const key = "api_key=abc"' });
      expect(result.blocked).toBe(true);
      expect(result.violations.some((v) => v.message.includes('hardcoded secret'))).toBe(true);
    });

    it('security-rules blocks dangerous shell commands', () => {
      installRulePack(manager, 'security-rules');
      const evaluator = new RuleEvaluator(manager);
      const result = evaluator.evaluateInput('global', 'exec', { command: 'rm -rf /' });
      expect(result.blocked).toBe(true);
    });

    it('security-rules requires confirm for destructive tools', () => {
      installRulePack(manager, 'security-rules');
      const evaluator = new RuleEvaluator(manager);
      const denied = evaluator.evaluateInput('global', 'tasks:delete', { id: 'x' });
      expect(denied.blocked).toBe(true);
      const allowed = evaluator.evaluateInput('global', 'tasks:delete', { id: 'x', confirm: true });
      expect(allowed.blocked).toBe(false);
    });

    it('team-standards validates conventional commit messages', () => {
      installRulePack(manager, 'team-standards');
      const evaluator = new RuleEvaluator(manager);
      const bad = evaluator.evaluateInput('project', 'git:commit', { message: 'fix stuff' });
      expect(bad.blocked).toBe(false); // warn severity → not blocked
      expect(bad.violations.length).toBeGreaterThan(0);
      const good = evaluator.evaluateInput('project', 'git:commit', { message: 'fix: stuff' });
      expect(good.violations).toEqual([]);
    });
  });
});
