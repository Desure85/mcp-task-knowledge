/**
 * skills/skill-converters.ts — Skill sharing + format converters (SK-005).
 *
 * Convert skills between formats:
 *   - .cursorrules  (Markdown + YAML frontmatter)
 *   - SKILL.md      (Agent Skills spec: frontmatter name/description + body)
 *   - .clinerules   (plain Markdown)
 *   - our Markdown  (frontmatter + body — roundtrip with SkillDiscovery import)
 *
 * Git-native storage: exportSkills writes one file per skill into a directory
 * that can be committed alongside the code.
 *
 * Usage:
 *   const text = toCursorRules(skill);
 *   const files = exportSkills(manager, 'cursorrules', 'skills/rules');
 */

import matter from 'gray-matter';
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync as readSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { childLogger } from '../core/logger.js';
import type { Skill } from './types.js';
import type { SkillManager } from './skill-manager.js';
import type { SkillDiscovery } from './skill-discovery.js';

const log = childLogger('skill-converters');

// ─── Types ────────────────────────────────────────────────────────

export type SkillExportFormat = 'cursorrules' | 'skill-md' | 'clinerules' | 'markdown';

export interface ExportResult {
  /** Files written (relative to the export dir). */
  files: string[];
}

// ─── Converters ───────────────────────────────────────────────────

function frontmatterOf(skill: Skill, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: skill.name,
    description: skill.description,
    ...extra,
    ...(Object.keys(skill.frontmatter ?? {}).length > 0 ? skill.frontmatter : {}),
  };
}

/**
 * Convert a skill to .cursorrules format (frontmatter + body).
 */
export function toCursorRules(skill: Skill): string {
  return matter.stringify(skill.body, frontmatterOf(skill, { tags: skill.tags }));
}

/**
 * Convert a skill to SKILL.md (Agent Skills spec) format.
 */
export function toSkillMd(skill: Skill): string {
  return matter.stringify(skill.body, frontmatterOf(skill));
}

/**
 * Convert a skill to .clinerules format (plain Markdown, description header).
 */
export function toClinerules(skill: Skill): string {
  const lines: string[] = [];
  if (skill.description) {
    lines.push(`# ${skill.description}`);
    lines.push('');
  }
  lines.push(skill.body);
  return lines.join('\n');
}

/**
 * Convert a skill to our Markdown format (frontmatter + body) — the canonical
 * format that SkillDiscovery.importSkillMd / importCursorRules can read back.
 */
export function toMarkdown(skill: Skill): string {
  return matter.stringify(skill.body, frontmatterOf(skill, { tags: skill.tags }));
}

/**
 * Convert a skill to the requested format.
 */
export function convertSkill(skill: Skill, format: SkillExportFormat): string {
  switch (format) {
    case 'cursorrules':
      return toCursorRules(skill);
    case 'skill-md':
      return toSkillMd(skill);
    case 'clinerules':
      return toClinerules(skill);
    case 'markdown':
      return toMarkdown(skill);
    default:
      throw new Error(`[skill-converters] unknown export format: ${String(format)}`);
  }
}

/**
 * File name for a skill in the given format.
 * SKILL.md files live in a per-skill subdirectory (Agent Skills convention).
 */
export function fileNameFor(skill: Skill, format: SkillExportFormat): string {
  switch (format) {
    case 'cursorrules':
      return `${skill.id}.cursorrules`;
    case 'skill-md':
      return join(skill.id, 'SKILL.md');
    case 'clinerules':
      return `${skill.id}.clinerules`;
    case 'markdown':
      return `${skill.id}.md`;
    default:
      throw new Error(`[skill-converters] unknown export format: ${String(format)}`);
  }
}

/**
 * Export all skills to a directory in the given format (git-native storage).
 */
export function exportSkills(
  manager: SkillManager,
  format: SkillExportFormat,
  dir: string,
): ExportResult {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const files: string[] = [];
  for (const skill of manager.list()) {
    const relative = fileNameFor(skill, format);
    const filePath = join(dir, relative);
    const fileDir = dirname(filePath);
    if (!existsSync(fileDir)) mkdirSync(fileDir, { recursive: true });
    writeFileSync(filePath, convertSkill(skill, format), 'utf8');
    files.push(relative);
  }
  log.info({ format, count: files.length }, 'skills exported');
  return { files };
}

