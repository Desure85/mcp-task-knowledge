/**
 * workflows/templates.ts — Workflow templates (WF-003).
 *
 * Pre-built workflow flows that can be instantiated into real workflows:
 * code-review-pipeline, feature-dev-flow, bug-triage, release-checklist,
 * research-and-plan.
 *
 * Usage:
 *   const input = buildWorkflowFromTemplate('code-review-pipeline', { repo: 'my/repo' });
 *   const wf = installWorkflowFromTemplate(mgr, 'code-review-pipeline', { repo: 'my/repo' });
 */

import type { CreateWorkflowInput, Workflow } from './types.js';
import type { WorkflowManager } from './workflow-manager.js';

// ─── Types ────────────────────────────────────────────────────────

export interface WorkflowTemplate {
  /** Template ID (slug). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Brief description. */
  description: string;
  /** Tags for categorization. */
  tags: string[];
  /** Default workflow name when instantiated (may contain ${params}). */
  defaultName: string;
  /** Build a CreateWorkflowInput from params. */
  build(params?: Record<string, unknown>): CreateWorkflowInput;
}

// ─── Helpers ──────────────────────────────────────────────────────

/** Interpolate ${key} placeholders from params. */
function p(template: string, params: Record<string, unknown>): string {
  return template.replace(/\$\{(\w+)\}/g, (_, key: string) =>
    params[key] !== undefined ? String(params[key]) : '',
  );
}

// ─── Built-in templates ───────────────────────────────────────────

