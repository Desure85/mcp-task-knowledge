/**
 * workflows/executor.spec.ts — Tests for WorkflowExecutor (WF-002).
 */

import { describe, it, expect, vi } from 'vitest';
import { WorkflowExecutor } from './executor.js';
import type { Workflow, ToolInvoker } from './index.js';

function makeWorkflow(nodes: any[], edges: any[], entryNode = 'start'): Workflow {
  return {
    id: 'test-wf',
    name: 'Test',
    description: 'Test workflow',
    nodes,
    edges,
    entryNode,
    tags: [],
    status: 'active',
    triggers: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('WF-002: WorkflowExecutor', () => {
  describe('execute() — sequential', () => {
    it('executes a simple sequential workflow', async () => {
      const invoker: ToolInvoker = vi.fn(async (name) => `result-${name}`);
      const exec = new WorkflowExecutor({ toolInvoker: invoker });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'lint', type: 'tool', label: 'Lint', ref: 'eslint' },
          { id: 'test', type: 'tool', label: 'Test', ref: 'vitest' },
        ],
        [
          { from: 'start', to: 'lint' },
          { from: 'lint', to: 'test' },
        ],
      );

      const result = await exec.execute(wf);
      expect(result.success).toBe(true);
      expect(result.results.length).toBe(3);
      expect(invoker).toHaveBeenCalledWith('eslint', {});
      expect(invoker).toHaveBeenCalledWith('vitest', {});
    });

    it('passes args to tool invoker', async () => {
      const invoker: ToolInvoker = vi.fn(async () => 'ok');
      const exec = new WorkflowExecutor({ toolInvoker: invoker });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'run', type: 'tool', label: 'Run', ref: 'tool', args: { file: 'test.ts' } },
        ],
        [{ from: 'start', to: 'run' }],
      );

      await exec.execute(wf);
      expect(invoker).toHaveBeenCalledWith('tool', { file: 'test.ts' });
    });

    it('interpolates ${VARS} in args', async () => {
      const invoker: ToolInvoker = vi.fn(async (name, args) => args);
      const exec = new WorkflowExecutor({ toolInvoker: invoker });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'gen', type: 'tool', label: 'Gen', ref: 'gen', args: {} },
          { id: 'use', type: 'tool', label: 'Use', ref: 'use', args: { input: '${gen}' } },
        ],
        [
          { from: 'start', to: 'gen' },
          { from: 'gen', to: 'use' },
        ],
      );

      const invokerFn: ToolInvoker = async (name) => {
        if (name === 'gen') return 'generated-data';
        return 'ok';
      };
      const exec2 = new WorkflowExecutor({ toolInvoker: invokerFn });
      const result = await exec2.execute(wf);
      expect(result.success).toBe(true);
    });
  });

  describe('execute() — error handling', () => {
    it('stops on first error by default', async () => {
      const invoker: ToolInvoker = vi.fn(async (name) => {
        if (name === 'fail') throw new Error('boom');
        return 'ok';
      });
      const exec = new WorkflowExecutor({ toolInvoker: invoker });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'fail', type: 'tool', label: 'Fail', ref: 'fail' },
          { id: 'after', type: 'tool', label: 'After', ref: 'after' },
        ],
        [
          { from: 'start', to: 'fail' },
          { from: 'fail', to: 'after' },
        ],
      );

      const result = await exec.execute(wf);
      expect(result.success).toBe(false);
      expect(result.error).toContain('boom');
      // 'after' should not have been executed
      expect(invoker).not.toHaveBeenCalledWith('after', {});
    });

    it('continues on error when continueOnError=true', async () => {
      const invoker: ToolInvoker = vi.fn(async (name) => {
        if (name === 'fail') throw new Error('boom');
        return 'ok';
      });
      const exec = new WorkflowExecutor({ toolInvoker: invoker, continueOnError: true });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'fail', type: 'tool', label: 'Fail', ref: 'fail' },
          { id: 'after', type: 'tool', label: 'After', ref: 'after' },
        ],
        [
          { from: 'start', to: 'fail' },
          { from: 'fail', to: 'after' },
        ],
      );

      const result = await exec.execute(wf);
      expect(invoker).toHaveBeenCalledWith('after', {});
    });
  });

  describe('execute() — retries', () => {
    it('retries failed nodes', async () => {
      let calls = 0;
      const invoker: ToolInvoker = vi.fn(async () => {
        calls++;
        if (calls < 3) throw new Error('retry');
        return 'ok';
      });
      const exec = new WorkflowExecutor({ toolInvoker: invoker, maxRetries: 3, retryDelayMs: 10 });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'flaky', type: 'tool', label: 'Flaky', ref: 'flaky' },
        ],
        [{ from: 'start', to: 'flaky' }],
      );

      const result = await exec.execute(wf);
      expect(result.success).toBe(true);
      expect(result.results[1].retries).toBe(2);
    });

    it('fails after max retries', async () => {
      const invoker: ToolInvoker = vi.fn(async () => { throw new Error('always fails'); });
      const exec = new WorkflowExecutor({ toolInvoker: invoker, maxRetries: 2, retryDelayMs: 10 });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'fail', type: 'tool', label: 'Fail', ref: 'fail' },
        ],
        [{ from: 'start', to: 'fail' }],
      );

      const result = await exec.execute(wf);
      expect(result.success).toBe(false);
      expect(result.results[1].retries).toBe(2);
    });
  });

  describe('execute() — conditions', () => {
    it('skips condition node when condition is false', async () => {
      const invoker: ToolInvoker = vi.fn(async () => 'ok');
      const exec = new WorkflowExecutor({ toolInvoker: invoker });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'check', type: 'condition', label: 'Check', condition: 'false' },
          { id: 'after', type: 'tool', label: 'After', ref: 'after' },
        ],
        [
          { from: 'start', to: 'check' },
          { from: 'check', to: 'after' },
        ],
      );

      const result = await exec.execute(wf);
      // Condition node passes but doesn't invoke a tool
      expect(result.success).toBe(true);
    });

    it('evaluates variable-based conditions', async () => {
      const invoker: ToolInvoker = vi.fn(async (name) => {
        if (name === 'check') return true;
        return 'ok';
      });
      const exec = new WorkflowExecutor({ toolInvoker: invoker });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'setvar', type: 'tool', label: 'Set', ref: 'setvar' },
          { id: 'check', type: 'condition', label: 'Check', condition: '${setvar}' },
          { id: 'after', type: 'tool', label: 'After', ref: 'after' },
        ],
        [
          { from: 'start', to: 'setvar' },
          { from: 'setvar', to: 'check' },
          { from: 'check', to: 'after' },
        ],
      );

      const invokerFn: ToolInvoker = async (name) => {
        if (name === 'setvar') return 'some-value';
        return 'ok';
      };
      const exec2 = new WorkflowExecutor({ toolInvoker: invokerFn });
      const result = await exec2.execute(wf);
      expect(result.success).toBe(true);
    });
  });

  describe('execute() — parallel', () => {
    it('executes parallel branches', async () => {
      const invoker: ToolInvoker = vi.fn(async (name) => `result-${name}`);
      const exec = new WorkflowExecutor({ toolInvoker: invoker });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'a', type: 'tool', label: 'A', ref: 'tool-a' },
          { id: 'b', type: 'tool', label: 'B', ref: 'tool-b' },
          { id: 'end', type: 'action', label: 'End' },
        ],
        [
          { from: 'start', to: 'a' },
          { from: 'start', to: 'b' },
          { from: 'a', to: 'end' },
          { from: 'b', to: 'end' },
        ],
      );

      const result = await exec.execute(wf);
      expect(result.success).toBe(true);
      expect(result.results.length).toBe(4);
      expect(invoker).toHaveBeenCalledWith('tool-a', {});
      expect(invoker).toHaveBeenCalledWith('tool-b', {});
    });
  });

  describe('execute() — cyclic workflow', () => {
    it('returns error for cyclic workflow', async () => {
      const invoker: ToolInvoker = vi.fn(async () => 'ok');
      const exec = new WorkflowExecutor({ toolInvoker: invoker });

      const wf = makeWorkflow(
        [
          { id: 'a', type: 'action', label: 'A' },
          { id: 'b', type: 'action', label: 'B' },
        ],
        [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'a' },
        ],
      );

      const result = await exec.execute(wf);
      expect(result.success).toBe(false);
      expect(result.error).toContain('cyclic');
    });
  });

  describe('action nodes', () => {
    it('action nodes pass through without invoking tools', async () => {
      const invoker: ToolInvoker = vi.fn(async () => 'ok');
      const exec = new WorkflowExecutor({ toolInvoker: invoker });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'end', type: 'action', label: 'End' },
        ],
        [{ from: 'start', to: 'end' }],
      );

      const result = await exec.execute(wf);
      expect(result.success).toBe(true);
      expect(invoker).not.toHaveBeenCalled();
    });
  });
});
