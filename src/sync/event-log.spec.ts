/**
 * sync/event-log.spec.ts — Tests for event sourcing + GC (SYNC-004)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from './event-log.js';

describe('SYNC-004: EventLog', () => {
  let dir: string;
  let logPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eventlog-'));
    logPath = join(dir, 'events.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends events with monotonic IDs', () => {
    const el = new EventLog({ storagePath: logPath });
    const e1 = el.append('t1', 'task', 'create', { title: 'Task 1' }, 1);
    const e2 = el.append('t2', 'task', 'create', { title: 'Task 2' }, 2);
    expect(e1.eventId).toBe(1);
    expect(e2.eventId).toBe(2);
    expect(el.eventCount).toBe(2);
    expect(el.lastEventId).toBe(2);
  });

  it('getEventsSince returns events after the given ID', () => {
    const el = new EventLog({ storagePath: logPath });
    el.append('t1', 'task', 'create', { title: 'A' }, 1);
    el.append('t2', 'task', 'create', { title: 'B' }, 2);
    el.append('t3', 'task', 'create', { title: 'C' }, 3);
    const events = el.getEventsSince(1);
    expect(events).toHaveLength(2);
    expect(events[0].entityId).toBe('t2');
  });

  it('getEventsSince respects limit', () => {
    const el = new EventLog({ storagePath: logPath });
    for (let i = 0; i < 10; i++) el.append(`t${i}`, 'task', 'create', {}, i);
    const events = el.getEventsSince(0, 3);
    expect(events).toHaveLength(3);
  });

  it('compact creates snapshots and GCs old events', () => {
    const el = new EventLog({ storagePath: logPath, compactThreshold: 5 });
    el.append('t1', 'task', 'create', { title: 'v1' }, 1);
    el.append('t1', 'task', 'update', { title: 'v2' }, 2);
    el.append('t1', 'task', 'update', { title: 'v3' }, 3);
    el.append('t2', 'task', 'create', { title: 'T2' }, 1);
    const result = el.compact();
    expect(result.compacted).toBe(4);
    expect(result.remaining).toBe(0);
    expect(el.snapshotCount).toBe(2);
    const snap = el.getSnapshot('t1');
    expect(snap?.state?.title).toBe('v3');
  });

  it('compact preserves events after snapshot point', () => {
    const el = new EventLog({ storagePath: logPath });
    el.append('t1', 'task', 'create', { title: 'A' }, 1);
    el.compact();
    el.append('t2', 'task', 'create', { title: 'B' }, 2);
    expect(el.eventCount).toBe(1);
    expect(el.getEventsSince(0)).toHaveLength(1);
  });

  it('persists and reloads from disk', () => {
    const el1 = new EventLog({ storagePath: logPath });
    el1.append('t1', 'task', 'create', { title: 'Persisted' }, 1);
    const el2 = new EventLog({ storagePath: logPath });
    expect(el2.eventCount).toBe(1);
    expect(el2.lastEventId).toBe(1);
    expect(el2.getEventsSince(0)[0].entityId).toBe('t1');
  });

  it('handles delete operations (null snapshot)', () => {
    const el = new EventLog({ storagePath: logPath });
    el.append('t1', 'task', 'create', { title: 'A' }, 1);
    el.append('t1', 'task', 'delete', null, 2);
    el.compact();
    const snap = el.getSnapshot('t1');
    expect(snap?.state).toBeNull();
  });

  it('getAllSnapshots returns all entities', () => {
    const el = new EventLog({ storagePath: logPath });
    el.append('t1', 'task', 'create', {}, 1);
    el.append('k1', 'knowledge', 'create', {}, 1);
    el.compact();
    const snaps = el.getAllSnapshots();
    expect(snaps).toHaveLength(2);
    expect(snaps.some((s) => s.entityType === 'task')).toBe(true);
    expect(snaps.some((s) => s.entityType === 'knowledge')).toBe(true);
  });
});
