/**
 * audit/logger.ts — Audit logger with file rotation (SEC-001).
 *
 * Writes AuditEvent objects as JSON lines to a file using synchronous I/O
 * (durability: audit events are on disk before returning).
 * Rotates by size (maxFileSize) and optionally by time (rotateIntervalMs).
 * Keeps maxFiles rotated copies.
 *
 * API:
 *   const logger = new AuditLogger(config);
 *   logger.log(event);
 *   const results = logger.query(query);
 *   const exported = logger.export();
 *   logger.rotate();  // force rotation
 *   logger.close();
 */

import { appendFileSync, readFileSync, existsSync, renameSync, statSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { childLogger } from '../core/logger.js';
import type { AuditEvent, AuditConfig, AuditQuery, AuditQueryResult, AuditEventType, AuditStatus } from './types.js';

const log = childLogger('audit:logger');

// ─── Redaction ────────────────────────────────────────────────────

function redact(obj: unknown, fields: string[], depth = 0): unknown {
  if (depth > 10 || obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj)) return obj.map((v) => redact(v, fields, depth + 1));
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (fields.some((f) => key.toLowerCase().includes(f.toLowerCase()))) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redact(value, fields, depth + 1);
      }
    }
    return result;
  }
  return obj;
}

function truncate(value: unknown, maxLength: number): unknown {
  if (typeof value === 'string' && value.length > maxLength) {
    return value.slice(0, maxLength) + '...[truncated]';
  }
  if (typeof value === 'object' && value !== null) {
    const str = JSON.stringify(value);
    if (str.length > maxLength) {
      return str.slice(0, maxLength) + '...[truncated]';
    }
  }
  return value;
}

// ─── AuditLogger ──────────────────────────────────────────────────

export class AuditLogger {
  private _currentSize = 0;
  private _seq = 0;
  private rotateTimer?: NodeJS.Timeout;
  private _closed = false;

  constructor(private readonly config: AuditConfig) {
    if (!config.enabled) return;

    // Ensure directory exists
    const dir = dirname(config.filePath);
    try {
      mkdirSync(dir, { recursive: true });
    } catch { /* may already exist */ }

    this.updateCurrentSize();

    // Set up time-based rotation if configured
    if (config.rotateIntervalMs > 0) {
      this.rotateTimer = setInterval(() => this.rotate(), config.rotateIntervalMs);
    }
  }

  get closed(): boolean {
    return this._closed;
  }

  get currentSize(): number {
    return this._currentSize;
  }

  /** Track current file size. */
  private updateCurrentSize(): void {
    try {
      if (existsSync(this.config.filePath)) {
        this._currentSize = statSync(this.config.filePath).size;
      } else {
        this._currentSize = 0;
      }
    } catch {
      this._currentSize = 0;
    }
  }

  /**
   * Log an audit event.
   * Applies redaction and truncation based on config.
   * Auto-rotates if file exceeds maxFileSize.
   * Uses synchronous I/O for durability.
   */
  log(event: AuditEvent): void {
    if (!this.config.enabled || this._closed) return;

    // Apply redaction
    const redacted: AuditEvent = {
      ...event,
      input: this.config.logInput ? redact(event.input, this.config.redactFields) as Record<string, unknown> : undefined,
      result: this.config.logResult ? truncate(redact(event.result, this.config.redactFields), this.config.maxResultLength) : undefined,
    };

    const line = JSON.stringify(redacted) + '\n';
    const lineSize = Buffer.byteLength(line);

    try {
      appendFileSync(this.config.filePath, line);
      this._currentSize += lineSize;
    } catch (err) {
      log.error({ err }, 'audit log write failed');
      return;
    }

    // Check if rotation needed
    if (this.config.maxFileSize > 0 && this._currentSize >= this.config.maxFileSize) {
      this.rotate();
    }
  }

  /**
   * Create a new audit event with auto-generated id and timestamp.
   */
  createEvent(partial: Omit<AuditEvent, 'id' | 'timestamp'>): AuditEvent {
    return {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      seq: this._seq++,
      ...partial,
    };
  }

