/**
 * tests/entity-retrieval.spec.ts — Unit tests for Entity-linking Retrieval (NEXT-008).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EntityRetriever } from '../src/memory/entity-retrieval.js';
import { TemporalGraph } from '../src/memory/temporal-graph.js';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_FILE = join(tmpdir(), `test-entity-ret-${Date.now()}.json`);

describe('EntityRetriever', () => {
  let retriever: EntityRetriever;
  let temporalGraph: TemporalGraph;

  beforeEach(() => {
    temporalGraph = new TemporalGraph({ storagePath: TEST_FILE });
    temporalGraph.clear();
    retriever = new EntityRetriever({ temporalGraph });
  });

  afterEach(async () => {
    try { await fsp.unlink(TEST_FILE); } catch { /* ignore */ }
  });

  it('should return empty for query with no entities', () => {
    const results = retriever.retrieve('the weather is nice', 10);
    expect(results.length).toBe(0);
  });

  it('should match facts by entity', () => {
    temporalGraph.addFact({
      statement: 'Auth uses JWT tokens',
      entities: ['JWT', 'Auth'],
    });
    temporalGraph.addFact({
      statement: 'Database is PostgreSQL',
      entities: ['PostgreSQL'],
    });

    const results = retriever.retrieve('JWT auth', 10);
    expect(results.length).toBe(1);
    expect(results[0].matchedEntities).toContain('JWT');
  });

  it('should match multiple entities', () => {
    temporalGraph.addFact({
      statement: 'TypeScript project uses PostgreSQL',
      entities: ['TypeScript', 'PostgreSQL'],
    });

    const results = retriever.retrieve('TypeScript PostgreSQL', 10);
    expect(results.length).toBe(1);
    expect(results[0].matchedEntities.length).toBe(2);
  });

  it('should score by entity match ratio', () => {
    temporalGraph.addFact({
      statement: 'Fact with one entity',
      entities: ['TypeScript'],
    });
    temporalGraph.addFact({
      statement: 'Fact with both entities',
      entities: ['TypeScript', 'PostgreSQL'],
    });

    const results = retriever.retrieve('TypeScript PostgreSQL', 10);
    expect(results[0].matchedEntities.length).toBe(2);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('should extract CamelCase entities from query', () => {
    temporalGraph.addFact({
      statement: 'Uses TypeScript',
      entities: ['TypeScript'],
    });

    const results = retriever.retrieve('camelCase TypeScript', 10);
    expect(results.length).toBe(1);
  });

  it('should extract snake_case entities from query', () => {
    temporalGraph.addFact({
      statement: 'Uses snake_case',
      entities: ['snake_case'],
    });

    const results = retriever.retrieve('snake_case', 10);
    expect(results.length).toBe(1);
  });

  it('should respect limit', () => {
    for (let i = 0; i < 10; i++) {
      temporalGraph.addFact({
        statement: `Fact ${i} with TypeScript`,
        entities: ['TypeScript'],
      });
    }

    const results = retriever.retrieve('TypeScript', 3);
    expect(results.length).toBe(3);
  });

  it('should sort by score descending', () => {
    temporalGraph.addFact({ statement: 'A', entities: ['TypeScript'] });
    temporalGraph.addFact({ statement: 'B', entities: ['TypeScript', 'PostgreSQL'] });

    const results = retriever.retrieve('TypeScript PostgreSQL', 10);
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
  });

  it('should work without temporal graph', () => {
    const r = new EntityRetriever({});
    const results = r.retrieve('TypeScript', 10);
    expect(results.length).toBe(0);
  });

  it('should work with knowledge items', () => {
    const r = new EntityRetriever({
      knowledgeItems: [
        { id: '1', title: 'TypeScript guide', content: 'TS content', entities: ['TypeScript'] },
        { id: '2', title: 'Python guide', content: 'Py content', entities: ['Python'] },
      ],
    });

    const results = r.retrieve('TypeScript', 10);
    expect(results.length).toBe(1);
    expect(results[0].title).toContain('TypeScript');
  });

  it('should extract entities from title+content if no entities field', () => {
    const r = new EntityRetriever({
      knowledgeItems: [
        { id: '1', title: 'TypeScript guide', content: 'About JWT auth' },
      ],
    });

    const results = r.retrieve('TypeScript', 10);
    expect(results.length).toBe(1);
  });

  it('should be case-insensitive on entity matching', () => {
    temporalGraph.addFact({
      statement: 'Uses TypeScript',
      entities: ['TypeScript'],
    });

    const results = retriever.retrieve('typescript', 10);
    expect(results.length).toBe(0);
  });

  it('should extract quoted entities', () => {
    temporalGraph.addFact({
      statement: 'Uses "special thing"',
      entities: ['special thing'],
    });

    const results = retriever.retrieve('"special thing"', 10);
    expect(results.length).toBe(1);
  });
});
