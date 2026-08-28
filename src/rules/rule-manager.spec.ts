/**
 * rules/rule-manager.spec.ts — Tests for RuleManager (RL-001).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { RuleManager } from './rule-manager.js';

let testDir: string;

describe('RL-001: RuleManager', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `rl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('create()', () => {
    it('creates a rule with scope-prefixed ID', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      const rule = mgr.create({
        name: 'no-console',
        description: 'No console.log',
        scope: 'global',
        body: 'Do not use console.log',
      });

      expect(rule.id).toBe('global:no-console');
      expect(rule.severity).toBe('warn');
      expect(rule.status).toBe('active');
    });

    it('accepts custom severity', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      const rule = mgr.create({
        name: 'no-eval',
        description: 'No eval',
        scope: 'global',
        body: 'Do not use eval',
        severity: 'error',
      });
      expect(rule.severity).toBe('error');
    });

    it('throws on duplicate', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      mgr.create({ name: 'test', description: 'd', scope: 'global', body: 'b' });
      expect(() => mgr.create({ name: 'test', description: 'd', scope: 'global', body: 'b' })).toThrow();
    });

    it('allows same name in different scopes', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      mgr.create({ name: 'test', description: 'd', scope: 'global', body: 'b' });
      expect(() => mgr.create({ name: 'test', description: 'd', scope: 'project', body: 'b' })).not.toThrow();
    });
  });

  describe('get()', () => {
    it('retrieves by ID', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      mgr.create({ name: 'test', description: 'd', scope: 'global', body: 'b' });
      expect(mgr.get('global:test')?.name).toBe('test');
    });

    it('returns undefined for unknown', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      expect(mgr.get('unknown')).toBeUndefined();
    });
  });

  describe('update()', () => {
    it('updates fields', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      const r = mgr.create({ name: 'test', description: 'd', scope: 'global', body: 'b' });
      const updated = mgr.update(r.id, { description: 'new', severity: 'error' });
      expect(updated.description).toBe('new');
      expect(updated.severity).toBe('error');
    });

    it('throws for unknown', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      expect(() => mgr.update('unknown', { body: 'x' })).toThrow();
    });
  });

  describe('delete()', () => {
    it('deletes a rule', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      const r = mgr.create({ name: 'test', description: 'd', scope: 'global', body: 'b' });
      expect(mgr.delete(r.id)).toBe(true);
      expect(mgr.get(r.id)).toBeUndefined();
    });

    it('returns false for unknown', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      expect(mgr.delete('unknown')).toBe(false);
    });
  });

  describe('list()', () => {
    it('lists all rules', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      mgr.create({ name: 'a', description: 'd', scope: 'global', body: 'b' });
      mgr.create({ name: 'b', description: 'd', scope: 'project', body: 'b' });
      expect(mgr.list().length).toBe(2);
    });

    it('filters by scope', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      mgr.create({ name: 'a', description: 'd', scope: 'global', body: 'b' });
      mgr.create({ name: 'b', description: 'd', scope: 'project', body: 'b' });
      expect(mgr.list({ scope: 'global' }).length).toBe(1);
    });

    it('filters by status', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      const r = mgr.create({ name: 'a', description: 'd', scope: 'global', body: 'b' });
      mgr.create({ name: 'b', description: 'd', scope: 'global', body: 'b' });
      mgr.disable(r.id);
      expect(mgr.list({ status: 'active' }).length).toBe(1);
    });

    it('filters by tag', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      mgr.create({ name: 'a', description: 'd', scope: 'global', body: 'b', tags: ['security'] });
      mgr.create({ name: 'b', description: 'd', scope: 'global', body: 'b', tags: ['style'] });
      expect(mgr.list({ tag: 'security' }).length).toBe(1);
    });
  });

  describe('getEffectiveRules() — inheritance', () => {
    it('returns global rules when scope is global', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      mgr.create({ name: 'no-console', description: 'd', scope: 'global', body: 'No console' });
      const effective = mgr.getEffectiveRules('global');
      expect(effective.length).toBe(1);
      expect(effective[0].name).toBe('no-console');
    });

    it('project scope overrides global', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      mgr.create({ name: 'no-console', description: 'd', scope: 'global', body: 'No console' });
      mgr.create({ name: 'no-console', description: 'd', scope: 'project', body: 'Allow console.error' });
      const effective = mgr.getEffectiveRules('project');
      expect(effective.length).toBe(1);
      expect(effective[0].scope).toBe('project');
      expect(effective[0].body).toBe('Allow console.error');
    });

    it('user scope overrides project and global', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      mgr.create({ name: 'no-console', description: 'd', scope: 'global', body: 'No console' });
      mgr.create({ name: 'no-console', description: 'd', scope: 'project', body: 'Allow console.error' });
      mgr.create({ name: 'no-console', description: 'd', scope: 'user', body: 'Allow all console' });
      const effective = mgr.getEffectiveRules('user');
      expect(effective.length).toBe(1);
      expect(effective[0].scope).toBe('user');
    });

    it('combines non-overriding rules from all scopes', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      mgr.create({ name: 'no-console', description: 'd', scope: 'global', body: 'No console' });
      mgr.create({ name: 'no-eval', description: 'd', scope: 'global', body: 'No eval' });
      mgr.create({ name: 'use-types', description: 'd', scope: 'project', body: 'Use TypeScript' });
      const effective = mgr.getEffectiveRules('project');
      expect(effective.length).toBe(3);
    });

    it('excludes disabled rules', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      const r = mgr.create({ name: 'no-console', description: 'd', scope: 'global', body: 'No console' });
      mgr.disable(r.id);
      const effective = mgr.getEffectiveRules('global');
      expect(effective.length).toBe(0);
    });
  });

  describe('search()', () => {
    it('searches in name', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      mgr.create({ name: 'no-console', description: 'd', scope: 'global', body: 'b' });
      expect(mgr.search('console').length).toBe(1);
    });

    it('searches in body', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      mgr.create({ name: 'test', description: 'd', scope: 'global', body: 'Do not use eval' });
      expect(mgr.search('eval').length).toBe(1);
    });
  });

  describe('inheritance helpers', () => {
    it('getOverrides returns child rules', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      const parent = mgr.create({ name: 'no-console', description: 'd', scope: 'global', body: 'b' });
      mgr.create({ name: 'no-console', description: 'd', scope: 'project', body: 'override', parentId: parent.id });
      expect(mgr.getOverrides(parent.id).length).toBe(1);
    });

    it('getInheritanceChain returns parent chain', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      const parent = mgr.create({ name: 'no-console', description: 'd', scope: 'global', body: 'b' });
      const child = mgr.create({ name: 'no-console', description: 'd', scope: 'project', body: 'b', parentId: parent.id });
      const chain = mgr.getInheritanceChain(child.id);
      expect(chain.length).toBe(2);
      expect(chain[0].scope).toBe('global');
      expect(chain[1].scope).toBe('project');
    });
  });

  describe('status management', () => {
    it('enable/disable/archive', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      const r = mgr.create({ name: 'test', description: 'd', scope: 'global', body: 'b' });
      mgr.disable(r.id);
      expect(mgr.get(r.id)?.status).toBe('disabled');
      mgr.enable(r.id);
      expect(mgr.get(r.id)?.status).toBe('active');
      mgr.archive(r.id);
      expect(mgr.get(r.id)?.status).toBe('archived');
    });
  });

  describe('persistence', () => {
    it('persists across instances', () => {
      const mgr1 = new RuleManager({ storagePath: testDir });
      mgr1.create({ name: 'test', description: 'd', scope: 'global', body: 'b' });
      const mgr2 = new RuleManager({ storagePath: testDir });
      expect(mgr2.count).toBe(1);
    });
  });

  describe('clear()', () => {
    it('clears all rules', () => {
      const mgr = new RuleManager({ storagePath: testDir });
      mgr.create({ name: 'a', description: 'd', scope: 'global', body: 'b' });
      mgr.clear();
      expect(mgr.count).toBe(0);
    });
  });
});
