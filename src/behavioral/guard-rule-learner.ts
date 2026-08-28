/**
 * behavioral/guard-rule-learner.ts — Guard rules auto-learning (BM-010).
 *
 * When a failure is resolved, distill the approach + context into a reusable
 * guard rule stored in the rules engine (RL-001). The rule fires on future
 * code matching the same failure pattern (via RuleEvaluator deny-patterns).
 *
 * Pattern: a deny regex built from the failure error type + message keywords.
 *
 * Usage:
 *   const learner = new GuardRuleLearner(failures, resolutions, ruleManager);
 *   const learned = learner.learn();          // one pass over resolved failures
 *   const rules = learner.listLearnedRules();
 */

import { childLogger } from '../core/logger.js';
import type { FailureLogger } from './failure-logging.js';
import type { ResolutionLogger } from './resolution-logging.js';
import type { RuleManager } from '../rules/rule-manager.js';
import type { Rule, RuleScope } from '../rules/types.js';

const log = childLogger('guard-rule-learner');

// ─── Types ────────────────────────────────────────────────────────

export interface LearnResult {
  /** Rules created in this pass. */
  learned: Rule[];
  /** Failures skipped (no resolution / already learned). */
  skipped: number;
}

export interface LearnerOptions {
  /** Scope for learned rules. Default: 'global'. */
  scope?: RuleScope;
  /** Min keywords for a usable pattern. Default: 1. */
  minKeywords?: number;
}

// Generic words that produce noisy patterns.
const STOP_WORDS = new Set([
  'cannot', 'error', 'failed', 'failure', 'unexpected', 'expected', 'occurred',
  'happened', 'something', 'when', 'while', 'with', 'from', 'this', 'that',
  'value', 'values', 'object', 'function', 'method', 'property', 'element',
]);

// ─── GuardRuleLearner ─────────────────────────────────────────────

export class GuardRuleLearner {
  private readonly failures: FailureLogger;
  private readonly resolutions: ResolutionLogger;
  private readonly rules: RuleManager;
  private readonly scope: RuleScope;
  private readonly minKeywords: number;

  constructor(
    failures: FailureLogger,
    resolutions: ResolutionLogger,
    rules: RuleManager,
    options?: LearnerOptions,
  ) {
    this.failures = failures;
    this.resolutions = resolutions;
    this.rules = rules;
    this.scope = options?.scope ?? 'global';
    this.minKeywords = options?.minKeywords ?? 1;
  }

  /**
   * One pass: learn guard rules from resolved failures that do not have one yet.
   */
  learn(): LearnResult {
    const result: LearnResult = { learned: [], skipped: 0 };
    const existing = new Set(this.listLearnedRules().map((r) => this.sourceFailureId(r)));

    for (const failure of this.failures.getResolved()) {
      if (existing.has(failure.failureId)) continue;
      const rule = this.learnFromFailure(failure.failureId);
      if (rule) {
        result.learned.push(rule);
        existing.add(failure.failureId);
      } else {
        result.skipped++;
      }
    }
    log.info({ learned: result.learned.length, skipped: result.skipped }, 'guard rules learned');
    return result;
  }

  /**
   * Learn a rule from a single resolved failure.
   */
  learnFromFailure(failureId: string): Rule | null {
    const failure = this.failures.get(failureId);
    if (!failure || !failure.resolved) return null;
    if (!failure.resolutionId) return null;

    const resolution = this.resolutions.get(failure.resolutionId);
    if (!resolution) return null;

    const keywords = this.extractKeywords(failure.message);
    if (keywords.length < this.minKeywords) return null;

    const ruleId = `${this.scope}:guard-${slugify(failure.errorType)}`;
    const pattern = this.buildPattern(failure.errorType, keywords);

    const existing = this.rules.get(ruleId);
    if (existing) {
      // Update: refresh pattern + approach, keep source chain
      return this.rules.update(ruleId, {
        body: resolution.approach,
        status: 'active',
        frontmatter: {
          ...existing.frontmatter,
          guard: true,
          deny: [pattern],
          message: `matches known failure pattern: ${failure.errorType}`,
          learnedFrom: { failureId: failure.failureId, resolutionId: resolution.resolutionId },
        },
      });
    }

    return this.rules.create({
      name: `guard-${slugify(failure.errorType)}`,
      description: `Auto-learned guard: ${failure.errorType}`,
      scope: this.scope,
      severity: 'error',
      body: resolution.approach,
      frontmatter: {
        guard: true,
        targets: ['*'],
        check: 'input',
        deny: [pattern],
        message: `matches known failure pattern: ${failure.errorType}`,
        learnedFrom: { failureId: failure.failureId, resolutionId: resolution.resolutionId },
      },
    });
  }

  /**
   * Rules previously learned by this mechanism.
   */
  listLearnedRules(): Rule[] {
    return this.rules.list({ scope: this.scope, status: 'active' }).filter((r) => r.frontmatter?.guard === true);
  }

  // ─── Internal ───────────────────────────────────────────────────

  private sourceFailureId(rule: Rule): string {
    const learnedFrom = rule.frontmatter?.learnedFrom as { failureId?: string } | undefined;
    return learnedFrom?.failureId ?? '';
  }

  private extractKeywords(message: string): string[] {
    const words = message.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    const unique = Array.from(new Set(words));
    return unique.filter((w) => !STOP_WORDS.has(w)).slice(0, 6);
  }

  /**
   * Build a deny regex: escaped error type + keywords joined by |.
   */
  private buildPattern(errorType: string, keywords: string[]): string {
    const parts = [errorType.toLowerCase(), ...keywords];
    return parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
