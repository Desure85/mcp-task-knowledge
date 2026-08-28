/**
 * skills/skill-discovery.ts — Skill discovery + import (SK-003).
 *
 * Catalog, search, and import of skills from external formats:
 * - .cursorrules / awesome-cursorrules (Markdown + optional YAML frontmatter)
 * - SKILL.md (Agent Skills spec: frontmatter name/description + body)
 * - .clinerules (plain Markdown)
 *
 * Usage:
 *   const discovery = new SkillDiscovery(manager);
 *   discovery.categories();                       // [{ category, count }]
 *   discovery.byTag('code-review');
 *   discovery.importCursorRules(content, { name: 'ts-strict' });
 *   discovery.importFile('rules/ts-strict.cursorrules');
 */

import matter from 'gray-matter';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { childLogger } from '../core/logger.js';
import type { SkillManager } from './skill-manager.js';
import type { Skill } from './types.js';

const log = childLogger('skill-discovery');

// ─── Types ────────────────────────────────────────────────────────

export interface CategoryCount {
  category: string;
  count: number;
}

export interface SearchFilter {
  tag?: string;
  category?: string;
}

export interface ImportOptions {
  /** Name override (used when the file has no frontmatter name). */
  name?: string;
  /** Description override. */
  description?: string;
  /** Extra tags to add. */
  tags?: string[];
  /** Category to assign (overrides frontmatter.category). */
  category?: string;
  /** CreatedBy attribution. */
  createdBy?: string;
  /** Source URL (e.g., awesome-cursorrules path). */
  sourceUrl?: string;
}

export interface ImportResult {
  imported: Skill[];
  skipped: { file: string; reason: string }[];
}

/** Parsed skill content (frontmatter-aware). */
interface ParsedContent {
  name?: string;
  description?: string;
  body: string;
  frontmatter: Record<string, unknown>;
}

// ─── SkillDiscovery ───────────────────────────────────────────────

export class SkillDiscovery {
  private readonly manager: SkillManager;

  constructor(manager: SkillManager) {
    this.manager = manager;
  }

