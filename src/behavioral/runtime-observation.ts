/**
 * behavioral/runtime-observation.ts — Runtime observation (BM-002).
 *
 * MCP tool `record_runtime` — records function execution.
 * Captures: args, return value, duration, errors, stack trace.
 * Links to intent via `memory_id`.
 * Observer API for ESM (manual) + CJS hook (auto-instrument, future).
 *
 * Usage:
 *   const obs = new RuntimeObservation({ storagePath: '.behavioral' });
 *   const snapshot = await obs.record({
 *     memoryId: 'intent-abc123',
 *     functionName: 'authenticate',
 *     args: { user: 'alice', token: '...' },
 *     returnValue: { success: true },
 *     durationMs: 42,
 *     success: true,
 *   });
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { childLogger } from '../core/logger.js';

const log = childLogger('runtime-observation');

// ─── Types ────────────────────────────────────────────────────────

export interface RuntimeSnapshot {
  /** Unique snapshot ID. */
  snapshotId: string;
  /** Linked intent memory ID. */
  memoryId: string;
  /** Function that was observed. */
  functionName: string;
  /** Arguments passed to the function. */
  args: Record<string, unknown>;
  /** Return value (if success). */
  returnValue?: unknown;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Whether the execution succeeded. */
  success: boolean;
  /** Error message (if failed). */
  error?: string;
  /** Stack trace (if failed). */
  stackTrace?: string;
  /** When the snapshot was recorded (ISO 8601). */
  timestamp: string;
}

export interface RuntimeObservationOptions {
  storagePath?: string;
  /** Max snapshots to keep (0 = unlimited). Default: 1000. */
  maxSnapshots?: number;
}

// ─── Storage Format ───────────────────────────────────────────────

interface ObservationStorage {
  snapshots: RuntimeSnapshot[];
}

// ─── RuntimeObservation ───────────────────────────────────────────

export class RuntimeObservation {
  private readonly storagePath: string;
  private readonly filePath: string;
  private readonly maxSnapshots: number;
  private storage: ObservationStorage;

  constructor(options?: RuntimeObservationOptions) {
    this.storagePath = options?.storagePath ?? '.behavioral';
    this.filePath = join(this.storagePath, 'observations.json');
    this.maxSnapshots = options?.maxSnapshots ?? 1000;
    this.storage = this.load();
  }

  /**
   * Record a runtime snapshot.
   */
  record(input: {
    memoryId: string;
    functionName: string;
    args: Record<string, unknown>;
    returnValue?: unknown;
    durationMs: number;
    success: boolean;
    error?: string;
    stackTrace?: string;
  }): RuntimeSnapshot {
    const snapshot: RuntimeSnapshot = {
      snapshotId: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      memoryId: input.memoryId,
      functionName: input.functionName,
      args: input.args,
      returnValue: input.returnValue,
      durationMs: input.durationMs,
      success: input.success,
      error: input.error,
      stackTrace: input.stackTrace,
      timestamp: new Date().toISOString(),
    };

    this.storage.snapshots.push(snapshot);

    // Trim if over limit
    if (this.maxSnapshots > 0 && this.storage.snapshots.length > this.maxSnapshots) {
      const excess = this.storage.snapshots.length - this.maxSnapshots;
      this.storage.snapshots = this.storage.snapshots.slice(excess);
    }

    this.save();
    log.debug({ snapshotId: snapshot.snapshotId, functionName: input.functionName, success: input.success }, 'runtime snapshot recorded');
    return snapshot;
  }

  /**
   * Get snapshots by memory ID (intent link).
   */
  getByMemoryId(memoryId: string): RuntimeSnapshot[] {
    return this.storage.snapshots
      .filter((s) => s.memoryId === memoryId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * Get snapshots by function name.
   */
  getByFunction(functionName: string): RuntimeSnapshot[] {
    return this.storage.snapshots
      .filter((s) => s.functionName === functionName)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * Get failed executions.
   */
  getFailures(): RuntimeSnapshot[] {
    return this.storage.snapshots.filter((s) => !s.success);
  }

  /**
   * Get failed executions for a specific intent.
   */
  getFailuresByMemoryId(memoryId: string): RuntimeSnapshot[] {
    return this.getFailures().filter((s) => s.memoryId === memoryId);
  }

  /**
   * Get all snapshots, optionally limited.
   */
  list(limit?: number): RuntimeSnapshot[] {
    const snapshots = [...this.storage.snapshots].reverse(); // newest first
    return limit ? snapshots.slice(0, limit) : snapshots;
  }

  /**
   * Get statistics.
   */
  getStats(): {
    total: number;
    successCount: number;
    failureCount: number;
    avgDurationMs: number;
    byFunction: Record<string, { count: number; successRate: number; avgDurationMs: number }>;
  } {
    const snapshots = this.storage.snapshots;
    const successCount = snapshots.filter((s) => s.success).length;
    const failureCount = snapshots.length - successCount;
    const avgDurationMs = snapshots.length > 0
      ? snapshots.reduce((sum, s) => sum + s.durationMs, 0) / snapshots.length
      : 0;

    const byFunction: Record<string, { count: number; successRate: number; avgDurationMs: number }> = {};
    for (const s of snapshots) {
      if (!byFunction[s.functionName]) {
        byFunction[s.functionName] = { count: 0, successRate: 0, avgDurationMs: 0 };
      }
      const f = byFunction[s.functionName];
      f.count++;
    }
    for (const [fn, stats] of Object.entries(byFunction)) {
      const fnSnapshots = snapshots.filter((s) => s.functionName === fn);
      stats.successRate = fnSnapshots.filter((s) => s.success).length / fnSnapshots.length;
      stats.avgDurationMs = fnSnapshots.reduce((sum, s) => sum + s.durationMs, 0) / fnSnapshots.length;
    }

    return { total: snapshots.length, successCount, failureCount, avgDurationMs, byFunction };
  }

  /**
   * Delete a snapshot by ID.
   */
  delete(snapshotId: string): boolean {
    const idx = this.storage.snapshots.findIndex((s) => s.snapshotId === snapshotId);
    if (idx === -1) return false;
    this.storage.snapshots.splice(idx, 1);
    this.save();
    return true;
  }

  /**
   * Clear all snapshots.
   */
  clear(): void {
    this.storage = { snapshots: [] };
    this.save();
  }

  /**
   * Get count.
   */
  get count(): number {
    return this.storage.snapshots.length;
  }

  // ─── Internal ───────────────────────────────────────────────────

  private load(): ObservationStorage {
    try {
      if (existsSync(this.filePath)) {
        const data = JSON.parse(readFileSync(this.filePath, 'utf8'));
        return { snapshots: data.snapshots ?? [] };
      }
    } catch (err) {
      log.warn({ err }, 'failed to load observations, starting fresh');
    }
    return { snapshots: [] };
  }

  private save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.storage, null, 2), 'utf8');
    } catch (err) {
      log.error({ err }, 'failed to save observations');
    }
  }
}
