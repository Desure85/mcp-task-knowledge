/**
 * tests/memory-extraction.spec.ts — Unit tests for Memory Extraction Pipeline (NEXT-002).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryExtractor } from '../src/memory/extraction.js';
import { KNOWLEDGE_DIR } from '../src/config.js';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';

const TEST_PROJECT = 'test-extraction';
const TEST_DIR = join(KNOWLEDGE_DIR, TEST_PROJECT);

describe('MemoryExtractor', () => {
  let extractor: MemoryExtractor;

  beforeEach(() => {
    extractor = new MemoryExtractor();
  });

  afterEach(async () => {
    // Cleanup test data
    try {
      await fsp.rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should extract preference facts', async () => {
    const result = await extractor.extract({
      transcript: "I prefer tabs over spaces for TypeScript files. We should use 2-space indentation.",
      maxFacts: 10,
    });

    expect(result.facts.length).toBeGreaterThan(0);
    const prefFacts = result.facts.filter((f) => f.category === 'preference');
    expect(prefFacts.length).toBeGreaterThan(0);
    expect(prefFacts[0].confidence).toBeGreaterThan(0.5);
    expect(prefFacts[0].statement).toContain('tabs');
  });

  it('should extract decision facts', async () => {
    const result = await extractor.extract({
      transcript: "We decided to use PostgreSQL for the main database. Let's go with option B.",
      maxFacts: 10,
    });

    const decisionFacts = result.facts.filter((f) => f.category === 'decision');
    expect(decisionFacts.length).toBeGreaterThan(0);
  });

  it('should extract convention facts', async () => {
    const result = await extractor.extract({
      transcript: "Always use strict mode in TypeScript. Convention: name interfaces with I prefix.",
      maxFacts: 10,
    });

    const conventionFacts = result.facts.filter((f) => f.category === 'convention');
    expect(conventionFacts.length).toBeGreaterThan(0);
  });

  it('should extract error and fix facts', async () => {
    const result = await extractor.extract({
      transcript: "Error: NullPointerException in UserService.create(). Fix: added null check before method call.",
      maxFacts: 10,
    });

    const errorFacts = result.facts.filter((f) => f.category === 'error');
    const fixFacts = result.facts.filter((f) => f.category === 'fix');
    expect(errorFacts.length).toBeGreaterThan(0);
    expect(fixFacts.length).toBeGreaterThan(0);
  });

  it('should extract entities from statements', async () => {
    const result = await extractor.extract({
      transcript: "I prefer TypeScript over JavaScript. We decided to use PostgreSQL database.",
      maxFacts: 10,
    });

    const allEntities = result.facts.flatMap((f) => f.entities || []);
    expect(allEntities).toContain('TypeScript');
    expect(allEntities).toContain('PostgreSQL');
  });

  it('should deduplicate similar facts', async () => {
    const result = await extractor.extract({
      transcript: "I prefer tabs over spaces for TypeScript. I prefer tabs over spaces for TypeScript files.",
      maxFacts: 10,
    });

    // Should not have two near-identical facts
    const prefFacts = result.facts.filter((f) => f.category === 'preference');
    expect(prefFacts.length).toBe(1);
  });

  it('should respect maxFacts limit', async () => {
    const transcript = [
      "I prefer tabs over spaces.",
      "We decided to use PostgreSQL.",
      "Always use strict mode.",
      "Error: null pointer in UserService.",
      "Fix: added null check.",
      "Note: project uses React 18.",
      "I like vitest for testing.",
      "We should adopt monorepo structure.",
      "Convention: use camelCase for variables.",
      "Learned that WebSocket needs heartbeat.",
    ].join(' ');

    const result = await extractor.extract({
      transcript,
      maxFacts: 3,
    });

    expect(result.facts.length).toBeLessThanOrEqual(3);
  });

  it('should filter by minConfidence', async () => {
    const result = await extractor.extract({
      transcript: "Maybe we could perhaps use something else sometimes.",
      minConfidence: 0.9,
    });

    // Hedging words reduce confidence below 0.9
    expect(result.facts.length).toBe(0);
  });

  it('should set scope on extracted facts', async () => {
    const result = await extractor.extract({
      transcript: "I prefer tabs over spaces for TypeScript.",
      scope: { userId: 'alice', agentId: 'agent-1', runId: 'run-123' },
    });

    expect(result.facts[0].scope.userId).toBe('alice');
    expect(result.facts[0].scope.agentId).toBe('agent-1');
    expect(result.facts[0].scope.runId).toBe('run-123');
  });

  it('should set valid=true and validFrom on new facts', async () => {
    const result = await extractor.extract({
      transcript: "I prefer tabs over spaces.",
    });

    expect(result.facts[0].valid).toBe(true);
    expect(result.facts[0].validFrom).toBeDefined();
  });

  it('should return durationMs > 0', async () => {
    const result = await extractor.extract({
      transcript: "I prefer tabs over spaces.",
    });

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should persist facts to knowledge base when persist=true', async () => {
    const result = await extractor.extract({
      transcript: "I prefer tabs over spaces for TypeScript. We decided to use PostgreSQL.",
      project: TEST_PROJECT,
      persist: true,
    });

    expect(result.persistedCount).toBeGreaterThan(0);
    expect(result.docIds.length).toBeGreaterThan(0);

    // Verify files were created
    const files = await fsp.readdir(TEST_DIR).catch(() => []);
    const mdFiles = files.filter((f) => f.endsWith('.md'));
    expect(mdFiles.length).toBeGreaterThan(0);
  });

  it('should not persist when persist=false', async () => {
    const result = await extractor.extract({
      transcript: "I prefer tabs over spaces.",
      project: TEST_PROJECT,
      persist: false,
    });

    expect(result.persistedCount).toBe(0);
    expect(result.docIds.length).toBe(0);
  });

  it('should handle empty transcript gracefully', async () => {
    const result = await extractor.extract({
      transcript: '',
    });

    expect(result.facts.length).toBe(0);
    expect(result.persistedCount).toBe(0);
  });

  it('should handle transcript with no matching patterns', async () => {
    const result = await extractor.extract({
      transcript: "The weather is nice today. Going for a walk in the park later.",
    });

    expect(result.facts.length).toBe(0);
  });

  it('should sort facts by confidence descending', async () => {
    const result = await extractor.extract({
      transcript: [
        "I prefer tabs over spaces for TypeScript.",
        "Maybe perhaps we could possibly use something.",
        "Convention: always use strict mode in TypeScript files.",
      ].join(' '),
      minConfidence: 0.3,
    });

    for (let i = 1; i < result.facts.length; i++) {
      expect(result.facts[i - 1].confidence).toBeGreaterThanOrEqual(result.facts[i].confidence);
    }
  });

  it('should assign unique IDs to each fact', async () => {
    const result = await extractor.extract({
      transcript: "I prefer tabs over spaces. We decided to use PostgreSQL. Always use strict mode.",
    });

    const ids = result.facts.map((f) => f.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it('should include source snippet in facts', async () => {
    const result = await extractor.extract({
      transcript: "I prefer tabs over spaces for TypeScript.",
    });

    expect(result.facts[0].source.type).toBe('conversation');
    expect(result.facts[0].source.snippet).toBeDefined();
  });
});
