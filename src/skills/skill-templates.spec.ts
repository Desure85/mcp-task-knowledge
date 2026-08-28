/**
 * skills/skill-templates.spec.ts — Tests for skill templates (SK-004).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SkillManager } from './skill-manager.js';
import { SkillPipeline } from './skill-pipeline.js';
import {
  skillTemplates, listSkillTemplates, getSkillTemplate,
  buildSkillFromTemplate, installSkillFromTemplate,
} from './skill-templates.js';

let testDir: string;
let manager: SkillManager;

describe('SK-004: Skill templates', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `skill-tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    manager = new SkillManager({ storagePath: testDir });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('listSkillTemplates()', () => {
    it('returns all 6 built-in templates', () => {
      const templates = listSkillTemplates();
      expect(templates.map((t) => t.id).sort()).toEqual([
        'architecture-review', 'code-review', 'debug',
        'deploy', 'refactor', 'test-gen',
      ]);
    });
  });

  describe('getSkillTemplate()', () => {
    it('returns a template by id', () => {
      const t = getSkillTemplate('code-review');
      expect(t).toBeDefined();
      expect(t!.name).toBe('Code Review');
      expect(t!.category).toBe('quality');
    });

    it('returns undefined for unknown id', () => {
      expect(getSkillTemplate('nope')).toBeUndefined();
    });
  });

  describe('buildSkillFromTemplate()', () => {
    it('throws on unknown template id', () => {
      expect(() => buildSkillFromTemplate('nope')).toThrow(/template not found/);
    });

    it('builds a valid CreateSkillInput for every template', () => {
      for (const t of skillTemplates) {
        const input = buildSkillFromTemplate(t.id);
        expect(input.name).toBe(t.id);
        expect(input.description.length).toBeGreaterThan(0);
        expect(input.body.length).toBeGreaterThan(0);
        expect(input.tags).toBeDefined();
        expect(input.frontmatter?.category).toBe(t.category);
      }
    });

    it('interpolates params into the body', () => {
      const input = buildSkillFromTemplate('test-gen', { framework: 'jest' });
      expect(input.body).toContain('jest');
      expect(input.body).not.toContain('vitest');
    });

    it('falls back to defaults when params are missing', () => {
      const input = buildSkillFromTemplate('test-gen');
      expect(input.body).toContain('vitest');
    });

    it('templates are renderable by SkillPipeline', async () => {
      const pipe = new SkillPipeline(manager);
      for (const t of skillTemplates) {
        const skill = installSkillFromTemplate(manager, t.id);
        const result = await pipe.invoke(skill.id, {
          arguments: { files: 'src/index.ts' },
          variables: { language: 'typescript', env: 'staging' },
        });
        expect(result.ok).toBe(true);
        expect(result.output.length).toBeGreaterThan(0);
        expect(result.fork).toBe(false);
      }
    });
  });

  describe('installSkillFromTemplate()', () => {
    it('creates a real skill via the manager', () => {
      const skill = installSkillFromTemplate(manager, 'deploy', { env: 'staging' });
      expect(skill.id).toBe('deploy');
      expect(skill.status).toBe('draft');
      expect(skill.body).toContain('staging');
      expect(manager.get('deploy')).toBeDefined();
    });

    it('throws on duplicate install', () => {
      installSkillFromTemplate(manager, 'debug');
      expect(() => installSkillFromTemplate(manager, 'debug')).toThrow(/already exists/);
    });

    it('throws on unknown template id', () => {
      expect(() => installSkillFromTemplate(manager, 'nope')).toThrow(/template not found/);
    });
  });
});
