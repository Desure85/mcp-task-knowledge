/**
 * rules/rule-import.ts — Rule import (RL-006).
 *
 * Import rules from external formats into the rules store (RL-001):
 * .cursorrules, CLAUDE.md, .clinerules, .windsurfrules.
 * Frontmatter-aware parsing (gray-matter); formats without frontmatter
 * fall back to options (name/description).
 *
 * Usage:
 *   const importer = new RuleImporter(manager);
 *   importer.importCursorRules(content, { name: 'ts-strict' });
 *   importer.importFile('rules/ts-strict.cursorrules');
 */

import matter from 'gray-matter';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { childLogger } from '../core/logger.js';
import type { RuleManager } from './rule-manager.js';
import type { Rule, RuleScope, RuleSeverity } from './types.js';

const log = childLogger('rule-import');

// ─── Types ────────────────────────────────────────────────────────

export interface RuleImportOptions {
  /** Name override (used when the file has no frontmatter name). */
  name?: string;
  /** Description override. */
  description?: string;
  /** Rule scope. Default: 'project'. */
  scope?: RuleScope;
  /** Severity. Default: 'warn'. */
  severity?: RuleSeverity;
  /** Extra tags. */
  tags?: string[];
  /** Source URL (e.g., awesome-cursorrules path). */
  sourceUrl?: string;
}

export interface RuleImportResult {
  imported: Rule[];
  skipped: { file: string; reason: string }[];
}

/** Parsed rule content (frontmatter-aware). */
interface ParsedContent {
  name?: string;
  description?: string;
  body: string;
  frontmatter: Record<string, unknown>;
}

// ─── RuleImporter ─────────────────────────────────────────────────

export class RuleImporter {
  private readonly manager: RuleManager;

  constructor(manager: RuleManager) {
    this.manager = manager;
  }

  /**
   * Import a .cursorrules file content.
   */
  importCursorRules(content: string, options?: RuleImportOptions): Rule {
    return this.createRule(content, options, { defaultName: 'cursor-rule' });
  }

  /**
   * Import a CLAUDE.md file content.
   */
  importClaudeMd(content: string, options?: RuleImportOptions): Rule {
    return this.createRule(content, options, { defaultName: 'claude-md' });
  }

  /**
   * Import a .clinerules file content.
   */
  importClinerules(content: string, options?: RuleImportOptions): Rule {
    return this.createRule(content, options, { defaultName: 'clinerule' });
  }

  /**
   * Import a .windsurfrules file content.
   */
  importWindsurfRules(content: string, options?: RuleImportOptions): Rule {
    return this.createRule(content, options, { defaultName: 'windsurf-rule' });
  }

  /**
   * Import a file, auto-detecting the format by file name.
   */
  importFile(filePath: string, options?: RuleImportOptions): Rule {
    const content = readFileSync(filePath, 'utf8');
    const base = basename(filePath);

    // CLAUDE.md keeps its default name (no extension stripping)
    if (base.toLowerCase() === 'claude.md') {
      return this.importClaudeMd(content, options);
    }

    const opts = { ...options, name: options?.name ?? base.replace(/\.(cursorrules|clinerules|windsurfrules|md)$/i, '') };

    if (base.endsWith('.cursorrules')) return this.importCursorRules(content, opts);
    if (base.endsWith('.clinerules')) return this.importClinerules(content, opts);
    if (base.endsWith('.windsurfrules')) return this.importWindsurfRules(content, opts);
    if (base.endsWith('.md')) return this.importClaudeMd(content, opts);
    throw new Error(`[rule-import] unsupported rule file format: ${filePath}`);
  }

  /**
   * Import many files at once, skipping failures with reasons.
   */
  importMany(filePaths: string[], options?: RuleImportOptions): RuleImportResult {
    const result: RuleImportResult = { imported: [], skipped: [] };
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

  private createRule(
    content: string,
    options?: RuleImportOptions,
    fallback?: { defaultName: string },
  ): Rule {
    const parsed = this.parseContent(content);
    const name = options?.name ?? parsed.name ?? fallback?.defaultName ?? 'imported-rule';
    const scope = options?.scope ?? this.scopeField(parsed.frontmatter) ?? 'project';
    const severity = options?.severity ?? this.severityField(parsed.frontmatter) ?? 'warn';

    const frontmatter: Record<string, unknown> = { ...parsed.frontmatter };
    delete frontmatter.name;
    delete frontmatter.description;
    if (options?.sourceUrl) frontmatter.sourceUrl = options.sourceUrl;

    return this.manager.create({
      name,
      description: options?.description ?? parsed.description ?? `Imported from ${fallback?.defaultName ?? 'external format'}`,
      scope,
      severity,
      body: parsed.body,
      tags: this.resolveTags(parsed.frontmatter, options),
      frontmatter,
    });
  }

  private parseContent(content: string): ParsedContent {
    const { data, content: body } = matter(content);
    const name = typeof data.name === 'string' ? data.name : undefined;
    const description = typeof data.description === 'string' ? data.description : undefined;
    return { name, description, body: body.trim(), frontmatter: data };
  }

  private scopeField(fm: Record<string, unknown>): RuleScope | undefined {
    const raw = fm.scope;
    if (raw === 'global' || raw === 'project' || raw === 'user') return raw;
    return undefined;
  }

  private severityField(fm: Record<string, unknown>): RuleSeverity | undefined {
    const raw = fm.severity;
    if (raw === 'error' || raw === 'warn' || raw === 'info') return raw;
    return undefined;
  }

  private resolveTags(frontmatter: Record<string, unknown>, options?: RuleImportOptions): string[] {
    const tags: string[] = [];
    const raw = frontmatter.tags;
    if (Array.isArray(raw)) {
      for (const t of raw) {
        if (typeof t === 'string') tags.push(t);
      }
    }
    if (options?.tags) tags.push(...options.tags);
    return Array.from(new Set(tags));
  }
}
