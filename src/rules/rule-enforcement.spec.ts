/**
 * rules/rule-enforcement.spec.ts — Tests for rule enforcement hooks (RL-005).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { RuleManager } from './rule-manager.js';
import { RuleEvaluator } from './rule-evaluator.js';
import { RuleEnforcementMiddleware, createRuleEnforcement } from './rule-enforcement.js';
import { MiddlewarePipeline, MiddlewareContext } from '../core/middleware.js';
import { ToolDeniedError } from '../core/tool-executor.js';
import type { ToolContext } from '../core/tool-executor.js';

let testDir: string;
let manager: RuleManager;
let evaluator: RuleEvaluator;

function makeCtx(toolName: string, input: Record<string, unknown>): MiddlewareContext {
  return new MiddlewareContext(toolName, input, { sessionId: 's1' } as ToolContext);
}

function seedRules(): void {
  manager.create({
    name: 'delete-guard',
    description: 'Guard destructive deletes',
    scope: 'global',
    severity: 'error',
    body: 'Confirmation required for deletes.',
    frontmatter: {
      targets: ['tasks:delete'],
      schema: { type: 'object', required: ['confirm'], properties: { confirm: { type: 'boolean' } } },
    },
  });
  manager.create({
    name: 'auto-confirm',
    description: 'Auto-fix missing confirm flag',
    scope: 'global',
    severity: 'error',
    body: 'Confirm flag required.',
    frontmatter: {
      targets: ['tasks:archive'],
      schema: { type: 'object', required: ['confirm'] },
      fix: { path: 'confirm', value: true },
    },
  });
  manager.create({
    name: 'output-shape',
    description: 'Output must contain id',
    scope: 'global',
    severity: 'error',
    body: 'Output shape check.',
    frontmatter: {
      targets: ['search'],
      check: 'output',
      schema: { type: 'object', required: ['id'] },
    },
  });
}

describe('RL-005: RuleEnforcementMiddleware', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `rl5-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    manager = new RuleManager({ storagePath: testDir });
    evaluator = new RuleEvaluator(manager);
    seedRules();
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('before() — enforce mode', () => {
    it('blocks a tool call with error-severity violations', async () => {
      const mw = createRuleEnforcement({ evaluator, scope: 'project', mode: 'enforce' });
      const pipeline = new MiddlewarePipeline();
      pipeline.use(mw);

      const handler = vi.fn(async () => 'ok');
      await expect(pipeline.run(makeCtx('tasks:delete', {}), handler)).rejects.toThrow(ToolDeniedError);
      expect(handler).not.toHaveBeenCalled();
    });

    it('allows a compliant call through', async () => {
      const mw = createRuleEnforcement({ evaluator, scope: 'project', mode: 'enforce' });
      const pipeline = new MiddlewarePipeline();
      pipeline.use(mw);

      const handler = vi.fn(async () => 'ok');
      const result = await pipeline.run(makeCtx('tasks:delete', { confirm: true }), handler);
      expect(result).toBe('ok');
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('before() — warn/log modes', () => {
    it('warn mode logs violations but continues', async () => {
      const mw = createRuleEnforcement({ evaluator, scope: 'project', mode: 'warn' });
      const pipeline = new MiddlewarePipeline();
      pipeline.use(mw);

      const handler = vi.fn(async () => 'ok');
      const result = await pipeline.run(makeCtx('tasks:delete', {}), handler);
      expect(result).toBe('ok');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('log mode continues for warn-severity rules', async () => {
      manager.create({
        name: 'soft-limit',
        description: 'Soft warning',
        scope: 'global',
        severity: 'warn',
        body: 'warn',
        frontmatter: {
          targets: ['tasks:create'],
          schema: { type: 'object', required: ['title'] },
        },
      });
      const mw = createRuleEnforcement({ evaluator, scope: 'project', mode: 'log' });
      const pipeline = new MiddlewarePipeline();
      pipeline.use(mw);

      const handler = vi.fn(async () => 'ok');
      const result = await pipeline.run(makeCtx('tasks:create', {}), handler);
      expect(result).toBe('ok');
    });
  });

  describe('after() — output enforcement', () => {
    it('marks the result as denied when output violates rules', async () => {
      const mw = createRuleEnforcement({ evaluator, scope: 'project', mode: 'enforce' });
      const pipeline = new MiddlewarePipeline();
      pipeline.use(mw);

      const handler = vi.fn(async () => ({ query: 'x' }));
      const result = await pipeline.run(makeCtx('search', {}), handler);
      expect(result).toMatchObject({ denied: true, toolName: 'search' });
      expect((result as { error: string }).error).toContain('output.id');
    });

    it('passes valid output through', async () => {
      const mw = createRuleEnforcement({ evaluator, scope: 'project', mode: 'enforce' });
      const pipeline = new MiddlewarePipeline();
      pipeline.use(mw);

      const handler = vi.fn(async () => ({ id: '1' }));
      const result = await pipeline.run(makeCtx('search', {}), handler);
      expect(result).toEqual({ id: '1' });
    });
  });

  describe('autoFix', () => {
    it('patches input before the handler runs', async () => {
      const mw = createRuleEnforcement({ evaluator, scope: 'project', mode: 'enforce', autoFix: true });
      const pipeline = new MiddlewarePipeline();
      pipeline.use(mw);

      const handler = vi.fn(async (input: Record<string, unknown>) => input);
      const ctx = makeCtx('tasks:archive', {});
      const result = await pipeline.run(ctx, () => handler(ctx.input));
      expect(result).toEqual({ confirm: true });
    });
  });

  describe('targets filter', () => {
    it('skips tools not matching targets', async () => {
      const mw = createRuleEnforcement({
        evaluator, scope: 'project', mode: 'enforce', targets: ['tasks:*'],
      });
      const pipeline = new MiddlewarePipeline();
      pipeline.use(mw);

      const handler = vi.fn(async () => 'ok');
      const result = await pipeline.run(makeCtx('knowledge:get', {}), handler);
      expect(result).toBe('ok');
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
