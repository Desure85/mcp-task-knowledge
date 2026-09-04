import { describe, it, expect, vi } from 'vitest';
import { registerMemoryTools } from '../src/register/memory.js';
import type { ServerContext } from '../src/register/context.js';
import type { ToolMetaHandler } from '../src/register/setup.js';

function createMockContext(): {
  ctx: ServerContext;
  getHandler: (name: string) => ToolMetaHandler | undefined;
} {
  const handlers = new Map<string, ToolMetaHandler>();

  const ctx: ServerContext = {
    server: {
      registerTool(name: string, _def: unknown, handler: unknown) {
        handlers.set(name, handler as ToolMetaHandler);
      },
    } as any,
    cfg: {} as any,
    catalogCfg: {} as any,
    catalogProvider: {} as any,
    vectorAdapter: undefined,
    vectorInitAttempted: false,
    ensureVectorAdapter: async () => undefined,
    toolRegistry: {
      has: () => false,
      set: vi.fn(),
    } as any,
    resourceRegistry: [],
    toolNames: new Set(),
    STRICT_TOOL_DEDUP: false,
    TOOLS_ENABLED: true,
    TOOL_RES_ENABLED: false,
    TOOL_RES_EXEC: false,
    REPO_ROOT: '/tmp',
    SERVER_CAPS: { resources: { list: true, read: true }, tools: { call: true } },
    normalizeBase64: (s: string) => s,
    makeResourceTemplate: (p: string) => p as any,
    registerToolAsResource: vi.fn(),
  };

  return {
    ctx,
    getHandler: (name: string) => handlers.get(name),
  };
}

function parseResponse(result: any): any {
  try {
    const text = result?.content?.[0]?.text;
    return typeof text === 'string' ? JSON.parse(text) : result;
  } catch {
    return result;
  }
}

function scoreShape(report: any): void {
  expect(report.suite).toEqual(expect.any(String));
  expect(report.totalQuestions).toEqual(expect.any(Number));
  expect(report.correctAnswers).toEqual(expect.any(Number));
  expect(report.recallAt1).toEqual(expect.any(Number));
  expect(report.recallAt5).toEqual(expect.any(Number));
  expect(report.recallAt10).toEqual(expect.any(Number));
  expect(report.precision).toEqual(expect.any(Number));
  expect(report.f1).toEqual(expect.any(Number));
  expect(report.avgLatencyMs).toEqual(expect.any(Number));
  expect(report.p95LatencyMs).toEqual(expect.any(Number));
}

describe('memory_benchmark_run tool (WIRE-007)', () => {
  it('is registered via defaultRegistration path', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);
    expect(getHandler('memory_benchmark_run')).toBeDefined();
  });

  it('runs a single-suite smoke subset and returns scores shape', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);

    const result = parseResponse(
      await getHandler('memory_benchmark_run')!({ suite: 'locomo', maxQuestions: 2 }),
    );
    expect(result.ok).toBe(true);
    expect(result.data.adapter).toBe('ephemeral-inmemory');
    expect(result.data.suites).toEqual(['LOCOMO']);
    expect(result.data.totalQuestions).toBe(2);
    expect(result.data.reports).toHaveLength(1);
    scoreShape(result.data.reports[0]);
    expect(result.data.reports[0].totalQuestions).toBe(2);
    // Summary mode omits per-question details for bounded payloads.
    expect(result.data.reports[0].perQuestion).toBeUndefined();
  });

  it('runs all suites by default via runAllBenchmarks()', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);

    const result = parseResponse(await getHandler('memory_benchmark_run')!({}));
    expect(result.ok).toBe(true);
    expect(result.data.suites).toEqual(['LOCOMO', 'LongMemEval', 'BEAM', 'DMR']);
    expect(result.data.totalQuestions).toBe(20);
    expect(result.data.reports).toHaveLength(4);
    for (const report of result.data.reports) scoreShape(report);
  });

  it('caps questions per suite for bounded runs', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);

    const result = parseResponse(
      await getHandler('memory_benchmark_run')!({ suite: 'all', maxQuestions: 1 }),
    );
    expect(result.ok).toBe(true);
    expect(result.data.totalQuestions).toBe(4);
    for (const report of result.data.reports) {
      expect(report.totalQuestions).toBe(1);
    }
  });

  it('returns per-question details only on explicit flag', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);

    const detailed = parseResponse(
      await getHandler('memory_benchmark_run')!({ suite: 'beam', maxQuestions: 1, includeDetails: true }),
    );
    expect(detailed.ok).toBe(true);
    expect(detailed.data.reports[0].perQuestion).toHaveLength(1);
    expect(detailed.data.reports[0].perQuestion[0].questionId).toBe('beam-001');
  });

  it('rejects unknown suite names', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);

    const result = parseResponse(
      await getHandler('memory_benchmark_run')!({ suite: 'glue-benchmark-v9' }),
    );
    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('unknown suite');
  });
});
