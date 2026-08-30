/**
 * sync/sync-manager.spec.ts — Tests for sync protocol (SYNC-001/002)
 */

import { describe, it, expect } from 'vitest';
import { SyncManager } from './sync-manager.js';
import { initialCursor, compareCursors, advanceCursor } from './protocol.js';
import type { EntityVersion, SyncCursor } from './protocol.js';

describe('SYNC-001: protocol', () => {
  it('initialCursor starts at zero', () => {
    const c = initialCursor();
    expect(c.taskVersion).toBe(0);
    expect(c.knowledgeVersion).toBe(0);
  });

  it('compareCursors: equal cursors return 0', () => {
    const a = initialCursor();
    expect(compareCursors(a, a)).toBe(0);
  });

  it('compareCursors: ahead returns 1', () => {
    const a = initialCursor();
    const b = { taskVersion: 5, knowledgeVersion: 0, syncedAt: '' };
    expect(compareCursors(b, a)).toBe(1);
  });

  it('advanceCursor moves forward for tasks', () => {
    const c = initialCursor();
    const ev: EntityVersion = { id: 't1', type: 'task', version: 3, updatedAt: '', operation: 'create' };
    const advanced = advanceCursor(c, ev);
    expect(advanced.taskVersion).toBe(3);
    expect(advanced.knowledgeVersion).toBe(0);
  });

  it('advanceCursor moves forward for knowledge', () => {
    const c = initialCursor();
    const ev: EntityVersion = { id: 'k1', type: 'knowledge', version: 7, updatedAt: '', operation: 'update' };
    const advanced = advanceCursor(c, ev);
    expect(advanced.knowledgeVersion).toBe(7);
    expect(advanced.taskVersion).toBe(0);
  });
});

describe('SYNC-002: SyncManager', () => {
  it('records versions with monotonic counters', () => {
    const sm = new SyncManager();
    const v1 = sm.recordVersion('t1', 'task', 'create');
    const v2 = sm.recordVersion('t2', 'task', 'create');
    const v3 = sm.recordVersion('k1', 'knowledge', 'create');
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v3.version).toBe(1); // knowledge has its own counter
    expect(sm.versionCount).toBe(3);
  });

  it('getDelta returns changes since cursor', () => {
    const sm = new SyncManager();
    sm.recordVersion('t1', 'task', 'create');
    sm.recordVersion('t2', 'task', 'create');
    sm.recordVersion('k1', 'knowledge', 'create');

    const delta = sm.getDelta(initialCursor());
    expect(delta.changes).toHaveLength(3);
    expect(delta.cursor.taskVersion).toBe(2);
    expect(delta.cursor.knowledgeVersion).toBe(1);
    expect(delta.hasMore).toBe(false);
  });

  it('getDelta with advanced cursor skips already-seen', () => {
    const sm = new SyncManager();
    sm.recordVersion('t1', 'task', 'create');
    sm.recordVersion('t2', 'task', 'create');
    sm.recordVersion('k1', 'knowledge', 'create');

    const cursor: SyncCursor = { taskVersion: 2, knowledgeVersion: 0, syncedAt: '' };
    const delta = sm.getDelta(cursor);
    expect(delta.changes).toHaveLength(1);
    expect(delta.changes[0].id).toBe('k1');
  });

  it('getDelta respects limit', () => {
    const sm = new SyncManager();
    for (let i = 0; i < 10; i++) sm.recordVersion(`t${i}`, 'task', 'create');
    const delta = sm.getDelta(initialCursor(), 3);
    expect(delta.changes).toHaveLength(3);
    expect(delta.hasMore).toBe(true);
  });

  it('getSnapshot returns all versions', () => {
    const sm = new SyncManager();
    sm.recordVersion('t1', 'task', 'create');
    sm.recordVersion('k1', 'knowledge', 'create');
    const snap = sm.getSnapshot();
    expect(snap.versions).toHaveLength(2);
    expect(snap.cursor.taskVersion).toBe(1);
    expect(snap.cursor.knowledgeVersion).toBe(1);
  });

  it('currentCursor reflects latest versions', () => {
    const sm = new SyncManager();
    sm.recordVersion('t1', 'task', 'create');
    sm.recordVersion('t2', 'task', 'update');
    sm.recordVersion('k1', 'knowledge', 'create');
    const c = sm.currentCursor;
    expect(c.taskVersion).toBe(2);
    expect(c.knowledgeVersion).toBe(1);
  });
});
