/**
 * skills/skill-converters-claude-code.spec.ts — Claude Code plugin export (ADR-006)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillManager } from './skill-manager.js';
import { exportClaudeCodePlugin } from './skill-converters.js';
import matter from 'gray-matter';

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

// ─── Import tests (AI-012) ────────────────────────────────────────

import { importClaudeCodePlugin } from './skill-converters.js';
import { SkillDiscovery } from './skill-discovery.js';
import { writeFileSync as wfs, mkdirSync as mks } from 'node:fs';

describe('AI-012: Claude Code plugin import', () => {
  let pluginDir: string;
  let storageDir: string;

  beforeEach(() => {
    pluginDir = mkdtempSync(join(tmpdir(), 'cc-import-'));
    storageDir = mkdtempSync(join(tmpdir(), 'cc-import-skills-'));
    // Create a minimal plugin structure
    mks(join(pluginDir, '.claude-plugin'), { recursive: true });
    wfs(join(pluginDir, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'test-plugin',
      description: 'Test plugin for import',
      version: '1.0.0',
    }));
    mks(join(pluginDir, 'skills', 'my-skill'), { recursive: true });
    wfs(join(pluginDir, 'skills', 'my-skill', 'SKILL.md'),
      matter.stringify('Do the thing.', { name: 'my-skill', description: 'A test skill' }));
  });

  afterEach(() => {
    rmSync(pluginDir, { recursive: true, force: true });
    rmSync(storageDir, { recursive: true, force: true });
  });

  it('imports a plugin with skills', () => {
    const mgr = new SkillManager({ storagePath: storageDir });
    const discovery = new SkillDiscovery(mgr);
    const result = importClaudeCodePlugin(discovery, pluginDir);
    expect(result.pluginName).toBe('test-plugin');
    expect(result.imported).toBe(1);
    expect(result.skills).toContain('my-skill');
    expect(result.errors).toEqual([]);
  });

  it('returns error when no plugin.json', () => {
    rmSync(join(pluginDir, '.claude-plugin'), { recursive: true, force: true });
    const mgr = new SkillManager({ storagePath: storageDir });
    const discovery = new SkillDiscovery(mgr);
    const result = importClaudeCodePlugin(discovery, pluginDir);
    expect(result.imported).toBe(0);
    expect(result.errors[0]).toContain('plugin.json');
  });

  it('returns error when no skills directory', () => {
    rmSync(join(pluginDir, 'skills'), { recursive: true, force: true });
    const mgr = new SkillManager({ storagePath: storageDir });
    const discovery = new SkillDiscovery(mgr);
    const result = importClaudeCodePlugin(discovery, pluginDir);
    expect(result.imported).toBe(0);
    expect(result.errors[0]).toContain('skills/');
  });

  it('round-trips: export then import gives same skills', () => {
    const exportMgr = new SkillManager({ storagePath: mkdtempSync(join(tmpdir(), 'rt-export-')) });
    exportMgr.create({ name: 'Round Trip', description: 'RT test', body: 'Round trip body.' });
    const exportDir = mkdtempSync(join(tmpdir(), 'rt-plugin-'));
    exportClaudeCodePlugin(exportMgr, exportDir);

    const rtMgr = new SkillManager({ storagePath: mkdtempSync(join(tmpdir(), 'rt-import-')) });
    const discovery = new SkillDiscovery(rtMgr);
    const result = importClaudeCodePlugin(discovery, exportDir);
    expect(result.imported).toBe(1);
    expect(result.skills).toContain('round-trip');
  });
});