  /**
   * List categories with skill counts.
   * Category comes from frontmatter.category, falling back to first tag or 'uncategorized'.
   */
  categories(): CategoryCount[] {
    const counts = new Map<string, number>();
    for (const skill of this.manager.list()) {
      const category = this.categoryOf(skill);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  }

  /**
   * Catalog of skills grouped by category.
   */
  catalog(): Record<string, Skill[]> {
    const grouped: Record<string, Skill[]> = {};
    for (const skill of this.manager.list()) {
      const category = this.categoryOf(skill);
      (grouped[category] ??= []).push(skill);
    }
    return grouped;
  }

  /**
   * List skills by tag.
   */
  byTag(tag: string): Skill[] {
    return this.manager.list({ tag });
  }

  /**
   * Search skills by text, optionally filtered by tag or category.
   */
  search(query: string, filter?: SearchFilter): Skill[] {
    let skills = this.manager.search(query);
    if (filter?.tag) skills = skills.filter((s) => s.tags.includes(filter.tag!));
    if (filter?.category) skills = skills.filter((s) => this.categoryOf(s) === filter.category);
    return skills;
  }

  /**
   * Import a .cursorrules / awesome-cursorrules file content.
   */
  importCursorRules(content: string, options?: ImportOptions): Skill {
    const parsed = this.parseContent(content);
    const name = options?.name ?? parsed.name ?? 'cursor-rule';
    return this.manager.create({
      name,
      description: options?.description ?? parsed.description ?? 'Imported from .cursorrules',
      body: parsed.body,
      tags: this.resolveTags(parsed.frontmatter, options),
      frontmatter: this.resolveFrontmatter(parsed.frontmatter, options),
      createdBy: options?.createdBy,
    });
  }

  /**
   * Import a SKILL.md (Agent Skills spec) file content.
   */
  importSkillMd(content: string, options?: ImportOptions): Skill {
    const parsed = this.parseContent(content);
    const name = options?.name ?? parsed.name;
    if (!name) {
      throw new Error('[skill-discovery] SKILL.md requires a name (frontmatter or options)');
    }
    return this.manager.create({
      name,
      description: options?.description ?? parsed.description ?? 'Imported from SKILL.md',
      body: parsed.body,
      tags: this.resolveTags(parsed.frontmatter, options),
      frontmatter: this.resolveFrontmatter(parsed.frontmatter, options),
      createdBy: options?.createdBy,
    });
  }

  /**
   * Import a .clinerules file content (plain Markdown).
   */
  importClinerules(content: string, options?: ImportOptions): Skill {
    const parsed = this.parseContent(content);
    const name = options?.name ?? parsed.name ?? 'clinerule';
    return this.manager.create({
      name,
      description: options?.description ?? parsed.description ?? 'Imported from .clinerules',
      body: parsed.body,
      tags: this.resolveTags(parsed.frontmatter, options),
      frontmatter: this.resolveFrontmatter(parsed.frontmatter, options),
      createdBy: options?.createdBy,
    });
  }

  /**
   * Import a file, auto-detecting the format by extension/name.
   * Supported: .cursorrules, .clinerules, SKILL.md, .md (Agent Skills).
   */
  importFile(filePath: string, options?: ImportOptions): Skill {
    const content = readFileSync(filePath, 'utf8');
    const base = basename(filePath);

    if (base.endsWith('.cursorrules')) {
      return this.importCursorRules(content, { ...options, name: options?.name ?? base.replace(/\.cursorrules$/, '') });
    }
    if (base.endsWith('.clinerules')) {
      return this.importClinerules(content, { ...options, name: options?.name ?? base.replace(/\.clinerules$/, '') });
    }
    if (base === 'SKILL.md') {
      return this.importSkillMd(content, options);
    }
    if (base.endsWith('.md')) {
      return this.importSkillMd(content, { ...options, name: options?.name ?? base.replace(/\.md$/, '') });
    }
    throw new Error(`[skill-discovery] unsupported skill file format: ${filePath}`);
  }

  /**
   * Import many files at once, skipping failures with reasons.
   */
  importMany(filePaths: string[], options?: ImportOptions): ImportResult {
    const result: ImportResult = { imported: [], skipped: [] };
    for (const file of filePaths) {
      try {
        result.imported.push(this.importFile(file, options));
      } catch (err) {
        result.skipped.push({ file, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    return result;
  }

  // ─── Internal ───────────────────────────────────────────────────

  private categoryOf(skill: Skill): string {
    const raw = skill.frontmatter?.category;
    if (typeof raw === 'string' && raw) return raw;
    return skill.tags[0] ?? 'uncategorized';
  }

  private parseContent(content: string): ParsedContent {
    const { data, content: body } = matter(content);
    const name = typeof data.name === 'string' ? data.name : undefined;
    const description = typeof data.description === 'string' ? data.description : undefined;
    return { name, description, body: body.trim(), frontmatter: data };
  }

  private resolveTags(frontmatter: Record<string, unknown>, options?: ImportOptions): string[] {
    const tags: string[] = [];
    const raw = frontmatter.tags;
    if (Array.isArray(raw)) {
      for (const t of raw) {
        if (typeof t === 'string') tags.push(t);
      }
    }
    if (options?.category) tags.push(options.category);
    if (options?.tags) tags.push(...options.tags);
    return Array.from(new Set(tags));
  }

  private resolveFrontmatter(frontmatter: Record<string, unknown>, options?: ImportOptions): Record<string, unknown> {
    const fm: Record<string, unknown> = { ...frontmatter };
    delete fm.name;
    delete fm.description;
    if (options?.category) fm.category = options.category;
    if (options?.sourceUrl) fm.sourceUrl = options.sourceUrl;
    return fm;
  }
}
