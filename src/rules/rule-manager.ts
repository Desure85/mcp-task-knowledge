/**
 * rules/rule-manager.ts — Rules storage with hierarchy (RL-001).
 *
 * Hierarchical rules: global → project → user.
 * Inheritance: child rules can override parent rules.
 * Format: Markdown + YAML frontmatter.
 *
 * Storage: JSON file on disk (default: .rules/rules.json)
 *
 * Usage:
 *   const mgr = new RuleManager({ storagePath: '.rules' });
 *   mgr.create({ name: 'no-console', scope: 'global', body: 'No console.log' });
 *   mgr.create({ name: 'no-console', scope: 'project', body: 'Allow console.error', parentId: 'no-console' });
 *   const effective = mgr.getEffectiveRules('project');
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { childLogger } from '../core/logger.js';
import type { Rule, CreateRuleInput, UpdateRuleInput, RuleScope, RuleStatus } from './types.js';

const log = childLogger('rule-manager');

// ─── Storage ──────────────────────────────────────────────────────

interface RuleStorage {
  rules: Record<string, Rule>;
}

// Scope priority: global < project < user
const SCOPE_PRIORITY: Record<RuleScope, number> = {
  global: 0,
  project: 1,
  user: 2,
};

// ─── RuleManager ──────────────────────────────────────────────────

export class RuleManager {
  private readonly storagePath: string;
  private readonly filePath: string;
  private storage: RuleStorage;

  constructor(options?: { storagePath?: string }) {
    this.storagePath = options?.storagePath ?? '.rules';
    this.filePath = join(this.storagePath, 'rules.json');
    this.storage = this.load();
  }

  /**
   * Create a new rule.
   */
  create(input: CreateRuleInput): Rule {
    const id = this.makeId(input.scope, input.name);
    if (this.storage.rules[id]) {
      throw new Error(`[rule-manager] rule already exists: ${id}`);
    }

    const now = new Date().toISOString();
    const rule: Rule = {
      id,
      name: input.name,
      description: input.description,
      scope: input.scope,
      severity: input.severity ?? 'warn',
      body: input.body,
      tags: input.tags ?? [],
      status: 'active',
      frontmatter: input.frontmatter ?? {},
      createdAt: now,
      updatedAt: now,
      parentId: input.parentId,
    };

    this.storage.rules[id] = rule;
    this.save();
    log.info({ id, scope: input.scope }, 'rule created');
    return rule;
  }

  /**
   * Get a rule by ID.
   */
  get(id: string): Rule | undefined {
    return this.storage.rules[id];
  }

  /**
   * Update a rule.
   */
  update(id: string, input: UpdateRuleInput): Rule {
    const rule = this.storage.rules[id];
    if (!rule) {
      throw new Error(`[rule-manager] rule not found: ${id}`);
    }

    if (input.name !== undefined) rule.name = input.name;
    if (input.description !== undefined) rule.description = input.description;
    if (input.scope !== undefined) rule.scope = input.scope;
    if (input.severity !== undefined) rule.severity = input.severity;
    if (input.body !== undefined) rule.body = input.body;
    if (input.tags !== undefined) rule.tags = input.tags;
    if (input.status !== undefined) rule.status = input.status;
    if (input.frontmatter !== undefined) rule.frontmatter = input.frontmatter;
    if (input.parentId !== undefined) rule.parentId = input.parentId;
    rule.updatedAt = new Date().toISOString();

    this.save();
    log.info({ id }, 'rule updated');
    return rule;
  }

  /**
   * Delete a rule.
   */
  delete(id: string): boolean {
    if (!this.storage.rules[id]) return false;
    delete this.storage.rules[id];
    this.save();
    return true;
  }

  /**
   * List rules, optionally filtered by scope, status, or tag.
   */
  list(filter?: { scope?: RuleScope; status?: RuleStatus; tag?: string }): Rule[] {
    let rules = Object.values(this.storage.rules);
    if (filter?.scope) rules = rules.filter((r) => r.scope === filter.scope);
    if (filter?.status) rules = rules.filter((r) => r.status === filter.status);
    if (filter?.tag) rules = rules.filter((r) => r.tags.includes(filter.tag!));
    return rules.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Get effective rules for a scope, applying inheritance.
   * Higher-priority scopes override lower-priority ones by name.
   *
   * E.g., if 'no-console' exists in both global and project, the project version wins.
   */
  getEffectiveRules(scope: RuleScope): Rule[] {
    const scopes: RuleScope[] = ['global'];
    if (scope === 'project' || scope === 'user') scopes.push('project');
    if (scope === 'user') scopes.push('user');

    const byName = new Map<string, Rule>();
    for (const s of scopes) {
      const rules = this.list({ scope: s, status: 'active' });
      for (const rule of rules) {
        byName.set(rule.name, rule); // higher scope overrides
      }
    }
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Search rules by text in name, description, or body.
   */
  search(query: string): Rule[] {
    const lower = query.toLowerCase();
    return Object.values(this.storage.rules).filter(
      (r) =>
        r.name.toLowerCase().includes(lower) ||
        r.description.toLowerCase().includes(lower) ||
        r.body.toLowerCase().includes(lower),
    );
  }

  /**
   * Get rules that override a parent rule.
   */
  getOverrides(parentId: string): Rule[] {
    return Object.values(this.storage.rules).filter((r) => r.parentId === parentId);
  }

  /**
   * Get the parent chain for a rule (inheritance chain).
   */
  getInheritanceChain(id: string): Rule[] {
    const chain: Rule[] = [];
    let current: Rule | undefined = this.storage.rules[id];
    while (current) {
      chain.unshift(current);
      current = current.parentId ? this.storage.rules[current.parentId] : undefined;
    }
    return chain;
  }

  /**
   * Enable a rule (set status to active).
   */
  enable(id: string): Rule | undefined {
    return this.setStatus(id, 'active');
  }

  /**
   * Disable a rule.
   */
  disable(id: string): Rule | undefined {
    return this.setStatus(id, 'disabled');
  }

  /**
   * Archive a rule.
   */
  archive(id: string): Rule | undefined {
    return this.setStatus(id, 'archived');
  }

  get count(): number {
    return Object.keys(this.storage.rules).length;
  }

  clear(): void {
    this.storage = { rules: {} };
    this.save();
  }

  // ─── Internal ───────────────────────────────────────────────────

  private setStatus(id: string, status: RuleStatus): Rule | undefined {
    const rule = this.storage.rules[id];
    if (!rule) return undefined;
    rule.status = status;
    rule.updatedAt = new Date().toISOString();
    this.save();
    return rule;
  }

  private makeId(scope: RuleScope, name: string): string {
    return `${scope}:${this.slugify(name)}`;
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private load(): RuleStorage {
    try {
      if (existsSync(this.filePath)) {
        return JSON.parse(readFileSync(this.filePath, 'utf8')) as RuleStorage;
      }
    } catch (err) {
      log.warn({ err }, 'failed to load rules, starting fresh');
    }
    return { rules: {} };
  }

  private save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.storage, null, 2), 'utf8');
    } catch (err) {
      log.error({ err }, 'failed to save rules');
    }
  }
}
