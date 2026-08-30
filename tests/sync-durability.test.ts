/**
 * tests/sync-durability.test.ts — E2E durability tests for sync (SYNC-005)
 *
 * Verifies sync protocol survives failures: disconnect, concurrent writes,
 * crash recovery. Uses SyncManager + EventLog + threeWayMerge together.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SyncManager } from '../src/sync/sync-manager.js';
import { EventLog } from '../src/sync/event-log.js';
import { threeWayMerge } from '../src/sync/conflict-resolver.js';
import { initialCursor } from '../src/sync/protocol.js';

describe('SYNC-005: durability', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sync-dur-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('full sync cycle: record → delta → merge → apply', () => {
    const sm = new SyncManager();
    const el = new EventLog({ storagePath: join(dir, 'events.json') });

    // Instance A records changes
    sm.recordVersion('t1', 'task', 'create');
    el.append('t1', 'task', 'create', { id: 't1', title: 'Task 1', status: 'pending' }, 1);
    sm.recordVersion('t1', 'task', 'update');
    el.append('t1', 'task', 'update', { id: 't1', title: 'Task 1 Updated', status: 'in_progress' }, 2);

    // Instance B requests delta from cursor 0
    const delta = sm.getDelta(initialCursor());
    expect(delta.changes).toHaveLength(2);
    expect(delta.hasMore).toBe(false);

    // B applies events
    const events = el.getEventsSince(0);
    expect(events).toHaveLength(2);
    const latest = events[events.length - 1];
    expect(latest.snapshot?.title).toBe('Task 1 Updated');
  });

  it('concurrent writes: both instances modify same entity, merge resolves', () => {
    const base = { id: 't1', title: 'Original', status: 'pending', priority: 'low' };

    // Instance A changes title
    const local = { ...base, title: 'A changed title' };

    // Instance B changes status
    const remote = { ...base, status: 'in_progress' };

    const result = threeWayMerge({ base, local, remote });
    expect(result.conflict).toBe(false);
    expect(result.merged.title).toBe('A changed title');
    expect(result.merged.status).toBe('in_progress');
    expect(result.merged.priority).toBe('low');
  });

  it('conflict on same field: last-write-wins by timestamp', () => {
    const base = { id: 't1', title: 'Original', updatedAt: '2026-01-01T00:00:00.000Z' };
    const local = { id: 't1', title: 'Local wins', updatedAt: '2026-01-02T00:00:00.000Z' };
    const remote = { id: 't1', title: 'Remote wins', updatedAt: '2026-01-03T00:00:00.000Z' };

    const result = threeWayMerge({ base, local, remote }, 'last-write-wins');
    expect(result.conflict).toBe(true);
    expect(result.conflictingFields).toContain('title');
    expect(result.merged.title).toBe('Remote wins');
  });

  it('crash recovery: event log persists across restarts', () => {
    const path = join(dir, 'events.json');

    // First session
    const el1 = new EventLog({ storagePath: path });
    el1.append('t1', 'task', 'create', { title: 'Before crash' }, 1);
    el1.append('t2', 'task', 'create', { title: 'Also before' }, 2);

    // "Crash" — drop instance, create new one from same path
    const el2 = new EventLog({ storagePath: path });
    expect(el2.eventCount).toBe(2);
    expect(el2.lastEventId).toBe(2);
    expect(el2.getEventsSince(0)).toHaveLength(2);

    // Continue after recovery
    el2.append('t3', 'task', 'create', { title: 'After recovery' }, 3);
    expect(el2.eventCount).toBe(3);
  });

  it('snapshot + delta: compact then sync from snapshot', () => {
    const sm = new SyncManager();
    const el = new EventLog({ storagePath: join(dir, 'events.json') });

    // Build up history
    for (let i = 1; i <= 5; i++) {
      sm.recordVersion(`t${i}`, 'task', 'create');
      el.append(`t${i}`, 'task', 'create', { id: `t${i}`, title: `Task ${i}` }, i);
    }

    // Compact (creates snapshots, GCs events)
    el.compact();
    expect(el.snapshotCount).toBe(5);
    expect(el.eventCount).toBe(0);

    // New instance syncs from snapshots
    const snapshots = el.getAllSnapshots();
    expect(snapshots).toHaveLength(5);

    // No new delta (all compacted)
    const delta = sm.getDelta({ taskVersion: 5, knowledgeVersion: 0, syncedAt: '' });
    expect(delta.changes).toHaveLength(0);
  });

  it('split-brain: two independent SyncManagers, merge via 3-way', () => {
    const base = { id: 't1', title: 'Shared', tags: ['a'], status: 'pending' };

    // Branch A
    const smA = new SyncManager();
    smA.recordVersion('t1', 'task', 'update');

    // Branch B
    const smB = new SyncManager();
    smB.recordVersion('t1', 'task', 'update');

    // Both diverged from base
    const localA = { ...base, title: 'Branch A', tags: ['a', 'b'] };
    const localB = { ...base, title: 'Branch B', status: 'closed' };

    const merged = threeWayMerge({ base, local: localA, remote: localB });
    expect(merged.conflict).toBe(true);
    expect(merged.conflictingFields).toContain('title');
    // Non-conflicting fields auto-merge
    expect(merged.merged.tags).toEqual(['a', 'b']);
    expect(merged.merged.status).toBe('closed');
  });
});
