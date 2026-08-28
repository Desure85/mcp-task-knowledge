/**
 * Centralized error handling for tool calls (TD-010)
 *
 * Every tool error flows through one classifier so clients get a stable,
 * machine-readable error envelope and operators get structured log context.
 *
 * Design:
 *   - ToolError carries category + optional code/context; concrete helpers
 *     (ValidationError / NotFoundError / PermissionError) cover the common
 *     cases, unknown errors are classified as Internal.
 *   - classifyError() maps ANY thrown value to a category — defensive for
 *     non-Error throws (strings, objects) that slip through handlers.
 *   - toErrorResponse() produces the client-facing envelope:
 *     { ok:false, error:{ code, message, category, context? } }.
 *   - ErrorHandlerMiddleware bridges to the middleware onError hook so the
 *     classification happens automatically for every tool call.
 */

import { childLogger } from './logger.js';
import type { ToolMiddleware, MiddlewareContext } from './middleware.js';
import { ToolDeniedError } from './tool-executor.js';

const log = childLogger('error-handler');

// ─── Error category ─────────────────────────────────────────────────

/** Stable classification of tool errors. Maps to HTTP-like semantics. */
export enum ErrorCategory {
  /** Client sent invalid input (zod failure, bad param). */
  Validation = 'validation',
  /** Requested entity does not exist. */
  NotFound = 'not_found',
  /** Caller lacks rights / operation denied by policy. */
  Permission = 'permission',
  /** Everything else — unexpected runtime failure. */
  Internal = 'internal',
}

// ─── Error response shape ───────────────────────────────────────────

/**
 * Machine-readable error context attached to a ToolError.
 * Carried verbatim into the error response and log output.
 */
export interface ToolErrorContext {
  /** Free-form detail, e.g. { field: 'title', reason: 'required' }. */
  [key: string]: unknown;
}

/**
 * Client-facing error envelope produced by toErrorResponse().
 * Shape: { ok:false, error:{ code, message, category, context? } }.
 */
export interface ErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
    category: ErrorCategory;
    context?: ToolErrorContext;
  };
}

// ─── ToolError ──────────────────────────────────────────────────────

/**
 * Base class for all classified tool errors.
 * `code` is the stable machine-readable identifier (defaults to category).
 */
export class ToolError extends Error {
  readonly category: ErrorCategory;
  readonly code: string;
  readonly context?: ToolErrorContext;
  /** HTTP-like status for transport mapping (400/404/403/500). */
  readonly statusCode: number;

  constructor(
    message: string,
    category: ErrorCategory,
    options: { code?: string; context?: ToolErrorContext } = {},
  ) {
    super(message);
    this.name = 'ToolError';
    this.category = category;
    this.code = options.code ?? category;
    this.context = options.context;
    this.statusCode = statusCodeFor(category);
  }
}

/** Helper: client sent invalid input. */
export class ValidationError extends ToolError {
  constructor(message: string, options: { code?: string; context?: ToolErrorContext } = {}) {
    super(message, ErrorCategory.Validation, options);
    this.name = 'ValidationError';
  }
}

/** Helper: requested entity does not exist. */
export class NotFoundError extends ToolError {
  constructor(message: string, options: { code?: string; context?: ToolErrorContext } = {}) {
    super(message, ErrorCategory.NotFound, options);
    this.name = 'NotFoundError';
  }
}

/** Helper: operation denied by policy / caller lacks rights. */
export class PermissionError extends ToolError {
  constructor(message: string, options: { code?: string; context?: ToolErrorContext } = {}) {
    super(message, ErrorCategory.Permission, options);
    this.name = 'PermissionError';
  }
}

/** Map a category to its HTTP-like status code. */
export function statusCodeFor(category: ErrorCategory): number {
  switch (category) {
    case ErrorCategory.Validation:
      return 400;
    case ErrorCategory.NotFound:
      return 404;
    case ErrorCategory.Permission:
      return 403;
    case ErrorCategory.Internal:
      return 500;
  }
}

// ─── Classification ─────────────────────────────────────────────────

/** Result of classifying a thrown value. */
export interface Classification {
  category: ErrorCategory;
  code: string;
  message: string;
  context?: ToolErrorContext;
}

