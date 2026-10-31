/**
 * Behavioural tests for the pure graph model (entities/facts topology).
 */

import { describe, it, expect } from 'vitest';
import type { TemporalFact } from './api-client';
import {
  buildEntitiesGraph,
  buildFactsGraph,
  buildGraph,
  dedupeFacts,
  entityCoOccurrence,
  entityMentions,
  entityNodeId,
  factNodeId,
  oftenAppearsWith,
  replacedLinks,
  truncateLabel,
} from './graph-model';

function fact(over: Partial<TemporalFact> & { id: string }): TemporalFact {
  return {
    id: over.id,
    statement: over.statement ?? `Statement ${over.id}`,
    category: over.category ?? 'general',
    confidence: over.confidence ?? 0.9,
    tags: over.tags ?? [],
    entities: over.entities ?? [],
    validFrom: over.validFrom ?? '2026-01-01T00:00:00.000Z',
    recordedAt: over.recordedAt ?? '2026-01-01T00:00:00.000Z',
    valid: over.valid ?? true,
    relationships: over.relationships ?? [],
    ...(over.supersededBy === undefined ? {} : { supersededBy: over.supersededBy }),
    ...(over.validTo === undefined ? {} : { validTo: over.validTo }),
    ...(over.invalidationReason === undefined ? {} : { invalidationReason: over.invalidationReason }),
  };
}

describe('graph-model: identity helpers', () => {
  it('builds namespaced ids', () => {
    expect(entityNodeId('Alice')).toBe('entity:Alice');
    expect(factNodeId('f-1')).toBe('fact:f-1');
  });
});

describe('graph-model: dedupeFacts', () => {
  it('keeps the first fact per id in input order', () => {
    const first = fact({ id: 'a', statement: 'first' });
    const duplicate = fact({ id: 'a', statement: 'later' });
    const other = fact({ id: 'b' });
    const result = dedupeFacts([first, duplicate, other]);
    expect(result.map((f) => f.id)).toEqual(['a', 'b']);
    expect(result[0].statement).toBe('first');
  });
});

describe('graph-model: entity normalisation', () => {
  it('trims names and drops empty/duplicate entries', () => {
    const graph = buildEntitiesGraph([fact({ id: 'f1', entities: ['  Alice ', 'Alice', '', '   ', 'Bob'] })]);
    expect(graph.nodes.map((n) => n.id)).toEqual(['entity:Alice', 'entity:Bob']);
    const alice = graph.nodes.find((n) => n.id === 'entity:Alice');
    expect(alice?.label).toBe('Alice');
    expect(alice?.factCount).toBe(1);
  });

  it('treats entity names case-sensitively', () => {
    const graph = buildEntitiesGraph([fact({ id: 'f1', entities: ['alice', 'Alice'] })]);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(['entity:Alice', 'entity:alice']);
  });
});

