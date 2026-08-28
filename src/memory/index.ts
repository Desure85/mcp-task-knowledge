/**
 * memory/index.ts — Memory module exports.
 */

export { SessionMemory } from './session-memory.js';
export type { SessionRecord, SessionDecision, SessionMemoryOptions } from './session-memory.js';

export { EntityGraph } from './entity-graph.js';
export type { EntityType, EdgeType, EntityNode, EntityEdge, GraphPath, SearchHit, DiscoveryResult } from './entity-graph.js';

export { ContextDistiller } from './context-distiller.js';
export type { DistilledKnowledge, DistillerOptions, CompressOptions, CompressResult } from './context-distiller.js';

export { MemoryIO } from './memory-io.js';
export type { ImportSummary, ImportOptions } from './memory-io.js';
