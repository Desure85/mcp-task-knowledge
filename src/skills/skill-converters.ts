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
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { childLogger } from '../core/logger.js';
import type { Skill } from './types.js';
import type { SkillManager } from './skill-manager.js';

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
