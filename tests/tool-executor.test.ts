/**
 * Tests for ToolContext and ToolExecutor (S-002)
 *
 * Covers: ToolContext creation, ToolExecutor execute, pre/post/error hooks,
 * hook pipeline ordering, ToolDeniedError, context-aware vs raw handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createToolContext,
  ToolExecutor,
  ToolDeniedError,
} from '../src/core/tool-executor.js';
import type {
  ToolContext,
  PreToolHook,
  PostToolHook,
  ErrorToolHook,
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

// ─── ToolContext ──────────────────────────────────────────────────────

describe('createToolContext', () => {
  it('should create context with required fields', () => {
    const ctx = createContext();

    expect(ctx.sessionId).toBe('test-session-123');
    expect(ctx.remote).toBe('127.0.0.1:54321');
    expect(ctx.roles).toEqual([]);
    expect(ctx.userId).toBeUndefined();
    expect(ctx.metadata).toEqual({});
    expect(ctx.createdAt).toBeGreaterThan(0);
    expect(ctx.server).toBeDefined();
  });

  it('should accept userId and roles', () => {
    const ctx = createContext({
      userId: 'user-42',
      roles: ['admin', 'editor'],
    });

    expect(ctx.userId).toBe('user-42');
    expect(ctx.roles).toEqual(['admin', 'editor']);
  });

  it('should accept custom metadata', () => {
    const ctx = createContext({
      metadata: { theme: 'dark', locale: 'en-US' },
    });

    expect(ctx.metadata).toEqual({ theme: 'dark', locale: 'en-US' });
  });

  it('should use provided createdAt', () => {
    const ts = 1700000000000;
    const ctx = createContext({ createdAt: ts });
    expect(ctx.createdAt).toBe(ts);
  });

  it('should default createdAt to Date.now()', () => {
    const before = Date.now();
    const ctx = createContext();
    const after = Date.now();
    expect(ctx.createdAt).toBeGreaterThanOrEqual(before);
    expect(ctx.createdAt).toBeLessThanOrEqual(after);
  });
});

// ─── ToolExecutor — basic execution ──────────────────────────────────

describe('ToolExecutor — basic execution', () => {
  it('should execute a context-aware handler with ToolContext', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();

    const handler: ContextAwareToolHandler<{ name: string }, string> = async (input, context) => {
      return `hello ${input.name} from ${context.sessionId}`;
    };

    const result = await executor.execute('greet', { name: 'world' }, ctx, handler);
    expect(result).toBe('hello world from test-session-123');
  });

  it('should execute a raw handler without ToolContext', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();

    const handler: RawToolHandler<{ x: number }, number> = async (input) => {
      return input.x * 2;
    };

    const result = await executor.execute('double', { x: 21 }, ctx, handler);
    expect(result).toBe(42);
  });

  it('should throw when handler throws', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();

    const handler: RawToolHandler = async () => {
      throw new Error('boom');
    };

    await expect(executor.execute('fail', {}, ctx, handler)).rejects.toThrow('boom');
  });
});

// ─── Pre-hooks ────────────────────────────────────────────────────────

describe('ToolExecutor — pre-hooks', () => {
  it('should call pre-hooks before execution', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();
    const preHook = vi.fn<PreToolHook>().mockReturnValue({});

    executor.addPreHook(preHook);

    const handler: RawToolHandler = async () => 'ok';
    const result = await executor.execute('test', {}, ctx, handler);

    expect(result).toBe('ok');
    expect(preHook).toHaveBeenCalledExactlyOnceWith('test', {}, expect.objectContaining({
      sessionId: 'test-session-123',
    }));
  });

  it('should deny execution when pre-hook denies', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();

    executor.addPreHook(() => ({ deny: true, reason: 'forbidden' }));

    const handler: RawToolHandler = async () => 'should not run';

    await expect(executor.execute('restricted', {}, ctx, handler)).rejects.toThrow(ToolDeniedError);
  });

  it('should include tool name and reason in ToolDeniedError', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();

    executor.addPreHook(() => ({ deny: true, reason: 'rate limited' }));

    try {
      await executor.execute('limited_tool', {}, ctx, async () => 'nope');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ToolDeniedError);
      const denied = err as ToolDeniedError;
      expect(denied.toolName).toBe('limited_tool');
      expect(denied.reason).toBe('rate limited');
      expect(denied.message).toContain('limited_tool');
      expect(denied.message).toContain('rate limited');
    }
  });

  it('should stop on first deny (short-circuit)', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();
    const secondHook = vi.fn<PreToolHook>().mockReturnValue({});

    executor.addPreHook(() => ({ deny: true, reason: 'first' }));
    executor.addPreHook(secondHook);

    await expect(executor.execute('test', {}, ctx, async () => 'no')).rejects.toThrow();

    // Second hook should NOT have been called
    expect(secondHook).not.toHaveBeenCalled();
  });

  it('should support async pre-hooks', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();

    executor.addPreHook(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { deny: false };
    });

    const handler: RawToolHandler = async () => 'ok';
    const result = await executor.execute('test', {}, ctx, handler);
    expect(result).toBe('ok');
  });

  it('should continue if pre-hook throws (log but don\'t block)', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();

    // This hook throws — should be caught, logged, but not block execution
    executor.addPreHook(() => {
      throw new Error('hook error');
    });

    const handler: RawToolHandler<string, string> = async (input) => `result: ${input.x}`;
    const result = await executor.execute('test', { x: 'hello' }, ctx, handler);
    expect(result).toBe('result: hello');
  });
});

// ─── Post-hooks ───────────────────────────────────────────────────────

describe('ToolExecutor — post-hooks', () => {
  it('should call post-hooks after successful execution', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();
    const postHook = vi.fn<PostToolHook>();

    executor.addPostHook(postHook);

    const handler: RawToolHandler<{ n: number }, number> = async (input) => input.n + 1;
    const result = await executor.execute('inc', { n: 41 }, ctx, handler);

    expect(result).toBe(42);
    expect(postHook).toHaveBeenCalledExactlyOnceWith(
      'inc',
      { n: 41 },
      42,
      expect.objectContaining({ sessionId: 'test-session-123' }),
      expect.any(Number), // durationMs
    );
  });

  it('should pass correct durationMs', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();

    let capturedDuration = 0;
    executor.addPostHook((_name, _input, _result, _ctx, durationMs) => {
      capturedDuration = durationMs;
    });

    const handler: RawToolHandler = async () => {
      await new Promise((r) => setTimeout(r, 50));
      return 'done';
    };

    await executor.execute('slow', {}, ctx, handler);
    expect(capturedDuration).toBeGreaterThanOrEqual(40); // allow some tolerance
  });

  it('should NOT call post-hooks when handler throws', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();
    const postHook = vi.fn<PostToolHook>();

    executor.addPostHook(postHook);

    const handler: RawToolHandler = async () => {
      throw new Error('fail');
    };

    await expect(executor.execute('test', {}, ctx, handler)).rejects.toThrow();
    expect(postHook).not.toHaveBeenCalled();
  });

  it('should support async post-hooks', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();

    const postHook = vi.fn<PostToolHook>().mockResolvedValue(undefined);
    executor.addPostHook(postHook);

    await executor.execute('test', {}, ctx, async () => 'ok');
    expect(postHook).toHaveBeenCalledOnce();
  });
});

// ─── Error hooks ──────────────────────────────────────────────────────

describe('ToolExecutor — error hooks', () => {
  it('should call error hooks when handler throws', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();
    const errorHook = vi.fn<ErrorToolHook>();

    executor.addErrorHook(errorHook);

    const handler: RawToolHandler = async () => {
      throw new Error('handler exploded');
    };

    await expect(executor.execute('boom', {}, ctx, handler)).rejects.toThrow('handler exploded');

    expect(errorHook).toHaveBeenCalledExactlyOnceWith(
      'boom',
      {},
      expect.any(Error),
      expect.objectContaining({ sessionId: 'test-session-123' }),
      expect.any(Number),
    );
  });

  it('should still re-throw after error hooks', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();

    executor.addErrorHook(() => {
      // Error hook runs but doesn't swallow the error
    });

    const handler: RawToolHandler = async () => {
      throw new Error('original');
    };

    await expect(executor.execute('test', {}, ctx, handler)).rejects.toThrow('original');
  });

  it('should NOT call error hooks when pre-hook denies', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();
    const errorHook = vi.fn<ErrorToolHook>();

    executor.addPreHook(() => ({ deny: true, reason: 'blocked' }));
    executor.addErrorHook(errorHook);

    await expect(executor.execute('test', {}, ctx, async () => 'no')).rejects.toThrow(ToolDeniedError);
    expect(errorHook).not.toHaveBeenCalled();
  });

  it('should continue if error hook throws (log but don\'t block re-throw)', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();

    executor.addErrorHook(() => {
      throw new Error('error hook itself failed');
    });

    const handler: RawToolHandler = async () => {
      throw new Error('original handler error');
    };

    // Should still throw the ORIGINAL error
    await expect(executor.execute('test', {}, ctx, handler)).rejects.toThrow('original handler error');
  });
});

// ─── Multiple hooks ordering ──────────────────────────────────────────

describe('ToolExecutor — hook pipeline ordering', () => {
  it('should call hooks in registration order', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();

    const order: string[] = [];

    executor.addPreHook(() => { order.push('pre-1'); return {}; });
    executor.addPreHook(() => { order.push('pre-2'); return {}; });
    executor.addPostHook(() => { order.push('post-1'); });
    executor.addPostHook(() => { order.push('post-2'); });

    await executor.execute('test', {}, ctx, async () => {
      order.push('handler');
      return 'ok';
    });

    expect(order).toEqual(['pre-1', 'pre-2', 'handler', 'post-1', 'post-2']);
  });

  it('should call error hooks in order when handler fails', async () => {
    const executor = new ToolExecutor();
    const ctx = createContext();

    const order: string[] = [];
    executor.addPreHook(() => { order.push('pre'); return {}; });
    executor.addErrorHook(() => { order.push('error-1'); });
    executor.addErrorHook(() => { order.push('error-2'); });

    await expect(executor.execute('test', {}, ctx, async () => {
      order.push('handler');
      throw new Error('fail');
    })).rejects.toThrow();

    expect(order).toEqual(['pre', 'handler', 'error-1', 'error-2']);
  });
});

// ─── Hook management ──────────────────────────────────────────────────

describe('ToolExecutor — hook management', () => {
  it('should add and count hooks', () => {
    const executor = new ToolExecutor();

    expect(executor.getHookCounts()).toEqual({ pre: 0, post: 0, error: 0 });

    executor.addPreHook(() => ({}));
    executor.addPreHook(() => ({}));
    executor.addPostHook(() => {});
    executor.addErrorHook(() => {});

    expect(executor.getHookCounts()).toEqual({ pre: 2, post: 1, error: 1 });
  });

  it('should clear all hooks', () => {
    const executor = new ToolExecutor();
    executor.addPreHook(() => ({}));
    executor.addPostHook(() => {});
    executor.addErrorHook(() => {});

    executor.clearHooks();
    expect(executor.getHookCounts()).toEqual({ pre: 0, post: 0, error: 0 });
  });

  it('should clear specific hook types', () => {
    const executor = new ToolExecutor();
    executor.addPreHook(() => ({}));
    executor.addPostHook(() => {});
    executor.addErrorHook(() => {});

    executor.clearHooks('pre');
    expect(executor.getHookCounts()).toEqual({ pre: 0, post: 1, error: 1 });

    executor.clearHooks('error');
    expect(executor.getHookCounts()).toEqual({ pre: 0, post: 1, error: 0 });

    executor.clearHooks('post');
    expect(executor.getHookCounts()).toEqual({ pre: 0, post: 0, error: 0 });
  });
});

// ─── ToolDeniedError ─────────────────────────────────────────────────

describe('ToolDeniedError', () => {
  it('should have correct properties', () => {
    const err = new ToolDeniedError('secret_tool', 'insufficient permissions');
    expect(err.name).toBe('ToolDeniedError');
    expect(err.toolName).toBe('secret_tool');
    expect(err.reason).toBe('insufficient permissions');
    expect(err.message).toContain('secret_tool');
    expect(err.message).toContain('insufficient permissions');
  });

  it('should be instanceof Error', () => {
    const err = new ToolDeniedError('t', 'r');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ToolDeniedError);
  });
});
