/**
 * memory/temporal-graph.ts — Temporal Knowledge Graph (NEXT-001).
 *
 * Bi-temporal fact tracking inspired by Zep/Graphiti:
 *   - valid_time: when a fact was true in the world (validFrom / validTo)
 *   - transaction_time: when the system learned it (recorded)
 *
 * Edge invalidation: contradictions mark old facts invalid (not deleted).
 * Point-in-time queries: "what was true on date X?"
 *
 * Architecture:
 *   - TemporalFact: extends ExtractedFact with bi-temporal metadata
 *   - TemporalGraph: stores facts + relationships, supports temporal queries
 *   - Invalidation: mark old fact as superseded, link to new fact
 *   - Query: point-in-time, current-valid, history
 *
 * Storage: JSON file (consistent with entity-graph pattern).
 *
 * Usage:
 *   const graph = new TemporalGraph({ storagePath: '.memory/temporal' });
 *   graph.addFact({ statement: 'DB is PostgreSQL', validFrom: '2026-01-01' });
 *   graph.invalidateFact(id, newFactId, 'DB changed to MySQL');
 *   const facts = graph.queryAtTime('2026-06-01');
 */

import { readFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomicSync } from '../fs.js';
import { randomUUID } from 'node:crypto';
import { childLogger } from '../core/logger.js';
import { normalizeRelations, type EntityRelation } from './relations.js';
import type { MemoryScopeFilter } from './scoping.js';
import type { TrustLevel } from '../types.js';

const log = childLogger('temporal-graph');

// ─── Types ──────────────────────────────────────────────────────────

/** A fact with bi-temporal metadata. */
export interface TemporalFact {
  /** Unique ID (UUID). */
  id: string;
  /** Fact statement. */
  statement: string;
  /** Category. */
  category: string;
  /** Confidence 0..1. */
  confidence: number;
  /** Tags. */
  tags: string[];
  /** Entities mentioned. */
  entities: string[];
  /** When the fact became true in the world (ISO 8601). */
  validFrom: string;
  /** When the fact stopped being true (ISO 8601). null/undefined = still valid. */
  validTo?: string;
  /** When the system recorded this fact (ISO 8601). */
  recordedAt: string;
  /** Whether this fact is currently valid. */
  valid: boolean;
  /** ID of the fact that supersedes this one. */
  supersededBy?: string;
  /** Reason for invalidation. */
  invalidationReason?: string;
  /** Multi-tenancy scope (PH-007) — absent = global/shared fact. */
  scope?: MemoryScopeFilter;
  /** Provenance (TR-16): 'system' | 'user' | 'external'. */
  trustLevel?: TrustLevel;
  /** Relationships to other facts. */
  relationships: FactRelationship[];
  /** UI-29: typed entity relations (subject-predicate-object). */
  relations: EntityRelation[];
}

/** A relationship between facts. */
export interface FactRelationship {
  /** Target fact ID. */
  targetId: string;
  /** Relationship type. */
  type: FactRelationType;
  /** Optional metadata. */
  metadata?: Record<string, unknown>;
}

/** Types of relationships between facts. */
export type FactRelationType =
  | 'supersedes'      // this fact replaces the target
  | 'contradicts'     // this fact contradicts the target
  | 'supports'        // this fact supports/evidence for the target
  | 'related'         // generally related
  | 'causes'          // this fact caused the target
  | 'derived';        // this fact was derived from the target

/** Input for adding a fact. */
export interface AddFactInput {
  statement: string;
  category?: string;
  confidence?: number;
  tags?: string[];
  entities?: string[];
  validFrom?: string;
  /** If this fact supersedes an existing fact, its ID. */
  supersedesFactId?: string;
  invalidationReason?: string;
  /** Multi-tenancy scope (userId/agentId/appId/runId). Omit = global fact. */
  scope?: MemoryScopeFilter;
  /** Provenance (TR-16). Default 'user'. */
  trustLevel?: TrustLevel;
  /** UI-29: typed entity relations. */
  relations?: EntityRelation[];
}

/** Query parameters for point-in-time. */
export interface TemporalQuery {
  /** Point in time (ISO 8601). Returns facts valid at this moment. */
  atTime?: string;
  /** Filter by entity. */
  entity?: string;
  /** Filter by category. */
  category?: string;
  /** Filter by tag. */
  tag?: string;
  /** Include invalidated facts. */
  includeInvalidated?: boolean;
  /** Maximum results. */
  limit?: number;
}

// ─── Storage ────────────────────────────────────────────────────────

interface GraphStorage {
  facts: Record<string, TemporalFact>;
  version: number;
}

// ─── TemporalGraph ──────────────────────────────────────────────────

