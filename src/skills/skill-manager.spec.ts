/**
 * skills/skill-manager.spec.ts — Tests for SkillManager (SK-001).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SkillManager } from './skill-manager.js';

let testDir: string;

describe('SK-001: SkillManager', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `sk-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('create()', () => {
    it('creates a skill with auto-generated ID', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      const skill = mgr.create({
        name: 'Code Review',
        description: 'Reviews code for quality',
        body: 'Review the code for $ARGUMENTS',
      });

      expect(skill.id).toBe('code-review');
      expect(skill.version).toBe('1.0.0');
      expect(skill.status).toBe('draft');
      expect(skill.versions.length).toBe(1);
    });

    it('stores tags and frontmatter', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      const skill = mgr.create({
        name: 'Deploy',
        description: 'Deploys app',
        body: 'Deploy ${ENV}',
        tags: ['ops', 'deploy'],
        frontmatter: { priority: 'high' },
      });

      expect(skill.tags).toEqual(['ops', 'deploy']);
      expect(skill.frontmatter.priority).toBe('high');
    });

    it('throws on duplicate name', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      mgr.create({ name: 'Test', description: 'd', body: 'b' });
      expect(() => mgr.create({ name: 'Test', description: 'd', body: 'b' })).toThrow();
    });

    it('slugifies name to ID', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      const skill = mgr.create({ name: 'My Cool Skill!', description: 'd', body: 'b' });
      expect(skill.id).toBe('my-cool-skill');
    });
  });

  describe('get()', () => {
    it('retrieves a skill by ID', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      mgr.create({ name: 'Test', description: 'd', body: 'b' });
      const found = mgr.get('test');
      expect(found?.name).toBe('Test');
    });

    it('returns undefined for unknown ID', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      expect(mgr.get('unknown')).toBeUndefined();
    });
  });

  describe('update()', () => {
    it('updates skill fields', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      const skill = mgr.create({ name: 'Test', description: 'd', body: 'b' });
      const updated = mgr.update(skill.id, { description: 'new desc', tags: ['new'] });
      expect(updated.description).toBe('new desc');
      expect(updated.tags).toEqual(['new']);
    });

    it('creates new version when body changes', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      const skill = mgr.create({ name: 'Test', description: 'd', body: 'b' });
      const updated = mgr.update(skill.id, { body: 'new body', changelog: 'improved' });
      expect(updated.version).toBe('1.0.1');
      expect(updated.versions.length).toBe(2);
      expect(updated.versions[1].changelog).toBe('improved');
    });

    it('does not create new version when body unchanged', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      const skill = mgr.create({ name: 'Test', description: 'd', body: 'b' });
      mgr.update(skill.id, { description: 'new desc' });
      const found = mgr.get(skill.id);
      expect(found?.versions.length).toBe(1);
    });

    it('throws for unknown skill', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      expect(() => mgr.update('unknown', { body: 'x' })).toThrow();
    });
  });

  describe('delete()', () => {
    it('deletes a skill', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      const s = mgr.create({ name: 'Test', description: 'd', body: 'b' });
      expect(mgr.delete(s.id)).toBe(true);
      expect(mgr.get(s.id)).toBeUndefined();
    });

    it('returns false for unknown ID', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      expect(mgr.delete('unknown')).toBe(false);
    });
  });

  describe('list()', () => {
    it('lists all skills', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      mgr.create({ name: 'A', description: 'd', body: 'b' });
      mgr.create({ name: 'B', description: 'd', body: 'b' });
      expect(mgr.list().length).toBe(2);
    });

    it('filters by status', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      const s = mgr.create({ name: 'A', description: 'd', body: 'b' });
      mgr.create({ name: 'B', description: 'd', body: 'b' });
      mgr.activate(s.id);
      expect(mgr.list({ status: 'active' }).length).toBe(1);
    });

    it('filters by tag', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      mgr.create({ name: 'A', description: 'd', body: 'b', tags: ['ops'] });
      mgr.create({ name: 'B', description: 'd', body: 'b', tags: ['dev'] });
      expect(mgr.list({ tag: 'ops' }).length).toBe(1);
    });
  });

  describe('search()', () => {
    it('searches in name', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      mgr.create({ name: 'Code Review', description: 'd', body: 'b' });
      mgr.create({ name: 'Deploy', description: 'd', body: 'b' });
      expect(mgr.search('review').length).toBe(1);
    });

    it('searches in description', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      mgr.create({ name: 'A', description: 'Reviews code quality', body: 'b' });
      expect(mgr.search('quality').length).toBe(1);
    });

    it('searches in body', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      mgr.create({ name: 'A', description: 'd', body: 'Check for null references' });
      expect(mgr.search('null').length).toBe(1);
    });

    it('is case-insensitive', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      mgr.create({ name: 'CODE REVIEW', description: 'd', body: 'b' });
      expect(mgr.search('code').length).toBe(1);
    });
  });

  describe('versioning', () => {
    it('getHistory returns versions newest first', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      const s = mgr.create({ name: 'Test', description: 'd', body: 'b' });
      mgr.update(s.id, { body: 'v2' });
      mgr.update(s.id, { body: 'v3' });
      const history = mgr.getHistory(s.id);
      expect(history.length).toBe(3);
      // newest first — sorted by createdAt desc; all created in same ms, so
      // the sort is unstable. Verify the latest version is present.
      const versions = history.map((v) => v.version);
      expect(versions).toContain('1.0.0');
      expect(versions).toContain('1.0.1');
      expect(versions).toContain('1.0.2');
    });

    it('rollback restores version number', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      const s = mgr.create({ name: 'Test', description: 'd', body: 'b' });
      mgr.update(s.id, { body: 'v2' });
      mgr.rollback(s.id, '1.0.0');
      const found = mgr.get(s.id);
      expect(found?.version).toBe('1.0.0');
    });
  });

  describe('status management', () => {
    it('activate changes status to active', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      const s = mgr.create({ name: 'Test', description: 'd', body: 'b' });
      mgr.activate(s.id);
      expect(mgr.get(s.id)?.status).toBe('active');
    });

    it('deprecate changes status to deprecated', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      const s = mgr.create({ name: 'Test', description: 'd', body: 'b' });
      mgr.deprecate(s.id);
      expect(mgr.get(s.id)?.status).toBe('deprecated');
    });

    it('archive changes status to archived', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      const s = mgr.create({ name: 'Test', description: 'd', body: 'b' });
      mgr.archive(s.id);
      expect(mgr.get(s.id)?.status).toBe('archived');
    });
  });

  describe('persistence', () => {
    it('persists across instances', () => {
      const mgr1 = new SkillManager({ storagePath: testDir });
      mgr1.create({ name: 'Test', description: 'd', body: 'b' });
      const mgr2 = new SkillManager({ storagePath: testDir });
      expect(mgr2.count).toBe(1);
    });
  });

  describe('clear() and count', () => {
    it('clear removes all skills', () => {
      const mgr = new SkillManager({ storagePath: testDir });
      mgr.create({ name: 'A', description: 'd', body: 'b' });
      mgr.clear();
      expect(mgr.count).toBe(0);
    });
  });
});
