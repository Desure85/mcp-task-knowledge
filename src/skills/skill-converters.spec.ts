/**
 * skills/skill-converters.spec.ts — Tests for skill converters (SK-005).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { SkillManager } from './skill-manager.js';
import { SkillDiscovery } from './skill-discovery.js';
import {
  toCursorRules, toSkillMd, toClinerules, toMarkdown,
  convertSkill, fileNameFor, exportSkills,
} from './skill-converters.js';
import type { Skill } from './types.js';

let testDir: string;
let manager: SkillManager;
let skill: Skill;

function seedSkill(): Skill {
  return manager.create({
    name: 'code-review',
    description: 'Review code for quality',
    body: 'Check error handling.\nVerify tests.',
    tags: ['quality', 'review'],
    frontmatter: { category: 'quality', triggers: ['code review'] },
  });
}

describe('SK-005: Skill converters', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `skill-conv-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    manager = new SkillManager({ storagePath: testDir });
    skill = seedSkill();
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('toCursorRules()', () => {
    it('emits frontmatter with name/description/tags and the body', () => {
      const text = toCursorRules(skill);
      const parsed = matter(text);
      expect(parsed.data.name).toBe('code-review');
      expect(parsed.data.description).toBe('Review code for quality');
      expect(parsed.data.tags).toEqual(['quality', 'review']);
      expect(parsed.content.trim()).toContain('Check error handling.');
    });

    it('roundtrips through SkillDiscovery.importCursorRules', () => {
      const text = toCursorRules(skill);
      const fresh = new SkillManager({ storagePath: join(testDir, 'fresh-1') });
      const imported = new SkillDiscovery(fresh).importCursorRules(text);
      expect(imported.id).toBe('code-review');
      expect(imported.body).toBe(skill.body);
      expect(imported.tags).toEqual(expect.arrayContaining(['quality', 'review']));
    });
  });

  describe('toSkillMd()', () => {
    it('emits Agent Skills frontmatter (name + description)', () => {
      const text = toSkillMd(skill);
      const parsed = matter(text);
      expect(parsed.data.name).toBe('code-review');
      expect(parsed.data.description).toBe('Review code for quality');
      expect(parsed.content.trim()).toContain('Verify tests.');
    });

    it('roundtrips through SkillDiscovery.importSkillMd', () => {
      const text = toSkillMd(skill);
      const fresh = new SkillManager({ storagePath: join(testDir, 'fresh-2') });
      const imported = new SkillDiscovery(fresh).importSkillMd(text);
      expect(imported.id).toBe('code-review');
      expect(imported.description).toBe('Review code for quality');
    });
  });

  describe('toClinerules()', () => {
    it('emits plain markdown with a description header', () => {
      const text = toClinerules(skill);
      expect(text).toContain('# Review code for quality');
      expect(text).toContain('Check error handling.');
      // No frontmatter
      expect(text.startsWith('---')).toBe(false);
    });
  });

  describe('toMarkdown()', () => {
    it('preserves the full skill (frontmatter + body + tags)', () => {
      const text = toMarkdown(skill);
      const parsed = matter(text);
      expect(parsed.data.name).toBe('code-review');
      expect(parsed.data.tags).toEqual(['quality', 'review']);
      expect(parsed.data.category).toBe('quality');
      expect(parsed.data.triggers).toEqual(['code review']);
      expect(parsed.content.trim()).toBe(skill.body);
    });
  });

  describe('convertSkill() / fileNameFor()', () => {
    it('converts by format', () => {
      expect(convertSkill(skill, 'cursorrules')).toBe(toCursorRules(skill));
      expect(convertSkill(skill, 'skill-md')).toBe(toSkillMd(skill));
      expect(convertSkill(skill, 'clinerules')).toBe(toClinerules(skill));
      expect(convertSkill(skill, 'markdown')).toBe(toMarkdown(skill));
    });

    it('throws on unknown format', () => {
      expect(() => convertSkill(skill, 'nope' as never)).toThrow(/unknown export format/);
    });

    it('computes file names per format', () => {
      expect(fileNameFor(skill, 'cursorrules')).toBe('code-review.cursorrules');
      expect(fileNameFor(skill, 'skill-md')).toBe(join('code-review', 'SKILL.md'));
      expect(fileNameFor(skill, 'clinerules')).toBe('code-review.clinerules');
      expect(fileNameFor(skill, 'markdown')).toBe('code-review.md');
    });
  });

  describe('exportSkills()', () => {
    it('writes one file per skill in the requested format', () => {
      const exportDir = join(testDir, 'exported');
      const result = exportSkills(manager, 'cursorrules', exportDir);

      expect(result.files).toEqual(['code-review.cursorrules']);
      expect(existsSync(join(exportDir, 'code-review.cursorrules'))).toBe(true);
      const content = readFileSync(join(exportDir, 'code-review.cursorrules'), 'utf8');
      expect(content).toContain('Check error handling.');
    });

    it('writes SKILL.md files into per-skill subdirectories', () => {
      const exportDir = join(testDir, 'exported');
      exportSkills(manager, 'skill-md', exportDir);
      expect(existsSync(join(exportDir, 'code-review', 'SKILL.md'))).toBe(true);
    });

    it('exported skills can be re-imported (git-native roundtrip)', () => {
      const exportDir = join(testDir, 'exported');
      exportSkills(manager, 'markdown', exportDir);

      const fresh = new SkillManager({ storagePath: join(testDir, 'fresh') });
      const discovery = new SkillDiscovery(fresh);
      const imported = discovery.importFile(join(exportDir, 'code-review.md'));
      expect(imported.name).toBe('code-review');
      expect(imported.body).toBe(skill.body);
      expect(imported.tags).toEqual(['quality', 'review']);
    });
  });
});
