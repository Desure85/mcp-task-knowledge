/**
 * ACL Engine — Access Control Layer model, policies, and enforcement (ACL-001)
 *
 * Provides role-based access control for MCP tools and resources.
 * Integrates with AuthManager (A-001/A-002) for session-level roles and
 * with ToolExecutor/MiddlewarePipeline (MW-001) for enforcement hooks.
 *
 * Architecture:
 *   AuthManager.authenticate()
 *       ↓ (stores roles in session metadata)
 *   ToolContext.roles ← session.metadata.roles
 *       ↓
 *   ACLEngine.evaluate(toolName, roles, context)
 *       ↓ (matches rules from active policy)
 *   allow / deny
 *
 * Policy model:
 *   - defaultAction: 'allow' | 'deny' — what happens when no rule matches
 *   - rules: ordered list of ACLRule, first match wins
 *   - Each rule matches on: tool pattern, roles, conditions
 *   - Tool patterns: exact match ('tasks_list') or glob ('tasks_*', 'search.*')
 *
 * Built-in roles:
 *   - 'admin' — full access to all tools (bypasses ACL)
 *   - 'user' — restricted by policy rules
 *   - Empty roles [] — treated as 'anonymous' (subject to policy)
 *
 * Configuration sources:
 *   - ACL_CONFIG_JSON env var — inline JSON policy
 *   - Policy file (YAML/JSON) — loaded on startup
 *   - Programmatic — via ACLEngine API
 *
 * Usage:
 *   const acl = new ACLEngine({
 *     defaultAction: 'deny',
 *     rules: [
 *       { effect: 'allow', toolPattern: 'tasks_*', roles: ['user', 'admin'] },
 *       { effect: 'allow', toolPattern: 'knowledge_*', roles: ['admin'] },
 *     ],
 *   });
 *
 *   // As middleware (recommended)
 *   executor.use(acl.createMiddleware());
 *
 *   // As pre-hook (legacy)
 *   executor.addPreHook(acl.createPreHook());
 */

import type { ToolContext, PreToolHook } from './tool-executor.js';
import { ToolDeniedError } from './tool-executor.js';
import type { ToolMiddleware } from './middleware.js';
import { childLogger } from './logger.js';

const log = childLogger('acl');

// ─── Rule types ──────────────────────────────────────────────────────

/**
 * Effect of an ACL rule — allow or deny access.
 */
export type ACLEffect = 'allow' | 'deny';

/**
 * A single ACL rule.
 *
 * Rules are evaluated in order; the first matching rule wins.
 * If no rule matches, the policy's `defaultAction` is used.
 *
 * Pattern matching:
 *   - Exact: 'tasks_list' matches only 'tasks_list'
 *   - Glob:  'tasks_*' matches 'tasks_list', 'tasks_create', etc.
 *   - Glob:  'search.*' matches 'search_tasks', 'search_knowledge'
 *   - Wildcard: '*' matches everything
 *
 * Role matching:
 *   - If `roles` is empty/undefined, the rule applies to ALL roles.
 *   - If `roles` is set, the session must have at least one of the listed roles.
 *   - The built-in 'admin' role bypasses all rules (always allowed).
 */
export interface ACLRule {
  /** Allow or deny access when this rule matches. */
  effect: ACLEffect;
  /** Tool name pattern (exact or glob with *). */
  toolPattern: string;
  /**
   * Required roles for this rule to apply.
   * Empty/undefined = applies to all roles.
   * Session must have at least ONE of the listed roles.
   */
  roles?: string[];
  /** Optional human-readable description. */
  description?: string;
}

/**
 * An ACL policy definition.
 *
 * Contains an ordered list of rules and a default action
 * for when no rules match.
 */
export interface ACLPolicy {
  /** Policy name (for logging and management). */
  name: string;
  /**
   * Default action when no rules match.
   * 'allow' — permit access (open policy)
   * 'deny' — block access (closed policy, recommended for multi-user)
   */
  defaultAction: 'allow' | 'deny';
  /** Ordered list of rules. First match wins. */
  rules: ACLRule[];
  /** Optional description. */
  description?: string;
  /** ISO timestamp when the policy was last modified. */
  updatedAt?: string;
}