  /**
   * Log a convenience event (creates + logs in one call).
   */
  record(
    type: AuditEventType,
    status: AuditStatus,
    target: string,
    extra?: Partial<Omit<AuditEvent, 'id' | 'timestamp' | 'type' | 'status' | 'target'>>,
  ): void {
    this.log(this.createEvent({ type, status, target, ...extra }));
  }

  /**
   * Rotate the audit log file.
   * Renames current file with .1 suffix, shifts older files, starts new file.
   */
  rotate(): void {
    try {
      // Shift rotated files: .4 → .5, .3 → .4, ... .1 → .2
      for (let i = this.config.maxFiles - 1; i >= 1; i--) {
        const from = `${this.config.filePath}.${i}`;
        const to = `${this.config.filePath}.${i + 1}`;
        if (existsSync(from)) {
          if (i + 1 > this.config.maxFiles) {
            try { unlinkSync(from); } catch { /* ignore */ }
          } else {
            renameSync(from, to);
          }
        }
      }

      // Rename current file to .1
      if (existsSync(this.config.filePath)) {
        renameSync(this.config.filePath, `${this.config.filePath}.1`);
      }
    } catch (err) {
      log.error({ err }, 'audit log rotation failed');
    }

    this._currentSize = 0;
    log.info('audit log rotated');
  }

  /**
   * Query audit events from the log file(s).
   * Reads current + rotated files, applies filters, returns matching events.
   */
  query(query: AuditQuery): AuditQueryResult {
    if (!this.config.enabled) {
      return { events: [], total: 0, limit: query.limit ?? 100, offset: query.offset ?? 0 };
    }

    const allEvents: AuditEvent[] = [];
    const filesToRead: string[] = [this.config.filePath];

    // Include rotated files
    for (let i = 1; i <= this.config.maxFiles; i++) {
      const rotated = `${this.config.filePath}.${i}`;
      if (existsSync(rotated)) filesToRead.push(rotated);
    }

    for (const file of filesToRead) {
      try {
        if (!existsSync(file)) continue;
        const content = readFileSync(file, 'utf8');
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as AuditEvent;
            if (this.matchesQuery(event, query)) {
              allEvents.push(event);
            }
          } catch { /* skip malformed lines */ }
        }
      } catch (err) {
        log.warn({ file, err }, 'failed to read audit file for query');
      }
    }

    // Sort by timestamp descending, then by seq descending (stable for same timestamp)
    allEvents.sort((a, b) => {
      const tsCmp = b.timestamp.localeCompare(a.timestamp);
      if (tsCmp !== 0) return tsCmp;
      return (b.seq ?? 0) - (a.seq ?? 0);
    });

    const offset = query.offset ?? 0;
    const limit = query.limit ?? 100;
    const paginated = allEvents.slice(offset, offset + limit);

    return {
      events: paginated,
      total: allEvents.length,
      limit,
      offset,
    };
  }

  /** Check if an event matches the query filters. */
  private matchesQuery(event: AuditEvent, query: AuditQuery): boolean {
    if (query.type && event.type !== query.type) return false;
    if (query.status && event.status !== query.status) return false;
    if (query.target && event.target !== query.target) return false;
    if (query.sessionId && event.sessionId !== query.sessionId) return false;
    if (query.userId && event.userId !== query.userId) return false;
    if (query.since && event.timestamp < query.since) return false;
    if (query.until && event.timestamp > query.until) return false;
    return true;
  }

  /**
   * Export all audit events as a JSON array.
   * Useful for external backup or analysis.
   */
  export(): AuditEvent[] {
    return this.query({ limit: Number.MAX_SAFE_INTEGER }).events;
  }

  /**
   * Close the audit logger.
   * Stops rotation timer. Sync I/O needs no flush.
   */
  close(): Promise<void> {
    if (this._closed) return Promise.resolve();
    this._closed = true;

    if (this.rotateTimer) {
      clearInterval(this.rotateTimer);
      this.rotateTimer = undefined;
    }

    log.info('audit logger closed');
    return Promise.resolve();
  }
}
