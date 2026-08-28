/**
 * behavioral/failure-logging.ts — Failure logging (BM-003).
 *
 * MCP tool `log_failure` — records error linked to `memory_id`.
 * Validates that runtime snapshots belong to the intent.
 * Structure: error_type, message, stack, context, timestamp.
 *
 * Usage:
 *   const logger = new FailureLogger({ storagePath: '.behavioral' });
 *   const failure = logger.log({
 *     memoryId: 'intent-abc123',
 *     errorType: 'TypeError',
 *     message: 'Cannot read property x of undefined',
 *     stack: '...',
 *     context: { input: '...' },
 *   });
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { childLogger } from '../core/logger.js';
import type { RuntimeObservation } from './runtime-observation.js';

const log = childLogger('failure-logger');

// ─── Types ────────────────────────────────────────────────────────

export interface FailureRecord {
  /** Unique failure ID. */
  failureId: string;
  /** Linked intent memory ID. */
  memoryId: string;
  /** Error type (e.g., 'TypeError', 'RangeError'). */
  errorType: string;
  /** Error message. */
  message: string;
  /** Stack trace. */
  stack?: string;
  /** Additional context. */
  context: Record<string, unknown>;
  /** When the failure was logged (ISO 8601). */
  timestamp: string;
  /** Whether this failure has been resolved (linked to a fix). */
  resolved: boolean;
  /** ID of the resolution (if resolved). */
  resolutionId?: string;
}

export interface FailureLoggerOptions {
  storagePath?: string;
}

// ─── Storage Format ───────────────────────────────────────────────

interface FailureStorage {
  failures: FailureRecord[];
}

// ─── FailureLogger ────────────────────────────────────────────────

export class FailureLogger {
  private readonly storagePath: string;
  private readonly filePath: string;
  private storage: FailureStorage;

  constructor(options?: FailureLoggerOptions) {
    this.storagePath = options?.storagePath ?? '.behavioral';
    this.filePath = join(this.storagePath, 'failures.json');
    this.storage = this.load();
  }

  /**
   * Log a failure. Optionally validates against runtime observations.
   */
  log(input: {
    memoryId: string;
    errorType: string;
    message: string;
    stack?: string;
    context?: Record<string, unknown>;
  }, observations?: RuntimeObservation): FailureRecord {
    // Validate that runtime snapshots exist for this intent (if observations provided)
    if (observations) {
      const snapshots = observations.getByMemoryId(input.memoryId);
      if (snapshots.length === 0) {
        log.warn({ memoryId: input.memoryId }, 'no runtime snapshots found for intent');
      }
    }

    const failure: FailureRecord = {
      failureId: `fail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      memoryId: input.memoryId,
      errorType: input.errorType,
      message: input.message,
      stack: input.stack,
      context: input.context ?? {},
      timestamp: new Date().toISOString(),
      resolved: false,
    };

    this.storage.failures.push(failure);
    this.save();
    log.info({ failureId: failure.failureId, errorType: input.errorType }, 'failure logged');

    return failure;
  }

  /**
   * Get a failure by ID.
   */
  get(failureId: string): FailureRecord | undefined {
    return this.storage.failures.find((f) => f.failureId === failureId);
  }

  /**
   * Get failures by memory ID (intent link).
   */
  getByMemoryId(memoryId: string): FailureRecord[] {
    return this.storage.failures
      .filter((f) => f.memoryId === memoryId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * Get unresolved failures.
   */
  getUnresolved(): FailureRecord[] {
    return this.storage.failures.filter((f) => !f.resolved);
  }

  /**
   * Get resolved failures.
   */
  getResolved(): FailureRecord[] {
    return this.storage.failures.filter((f) => f.resolved);
  }

  /**
   * Mark a failure as resolved.
   */
  resolve(failureId: string, resolutionId: string): boolean {
    const failure = this.storage.failures.find((f) => f.failureId === failureId);
    if (!failure) return false;
    failure.resolved = true;
    failure.resolutionId = resolutionId;
    this.save();
    log.info({ failureId, resolutionId }, 'failure resolved');
    return true;
  }

  /**
   * Search failures by message or error type.
   */
  search(query: string): FailureRecord[] {
    const lower = query.toLowerCase();
    return this.storage.failures.filter(
      (f) => f.message.toLowerCase().includes(lower) || f.errorType.toLowerCase().includes(lower),
    );
  }

  /**
   * Get failure statistics.
   */
  getStats(): { total: number; resolved: number; unresolved: number; byErrorType: Record<string, number> } {
    const failures = this.storage.failures;
    const byErrorType: Record<string, number> = {};
    for (const f of failures) {
      byErrorType[f.errorType] = (byErrorType[f.errorType] ?? 0) + 1;
    }
    return {
      total: failures.length,
      resolved: failures.filter((f) => f.resolved).length,
      unresolved: failures.filter((f) => !f.resolved).length,
      byErrorType,
    };
  }

  /**
   * Delete a failure.
   */
  delete(failureId: string): boolean {
    const idx = this.storage.failures.findIndex((f) => f.failureId === failureId);
    if (idx === -1) return false;
    this.storage.failures.splice(idx, 1);
    this.save();
    return true;
  }

  /**
   * Clear all failures.
   */
  clear(): void {
    this.storage = { failures: [] };
    this.save();
  }

  get count(): number {
    return this.storage.failures.length;
  }

  // ─── Internal ───────────────────────────────────────────────────

  private load(): FailureStorage {
    try {
      if (existsSync(this.filePath)) {
        const data = JSON.parse(readFileSync(this.filePath, 'utf8'));
        return { failures: data.failures ?? [] };
      }
    } catch (err) {
      log.warn({ err }, 'failed to load failures, starting fresh');
    }
    return { failures: [] };
  }

  private save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.storage, null, 2), 'utf8');
    } catch (err) {
      log.error({ err }, 'failed to save failures');
    }
  }
}
