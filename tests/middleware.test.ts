/**
 * Tests for Middleware Pipeline (MW-001)
 *
 * Covers: MiddlewareContext, ToolMiddleware interface, MiddlewarePipeline,
 * before/after/onError hooks, short-circuit (imperative + declarative),
 * error propagation/swallowing, ordering, integration with ToolExecutor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MiddlewareContext,
  MiddlewarePipeline,
} from '../src/core/middleware.js';
import type { ToolMiddleware } from '../src/core/middleware.js';
import {
  createToolContext,
  ToolExecutor,
  ToolDeniedError,
} from '../src/core/tool-executor.js';
import type {
  ToolContext,
  ContextAwareToolHandler,
  RawToolHandler,
} from '../src/core/tool-executor.js';
import type { ServerContext } from '../src/register/context.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ─── Helpers ──────────────────────────────────────────────────────────

function createMockServerContext(): ServerContext {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  return {
    server,
    cfg: {
      embeddings: { mode: 'none' },
      obsidian: { vaultRoot: '/tmp/test-vault' },
    },
    catalogCfg: {
      mode: 'embedded',
      prefer: 'embedded',
      embedded: { enabled: false, prefix: '/catalog', store: 'memory' },
      remote: { enabled: false, timeoutMs: 2000 },
      sync: { enabled: false, intervalSec: 60, direction: 'none' },
    },
    catalogProvider: {} as any,
    vectorAdapter: undefined,
    vectorInitAttempted: false,
    ensureVectorAdapter: async () => undefined,
    toolRegistry: {
      get: () => undefined,
      has: () => false,
      set: () => {},
      all: () => [],
      size: 0,
    } as any,
    resourceRegistry: [],
    toolNames: new Set(),
    STRICT_TOOL_DEDUP: false,
    TOOLS_ENABLED: true,
    TOOL_RES_ENABLED: false,
    TOOL_RES_EXEC: false,
    REPO_ROOT: '/tmp',
    SERVER_CAPS: { resources: { list: true, read: true }, tools: { call: true } },
    normalizeBase64: (s) => s,
    makeResourceTemplate: (p: string) => ({} as any),
    registerToolAsResource: () => {},
  };
}

function createContext(overrides?: Partial<ToolContext>): ToolContext {
  return createToolContext({
    sessionId: 'test-session-123',
    remote: '127.0.0.1:54321',
    server: createMockServerContext(),
    ...overrides,
  });
}

function createMwCtx(overrides?: Partial<{ toolName: string; input: Record<string, unknown> }>): MiddlewareContext {
  return new MiddlewareContext(
    overrides?.toolName ?? 'test_tool',
    overrides?.input ?? { x: 1 },
    createContext(),
  );
}

// ─── MiddlewareContext ────────────────────────────────────────────────

describe('MiddlewareContext', () => {
  it('should initialize with required fields', () => {
    const ctx = createMwCtx({ toolName: 'my_tool', input: { a: 1 } });
    expect(ctx.toolName).toBe('my_tool');
    expect(ctx.input).toEqual({ a: 1 });
    expect(ctx.context.sessionId).toBe('test-session-123');
    expect(ctx.startTime).toBeGreaterThan(0);
    expect(ctx.durationMs).toBe(0);
    expect(ctx.shortCircuited).toBe(false);
    expect(ctx.mw).toEqual({});
    expect(ctx.result).toBeUndefined();
    expect(ctx.error).toBeUndefined();
  });

  it('should support short-circuit via method', () => {
    const ctx = createMwCtx();
    ctx.shortCircuit({ cached: true });
    expect(ctx.shortCircuited).toBe(true);
    expect(ctx.shortCircuitResult).toEqual({ cached: true });
  });

  it('should be mutable — input can be modified', () => {
    const ctx = createMwCtx({ input: { original: true } });
    ctx.input = { modified: true };
    expect(ctx.input).toEqual({ modified: true });
  });

  it('mw metadata should be shared and mutable', () => {
    const ctx = createMwCtx();
    ctx.mw['auth'] = { userId: '42' };
    expect(ctx.mw['auth']).toEqual({ userId: '42' });
  });
});

// ─── MiddlewarePipeline — registration ────────────────────────────────

describe('MiddlewarePipeline — registration', () => {
  it('should add middleware and return true for new', () => {
    const pipeline = new MiddlewarePipeline();
    const mw: ToolMiddleware = { name: 'test' };
    expect(pipeline.use(mw)).toBe(true);
    expect(pipeline.size).toBe(1);
  });

  it('should replace middleware with same name and return false', () => {
    const pipeline = new MiddlewarePipeline();
    const mw1: ToolMiddleware = { name: 'test', before: () => {} };
    const mw2: ToolMiddleware = { name: 'test', after: () => 'mod' };
    pipeline.use(mw1);
    expect(pipeline.use(mw2)).toBe(false);
    expect(pipeline.size).toBe(1);
    // mw2 replaced mw1 — after is now available
    expect(pipeline.get('test')?.after).toBeDefined();
  });

  it('should remove middleware by name', () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use({ name: 'a' });
    pipeline.use({ name: 'b' });
    expect(pipeline.remove('a')).toBe(true);
    expect(pipeline.size).toBe(1);
    expect(pipeline.getNames()).toEqual(['b']);
  });

  it('should remove middleware by reference', () => {
    const pipeline = new MiddlewarePipeline();
    const mw: ToolMiddleware = { name: 'ref' };
    pipeline.use(mw);
    expect(pipeline.remove(mw)).toBe(true);
    expect(pipeline.size).toBe(0);
  });

  it('should return false when removing non-existent', () => {
    const pipeline = new MiddlewarePipeline();
    expect(pipeline.remove('ghost')).toBe(false);
  });

  it('should get middleware by name', () => {
    const pipeline = new MiddlewarePipeline();
    const mw: ToolMiddleware = { name: 'found' };
    pipeline.use(mw);
    expect(pipeline.get('found')).toBe(mw);
    expect(pipeline.get('missing')).toBeUndefined();
  });

  it('should check has()', () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use({ name: 'exists' });
    expect(pipeline.has('exists')).toBe(true);
    expect(pipeline.has('nope')).toBe(false);
  });

  it('should getNames in order', () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use({ name: 'first' });
    pipeline.use({ name: 'second' });
    pipeline.use({ name: 'third' });
    expect(pipeline.getNames()).toEqual(['first', 'second', 'third']);
  });

  it('should clear all middleware', () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use({ name: 'a' });
    pipeline.use({ name: 'b' });
    pipeline.clear();
    expect(pipeline.size).toBe(0);
  });
});

// ─── MiddlewarePipeline — execution ───────────────────────────────────

describe('MiddlewarePipeline — execution', () => {
  it('should run handler with no middleware', async () => {
    const pipeline = new MiddlewarePipeline();
    const handler = vi.fn().mockResolvedValue('handler-result');
    const ctx = createMwCtx();

    const result = await pipeline.run(ctx, handler);
    expect(result).toBe('handler-result');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('should call before hooks in order', async () => {
    const pipeline = new MiddlewarePipeline();
    const order: string[] = [];

    pipeline.use({
      name: 'mw1',
      before: (ctx) => { order.push('mw1-before'); },
    });
    pipeline.use({
      name: 'mw2',
      before: (ctx) => { order.push('mw2-before'); },
    });

    const handler = vi.fn().mockResolvedValue('ok');
    await pipeline.run(createMwCtx(), handler);

    expect(order).toEqual(['mw1-before', 'mw2-before']);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('should call after hooks in reverse order', async () => {
    const pipeline = new MiddlewarePipeline();
    const order: string[] = [];

    pipeline.use({
      name: 'mw1',
      after: (ctx, result) => { order.push('mw1-after'); return result; },
    });
    pipeline.use({
      name: 'mw2',
      after: (ctx, result) => { order.push('mw2-after'); return result; },
    });

    const handler = vi.fn().mockResolvedValue('ok');
    await pipeline.run(createMwCtx(), handler);

    expect(order).toEqual(['mw2-after', 'mw1-after']);
  });

  it('should thread result through after hooks', async () => {
    const pipeline = new MiddlewarePipeline();

    pipeline.use({
      name: 'transform',
      after: (ctx, result) => ({ ...result as object, transformed: true }),
    });
    pipeline.use({
      name: 'enrich',
      after: (ctx, result) => ({ ...result as object, enriched: true }),
    });

    const handler = vi.fn().mockResolvedValue({ base: true });
    const result = await pipeline.run(createMwCtx(), handler);

    // Reverse order: enrich runs first, then transform
    expect(result).toEqual({ base: true, enriched: true, transformed: true });
  });

  it('should call onError in reverse order', async () => {
    const pipeline = new MiddlewarePipeline();
    const order: string[] = [];

    pipeline.use({
      name: 'mw1',
      onError: (ctx, err) => { order.push('mw1-onError'); throw err; },
    });
    pipeline.use({
      name: 'mw2',
      onError: (ctx, err) => { order.push('mw2-onError'); throw err; },
    });

    const handler = () => { throw new Error('boom'); };
    await expect(pipeline.run(createMwCtx(), handler)).rejects.toThrow('boom');

    expect(order).toEqual(['mw2-onError', 'mw1-onError']);
  });

  it('should set durationMs after handler completes', async () => {
    const pipeline = new MiddlewarePipeline();
    const ctx = createMwCtx();

    const handler = async () => {
      await new Promise((r) => setTimeout(r, 30));
      return 'done';
    };

    await pipeline.run(ctx, handler);
    expect(ctx.durationMs).toBeGreaterThanOrEqual(20);
  });

  // ─── Short-circuit ─────────────────────────────────────────────────

  describe('short-circuit', () => {
    it('should support imperative short-circuit via ctx.shortCircuit()', async () => {
      const pipeline = new MiddlewarePipeline();
      const handler = vi.fn().mockResolvedValue('should-not-run');

      pipeline.use({
        name: 'cache',
        before: (ctx) => {
          ctx.shortCircuit({ fromCache: true });
        },
      });

      const result = await pipeline.run(createMwCtx(), handler);
      expect(result).toEqual({ fromCache: true });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should support declarative short-circuit via return value', async () => {
      const pipeline = new MiddlewarePipeline();
      const handler = vi.fn().mockResolvedValue('should-not-run');

      pipeline.use({
        name: 'deny',
        before: () => ({ shortCircuit: { denied: true } }),
      });

      const result = await pipeline.run(createMwCtx(), handler);
      expect(result).toEqual({ denied: true });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should skip remaining before hooks on short-circuit', async () => {
      const pipeline = new MiddlewarePipeline();
      const order: string[] = [];

      pipeline.use({
        name: 'blocker',
        before: (ctx) => {
          order.push('blocker');
          ctx.shortCircuit('blocked');
        },
      });
      pipeline.use({
        name: 'after-blocker',
        before: () => {
          order.push('after-blocker');
        },
      });

      await pipeline.run(createMwCtx(), vi.fn());
      expect(order).toEqual(['blocker']);
    });

    it('should still run after hooks on short-circuit', async () => {
      const pipeline = new MiddlewarePipeline();
      const order: string[] = [];

      pipeline.use({
        name: 'sc',
        before: (ctx) => { order.push('sc-before'); ctx.shortCircuit('early'); },
        after: (ctx, result) => { order.push('sc-after'); return result; },
      });

      const result = await pipeline.run(createMwCtx(), vi.fn());
      expect(order).toEqual(['sc-before', 'sc-after']);
      expect(result).toBe('early');
    });

    it('should thread short-circuit result through after hooks', async () => {
      const pipeline = new MiddlewarePipeline();

      pipeline.use({
        name: 'sc',
        before: () => ({ shortCircuit: 42 }),
        after: (_ctx, result) => (result as number) + 1,
      });

      const result = await pipeline.run(createMwCtx(), vi.fn());
      expect(result).toBe(43);
    });
  });

  // ─── Error handling ───────────────────────────────────────────────

  describe('error handling', () => {
    it('should re-throw when no onError swallows', async () => {
      const pipeline = new MiddlewarePipeline();
      pipeline.use({
        name: 'observer',
        onError: (_ctx, err) => {
          // observe but don't swallow
        },
      });

      await expect(
        pipeline.run(createMwCtx(), () => { throw new Error('handler-error'); }),
      ).rejects.toThrow('handler-error');
    });

    it('should swallow error when onError returns a value', async () => {
      const pipeline = new MiddlewarePipeline();
      pipeline.use({
        name: 'fallback',
        onError: () => ({ fallback: true }),
      });

      const result = await pipeline.run(
        createMwCtx(),
        () => { throw new Error('handled'); },
      );
      expect(result).toEqual({ fallback: true });
    });

    it('should run after hooks with fallback result after swallow', async () => {
      const pipeline = new MiddlewarePipeline();
      const order: string[] = [];

      pipeline.use({
        name: 'swallower',
        onError: () => {
          order.push('onError');
          return 'recovered';
        },
        after: (_ctx, result) => {
          order.push('after');
          return result;
        },
      });

      const result = await pipeline.run(
        createMwCtx(),
        () => { throw new Error('dead'); },
      );
      expect(result).toBe('recovered');
      expect(order).toEqual(['onError', 'after']);
    });

    it('should call onError when before throws ToolDeniedError', async () => {
      const pipeline = new MiddlewarePipeline();
      const errorHook = vi.fn();

      pipeline.use({
        name: 'denier',
        before: () => { throw new ToolDeniedError('x', 'nope'); },
        onError: errorHook,
      });

      await expect(
        pipeline.run(createMwCtx(), vi.fn()),
      ).rejects.toThrow(ToolDeniedError);

      expect(errorHook).toHaveBeenCalledOnce();
    });

    it('should continue past before hook that throws non-denial error', async () => {
      const pipeline = new MiddlewarePipeline();
      const handler = vi.fn().mockResolvedValue('survived');

      pipeline.use({
        name: 'buggy',
        before: () => { throw new Error('mw bug'); },
      });

      const result = await pipeline.run(createMwCtx(), handler);
      expect(result).toBe('survived');
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should continue past after hook that throws', async () => {
      const pipeline = new MiddlewarePipeline();

      pipeline.use({
        name: 'buggy-after',
        after: () => { throw new Error('after bug'); },
      });

      const handler = vi.fn().mockResolvedValue('ok');
      const result = await pipeline.run(createMwCtx(), handler);
      expect(result).toBe('ok');
    });

    it('should continue past onError hook that throws', async () => {
      const pipeline = new MiddlewarePipeline();
      pipeline.use({
        name: 'buggy-error',
        onError: () => { throw new Error('onError bug'); },
      });
      pipeline.use({
        name: 'fallback',
        onError: () => 'safe',
      });

      const result = await pipeline.run(
        createMwCtx(),
        () => { throw new Error('original'); },
      );
      expect(result).toBe('safe');
    });

    it('should re-throw non-Error values', async () => {
      const pipeline = new MiddlewarePipeline();

      await expect(
        pipeline.run(createMwCtx(), () => { throw 'string-error'; }),
      ).rejects.toThrow('string-error');
    });
  });

  // ─── Full pipeline ordering ───────────────────────────────────────

  describe('full pipeline ordering', () => {
    it('should execute: before(1) → before(2) → handler → after(2) → after(1)', async () => {
      const pipeline = new MiddlewarePipeline();
      const order: string[] = [];

      pipeline.use({
        name: 'mw1',
        before: () => { order.push('1-before'); },
        after: (_ctx, r) => { order.push('1-after'); return r; },
      });
      pipeline.use({
        name: 'mw2',
        before: () => { order.push('2-before'); },
        after: (_ctx, r) => { order.push('2-after'); return r; },
      });

      await pipeline.run(createMwCtx(), () => { order.push('handler'); return 'ok'; });
      expect(order).toEqual(['1-before', '2-before', 'handler', '2-after', '1-after']);
    });

    it('should support async middleware', async () => {
      const pipeline = new MiddlewarePipeline();
      const order: string[] = [];

      pipeline.use({
        name: 'async-mw',
        before: async () => {
          await new Promise((r) => setTimeout(r, 10));
          order.push('async-before');
        },
        after: async (_ctx, r) => {
          await new Promise((r) => setTimeout(r, 10));
          order.push('async-after');
          return r;
        },
      });

      const result = await pipeline.run(createMwCtx(), async () => {
        order.push('handler');
        return 'ok';
      });

      expect(order).toEqual(['async-before', 'handler', 'async-after']);
      expect(result).toBe('ok');
    });

    it('should share mw metadata between middleware', async () => {
      const pipeline = new MiddlewarePipeline();

      pipeline.use({
        name: 'writer',
        before: (ctx) => { ctx.mw['key'] = 'set-by-writer'; },
      });
      pipeline.use({
        name: 'reader',
        before: (ctx) => { expect(ctx.mw['key']).toBe('set-by-writer'); },
      });

      await pipeline.run(createMwCtx(), vi.fn());
    });

    it('should allow middleware to modify input before handler', async () => {
      const pipeline = new MiddlewarePipeline();

      pipeline.use({
        name: 'input-modifier',
        before: (ctx) => { ctx.input = { x: 99 }; },
      });

      const testCtx = createMwCtx({ input: { x: 1 } });
      const capturedInputs: any[] = [];
      const handler = vi.fn(async () => {
        capturedInputs.push(testCtx.input);
        return testCtx.input.x;
      });

      const result = await pipeline.run(testCtx, handler);
      expect(result).toBe(99);
      expect(capturedInputs[0]).toEqual({ x: 99 });
    });
  });
});

// ─── ToolExecutor + Middleware Integration ───────────────────────────

describe('ToolExecutor + Middleware integration', () => {
  it('should not use pipeline when no middleware registered', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();
    const handler: RawToolHandler = async () => 'plain';

    const result = await executor.execute('test', {}, ctx, handler);
    expect(result).toBe('plain');
  });

  it('should route through pipeline when middleware exists', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();
    const order: string[] = [];

    executor.use({
      name: 'mw1',
      before: () => { order.push('mw-before'); },
      after: (_ctx, r) => { order.push('mw-after'); return r; },
    });

    const handler: RawToolHandler<string, string> = async (input) => {
      order.push('handler');
      return `result: ${input.val}`;
    };

    const result = await executor.execute('test', { val: '42' }, ctx, handler);
    expect(result).toBe('result: 42');
    expect(order).toEqual(['mw-before', 'handler', 'mw-after']);
  });

  it('should pass middleware-modified input to hooks and handler', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();

    executor.use({
      name: 'input-enricher',
      before: (mwCtx) => {
        mwCtx.input = { ...mwCtx.input, injected: true };
      },
    });

    const handler: RawToolHandler<any, any> = async (input) => input;
    const result = await executor.execute('test', { original: true }, ctx, handler);
    expect(result).toEqual({ original: true, injected: true });
  });

  it('should support middleware short-circuit in executor', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();
    const handler = vi.fn().mockResolvedValue('nope');

    executor.use({
      name: 'cache',
      before: (mwCtx) => { mwCtx.shortCircuit('cached-value'); },
    });

    const result = await executor.execute('test', {}, ctx, handler);
    expect(result).toBe('cached-value');
    expect(handler).not.toHaveBeenCalled();
  });

  it('should support middleware error swallowing in executor', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();

    executor.use({
      name: 'error-handler',
      onError: () => 'fallback',
    });

    const handler: RawToolHandler = async () => { throw new Error('boom'); };
    const result = await executor.execute('test', {}, ctx, handler);
    expect(result).toBe('fallback');
  });

  it('use() should return true for new, false for replacement', () => {
    const executor = new ToolExecutor();
    expect(executor.use({ name: 'a' })).toBe(true);
    expect(executor.use({ name: 'a' })).toBe(false);
  });

  it('removeMiddleware should work by name and reference', () => {
    const executor = new ToolExecutor();
    const mw: ToolMiddleware = { name: 'rm' };
    executor.use(mw);

    expect(executor.removeMiddleware('rm')).toBe(true);
    expect(executor.getPipeline().size).toBe(0);

    executor.use(mw);
    expect(executor.removeMiddleware(mw)).toBe(true);
  });

  it('getHookCounts should include middleware count', () => {
    const executor = new ToolExecutor();
    executor.use({ name: 'a' });
    executor.use({ name: 'b' });
    executor.addPreHook(() => ({}));

    expect(executor.getHookCounts()).toEqual({
      pre: 1,
      post: 0,
      error: 0,
      middleware: 2,
    });
  });

  it('clearMiddleware should not affect hooks', () => {
    const executor = new ToolExecutor();
    executor.use({ name: 'a' });
    executor.addPreHook(() => ({}));
    executor.addPostHook(() => {});

    executor.clearMiddleware();
    expect(executor.getHookCounts()).toEqual({
      pre: 1,
      post: 1,
      error: 0,
      middleware: 0,
    });
  });

  it('clearHooks should not affect middleware', () => {
    const executor = new ToolExecutor();
    executor.use({ name: 'a' });
    executor.addPreHook(() => ({}));
    executor.addPostHook(() => {});

    executor.clearHooks();
    expect(executor.getHookCounts()).toEqual({
      pre: 0,
      post: 0,
      error: 0,
      middleware: 1,
    });
  });

  it('middleware + hooks should both execute (middleware wraps hooks)', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();
    const order: string[] = [];

    // Middleware (outer)
    executor.use({
      name: 'mw',
      before: () => { order.push('mw-before'); },
      after: (_ctx, r) => { order.push('mw-after'); return r; },
    });

    // Hooks (inner)
    executor.addPreHook(() => { order.push('hook-pre'); return {}; });
    executor.addPostHook(() => { order.push('hook-post'); });

    const handler: RawToolHandler = async () => {
      order.push('handler');
      return 'ok';
    };

    const result = await executor.execute('test', {}, ctx, handler);
    expect(result).toBe('ok');
    expect(order).toEqual(['mw-before', 'hook-pre', 'handler', 'hook-post', 'mw-after']);
  });
});