describe('graph-model: buildFactsGraph', () => {
  it('marks superseded facts', () => {
    const graph = buildFactsGraph([
      fact({ id: 'old', valid: false }),
      fact({ id: 'now', valid: true }),
    ]);
    expect(graph.nodes.find((n) => n.id === 'fact:old')?.state).toBe('superseded');
    expect(graph.nodes.find((n) => n.id === 'fact:now')?.state).toBe('valid');
  });

  it('emits one mentions edge per fact/entity pair', () => {
    const graph = buildFactsGraph([fact({ id: 'f1', entities: ['A', 'A', ' A ', 'B'] })]);
    const mentions = graph.edges.filter((e) => e.kind === 'mentions');
    expect(mentions).toHaveLength(2);
    expect(mentions.map((e) => e.target).sort()).toEqual(['entity:A', 'entity:B']);
    expect(mentions.every((e) => e.source === 'fact:f1' && e.weight === 1)).toBe(true);
  });

  it('orders fact nodes first (input order) then entities sorted', () => {
    const graph = buildFactsGraph([
      fact({ id: 'f2', entities: ['Zed', 'Alpha'] }),
      fact({ id: 'f1', entities: ['Mike'] }),
    ]);
    expect(graph.nodes.map((n) => n.id)).toEqual([
      'fact:f2',
      'fact:f1',
      'entity:Alpha',
      'entity:Mike',
      'entity:Zed',
    ]);
  });

  it('adds a replaces edge only when the superseding fact is present', () => {
    const withTarget = buildFactsGraph([
      fact({ id: 'old', valid: false, supersededBy: 'new' }),
      fact({ id: 'new' }),
    ]);
    const replaces = withTarget.edges.filter((e) => e.kind === 'replaces');
    expect(replaces).toHaveLength(1);
    expect(replaces[0]).toMatchObject({
      source: 'fact:old',
      target: 'fact:new',
      kind: 'replaces',
      weight: 1,
    });

    const withoutTarget = buildFactsGraph([fact({ id: 'old', valid: false, supersededBy: 'ghost' })]);
    expect(withoutTarget.edges.filter((e) => e.kind === 'replaces')).toHaveLength(0);
  });

  it('never emits self edges', () => {
    const graph = buildFactsGraph([fact({ id: 'self', supersededBy: 'self', entities: ['A'] })]);
    expect(graph.edges.every((e) => e.source !== e.target)).toBe(true);
  });

  it('counts factCount and degree from the emitted topology', () => {
    const graph = buildFactsGraph([
      fact({ id: 'f1', entities: ['A', 'B'], valid: false, supersededBy: 'f2' }),
      fact({ id: 'f2', entities: ['A'] }),
    ]);
    const a = graph.nodes.find((n) => n.id === 'entity:A');
    const b = graph.nodes.find((n) => n.id === 'entity:B');
    const f1 = graph.nodes.find((n) => n.id === 'fact:f1');
    expect(a?.factCount).toBe(2);
    expect(a?.degree).toBe(2);
    expect(b?.factCount).toBe(1);
    expect(f1?.factCount).toBe(1);
    expect(f1?.degree).toBe(3);
  });

  it('deduplicates facts before building', () => {
    const graph = buildFactsGraph([fact({ id: 'f1', entities: ['A'] }), fact({ id: 'f1', entities: ['B'] })]);
    expect(graph.nodes.filter((n) => n.type === 'fact')).toHaveLength(1);
    expect(graph.nodes.map((n) => n.id)).toEqual(['fact:f1', 'entity:A']);
  });
});

