/**
 * rules/rule-packs.ts — Built-in rule packs (RL-004).
 *
 * Pre-built rule sets installed into the rules store (RL-001):
 * security-rules, ts-strict, react-conventions, python-style, team-standards.
 *
 * Each pack ships rules with frontmatter consumable by the rule evaluator
 * (RL-002: targets/schema/deny) and the policy engine (RL-003).
 *
 * Usage:
 *   const pack = getRulePack('security-rules');
 *   const result = installRulePack(manager, 'security-rules', { scope: 'global' });
 */

import type { RuleManager } from './rule-manager.js';
import type { Rule, CreateRuleInput, RuleScope, RuleSeverity } from './types.js';

// ─── Types ────────────────────────────────────────────────────────

export interface RulePackRule {
  /** Rule name (unique per scope). */
  name: string;
  /** Brief description. */
  description: string;
  /** Severity. Default: 'warn'. */
  severity?: RuleSeverity;
  /** Rule body (instruction). */
  body: string;
  /** Frontmatter — consumed by RL-002/RL-003. */
  frontmatter?: Record<string, unknown>;
}

export interface RulePack {
  /** Pack ID (slug). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Brief description. */
  description: string;
  /** Tags for categorization. */
  tags: string[];
  /** Default scope for installation. */
  defaultScope: RuleScope;
  /** Rules in the pack. */
  rules: RulePackRule[];
}

export interface InstallPackOptions {
  /** Scope for installed rules. Default: pack.defaultScope. */
  scope?: RuleScope;
  /** Replace existing rules with the same name. Default: false (skip). */
  overwrite?: boolean;
}

export interface InstallPackResult {
  installed: Rule[];
  skipped: { name: string; reason: string }[];
}

// ─── Built-in packs ───────────────────────────────────────────────

export const rulePacks: RulePack[] = [
  {
    id: 'security-rules',
    name: 'Security Rules',
    description: 'Guard against secrets, injection, and dangerous shell commands.',
    tags: ['security'],
    defaultScope: 'global',
    rules: [
      {
        name: 'no-secrets-in-code',
        description: 'Reject hardcoded secrets.',
        severity: 'error',
        body: 'Move secrets (api keys, passwords, tokens) to environment variables.',
        frontmatter: {
          targets: ['*'],
          check: 'input',
          deny: ['api[_-]?key\\s*=', 'password\\s*=', 'secret\\s*='],
          message: 'hardcoded secret detected',
        },
      },
      {
        name: 'no-dangerous-shell',
        description: 'Reject dangerous shell commands.',
        severity: 'error',
        body: 'Do not run destructive shell commands without review.',
        frontmatter: {
          targets: ['exec', 'shell', 'run'],
          check: 'input',
          deny: ['rm\\s+-rf', 'mkfs', 'dd\\s+if=', '>\\s*/dev/sd'],
          message: 'dangerous shell command detected',
        },
      },
      {
        name: 'confirm-destructive-tools',
        description: 'Require explicit confirmation for destructive tools.',
        severity: 'error',
        body: 'Destructive tools require an explicit confirm=true argument.',
        frontmatter: {
          targets: ['tasks:delete', 'tasks:bulk-delete', 'knowledge:delete'],
          check: 'input',
          schema: {
            type: 'object',
            required: ['confirm'],
            properties: { confirm: { type: 'boolean' } },
          },
        },
      },
    ],
  },
  {
    id: 'ts-strict',
    name: 'TypeScript Strict',
    description: 'Strict TypeScript conventions: no any, explicit types, null safety.',
    tags: ['typescript', 'strict'],
    defaultScope: 'project',
    rules: [
      {
        name: 'no-implicit-any',
        description: 'No implicit any.',
        severity: 'warn',
        body: 'Always type function parameters and avoid implicit any.',
        frontmatter: {
          targets: ['file:write', 'code:write'],
          check: 'input',
          deny: ['\\([^)]*\\bany\\b'],
          message: 'implicit any detected',
        },
      },
      {
        name: 'explicit-function-types',
        description: 'Type function parameters explicitly.',
        severity: 'info',
        body: 'Add explicit types to function parameters and return values.',
        frontmatter: {
          targets: ['file:write', 'code:write'],
          check: 'input',
        },
      },
    ],
  },
  {
    id: 'react-conventions',
    name: 'React Conventions',
    description: 'React hooks rules and component conventions.',
    tags: ['react', 'frontend'],
    defaultScope: 'project',
    rules: [
      {
        name: 'hooks-rules-of-hooks',
        description: 'Do not call hooks conditionally.',
        severity: 'error',
        body: 'Call hooks at the top level of components; never inside conditions or loops.',
        frontmatter: {
          targets: ['file:write'],
          check: 'input',
          deny: ['if\\s*\\([^)]*\\)\\s*\\{[^}]*use(State|Effect|Memo|Callback)\\s*\\('],
          message: 'conditional hook call detected',
        },
      },
      {
        name: 'no-inline-styles',
        description: 'Avoid inline style props.',
        severity: 'warn',
        body: 'Use style objects from CSS modules or a styling system instead of inline styles.',
        frontmatter: {
          targets: ['file:write'],
          check: 'input',
          deny: ['style=\\{\\{'],
          message: 'inline style object detected',
        },
      },
    ],
  },
  {
    id: 'python-style',
    name: 'Python Style',
    description: 'Python conventions: docstrings, typing, line length.',
    tags: ['python'],
    defaultScope: 'project',
    rules: [
      {
        name: 'python-docstrings',
        description: 'Public functions need docstrings.',
        severity: 'warn',
        body: 'Add a docstring to every public module, class, and function.',
        frontmatter: {
          targets: ['file:write'],
          check: 'input',
        },
      },
      {
        name: 'python-type-hints',
        description: 'Use type hints.',
        severity: 'info',
        body: 'Annotate function parameters and return types.',
        frontmatter: {
          targets: ['file:write'],
          check: 'input',
        },
      },
    ],
  },
  {
    id: 'team-standards',
    name: 'Team Standards',
    description: 'Conventional commits, PR size, and review requirements.',
    tags: ['team', 'process'],
    defaultScope: 'project',
    rules: [
      {
        name: 'conventional-commit-message',
        description: 'Commit messages follow conventional commits.',
        severity: 'warn',
        body: 'Use feat:, fix:, refactor:, docs:, chore:, test: prefixes.',
        frontmatter: {
          targets: ['git:commit'],
          check: 'input',
          schema: {
            type: 'object',
            required: ['message'],
            properties: {
              message: { type: 'string', pattern: '^(feat|fix|refactor|docs|chore|test|perf|build|ci|revert)(\\([a-z0-9-]+\\))?!?: ' },
            },
          },
        },
      },
      {
        name: 'pr-size-limit',
        description: 'PRs stay reviewable.',
        severity: 'warn',
        body: 'Keep PRs under 400 changed lines unless approved.',
        frontmatter: {
          targets: ['github:pr'],
          check: 'input',
          schema: {
            type: 'object',
            properties: {
              changedLines: { type: 'number', max: 400 },
            },
          },
        },
      },
    ],
  },
];

