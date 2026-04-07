/**
 * Logging Middleware — Request/response logging via MW-001 pipeline (MW-003)
 *
 * Provides structured logging for all tool calls through the middleware pipeline.
 * Logs tool name, input (truncated), output (truncated), duration, sessionId,
 * userId, and error information. Configurable verbosity controls log detail level.
 *
 * Architecture:
 *   ToolExecutor → MiddlewarePipeline → [LoggingMiddleware] → handler
 *                                         ↓
 *                                   structured log lines
 *
 * Verbosity levels:
 *   - 'none': no logging (middleware is a no-op)
 *   - 'minimal': log tool name + duration only
 *   - 'standard': log tool name, sessionId, duration, success/error
 *   - 'verbose': log full input/output (truncated to maxLength)
 *   - 'debug': log everything + timing breakdown
 *
 * Log format (structured JSON via Pino):
 *   {
 *     level: 'info' | 'warn' | 'error',
 *     toolName: string,
 *     sessionId: string,
 *     userId?: string,
 *     durationMs: number,
 *     input: { ... },      // verbose/debug only, truncated
 *     output: { ... },     // verbose/debug only, truncated
 *     error?: { message, stack },  // on errors
 *     shortCircuited: boolean      // if middleware short-circuited
 *   }
 *
 * Usage:
 *   const logging = new LoggingMiddleware({ verbosity: 'standard' });
 *   executor.use(logging);
 *
 *   // Or via AppContainer:
 *   app.init(); // auto-registers if configured
 */

import type { ToolMiddleware, MiddlewareContext } from './middleware.js';
import { childLogger } from './logger.js';

const log = childLogger('tool-logger');

// ─── Verbosity ───────────────────────────────────────────────────────

/** Log verbosity levels. */
export type LogVerbosity = 'none' | 'minimal' | 'standard' | 'verbose' | 'debug';

// ─── Options ─────────────────────────────────────────────────────────

/** Options for LoggingMiddleware. */
export interface LoggingMiddlewareOptions {
  /**
   * Log verbosity level. Default: 'standard'.
   * - 'none': no logging
   * - 'minimal': tool name + duration
   * - 'standard': + sessionId, userId, success/error
   * - 'verbose': + input/output (truncated)
   * - 'debug': + full details
   */
  verbosity?: LogVerbosity;

  /**
   * Maximum length of input/output fields when logged.
   * Values longer than this are truncated with '...[truncated]'.
   * Default: 1024 characters.
   */
  maxLength?: number;

  /**
   * Maximum depth for JSON serialization of input/output.
   * Default: 5.
   */
  maxDepth?: number;

  /**
   * Whether to log denied (short-circuited) calls.
   * Default: true.
   */
  logDenied?: boolean;

  /**
   * Whether to log errors (tool handler threw).
   * Default: true.
   */
  logErrors?: boolean;
}

// ─── LoggingMiddleware ───────────────────────────────────────────────

/**
 * Built-in logging middleware for tool call request/response logging.
 *
 * Implements ToolMiddleware and integrates with the MW-001 pipeline.
 * Logs structured data via Pino child logger for each tool invocation.
 */
export class LoggingMiddleware implements ToolMiddleware {
  readonly name = 'logging';

  private readonly verbosity: LogVerbosity;
  private readonly maxLength: number;
  private readonly maxDepth: number;
  private readonly logDenied: boolean;
  private readonly logErrors: boolean;

  constructor(options?: LoggingMiddlewareOptions) {
    this.verbosity = options?.verbosity ?? 'standard';
    this.maxLength = options?.maxLength ?? 1024;
    this.maxDepth = options?.maxDepth ?? 5;
    this.logDenied = options?.logDenied ?? true;
    this.logErrors = options?.logErrors ?? true;
  }

  /**
   * Post-execution hook: log successful tool calls.
   * Called in reverse middleware order, so this runs after all other middleware.
   */
  after(ctx: MiddlewareContext, result: unknown): unknown {
    if (this.verbosity === 'none') return result;

    const data: Record<string, unknown> = {};

    if (this.verbosity === 'minimal') {
      data.toolName = ctx.toolName;
      data.durationMs = ctx.durationMs;
      log.info(data, 'tool called');
      return result;
    }

    // standard + verbose + debug
    data.toolName = ctx.toolName;
    data.sessionId = ctx.context.sessionId;
    data.durationMs = ctx.durationMs;

    if (ctx.context.userId) {
      data.userId = ctx.context.userId;
    }

    data.shortCircuited = ctx.shortCircuited;

    if (this.verbosity === 'verbose' || this.verbosity === 'debug') {
      data.input = this.truncate(ctx.input);
      data.output = this.truncate(result);
    }

    if (this.verbosity === 'debug') {
      data.roles = ctx.context.roles;
      data.remote = ctx.context.remote;
      data.timestamp = ctx.startTime;
    }

    log.info(data, `tool ${ctx.toolName}`);
    return result;
  }

