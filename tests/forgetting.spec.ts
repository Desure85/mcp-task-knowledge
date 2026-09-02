/**
 * tests/forgetting.spec.ts — Unit tests for Automatic Forgetting (NEXT-005).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ForgettingManager } from '../src/memory/forgetting.js';
import { TemporalGraph } from '../src/memory/temporal-graph.js';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_FILE = join(tmpdir(), `test-forgetting-${Date.now()}.json`);

describe('ForgettingManager', () => {
  let graph: TemporalGraph;
  let mgr: ForgettingManager;

  beforeEach(() => {
    graph = new TemporalGraph({ storagePath: TEST_FILE });
    graph.clear();
    mgr = new ForgettingManager({ temporalGraph: graph });
  });

  afterEach(async () => {
    try { await fsp.unlink(TEST_FILE); } catch { /* ignore */ }
  });

  it('should not expire permanent categories (preference)', () => {
    graph.addFact({ statement: 'Prefers tabs over spaces', category: 'preference', validFrom: '2020-01-01T00:00:00Z' });
    const result = mgr.runGC();
    expect(result.expired).toBe(0);
  });

  it('should not expire permanent categories (decision)', () => {
    graph.addFact({ statement: 'Decided to use PostgreSQL', category: 'decision', validFrom: '2020-01-01T00:00:00Z' });
    const result = mgr.runGC();
    expect(result.expired).toBe(0);
  });

  it('should expire context facts past TTL (30 days)', () => {
    const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
    graph.addFact({ statement: 'Currently working on auth module', category: 'context', validFrom: oldDate });
    const result = mgr.runGC();
    expect(result.expired).toBe(1);
  });

  it('should not expire context facts within TTL', () => {
    const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    graph.addFact({ statement: 'Currently working on auth', category: 'context', validFrom: recentDate });
    const result = mgr.runGC();
    expect(result.expired).toBe(0);
  });

  it('should prune noise (low confidence, no entities, no relationships)', () => {
    graph.addFact({ statement: 'Some random low quality fact', category: 'fact', confidence: 0.1, entities: [] });
    const result = mgr.runGC();
    expect(result.pruned).toBe(1);
  });

  it('should not prune facts with entities', () => {
    graph.addFact({ statement: 'Low confidence but has entity', category: 'fact', confidence: 0.1, entities: ['TypeScript'] });
    const result = mgr.runGC();
    expect(result.pruned).toBe(0);
  });

  it('should not prune facts with high confidence', () => {
    graph.addFact({ statement: 'High confidence fact', category: 'fact', confidence: 0.9, entities: [] });
    const result = mgr.runGC();
    expect(result.pruned).toBe(0);
  });

  it('should identify invalidated facts past retention for deletion', () => {
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const fact = graph.addFact({ statement: 'Old fact', category: 'context', validFrom: oldDate });
    graph.invalidateFact(fact.id, 'test');
    const stored = graph.getFact(fact.id);
    if (stored) {
      stored.validTo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
    }

    const result = mgr.runGC();
    expect(result.deleted).toBe(1);
  });

  it('should not delete recently invalidated facts', () => {
    const fact = graph.addFact({ statement: 'Recently invalidated', category: 'context' });
    graph.invalidateFact(fact.id, 'test');

    const result = mgr.runGC();
    expect(result.deleted).toBe(0);
  });

  it('should return details for each action', () => {
    const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
    graph.addFact({ statement: 'Old context', category: 'context', validFrom: oldDate });
    graph.addFact({ statement: 'Noise', category: 'fact', confidence: 0.1, entities: [] });

    const result = mgr.runGC();
    expect(result.details.length).toBe(2);
    expect(result.details.some((d) => d.action === 'expired')).toBe(true);
    expect(result.details.some((d) => d.action === 'pruned')).toBe(true);
  });

  it('should support custom policies', () => {
    const customMgr = new ForgettingManager({
      temporalGraph: graph,
      policies: [
        { category: 'preference', ttlDays: 1 },
        { category: 'fact', ttlDays: null },
      ],
    });

    const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    graph.addFact({ statement: 'Old preference', category: 'preference', validFrom: oldDate });
    graph.addFact({ statement: 'Old fact', category: 'fact', validFrom: oldDate });

    const result = customMgr.runGC();
    expect(result.expired).toBe(1);
  });

  it('should handle empty graph', () => {
    const result = mgr.runGC();
    expect(result.expired).toBe(0);
    expect(result.pruned).toBe(0);
    expect(result.deleted).toBe(0);
  });

  it('should get and set policies', () => {
    expect(mgr.getPolicy('preference')).toBeNull();
    expect(mgr.getPolicy('context')).toBe(30);
    mgr.setPolicy('custom', 60);
    expect(mgr.getPolicy('custom')).toBe(60);
  });
});
