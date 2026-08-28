/**
 * skills/skill-discovery.spec.ts — Tests for SkillDiscovery (SK-003).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SkillManager } from './skill-manager.js';
import { SkillDiscovery } from './skill-discovery.js';

let testDir: string;
let manager: SkillManager;
let discovery: SkillDiscovery;

const CURSOR_RULES_WITH_FM = `---
name: ts-strict
description: Strict TypeScript rules
tags: [typescript, strict]
category: language
---
Always use strict mode.
Use explicit types for function parameters.
`;

const SKILL_MD = `---
name: code-review
description: Review code for quality issues
---
Check for error handling.
Verify tests are green.
`;

const CLINE_RULES = `# Project Rules

No console.log in production.
Prefer named exports.
`;

describe('SK-003: SkillDiscovery', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `skill-disc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    manager = new SkillManager({ storagePath: testDir });
    discovery = new SkillDiscovery(manager);
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('catalog / categories', () => {
    it('groups skills by category and returns counts', () => {
      manager.create({ name: 'eslint-check', description: 'd', body: 'b', frontmatter: { category: 'quality' } });
      manager.create({ name: 'ts-check', description: 'd', body: 'b', frontmatter: { category: 'quality' } });
      manager.create({ name: 'deploy', description: 'd', body: 'b', frontmatter: { category: 'devops' } });

      const categories = discovery.categories();
      expect(categories).toContainEqual({ category: 'quality', count: 2 });
      expect(categories).toContainEqual({ category: 'devops', count: 1 });

      const catalog = discovery.catalog();
      expect(catalog.quality.length).toBe(2);
      expect(catalog.devops.length).toBe(1);
    });

    it('falls back to first tag, then uncategorized', () => {
      manager.create({ name: 'a', description: 'd', body: 'b', tags: ['code-review'] });
      manager.create({ name: 'b', description: 'd', body: 'b' });

      const catalog = discovery.catalog();
      expect(catalog['code-review']).toHaveLength(1);
      expect(catalog.uncategorized).toHaveLength(1);
    });
  });

  describe('byTag / search', () => {
    it('lists skills by tag', () => {
      manager.create({ name: 'lint', description: 'd', body: 'b', tags: ['quality'] });
      manager.create({ name: 'other', description: 'd', body: 'b', tags: ['devops'] });

      const tagged = discovery.byTag('quality');
      expect(tagged.map((s) => s.id)).toEqual(['lint']);
    });

    it('searches with tag and category filters', () => {
      manager.create({ name: 'check-a', description: 'lint everything', body: 'b', tags: ['quality'], frontmatter: { category: 'qa' } });
      manager.create({ name: 'check-b', description: 'lint everything', body: 'b', tags: ['devops'] });

      const byTag = discovery.search('lint', { tag: 'quality' });
      expect(byTag.map((s) => s.id)).toEqual(['check-a']);

      const byCategory = discovery.search('lint', { category: 'qa' });
      expect(byCategory.map((s) => s.id)).toEqual(['check-a']);
    });
  });

  describe('importCursorRules()', () => {
    it('parses frontmatter and body into a skill', () => {
      const skill = discovery.importCursorRules(CURSOR_RULES_WITH_FM);

      expect(skill.id).toBe('ts-strict');
      expect(skill.description).toBe('Strict TypeScript rules');
      expect(skill.body).toContain('Always use strict mode.');
      expect(skill.tags).toEqual(expect.arrayContaining(['typescript', 'strict']));
      expect(skill.frontmatter.category).toBe('language');
    });

    it('uses option name when no frontmatter name', () => {
      const skill = discovery.importCursorRules('# Plain rules\nNo any.', { name: 'plain-rules' });
      expect(skill.id).toBe('plain-rules');
      expect(skill.body).toContain('No any.');
    });

    it('merges option tags and category', () => {
      const skill = discovery.importCursorRules(CURSOR_RULES_WITH_FM, {
        tags: ['extra'],
        category: 'ts',
        sourceUrl: 'https://github.com/patrickjscom/awesome-cursorrules/rules/ts-strict',
      });
      expect(skill.tags).toEqual(expect.arrayContaining(['typescript', 'strict', 'extra']));
      expect(skill.frontmatter.category).toBe('ts');
      expect(skill.frontmatter.sourceUrl).toContain('awesome-cursorrules');
    });
  });

  describe('importSkillMd()', () => {
    it('parses Agent Skills format', () => {
      const skill = discovery.importSkillMd(SKILL_MD);
      expect(skill.id).toBe('code-review');
      expect(skill.description).toBe('Review code for quality issues');
      expect(skill.body).toContain('Check for error handling.');
    });

    it('throws when name is missing', () => {
      expect(() => discovery.importSkillMd('# No frontmatter')).toThrow(/requires a name/);
    });
  });

  describe('importClinerules()', () => {
    it('imports plain markdown rules', () => {
      const skill = discovery.importClinerules(CLINE_RULES, { name: 'project-rules' });
      expect(skill.id).toBe('project-rules');
      expect(skill.body).toContain('No console.log in production.');
    });
  });

  describe('importFile() / importMany()', () => {
    it('auto-detects format by file name', () => {
      writeFileSync(join(testDir, 'ts-strict.cursorrules'), CURSOR_RULES_WITH_FM);
      writeFileSync(join(testDir, 'SKILL.md'), SKILL_MD);
      writeFileSync(join(testDir, 'my.clinerules'), CLINE_RULES);

      const a = discovery.importFile(join(testDir, 'ts-strict.cursorrules'));
      const b = discovery.importFile(join(testDir, 'SKILL.md'));
      const c = discovery.importFile(join(testDir, 'my.clinerules'));

      expect(a.id).toBe('ts-strict');
      expect(b.id).toBe('code-review');
      expect(c.id).toBe('my');
    });

    it('importMany skips unsupported formats with reasons', () => {
      writeFileSync(join(testDir, 'ok.cursorrules'), '# rules');
      writeFileSync(join(testDir, 'bad.txt'), 'nope');

      const result = discovery.importMany([join(testDir, 'ok.cursorrules'), join(testDir, 'bad.txt')], {
        name: 'imported-rule',
      });

      expect(result.imported).toHaveLength(1);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toContain('unsupported skill file format');
    });

    it('importMany skips duplicates', () => {
      writeFileSync(join(testDir, 'dup.cursorrules'), CURSOR_RULES_WITH_FM);
      const result = discovery.importMany([join(testDir, 'dup.cursorrules'), join(testDir, 'dup.cursorrules')]);
      expect(result.imported).toHaveLength(1);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toContain('already exists');
    });
  });
});
