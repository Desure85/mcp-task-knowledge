import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerMemoryTools } from '../src/register/memory.js';
import { resetAsyncJobManager, getAsyncJobManager } from '../src/memory/async-ops.js';
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
    } as unknown as ServerContext['server'],
    cfg: {} as ServerContext['cfg'],
    catalogCfg: {} as ServerContext['catalogCfg'],
    catalogProvider: {} as ServerContext['catalogProvider'],
    vectorAdapter: undefined,
    vectorInitAttempted: false,
    ensureVectorAdapter: async () => undefined,
    toolRegistry: {
      has: () => false,
      set: vi.fn(),
    } as unknown as ServerContext['toolRegistry'],
    resourceRegistry: [],
    toolNames: new Set(),
    STRICT_TOOL_DEDUP: false,
    TOOLS_ENABLED: true,
    TOOL_RES_ENABLED: false,
    TOOL_RES_EXEC: false,
    REPO_ROOT: '/tmp',
    SERVER_CAPS: { resources: { list: true, read: true }, tools: { call: true } },
    normalizeBase64: (s: string) => s,
    makeResourceTemplate: (p: string) => p as never,
    registerToolAsResource: vi.fn(),
  };

  return {
    ctx,
    getHandler: (name: string) => handlers.get(name),
  };
}

function parseResponse(result: unknown): {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { message: string };
} {
  const text = (result as { content?: Array<{ text?: string }> })?.content?.[0]?.text;
  if (typeof text === 'string') {
    return JSON.parse(text) as { ok: boolean; data?: Record<string, unknown>; error?: { message: string } };
  }
  return result as { ok: boolean };
}

const TRANSCRIPT =
  'User decided to use Postgres for the session store because it supports JSONB well. ' +
  'I prefer dark mode in the editor and tabs over spaces for Python files. ' +
  'We fixed the login bug by rotating the expired refresh token secret. ' +
  'The team agreed to deploy on Fridays only after the staging gate passes.';

describe('memory_async_* tools (WIRE-008)', () => {
  beforeEach(() => {
    resetAsyncJobManager();
  });

  it('registers submit/status/cancel tools', () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);
    expect(getHandler('memory_async_submit')).toBeDefined();
    expect(getHandler('memory_async_status')).toBeDefined();
    expect(getHandler('memory_async_cancel')).toBeDefined();
  });

  it('submit returns jobId immediately without blocking', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);
    const submit = getHandler('memory_async_submit');
    expect(submit).toBeDefined();

    const started = Date.now();
    const result = parseResponse(
      await submit!({ type: 'extract', input: { transcript: TRANSCRIPT } }),
    );
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(true);
    expect(typeof result.data?.['jobId']).toBe('string');
    expect(String(result.data?.['jobId'])).toMatch(/^job_/);
    expect(['pending', 'processing']).toContain(result.data?.['status'] as string);
    // Returns immediately — must not wait for the background pipeline.
    expect(elapsed).toBeLessThan(1000);
  });

  it('status transitions queued→running→done with extraction result', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);
    const submit = getHandler('memory_async_submit')!;
    const status = getHandler('memory_async_status')!;
    const submitted = parseResponse(await submit({ type: 'extract', input: { transcript: TRANSCRIPT } }));
    const jobId = submitted.data?.['jobId'] as string;

    await vi.waitFor(
      () => {
        expect(getAsyncJobManager().getStatus(jobId)?.status).toBe('completed');
      },
      { timeout: 5000 },
    );

    const result = parseResponse(await status({ jobId }));
    expect(result.ok).toBe(true);
    expect(result.data?.['status']).toBe('completed');
    expect(result.data?.['progress']).toBe(1);
    expect(result.data?.['error']).toBeNull();
    const output = result.data?.['output'] as Record<string, unknown>;
    expect(typeof output['factsExtracted']).toBe('number');
    expect(Array.isArray(output['facts'])).toBe(true);
  });

  it('cancel stops a running job and status reports cancelled', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);
    const submit = getHandler('memory_async_submit')!;
    const status = getHandler('memory_async_status')!;
    const cancel = getHandler('memory_async_cancel')!;

    // Pin the dream processor to a never-resolving op so the job stays running.
    getAsyncJobManager().registerProcessor({
      type: 'dream',
      process: () => new Promise<unknown>(() => undefined),
    });

    const submitted = parseResponse(await submit({ type: 'dream', input: {} }));
    const jobId = submitted.data?.['jobId'] as string;

    const cancelled = parseResponse(await cancel({ jobId }));
    expect(cancelled.ok).toBe(true);
    expect(cancelled.data?.['cancelled']).toBe(true);

    const result = parseResponse(await status({ jobId }));
    expect(result.ok).toBe(true);
    expect(result.data?.['status']).toBe('cancelled');
  });

  it('failed job surfaces the processor error via status', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);
    const submit = getHandler('memory_async_submit')!;
    const status = getHandler('memory_async_status')!;
    // bulk_import without documents → processor throws → failed.
    const submitted = parseResponse(await submit({ type: 'bulk_import', input: {} }));
    expect(submitted.ok).toBe(true);
    const jobId = submitted.data?.['jobId'] as string;

    await vi.waitFor(
      () => {
        expect(getAsyncJobManager().getStatus(jobId)?.status).toBe('failed');
      },
      { timeout: 5000 },
    );

    const result = parseResponse(await status({ jobId }));
    expect(result.ok).toBe(true);
    expect(result.data?.['status']).toBe('failed');
    expect(typeof result.data?.['error']).toBe('string');
    expect(String(result.data?.['error'])).toContain('documents');
    expect(result.data?.['output']).toBeNull();
  });

  it('validation rejects bad input', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);
    const submit = getHandler('memory_async_submit')!;
    const status = getHandler('memory_async_status')!;
    const cancel = getHandler('memory_async_cancel')!;

    expect(parseResponse(await submit({ type: 'nope', input: {} })).ok).toBe(false);
    expect(parseResponse(await status({ jobId: '' })).ok).toBe(false);
    expect(parseResponse(await status({ jobId: 'job_does_not_exist' })).ok).toBe(false);
    expect(parseResponse(await cancel({ jobId: '' })).ok).toBe(false);
    expect(parseResponse(await cancel({ jobId: 'job_does_not_exist' })).ok).toBe(false);
  });

  it('cancel on a completed job is rejected', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);
    const submit = getHandler('memory_async_submit')!;
    const cancel = getHandler('memory_async_cancel')!;
    const submitted = parseResponse(await submit({ type: 'extract', input: { transcript: TRANSCRIPT } }));
    const jobId = submitted.data?.['jobId'] as string;

    await vi.waitFor(
      () => {
        expect(getAsyncJobManager().getStatus(jobId)?.status).toBe('completed');
      },
      { timeout: 5000 },
    );

    const result = parseResponse(await cancel({ jobId }));
    expect(result.ok).toBe(false);
    expect(String(result.error?.message)).toContain('already completed');
  });
});
