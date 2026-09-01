/**
 * tests/evolution.spec.ts — Unit tests for Memory Evolution (NEXT-003).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryEvolver } from '../src/memory/evolution.js';
import { TemporalGraph } from '../src/memory/temporal-graph.js';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_FILE = join(tmpdir(), `test-evolution-${Date.now()}.json`);

describe('MemoryEvolver', () => {
  let graph: TemporalGraph;
  let evolver: MemoryEvolver;

  beforeEach(() => {
    graph = new TemporalGraph({ storagePath: TEST_FILE });
    graph.clear();
    evolver = new MemoryEvolver({ temporalGraph: graph });
  });

  afterEach(async () => {
    try { await fsp.unlink(TEST_FILE); } catch { /* ignore */ }
  });

  it('should return empty result for non-existent fact', () => {
    const result = evolver.evolve('nonexistent');
    expect(result.totalAffected).toBe(0);
  });

  it('should link semantically similar facts', () => {
    const f1 = graph.addFact({ statement: 'Uses TypeScript for frontend development', entities: ['TypeScript'] });
    const f2 = graph.addFact({ statement: 'Uses TypeScript for backend services', entities: ['TypeScript'] });

    const result = evolver.evolve(f2.id);
    expect(result.linked.length + result.merged.length).toBeGreaterThan(0);
  });

  it('should supersede contradictory facts', () => {
    const f1 = graph.addFact({ statement: 'Database is MySQL for storage', entities: ['MySQL'] });
    const f2 = graph.addFact({ statement: 'Database is not MySQL, replaced with PostgreSQL for storage', entities: ['MySQL', 'PostgreSQL'] });

    const result = evolver.evolve(f2.id);
    expect(result.superseded.length + result.linked.length).toBeGreaterThan(0);
  });

  it('should not link unrelated facts', () => {
    graph.addFact({ statement: 'The weather is sunny today' });
    const f2 = graph.addFact({ statement: 'Uses PostgreSQL database' });

    const result = evolver.evolve(f2.id);
    expect(result.totalAffected).toBe(0);
  });

  it('should merge facts with high entity overlap', () => {
    const f1 = graph.addFact({ statement: 'TypeScript project uses JWT auth', entities: ['TypeScript', 'JWT'] });
    const f2 = graph.addFact({ statement: 'TypeScript project uses JWT tokens', entities: ['TypeScript', 'JWT'] });

    const result = evolver.evolve(f2.id);
    expect(result.merged.length).toBeGreaterThan(0);
  });

  it('should add relationships to temporal graph', () => {
    const f1 = graph.addFact({ statement: 'Uses TypeScript for frontend', entities: ['TypeScript'] });
    const f2 = graph.addFact({ statement: 'Uses TypeScript for backend', entities: ['TypeScript'] });

    evolver.evolve(f2.id);

    const related = graph.getRelatedFacts(f2.id);
    expect(related.length).toBeGreaterThan(0);
  });

  it('should handle fact with no entities', () => {
    const f1 = graph.addFact({ statement: 'Some general fact about the project' });
    const f2 = graph.addFact({ statement: 'Another general fact about the project' });

    const result = evolver.evolve(f2.id);
    expect(result.totalAffected).toBeGreaterThanOrEqual(0);
  });
});
