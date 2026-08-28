/**
 * workflows/templates.spec.ts — Tests for workflow templates (WF-003).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { WorkflowManager } from './workflow-manager.js';
import {
  workflowTemplates, listWorkflowTemplates, getWorkflowTemplate,
  buildWorkflowFromTemplate, installWorkflowFromTemplate,
} from './templates.js';

let testDir: string;

describe('WF-003: Workflow templates', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `wf-tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('listWorkflowTemplates()', () => {
    it('returns all 5 built-in templates', () => {
      const templates = listWorkflowTemplates();
      expect(templates.map((t) => t.id).sort()).toEqual([
        'bug-triage', 'code-review-pipeline', 'feature-dev-flow',
        'release-checklist', 'research-and-plan',
      ]);
    });
  });

  describe('getWorkflowTemplate()', () => {
    it('returns a template by id', () => {
      const t = getWorkflowTemplate('code-review-pipeline');
      expect(t).toBeDefined();
      expect(t!.name).toBe('Code Review Pipeline');
      expect(t!.tags).toContain('code-review');
    });

    it('returns undefined for unknown id', () => {
      expect(getWorkflowTemplate('nope')).toBeUndefined();
    });
  });

  describe('buildWorkflowFromTemplate()', () => {
    it('throws on unknown template id', () => {
      expect(() => buildWorkflowFromTemplate('nope')).toThrow(/template not found/);
    });

    it('builds a structurally valid workflow for every template', () => {
      for (const t of workflowTemplates) {
        const input = buildWorkflowFromTemplate(t.id);
        expect(input.nodes.length).toBeGreaterThan(0);
        expect(input.edges.length).toBeGreaterThan(0);
        expect(input.entryNode).toBeTruthy();
        // entry node exists
        expect(input.nodes.some((n) => n.id === input.entryNode)).toBe(true);
        // edges reference known nodes
        const ids = new Set(input.nodes.map((n) => n.id));
        for (const e of input.edges) {
          expect(ids.has(e.from)).toBe(true);
          expect(ids.has(e.to)).toBe(true);
        }
      }
    });

    it('instantiates a valid DAG for every template via the manager', () => {
      for (const t of workflowTemplates) {
        const mgr = new WorkflowManager({ storagePath: testDir });
        const input = buildWorkflowFromTemplate(t.id);
        // create() validates DAG (cycle detection) and entry node — must not throw
        const wf = mgr.create({ ...input, name: `${t.id}-${Date.now()}` });
        expect(wf.nodes.length).toBe(input.nodes.length);
      }
    });

    it('interpolates params into node args and workflow name', () => {
      const input = buildWorkflowFromTemplate('code-review-pipeline', {
        repo: 'acme/app', base: 'main', head: 'feat/x',
      });
      expect(input.name).toBe('code-review-acme/app');
      const checkout = input.nodes.find((n) => n.id === 'checkout')!;
      expect(checkout.args).toEqual({ repo: 'acme/app' });
      const diff = input.nodes.find((n) => n.id === 'diff')!;
      expect(diff.args).toEqual({ base: 'main', head: 'feat/x' });
    });

    it('falls back to a default workflow name when params are missing', () => {
      const input = buildWorkflowFromTemplate('research-and-plan');
      expect(input.name).toBe('research-and-plan');
    });

    it('bug-triage contains a condition branch', () => {
      const input = buildWorkflowFromTemplate('bug-triage');
      expect(input.nodes.some((n) => n.type === 'condition')).toBe(true);
      // classify feeds both fix and escalate
      const classifyOut = input.edges.filter((e) => e.from === 'classify');
      expect(classifyOut.map((e) => e.to).sort()).toEqual(['escalate', 'fix']);
    });
  });

  describe('installWorkflowFromTemplate()', () => {
    it('creates a real workflow via the manager', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      const wf = installWorkflowFromTemplate(mgr, 'feature-dev-flow', { feature: 'auth' });
      expect(wf.id).toBe('feature-auth');
      expect(wf.status).toBe('draft');
      expect(mgr.get(wf.id)).toBeDefined();
    });

    it('throws on unknown template id', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      expect(() => installWorkflowFromTemplate(mgr, 'nope')).toThrow(/template not found/);
    });

    it('throws on duplicate workflow name', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      installWorkflowFromTemplate(mgr, 'release-checklist', { version: '1.2.3' });
      expect(() => installWorkflowFromTemplate(mgr, 'release-checklist', { version: '1.2.3' }))
        .toThrow(/already exists/);
    });
  });
});
