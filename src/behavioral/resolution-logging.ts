/**
 * behavioral/resolution-logging.ts — Resolution logging (BM-004).
 *
 * MCP tool `log_resolution` — links resolved failure to fixing intent (provenance).
 * Records: which fix was applied, which approach worked, link to commit/PR.
 *
 * Usage:
 *   const logger = new ResolutionLogger({ storagePath: '.behavioral' });
 *   const resolution = logger.log({
 *     failureId: 'fail-abc123',
 *     fixingMemoryId: 'intent-def456',
 *     approach: 'Added null check before property access',
 *     commitSha: 'abc1234',
 *     prUrl: 'https://github.com/...',
 *   });
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { childLogger } from '../core/logger.js';

const log = childLogger('resolution-logger');

// ─── Types ────────────────────────────────────────────────────────

export interface ResolutionRecord {
  /** Unique resolution ID. */
  resolutionId: string;
  /** ID of the failure being resolved. */
  failureId: string;
  /** Memory ID of the intent that fixed the failure. */
  fixingMemoryId: string;
  /** Description of the fix approach. */
  approach: string;
  /** What was tried that didn't work. */
  failedApproaches?: string[];
  /** Git commit SHA. */
  commitSha?: string;
  /** PR URL. */
  prUrl?: string;
  /** When the resolution was logged (ISO 8601). */
  timestamp: string;
  /** Additional metadata. */
  metadata: Record<string, unknown>;
}

export interface ResolutionLoggerOptions {
  storagePath?: string;
}

// ─── Storage Format ───────────────────────────────────────────────

interface ResolutionStorage {
  resolutions: ResolutionRecord[];
}

// ─── ResolutionLogger ─────────────────────────────────────────────

export class ResolutionLogger {
  private readonly storagePath: string;
  private readonly filePath: string;
  private storage: ResolutionStorage;

  constructor(options?: ResolutionLoggerOptions) {
    this.storagePath = options?.storagePath ?? '.behavioral';
    this.filePath = join(this.storagePath, 'resolutions.json');
    this.storage = this.load();
  }

  /**
   * Log a resolution. Links a failure to a fixing intent.
   */
  log(input: {
    failureId: string;
    fixingMemoryId: string;
    approach: string;
    failedApproaches?: string[];
    commitSha?: string;
    prUrl?: string;
    metadata?: Record<string, unknown>;
  }): ResolutionRecord {
    const resolution: ResolutionRecord = {
      resolutionId: `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      failureId: input.failureId,
      fixingMemoryId: input.fixingMemoryId,
      approach: input.approach,
      failedApproaches: input.failedApproaches,
      commitSha: input.commitSha,
      prUrl: input.prUrl,
      timestamp: new Date().toISOString(),
      metadata: input.metadata ?? {},
    };

    this.storage.resolutions.push(resolution);
    this.save();
    log.info({ resolutionId: resolution.resolutionId, failureId: input.failureId }, 'resolution logged');

    return resolution;
  }

  /**
   * Get a resolution by ID.
   */
  get(resolutionId: string): ResolutionRecord | undefined {
    return this.storage.resolutions.find((r) => r.resolutionId === resolutionId);
  }

  /**
   * Get resolution for a specific failure.
   */
  getByFailureId(failureId: string): ResolutionRecord | undefined {
    return this.storage.resolutions.find((r) => r.failureId === failureId);
  }

  /**
   * Get all resolutions by a fixing intent.
   */
  getByFixingMemoryId(memoryId: string): ResolutionRecord[] {
    return this.storage.resolutions.filter((r) => r.fixingMemoryId === memoryId);
  }

  /**
   * List all resolutions.
   */
  list(limit?: number): ResolutionRecord[] {
    const resolutions = [...this.storage.resolutions].reverse();
    return limit ? resolutions.slice(0, limit) : resolutions;
  }

  /**
   * Search resolutions by approach text.
   */
  search(query: string): ResolutionRecord[] {
    const lower = query.toLowerCase();
    return this.storage.resolutions.filter(
      (r) => r.approach.toLowerCase().includes(lower) ||
        r.failedApproaches?.some((a) => a.toLowerCase().includes(lower)),
    );
  }

  /**
   * Get resolutions that have a commit SHA.
   */
  getWithCommit(): ResolutionRecord[] {
    return this.storage.resolutions.filter((r) => r.commitSha);
  }

  /**
   * Get resolutions that have a PR URL.
   */
  getWithPR(): ResolutionRecord[] {
    return this.storage.resolutions.filter((r) => r.prUrl);
  }

  /**
   * Delete a resolution.
   */
  delete(resolutionId: string): boolean {
    const idx = this.storage.resolutions.findIndex((r) => r.resolutionId === resolutionId);
    if (idx === -1) return false;
    this.storage.resolutions.splice(idx, 1);
    this.save();
    return true;
  }

  /**
   * Clear all resolutions.
   */
  clear(): void {
    this.storage = { resolutions: [] };
    this.save();
  }

  get count(): number {
    return this.storage.resolutions.length;
  }

  // ─── Internal ───────────────────────────────────────────────────

  private load(): ResolutionStorage {
    try {
      if (existsSync(this.filePath)) {
        const data = JSON.parse(readFileSync(this.filePath, 'utf8'));
        return { resolutions: data.resolutions ?? [] };
      }
    } catch (err) {
      log.warn({ err }, 'failed to load resolutions, starting fresh');
    }
    return { resolutions: [] };
  }

  private save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.storage, null, 2), 'utf8');
    } catch (err) {
      log.error({ err }, 'failed to save resolutions');
    }
  }
}
