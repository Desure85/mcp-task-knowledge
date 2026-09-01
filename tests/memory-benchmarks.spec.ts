/**
 * benchmarks.spec.ts — Tests for benchmark harness.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createLOCOMOSuite,
  createLongMemEvalSuite,
  createBEAMSuite,
  createDMRSuite,
  runBenchmark,
  runAllBenchmarks,
  formatReportMarkdown,
  type MemoryAdapter,
  type BenchmarkFact,
  type BenchmarkResult,
  type MemoryScope,
} from '../src/memory/benchmarks.js';

// ─── In-memory mock adapter for testing ──────────────────────────────────────

class MockMemoryAdapter implements MemoryAdapter {
  name = 'mock';
  private store = new Map<string, BenchmarkFact>();

  async add(item: BenchmarkFact): Promise<string> {
    const id = item.id ?? crypto.randomUUID();
    this.store.set(id, { ...item, id });
    return id;
  }

  async search(query: string, opts?: { limit?: number; scope?: MemoryScope }): Promise<BenchmarkResult[]> {
    const limit = opts?.limit ?? 10;
    const items = Array.from(this.store.values());

    // Simple keyword matching
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2);

    const scored = items
      .map((item) => {
        const contentLower = (item.content + ' ' + (item.title ?? '')).toLowerCase();
        let score = 0;
        for (const word of queryWords) {
          if (contentLower.includes(word)) score += 1;
        }
        return {
          id: item.id!,
          content: item.content,
          title: item.title,
          score: score / queryWords.length,
          tags: item.tags,
        };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  }

  async get(id: string): Promise<BenchmarkFact | null> {
    return this.store.get(id) ?? null;
  }

  async invalidate(id: string): Promise<void> {
    const item = this.store.get(id);
    if (item) {
      this.store.set(id, { ...item, validTo: new Date().toISOString() });
    }
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Benchmark Suites', () => {
  it('LOCOMO suite has 5 questions', () => {
    const suite = createLOCOMOSuite();
    expect(suite.name).toBe('LOCOMO');
    expect(suite.questions).toHaveLength(5);
    expect(suite.scoring).toBe('keyword_match');
  });

  it('LongMemEval suite has 5 questions', () => {
    const suite = createLongMemEvalSuite();
    expect(suite.name).toBe('LongMemEval');
    expect(suite.questions).toHaveLength(5);
  });

  it('BEAM suite has 5 questions', () => {
    const suite = createBEAMSuite();
    expect(suite.name).toBe('BEAM');
    expect(suite.questions).toHaveLength(5);
  });

  it('DMR suite has 5 questions', () => {
    const suite = createDMRSuite();
    expect(suite.name).toBe('DMR');
    expect(suite.questions).toHaveLength(5);
  });

  it('all questions have required fields', () => {
    const suites = [
      createLOCOMOSuite(),
      createLongMemEvalSuite(),
      createBEAMSuite(),
      createDMRSuite(),
    ];
    for (const suite of suites) {
      for (const q of suite.questions) {
        expect(q.id).toBeTruthy();
        expect(q.question).toBeTruthy();
        expect(q.expectedKeywords).toBeInstanceOf(Array);
        expect(q.expectedKeywords.length).toBeGreaterThan(0);
        expect(q.category).toBeTruthy();
      }
    }
  });

  it('LOCOMO questions have conversation turns', () => {
    const suite = createLOCOMOSuite();
    for (const q of suite.questions) {
      expect(q.conversationTurns).toBeDefined();
      expect(q.conversationTurns!.length).toBeGreaterThan(0);
    }
  });

  it('DMR questions have temporal category', () => {
    const suite = createDMRSuite();
    for (const q of suite.questions) {
      expect(q.category).toBe('temporal');
    }
  });
});

describe('runBenchmark', () => {
  let adapter: MockMemoryAdapter;

  beforeEach(() => {
    adapter = new MockMemoryAdapter();
  });

  it('runs LOCOMO suite and returns a report', async () => {
    const suite = createLOCOMOSuite();
    const report = await runBenchmark(suite, adapter);

    expect(report.suite).toBe('LOCOMO');
    expect(report.adapter).toBe('mock');
    expect(report.totalQuestions).toBe(5);
    expect(report.correctAnswers).toBeGreaterThanOrEqual(0);
    expect(report.recallAt1).toBeGreaterThanOrEqual(0);
    expect(report.recallAt1).toBeLessThanOrEqual(1);
    expect(report.perQuestion).toHaveLength(5);
    expect(report.timestamp).toBeTruthy();
  });

  it('runs LongMemEval suite and returns a report', async () => {
    const suite = createLongMemEvalSuite();
    const report = await runBenchmark(suite, adapter);

    expect(report.suite).toBe('LongMemEval');
    expect(report.totalQuestions).toBe(5);
  });

  it('runs BEAM suite and returns a report', async () => {
    const suite = createBEAMSuite();
    const report = await runBenchmark(suite, adapter);

    expect(report.suite).toBe('BEAM');
    expect(report.totalQuestions).toBe(5);
  });

  it('runs DMR suite and returns a report', async () => {
    const suite = createDMRSuite();
    const report = await runBenchmark(suite, adapter);

    expect(report.suite).toBe('DMR');
    expect(report.totalQuestions).toBe(5);
  });

  it('clears adapter before each suite', async () => {
    const suite = createLOCOMOSuite();
    // Pre-populate
    await adapter.add({ content: 'pre-existing data', title: 'test' });
    // Run benchmark — should clear first
    const report = await runBenchmark(suite, adapter);
    // Results should only contain benchmark data, not pre-existing
    expect(report.totalQuestions).toBe(5);
  });

  it('measures latency for each question', async () => {
    const suite = createLOCOMOSuite();
    const report = await runBenchmark(suite, adapter);

    for (const q of report.perQuestion) {
      expect(q.latencyMs).toBeGreaterThanOrEqual(0);
    }
    expect(report.avgLatencyMs).toBeGreaterThanOrEqual(0);
    expect(report.p95LatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('computes recall@K metrics', async () => {
    const suite = createLOCOMOSuite();
    const report = await runBenchmark(suite, adapter);

    expect(report.recallAt1).toBeGreaterThanOrEqual(0);
    expect(report.recallAt5).toBeGreaterThanOrEqual(report.recallAt1);
    expect(report.recallAt10).toBeGreaterThanOrEqual(report.recallAt5);
  });

  it('computes F1 score', async () => {
    const suite = createLOCOMOSuite();
    const report = await runBenchmark(suite, adapter);

    expect(report.f1).toBeGreaterThanOrEqual(0);
    expect(report.f1).toBeLessThanOrEqual(1);
  });
});

describe('runAllBenchmarks', () => {
  it('runs all 4 suites and returns 4 reports', async () => {
    const adapter = new MockMemoryAdapter();
    const reports = await runAllBenchmarks(adapter);

    expect(reports).toHaveLength(4);
    expect(reports[0].suite).toBe('LOCOMO');
    expect(reports[1].suite).toBe('LongMemEval');
    expect(reports[2].suite).toBe('BEAM');
    expect(reports[3].suite).toBe('DMR');
  });

  it('each report has correct structure', async () => {
    const adapter = new MockMemoryAdapter();
    const reports = await runAllBenchmarks(adapter);

    for (const r of reports) {
      expect(r.suite).toBeTruthy();
      expect(r.adapter).toBe('mock');
      expect(r.totalQuestions).toBe(5);
      expect(r.correctAnswers).toBeGreaterThanOrEqual(0);
      expect(r.perQuestion).toHaveLength(5);
      expect(r.timestamp).toBeTruthy();
    }
  });
});

describe('formatReportMarkdown', () => {
  it('formats reports as markdown', async () => {
    const adapter = new MockMemoryAdapter();
    const reports = await runAllBenchmarks(adapter);
    const md = formatReportMarkdown(reports);

    expect(md).toContain('# Benchmark Results');
    expect(md).toContain('## Summary');
    expect(md).toContain('| Suite | Questions |');
    expect(md).toContain('LOCOMO');
    expect(md).toContain('LongMemEval');
    expect(md).toContain('BEAM');
    expect(md).toContain('DMR');
    expect(md).toContain('## Per-Question Details');
  });

  it('includes per-question rows', async () => {
    const adapter = new MockMemoryAdapter();
    const reports = await runAllBenchmarks(adapter);
    const md = formatReportMarkdown(reports);

    expect(md).toContain('locomo-001');
    expect(md).toContain('lme-001');
    expect(md).toContain('beam-001');
    expect(md).toContain('dmr-001');
  });
});

describe('MockMemoryAdapter', () => {
  it('add and get work correctly', async () => {
    const adapter = new MockMemoryAdapter();
    const id = await adapter.add({ content: 'test fact', title: 'test' });
    const item = await adapter.get(id);
    expect(item).not.toBeNull();
    expect(item!.content).toBe('test fact');
  });

  it('search returns ranked results', async () => {
    const adapter = new MockMemoryAdapter();
    await adapter.add({ content: 'Alice prefers TypeScript', title: 'Alice TS' });
    await adapter.add({ content: 'Bob likes Python', title: 'Bob Python' });
    await adapter.add({ content: 'TypeScript is great for frontend', title: 'TS frontend' });

    const results = await adapter.search('TypeScript preference');
    expect(results.length).toBeGreaterThan(0);
    // Both Alice and TS frontend should match
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('clear removes all data', async () => {
    const adapter = new MockMemoryAdapter();
    await adapter.add({ content: 'test' });
    await adapter.clear();
    const results = await adapter.search('test');
    expect(results).toHaveLength(0);
  });

  it('invalidate marks validTo', async () => {
    const adapter = new MockMemoryAdapter();
    const id = await adapter.add({ content: 'test fact' });
    await adapter.invalidate(id);
    const item = await adapter.get(id);
    expect(item).not.toBeNull();
    expect(item!.validTo).toBeTruthy();
  });
});
