/**
 * rules/rule-import.spec.ts — Tests for rule import (RL-006).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RuleManager } from './rule-manager.js';
import { RuleImporter } from './rule-import.js';
import { RuleEvaluator } from './rule-evaluator.js';

let testDir: string;
let manager: RuleManager;
let importer: RuleImporter;

const CURSOR_RULES_WITH_FM = `---
name: ts-strict
description: Strict TypeScript rules
tags: [typescript, strict]
severity: error
---
Always use strict mode.
No implicit any.
`;

const CLAUDE_MD = `# Project Rules

No console.log in production.
Prefer named exports.
`;

const CLINE_RULES = `No console.log in production.
Prefer named exports.`;

const WINDSURF_RULES = `---
description: Windsurf project rules
---
Use tabs for indentation.
`;

describe('RL-006: RuleImporter', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `rule-imp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    manager = new RuleManager({ storagePath: testDir });
    importer = new RuleImporter(manager);
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('importCursorRules()', () => {
    it('parses frontmatter and body into a rule', () => {
      const rule = importer.importCursorRules(CURSOR_RULES_WITH_FM);
      expect(rule.id).toBe('project:ts-strict');
      expect(rule.description).toBe('Strict TypeScript rules');
      expect(rule.severity).toBe('error');
      expect(rule.tags).toEqual(expect.arrayContaining(['typescript', 'strict']));
      expect(rule.body).toContain('No implicit any.');
    });

    it('uses option name when no frontmatter name', () => {
      const rule = importer.importCursorRules('# Plain rules\nNo any.', { name: 'plain-rules' });
      expect(rule.id).toBe('project:plain-rules');
      expect(rule.body).toContain('No any.');
    });

    it('honors scope and severity options', () => {
      const rule = importer.importCursorRules(CURSOR_RULES_WITH_FM, { scope: 'global', severity: 'warn' });
      expect(rule.id).toBe('global:ts-strict');
      expect(rule.severity).toBe('warn');
    });

    it('imported deny frontmatter is enforceable via RuleEvaluator', () => {
      importer.importCursorRules(`---
name: no-danger
tags: [security]
severity: error
---
No dangerous commands.
`);
      // Import with deny patterns through a follow-up update
      const ruleId = 'project:no-danger';
      manager.update(ruleId, {
        frontmatter: { deny: ['rm\\s+-rf'], message: 'dangerous command' },
      });

      const evaluator = new RuleEvaluator(manager);
      const result = evaluator.evaluateInput('project', 'exec', { command: 'rm -rf /' });
      expect(result.blocked).toBe(true);
      expect(result.violations[0].message).toContain('dangerous command');
    });
  });

  describe('importClaudeMd()', () => {
    it('imports plain markdown with default name', () => {
      const rule = importer.importClaudeMd(CLAUDE_MD);
      expect(rule.id).toBe('project:claude-md');
      expect(rule.body).toContain('No console.log in production.');
    });

    it('uses option name', () => {
      const rule = importer.importClaudeMd(CLAUDE_MD, { name: 'project-rules' });
      expect(rule.id).toBe('project:project-rules');
    });
  });

  describe('importClinerules() / importWindsurfRules()', () => {
    it('imports .clinerules content', () => {
      const rule = importer.importClinerules(CLINE_RULES, { name: 'clines' });
      expect(rule.id).toBe('project:clines');
      expect(rule.body).toContain('Prefer named exports.');
    });

    it('imports .windsurfrules content with frontmatter', () => {
      const rule = importer.importWindsurfRules(WINDSURF_RULES);
      expect(rule.id).toBe('project:windsurf-rule');
      expect(rule.description).toBe('Windsurf project rules');
      expect(rule.body).toContain('Use tabs for indentation.');
    });
  });

  describe('importFile() / importMany()', () => {
    it('auto-detects format by file name', () => {
      writeFileSync(join(testDir, 'ts-strict.cursorrules'), CURSOR_RULES_WITH_FM);
      writeFileSync(join(testDir, 'CLAUDE.md'), CLAUDE_MD);
      writeFileSync(join(testDir, 'my.clinerules'), CLINE_RULES);
      writeFileSync(join(testDir, 'ws.windsurfrules'), WINDSURF_RULES);

      const a = importer.importFile(join(testDir, 'ts-strict.cursorrules'));
      const b = importer.importFile(join(testDir, 'CLAUDE.md'));
      const c = importer.importFile(join(testDir, 'my.clinerules'));
      const d = importer.importFile(join(testDir, 'ws.windsurfrules'));

      expect(a.id).toBe('project:ts-strict');
      expect(b.id).toBe('project:claude-md');
      expect(c.id).toBe('project:my');
      expect(d.id).toBe('project:ws');
      expect(manager.count).toBe(4);
    });

    it('importMany skips unsupported formats with reasons', () => {
      writeFileSync(join(testDir, 'ok.cursorrules'), '# rules');
      writeFileSync(join(testDir, 'bad.txt'), 'nope');

      const result = importer.importMany([join(testDir, 'ok.cursorrules'), join(testDir, 'bad.txt')], {
        name: 'imported-rule',
      });
      expect(result.imported).toHaveLength(1);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toContain('unsupported rule file format');
    });

    it('importMany skips duplicates', () => {
      writeFileSync(join(testDir, 'dup.cursorrules'), CURSOR_RULES_WITH_FM);
      const result = importer.importMany([join(testDir, 'dup.cursorrules'), join(testDir, 'dup.cursorrules')]);
      expect(result.imported).toHaveLength(1);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toContain('already exists');
    });
  });
});
