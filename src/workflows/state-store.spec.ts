/**
 * workflows/state-store.spec.ts — Tests for WorkflowStateStore (WF-005).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { WorkflowStateStore } from './state-store.js';
import type { WorkflowRunState } from './state-store.js';

let testDir: string;
let store: WorkflowStateStore;

function makeState(overrides?: Partial<WorkflowRunState>): WorkflowRunState {
  return {
    runId: 'run-1',
    workflowId: 'wf-a',
    status: 'running',
    completedNodes: {},
    variables: {},
    executedOrder: [],
    startedAt: '2026-08-28T10:00:00.000Z',
    updatedAt: '2026-08-28T10:00:00.000Z',
    ...overrides,
  };
}

describe('WF-005: WorkflowStateStore', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `wf-state-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    store = new WorkflowStateStore({ storagePath: testDir });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('saves and loads a run state', () => {
    const state = makeState({ status: 'completed', completedNodes: { a: { nodeId: 'a', success: true, durationMs: 1, retries: 0 } } });
    store.save(state);

    const loaded = store.load('run-1');
    expect(loaded).toEqual(state);
  });

  it('lists runs newest first with filters', () => {
    store.save(makeState({ runId: 'run-1', workflowId: 'wf-a', status: 'completed', updatedAt: '2026-08-28T10:00:00.000Z' }));
    store.save(makeState({ runId: 'run-2', workflowId: 'wf-b', status: 'running', sessionId: 'sess-9', updatedAt: '2026-08-28T11:00:00.000Z' }));
    store.save(makeState({ runId: 'run-3', workflowId: 'wf-a', status: 'failed', updatedAt: '2026-08-28T12:00:00.000Z' }));

    const all = store.list();
    expect(all.map((r) => r.runId)).toEqual(['run-3', 'run-2', 'run-1']);

    expect(store.list({ status: 'failed' }).map((r) => r.runId)).toEqual(['run-3']);
    expect(store.list({ workflowId: 'wf-a' }).map((r) => r.runId)).toEqual(['run-3', 'run-1']);
    expect(store.list({ sessionId: 'sess-9' }).map((r) => r.runId)).toEqual(['run-2']);
    expect(store.listActive().map((r) => r.runId)).toEqual(['run-2']);
  });

  it('deletes a run', () => {
    store.save(makeState());
    expect(store.delete('run-1')).toBe(true);
    expect(store.delete('run-1')).toBe(false);
    expect(store.count).toBe(0);
  });

  it('deleteOlderThan removes old runs', () => {
    store.save(makeState({ runId: 'old', updatedAt: '2026-08-01T00:00:00.000Z' }));
    store.save(makeState({ runId: 'new', updatedAt: '2026-08-28T00:00:00.000Z' }));

    const removed = store.deleteOlderThan('2026-08-15T00:00:00.000Z');
    expect(removed).toBe(1);
    expect(store.load('old')).toBeUndefined();
    expect(store.load('new')).toBeDefined();
  });

  it('persists across instances sharing storage', () => {
    store.save(makeState({ status: 'completed' }));
    const other = new WorkflowStateStore({ storagePath: testDir });
    expect(other.load('run-1')!.status).toBe('completed');
  });

  it('clear removes all runs', () => {
    store.save(makeState());
    store.clear();
    expect(store.count).toBe(0);
  });
});
