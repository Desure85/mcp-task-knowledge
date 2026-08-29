/**
 * skills/skill-converters-claude-code.spec.ts — Claude Code plugin export (ADR-006)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillManager } from './skill-manager.js';
import { exportClaudeCodePlugin } from './skill-converters.js';

describe('ADR-006: Claude Code plugin export', () => {
  let dir: string;
  let manager: SkillManager;
  let storageDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cc-plugin-'));
    storageDir = mkdtempSync(join(tmpdir(), 'cc-skills-'));
    manager = new SkillManager({ storagePath: storageDir });
    manager.create({ name: 'Code Review', description: 'Reviews code', body: 'Check for issues.' });
    manager.create({ name: 'Deploy Check', description: 'Pre-deploy validation', body: 'Verify config.' });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(storageDir, { recursive: true, force: true });
  });

  it('generates .claude-plugin/plugin.json manifest', () => {
    exportClaudeCodePlugin(manager, dir);
    const manifest = JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'));
    expect(manifest.name).toBe('mcp-task-knowledge-skills');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.description).toContain('2 skills');
  });

  it('generates skills/<id>/SKILL.md for each skill', () => {
    const result = exportClaudeCodePlugin(manager, dir);
    expect(existsSync(join(dir, 'skills', 'code-review', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, 'skills', 'deploy-check', 'SKILL.md'))).toBe(true);
    expect(result.files).toContain('skills/code-review/SKILL.md');
    expect(result.files).toContain('skills/deploy-check/SKILL.md');
  });

  it('SKILL.md contains frontmatter with description', () => {
    exportClaudeCodePlugin(manager, dir);
    const content = readFileSync(join(dir, 'skills', 'code-review', 'SKILL.md'), 'utf8');
    expect(content).toContain('description:');
    expect(content).toContain('Reviews code');
    expect(content).toContain('Check for issues.');
  });

  it('generates README.md with skill list', () => {
    const result = exportClaudeCodePlugin(manager, dir);
    expect(result.files).toContain('README.md');
    const readme = readFileSync(join(dir, 'README.md'), 'utf8');
    expect(readme).toContain('mcp-task-knowledge-skills');
    expect(readme).toContain('code-review');
    expect(readme).toContain('deploy-check');
  });

  it('custom manifest overrides defaults', () => {
    exportClaudeCodePlugin(manager, dir, {
      name: 'my-team-skills',
      description: 'Custom team plugin',
      version: '2.0.0',
    });
    const manifest = JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'));
    expect(manifest.name).toBe('my-team-skills');
    expect(manifest.version).toBe('2.0.0');
    expect(manifest.description).toBe('Custom team plugin');
  });

  it('empty skill list returns empty files', () => {
    const empty = new SkillManager({ storagePath: mkdtempSync(join(tmpdir(), 'cc-empty-')) });
    const result = exportClaudeCodePlugin(empty, dir);
    expect(result.files).toEqual([]);
  });
});