/**
 * Result of an ACL evaluation.
 */
export interface ACLEvaluationResult {
  /** Whether access is allowed. */
  allowed: boolean;
  /** The effect that determined the result. */
  effect: 'allow' | 'deny';
  /** Which rule matched (or 'default' for policy default). */
  matchedBy: string;
  /** Human-readable reason (for logging and error messages). */
  reason: string;
}

/**
 * Options for ACLEngine construction.
 */
export interface ACLEngineOptions {
  /** Initial policy. Can be updated at runtime. */
  policy?: ACLPolicy;
  /**
   * Built-in admin role names that bypass all ACL checks.
   * Default: ['admin'].
   */
  adminRoles?: string[];
  /**
   * Whether ACL is enabled.
   * When false, all access is allowed (passthrough).
   * Default: false (backward compatible with single-user stdio mode).
   */
  enabled?: boolean;
}

// ─── ACLEngine ──────────────────────────────────────────────────────

/**
 * Access Control Engine.
 *
 * Evaluates whether a tool call should be allowed based on
 * the active policy and the caller's roles.
 */
export class ACLEngine {
  private policy: ACLPolicy;
  private readonly adminRoles: Set<string>;
  private _enabled: boolean;

  constructor(options?: ACLEngineOptions) {
    this.policy = options?.policy ?? {
      name: 'default',
      defaultAction: 'allow',
      rules: [],
    };
    this.adminRoles = new Set(options?.adminRoles ?? ['admin']);
    this._enabled = options?.enabled ?? false;
  }

  // ─── Policy management ──────────────────────────────────────────

  /**
   * Get the current active policy.
   */
  getPolicy(): ACLPolicy {
    return this.policy;
  }

  /**
   * Set/update the active policy.
   * This replaces the entire policy. Use with caution in production.
   */
  setPolicy(policy: ACLPolicy): void {
    this.policy = { ...policy, updatedAt: new Date().toISOString() };
    log.info(
      { name: policy.name, rules: policy.rules.length, defaultAction: policy.defaultAction },
      'ACL policy updated',
    );
  }

  /**
   * Get whether ACL enforcement is enabled.
   */
  get enabled(): boolean {
    return this._enabled;
  }

