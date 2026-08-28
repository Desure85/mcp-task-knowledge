/**
 * workflows/state-store.ts — Workflow state persistence (WF-005).
 *
 * Checkpoint store for workflow executions: saves run state (completed nodes,
 * variables, status, session linkage) to JSON so runs can be resumed after
 * crashes or aborts.
 *
 * Usage:
 *   const store = new WorkflowStateStore({ storagePath: '.workflows' });
 *   store.save(state);
 *   const state = store.load('run-123');
 *   const active = store.listActive();
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { childLogger } from '../core/logger.js';
import type { NodeResult } from './executor.js';

const log = childLogger('workflow-state-store');

// ─── Types ────────────────────────────────────────────────────────

export type RunStatus = 'running' | 'completed' | 'failed' | 'aborted';

export interface WorkflowRunState {
  /** Unique run ID. */
  runId: string;
  /** Workflow ID being executed. */
  workflowId: string;
  /** Session linkage (optional). */
  sessionId?: string;
  /** Run status. */
  status: RunStatus;
  /** Completed node results keyed by node ID (checkpoint). */
  completedNodes: Record<string, NodeResult>;
  /** Variables at the last checkpoint. */
  variables: Record<string, unknown>;
  /** Execution order seen so far (for resume). */
  executedOrder: string[];
  /** When the run started (ISO 8601). */
  startedAt: string;
  /** When the run was last updated (ISO 8601). */
  updatedAt: string;
  /** Error message (if failed). */
  error?: string;
}

// ─── Storage ──────────────────────────────────────────────────────

interface StateStorage {
  runs: Record<string, WorkflowRunState>;
}

// ─── WorkflowStateStore ───────────────────────────────────────────

export class WorkflowStateStore {
  private readonly storagePath: string;
  private readonly filePath: string;
  private storage: StateStorage;

  constructor(options?: { storagePath?: string }) {
    this.storagePath = options?.storagePath ?? '.workflows';
    this.filePath = join(this.storagePath, 'runs.json');
    this.storage = this.loadFromDisk();
  }

  /**
   * Save a run state (create or update).
   */
  save(state: WorkflowRunState): void {
    this.storage.runs[state.runId] = state;
    this.saveToDisk();
    log.debug({ runId: state.runId, status: state.status }, 'run state saved');
  }

  /**
   * Load a run state by ID.
   */
  load(runId: string): WorkflowRunState | undefined {
    return this.storage.runs[runId];
  }

  /**
   * List run states, newest first, optionally filtered by status or workflow.
   */
  list(filter?: { status?: RunStatus; workflowId?: string; sessionId?: string }): WorkflowRunState[] {
    let runs = Object.values(this.storage.runs);
    if (filter?.status) runs = runs.filter((r) => r.status === filter.status);
    if (filter?.workflowId) runs = runs.filter((r) => r.workflowId === filter.workflowId);
    if (filter?.sessionId) runs = runs.filter((r) => r.sessionId === filter.sessionId);
    return runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * Active (running) runs.
   */
  listActive(): WorkflowRunState[] {
    return this.list({ status: 'running' });
  }

  /**
   * Delete a run state.
   */
  delete(runId: string): boolean {
    if (!this.storage.runs[runId]) return false;
    delete this.storage.runs[runId];
    this.saveToDisk();
    return true;
  }

  /**
   * Delete run states older than the given ISO timestamp.
   */
  deleteOlderThan(timestamp: string): number {
    let removed = 0;
    for (const [id, run] of Object.entries(this.storage.runs)) {
      if (run.updatedAt < timestamp) {
        delete this.storage.runs[id];
        removed++;
      }
    }
    if (removed > 0) this.saveToDisk();
    return removed;
  }

  clear(): void {
    this.storage = { runs: {} };
    this.saveToDisk();
  }

  get count(): number {
    return Object.keys(this.storage.runs).length;
  }

  // ─── Internal ───────────────────────────────────────────────────

  private loadFromDisk(): StateStorage {
    try {
      if (existsSync(this.filePath)) {
        return JSON.parse(readFileSync(this.filePath, 'utf8')) as StateStorage;
      }
    } catch (err) {
      log.warn({ err }, 'failed to load run states, starting fresh');
    }
    return { runs: {} };
  }

  private saveToDisk(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.storage, null, 2), 'utf8');
    } catch (err) {
      log.error({ err }, 'failed to save run states');
    }
  }
}