export const workflowTemplates: WorkflowTemplate[] = [
  {
    id: 'code-review-pipeline',
    name: 'Code Review Pipeline',
    description: 'Review a pull request: checkout, diff, review rules, verify, report.',
    tags: ['code-review', 'quality'],
    defaultName: 'code-review-${repo}',
    build: (params = {}) => ({
      name: params.repo !== undefined ? `code-review-${params.repo}` : 'code-review-pipeline',
      description: `Code review pipeline for ${p('${repo}', params) || 'unknown repo'}`,
      entryNode: 'start',
      nodes: [
        { id: 'start', type: 'action', label: 'Start' },
        { id: 'checkout', type: 'tool', label: 'Checkout', ref: 'git:checkout', args: { repo: p('${repo}', params) } },
        { id: 'diff', type: 'tool', label: 'Get Diff', ref: 'git:diff', args: { base: p('${base}', params), head: p('${head}', params) } },
        { id: 'review', type: 'rule', label: 'Review', ref: 'rules:code-review' },
        { id: 'verify', type: 'tool', label: 'Verify', ref: 'lint' },
        { id: 'report', type: 'action', label: 'Report' },
      ],
      edges: [
        { from: 'start', to: 'checkout' },
        { from: 'checkout', to: 'diff' },
        { from: 'diff', to: 'review' },
        { from: 'review', to: 'verify' },
        { from: 'verify', to: 'report' },
      ],
      tags: ['code-review'],
    }),
  },
  {
    id: 'feature-dev-flow',
    name: 'Feature Dev Flow',
    description: 'Implement a feature end-to-end: branch, implement, test, lint, commit, PR.',
    tags: ['dev', 'feature'],
    defaultName: 'feature-${feature}',
    build: (params = {}) => ({
      name: params.feature !== undefined ? `feature-${params.feature}` : 'feature-dev-flow',
      description: `Feature development flow for ${p('${feature}', params) || 'unknown feature'}`,
      entryNode: 'start',
      nodes: [
        { id: 'start', type: 'action', label: 'Start' },
        { id: 'branch', type: 'tool', label: 'Create Branch', ref: 'git:create-branch', args: { name: p('feat/${feature}', params) } },
        { id: 'implement', type: 'tool', label: 'Implement', ref: 'implement', args: { task: p('${task}', params) } },
        { id: 'test', type: 'tool', label: 'Test', ref: 'vitest', args: { file: p('${files}', params) } },
        { id: 'lint', type: 'tool', label: 'Lint', ref: 'lint' },
        { id: 'commit', type: 'tool', label: 'Commit', ref: 'git:commit' },
        { id: 'pr', type: 'tool', label: 'Open PR', ref: 'github:pr' },
      ],
      edges: [
        { from: 'start', to: 'branch' },
        { from: 'branch', to: 'implement' },
        { from: 'implement', to: 'test' },
        { from: 'test', to: 'lint' },
        { from: 'lint', to: 'commit' },
        { from: 'commit', to: 'pr' },
      ],
      tags: ['dev'],
    }),
  },
  {
    id: 'bug-triage',
    name: 'Bug Triage',
    description: 'Reproduce a bug, classify it, then fix or escalate.',
    tags: ['bug', 'triage'],
    defaultName: 'bug-triage-${issue}',
    build: (params = {}) => ({
      name: params.issue !== undefined ? `bug-triage-${params.issue}` : 'bug-triage',
      description: `Bug triage for ${p('${issue}', params) || 'unknown issue'}`,
      entryNode: 'start',
      nodes: [
        { id: 'start', type: 'action', label: 'Start' },
        { id: 'reproduce', type: 'tool', label: 'Reproduce', ref: 'bug:reproduce', args: { issue: p('${issue}', params) } },
        { id: 'classify', type: 'condition', label: 'Is Blocker?', condition: '${is-blocker}' },
        { id: 'fix', type: 'tool', label: 'Fix', ref: 'bug:fix', args: { issue: p('${issue}', params) } },
        { id: 'escalate', type: 'tool', label: 'Escalate', ref: 'bug:escalate', args: { issue: p('${issue}', params) } },
      ],
      edges: [
        { from: 'start', to: 'reproduce' },
        { from: 'reproduce', to: 'classify' },
        { from: 'classify', to: 'fix' },
        { from: 'classify', to: 'escalate' },
      ],
      tags: ['bug'],
    }),
  },
  {
    id: 'release-checklist',
    name: 'Release Checklist',
    description: 'Bump version, update changelog, build, test, gate on CI, publish.',
    tags: ['release', 'devops'],
    defaultName: 'release-${version}',
    build: (params = {}) => ({
      name: params.version !== undefined ? `release-${params.version}` : 'release-checklist',
      description: `Release checklist for ${p('${version}', params) || 'unknown version'}`,
      entryNode: 'start',
      nodes: [
        { id: 'start', type: 'action', label: 'Start' },
        { id: 'version', type: 'tool', label: 'Bump Version', ref: 'release:version-bump', args: { type: p('${bump}', params) } },
        { id: 'changelog', type: 'tool', label: 'Update Changelog', ref: 'release:changelog' },
        { id: 'build', type: 'tool', label: 'Build', ref: 'build' },
        { id: 'test', type: 'tool', label: 'Full Test', ref: 'test:full' },
        { id: 'gate', type: 'condition', label: 'CI Green?', condition: '${ci-green}' },
        { id: 'publish', type: 'tool', label: 'Publish', ref: 'release:publish' },
        { id: 'notify', type: 'action', label: 'Notify' },
      ],
      edges: [
        { from: 'start', to: 'version' },
        { from: 'version', to: 'changelog' },
        { from: 'changelog', to: 'build' },
        { from: 'build', to: 'test' },
        { from: 'test', to: 'gate' },
        { from: 'gate', to: 'publish' },
        { from: 'publish', to: 'notify' },
      ],
      tags: ['release'],
    }),
  },
  {
    id: 'research-and-plan',
    name: 'Research and Plan',
    description: 'Research a topic, synthesize findings, produce a plan, review it.',
    tags: ['research', 'planning'],
    defaultName: 'research-${topic}',
    build: (params = {}) => ({
      name: params.topic !== undefined ? `research-${params.topic}` : 'research-and-plan',
      description: `Research and plan for ${p('${topic}', params) || 'unknown topic'}`,
      entryNode: 'start',
      nodes: [
        { id: 'start', type: 'action', label: 'Start' },
        { id: 'research', type: 'tool', label: 'Research', ref: 'research', args: { topic: p('${topic}', params) } },
        { id: 'synthesize', type: 'rule', label: 'Synthesize', ref: 'rules:research-summary' },
        { id: 'plan', type: 'tool', label: 'Write Plan', ref: 'plan', args: { topic: p('${topic}', params) } },
        { id: 'review', type: 'rule', label: 'Review Plan', ref: 'rules:plan-review' },
        { id: 'end', type: 'action', label: 'End' },
      ],
      edges: [
        { from: 'start', to: 'research' },
        { from: 'research', to: 'synthesize' },
        { from: 'synthesize', to: 'plan' },
        { from: 'plan', to: 'review' },
        { from: 'review', to: 'end' },
      ],
      tags: ['research'],
    }),
  },
];

// ─── API ──────────────────────────────────────────────────────────

/**
 * List all available workflow templates.
 */
export function listWorkflowTemplates(): WorkflowTemplate[] {
  return workflowTemplates.map((t) => ({ ...t }));
}

/**
 * Get a workflow template by ID.
 */
export function getWorkflowTemplate(id: string): WorkflowTemplate | undefined {
  return workflowTemplates.find((t) => t.id === id);
}

/**
 * Build a CreateWorkflowInput from a template.
 */
export function buildWorkflowFromTemplate(
  id: string,
  params?: Record<string, unknown>,
): CreateWorkflowInput {
  const template = getWorkflowTemplate(id);
  if (!template) {
    throw new Error(`[workflow-templates] template not found: ${id}`);
  }
  return template.build(params);
}

/**
 * Instantiate a template into a real workflow via the manager.
 */
export function installWorkflowFromTemplate(
  mgr: WorkflowManager,
  id: string,
  params?: Record<string, unknown>,
): Workflow {
  const input = buildWorkflowFromTemplate(id, params);
  return mgr.create(input);
}