export interface SnapshotOptions {
  /** Snapshot directory; default <storagePath>.snapshots. */
  dir?: string;
  /** Minimum interval between snapshots; default 1 hour. 0 = every save. */
  intervalMs?: number;
  /** Number of snapshots to keep; default 24. */
  keep?: number;
}

export class TemporalGraph {
  private storage: GraphStorage;
  private readonly storagePath: string;
  private readonly snapshotDir: string;
  private readonly snapshotIntervalMs: number;
  private readonly snapshotKeep: number;
  private lastSnapshotMs = 0;
  private snapshotSeq = 0;

  constructor(options: { storagePath: string; snapshot?: SnapshotOptions }) {
    this.storagePath = options.storagePath;
    this.snapshotDir = options.snapshot?.dir ?? `${options.storagePath}.snapshots`;
    this.snapshotIntervalMs = options.snapshot?.intervalMs ?? 60 * 60 * 1000;
    this.snapshotKeep = Math.max(1, options.snapshot?.keep ?? 24);
    this.storage = { facts: {}, version: 1 };
    this.load();
  }

  // ─── Persistence ──────────────────────────────────────────────────

  private load(): void {
    try {
      if (existsSync(this.storagePath)) {
        const raw = readFileSync(this.storagePath, 'utf-8');
        this.storage = JSON.parse(raw) as GraphStorage;
        for (const fact of Object.values(this.storage.facts ?? {})) {
          fact.relationships ??= [];
          fact.relations ??= [];
        }
      }
    } catch (e) {
      log.warn({ error: e, path: this.storagePath }, 'failed to load temporal graph — starting fresh');
    }
  }

  private save(): void {
    try {
      writeFileAtomicSync(this.storagePath, JSON.stringify(this.storage, null, 2));
      this.maybeSnapshot();
    } catch (e) {
      log.error({ error: e, path: this.storagePath }, 'failed to save temporal graph');
    }
  }

  /** MU-06: periodic copy of the whole graph, bounded by keep; never blocks a write. */
  private maybeSnapshot(): void {
    const now = Date.now();
    if (now - this.lastSnapshotMs < this.snapshotIntervalMs) return;
    try {
      mkdirSync(this.snapshotDir, { recursive: true });
      const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
      const name = `temporal-graph-${stamp}-${String(++this.snapshotSeq).padStart(3, '0')}.json`;
      const content = readFileSync(this.storagePath, 'utf8');
      writeFileAtomicSync(join(this.snapshotDir, name), content);
      this.lastSnapshotMs = now;
      this.pruneSnapshots();
    } catch (e) {
      log.warn({ error: e, path: this.snapshotDir }, 'temporal graph snapshot failed');
    }
  }

