/**
 * tests/observations.spec.ts — Unit tests for Observations/Pattern Detection (NEXT-018).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObservationEngine } from '../src/memory/observations.js';
import { TemporalGraph } from '../src/memory/temporal-graph.js';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_FILE = join(tmpdir(), `test-observations-${Date.now()}.json`);

describe('ObservationEngine', () => {
  let graph: TemporalGraph;
  let engine: ObservationEngine;

  beforeEach(() => {
    graph = new TemporalGraph({ storagePath: TEST_FILE });
    graph.clear();
    engine = new ObservationEngine({ temporalGraph: graph });
  });

  afterEach(async () => {
    try { await fsp.unlink(TEST_FILE); } catch { /* ignore */ }
  });

  it('should return empty for empty graph', () => {
    const observations = engine.detect();
    expect(observations.length).toBe(0);
  });

  it('should detect entity recurrence', () => {
    for (let i = 0; i < 5; i++) {
      graph.addFact({ statement: `Fact ${i} about TypeScript`, entities: ['TypeScript'] });
    }
    const observations = engine.detect();
    const recurrences = observations.filter((o) => o.type === 'recurrence');
    expect(recurrences.length).toBeGreaterThan(0);
    expect(recurrences[0].entities).toContain('TypeScript');
    expect(recurrences[0].count).toBe(5);
  });

  it('should not detect recurrence below threshold', () => {
    graph.addFact({ statement: 'Fact about TypeScript', entities: ['TypeScript'] });
    graph.addFact({ statement: 'Another fact about TypeScript', entities: ['TypeScript'] });
    const observations = engine.detect();
    const recurrences = observations.filter((o) => o.type === 'recurrence');
    expect(recurrences.length).toBe(0);
  });

  it('should detect co-occurrence', () => {
    graph.addFact({ statement: 'TypeScript with PostgreSQL', entities: ['TypeScript', 'PostgreSQL'] });
    graph.addFact({ statement: 'TypeScript and PostgreSQL again', entities: ['TypeScript', 'PostgreSQL'] });
    graph.addFact({ statement: 'TypeScript and PostgreSQL third time', entities: ['TypeScript', 'PostgreSQL'] });

    const observations = engine.detect();
    const coOcc = observations.filter((o) => o.type === 'co_occurrence');
    expect(coOcc.length).toBeGreaterThan(0);
  });

  it('should detect temporal clusters', () => {
    const base = '2026-01-01T00:00:00Z';
    for (let i = 0; i < 5; i++) {
      const date = new Date(new Date(base).getTime() + i * 86400000).toISOString();
      graph.addFact({ statement: `Fact ${i}`, validFrom: date });
    }
    const observations = engine.detect();
    const clusters = observations.filter((o) => o.type === 'temporal_cluster');
    expect(clusters.length).toBeGreaterThan(0);
  });

  it('should detect category trends', () => {
    for (let i = 0; i < 5; i++) {
      graph.addFact({ statement: `Decision ${i}`, category: 'decision' });
    }
    const observations = engine.detect();
    const trends = observations.filter((o) => o.type === 'category_trend');
    expect(trends.length).toBeGreaterThan(0);
    expect(trends[0].category).toBe('decision');
  });

  it('should include evidence in observations', () => {
    for (let i = 0; i < 4; i++) {
      graph.addFact({ statement: `Fact ${i} about TypeScript`, entities: ['TypeScript'] });
    }
    const observations = engine.detect();
    expect(observations[0].evidence.length).toBeGreaterThan(0);
  });

  it('should set confidence between 0 and 1', () => {
    for (let i = 0; i < 10; i++) {
      graph.addFact({ statement: `Fact ${i} about TypeScript`, entities: ['TypeScript'] });
    }
    const observations = engine.detect();
    for (const obs of observations) {
      expect(obs.confidence).toBeGreaterThanOrEqual(0);
      expect(obs.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('should set detectedAt timestamp', () => {
    graph.addFact({ statement: 'test', entities: ['TypeScript'] });
    graph.addFact({ statement: 'test2', entities: ['TypeScript'] });
    graph.addFact({ statement: 'test3', entities: ['TypeScript'] });
    const observations = engine.detect();
    expect(observations[0].detectedAt).toBeDefined();
  });

  it('should support custom thresholds', () => {
    const customEngine = new ObservationEngine({
      temporalGraph: graph,
      minRecurrence: 2,
    });
    graph.addFact({ statement: 'A about TypeScript', entities: ['TypeScript'] });
    graph.addFact({ statement: 'B about TypeScript', entities: ['TypeScript'] });
    const observations = customEngine.detect();
    expect(observations.length).toBeGreaterThan(0);
  });
});
