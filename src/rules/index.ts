/**
 * rules/index.ts — Rules module exports.
 */

export { RuleManager } from './rule-manager.js';
export type { Rule, CreateRuleInput, UpdateRuleInput, RuleScope, RuleSeverity, RuleStatus } from './types.js';

export { RuleEvaluator } from './rule-evaluator.js';
export type { GuardPhase, GuardSchema, GuardViolation, GuardResult } from './rule-evaluator.js';

export { PolicyEngine } from './policy-engine.js';
export type { PolicyOp, PolicyCondition, PolicyRule, PolicyEvaluation, PolicyEngineOptions } from './policy-engine.js';

export { RuleEnforcementMiddleware, createRuleEnforcement } from './rule-enforcement.js';
export type { EnforcementMode, RuleEnforcementOptions, ViolationLogEntry } from './rule-enforcement.js';
