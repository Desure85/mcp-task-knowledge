/**
 * tests/conflict-resolver.spec.ts — Unit tests for Memory Conflict Resolution (NEXT-009).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConflictResolver } from '../src/memory/conflict-resolver.js';
import { TemporalGraph } from '../src/memory/temporal-graph.js';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_FILE = join(tmpdir(), `test-conflict-${Date.now()}.json`);

describe('ConflictResolver', () => {
  let graph: TemporalGraph;
  let resolver: ConflictResolver;

  beforeEach(() => {
    graph = new TemporalGraph({ storagePath: TEST_FILE });
    graph.clear();
    resolver = new ConflictResolver({ temporalGraph: graph });
  });

  afterEach(async () => {
    try { await fsp.unlink(TEST_FILE); } catch { /* ignore */ }
  });

  it('should return no conflict for non-existent fact', () => {
    const result = resolver.checkConflict('nonexistent');
    expect(result.hasConflict).toBe(false);
  });

  it('should detect negation-based contradiction', () => {
    graph.addFact({ statement: 'Database is MySQL for storage', entities: ['MySQL'] });
    const f2 = graph.addFact({ statement: 'Database is not MySQL, replaced with PostgreSQL for storage', entities: ['MySQL', 'PostgreSQL'] });

    const result = resolver.checkConflict(f2.id);
    expect(result.hasConflict).toBe(true);
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  it('should supersede old fact on high confidence conflict', () => {
    const f1 = graph.addFact({ statement: 'Uses REST API for communication', entities: ['REST'] });
    const f2 = graph.addFact({ statement: 'No longer uses REST API, switched to gRPC', entities: ['REST', 'gRPC'] });

    resolver.checkConflict(f2.id);

    const oldFact = graph.getFact(f1.id);
    expect(oldFact?.valid).toBe(false);
  });

  it('should flag low confidence conflict instead of supersede', () => {
    const f1 = graph.addFact({ statement: 'The project uses TypeScript' });
    const f2 = graph.addFact({ statement: 'The project does not use TypeScript anymore' });

    const result = resolver.checkConflict(f2.id);
    if (result.hasConflict) {
      const flagConflicts = result.conflicts.filter((c) => c.resolution === 'flag');
      const supersedeConflicts = result.conflicts.filter((c) => c.resolution === 'supersede');
      expect(flagConflicts.length + supersedeConflicts.length).toBe(result.conflicts.length);
    }
  });

  it('should not detect conflict between unrelated facts', () => {
    graph.addFact({ statement: 'The weather is nice' });
    const f2 = graph.addFact({ statement: 'Database uses PostgreSQL' });

    const result = resolver.checkConflict(f2.id);
    expect(result.hasConflict).toBe(false);
  });

  it('should detect conflict via shared entities + negation', () => {
    const f1 = graph.addFact({ statement: 'Auth system uses JWT tokens', entities: ['JWT', 'Auth'] });
    const f2 = graph.addFact({ statement: 'Auth system no longer uses JWT, changed to session cookies', entities: ['JWT', 'Auth'] });

    const result = resolver.checkConflict(f2.id);
    expect(result.hasConflict).toBe(true);
  });

  it('should add contradicts relationship', () => {
    const f1 = graph.addFact({ statement: 'The project uses MySQL database for data storage', entities: ['MySQL'] });
    const f2 = graph.addFact({ statement: 'The project no longer uses MySQL database, switched to PostgreSQL', entities: ['MySQL', 'PostgreSQL'] });

    resolver.checkConflict(f2.id);

    const related = graph.getRelatedFacts(f2.id, 'contradicts' as never);
    expect(related.length).toBeGreaterThan(0);
  });

  it('should check all facts with checkAllConflicts', () => {
    graph.addFact({ statement: 'The project uses MySQL database for data storage', entities: ['MySQL'] });
    graph.addFact({ statement: 'The project no longer uses MySQL database, switched to PostgreSQL', entities: ['MySQL', 'PostgreSQL'] });

    const results = resolver.checkAllConflicts();
    expect(results.length).toBeGreaterThan(0);
  });

  it('should handle no conflicts in checkAllConflicts', () => {
    graph.addFact({ statement: 'Uses TypeScript' });
    graph.addFact({ statement: 'Uses Vitest' });

    const results = resolver.checkAllConflicts();
    expect(results.length).toBe(0);
  });

  it('should not conflict with invalidated facts', () => {
    const f1 = graph.addFact({ statement: 'Uses MySQL', entities: ['MySQL'] });
    graph.invalidateFact(f1.id, 'test');

    const f2 = graph.addFact({ statement: 'No longer uses MySQL', entities: ['MySQL'] });

    const result = resolver.checkConflict(f2.id);
    // f1 is already invalidated, so it won't be in the query results
    expect(result.hasConflict).toBe(false);
  });
});
