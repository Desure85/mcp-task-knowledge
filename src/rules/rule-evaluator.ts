/**
 * rules/rule-evaluator.ts — Rules evaluation (RL-002).
 *
 * Runtime guard checks around MCP tool calls: input/output validation and
 * schema checks driven by rule frontmatter.
 *
 * Rule frontmatter contract:
 *   targets: ["tool:delete", "tasks:*"]   — tool name patterns (default: all)
 *   check:   "input" | "output" | "both"  — which phase to guard (default: input)
 *   schema:  { type, required, properties, items, enum, pattern, min/max ... }
 *   deny:    ["regex", ...]               — deny patterns over stringified data
 *   message: "custom violation message"
 *
 * Usage:
 *   const evaluator = new RuleEvaluator(manager);
 *   const res = evaluator.evaluate('project', 'tasks:delete', 'input', { id: 'x' });
 *   if (res.blocked) throw new Error('guard check failed');
 */

import type { RuleManager } from './rule-manager.js';
import type { Rule, RuleScope, RuleSeverity } from './types.js';

// ─── Types ────────────────────────────────────────────────────────

export type GuardPhase = 'input' | 'output';

export interface GuardSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'any';
  /** Required property names (for objects). */
  required?: string[];
  /** Nested property schemas (for objects). */
  properties?: Record<string, GuardSchema>;
  /** Element schema (for arrays). */
  items?: GuardSchema;
  /** Allowed values. */
  enum?: unknown[];
  /** Regex pattern (for strings). */
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
}

export interface GuardViolation {
  /** Rule ID that produced the violation. */
  ruleId: string;
  /** Rule name. */
  ruleName: string;
  /** Rule severity. */
  severity: RuleSeverity;
  /** Data path, e.g. "input.id" or "output". */
  path: string;
  /** Human-readable message. */
  message: string;
}

export interface GuardResult {
  /** True when no violations at all. */
  pass: boolean;
  /** All violations found. */
  violations: GuardViolation[];
  /** True when any error-severity violation exists (blocking). */
  blocked: boolean;
}

// ─── RuleEvaluator ────────────────────────────────────────────────

export class RuleEvaluator {
  private readonly manager: RuleManager;

  constructor(manager: RuleManager) {
    this.manager = manager;
  }

  /**
   * Evaluate rules for a scope against a tool call phase.
   */
  evaluate(scope: RuleScope, toolName: string, phase: GuardPhase, data: unknown): GuardResult {
    const violations: GuardViolation[] = [];
    const rules = this.manager.getEffectiveRules(scope);

    for (const rule of rules) {
      if (!this.matchesTargets(rule, toolName)) continue;
      if (!this.matchesPhase(rule, phase)) continue;
      violations.push(...this.checkRule(rule, phase, data));
    }

    return this.buildResult(violations);
  }

  /**
   * Convenience: evaluate the input args of a tool call.
   */
  evaluateInput(scope: RuleScope, toolName: string, args: Record<string, unknown>): GuardResult {
    return this.evaluate(scope, toolName, 'input', args);
  }

  /**
   * Convenience: evaluate the output of a tool call.
   */
  evaluateOutput(scope: RuleScope, toolName: string, output: unknown): GuardResult {
    return this.evaluate(scope, toolName, 'output', output);
  }

  // ─── Internal ───────────────────────────────────────────────────

  private buildResult(violations: GuardViolation[]): GuardResult {
    return {
      pass: violations.length === 0,
      violations,
      blocked: violations.some((v) => v.severity === 'error'),
    };
  }

