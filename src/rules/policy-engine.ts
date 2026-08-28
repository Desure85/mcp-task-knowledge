/**
 * rules/policy-engine.ts — Policy-as-code (RL-003).
 *
 * JSON/DSL policies with conditional rules ("if file=*.ts then ...").
 * Git-native: policies live in the repo as *.policy.json files and are
 * versioned with the code. Converted into rules (RL-001 storage) and
 * evaluated against a runtime context.
 *
 * Policy example (policy.json):
 *   [
 *     {
 *       "id": "no-console-ts",
 *       "name": "No console in TypeScript",
 *       "severity": "warn",
 *       "when": [
 *         { "field": "file", "op": "matches", "pattern": "*.ts" },
 *         { "field": "content", "op": "matches", "pattern": "console\\." }
 *       ],
 *       "then": "Remove console.log/error from TypeScript files."
 *     }
 *   ]
 *
 * Usage:
 *   const engine = new PolicyEngine(ruleManager, { scope: 'project' });
 *   engine.loadPoliciesFromDir('policies');
 *   const results = engine.evaluate({ file: 'src/a.ts', content: 'console.log(1)' });
 *   // results: [{ policy, matched: true, severity: 'warn' }]
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { childLogger } from '../core/logger.js';
import type { RuleManager } from './rule-manager.js';
import type { Rule, RuleScope, RuleSeverity } from './types.js';

const log = childLogger('policy-engine');

// ─── Types ────────────────────────────────────────────────────────

export type PolicyOp = 'eq' | 'neq' | 'matches' | 'exists' | 'in';

export interface PolicyCondition {
  /** Field path to evaluate (dot notation, e.g. 'args.id'). */
  field?: string;
  /** Match operator. Default: 'eq'. */
  op?: PolicyOp;
  /** Value for eq/neq/in. */
  value?: unknown;
  /** Regex or glob pattern for 'matches'. */
  pattern?: string;
}

export interface PolicyRule {
  /** Policy ID (must be unique per scope). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Brief description. */
  description?: string;
  /** Severity. Default: 'warn'. */
  severity?: RuleSeverity;
  /** Conditions — all must match (AND). */
  when: PolicyCondition[];
  /** Instruction/action when the policy matches. */
  then: string;
  /** Tags for categorization. */
  tags?: string[];
  /** Rule scope. Default: engine scope. */
  scope?: RuleScope;
}

export interface PolicyEvaluation {
  /** The matched (or unmatched) policy. */
  policy: PolicyRule;
  /** Whether all conditions matched. */
  matched: boolean;
  /** Severity of the policy. */
  severity: RuleSeverity;
}

export interface PolicyEngineOptions {
  /** Default scope for loaded policies. Default: 'project'. */
  scope?: RuleScope;
}

// ─── PolicyEngine ─────────────────────────────────────────────────

export class PolicyEngine {
  private readonly manager: RuleManager;
  private readonly defaultScope: RuleScope;

  constructor(manager: RuleManager, options?: PolicyEngineOptions) {
    this.manager = manager;
    this.defaultScope = options?.scope ?? 'project';
  }