  /**
   * Enable or disable ACL enforcement.
   * When disabled, all access is allowed regardless of policy.
   */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    log.info({ enabled }, 'ACL enforcement ' + (enabled ? 'enabled' : 'disabled'));
  }

  /**
   * Add a rule to the end of the policy.
   */
  addRule(rule: ACLRule): void {
    this.policy.rules.push(rule);
    this.policy.updatedAt = new Date().toISOString();
  }

  /**
   * Remove all rules that match the given tool pattern.
   * Returns the number of rules removed.
   */
  removeRulesByPattern(pattern: string): number {
    const before = this.policy.rules.length;
    this.policy.rules = this.policy.rules.filter((r) => r.toolPattern !== pattern);
    const removed = before - this.policy.rules.length;
    if (removed > 0) {
      this.policy.updatedAt = new Date().toISOString();
    }
    return removed;
  }

  /**
   * Clear all rules from the policy.
   */
  clearRules(): void {
    this.policy.rules = [];
    this.policy.updatedAt = new Date().toISOString();
  }

  // ─── Evaluation ────────────────────────────────────────────────

  /**
   * Evaluate whether a tool call should be allowed.
   *
   * Evaluation order:
   *   1. If ACL is disabled → allow
   *   2. If caller has an admin role → allow
   *   3. Match rules in order (first match wins)
   *   4. If no rule matches → use policy defaultAction
   *
   * @param toolName — name of the tool being called
   * @param roles — caller's roles (from ToolContext.roles)
   * @returns evaluation result with allow/deny and reason
   */
  evaluate(toolName: string, roles: string[]): ACLEvaluationResult {
    // 1. ACL disabled → allow all
    if (!this._enabled) {
      return {
        allowed: true,
        effect: 'allow',
        matchedBy: 'acl-disabled',
        reason: 'ACL enforcement is disabled',
      };
    }

    // 2. Admin role → allow all
    for (const role of roles) {
      if (this.adminRoles.has(role)) {
        return {
          allowed: true,
          effect: 'allow',
          matchedBy: 'admin-role',
          reason: `role "${role}" has admin access`,
        };
      }
    }

    // 3. Match rules in order (first match wins)
    for (let i = 0; i < this.policy.rules.length; i++) {
      const rule = this.policy.rules[i];

      // Check tool pattern match
      if (!this.matchPattern(rule.toolPattern, toolName)) {
        continue;
      }

      // Check role match (if rule has role restrictions)
      if (rule.roles && rule.roles.length > 0) {
        const hasRole = rule.roles.some((r) => roles.includes(r));
        if (!hasRole) {
          continue;
        }
      }

      // Rule matched
      log.debug(
        { toolName, roles, rule: i, effect: rule.effect, pattern: rule.toolPattern },
        'ACL rule matched',
      );

      return {
        allowed: rule.effect === 'allow',
        effect: rule.effect,
        matchedBy: `rule:${i}:${rule.toolPattern}`,
        reason: rule.description ?? `rule ${i} matched: ${rule.effect} ${rule.toolPattern}`,
      };
    }

    // 4. No rule matched → use default
    const allowed = this.policy.defaultAction === 'allow';
    return {
      allowed,
      effect: this.policy.defaultAction,
      matchedBy: 'default',
      reason: allowed
        ? 'no rule matched, default action is allow'
        : 'no rule matched, default action is deny',
    };
  }

  /**
   * Shorthand: check if a tool call is allowed.
   */
  isAllowed(toolName: string, roles: string[]): boolean {
    return this.evaluate(toolName, roles).allowed;
  }

  // ─── Integration hooks ─────────────────────────────────────────

  /**
   * Create a middleware for ToolExecutor pipeline (MW-001).
   *
   * Recommended integration method. The middleware:
   *   - Checks ACL in before() hook
   *   - Short-circuits with ToolDeniedError if denied
   *   - Passes through if allowed
   *
   * @example
   *   executor.use(acl.createMiddleware());
   */
  createMiddleware(): ToolMiddleware {
    return {
      name: 'acl',
      before: (ctx) => {
        const result = this.evaluate(ctx.toolName, ctx.context.roles);

        if (!result.allowed) {
          log.warn(
            {
              toolName: ctx.toolName,
              sessionId: ctx.context.sessionId,
              userId: ctx.context.userId,
              roles: ctx.context.roles,
              matchedBy: result.matchedBy,
            },
            'ACL denied tool call',
          );
          // Import ToolDeniedError at top level already via tool-executor import
          throw new ToolDeniedError(
            ctx.toolName,
            `ACL denied: ${result.reason}`,
          );
        }

        // Store ACL result in middleware context for observability
        ctx.mw.aclResult = result;
      },
    };
  }

  /**
   * Create a pre-execution hook for ToolExecutor (legacy).
   *
   * For backward compatibility with the pre-hook system.
   *
   * @example
   *   executor.addPreHook(acl.createPreHook());
   */
  createPreHook(): PreToolHook {
    return (toolName: string, _input: Record<string, unknown>, context: ToolContext) => {
      const result = this.evaluate(toolName, context.roles);

      if (!result.allowed) {
        log.warn(
          {
            toolName,
            sessionId: context.sessionId,
            userId: context.userId,
            roles: context.roles,
            matchedBy: result.matchedBy,
          },
          'ACL denied tool call (pre-hook)',
        );
        return {
          deny: true,
          reason: `ACL denied: ${result.reason}`,
        };
      }

      return { deny: false };
    };
  }

  // ─── Pattern matching ──────────────────────────────────────────

  /**
   * Match a tool name against a glob pattern.
   *
   * Supports:
   *   - Exact: 'tasks_list' → only 'tasks_list'
   *   - Suffix glob: 'tasks_*' → 'tasks_list', 'tasks_create', 'tasks_update'
   *   - Prefix glob: '*_delete' → 'tasks_delete', 'knowledge_delete'
   *   - Full wildcard: '*' → everything
   *   - Dot patterns: 'search.*' → 'search_tasks', 'search_knowledge'
   *
   * Pattern syntax:
   *   - '*' matches any sequence of characters within a segment
   *   - No regex — simple glob only for performance
   */
  matchPattern(pattern: string, toolName: string): boolean {
    // Exact match
    if (pattern === toolName) return true;

    // Full wildcard
    if (pattern === '*') return true;

    // Glob patterns (only * as wildcard, no ? or [])
    if (!pattern.includes('*')) return false;

    // Convert simple glob to regex
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex special chars except *
      .replace(/\*/g, '.*');                    // * → .*
    const regex = new RegExp(`^${escaped}$`);
    return regex.test(toolName);
  }

  // ─── Diagnostics ───────────────────────────────────────────────

  /**
   * Get a summary of the current policy for diagnostics.
   */
  getDiagnostics(): {
    enabled: boolean;
    policyName: string;
    defaultAction: string;
    ruleCount: number;
    adminRoles: string[];
  } {
    return {
      enabled: this._enabled,
      policyName: this.policy.name,
      defaultAction: this.policy.defaultAction,
      ruleCount: this.policy.rules.length,
      adminRoles: [...this.adminRoles],
    };
  }
}

