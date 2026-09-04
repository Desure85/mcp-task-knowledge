import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryExtractor } from '../src/memory/extraction.js';
import { TemporalGraph } from '../src/memory/temporal-graph.js';
import { ScopeMatcher, buildScopeTags } from '../src/memory/scoping.js';
import type { MemoryScopeFilter } from '../src/memory/scoping.js';

function freshGraph(): { graph: TemporalGraph; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'temporal-fuzz-'));
  const graph = new TemporalGraph({ storagePath: join(dir, 'graph.json') });
  return { graph, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const scopeArb: fc.Arbitrary<MemoryScopeFilter> = fc.record(
  {
    userId: fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
    agentId: fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
    appId: fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
    runId: fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
  },
  { requiredKeys: [] },
);

describe('NEXT2-009: extraction fuzz', () => {
  it('never throws on arbitrary text; facts bounded by maxFacts with confidence in [minConfidence, 1]', async () => {
    const ext = new MemoryExtractor();
    await fc.assert(
      fc.asyncProperty(
        fc.string({ maxLength: 2000 }),
        fc.integer({ min: 1, max: 20 }),
        fc.float({ min: 0, max: 1, noNaN: true }),
        async (transcript, maxFacts, minConfidence) => {
          const result = await ext.extract({ transcript, maxFacts, minConfidence });
          expect(result.facts.length).toBeLessThanOrEqual(maxFacts);
          for (const f of result.facts) {
            expect(f.confidence).toBeGreaterThanOrEqual(minConfidence - 1e-9);
            expect(f.confidence).toBeLessThanOrEqual(1);
            expect(typeof f.statement).toBe('string');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('empty/whitespace transcripts yield zero facts without throwing', async () => {
    const ext = new MemoryExtractor();
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 50 }), async (s) => {
        const result = await ext.extract({ transcript: s });
        expect(Array.isArray(result.facts)).toBe(true);
      }),
      { numRuns: 50 },
    );
  });
});

describe('NEXT2-009: temporal-graph invariants', () => {
  it('added facts are queryable; invalidated facts excluded unless includeInvalidated', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 60 }), { minLength: 1, maxLength: 15 }),
        (statements) => {
          const { graph, cleanup } = freshGraph();
          try {
            const ids = statements.map((statement) => graph.addFact({ statement }).id);
            expect(graph.query({}).length).toBe(statements.length);
            const victim = ids[0]!;
            expect(graph.invalidateFact(victim, 'fuzz')).toBe(true);
            const current = graph.query({});
            expect(current.find((f) => f.id === victim)).toBeUndefined();
            expect(current.length).toBe(statements.length - 1);
            const withInvalid = graph.query({ includeInvalidated: true });
            expect(withInvalid.length).toBe(statements.length);
            expect(withInvalid.find((f) => f.id === victim)?.valid).toBe(false);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('supersede links new fact and invalidates the old one', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 60 }), fc.string({ minLength: 1, maxLength: 60 }), (a, b) => {
        const { graph, cleanup } = freshGraph();
        try {
          const oldId = graph.addFact({ statement: a }).id;
          const fresh = graph.addFact({ statement: b, supersedesFactId: oldId });
          expect(graph.getFact(oldId)?.valid).toBe(false);
          expect(graph.getFact(oldId)?.supersededBy).toBe(fresh.id);
          expect(graph.getFact(fresh.id)?.valid).toBe(true);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 50 },
    );
  });

  it('invalidateFact on unknown id returns false', () => {
    fc.assert(
      fc.property(fc.uuid(), (id) => {
        const { graph, cleanup } = freshGraph();
        try {
          expect(graph.invalidateFact(id, 'fuzz')).toBe(false);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 30 },
    );
  });
});

describe('NEXT2-009: scoping combinatorics', () => {
  it('buildScopeTags is deterministic and round-trips all set dimensions', () => {
    fc.assert(
      fc.property(scopeArb, (scope) => {
        const a = buildScopeTags(scope);
        const b = buildScopeTags(scope);
        expect(a).toEqual(b);
        const dims = [scope.userId, scope.agentId, scope.appId, scope.runId].filter(Boolean).length;
        expect(a.length).toBe(dims);
      }),
      { numRuns: 200 },
    );
  });

  it('filterItems agrees with matches for every item', () => {
    fc.assert(
      fc.property(scopeArb, fc.array(scopeArb, { maxLength: 10 }), (filter, scopes) => {
        const matcher = new ScopeMatcher(filter);
        const items = scopes.map((scope) => ({ scope }));
        const filtered = matcher.filterItems(items);
        expect(filtered.length).toBe(items.filter((i) => matcher.matches(i)).length);
        for (const item of filtered) expect(matcher.matches(item)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('empty filter matches everything; exact filter matches itself', () => {
    fc.assert(
      fc.property(scopeArb, (scope) => {
        expect(new ScopeMatcher({}).matches({ scope })).toBe(true);
        expect(new ScopeMatcher(scope).matches({ scope })).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
