/**
 * skills/skill-templates.ts — Pre-built skill templates (SK-004).
 *
 * Ready-to-install skills: code-review, deploy, test-gen, refactor, debug,
 * architecture-review. Bodies use $ARGUMENTS / ${VARS} placeholders rendered
 * by SkillPipeline (SK-002).
 *
 * Usage:
 *   const input = buildSkillFromTemplate('code-review', { language: 'typescript' });
 *   const skill = installSkillFromTemplate(mgr, 'code-review');
 */

import type { CreateSkillInput, Skill } from './types.js';
import type { SkillManager } from './skill-manager.js';

// ─── Types ────────────────────────────────────────────────────────

export interface SkillTemplate {
  /** Template ID (slug). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Brief description. */
  description: string;
  /** Tags for categorization. */
  tags: string[];
  /** Category (used by SkillDiscovery catalog). */
  category: string;
  /** Build a CreateSkillInput from params. */
  build(params?: Record<string, unknown>): CreateSkillInput;
}

// ─── Helpers ──────────────────────────────────────────────────────

/** Interpolate ${key} placeholders from params. */
function p(template: string, params: Record<string, unknown>): string {
  return template.replace(/\$\{(\w+)\}/g, (_, key: string) =>
    params[key] !== undefined ? String(params[key]) : '',
  );
}

// ─── Built-in templates ───────────────────────────────────────────

export const skillTemplates: SkillTemplate[] = [
  {
    id: 'code-review',
    name: 'Code Review',
    description: 'Review code for quality, correctness, and security issues.',
    tags: ['quality', 'review'],
    category: 'quality',
    build: (params = {}) => ({
      name: 'code-review',
      description: 'Review code for quality, correctness, and security issues.',
      body: `# Code Review

Review the provided ${p('${language}', params) || 'code'} for:
1. Correctness — does the logic do what it claims?
2. Error handling — are edge cases covered?
3. Security — any injection, XSS, or secret leakage risks?
4. Performance — obvious bottlenecks?

Files: $ARGUMENTS
Return findings ordered by severity with file:line references.`,
      tags: ['quality', 'review'],
      frontmatter: { category: 'quality', triggers: ['code review', 'review code'] },
    }),
  },
  {
    id: 'deploy',
    name: 'Deploy',
    description: 'Deploy an application or service to a target environment.',
    tags: ['devops', 'release'],
    category: 'devops',
    build: (params = {}) => ({
      name: 'deploy',
      description: 'Deploy an application or service to a target environment.',
      body: `# Deploy

Deploy ${p('${service}', params) || 'the service'} to ${p('${env}', params) || 'production'}.

Steps:
1. Verify CI is green on the target commit.
2. Run migrations (if any) — backup first.
3. Deploy artifact: $ARGUMENTS
4. Smoke-test health endpoints after rollout.
5. Rollback plan: redeploy previous version if health checks fail.`,
      tags: ['devops', 'release'],
      frontmatter: { category: 'devops', triggers: ['deploy'] },
    }),
  },
  {
    id: 'test-gen',
    name: 'Test Generator',
    description: 'Generate unit tests for the given code or module.',
    tags: ['testing', 'quality'],
    category: 'quality',
    build: (params = {}) => ({
      name: 'test-gen',
      description: 'Generate unit tests for the given code or module.',
      body: `# Test Generation

Generate unit tests for: $ARGUMENTS

Framework: ${p('${framework}', params) || 'vitest'}

Cover:
1. Happy path.
2. Edge cases (empty input, null, invalid values).
3. Error paths (thrown exceptions).
4. Boundary values.

Match existing test conventions in the repo. Do not modify source code.`,
      tags: ['testing', 'quality'],
      frontmatter: { category: 'quality', triggers: ['generate tests', 'test-gen', 'write tests'] },
    }),
  },
  {
    id: 'refactor',
    name: 'Refactor',
    description: 'Refactor code while preserving behavior.',
    tags: ['refactoring', 'clean-code'],
    category: 'refactoring',
    build: (params = {}) => ({
      name: 'refactor',
      description: 'Refactor code while preserving behavior.',
      body: `# Refactor

Refactor: $ARGUMENTS

Goals:
1. Preserve external behavior — run the existing test suite before and after.
2. Reduce duplication and nesting.
3. Improve naming and module boundaries.
4. Keep the change small and reviewable.

Constraints:
- Do not change public APIs unless asked.
- Keep the diff under ${p('${maxDiff}', params) || '200'} lines unless approved.`,
      tags: ['refactoring', 'clean-code'],
      frontmatter: { category: 'refactoring', triggers: ['refactor'] },
    }),
  },
  {
    id: 'debug',
    name: 'Debug',
    description: 'Diagnose and fix a bug from failure details.',
    tags: ['debugging', 'bugfix'],
    category: 'debugging',
    build: (params = {}) => ({
      name: 'debug',
      description: 'Diagnose and fix a bug from failure details.',
      body: `# Debug

Failure: $ARGUMENTS

Process:
1. Reproduce the failure reliably.
2. Trace the code path — identify the root cause, not the symptom.
3. Write a failing test first.
4. Apply the minimal fix.
5. Verify the test passes and the full suite stays green.

Report: root cause, fix, and what was tried that did not work.`,
      tags: ['debugging', 'bugfix'],
      frontmatter: { category: 'debugging', triggers: ['debug', 'fix bug', 'bug'] },
    }),
  },
  {
    id: 'architecture-review',
    name: 'Architecture Review',
    description: 'Review module or system architecture against best practices.',
    tags: ['architecture', 'review'],
    category: 'architecture',
    build: (params = {}) => ({
      name: 'architecture-review',
      description: 'Review module or system architecture against best practices.',
      body: `# Architecture Review

Review the architecture of: $ARGUMENTS

Evaluate:
1. Module boundaries and dependencies (aim: acyclic, layered).
2. Data flow — is state management clear?
3. Extensibility — can new features be added without core changes?
4. Testability — are components easy to unit-test?
5. Risks — coupling, hidden globals, premature optimization.

Output: findings with severity, rationale, and concrete suggestions.`,
      tags: ['architecture', 'review'],
      frontmatter: { category: 'architecture', triggers: ['architecture review', 'arch review'] },
    }),
  },
];

// ─── API ──────────────────────────────────────────────────────────

/**
 * List all available skill templates.
 */
export function listSkillTemplates(): SkillTemplate[] {
  return skillTemplates.map((t) => ({ ...t }));
}

/**
 * Get a skill template by ID.
 */
export function getSkillTemplate(id: string): SkillTemplate | undefined {
  return skillTemplates.find((t) => t.id === id);
}

/**
 * Build a CreateSkillInput from a template.
 */
export function buildSkillFromTemplate(
  id: string,
  params?: Record<string, unknown>,
): CreateSkillInput {
  const template = getSkillTemplate(id);
  if (!template) {
    throw new Error(`[skill-templates] template not found: ${id}`);
  }
  return template.build(params);
}

/**
 * Install a template into a real skill via the manager.
 */
export function installSkillFromTemplate(
  mgr: SkillManager,
  id: string,
  params?: Record<string, unknown>,
): Skill {
  const input = buildSkillFromTemplate(id, params);
  return mgr.create(input);
}
