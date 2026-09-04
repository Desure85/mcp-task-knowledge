import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerMemoryTools } from '../src/register/memory.js';
import { resetAsyncJobManager } from '../src/memory/async-ops.js';
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

describe('memory_extract_async tool (NEXT-016)', () => {
  beforeEach(() => {
    resetAsyncJobManager();
  });

  it('registers the tool', () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);
    expect(getHandler('memory_extract_async')).toBeDefined();
  });

  it('returns jobId immediately without blocking', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);
    const handler = getHandler('memory_extract_async')!;
    const result = await handler({ transcript: TRANSCRIPT });
    const parsed = parseResponse(result);
    expect(parsed.ok).toBe(true);
    expect(typeof parsed.data?.['jobId']).toBe('string');
    expect(parsed.data?.['type']).toBe('extract');
  });

  it('job completes with extracted facts via memory_async_status', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);
    const submit = getHandler('memory_extract_async')!;
    const status = getHandler('memory_async_status')!;
    const submitted = parseResponse(await submit({ transcript: TRANSCRIPT }));
    const jobId = submitted.data?.['jobId'] as string;
    for (let i = 0; i < 100; i++) {
      const st = parseResponse(await status({ jobId }));
      if (st.data?.['status'] === 'completed') {
        const output = st.data?.['output'] as Record<string, unknown>;
        expect(typeof output['factsExtracted']).toBe('number');
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('extract job did not complete in time');
  });

  it('accepts webhookUrl and scope params', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);
    const handler = getHandler('memory_extract_async')!;
    const result = await handler({
      transcript: TRANSCRIPT,
      userId: 'u1',
      runId: 'r1',
      maxFacts: 5,
      webhookUrl: 'https://example.com/hook',
    });
    const parsed = parseResponse(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.['webhookUrl']).toBe('https://example.com/hook');
  });

  it('rejects persist=true without project', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);
    const handler = getHandler('memory_extract_async')!;
    const parsed = parseResponse(await handler({ transcript: TRANSCRIPT, persist: true }));
    expect(parsed.ok).toBe(false);
  });

  it('short transcript fails the job with a validation error', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);
    const submit = getHandler('memory_extract_async')!;
    const status = getHandler('memory_async_status')!;
    const submitted = parseResponse(await submit({ transcript: 'short' }));
    expect(submitted.ok).toBe(true);
    const jobId = submitted.data?.['jobId'] as string;
    for (let i = 0; i < 100; i++) {
      const st = parseResponse(await status({ jobId }));
      if (st.data?.['status'] === 'failed') {
        expect(String(st.data?.['error'])).toContain('transcript');
        return;
      }
      if (st.data?.['status'] === 'completed') return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('extract job did not settle in time');
  });
});
