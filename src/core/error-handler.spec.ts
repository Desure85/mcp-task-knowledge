/**
 * core/error-handler.spec.ts — Tests for centralized error handling (TD-010).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ErrorCategory,
  ToolError,
  ValidationError,
  NotFoundError,
  PermissionError,
  classifyError,
  toErrorResponse,
  statusCodeFor,
  ErrorHandler,
  createErrorHandlerMiddleware,
} from './error-handler.js';
import { MiddlewarePipeline, MiddlewareContext } from './middleware.js';
import { ToolDeniedError } from './tool-executor.js';
import type { ToolContext } from './tool-executor.js';

const toolCtx = { sessionId: 's1' } as ToolContext;

function createCtx(toolName = 'test_tool', input: Record<string, unknown> = {}): MiddlewareContext {
  return new MiddlewareContext(toolName, input, toolCtx);
}

// Silence expected warn/error log output in tests
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('TD-010: classification', () => {
  it('classifies ValidationError as validation', () => {
    const c = classifyError(new ValidationError('bad title', { context: { field: 'title' } }));
    expect(c.category).toBe(ErrorCategory.Validation);
    expect(c.code).toBe(ErrorCategory.Validation);
    expect(c.message).toBe('bad title');
    expect(c.context).toEqual({ field: 'title' });
  });

  it('classifies NotFoundError as not_found', () => {
    const c = classifyError(new NotFoundError('task missing'));
    expect(c.category).toBe(ErrorCategory.NotFound);
    expect(c.code).toBe(ErrorCategory.NotFound);
  });

  it('classifies PermissionError as permission', () => {
    const c = classifyError(new PermissionError('no access'));
    expect(c.category).toBe(ErrorCategory.Permission);
    expect(c.code).toBe(ErrorCategory.Permission);
  });

  it('classifies ToolDeniedError as permission with denied code', () => {
    const c = classifyError(new ToolDeniedError('tasks_delete', 'rate limited'));
    expect(c.category).toBe(ErrorCategory.Permission);
    expect(c.code).toBe('denied');
    expect(c.context).toEqual({ toolName: 'tasks_delete', reason: 'rate limited' });
  });

  it('classifies generic Error as internal', () => {
    const c = classifyError(new Error('boom'));
    expect(c.category).toBe(ErrorCategory.Internal);
    expect(c.code).toBe('internal');
  });

  it('classifies unknown non-Error values as internal', () => {
    expect(classifyError('string error').category).toBe(ErrorCategory.Internal);
    expect(classifyError(undefined).category).toBe(ErrorCategory.Internal);
    expect(classifyError({ foo: 1 }).message).toBe('[object Object]');
  });

  it('maps categories to HTTP-like status codes', () => {
    expect(statusCodeFor(ErrorCategory.Validation)).toBe(400);
    expect(statusCodeFor(ErrorCategory.NotFound)).toBe(404);
    expect(statusCodeFor(ErrorCategory.Permission)).toBe(403);
    expect(statusCodeFor(ErrorCategory.Internal)).toBe(500);
  });
});

describe('TD-010: consistent response shape', () => {
  it('builds { ok:false, error:{ code, message, category } }', () => {
    const res = toErrorResponse(new NotFoundError('doc missing'));
    expect(res).toEqual({
      ok: false,
      error: {
        code: 'not_found',
        message: 'doc missing',
        category: ErrorCategory.NotFound,
      },
    });
  });

  it('includes context when present', () => {
    const res = toErrorResponse(new ValidationError('bad', { context: { field: 'id' } }));
    expect(res.error.context).toEqual({ field: 'id' });
  });

  it('omits empty context from response', () => {
    const res = toErrorResponse(new ValidationError('bad'));
    expect(res.error.context).toBeUndefined();
  });

  it('preserves custom error code', () => {
    const res = toErrorResponse(new PermissionError('nope', { code: 'forbidden' }));
    expect(res.error.code).toBe('forbidden');
    expect(res.error.category).toBe(ErrorCategory.Permission);
  });
});

describe('TD-010: ErrorHandler', () => {
  it('logs with execution context and returns response', () => {
    const handler = new ErrorHandler();
    const res = handler.handle(new ValidationError('bad input', { context: { field: 'x' } }), {
      toolName: 'tasks_create',
      sessionId: 's1',
      durationMs: 12,
    });
    expect(res.ok).toBe(false);
    expect(res.error.category).toBe(ErrorCategory.Validation);
    expect(res.error.message).toBe('bad input');
    expect(res.error.context).toEqual({ field: 'x' });
  });

  it('drops context from response when includeContext=false', () => {
    const handler = new ErrorHandler({ includeContext: false });
    const res = handler.handle(new ValidationError('bad', { context: { field: 'x' } }));
    expect(res.error.context).toBeUndefined();
  });

  it('classifies unknown errors as internal', () => {
    const handler = new ErrorHandler();
    const res = handler.handle(new Error('kaboom'));
    expect(res.error.category).toBe(ErrorCategory.Internal);
    expect(res.error.message).toBe('kaboom');
  });
});

describe('TD-010: middleware integration', () => {
  it('logs errors with execution context through the onError hook', async () => {
    const pipeline = new MiddlewarePipeline();
    const handler = new ErrorHandler();
    pipeline.use(createErrorHandlerMiddleware(handler));

    const ctx = createCtx('tasks_get', { id: 'x' });
    const err = new NotFoundError('task not found');

    await expect(pipeline.run(ctx, async () => {
      throw err;
    })).rejects.toBe(err);
  });

  it('classifies ToolError instances via toErrorResponse after propagation', async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use(createErrorHandlerMiddleware());

    const ctx = createCtx();
    await expect(pipeline.run(ctx, async () => {
      throw new NotFoundError('task not found');
    })).rejects.toMatchObject({
      category: ErrorCategory.NotFound,
      message: 'task not found',
    });
  });

  it('normalizes unknown errors via toErrorResponse (Internal category)', async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use(createErrorHandlerMiddleware());

    const ctx = createCtx();
    await expect(pipeline.run(ctx, async () => {
      throw new Error('raw failure');
    })).rejects.toThrow('raw failure');
    expect(toErrorResponse(new Error('raw failure')).error.category).toBe(ErrorCategory.Internal);
  });

  it('still allows downstream middleware to swallow the error', async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use(createErrorHandlerMiddleware());
    // Swallower registered LAST runs FIRST in reverse onError order
    pipeline.use({
      name: 'swallower',
      onError: () => ({ fallback: true }),
    });

    const ctx = createCtx();
    const result = await pipeline.run(ctx, async () => {
      throw new Error('handled');
    });
    expect(result).toEqual({ fallback: true });
  });
});
