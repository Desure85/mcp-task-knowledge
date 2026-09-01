/**
 * tests/temporal-graph.spec.ts — Unit tests for Temporal Knowledge Graph (NEXT-001).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TemporalGraph } from '../src/memory/temporal-graph.js';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_FILE = join(tmpdir(), `test-temporal-${Date.now()}.json`);

describe('TemporalGraph', () => {
  let graph: TemporalGraph;

  beforeEach(() => {
    graph = new TemporalGraph({ storagePath: TEST_FILE });
    graph.clear();
  });

  afterEach(async () => {
    try { await fsp.unlink(TEST_FILE); } catch { /* ignore */ }
  });

  it('should add a fact', () => {
    const fact = graph.addFact({ statement: 'DB is PostgreSQL', category: 'fact' });
    expect(fact.id).toBeDefined();
    expect(fact.statement).toBe('DB is PostgreSQL');
    expect(fact.valid).toBe(true);
    expect(fact.validFrom).toBeDefined();
    expect(fact.recordedAt).toBeDefined();
  });

  it('should query current valid facts', () => {
    graph.addFact({ statement: 'Fact A' });
    graph.addFact({ statement: 'Fact B' });
    const facts = graph.query({});
    expect(facts.length).toBe(2);
    expect(facts.every((f) => f.valid)).toBe(true);
  });

  it('should query at a point in time', () => {
    graph.addFact({ statement: 'Old fact', validFrom: '2026-01-01T00:00:00Z' });
    graph.addFact({ statement: 'New fact', validFrom: '2026-06-01T00:00:00Z' });

    const atMarch = graph.queryAtTime('2026-03-01T00:00:00Z');
    expect(atMarch.length).toBe(1);
    expect(atMarch[0].statement).toBe('Old fact');

    const atJuly = graph.queryAtTime('2026-07-01T00:00:00Z');
    expect(atJuly.length).toBe(2);
  });

  it('should invalidate a fact', () => {
    const fact = graph.addFact({ statement: 'Temporary fact' });
    const success = graph.invalidateFact(fact.id, 'no longer relevant');
    expect(success).toBe(true);

    const updated = graph.getFact(fact.id);
    expect(updated?.valid).toBe(false);
    expect(updated?.validTo).toBeDefined();
    expect(updated?.invalidationReason).toBe('no longer relevant');
  });

  it('should supersede an old fact', () => {
    const oldFact = graph.addFact({ statement: 'DB is MySQL', validFrom: '2026-01-01T00:00:00Z' });
    const newFact = graph.addFact({
      statement: 'DB is PostgreSQL',
      validFrom: '2026-06-01T00:00:00Z',
      supersedesFactId: oldFact.id,
      invalidationReason: 'migrated to PostgreSQL',
    });

    // Old fact should be invalidated
    const old = graph.getFact(oldFact.id);
    expect(old?.valid).toBe(false);
    expect(old?.validTo).toBe('2026-06-01T00:00:00Z');
    expect(old?.supersededBy).toBe(newFact.id);

    // New fact should have relationship to old
    expect(newFact.relationships.length).toBeGreaterThan(0);
    const supersedesRel = newFact.relationships.find((r) => r.type === 'supersedes');
    expect(supersedesRel?.targetId).toBe(oldFact.id);
  });

  it('should get fact history chain', () => {
    const v1 = graph.addFact({ statement: 'v1: use REST', validFrom: '2026-01-01T00:00:00Z' });
    const v2 = graph.addFact({
      statement: 'v2: use GraphQL',
      validFrom: '2026-03-01T00:00:00Z',
      supersedesFactId: v1.id,
    });
    const v3 = graph.addFact({
      statement: 'v3: use gRPC',
      validFrom: '2026-06-01T00:00:00Z',
      supersedesFactId: v2.id,
    });

    const history = graph.getFactHistory(v2.id);
    // Should include v1, v2, v3
    expect(history.length).toBe(3);
    const statements = history.map((f) => f.statement);
    expect(statements).toContain('v1: use REST');
    expect(statements).toContain('v2: use GraphQL');
    expect(statements).toContain('v3: use gRPC');
  });

  it('should filter by entity', () => {
    graph.addFact({ statement: 'Fact about TypeScript', entities: ['TypeScript'] });
    graph.addFact({ statement: 'Fact about Python', entities: ['Python'] });

    const tsFacts = graph.query({ entity: 'TypeScript' });
    expect(tsFacts.length).toBe(1);
    expect(tsFacts[0].statement).toContain('TypeScript');
  });

  it('should filter by category', () => {
    graph.addFact({ statement: 'Pref', category: 'preference' });
    graph.addFact({ statement: 'Dec', category: 'decision' });

    const decisions = graph.query({ category: 'decision' });
    expect(decisions.length).toBe(1);
    expect(decisions[0].category).toBe('decision');
  });

  it('should filter by tag', () => {
    graph.addFact({ statement: 'Tagged', tags: ['important'] });
    graph.addFact({ statement: 'Not tagged', tags: ['minor'] });

    const important = graph.query({ tag: 'important' });
    expect(important.length).toBe(1);
  });

  it('should include invalidated facts when requested', () => {
    const fact = graph.addFact({ statement: 'Temp' });
    graph.invalidateFact(fact.id, 'test');

    const withoutInvalidated = graph.query({ includeInvalidated: false });
    const withInvalidated = graph.query({ includeInvalidated: true });
    expect(withoutInvalidated.length).toBe(0);
    expect(withInvalidated.length).toBe(1);
  });

  it('should add relationship between facts', () => {
    const f1 = graph.addFact({ statement: 'Fact 1' });
    const f2 = graph.addFact({ statement: 'Fact 2' });

    const success = graph.addRelationship(f1.id, f2.id, 'supports', { evidence: 'test' });
    expect(success).toBe(true);

    const related = graph.getRelatedFacts(f1.id, 'supports');
    expect(related.length).toBe(1);
    expect(related[0].id).toBe(f2.id);
  });

  it('should get related facts bidirectionally', () => {
    const f1 = graph.addFact({ statement: 'Fact 1' });
    const f2 = graph.addFact({ statement: 'Fact 2' });

    graph.addRelationship(f1.id, f2.id, 'contradicts');

    // From f1's perspective
    const fromF1 = graph.getRelatedFacts(f1.id);
    expect(fromF1.length).toBe(1);

    // From f2's perspective (should also find f1)
    const fromF2 = graph.getRelatedFacts(f2.id);
    expect(fromF2.length).toBe(1);
    expect(fromF2[0].id).toBe(f1.id);
  });

  it('should return stats', () => {
    graph.addFact({ statement: 'A', category: 'preference' });
    graph.addFact({ statement: 'B', category: 'decision' });
    const f = graph.addFact({ statement: 'C' });
    graph.invalidateFact(f.id, 'test');

    const stats = graph.stats();
    expect(stats.totalFacts).toBe(3);
    expect(stats.validFacts).toBe(2);
    expect(stats.invalidatedFacts).toBe(1);
    expect(stats.categories['preference']).toBe(1);
    expect(stats.categories['decision']).toBe(1);
  });

  it('should persist and reload from disk', () => {
    graph.addFact({ statement: 'Persistent fact' });

    const graph2 = new TemporalGraph({ storagePath: TEST_FILE });
    const facts = graph2.query({});
    expect(facts.length).toBe(1);
    expect(facts[0].statement).toBe('Persistent fact');
  });

  it('should return empty for non-existent fact', () => {
    const fact = graph.getFact('nonexistent');
    expect(fact).toBeNull();
  });

  it('should return false for invalidating non-existent fact', () => {
    const success = graph.invalidateFact('nonexistent', 'test');
    expect(success).toBe(false);
  });

  it('should sort facts by validFrom descending', () => {
    graph.addFact({ statement: 'Old', validFrom: '2026-01-01T00:00:00Z' });
    graph.addFact({ statement: 'New', validFrom: '2026-12-01T00:00:00Z' });

    const facts = graph.query({});
    expect(facts[0].statement).toBe('New');
    expect(facts[1].statement).toBe('Old');
  });

  it('should respect limit in query', () => {
    for (let i = 0; i < 10; i++) {
      graph.addFact({ statement: `Fact ${i}` });
    }
    const facts = graph.query({ limit: 3 });
    expect(facts.length).toBe(3);
  });
});