describe('graph-model: buildEntitiesGraph', () => {
  it('weights co-occurrence by shared facts', () => {
    const graph = buildEntitiesGraph([
      fact({ id: 'f1', entities: ['A', 'B'] }),
      fact({ id: 'f2', entities: ['A', 'B'] }),
      fact({ id: 'f3', entities: ['A', 'C'] }),
    ]);
    const ab = graph.edges.find((e) => e.source === 'entity:A' && e.target === 'entity:B');
    const ac = graph.edges.find((e) => e.source === 'entity:A' && e.target === 'entity:C');
    expect(ab?.weight).toBe(2);
    expect(ac?.weight).toBe(1);
    expect(ab?.kind).toBe('co-occurs');
  });

  it('emits exactly one edge per unordered pair with source < target', () => {
    const graph = buildEntitiesGraph([fact({ id: 'f1', entities: ['B', 'A'] })]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].source).toBe('entity:A');
    expect(graph.edges[0].target).toBe('entity:B');
    expect(graph.edges[0].source.localeCompare(graph.edges[0].target)).toBeLessThan(0);

    const pairKeys = graph.edges.map((e) => [e.source, e.target].sort().join('|'));
    expect(new Set(pairKeys).size).toBe(pairKeys.length);
  });

  it('skips self pairs and counts a repeated entity once per fact', () => {
    const graph = buildEntitiesGraph([fact({ id: 'f1', entities: ['A', 'A', 'B', 'A'] })]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].weight).toBe(1);
    expect(graph.edges.every((e) => e.source !== e.target)).toBe(true);
  });

  it('counts a duplicate fact id once', () => {
    const graph = buildEntitiesGraph([
      fact({ id: 'f1', entities: ['A', 'B'] }),
      fact({ id: 'f1', entities: ['A', 'B'] }),
    ]);
    expect(graph.edges[0].weight).toBe(1);
    expect(graph.nodes.find((n) => n.id === 'entity:A')?.factCount).toBe(1);
  });

  it('includes extra entities with zero facts', () => {
    const graph = buildEntitiesGraph([fact({ id: 'f1', entities: ['A'] })], ['Zed', ' Zed ', '']);
    const zed = graph.nodes.find((n) => n.id === 'entity:Zed');
    expect(zed).toBeDefined();
    expect(zed?.factCount).toBe(0);
    expect(zed?.degree).toBe(0);
    expect(graph.nodes.map((n) => n.id)).toEqual(['entity:A', 'entity:Zed']);
  });

  it('fills degree from co-occurrence edges', () => {
    const graph = buildEntitiesGraph([
      fact({ id: 'f1', entities: ['A', 'B'] }),
      fact({ id: 'f2', entities: ['A', 'C'] }),
    ]);
    const a = graph.nodes.find((n) => n.id === 'entity:A');
    expect(a?.degree).toBe(2);
    expect(a?.factCount).toBe(2);
  });

  it('has no fact nodes', () => {
    const graph = buildEntitiesGraph([fact({ id: 'f1', entities: ['A'] })]);
    expect(graph.nodes.every((n) => n.type === 'entity')).toBe(true);
    expect(graph.mode).toBe('entities');
  });
});

describe('graph-model: buildGraph', () => {
  it('dispatches by mode', () => {
    const facts = [fact({ id: 'f1', entities: ['A'] })];
    expect(buildGraph(facts, 'facts').nodes.some((n) => n.type === 'fact')).toBe(true);
    expect(buildGraph(facts, 'entities').nodes.every((n) => n.type === 'entity')).toBe(true);
  });
});

describe('graph-model: entityMentions', () => {
  it('returns mentioning facts in input order', () => {
    const facts = [
      fact({ id: 'f1', entities: ['A', 'B'] }),
      fact({ id: 'f2', entities: ['B'] }),
      fact({ id: 'f3', entities: [' A '] }),
    ];
    expect(entityMentions(facts, 'A').map((f) => f.id)).toEqual(['f1', 'f3']);
    expect(entityMentions(facts, '  ')).toEqual([]);
  });
});

describe('graph-model: entityCoOccurrence', () => {
  it('is symmetric and counts each fact once', () => {
    const counts = entityCoOccurrence([
      fact({ id: 'f1', entities: ['A', 'B', 'C'] }),
      fact({ id: 'f2', entities: ['A', 'B'] }),
    ]);
    expect(counts.get('A')?.get('B')).toBe(2);
    expect(counts.get('B')?.get('A')).toBe(2);
    expect(counts.get('A')?.get('C')).toBe(1);
    expect(counts.get('C')?.get('B')).toBe(1);
    expect(counts.get('A')?.get('A')).toBeUndefined();
  });
});