/**
 * Classify ANY thrown value into a stable category.
 * Non-Error throws (strings, objects) are normalized to Internal.
 */
export function classifyError(err: unknown): Classification {
  if (err instanceof ToolError) {
    return {
      category: err.category,
      code: err.code,
      message: err.message,
      context: err.context,
    };
  }

  // Denials from policy hooks (ACL, rate limit) are permission failures
  if (err instanceof ToolDeniedError) {
    return {
      category: ErrorCategory.Permission,
      code: 'denied',
      message: err.message,
      context: { toolName: err.toolName, reason: err.reason },
    };
  }

  // Any other Error — internal, but keep the original message for operators
  if (err instanceof Error) {
    return {
      category: ErrorCategory.Internal,
      code: 'internal',
      message: err.message || 'Internal error',
    };
  }

  return {
    category: ErrorCategory.Internal,
    code: 'internal',
    message: String(err),
  };
}

// ─── Response building ──────────────────────────────────────────────

/** Build the client-facing error envelope for a thrown value. */
export function toErrorResponse(err: unknown): ErrorResponse {
  const { category, code, message, context } = classifyError(err);
  const error: ErrorResponse['error'] = { code, message, category };
  if (context && Object.keys(context).length > 0) {
    error.context = context;
  }
  return { ok: false, error };
}

// ─── ErrorHandler ───────────────────────────────────────────────────

/** Options controlling ErrorHandler behavior. */
export interface ErrorHandlerOptions {
  /** Include error context in the returned response (default: true). */
  includeContext?: boolean;
  /** Log stack traces for Internal errors (default: true). */
  logStackTraces?: boolean;
}

/**
 * Classifies thrown errors, builds consistent responses and logs
 * with execution context (toolName, sessionId, durationMs).
 */
export class ErrorHandler {
  private readonly includeContext: boolean;
  private readonly logStackTraces: boolean;

  constructor(options: ErrorHandlerOptions = {}) {
    this.includeContext = options.includeContext ?? true;
    this.logStackTraces = options.logStackTraces ?? true;
  }

  /**
   * Build a consistent error response for a thrown value.
   * Same as toErrorResponse() but honors includeContext and logs the failure.
   *
   * @param err — the thrown value
   * @param meta — execution context for logging
   */
  handle(err: unknown, meta: ErrorHandlerMeta = {}): ErrorResponse {
    const { category, code, message, context } = classifyError(err);

    // Structured log line with execution context (no stack for client errors)
    const logFields: Record<string, unknown> = {
      code,
      category,
      ...meta,
    };
    if (context && this.includeContext) {
      logFields.context = context;
    }
    if (this.logStackTraces && err instanceof Error && category === ErrorCategory.Internal) {
      logFields.err = err;
    }
    log[category === ErrorCategory.Internal ? 'error' : 'warn'](logFields, message);

    const error: ErrorResponse['error'] = { code, message, category };
    if (this.includeContext && context && Object.keys(context).length > 0) {
      error.context = context;
    }
    return { ok: false, error };
  }
}

/** Execution context attached to error logs. */
export interface ErrorHandlerMeta {
  toolName?: string;
  input?: Record<string, unknown>;
  sessionId?: string;
  durationMs?: number;
}

// ─── Middleware integration ─────────────────────────────────────────

/**
 * Middleware that logs every tool error with classification + execution
 * context automatically (TD-010).
 *
 * Pipeline contract (MiddlewarePipeline.runErrorHooks): an onError hook can
 * either swallow the error (return a fallback value) or let it propagate
 * (return undefined — the pipeline re-throws the ORIGINAL error). Throwing
 * from onError is caught and logged as a hook error, so error normalization
 * happens at response build time via ErrorHandler/toErrorResponse, not here.
 */
export function createErrorHandlerMiddleware(
  handler: ErrorHandler = new ErrorHandler(),
): ToolMiddleware {
  return {
    name: 'error-handler',
    onError(ctx: MiddlewareContext, error: unknown): unknown {
      const meta: ErrorHandlerMeta = {
        toolName: ctx.toolName,
        input: ctx.input,
        sessionId: ctx.context?.sessionId,
        durationMs: ctx.durationMs || Date.now() - ctx.startTime,
      };
      handler.handle(error, meta);
      return undefined;
    },
  };
}
