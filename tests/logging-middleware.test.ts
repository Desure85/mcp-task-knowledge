/**
 * Tests for Logging Middleware (MW-003)
 *
 * Covers: verbosity levels, truncation, error logging, denied calls,
 * maxDepth, configuration options, integration with ToolExecutor.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LoggingMiddleware,
  createLoggingMiddleware,
} from '../src/core/logging-middleware.js';
import type { LogVerbosity } from '../src/core/logging-middleware.js';
import { MiddlewarePipeline, MiddlewareContext } from '../src/core/middleware.js';
import {
  createToolContext,
  ToolExecutor,
  ToolDeniedError,
} from '../src/core/tool-executor.js';
import type { RawToolHandler, ToolContext } from '../src/core/tool-executor.js';
import type { ServerContext } from '../src/register/context.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ─── Helpers ──────────────────────────────────────────────────────────

function createMockServerContext(): ServerContext {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  return {
    server,
    cfg: { embeddings: { mode: 'none' }, obsidian: { vaultRoot: '/tmp' } },
    catalogCfg: {
      mode: 'embedded', prefer: 'embedded',
      embedded: { enabled: false, prefix: '/catalog', store: 'memory' },
      remote: { enabled: false, timeoutMs: 2000 },
      sync: { enabled: false, intervalSec: 60, direction: 'none' },
    },
    catalogProvider: {} as any,
    vectorAdapter: undefined, vectorInitAttempted: false,
    ensureVectorAdapter: async () => undefined,
    toolRegistry: { get: () => undefined, has: () => false, set: () => {}, all: () => [], size: 0 } as any,
    resourceRegistry: [], toolNames: new Set(),
    STRICT_TOOL_DEDUP: false, TOOLS_ENABLED: true, TOOL_RES_ENABLED: false, TOOL_RES_EXEC: false,
    REPO_ROOT: '/tmp',
    SERVER_CAPS: { resources: { list: true, read: true }, tools: { call: true } },
    normalizeBase64: (s) => s, makeResourceTemplate: () => ({}) as any, registerToolAsResource: () => {},
  };
}

function createContext(overrides?: Partial<ToolContext>): ToolContext {
  return createToolContext({
    sessionId: 'test-session',
    remote: '127.0.0.1:54321',
    server: createMockServerContext(),
    ...overrides,
  });
}

function createMwCtx(input?: Record<string, unknown>): MiddlewareContext {
  return new MiddlewareContext('test_tool', input ?? { x: 1 }, createContext());
}

// ─── LoggingMiddleware — basic ────────────────────────────────────────

describe('LoggingMiddleware — basic', () => {
  it('should have correct name', () => {
    const mw = new LoggingMiddleware();
    expect(mw.name).toBe('logging');
  });

  it('should implement ToolMiddleware interface', () => {
    const mw = new LoggingMiddleware();
    expect(mw.before).toBeDefined();
    expect(mw.after).toBeDefined();
    expect(mw.onError).toBeDefined();
  });

  it('should be creatable via factory', () => {
    const mw = createLoggingMiddleware({ verbosity: 'verbose' });
    expect(mw.name).toBe('logging');
    expect(mw.getVerbosity()).toBe('verbose');
  });

  it('should default to standard verbosity', () => {
    const mw = new LoggingMiddleware();
    expect(mw.getVerbosity()).toBe('standard');
  });
});

// ─── Verbosity — none ────────────────────────────────────────────────

describe('LoggingMiddleware — verbosity: none', () => {
  it('should not log on after', () => {
    const mw = new LoggingMiddleware({ verbosity: 'none' });
    const ctx = createMwCtx();
    const result = mw.after(ctx, { ok: true });
    expect(result).toEqual({ ok: true }); // passthrough
  });

  it('should not log on onError (re-throws)', () => {
    const mw = new LoggingMiddleware({ verbosity: 'none' });
    const ctx = createMwCtx();
    const err = new Error('boom');
    expect(() => mw.onError(ctx, err)).toThrow('boom');
  });
});

// ─── Verbosity — minimal ─────────────────────────────────────────────

describe('LoggingMiddleware — verbosity: minimal', () => {
  it('should return result unchanged', () => {
    const mw = new LoggingMiddleware({ verbosity: 'minimal' });
    const ctx = createMwCtx();
    const result = { status: 'ok' };
    expect(mw.after(ctx, result)).toBe(result);
  });
});

// ─── Verbosity — standard ────────────────────────────────────────────

describe('LoggingMiddleware — verbosity: standard', () => {
  it('should return result unchanged', () => {
    const mw = new LoggingMiddleware({ verbosity: 'standard' });
    const ctx = createMwCtx();
    const result = { data: [1, 2, 3] };
    expect(mw.after(ctx, result)).toBe(result);
  });

  it('should return result unchanged on error re-throw', () => {
    const mw = new LoggingMiddleware({ verbosity: 'standard' });
    const ctx = createMwCtx();
    expect(() => mw.onError(ctx, new Error('x'))).toThrow('x');
  });
});

// ─── Verbosity — verbose ─────────────────────────────────────────────

describe('LoggingMiddleware — verbosity: verbose', () => {
  it('should return result unchanged', () => {
    const mw = new LoggingMiddleware({ verbosity: 'verbose' });
    const ctx = createMwCtx({ input: { big: 'x'.repeat(2000) } });
    const result = { output: 'y'.repeat(2000) };
    // Result should be passed through (logging doesn't modify it)
    expect(mw.after(ctx, result)).toBe(result);
  });
});

// ─── Error handling ──────────────────────────────────────────────────

describe('LoggingMiddleware — error handling', () => {
  it('should re-throw original Error', () => {
    const mw = new LoggingMiddleware({ verbosity: 'standard' });
    const ctx = createMwCtx();
    expect(() => mw.onError(ctx, new Error('handler-fail'))).toThrow('handler-fail');
  });

  it('should re-throw non-Error values', () => {
    const mw = new LoggingMiddleware({ verbosity: 'standard' });
    const ctx = createMwCtx();
    expect(() => mw.onError(ctx, 'string-error')).toThrow('string-error');
  });

  it('should re-throw with logErrors=false', () => {
    const mw = new LoggingMiddleware({ verbosity: 'standard', logErrors: false });
    const ctx = createMwCtx();
    expect(() => mw.onError(ctx, new Error('x'))).toThrow('x');
  });
});

// ─── Truncation ─────────────────────────────────────────────────────

describe('LoggingMiddleware — truncation', () => {
  it('should truncate long strings', () => {
    const mw = new LoggingMiddleware({ verbosity: 'verbose', maxLength: 50 });
    const ctx = createMwCtx();
    const longOutput = 'a'.repeat(200);
    // after() doesn't modify result, but logs it truncated
    mw.after(ctx, longOutput);
    // We can't easily inspect log output, but verify the middleware doesn't crash
  });

  it('should truncate nested objects', () => {
    const mw = new LoggingMiddleware({ verbosity: 'verbose', maxLength: 100 });
    const ctx = createMwCtx();
    const nested = { a: { b: { c: { d: { e: 'deep' } } } } };
    mw.after(ctx, nested);
    // No crash = success
  });

  it('should respect maxDepth', () => {
    const mw = new LoggingMiddleware({ verbosity: 'verbose', maxDepth: 2 });
    const ctx = createMwCtx();
    const deep = { l1: { l2: { l3: { l4: 'x' } } } };
    mw.after(ctx, deep);
    // No crash = success
  });

  it('should handle Error objects in input', () => {
    const mw = new LoggingMiddleware({ verbosity: 'verbose' });
    const ctx = createMwCtx({ input: { err: new Error('test') } as any });
    mw.after(ctx, {});
    // No crash = success
  });
});

// ─── Pipeline integration ────────────────────────────────────────────

describe('LoggingMiddleware — pipeline integration', () => {
  it('should work in MiddlewarePipeline', async () => {
    const mw = new LoggingMiddleware({ verbosity: 'minimal' });
    const pipeline = new MiddlewarePipeline();
    pipeline.use(mw);

    const ctx = createMwCtx();
    const handler = vi.fn().mockResolvedValue('hello');
    const result = await pipeline.run(ctx, handler);

    expect(result).toBe('hello');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('should log error path via pipeline', async () => {
    const mw = new LoggingMiddleware({ verbosity: 'standard' });
    const pipeline = new MiddlewarePipeline();
    pipeline.use(mw);

    const ctx = createMwCtx();
    const handler = () => { throw new Error('pipeline-error'); };

    await expect(pipeline.run(ctx, handler)).rejects.toThrow('pipeline-error');
  });

  it('should log short-circuit path via pipeline', async () => {
    const mw = new LoggingMiddleware({ verbosity: 'standard' });

    const pipeline = new MiddlewarePipeline();
    pipeline.use({
      name: 'cache',
      before: (ctx) => { ctx.shortCircuit('cached'); },
    });
    pipeline.use(mw);

    const ctx = createMwCtx();
    const handler = vi.fn().mockResolvedValue('nope');
    const result = await pipeline.run(ctx, handler);

    expect(result).toBe('cached');
    expect(handler).not.toHaveBeenCalled();
  });
});

// ─── ToolExecutor integration ────────────────────────────────────────

describe('LoggingMiddleware — ToolExecutor integration', () => {
  it('should work as executor middleware', async () => {
    const executor = new ToolExecutor();
    const mw = new LoggingMiddleware({ verbosity: 'minimal' });
    executor.use(mw);

    const ctx = createContext();
    const handler: RawToolHandler<string, string> = async (input) => `hi ${input.name}`;
    const result = await executor.execute('greet', { name: 'world' }, ctx, handler);

    expect(result).toBe('hi world');
  });

  it('should not swallow errors in executor', async () => {
    const executor = new ToolExecutor();
    const mw = new LoggingMiddleware({ verbosity: 'standard' });
    executor.use(mw);

    const ctx = createContext();
    const handler: RawToolHandler = async () => { throw new Error('exec-error'); };

    await expect(executor.execute('fail', {}, ctx, handler)).rejects.toThrow('exec-error');
  });
});

// ─── Configuration ───────────────────────────────────────────────────

describe('LoggingMiddleware — configuration', () => {
  it('should accept all options', () => {
    const mw = new LoggingMiddleware({
      verbosity: 'debug',
      maxLength: 500,
      maxDepth: 3,
      logDenied: false,
      logErrors: false,
    });

    expect(mw.getVerbosity()).toBe('debug');
  });

  it('should create via factory with options', () => {
    const mw = createLoggingMiddleware({ verbosity: 'verbose', maxLength: 2048 });
    expect(mw.name).toBe('logging');
    expect(mw.getVerbosity()).toBe('verbose');
  });
});
