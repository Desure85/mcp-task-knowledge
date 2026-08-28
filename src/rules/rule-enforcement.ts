/**
 * rules/rule-enforcement.ts — Rule enforcement hooks (RL-005).
 *
 * Pre/post hooks on MCP tool calls via the middleware pipeline (MW-001).
 * Modes:
 *   - enforce: error-severity violations throw ToolDeniedError (block the call)
 *   - warn:    violations are logged, the call continues
 *   - log:     all violations are logged, nothing is blocked
 * Optional auto-fix: rules with `frontmatter.fix = { path, value }` can patch
 * the input before the handler runs.
 *
 * Usage:
 *   const pipeline = new MiddlewarePipeline();
 *   pipeline.use(createRuleEnforcement({ evaluator, scope: 'project', mode: 'enforce' }));
 *   const result = await pipeline.run(ctx, handler);
 */

import { childLogger } from '../core/logger.js';
import { ToolDeniedError } from '../core/tool-executor.js';
import type { MiddlewareContext, ToolMiddleware, BeforeResult } from '../core/middleware.js';
import type { RuleEvaluator, GuardViolation, GuardResult } from './rule-evaluator.js';
import type { RuleScope } from './types.js';

const log = childLogger('rule-enforcement');

// ─── Types ────────────────────────────────────────────────────────

export type EnforcementMode = 'enforce' | 'warn' | 'log';

export interface RuleEnforcementOptions {
  /** Rule evaluator (RL-002). */
  evaluator: RuleEvaluator;
  /** Scope whose effective rules apply. */
  scope: RuleScope;
  /** Enforcement mode. Default: 'enforce'. */
  mode?: EnforcementMode;
  /** Apply rule frontmatter `fix` patches to input. Default: false. */
  autoFix?: boolean;
  /** Restrict enforcement to matching tool names (exact or prefix:*). Default: all. */
  targets?: string[];
}

export interface ViolationLogEntry {
  toolName: string;
  phase: 'input' | 'output';
  violations: GuardViolation[];
  blocked: boolean;
}

// ─── RuleEnforcementMiddleware ────────────────────────────────────

export class RuleEnforcementMiddleware implements ToolMiddleware {
  readonly name = 'rule-enforcement';

  private readonly evaluator: RuleEvaluator;
  private readonly scope: RuleScope;
  private readonly mode: EnforcementMode;
  private readonly autoFix: boolean;
  private readonly targets?: string[];

  constructor(options: RuleEnforcementOptions) {
    this.evaluator = options.evaluator;
    this.scope = options.scope;
    this.mode = options.mode ?? 'enforce';
    this.autoFix = options.autoFix ?? false;
    this.targets = options.targets;
  }

  /**
   * Pre-execution: evaluate input rules. Block or warn on violations.
   */
  before(ctx: MiddlewareContext): BeforeResult | void {
    if (!this.applies(ctx.toolName)) return;

    let result = this.evaluator.evaluateInput(this.scope, ctx.toolName, ctx.input);
    this.handleViolations(ctx.toolName, 'input', result);

    if (this.autoFix && !result.pass) {
      this.applyFixes(ctx);
      // Re-evaluate after fixes — patched input may now pass
      result = this.evaluator.evaluateInput(this.scope, ctx.toolName, ctx.input);
    }

    if (result.blocked && this.mode === 'enforce') {
      throw new ToolDeniedError(ctx.toolName, this.formatBlockReason('input', result));
    }
  }

  /**
   * Post-execution: evaluate output rules.
   * NOTE: the middleware pipeline (MW-001) swallows errors thrown from after()
   * hooks, so output blocking is surfaced as a denial-shaped result instead.
   */
  after(ctx: MiddlewareContext, result: unknown): unknown {
    if (!this.applies(ctx.toolName)) return result;

    const guard = this.evaluator.evaluateOutput(this.scope, ctx.toolName, result);
    this.handleViolations(ctx.toolName, 'output', guard);

    if (guard.blocked && this.mode === 'enforce') {
      const denial = new ToolDeniedError(ctx.toolName, this.formatBlockReason('output', guard));
      log.error({ err: denial }, 'rule enforcement: output blocked');
      return { denied: true, error: denial.message, toolName: ctx.toolName };
    }
    return result;
  }

  // ─── Internal ───────────────────────────────────────────────────

  private applies(toolName: string): boolean {
    if (!this.targets || this.targets.length === 0) return true;
    return this.targets.some((t) => {
      if (t === '*') return true;
      if (t.endsWith('*')) return toolName.startsWith(t.slice(0, -1));
      return t === toolName;
    });
  }

  private handleViolations(toolName: string, phase: 'input' | 'output', result: GuardResult): void {
    if (result.violations.length === 0) return;

    const entry: ViolationLogEntry = { toolName, phase, violations: result.violations, blocked: result.blocked };
    if (result.blocked && this.mode === 'enforce') {
      log.warn({ entry }, 'rule enforcement: violations blocked');
    } else if (result.blocked && this.mode === 'warn') {
      log.warn({ entry }, 'rule enforcement: violations (warn mode, continuing)');
    } else {
      log.info({ entry }, 'rule enforcement: violations logged');
    }
  }

  /**
   * Apply rule frontmatter `fix = { path, value }` patches to ctx.input.
   * Only fixes whose path has a matching violation are applied.
   */
  private applyFixes(ctx: MiddlewareContext): void {
    const rules = this.evaluator.listApplicableRules(this.scope, ctx.toolName);
    for (const rule of rules) {
      const fix = rule.frontmatter?.fix;
      if (!fix || typeof fix !== 'object') continue;
      const path = (fix as { path?: unknown }).path;
      const value = (fix as { value?: unknown }).value;
      if (typeof path !== 'string') continue;

      const violation = this.matchingViolation(ctx, path);
      if (!violation) continue;

      this.setPath(ctx.input, path, value);
      log.info({ toolName: ctx.toolName, path, ruleId: rule.id }, 'rule enforcement: auto-fix applied');
    }
  }

  private matchingViolation(ctx: MiddlewareContext, path: string): GuardViolation | undefined {
    const result = this.evaluator.evaluateInput(this.scope, ctx.toolName, ctx.input);
    return result.violations.find((v) => v.path === `input.${path}`);
  }

  private setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current: Record<string, unknown> = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (typeof current[key] !== 'object' || current[key] === null) {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
  }

  private formatBlockReason(phase: 'input' | 'output', result: GuardResult): string {
    const details = result.violations
      .filter((v) => v.severity === 'error')
      .map((v) => `${v.path}: ${v.message}`)
      .join('; ');
    return `rule enforcement (${phase}): ${details || 'violated'}`;
  }
}

/**
 * Factory: create a rule-enforcement middleware.
 */
export function createRuleEnforcement(options: RuleEnforcementOptions): RuleEnforcementMiddleware {
  return new RuleEnforcementMiddleware(options);
}
