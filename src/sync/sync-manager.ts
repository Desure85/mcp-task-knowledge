/**
 * sync/sync-manager.ts — Sync manager: tracks entity versions and computes deltas (SYNC-001/002)
 *
 * Maintains an in-memory version log for all entities. When a task or knowledge
 * doc is created/updated/deleted, recordVersion() is called. getDelta() returns
 * changes since a cursor for delta sync.
 */

import type { EntityVersion, SyncCursor, SyncDelta } from './protocol.js';
import { advanceCursor, initialCursor } from './protocol.js';

export class SyncManager {
  private readonly versions: EntityVersion[] = [];
  private nextTaskVersion = 1;
  private nextKnowledgeVersion = 1;

  /** Record a version event for an entity. */
  recordVersion(id: string, type: 'task' | 'knowledge', operation: 'create' | 'update' | 'delete'): EntityVersion {
    const version = type === 'task' ? this.nextTaskVersion++ : this.nextKnowledgeVersion++;
    const ev: EntityVersion = {
      id,
      type,
      version,
      updatedAt: new Date().toISOString(),
      operation,
    };
    this.versions.push(ev);
    return ev;
  }

  /** Get all changes since the given cursor. */
  getDelta(cursor: SyncCursor, limit = 100): SyncDelta {
    const changes: EntityVersion[] = [];
    let newCursor = { ...cursor };

    for (const ev of this.versions) {
      if (ev.type === 'task' && ev.version <= cursor.taskVersion) continue;
      if (ev.type === 'knowledge' && ev.version <= cursor.knowledgeVersion) continue;
      changes.push(ev);
      newCursor = advanceCursor(newCursor, ev);
      if (changes.length >= limit) break;
    }

    const hasMore = this.versions.some((ev) => {
      if (ev.type === 'task') return ev.version > newCursor.taskVersion;
      return ev.version > newCursor.knowledgeVersion;
    });

    return { changes, cursor: { ...newCursor, syncedAt: new Date().toISOString() }, hasMore };
  }

  /** Get a full snapshot (all versions). */
  getSnapshot(): { versions: EntityVersion[]; cursor: SyncCursor } {
    let cursor = initialCursor();
    for (const ev of this.versions) {
      cursor = advanceCursor(cursor, ev);
    }
    return { versions: [...this.versions], cursor: { ...cursor, syncedAt: new Date().toISOString() } };
  }

  /** Total recorded versions. */
  get versionCount(): number {
    return this.versions.length;
  }

  /** Current cursor (latest versions). */
  get currentCursor(): SyncCursor {
    return {
      taskVersion: this.nextTaskVersion - 1,
      knowledgeVersion: this.nextKnowledgeVersion - 1,
      syncedAt: new Date().toISOString(),
    };
  }
}
