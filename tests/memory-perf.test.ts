/**
 * tests/memory-perf.test.ts — Perf benchmarks for memory tools (NEXT2-010)
 *
 * NOT a CI gate: generous bounds only guard against pathological blowups.
 * Real targets (<50ms retrieval, <200ms extraction) are reported to stdout
 * for tracking; assertions use loose CI-safe limits.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryExtractor } from '../src/memory/extraction.js';
import { TemporalGraph } from '../src/memory/temporal-graph.js';
import { EntityRetriever } from '../src/memory/entity-retrieval.js';

function makeTranscript(sentences: number): string {
  const templates = [
    'User decided to use Postgres for session store number SEP because JSONB indexing works well.',
    'I prefer dark mode and tabs over spaces for Python files in project SEP.',
    'We fixed the login bug by rotating the expired refresh token secret SEP.',
    'The team agreed to deploy on Fridays only after the staging gate SEP passes.',
    'Alice chose Redis cache with a sixty second TTL for endpoint SEP.',
  ];
  const parts: string[] = [];
  for (let i = 0; i < sentences; i++) {
    parts.push(templates[i % templates.length]!.replaceAll('SEP', String(i)));
  }
  return parts.join(' ');
}

describe('NEXT2-010: memory tools perf (benchmark, loose bounds)', () => {
  it('extraction on 100-sentence transcript completes < 2000ms', async () => {
    const ext = new MemoryExtractor();
    const transcript = makeTranscript(100);
    const start = Date.now();
    const result = await ext.extract({ transcript, maxFacts: 20 });
    const elapsed = Date.now() - start;
    console.log(`extract/100-sentences: ${elapsed}ms, facts=${result.facts.length}`);
    expect(result.facts.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2000);
  }, 30000);

  it('entity retrieval over 500 items completes < 500ms', () => {
    const items = Array.from({ length: 500 }, (_, i) => ({
      id: `item-${i}`,
      title: `Doc ${i} about DataPipeline and storage_layer`,
      content: `Content for document ${i} referencing DataPipeline, storage_layer and "quoted concept ${i % 25}".`,
      tags: [`batch:${i % 10}`],
    }));
    const retriever = new EntityRetriever({ knowledgeItems: items });
    const start = Date.now();
    const matches = retriever.retrieve('How does DataPipeline use storage_layer?', 10);
    const elapsed = Date.now() - start;
    console.log(`entity-retrieve/500-items: ${elapsed}ms, matches=${matches.length}`);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.length).toBeLessThanOrEqual(10);
    expect(elapsed).toBeLessThan(500);
  });

  it('temporal add x200 + query completes < 30000ms (file write per add — throughput benchmark, not gate)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'temporal-perf-'));
    try {
      const graph = new TemporalGraph({ storagePath: join(dir, 'graph.json') });
      const start = Date.now();
      for (let i = 0; i < 200; i++) {
        graph.addFact({ statement: `Perf fact ${i} about cache invalidation`, category: 'convention' });
      }
      const facts = graph.query({ limit: 50 });
      const elapsed = Date.now() - start;
      console.log(`temporal-add200+query: ${elapsed}ms, queried=${facts.length}`);
      expect(facts.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(30000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