describe('graph-model: oftenAppearsWith', () => {
  it('sorts by shared desc then name and excludes self', () => {
    const facts = [
      fact({ id: 'f1', entities: ['Hub', 'Beta', 'Alpha'] }),
      fact({ id: 'f2', entities: ['Hub', 'Beta'] }),
      fact({ id: 'f3', entities: ['Hub', 'Gamma'] }),
    ];
    const rows = oftenAppearsWith(facts, 'Hub');
    expect(rows).toEqual([
      { entity: 'Beta', shared: 2 },
      { entity: 'Alpha', shared: 1 },
      { entity: 'Gamma', shared: 1 },
    ]);
    expect(rows.some((r) => r.entity === 'Hub')).toBe(false);
  });

  it('respects the limit and defaults to five', () => {
    const names = ['Hub', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const facts = names.map((name, index) => fact({ id: `f${index}`, entities: ['Hub', name] }));
    expect(oftenAppearsWith(facts, 'Hub')).toHaveLength(5);
    expect(oftenAppearsWith(facts, 'Hub', 2)).toHaveLength(2);
    expect(oftenAppearsWith(facts, 'Hub', 0)).toEqual([]);
  });

  it('returns nothing for an unknown entity', () => {
    expect(oftenAppearsWith([fact({ id: 'f1', entities: ['A'] })], 'Nope')).toEqual([]);
  });
});

describe('graph-model: replacedLinks', () => {
  it('reports both directions', () => {
    const facts = [
      fact({ id: 'old', valid: false, supersededBy: 'new' }),
      fact({ id: 'new' }),
    ];
    expect(replacedLinks(facts, 'old')).toEqual({ replaces: [], replacedBy: 'new' });
    expect(replacedLinks(facts, 'new')).toEqual({ replaces: ['old'], replacedBy: null });
    expect(replacedLinks(facts, 'absent')).toEqual({ replaces: [], replacedBy: null });
  });

  it('lists every fact replaced by the given one in input order', () => {
    const facts = [
      fact({ id: 'a', valid: false, supersededBy: 'final' }),
      fact({ id: 'b', valid: false, supersededBy: 'final' }),
      fact({ id: 'final' }),
    ];
    expect(replacedLinks(facts, 'final').replaces).toEqual(['a', 'b']);
  });
});

describe('graph-model: truncateLabel', () => {
  it('keeps short text unchanged and collapses whitespace', () => {
    expect(truncateLabel('short label')).toBe('short label');
    expect(truncateLabel('  spaced   out  ')).toBe('spaced out');
  });

  it('cuts long text with a single ellipsis within max + 1 characters', () => {
    const text = 'the quick brown fox jumps over the lazy dog and runs away';
    const result = truncateLabel(text, 20);
    expect(result.length).toBeLessThanOrEqual(21);
    expect(result.endsWith('\u2026')).toBe(true);
    expect(result.split('\u2026')).toHaveLength(2);
    expect(text.startsWith(result.slice(0, -1))).toBe(true);
  });

  it('backs off to a word boundary instead of cutting mid-word', () => {
    const result = truncateLabel('aaaa bbbb cccc dddddd eeee', 16);
    expect(result).toBe('aaaa bbbb cccc\u2026');
  });

  it('does not back off when the boundary would lose too much', () => {
    const result = truncateLabel('ab cdefghijklmnopqrstuvwxyz', 10);
    expect(result.startsWith('ab cdefgh')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(11);
  });

  it('handles text without spaces and a one-character budget', () => {
    expect(truncateLabel('abcdefghijklmnopqrstuvwxyz', 40)).toBe('abcdefghijklmnopqrstuvwxyz');
    const noSpaces = truncateLabel('abcdefghijklmnopqrstuvwxyz0123456789ABCDE', 40);
    expect(noSpaces).toHaveLength(40);
    expect(noSpaces.endsWith('\u2026')).toBe(true);
    expect(truncateLabel('abcdefghij', 1)).toBe('\u2026');
  });

  it('defaults to 40 characters', () => {
    const text = 'x'.repeat(60);
    const result = truncateLabel(text);
    expect(result.length).toBeLessThanOrEqual(41);
    expect(result).toBe(`${'x'.repeat(39)}\u2026`);
  });
});

describe('graph-model: determinism', () => {
  it('produces deep-equal graphs for identical input', () => {
    const facts = [
      fact({ id: 'f1', entities: ['B', 'A'], valid: false, supersededBy: 'f2' }),
      fact({ id: 'f2', entities: ['A', 'C'] }),
    ];
    expect(buildFactsGraph(facts)).toEqual(buildFactsGraph(facts));
    expect(buildEntitiesGraph(facts, ['Zed'])).toEqual(buildEntitiesGraph(facts, ['Zed']));
  });
});