// ─── Claude Code Plugin packaging (ADR-006) ──────────────────────

export interface ClaudeCodePluginManifest {
  name: string;
  description: string;
  version: string;
  author?: { name: string };
  homepage?: string;
  repository?: string;
  license?: string;
}

/**
 * Export all skills as a Claude Code plugin directory structure:
 *   <dir>/
 *     .claude-plugin/plugin.json
 *     skills/<id>/SKILL.md
 *     README.md (optional)
 */
export function exportClaudeCodePlugin(
  manager: SkillManager,
  dir: string,
  manifest: Partial<ClaudeCodePluginManifest> = {},
): ExportResult {
  const skills = manager.list();
  if (skills.length === 0) {
    return { files: [] };
  }

  // .claude-plugin/plugin.json
  const pluginDir = join(dir, '.claude-plugin');
  if (!existsSync(pluginDir)) mkdirSync(pluginDir, { recursive: true });
  const pluginManifest: ClaudeCodePluginManifest = {
    name: manifest.name ?? 'mcp-task-knowledge-skills',
    description: manifest.description ?? `Plugin with ${skills.length} skills from mcp-task-knowledge`,
    version: manifest.version ?? '1.0.0',
    author: manifest.author ?? { name: 'mcp-task-knowledge' },
  };
  const manifestPath = join(pluginDir, 'plugin.json');
  writeFileSync(manifestPath, JSON.stringify(pluginManifest, null, 2), 'utf8');

  // skills/<id>/SKILL.md
  const files: string[] = ['.claude-plugin/plugin.json'];
  for (const skill of skills) {
    const skillDir = join(dir, 'skills', skill.id);
    if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });
    const skillPath = join(skillDir, 'SKILL.md');
    writeFileSync(skillPath, toSkillMd(skill), 'utf8');
    files.push(`skills/${skill.id}/SKILL.md`);
  }

  // README.md
  const readme = [
    `# ${pluginManifest.name}`,
    '',
    pluginManifest.description,
    '',
    `## Skills (${skills.length})`,
    '',
    ...skills.map((s) => `- **${s.id}**: ${s.description ?? s.name}`),
    '',
    '## Installation',
    '',
    '```bash',
    `claude --plugin-dir ./${pluginManifest.name}`,
    '```',
    '',
    'Or install from marketplace (see Claude Code docs).',
  ].join('\n');
  writeFileSync(join(dir, 'README.md'), readme, 'utf8');
  files.push('README.md');

  log.info({ plugin: pluginManifest.name, skills: skills.length }, 'Claude Code plugin exported');
  return { files };
}

// ─── Claude Code Plugin import (AI-012) ──────────────────────────

export interface PluginImportResult {
  pluginName: string;
  imported: number;
  skills: string[];
  errors: string[];
}

/**
 * Import a Claude Code plugin directory into our skill storage.
 * Reads .claude-plugin/plugin.json + skills/<name>/SKILL.md.
 */
export function importClaudeCodePlugin(
  discovery: SkillDiscovery,
  pluginDir: string,
): PluginImportResult {
  const result: PluginImportResult = { pluginName: '', imported: 0, skills: [], errors: [] };

  // Read manifest
  const manifestPath = join(pluginDir, '.claude-plugin', 'plugin.json');
  if (!existsSync(manifestPath)) {
    result.errors.push('no .claude-plugin/plugin.json found');
    return result;
  }
  try {
    const manifest = JSON.parse(readSync(manifestPath, 'utf8'));
    result.pluginName = manifest.name ?? 'unknown-plugin';
  } catch {
    result.errors.push('invalid plugin.json');
    return result;
  }

  // Scan skills/ directory
  const skillsDir = join(pluginDir, 'skills');
  if (!existsSync(skillsDir)) {
    result.errors.push('no skills/ directory');
    return result;
  }

  const entries = readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMdPath = join(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(skillMdPath)) continue;
    try {
      const content = readSync(skillMdPath, 'utf8');
      const skill = discovery.importSkillMd(content, { name: entry.name });
      result.skills.push(skill.id);
      result.imported++;
    } catch (e) {
      result.errors.push(`failed to import ${entry.name}: ${(e as Error).message}`);
    }
  }

  log.info({ plugin: result.pluginName, imported: result.imported }, 'Claude Code plugin imported');
  return result;
}