// ─── API ──────────────────────────────────────────────────────────

/**
 * List all built-in rule packs.
 */
export function listRulePacks(): RulePack[] {
  return rulePacks.map((p) => ({ ...p, rules: [...p.rules] }));
}

/**
 * Get a rule pack by ID.
 */
export function getRulePack(id: string): RulePack | undefined {
  return rulePacks.find((p) => p.id === id);
}

/**
 * Build CreateRuleInput entries from a pack.
 */
export function buildRulesFromPack(id: string, scope?: RuleScope): CreateRuleInput[] {
  const pack = getRulePack(id);
  if (!pack) {
    throw new Error(`[rule-packs] pack not found: ${id}`);
  }
  const effectiveScope = scope ?? pack.defaultScope;
  return pack.rules.map((rule) => ({
    name: rule.name,
    description: rule.description,
    scope: effectiveScope,
    severity: rule.severity ?? 'warn',
    body: rule.body,
    frontmatter: rule.frontmatter ?? {},
  }));
}

/**
 * Install a pack into the rule manager. Skips existing rules unless overwrite.
 */
export function installRulePack(
  manager: RuleManager,
  id: string,
  options?: InstallPackOptions,
): InstallPackResult {
  const inputs = buildRulesFromPack(id, options?.scope);
  const result: InstallPackResult = { installed: [], skipped: [] };

  for (const input of inputs) {
    const ruleId = `${input.scope}:${slugify(input.name)}`;
    const existing = manager.get(ruleId);
    if (existing && !options?.overwrite) {
      result.skipped.push({ name: input.name, reason: 'already exists (use overwrite: true to replace)' });
      continue;
    }
    if (existing) {
      result.installed.push(manager.update(ruleId, { ...input, status: 'active' }));
    } else {
      result.installed.push(manager.create(input));
    }
  }
  return result;
}

// ─── Internal ─────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