  private checkRule(rule: Rule, phase: GuardPhase, data: unknown): GuardViolation[] {
    const violations: GuardViolation[] = [];
    const fm = rule.frontmatter ?? {};

    // Schema validation
    if (typeof fm.schema === 'object' && fm.schema !== null) {
      violations.push(...this.validateSchema(rule, fm.schema as GuardSchema, phase, data));
    }

    // Deny patterns over stringified data
    if (Array.isArray(fm.deny)) {
      const stringified = this.stringify(data);
      for (const pattern of fm.deny) {
        if (typeof pattern !== 'string') continue;
        try {
          const re = new RegExp(pattern);
          if (re.test(stringified)) {
            violations.push(this.violation(rule, phase, String(fm.message ?? `denied by pattern: ${pattern}`)));
          }
        } catch {
          // invalid regex in rule — ignore
        }
      }
    }

    return violations;
  }

  private validateSchema(
    rule: Rule,
    schema: GuardSchema,
    phase: GuardPhase,
    data: unknown,
    path: string = phase,
  ): GuardViolation[] {
    const violations: GuardViolation[] = [];

    if (schema.type && schema.type !== 'any') {
      const actual = this.typeOf(data);
      if (actual !== schema.type) {
        violations.push(this.violation(rule, path, `expected ${schema.type}, got ${actual}`));
        // Do not recurse into mismatched structures
        return violations;
      }
    }

    if (schema.enum !== undefined) {
      const match = schema.enum.some((v) => Object.is(v, data));
      if (!match) {
        violations.push(this.violation(rule, path, `value not in allowed enum`));
      }
    }

    if (typeof data === 'string') {
      if (schema.pattern !== undefined) {
        try {
          if (!new RegExp(schema.pattern).test(data)) {
            violations.push(this.violation(rule, path, `string does not match pattern: ${schema.pattern}`));
          }
        } catch { /* invalid pattern — ignore */ }
      }
      if (schema.minLength !== undefined && data.length < schema.minLength) {
        violations.push(this.violation(rule, path, `length ${data.length} < minLength ${schema.minLength}`));
      }
      if (schema.maxLength !== undefined && data.length > schema.maxLength) {
        violations.push(this.violation(rule, path, `length ${data.length} > maxLength ${schema.maxLength}`));
      }
    }

    if (typeof data === 'number') {
      if (schema.min !== undefined && data < schema.min) {
        violations.push(this.violation(rule, path, `${data} < min ${schema.min}`));
      }
      if (schema.max !== undefined && data > schema.max) {
        violations.push(this.violation(rule, path, `${data} > max ${schema.max}`));
      }
    }

    if (Array.isArray(data)) {
      if (schema.minLength !== undefined && data.length < schema.minLength) {
        violations.push(this.violation(rule, path, `length ${data.length} < minLength ${schema.minLength}`));
      }
      if (schema.maxLength !== undefined && data.length > schema.maxLength) {
        violations.push(this.violation(rule, path, `length ${data.length} > maxLength ${schema.maxLength}`));
      }
      if (schema.items) {
        data.forEach((item, i) => {
          violations.push(...this.validateSchema(rule, schema.items!, phase, item, `${path}[${i}]`));
        });
      }
    }

    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
      const record = data as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (!(key in record)) {
          violations.push(this.violation(rule, `${path}.${key}`, `missing required field: ${key}`));
        }
      }
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (key in record) {
            violations.push(...this.validateSchema(rule, propSchema, phase, record[key], `${path}.${key}`));
          }
        }
      }
    }

    return violations;
  }

  private matchesTargets(rule: Rule, toolName: string): boolean {
    const targets = rule.frontmatter?.targets;
    if (!Array.isArray(targets) || targets.length === 0) return true;

    for (const target of targets) {
      if (typeof target !== 'string') continue;
      if (target === '*') return true;
      if (target.endsWith('*') && toolName.startsWith(target.slice(0, -1))) return true;
      if (target === toolName) return true;
    }
    return false;
  }

  private matchesPhase(rule: Rule, phase: GuardPhase): boolean {
    const check = rule.frontmatter?.check;
    if (check === 'both') return true;
    if (check === 'output') return phase === 'output';
    // default: input
    return phase === 'input';
  }

  private violation(rule: Rule, path: string, message: string): GuardViolation {
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      path,
      message,
    };
  }

  private typeOf(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  private stringify(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}