  /**
   * Parse policy JSON text into PolicyRule[].
   */
  parsePolicy(content: string): PolicyRule[] {
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch (err) {
      throw new Error(`[policy-engine] invalid policy JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    const items = Array.isArray(data) ? data : [data];
    const policies: PolicyRule[] = [];
    for (const item of items) {
      const errors = this.validatePolicy(item as PolicyRule);
      if (errors.length > 0) {
        throw new Error(`[policy-engine] invalid policy: ${errors.join('; ')}`);
      }
      policies.push(item as PolicyRule);
    }
    return policies;
  }

  /**
   * Structural validation of a policy.
   */
  validatePolicy(policy: PolicyRule): string[] {
    const errors: string[] = [];
    if (!policy || typeof policy !== 'object') return ['not an object'];
    if (typeof policy.id !== 'string' || !policy.id) errors.push('id required');
    if (typeof policy.name !== 'string' || !policy.name) errors.push('name required');
    if (!Array.isArray(policy.when) || policy.when.length === 0) errors.push('when (non-empty array) required');
    if (typeof policy.then !== 'string' || !policy.then) errors.push('then required');
    if (policy.severity !== undefined && !['error', 'warn', 'info'].includes(policy.severity)) {
      errors.push(`severity must be error|warn|info, got ${String(policy.severity)}`);
    }
    for (const cond of policy.when ?? []) {
      if (!cond || typeof cond !== 'object') { errors.push('condition must be an object'); continue; }
      if (cond.op === 'matches' && typeof cond.pattern !== 'string') {
        errors.push('matches requires a string pattern');
      }
    }
    return errors;
  }

  /**
   * Load policies into the rule manager (upsert by rule ID).
   */
  loadPolicies(policies: PolicyRule[]): Rule[] {
    const loaded: Rule[] = [];
    for (const policy of policies) {
      loaded.push(this.upsertRule(policy));
    }
    return loaded;
  }

  /**
   * Load policies from a JSON file.
   */
  loadPoliciesFromFile(filePath: string): Rule[] {
    const content = readFileSync(filePath, 'utf8');
    return this.loadPolicies(this.parsePolicy(content));
  }

  /**
   * Load all *.policy.json files from a directory (git-native policy dir).
   */
  loadPoliciesFromDir(dir: string): Rule[] {
    if (!existsSync(dir)) {
      log.warn({ dir }, 'policy dir not found');
      return [];
    }
    const files = readdirSync(dir).filter((f) => f.endsWith('.policy.json') || f === 'policy.json');
    const loaded: Rule[] = [];
    for (const file of files) {
      try {
        loaded.push(...this.loadPoliciesFromFile(join(dir, file)));
      } catch (err) {
        log.error({ file, err }, 'failed to load policy file');
      }
    }
    return loaded;
  }

  /**
   * Evaluate a context against the policies stored in the rule manager.
   * Returns one evaluation per policy (matched = all conditions true).
   */
  evaluate(context: Record<string, unknown>, scope?: RuleScope): PolicyEvaluation[] {
    const policies = this.collectPolicies(scope ?? this.defaultScope);
    return policies.map((policy) => ({
      policy,
      matched: this.evaluatePolicy(policy, context),
      severity: policy.severity ?? 'warn',
    }));
  }

  /**
   * Convenience: only matched policies.
   */
  evaluateMatches(context: Record<string, unknown>, scope?: RuleScope): PolicyEvaluation[] {
    return this.evaluate(context, scope).filter((e) => e.matched);
  }

  // ─── Internal ───────────────────────────────────────────────────

  private upsertRule(policy: PolicyRule): Rule {
    const scope = policy.scope ?? this.defaultScope;
    // RuleManager derives rule IDs from the rule name (scope:slug(name))
    const ruleId = `${scope}:${this.slugify(policy.name)}`;
    const frontmatter: Record<string, unknown> = {
      policy: true,
      policyId: policy.id,
      when: policy.when,
    };
    if (policy.description) frontmatter.description = policy.description;

    const existing = this.manager.get(ruleId);
    if (existing) {
      return this.manager.update(ruleId, {
        name: policy.name,
        description: policy.description ?? existing.description,
        severity: policy.severity ?? existing.severity,
        body: policy.then,
        tags: policy.tags ?? existing.tags,
        status: 'active',
        frontmatter,
      });
    }
    return this.manager.create({
      name: policy.name,
      description: policy.description ?? policy.name,
      scope,
      severity: policy.severity ?? 'warn',
      body: policy.then,
      tags: policy.tags ?? [],
      frontmatter,
    });
  }

  private collectPolicies(scope: RuleScope): PolicyRule[] {
    const rules = this.manager.getEffectiveRules(scope);
    const policies: PolicyRule[] = [];
    for (const rule of rules) {
      const fm = rule.frontmatter ?? {};
      if (fm.policy !== true) continue;
      const when = fm.when;
      if (!Array.isArray(when)) continue;
      policies.push({
        id: typeof fm.policyId === 'string' ? fm.policyId : rule.name,
        name: rule.name,
        description: typeof fm.description === 'string' ? fm.description : rule.description,
        severity: rule.severity,
        when: when as PolicyCondition[],
        then: rule.body,
        tags: rule.tags,
        scope: rule.scope,
      });
    }
    return policies;
  }

  private evaluatePolicy(policy: PolicyRule, context: Record<string, unknown>): boolean {
    for (const condition of policy.when) {
      if (!this.evaluateCondition(condition, context)) return false;
    }
    return true;
  }

  private evaluateCondition(condition: PolicyCondition, context: Record<string, unknown>): boolean {
    const value = condition.field ? this.resolvePath(context, condition.field) : context;

    switch (condition.op ?? 'eq') {
      case 'eq':
        return this.deepEqual(value, condition.value);
      case 'neq':
        return !this.deepEqual(value, condition.value);
      case 'exists':
        return condition.field ? value !== undefined : Object.keys(context).length > 0;
      case 'in':
        return Array.isArray(condition.value) && condition.value.some((v) => this.deepEqual(v, value));
      case 'matches': {
        if (value === undefined || value === null) return false;
        const pattern = condition.pattern ?? '';
        return this.patternToRegExp(pattern).test(String(value));
      }
      default:
        return false;
    }
  }

  private resolvePath(obj: Record<string, unknown>, path: string): unknown {
    let current: unknown = obj;
    for (const key of path.split('.')) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    return current;
  }

  /** Convert a pattern to a RegExp: valid regex first, glob (*.ts) as fallback. */
  private patternToRegExp(pattern: string): RegExp {
    try {
      return new RegExp(pattern);
    } catch {
      // Not a valid regex — treat as glob and anchor it
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      return new RegExp(`^${escaped}$`);
    }
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
