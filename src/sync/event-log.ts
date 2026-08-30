/**
 * sync/event-log.ts — Event sourcing with snapshot + GC (SYNC-004)
 *
 * Maintains an append-only event log for all entity changes. Periodically
 * compacts old events into snapshots and garbage-collects the compacted
 * events. This keeps the log bounded while preserving full history.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { childLogger } from '../core/logger.js';

const log = childLogger('sync:event-log');

export interface EntityEvent {
  /** Sequential event ID (monotonic). */
  eventId: number;
  /** Entity ID. */
  entityId: string;
  /** Entity type. */
  entityType: 'task' | 'knowledge';
  /** Operation. */
  operation: 'create' | 'update' | 'delete';
  /** Full entity state at this event (null for delete). */
  snapshot: Record<string, unknown> | null;
  /** ISO timestamp. */
  timestamp: string;
  /** Version number (from SyncManager). */
  version: number;
}

export interface SnapshotEntry {
  /** Entity ID. */
  entityId: string;
  /** Entity type. */
  entityType: 'task' | 'knowledge';
  /** Last known state. */
  state: Record<string, unknown> | null;
  /** Last event ID included in this snapshot. */
  lastEventId: number;
  /** Timestamp. */
  timestamp: string;
}

export interface EventLogOptions {
  /** Directory for event log + snapshots. */
  storagePath: string;
  /** Compact events older than this count (default: 1000). */
  compactThreshold?: number;
}

export class EventLog {
  private readonly storagePath: string;
  private readonly compactThreshold: number;
  private events: EntityEvent[] = [];
  private snapshots = new Map<string, SnapshotEntry>();
  private nextEventId = 1;

  constructor(options: EventLogOptions) {
    this.storagePath = options.storagePath;
    this.compactThreshold = options.compactThreshold ?? 1000;
    this.load();
  }

  /** Append an event to the log. */
  append(entityId: string, entityType: 'task' | 'knowledge', operation: 'create' | 'update' | 'delete', snapshot: Record<string, unknown> | null, version: number): EntityEvent {
    const event: EntityEvent = {
      eventId: this.nextEventId++,
      entityId,
      entityType,
      operation,
      snapshot,
      timestamp: new Date().toISOString(),
      version,
    };
    this.events.push(event);
    this.persist();
    return event;
  }

  /** Get events since a given event ID (for delta sync). */
  getEventsSince(sinceEventId: number, limit = 100): EntityEvent[] {
    return this.events.filter((e) => e.eventId > sinceEventId).slice(0, limit);
  }

  /** Get the latest snapshot for an entity. */
  getSnapshot(entityId: string): SnapshotEntry | undefined {
    return this.snapshots.get(entityId);
  }

  /** Get all snapshots (for full sync). */
  getAllSnapshots(): SnapshotEntry[] {
    return [...this.snapshots.values()];
  }

  /** Compact: create snapshots from events, then GC old events. */
  compact(): { compacted: number; remaining: number } {
    // Build latest state per entity from events
    const latestState = new Map<string, EntityEvent>();
    for (const ev of this.events) {
      latestState.set(ev.entityId, ev);
    }

    // Create/update snapshots
    for (const [entityId, ev] of latestState) {
      this.snapshots.set(entityId, {
        entityId,
        entityType: ev.entityType,
        state: ev.snapshot,
        lastEventId: ev.eventId,
        timestamp: ev.timestamp,
      });
    }

    // GC: keep only events after the last snapshot event ID
    const maxSnapshotEventId = Math.max(...[...this.snapshots.values()].map((s) => s.lastEventId), 0);
    const before = this.events.length;
    this.events = this.events.filter((e) => e.eventId > maxSnapshotEventId);
    const compacted = before - this.events.length;

    this.persist();
    log.info({ compacted, remaining: this.events.length }, 'event log compacted');
    return { compacted, remaining: this.events.length };
  }

  /** Total event count. */
  get eventCount(): number {
    return this.events.length;
  }

  /** Snapshot count. */
  get snapshotCount(): number {
    return this.snapshots.size;
  }

  /** Last event ID. */
  get lastEventId(): number {
    return this.nextEventId - 1;
  }

  private persist(): void {
    const dir = dirname(this.storagePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.storagePath, JSON.stringify({
      events: this.events,
      snapshots: [...this.snapshots.entries()],
      nextEventId: this.nextEventId,
    }), 'utf8');
  }

  private load(): void {
    if (!existsSync(this.storagePath)) return;
    try {
      const data = JSON.parse(readFileSync(this.storagePath, 'utf8')) as {
        events: EntityEvent[];
        snapshots: [string, SnapshotEntry][];
        nextEventId: number;
      };
      this.events = data.events ?? [];
      this.snapshots = new Map(data.snapshots ?? []);
      this.nextEventId = data.nextEventId ?? 1;
    } catch {
      log.warn('failed to load event log, starting fresh');
    }
  }
}
