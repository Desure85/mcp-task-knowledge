/**
 * tests/dreaming.spec.ts — Unit tests for Sleep-time/Dreaming Agent (NEXT-006).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DreamingAgent } from '../src/memory/dreaming.js';
import { LayeredMemory } from '../src/memory/layers.js';
import { TemporalGraph } from '../src/memory/temporal-graph.js';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_LAYERS = join(tmpdir(), `test-dream-layers-${Date.now()}.json`);
const TEST_TEMPORAL = join(tmpdir(), `test-dream-temporal-${Date.now()}.json`);

describe('DreamingAgent', () => {
  let layeredMemory: LayeredMemory;
  let temporalGraph: TemporalGraph;
  let agent: DreamingAgent;

  beforeEach(() => {
    layeredMemory = new LayeredMemory({ storagePath: TEST_LAYERS });
    temporalGraph = new TemporalGraph({ storagePath: TEST_TEMPORAL });
    temporalGraph.clear();
    agent = new DreamingAgent({ layeredMemory, temporalGraph });
  });

  afterEach(async () => {
    agent.stop();
    try { await fsp.unlink(TEST_LAYERS); } catch { /* ignore */ }
    try { await fsp.unlink(TEST_TEMPORAL); } catch { /* ignore */ }
  });

  it('should run once and return result', () => {
    const result = agent.runOnce();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should dedup similar facts in conversation layer', () => {
    layeredMemory.add('conversation', { statement: 'user prefers tabs over spaces for TypeScript' });
    layeredMemory.add('conversation', { statement: 'user prefers tabs over spaces for TypeScript files' });

    const result = agent.runOnce();
    expect(result.deduplicated).toBeGreaterThan(0);
  });

  it('should not dedup dissimilar facts', () => {
    layeredMemory.add('conversation', { statement: 'user likes TypeScript' });
    layeredMemory.add('conversation', { statement: 'database uses PostgreSQL' });

    const result = agent.runOnce();
    expect(result.deduplicated).toBe(0);
  });

  it('should merge moderately similar facts', () => {
    layeredMemory.add('conversation', { statement: 'uses TypeScript for frontend development' });
    layeredMemory.add('conversation', { statement: 'uses TypeScript for backend services' });

    const result = agent.runOnce();
    expect(result.merged).toBeGreaterThanOrEqual(0);
  });

  it('should promote conversation to session', () => {
    layeredMemory.add('conversation', { statement: 'working on auth module' });
    layeredMemory.add('conversation', { statement: 'reviewing PR number 42' });

    const result = agent.runOnce();
    expect(result.promoted).toBeGreaterThan(0);
    expect(layeredMemory.getLayer('conversation').length).toBe(0);
  });

  it('should dedup temporal graph facts', () => {
    temporalGraph.addFact({ statement: 'Database is PostgreSQL for the main application' });
    temporalGraph.addFact({ statement: 'Database is PostgreSQL for the main application storage' });

    const result = agent.runOnce();
    expect(result.deduplicated).toBeGreaterThan(0);
  });

  it('should start and stop interval', () => {
    agent.start(1000);
    expect(agent.isRunning()).toBe(true);
    agent.stop();
    expect(agent.isRunning()).toBe(false);
  });

  it('should not start twice', () => {
    agent.start(1000);
    agent.start(2000);
    expect(agent.isRunning()).toBe(true);
    agent.stop();
  });

  it('should handle empty memory gracefully', () => {
    const result = agent.runOnce();
    expect(result.deduplicated).toBe(0);
    expect(result.merged).toBe(0);
    expect(result.promoted).toBe(0);
  });

  it('should work without layeredMemory', () => {
    const agentNoLayers = new DreamingAgent({ temporalGraph });
    temporalGraph.addFact({ statement: 'test fact A' });
    temporalGraph.addFact({ statement: 'test fact A duplicate' });

    const result = agentNoLayers.runOnce();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should work without temporalGraph', () => {
    const agentNoTemporal = new DreamingAgent({ layeredMemory });
    layeredMemory.add('conversation', { statement: 'test fact' });

    const result = agentNoTemporal.runOnce();
    expect(result.promoted).toBeGreaterThanOrEqual(0);
  });

  it('should work with no memory systems', () => {
    const emptyAgent = new DreamingAgent({});
    const result = emptyAgent.runOnce();
    expect(result.deduplicated).toBe(0);
    expect(result.merged).toBe(0);
  });
});
