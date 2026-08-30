/**
 * sync/protocol.ts — Sync protocol: versioning + cursors (SYNC-001)
 *
 * Defines the wire protocol for synchronizing data between mcp-task-knowledge
 * instances. Each entity (task/knowledge) carries a version vector; cursors
 * track the last-seen version per entity type for delta sync.
 */

export interface EntityVersion {
  /** Entity ID (UUID). */
  id: string;
  /** Entity type: 'task' | 'knowledge'. */
  type: 'task' | 'knowledge';
  /** Monotonic version number (incremented on each write). */
  version: number;
  /** ISO timestamp of last update. */
  updatedAt: string;
  /** Operation that produced this version. */
  operation: 'create' | 'update' | 'delete';
}

export interface SyncCursor {
  /** Last-seen task version. */
  taskVersion: number;
  /** Last-seen knowledge version. */
  knowledgeVersion: number;
  /** Timestamp of last sync. */
  syncedAt: string;
}

export interface SyncDelta {
  /** Changes since the cursor. */
  changes: EntityVersion[];
  /** New cursor after applying these changes. */
  cursor: SyncCursor;
  /** Whether more changes exist (paginated). */
  hasMore: boolean;
}

export interface SyncSnapshot {
  /** All entity versions at this point. */
  versions: EntityVersion[];
  /** Cursor representing this snapshot. */
  cursor: SyncCursor;
}

/** Create an initial cursor (sync from beginning). */
export function initialCursor(): SyncCursor {
  return { taskVersion: 0, knowledgeVersion: 0, syncedAt: new Date(0).toISOString() };
}

/** Compare two cursors: returns -1, 0, or 1. */
export function compareCursors(a: SyncCursor, b: SyncCursor): number {
  if (a.taskVersion !== b.taskVersion) return a.taskVersion < b.taskVersion ? -1 : 1;
  if (a.knowledgeVersion !== b.knowledgeVersion) return a.knowledgeVersion < b.knowledgeVersion ? -1 : 1;
  return 0;
}

/** Advance a cursor to include the given entity version. */
export function advanceCursor(cursor: SyncCursor, entity: EntityVersion): SyncCursor {
  if (entity.type === 'task') {
    return { ...cursor, taskVersion: Math.max(cursor.taskVersion, entity.version) };
  }
  return { ...cursor, knowledgeVersion: Math.max(cursor.knowledgeVersion, entity.version) };
}
