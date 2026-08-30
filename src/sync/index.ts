/**
 * sync/index.ts — Barrel exports (SYNC-001/002)
 */

export { SyncManager } from './sync-manager.js';
export { initialCursor, compareCursors, advanceCursor } from './protocol.js';
export type { EntityVersion, SyncCursor, SyncDelta, SyncSnapshot } from './protocol.js';
