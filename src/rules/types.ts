/**
 * rules/types.ts — Rule types (RL-001).
 */

export type RuleScope = 'global' | 'project' | 'user';
export type RuleSeverity = 'error' | 'warn' | 'info';
export type RuleStatus = 'active' | 'disabled' | 'archived';

export interface Rule {
  /** Unique rule ID (slug-based). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Brief description. */
  description: string;
  /** Rule scope — global, project, or user. */
  scope: RuleScope;
  /** Severity level. */
  severity: RuleSeverity;
  /** Rule body — Markdown content with conditions and actions. */
  body: string;
  /** Tags for categorization. */
  tags: string[];
  /** Status. */
  status: RuleStatus;
  /** YAML frontmatter (arbitrary metadata). */
  frontmatter: Record<string, unknown>;
  /** When the rule was created (ISO 8601). */
  createdAt: string;
  /** When the rule was last updated (ISO 8601). */
  updatedAt: string;
  /** Parent rule ID (for inheritance/override). */
  parentId?: string;
}

export interface CreateRuleInput {
  name: string;
  description: string;
  scope: RuleScope;
  severity?: RuleSeverity;
  body: string;
  tags?: string[];
  frontmatter?: Record<string, unknown>;
  parentId?: string;
}

export interface UpdateRuleInput {
  name?: string;
  description?: string;
  scope?: RuleScope;
  severity?: RuleSeverity;
  body?: string;
  tags?: string[];
  status?: RuleStatus;
  frontmatter?: Record<string, unknown>;
  parentId?: string;
}