// ─── Preset policies ────────────────────────────────────────────────

/**
 * Create a deny-by-default policy (recommended for multi-user deployments).
 * Only explicitly allowed tools are accessible.
 *
 * @param rules — rules defining what is allowed
 */
export function createDenyPolicy(name: string, rules: ACLRule[]): ACLPolicy {
  return {
    name,
    defaultAction: 'deny',
    rules,
    description: `Deny-by-default policy "${name}" — only explicitly allowed tools are accessible`,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Create an allow-by-default policy (for single-user or trusted environments).
 * Only explicitly denied tools are blocked.
 *
 * @param rules — rules defining what is denied
 */
export function createAllowPolicy(name: string, rules: ACLRule[]): ACLPolicy {
  return {
    name,
    defaultAction: 'allow',
    rules,
    description: `Allow-by-default policy "${name}" — only explicitly denied tools are blocked`,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Parse an ACL policy from a JSON config object (env var or file).
 * Validates the structure and provides defaults.
 *
 * Expected format:
 * ```json
 * {
 *   "name": "my-policy",
 *   "defaultAction": "deny",
 *   "rules": [
 *     { "effect": "allow", "toolPattern": "tasks_*", "roles": ["user", "admin"] }
 *   ]
 * }
 * ```
 */
export function parsePolicyFromJSON(json: unknown): ACLPolicy {
  if (!json || typeof json !== 'object') {
    throw new Error('ACL policy must be a non-null object');
  }

  const obj = json as Record<string, unknown>;

  if (!obj.name || typeof obj.name !== 'string') {
    throw new Error('ACL policy must have a "name" string field');
  }

  if (obj.defaultAction !== 'allow' && obj.defaultAction !== 'deny') {
    throw new Error('ACL policy "defaultAction" must be "allow" or "deny"');
  }

  if (!Array.isArray(obj.rules)) {
    throw new Error('ACL policy must have a "rules" array');
  }

  const rules: ACLRule[] = [];
  for (const rule of obj.rules as unknown[]) {
    if (!rule || typeof rule !== 'object') {
      throw new Error('Each ACL rule must be a non-null object');
    }
    const r = rule as Record<string, unknown>;
    if (r.effect !== 'allow' && r.effect !== 'deny') {
      throw new Error(`ACL rule "effect" must be "allow" or "deny", got: ${r.effect}`);
    }
    if (!r.toolPattern || typeof r.toolPattern !== 'string') {
      throw new Error('ACL rule must have a "toolPattern" string field');
    }
    rules.push({
      effect: r.effect as 'allow' | 'deny',
      toolPattern: r.toolPattern as string,
      roles: Array.isArray(r.roles) ? (r.roles as string[]) : undefined,
      description: typeof r.description === 'string' ? r.description : undefined,
    });
  }

  return {
    name: obj.name as string,
    defaultAction: obj.defaultAction as 'allow' | 'deny',
    rules,
    description: typeof obj.description === 'string' ? obj.description : undefined,
    updatedAt: new Date().toISOString(),
  };
}
