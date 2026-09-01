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

export { MemoryExtractor } from './extraction.js';
export type {
  ExtractedFact,
  ExtractionInput,
  ExtractionResult,
  FactCategory,
  FactSource,
  MemoryScope,
} from './types.js';

export { TemporalGraph } from './temporal-graph.js';
export type {
  TemporalFact,
  FactRelationship,
  FactRelationType,
  AddFactInput,
  TemporalQuery,
} from './temporal-graph.js';

export { ProfileManager } from './user-profile.js';
export type { UserProfile, StaticFact, DynamicFact, ProfileUpdateInput } from './user-profile.js';

export { ContextAssembler } from './context-assembly.js';
export type { ContextItem, AssemblyInput, AssemblyResult, SearchFn } from './context-assembly.js';

export { EntityRetriever } from './entity-retrieval.js';
export type { EntityMatch, EntityRetrievalOptions } from './entity-retrieval.js';