  private pruneSnapshots(): void {
    const files = readdirSync(this.snapshotDir)
      .filter((f) => f.startsWith('temporal-graph-') && f.endsWith('.json'))
      .map((f) => ({ f, mtime: statSync(join(this.snapshotDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime || b.f.localeCompare(a.f));
    for (const { f } of files.slice(this.snapshotKeep)) {
      try { rmSync(join(this.snapshotDir, f), { force: true }); } catch { /* best effort */ }
    }
  }

  // ─── Public API ───────────────────────────────────────────────────

  /**
   * Add a new fact to the graph.
   * If supersedesFactId is provided, marks the old fact as invalidated.
   */
  addFact(input: AddFactInput): TemporalFact {
    const now = new Date().toISOString();
    const id = randomUUID();
    const relationships: FactRelationship[] = [];

    // Handle supersedes
    if (input.supersedesFactId) {
      const oldFact = this.storage.facts[input.supersedesFactId];
      if (oldFact) {
        // Invalidate old fact
        oldFact.valid = false;
        oldFact.validTo = input.validFrom ?? now;
        oldFact.supersededBy = id;
        oldFact.invalidationReason = input.invalidationReason ?? 'superseded';

        // Add relationship: new fact supersedes old
        relationships.push({
          targetId: input.supersedesFactId,
          type: 'supersedes',
          metadata: { reason: input.invalidationReason },
        });

        // Copy relationships from old fact (related facts are inherited)
        for (const rel of oldFact.relationships) {
          if (rel.type !== 'supersedes') {
            relationships.push({ ...rel });
          }
        }

        log.info({ oldFactId: oldFact.id, newFactId: id }, 'fact invalidated and superseded');
      }
    }

    const fact: TemporalFact = {
      id,
      statement: input.statement,
      category: input.category ?? 'fact',
      confidence: input.confidence ?? 0.5,
      tags: input.tags ?? [],
      entities: input.entities ?? [],
      validFrom: input.validFrom ?? now,
      recordedAt: now,
      valid: true,
      trustLevel: input.trustLevel ?? 'user',
      ...(input.scope ? { scope: input.scope } : {}),
      relationships,
      relations: normalizeRelations(input.relations),
    };

    this.storage.facts[id] = fact;
    this.save();

    log.info({ factId: id, category: fact.category }, 'fact added to temporal graph');
    return fact;
  }

  /**
   * Invalidate a fact without a replacement.
   */
  invalidateFact(factId: string, reason: string): boolean {
    const fact = this.storage.facts[factId];
    if (!fact) return false;

    fact.valid = false;
    fact.validTo = new Date().toISOString();
    fact.invalidationReason = reason;
    this.save();

    log.info({ factId, reason }, 'fact invalidated');
    return true;
  }

  /**
   * Get a fact by ID.
   */
  getFact(factId: string): TemporalFact | null {
    return this.storage.facts[factId] ?? null;
  }

  /**
   * Query facts at a specific point in time.
   * Returns facts where validFrom <= atTime < validTo (or validTo is undefined).
   */
  queryAtTime(atTime: string): TemporalFact[] {
    return this.query({ atTime, includeInvalidated: false });
  }

  /**
   * Query facts with optional filters.
   */
  query(q: TemporalQuery): TemporalFact[] {
    let facts = Object.values(this.storage.facts);

    // Point-in-time filter
    if (q.atTime) {
      facts = facts.filter((f) => {
        const validFromOk = f.validFrom <= q.atTime!;
        const validToOk = !f.validTo || f.validTo > q.atTime!;
        return validFromOk && validToOk;
      });
    } else if (!q.includeInvalidated) {
      // Current valid facts only
      facts = facts.filter((f) => f.valid);
    }

    // Entity filter
    if (q.entity) {
      facts = facts.filter((f) => f.entities.includes(q.entity!));
    }

    // Category filter
    if (q.category) {
      facts = facts.filter((f) => f.category === q.category);
    }

    // Tag filter
    if (q.tag) {
      facts = facts.filter((f) => f.tags.includes(q.tag!));
    }

    // Sort by validFrom descending (most recent first)
    facts.sort((a, b) => b.validFrom.localeCompare(a.validFrom));

    // Apply limit
    if (q.limit) {
      facts = facts.slice(0, q.limit);
    }

    return facts;
  }

  /**
   * Get the history of a fact (chain of supersessions).
   */
  getFactHistory(factId: string): TemporalFact[] {
    const history: TemporalFact[] = [];
    let current = this.storage.facts[factId];
    if (!current) return history;

    // Walk backwards: find facts that this one superseded
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      history.unshift(current);

      const supersededRel = current.relationships.find((r) => r.type === 'supersedes');
      if (supersededRel) {
        current = this.storage.facts[supersededRel.targetId];
      } else {
        break;
      }
    }

    // Walk forwards: find facts that superseded this one
    current = this.storage.facts[factId];
    const forwardHistory: TemporalFact[] = [];
    while (current?.supersededBy) {
      const next = this.storage.facts[current.supersededBy];
      if (!next || visited.has(next.id)) break;
      visited.add(next.id);
      forwardHistory.push(next);
      current = next;
    }

    return [...history, ...forwardHistory];
  }

  /**
   * Add a relationship between two facts.
   */
  addRelationship(sourceId: string, targetId: string, type: FactRelationType, metadata?: Record<string, unknown>): boolean {
    const source = this.storage.facts[sourceId];
    if (!source) return false;

    source.relationships.push({ targetId, type, metadata });
    this.save();
    return true;
  }

  /**
   * Get all facts that contradict or support a given fact.
   */
  getRelatedFacts(factId: string, type?: FactRelationType): TemporalFact[] {
    const fact = this.storage.facts[factId];
    if (!fact) return [];

    const related: TemporalFact[] = [];
    for (const rel of fact.relationships) {
      if (type && rel.type !== type) continue;
      const target = this.storage.facts[rel.targetId];
      if (target) related.push(target);
    }

    // Also find facts that reference this fact
    for (const f of Object.values(this.storage.facts)) {
      if (f.id === factId) continue;
      for (const rel of f.relationships) {
        if (rel.targetId === factId && (!type || rel.type === type)) {
          if (!related.find((r) => r.id === f.id)) {
            related.push(f);
          }
        }
      }
    }

    return related;
  }

  /**
   * Get statistics about the graph.
   */
  stats(): { totalFacts: number; validFacts: number; invalidatedFacts: number; categories: Record<string, number> } {
    const facts = Object.values(this.storage.facts);
    const categories: Record<string, number> = {};
    for (const f of facts) {
      categories[f.category] = (categories[f.category] ?? 0) + 1;
    }
    return {
      totalFacts: facts.length,
      validFacts: facts.filter((f) => f.valid).length,
      invalidatedFacts: facts.filter((f) => !f.valid).length,
      categories,
    };
  }

  /**
   * Clear all facts (for testing).
   */
  clear(): void {
    this.storage = { facts: {}, version: 1 };
    this.save();
  }
}
