/**
 * skills/skill-permissions.ts — Skill permissions (SK-006).
 *
 * Agent Skills spec permission fields, enforced before invocation:
 *   - `scope`                    — where the skill is available
 *                                 (global | project | user)
 *   - `disable-model-invocation` — true = only users may invoke
 *   - `allowed-tools`            — tools the skill may use ('*' = all)
 *   - `allowed-arguments`        — argument names the skill may receive
 *
 * Frontmatter keys accept both kebab-case (spec) and camelCase:
 *   allowed-tools / allowedTools, disable-model-invocation / disableModelInvocation,
 *   allowed-arguments / allowedArguments.
 *
 * Usage:
 *   const perms = new SkillPermissions(manager);
 *   const decision = perms.canInvoke('deploy', { by: 'model', scope: 'project' });
 *   if (!decision.allowed) throw new Error(decision.reason);
 */

import type { SkillManager } from './skill-manager.js';
import type { Skill } from './types.js';

// ─── Types ────────────────────────────────────────────────────────

export type SkillScope = 'global' | 'project' | 'user';
export type InvocationCaller = 'model' | 'user';

export interface InvocationContext {
  /** Who is invoking the skill. Default: 'model'. */
  by?: InvocationCaller;
  /** Scope of the invocation context. Default: 'project'. */
  scope?: SkillScope;
}

export interface PermissionDecision {
  allowed: boolean;
  /** Human-readable reason when denied. */
  reason?: string;
}

export interface PermissionResult {
  allowed: boolean;
  violations: { field: string; reason: string }[];
}

// Scope hierarchy: global ⊂ project ⊂ user
const SCOPE_RANK: Record<SkillScope, number> = { global: 0, project: 1, user: 2 };

// ─── SkillPermissions ─────────────────────────────────────────────

export class SkillPermissions {
  private readonly manager: SkillManager;

  constructor(manager: SkillManager) {
    this.manager = manager;
  }

  /**
   * Whether the skill may be invoked at all (scope + model-invocation).
   */
  canInvoke(skillId: string, context?: InvocationContext): PermissionDecision {
    const skill = this.manager.get(skillId);
    if (!skill) {
      return { allowed: false, reason: `skill not found: ${skillId}` };
    }

    const by = context?.by ?? 'model';
    const scope = context?.scope ?? 'project';
    const fm = skill.frontmatter ?? {};

    // disable-model-invocation: only users may invoke
    const modelDisabled = this.boolField(fm, 'disable-model-invocation', 'disableModelInvocation');
    if (modelDisabled && by === 'model') {
      return { allowed: false, reason: `skill ${skillId} disables model invocation` };
    }

    // scope: skill scope must be reachable from the context scope
    const skillScope = this.scopeField(fm) ?? 'global';
    if (SCOPE_RANK[skillScope] > SCOPE_RANK[scope]) {
      return {
        allowed: false,
        reason: `skill ${skillId} has scope ${skillScope}, not available in ${scope}`,
      };
    }

    return { allowed: true };
  }

  /**
   * Whether the skill may use a given tool (allowed-tools).
   */
  canUseTool(skillId: string, toolName: string): PermissionDecision {
    const skill = this.manager.get(skillId);
    if (!skill) {
      return { allowed: false, reason: `skill not found: ${skillId}` };
    }

    const allowed = this.stringArrayField(skill.frontmatter ?? {}, 'allowed-tools', 'allowedTools');
    if (allowed.length === 0 || allowed.includes('*')) {
      return { allowed: true };
    }
    if (allowed.includes(toolName)) {
      return { allowed: true };
    }
    return { allowed: false, reason: `skill ${skillId} is not allowed to use tool ${toolName}` };
  }

  /**
   * Whether the given arguments are permitted (allowed-arguments).
   */
  checkArgs(skillId: string, args: Record<string, unknown>): PermissionDecision {
    const skill = this.manager.get(skillId);
    if (!skill) {
      return { allowed: false, reason: `skill not found: ${skillId}` };
    }

    const allowed = this.stringArrayField(skill.frontmatter ?? {}, 'allowed-arguments', 'allowedArguments');
    if (allowed.length === 0) {
      return { allowed: true };
    }
    const denied = Object.keys(args).filter((key) => !allowed.includes(key));
    if (denied.length > 0) {
      return {
        allowed: false,
        reason: `skill ${skillId} does not allow argument(s): ${denied.join(', ')}`,
      };
    }
    return { allowed: true };
  }

  /**
   * Full pre-invocation check: scope + model-invocation + arguments.
   */
  checkInvocation(
    skillId: string,
    args: Record<string, unknown>,
    context?: InvocationContext,
  ): PermissionResult {
    const violations: { field: string; reason: string }[] = [];

    const invoke = this.canInvoke(skillId, context);
    if (!invoke.allowed) violations.push({ field: 'invocation', reason: invoke.reason! });

    const argCheck = this.checkArgs(skillId, args);
    if (!argCheck.allowed) violations.push({ field: 'arguments', reason: argCheck.reason! });

    return { allowed: violations.length === 0, violations };
  }

  // ─── Internal ───────────────────────────────────────────────────

  private boolField(fm: Record<string, unknown>, kebab: string, camel: string): boolean {
    return fm[kebab] === true || fm[camel] === true;
  }

  private scopeField(fm: Record<string, unknown>): SkillScope | undefined {
    const raw = fm.scope;
    if (raw === 'global' || raw === 'project' || raw === 'user') return raw;
    return undefined;
  }

  private stringArrayField(fm: Record<string, unknown>, kebab: string, camel: string): string[] {
    const raw = fm[kebab] ?? fm[camel];
    if (Array.isArray(raw)) {
      return raw.filter((v): v is string => typeof v === 'string');
    }
    if (typeof raw === 'string') {
      return raw.split(',').map((v) => v.trim()).filter(Boolean);
    }
    return [];
  }
}
