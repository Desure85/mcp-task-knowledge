/**
 * Pure graph model for the knowledge-graph page.
 *
 * Turns temporal facts into renderable nodes/edges. No React, no DOM, no
 * colours: the view layer owns presentation, this module owns topology.
 * Every exported function is deterministic (no random, no clock).
 */

import type { TemporalFact } from './api-client';

export type GraphMode = 'entities' | 'facts';
export type GraphNodeType = 'entity' | 'fact';
export type FactState = 'valid' | 'superseded';
export type GraphEdgeKind = 'mentions' | 'co-occurs' | 'replaces';

export interface GraphNode {
  id: string;
  label: string;
  type: GraphNodeType;
  entity?: string;
  factId?: string;
  state?: FactState;
  factCount: number;
  degree: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  weight: number;
}

export interface GraphData {
  mode: GraphMode;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const ELLIPSIS = '\u2026';
const DEFAULT_LABEL_MAX = 40;
/** Collapse runs of whitespace so measurements stay predictable. */
const WHITESPACE = /\s+/g;
/** Trailing punctuation/space stripped before the ellipsis is appended. */
const TRAILING_JUNK = /[\s,.;:!?\-\u2013\u2014]+$/u;

/** Stable id for an entity node. */
export function entityNodeId(name: string): string {
  return `entity:${name.trim()}`;
}

/** Stable id for a fact node. */
export function factNodeId(id: string): string {
  return `fact:${id}`;
}

/**
 * Shorten a label to at most `max` characters while avoiding a mid-word cut
 * when a nearby word boundary is good enough. Result length is `<= max + 1`
 * only because the ellipsis is appended after trimming.
 */
export function truncateLabel(text: string, max: number = DEFAULT_LABEL_MAX): string {
  const limit = Math.max(1, Math.floor(max));
  const flat = text.replace(WHITESPACE, ' ').trim();
  if (flat.length <= limit) return flat;

  let cut = flat.slice(0, limit - 1);
  const nextChar = flat.charAt(limit - 1);
  if (nextChar !== ' ' && cut.length > 0) {
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace > 0 && lastSpace >= limit * 0.6) cut = cut.slice(0, lastSpace);
  }
  cut = cut.replace(TRAILING_JUNK, '').trim();
  return `${cut}${ELLIPSIS}`;
}

/** Trimmed, non-empty, case-sensitive unique entity names in first-seen order. */
function normalizeEntities(entities: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of entities) {
    const name = String(raw).trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** Deduplicate facts by id, keeping the first occurrence in input order. */
export function dedupeFacts(facts: TemporalFact[]): TemporalFact[] {
  const seen = new Set<string>();
  const out: TemporalFact[] = [];
  for (const fact of facts) {
    if (seen.has(fact.id)) continue;
    seen.add(fact.id);
    out.push(fact);
  }
  return out;
}

/** Facts that mention `entity` (trimmed match), in input order. */
export function entityMentions(facts: TemporalFact[], entity: string): TemporalFact[] {
  const needle = entity.trim();
  if (!needle) return [];
  return facts.filter((fact) => normalizeEntities(fact.entities ?? []).includes(needle));
}

/**
 * Symmetric entity co-occurrence matrix: `map.get(a).get(b)` is the number of
 * facts that mention both `a` and `b` (each fact counted once per pair).
 */
export function entityCoOccurrence(facts: TemporalFact[]): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>();
  const bump = (a: string, b: string): void => {
    let row = counts.get(a);
    if (!row) {
      row = new Map<string, number>();
      counts.set(a, row);
    }
    row.set(b, (row.get(b) ?? 0) + 1);
  };

  for (const fact of dedupeFacts(facts)) {
    const names = normalizeEntities(fact.entities ?? []);
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        bump(names[i], names[j]);
        bump(names[j], names[i]);
      }
    }
  }
  return counts;
}

/**
 * Entities sharing facts with `entity`, ordered by shared count (desc) then
 * name. Self and empty names are excluded; at most `limit` rows are returned.
 */
export function oftenAppearsWith(
  facts: TemporalFact[],
  entity: string,
  limit: number = 5,
): Array<{ entity: string; shared: number }> {
  const needle = entity.trim();
  const cap = Math.max(0, Math.floor(limit));
  if (!needle || cap === 0) return [];

  const counts = new Map<string, number>();
  for (const fact of dedupeFacts(facts)) {
    const names = normalizeEntities(fact.entities ?? []);
    if (!names.includes(needle)) continue;
    for (const other of names) {
      if (other === needle) continue;
      counts.set(other, (counts.get(other) ?? 0) + 1);
    }
  }

  return Array.from(counts, ([name, shared]) => ({ entity: name, shared }))
    .sort((a, b) => b.shared - a.shared || a.entity.localeCompare(b.entity))
    .slice(0, cap);
}

/**
 * Direct replacement links around one fact: the ids it superseded and the id
 * that superseded it (`null` when it is still current).
 */
