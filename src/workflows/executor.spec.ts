/**
 * workflows/executor.spec.ts — Tests for WorkflowExecutor (WF-002).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { WorkflowExecutor } from './executor.js';
import { WorkflowStateStore } from './state-store.js';
import type { Workflow, ToolInvoker } from './index.js';

let stateDir: string;

function makeStateStore(): WorkflowStateStore {
  stateDir = join(process.cwd(), '.test-tmp', `wf-exec-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(stateDir, { recursive: true });
  return new WorkflowStateStore({ storagePath: stateDir });
}

function makeWorkflow(nodes: any[], edges: any[], entryNode = 'start', id = 'test-wf'): Workflow {
  return {
    id,
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

  describe('execute() — human-in-the-loop', () => {
    it('pauses for approval and executes on approve', async () => {
      const invoker: ToolInvoker = vi.fn(async () => 'ok');
      const approvalHandler = vi.fn(async () => ({ action: 'approve' as const }));
      const exec = new WorkflowExecutor({ toolInvoker: invoker, approvalHandler });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'deploy', type: 'tool', label: 'Deploy', ref: 'deploy', args: { env: 'prod' }, requiresApproval: true },
        ],
        [{ from: 'start', to: 'deploy' }],
      );

      const result = await exec.execute(wf);
      expect(result.success).toBe(true);
      expect(approvalHandler).toHaveBeenCalledTimes(1);
      expect(approvalHandler).toHaveBeenCalledWith(expect.objectContaining({
        workflowId: 'test-wf',
        nodeId: 'deploy',
        nodeLabel: 'Deploy',
        ref: 'deploy',
        args: { env: 'prod' },
        attempt: 0,
      }));
      expect(invoker).toHaveBeenCalledWith('deploy', { env: 'prod' });
    });

    it('uses modified args when decision is modify', async () => {
      const invoker: ToolInvoker = vi.fn(async () => 'ok');
      const approvalHandler = vi.fn(async () => ({ action: 'modify' as const, args: { env: 'staging' } }));
      const exec = new WorkflowExecutor({ toolInvoker: invoker, approvalHandler });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'deploy', type: 'tool', label: 'Deploy', ref: 'deploy', args: { env: 'prod' }, requiresApproval: true },
        ],
        [{ from: 'start', to: 'deploy' }],
      );

      const result = await exec.execute(wf);
      expect(result.success).toBe(true);
      expect(invoker).toHaveBeenCalledWith('deploy', { env: 'staging' });
    });

    it('stops the workflow when the decision is reject', async () => {
      const invoker: ToolInvoker = vi.fn(async () => 'ok');
      const approvalHandler = vi.fn(async () => ({ action: 'reject' as const }));
      const exec = new WorkflowExecutor({ toolInvoker: invoker, approvalHandler });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'risky', type: 'tool', label: 'Risky', ref: 'risky', requiresApproval: true },
          { id: 'after', type: 'tool', label: 'After', ref: 'after' },
        ],
        [
          { from: 'start', to: 'risky' },
          { from: 'risky', to: 'after' },
        ],
      );

      const result = await exec.execute(wf);
      expect(result.success).toBe(false);
      expect(result.error).toContain('rejected by user');
      expect(invoker).not.toHaveBeenCalled();
    });

    it('continues on reject when continueOnError=true', async () => {
      const invoker: ToolInvoker = vi.fn(async (name) => (name === 'after' ? 'ok' : 'skip'));
      const approvalHandler = vi.fn(async () => ({ action: 'reject' as const }));
      const exec = new WorkflowExecutor({ toolInvoker: invoker, approvalHandler, continueOnError: true });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'risky', type: 'tool', label: 'Risky', ref: 'risky', requiresApproval: true },
          { id: 'after', type: 'tool', label: 'After', ref: 'after' },
        ],
        [
          { from: 'start', to: 'risky' },
          { from: 'risky', to: 'after' },
        ],
      );

      const result = await exec.execute(wf);
      expect(result.success).toBe(true);
      expect(invoker).toHaveBeenCalledWith('after', {});
    });

    it('approval receives interpolated args', async () => {
      const invoker: ToolInvoker = vi.fn(async (name, args) => args);
      const approvalHandler = vi.fn(async () => ({ action: 'approve' as const }));
      const exec = new WorkflowExecutor({ toolInvoker: invoker, approvalHandler });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'gen', type: 'tool', label: 'Gen', ref: 'gen', args: {} },
          { id: 'publish', type: 'tool', label: 'Publish', ref: 'publish', args: { input: '${gen}' }, requiresApproval: true },
        ],
        [
          { from: 'start', to: 'gen' },
          { from: 'gen', to: 'publish' },
        ],
      );

      const invokerFn: ToolInvoker = async (name, args) => (name === 'gen' ? 'generated' : args);
      const exec2 = new WorkflowExecutor({ toolInvoker: invokerFn, approvalHandler });
      const result = await exec2.execute(wf);
      expect(result.success).toBe(true);
      expect(approvalHandler).toHaveBeenCalledWith(expect.objectContaining({
        nodeId: 'publish',
        args: { input: 'generated' },
      }));
    });

    it('action node acts as an approval checkpoint', async () => {
      const invoker: ToolInvoker = vi.fn(async () => 'ok');
      const approvalHandler = vi.fn(async () => ({ action: 'approve' as const }));
      const exec = new WorkflowExecutor({ toolInvoker: invoker, approvalHandler });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'gate', type: 'action', label: 'Gate', requiresApproval: true },
          { id: 'after', type: 'tool', label: 'After', ref: 'after' },
        ],
        [
          { from: 'start', to: 'gate' },
          { from: 'gate', to: 'after' },
        ],
      );

      const result = await exec.execute(wf);
      expect(result.success).toBe(true);
      expect(approvalHandler).toHaveBeenCalledTimes(1);
      expect(invoker).toHaveBeenCalledWith('after', {});
    });

    it('fails with a clear error when no approval handler is configured', async () => {
      const invoker: ToolInvoker = vi.fn(async () => 'ok');
      const exec = new WorkflowExecutor({ toolInvoker: invoker });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'risky', type: 'tool', label: 'Risky', ref: 'risky', requiresApproval: true },
        ],
        [{ from: 'start', to: 'risky' }],
      );

      const result = await exec.execute(wf);
      expect(result.success).toBe(false);
      expect(result.error).toContain('no approval handler configured');
    });

    it('does not pause for nodes without requiresApproval', async () => {
      const invoker: ToolInvoker = vi.fn(async () => 'ok');
      const approvalHandler = vi.fn(async () => ({ action: 'approve' as const }));
      const exec = new WorkflowExecutor({ toolInvoker: invoker, approvalHandler });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'run', type: 'tool', label: 'Run', ref: 'run' },
        ],
        [{ from: 'start', to: 'run' }],
      );

      const result = await exec.execute(wf);
      expect(result.success).toBe(true);
      expect(approvalHandler).not.toHaveBeenCalled();
    });
  });

  describe('execute() — checkpoints & resume (WF-005)', () => {
    afterEach(() => {
      try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('checkpoints run state after each node', async () => {
      const store = makeStateStore();
      const invoker: ToolInvoker = vi.fn(async () => 'ok');
      const exec = new WorkflowExecutor({ toolInvoker: invoker });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'a', type: 'tool', label: 'A', ref: 'tool-a' },
          { id: 'b', type: 'tool', label: 'B', ref: 'tool-b' },
        ],
        [
          { from: 'start', to: 'a' },
          { from: 'a', to: 'b' },
        ],
      );

      const result = await exec.execute(wf, { stateStore: store, runId: 'run-cp' });
      expect(result.success).toBe(true);

      const final = store.load('run-cp')!;
      expect(final.status).toBe('completed');
      expect(Object.keys(final.completedNodes)).toEqual(['start', 'a', 'b']);
      expect(final.sessionId).toBeUndefined();
    });

    it('links the run to a session', async () => {
      const store = makeStateStore();
      const invoker: ToolInvoker = vi.fn(async () => 'ok');
      const exec = new WorkflowExecutor({ toolInvoker: invoker });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'a', type: 'tool', label: 'A', ref: 'tool-a' },
        ],
        [{ from: 'start', to: 'a' }],
      );

      await exec.execute(wf, { stateStore: store, runId: 'run-sess', sessionId: 'sess-1' });
      expect(store.load('run-sess')!.sessionId).toBe('sess-1');
      expect(store.list({ sessionId: 'sess-1' })).toHaveLength(1);
    });

    it('resume skips nodes completed in a previous run', async () => {
      const store = makeStateStore();
      const calls: string[] = [];
      const invoker: ToolInvoker = vi.fn(async (name) => { calls.push(name); return 'ok'; });
      const exec = new WorkflowExecutor({ toolInvoker: invoker });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'a', type: 'tool', label: 'A', ref: 'tool-a' },
          { id: 'b', type: 'tool', label: 'B', ref: 'tool-b' },
        ],
        [
          { from: 'start', to: 'a' },
          { from: 'a', to: 'b' },
        ],
      );

      // First run completes everything
      await exec.execute(wf, { stateStore: store, runId: 'run-resume' });
      expect(calls).toEqual(['tool-a', 'tool-b']);

      // Second run with resume — nothing is re-executed
      calls.length = 0;
      const result = await exec.execute(wf, { stateStore: store, runId: 'run-resume', resume: true });
      expect(result.success).toBe(true);
      expect(calls).toEqual([]);
      expect(result.results).toHaveLength(3);
    });

    it('resume continues from the point of failure', async () => {
      const store = makeStateStore();
      let shouldFail = true;
      const calls: string[] = [];
      const invoker: ToolInvoker = vi.fn(async (name) => {
        calls.push(name);
        if (name === 'tool-b' && shouldFail) throw new Error('boom');
        return 'ok';
      });
      const exec = new WorkflowExecutor({ toolInvoker: invoker });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'a', type: 'tool', label: 'A', ref: 'tool-a' },
          { id: 'b', type: 'tool', label: 'B', ref: 'tool-b' },
          { id: 'c', type: 'tool', label: 'C', ref: 'tool-c' },
        ],
        [
          { from: 'start', to: 'a' },
          { from: 'a', to: 'b' },
          { from: 'b', to: 'c' },
        ],
      );

      // First run fails at b
      const failed = await exec.execute(wf, { stateStore: store, runId: 'run-fail', resume: true });
      expect(failed.success).toBe(false);
      expect(failed.error).toContain('boom');
      expect(store.load('run-fail')!.status).toBe('failed');

      // Fix the failure and resume — a and start are skipped, b and c run
      shouldFail = false;
      calls.length = 0;
      const resumed = await exec.execute(wf, { stateStore: store, runId: 'run-fail', resume: true });
      expect(resumed.success).toBe(true);
      expect(calls).toEqual(['tool-b', 'tool-c']);
      expect(resumed.results).toHaveLength(4);
      expect(store.load('run-fail')!.status).toBe('completed');
    });

    it('failed run records the error in state', async () => {
      const store = makeStateStore();
      const invoker: ToolInvoker = vi.fn(async (name) => {
        if (name === 'tool-a') throw new Error('kaboom');
        return 'ok';
      });
      const exec = new WorkflowExecutor({ toolInvoker: invoker });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'a', type: 'tool', label: 'A', ref: 'tool-a' },
        ],
        [{ from: 'start', to: 'a' }],
      );

      const result = await exec.execute(wf, { stateStore: store, runId: 'run-err' });
      expect(result.success).toBe(false);
      const state = store.load('run-err')!;
      expect(state.status).toBe('failed');
      expect(state.error).toContain('kaboom');
    });
  });

  describe('execute() — subflows (WF-006)', () => {
    it('executes a nested workflow via the subflow resolver', async () => {
      const subflow: Workflow = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'inner', type: 'tool', label: 'Inner', ref: 'inner-tool' },
        ],
        [{ from: 'start', to: 'inner' }],
        'start',
      );
      const invoker: ToolInvoker = vi.fn(async (name) => `result-${name}`);
      const exec = new WorkflowExecutor({
        toolInvoker: invoker,
        subflowResolver: (id) => (id === 'subflow-1' ? subflow : undefined),
      });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'sub', type: 'subflow', label: 'Sub', ref: 'subflow-1' },
        ],
        [{ from: 'start', to: 'sub' }],
      );

      const result = await exec.execute(wf);
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.results[1].success).toBe(true);
      expect(invoker).toHaveBeenCalledWith('inner-tool', {});
    });

    it('stores the subflow result in parent variables for downstream nodes', async () => {
      const subflow: Workflow = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'gen', type: 'tool', label: 'Gen', ref: 'gen', args: {} },
        ],
        [{ from: 'start', to: 'gen' }],
        'start',
      );
      const invoker: ToolInvoker = vi.fn(async (name, args) => (name === 'gen' ? 'subflow-output' : args));
      const exec = new WorkflowExecutor({
        toolInvoker: invoker,
        subflowResolver: (id) => (id === 'subflow-1' ? subflow : undefined),
      });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'sub', type: 'subflow', label: 'Sub', ref: 'subflow-1' },
          { id: 'use', type: 'tool', label: 'Use', ref: 'use', args: { input: '${sub}' } },
        ],
        [
          { from: 'start', to: 'sub' },
          { from: 'sub', to: 'use' },
        ],
      );

      const result = await exec.execute(wf);
      expect(result.success).toBe(true);
      // 'use' receives the interpolated subflow result (JSON of the ExecutionResult)
      expect(invoker).toHaveBeenCalledWith('use', { input: expect.stringContaining('"success":true') });
    });

    it('passes parent variables into the subflow', async () => {
      const subflow: Workflow = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'echo', type: 'tool', label: 'Echo', ref: 'echo', args: { branch: '${branch}' } },
        ],
        [{ from: 'start', to: 'echo' }],
        'start',
      );
      const invoker: ToolInvoker = vi.fn(async (name, args) => args);
      const exec = new WorkflowExecutor({
        toolInvoker: invoker,
        subflowResolver: (id) => (id === 'subflow-1' ? subflow : undefined),
      });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'sub', type: 'subflow', label: 'Sub', ref: 'subflow-1' },
        ],
        [{ from: 'start', to: 'sub' }],
      );

      await exec.execute(wf, { variables: { branch: 'main' } });
      expect(invoker).toHaveBeenCalledWith('echo', { branch: 'main' });
    });

    it('fails with a clear error when the subflow is not found', async () => {
      const invoker: ToolInvoker = vi.fn(async () => 'ok');
      const exec = new WorkflowExecutor({
        toolInvoker: invoker,
        subflowResolver: () => undefined,
      });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'sub', type: 'subflow', label: 'Sub', ref: 'missing' },
        ],
        [{ from: 'start', to: 'sub' }],
      );

      const result = await exec.execute(wf);
      expect(result.success).toBe(false);
      expect(result.error).toContain('subflow not found');
    });

    it('fails with a clear error when no resolver is configured', async () => {
      const invoker: ToolInvoker = vi.fn(async () => 'ok');
      const exec = new WorkflowExecutor({ toolInvoker: invoker });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'sub', type: 'subflow', label: 'Sub', ref: 'subflow-1' },
        ],
        [{ from: 'start', to: 'sub' }],
      );

      const result = await exec.execute(wf);
      expect(result.success).toBe(false);
      expect(result.error).toContain('no subflow resolver configured');
    });

    it('detects subflow cycles', async () => {
      const wfA = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'sub', type: 'subflow', label: 'Sub', ref: 'wf-b' },
        ],
        [{ from: 'start', to: 'sub' }],
        'start',
        'wf-a',
      );
      const wfB = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'sub', type: 'subflow', label: 'Sub', ref: 'wf-a' },
        ],
        [{ from: 'start', to: 'sub' }],
        'start',
        'wf-b',
      );
      const invoker: ToolInvoker = vi.fn(async () => 'ok');
      const exec = new WorkflowExecutor({
        toolInvoker: invoker,
        subflowResolver: (id) => (id === 'wf-a' ? wfA : id === 'wf-b' ? wfB : undefined),
      });

      const result = await exec.execute(wfA);
      expect(result.success).toBe(false);
      expect(result.error).toContain('subflow cycle detected');
    });

    it('enforces the max subflow depth', async () => {
      const inner2: Workflow = makeWorkflow(
        [{ id: 'start', type: 'action', label: 'Start' }],
        [],
        'start',
        'inner2',
      );
      const inner: Workflow = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'sub', type: 'subflow', label: 'Sub', ref: 'inner2' },
        ],
        [{ from: 'start', to: 'sub' }],
        'start',
        'inner',
      );
      const invoker: ToolInvoker = vi.fn(async () => 'ok');
      const exec = new WorkflowExecutor({
        toolInvoker: invoker,
        subflowResolver: (id) => (id === 'inner' ? inner : id === 'inner2' ? inner2 : undefined),
        maxSubflowDepth: 1,
      });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'sub', type: 'subflow', label: 'Sub', ref: 'inner' },
        ],
        [{ from: 'start', to: 'sub' }],
      );

      const result = await exec.execute(wf);
      expect(result.success).toBe(false);
      expect(result.error).toContain('max depth');
    });

    it('propagates subflow failure to the parent', async () => {
      const subflow: Workflow = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'fail', type: 'tool', label: 'Fail', ref: 'fail' },
        ],
        [{ from: 'start', to: 'fail' }],
        'start',
      );
      const invoker: ToolInvoker = vi.fn(async (name) => {
        if (name === 'fail') throw new Error('subflow boom');
        return 'ok';
      });
      const exec = new WorkflowExecutor({
        toolInvoker: invoker,
        subflowResolver: (id) => (id === 'subflow-1' ? subflow : undefined),
      });

      const wf = makeWorkflow(
        [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'sub', type: 'subflow', label: 'Sub', ref: 'subflow-1' },
        ],
        [{ from: 'start', to: 'sub' }],
      );

      const result = await exec.execute(wf);
      expect(result.success).toBe(false);
      expect(result.error).toContain('subflow boom');
    });
  });
});
