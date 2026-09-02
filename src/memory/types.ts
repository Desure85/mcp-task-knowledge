/**
 * memory/types.ts — Shared types for memory system (NEXT-002).
 *
 * ExtractedFact: structured fact extracted from conversation/session transcript.
 * MemoryScope: multi-tenancy dimensions for memory scoping (NEXT-010 forward-compat).
 */

/** Memory scope dimensions (Mem0-compatible: user/agent/app/run). */
export interface MemoryScope {
  /** User ID — whose memory this is (e.g. "user-alice"). */
  userId?: string;
  /** Agent ID — which agent extracted/owns this fact. */
  agentId?: string;
  /** Application ID — which app/session context. */
  appId?: string;
  /** Run ID — specific run/session that produced this fact. */
  runId?: string;
}

/** A single extracted fact from conversation. */
export interface ExtractedFact {
  /** Unique ID (UUID). */
  id: string;
  /** Fact statement — concise, self-contained (e.g. "User prefers tabs over spaces"). */
  statement: string;
  /** Category of the fact. */
  category: FactCategory;
  /** Confidence score 0..1 — how certain the extraction is. */
  confidence: number;
  /** Tags for categorization and retrieval boosting. */
  tags: string[];
  /** Memory scope (multi-tenancy). */
  scope: MemoryScope;
  /** Source — where the fact came from. */
  source: FactSource;
  /** When the fact was extracted (ISO 8601). */
  extractedAt: string;
  /** Whether this fact is currently valid (temporal invalidation, NEXT-001). */
  valid: boolean;
  /** ID of the fact that supersedes this one (if invalidated). */
  supersededBy?: string;
  /** Entities mentioned in the fact (for entity-linking retrieval, NEXT-008). */
  entities?: string[];
  /** Temporal metadata (NEXT-001 forward-compat). */
  validFrom?: string;
  validTo?: string;
}

/** Categories of extractable facts. */
export type FactCategory =
  | 'preference'      // user/agent preference
  | 'decision'        // architectural or product decision
  | 'fact'            // objective fact about the world/codebase
  | 'skill'           // learned skill or technique
  | 'error'           // error/failure pattern
  | 'fix'             // resolution/fix pattern
  | 'convention'      // coding convention or standard
  | 'context'         // project/team context
  | 'relationship'    // entity relationship
  | 'other';          // uncategorized

/** Source of a fact. */
export interface FactSource {
  /** Type of source. */
  type: 'conversation' | 'session' | 'code' | 'manual' | 'import';
  /** Reference — session ID, file path, URL, etc. */
  ref?: string;
  /** Original text snippet that led to extraction. */
  snippet?: string;
}

/** Input for memory extraction. */
export interface ExtractionInput {
  /** Conversation/session transcript text. */
  transcript: string;
  /** Memory scope for extracted facts. */
  scope?: MemoryScope;
  /** Project name (for knowledge base storage). */
  project?: string;
  /** Maximum number of facts to extract (default: 20). */
  maxFacts?: number;
  /** Minimum confidence threshold (default: 0.5). */
  minConfidence?: number;
  /** Whether to persist facts to knowledge base immediately. */
  persist?: boolean;
}

/** Result of memory extraction. */
export interface ExtractionResult {
  /** Extracted facts. */
  facts: ExtractedFact[];
  /** Number of facts persisted to knowledge base (if persist=true). */
  persistedCount: number;
  /** Knowledge doc IDs created (if persist=true). */
  docIds: string[];
  /** Extraction duration in ms. */
  durationMs: number;
}