export function replacedLinks(
  facts: TemporalFact[],
  factId: string,
): { replaces: string[]; replacedBy: string | null } {
  const unique = dedupeFacts(facts);
  const replaces: string[] = [];
  const seen = new Set<string>();
  let replacedBy: string | null = null;

  for (const fact of unique) {
    if (fact.id === factId && fact.supersededBy) {
      replacedBy = fact.supersededBy;
      continue;
    }
    if (fact.supersededBy === factId && !seen.has(fact.id)) {
      seen.add(fact.id);
      replaces.push(fact.id);
    }
  }
  return { replaces, replacedBy };
}

/** Fill `degree` on every node from the emitted edges. */
function withDegrees(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  for (const node of nodes) node.degree = degree.get(node.id) ?? 0;
  return nodes;
}

function edgeId(kind: GraphEdgeKind, source: string, target: string): string {
  return `${kind}:${source}>${target}`;
}

/** Fact nodes (input order) + entity nodes, `mentions` and `replaces` edges. */
export function buildFactsGraph(facts: TemporalFact[]): GraphData {
  const unique = dedupeFacts(facts);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const factIds = new Set(unique.map((fact) => fact.id));
  const entityFactCount = new Map<string, number>();

  const pushEdge = (kind: GraphEdgeKind, source: string, target: string, weight: number): void => {
    if (source === target) return;
    const id = edgeId(kind, source, target);
    if (edgeKeys.has(id)) return;
    edgeKeys.add(id);
    edges.push({ id, source, target, kind, weight });
  };

  for (const fact of unique) {
    const nodeId = factNodeId(fact.id);
    nodes.push({
      id: nodeId,
      label: fact.statement,
      type: 'fact',
      factId: fact.id,
      state: fact.valid ? 'valid' : 'superseded',
      factCount: 1,
      degree: 0,
    });
    for (const entity of normalizeEntities(fact.entities ?? [])) {
      pushEdge('mentions', nodeId, entityNodeId(entity), 1);
      entityFactCount.set(entity, (entityFactCount.get(entity) ?? 0) + 1);
    }
  }

  for (const fact of unique) {
    const target = fact.supersededBy;
    if (target && target !== fact.id && factIds.has(target)) {
      pushEdge('replaces', factNodeId(fact.id), factNodeId(target), 1);
    }
  }

  const entityNames = Array.from(entityFactCount.keys()).sort((a, b) => a.localeCompare(b));
  for (const name of entityNames) {
    nodes.push({
      id: entityNodeId(name),
      label: name,
      type: 'entity',
      entity: name,
      factCount: entityFactCount.get(name) ?? 0,
      degree: 0,
    });
  }

  return { mode: 'facts', nodes: withDegrees(nodes, edges), edges };
}

/** Entity-only graph with weighted `co-occurs` edges; no fact nodes. */
export function buildEntitiesGraph(facts: TemporalFact[], extraEntities: string[] = []): GraphData {
  const unique = dedupeFacts(facts);
  const factCount = new Map<string, number>();
  const coOccurrence = new Map<string, Map<string, number>>();

  for (const fact of unique) {
    const names = normalizeEntities(fact.entities ?? []);
    for (const name of names) factCount.set(name, (factCount.get(name) ?? 0) + 1);
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        const a = names[i];
        const b = names[j];
        let row = coOccurrence.get(a);
        if (!row) {
          row = new Map<string, number>();
          coOccurrence.set(a, row);
        }
        row.set(b, (row.get(b) ?? 0) + 1);
      }
    }
  }

  for (const name of normalizeEntities(extraEntities)) {
    if (!factCount.has(name)) factCount.set(name, 0);
  }

  const nodes: GraphNode[] = Array.from(factCount.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      id: entityNodeId(name),
      label: name,
      type: 'entity' as const,
      entity: name,
      factCount: factCount.get(name) ?? 0,
      degree: 0,
    }));

  const edges: GraphEdge[] = [];
  const emitted = new Set<string>();
  for (const [a, row] of coOccurrence) {
    for (const [b, shared] of row) {
      const source = a.localeCompare(b) < 0 ? a : b;
      const target = source === a ? b : a;
      const key = `${source}\u0000${target}`;
      if (emitted.has(key)) continue;
      emitted.add(key);
      edges.push({
        id: edgeId('co-occurs', entityNodeId(source), entityNodeId(target)),
        source: entityNodeId(source),
        target: entityNodeId(target),
        kind: 'co-occurs',
        weight: shared,
      });
    }
  }
  edges.sort((x, y) => x.id.localeCompare(y.id));

  return { mode: 'entities', nodes: withDegrees(nodes, edges), edges };
}

/** Build the graph for the requested mode. */
export function buildGraph(facts: TemporalFact[], mode: GraphMode, extraEntities?: string[]): GraphData {
  return mode === 'entities' ? buildEntitiesGraph(facts, extraEntities) : buildFactsGraph(facts);
}