  /**
   * Error handler: log tool call errors.
   * Called in reverse middleware order when handler throws.
   */
  onError(ctx: MiddlewareContext, error: unknown): unknown {
    if (this.verbosity === 'none' || !this.logErrors) {
      throw error; // don't swallow
    }

    const data: Record<string, unknown> = {
      toolName: ctx.toolName,
      sessionId: ctx.context.sessionId,
      durationMs: ctx.durationMs,
    };

    if (ctx.context.userId) {
      data.userId = ctx.context.userId;
    }

    // Extract error info safely
    if (error instanceof Error) {
      data.error = { name: error.name, message: error.message };
      if (this.verbosity === 'debug') {
        data.errorStack = error.stack;
      }
    } else {
      data.error = { message: String(error) };
    }

    if (this.verbosity === 'verbose' || this.verbosity === 'debug') {
      data.input = this.truncate(ctx.input);
    }

    if (this.verbosity === 'debug') {
      data.roles = ctx.context.roles;
      data.remote = ctx.context.remote;
    }

    log.error(data, `tool ${ctx.toolName} failed`);

    throw error; // always re-throw — logging middleware doesn't swallow errors
  }

  /**
   * Before hook: log denied calls (when short-circuited by another middleware).
   * This only fires if a BEFORE hook set shortCircuit — denied calls from
   * ToolDeniedError go through onError instead.
   *
   * Note: we don't actually log in before() because we need to know if
   * the call was denied. Denied calls that return normally go through after().
   * Denied calls that throw ToolDeniedError go through onError().
   */
  before(ctx: MiddlewareContext): void | undefined {
    // No-op in before — all logging happens in after/onError
    return undefined;
  }

  /**
   * Get current verbosity level.
   */
  getVerbosity(): LogVerbosity {
    return this.verbosity;
  }

  // ─── Internal ────────────────────────────────────────────────────

  /**
   * Truncate a value for logging.
   * - Strings longer than maxLength are truncated
   * - Objects are serialized with depth limit, then truncated
   * - null/undefined become '(empty)'
   */
  private truncate(value: unknown, depth: number = 0): unknown {
    if (value === null) return '(null)';
    if (value === undefined) return '(undefined)';

    if (typeof value === 'string') {
      if (value.length > this.maxLength) {
        return value.slice(0, this.maxLength) + '...[truncated]';
      }
      return value;
    }

    if (depth >= this.maxDepth) {
      return '[max depth reached]';
    }

    if (typeof value === 'object') {
      try {
        const serialized = this.truncateObject(value, depth);
        const str = JSON.stringify(serialized);
        if (str !== undefined && str.length > this.maxLength) {
          return str.slice(0, this.maxLength) + '...[truncated]';
        }
        return serialized;
      } catch {
        return '[unserializable]';
      }
    }

    // number, boolean, bigint, symbol
    return value;
  }

  /**
   * Recursively truncate an object, respecting maxDepth.
   */
  private truncateObject(obj: object, depth: number): unknown {
    if (Array.isArray(obj)) {
      return obj.map((item) => this.truncate(item, depth + 1));
    }

    if (obj instanceof Error) {
      return { name: obj.name, message: obj.message };
    }

    if (obj instanceof Date) {
      return obj.toISOString();
    }

    if (typeof obj === 'object' && obj !== null) {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(obj)) {
        result[key] = this.truncate(val, depth + 1);
      }
      return result;
    }

    return obj;
  }
}

// ─── Factory ─────────────────────────────────────────────────────────

/**
 * Create a LoggingMiddleware with the given options.
 * Convenience function for quick setup.
 *
 * @example
 *   executor.use(createLoggingMiddleware({ verbosity: 'verbose' }));
 */
export function createLoggingMiddleware(options?: LoggingMiddlewareOptions): LoggingMiddleware {
  return new LoggingMiddleware(options);
}
