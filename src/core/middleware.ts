/**
 * Middleware Pipeline — Chain of pre/post interceptors for tool calls (MW-001)
 *
 * Provides a composable middleware system that wraps tool execution.
 * Each middleware can inspect/modify the call before and after the handler,
 * handle errors, or short-circuit the execution entirely.
 *
 * Architecture:
 *   Client → Transport → McpServer → ToolExecutor → MiddlewarePipeline → tool handler
 *                                              ↓
 *                                          MiddlewareChain:
 *                                            mw1.before → mw2.before → handler
 *                                            mw2.after ← mw1.after ← result
 *                                            (or: mw.onError on failure)
 *
 * Middleware execution model:
 *   - `before(ctx)`: called in order. Can modify ctx.input or set ctx.shortCircuit.
 *     If a middleware calls ctx.shortCircuit(result), remaining before hooks
 *     are skipped and the result goes through after hooks in reverse.
 *   - `after(ctx, result)`: called in reverse order after successful execution.
 *     Can replace the result by returning a new value.
 *   - `onError(ctx, error)`: called in reverse order when handler throws.
 *     Can swallow the error by returning a fallback result,
 *     or re-throw to let the next middleware / caller handle it.
 *
 * Integration with ToolExecutor:
 *   MiddlewarePipeline bridges to the existing pre/post/error hook system.
 *   When middleware are registered, they are translated into hooks that
 *   use the pipeline's execution model. This ensures backward compatibility.
 *
 * Design principles:
 *   - Composable: middleware can be added/removed at runtime
 *   - Ordered: execution order is deterministic (registration order)
 *   - Safe: middleware errors don't crash the pipeline (logged, skipped)
 *   - Observable: all middleware invocations are logged at debug level
 */

import type { ToolContext } from './tool-executor.js';
import { childLogger } from './logger.js';
import { ToolDeniedError } from './tool-executor.js';

const log = childLogger('middleware');

// ─── MiddlewareContext ────────────────────────────────────────────────

/**
 * Mutable context passed through the middleware chain.
 * Extends the immutable ToolContext with request-scoped mutable state.
 */
export class MiddlewareContext {
  /** Immutable session context. */
  readonly context: ToolContext;

  /** Tool name being called. */
  toolName: string;

  /** Tool input — mutable, middleware can modify before handler. */
  input: Record<string, unknown>;

  /** Result of the tool handler — set after execution. */
  result?: unknown;

  /** Error thrown by the handler — set if handler fails. */
  error?: unknown;

  /** Execution start timestamp (ms). */
  readonly startTime: number;

  /** Duration of tool handler execution (ms). Set after handler completes. */
  durationMs: number;

  /** Middleware-specific metadata bag. Shared across all middleware in the chain. */
  readonly mw: Record<string, unknown>;

  /** Whether the chain has been short-circuited. */
  private _shortCircuited = false;
  /** Short-circuit result (if any). */
  private _shortCircuitResult?: unknown;

  constructor(toolName: string, input: Record<string, unknown>, context: ToolContext) {
    this.context = context;
    this.toolName = toolName;
    this.input = input;
    this.startTime = Date.now();
    this.durationMs = 0;
    this.mw = {};
  }

  /** Whether this execution was short-circuited by a middleware. */
  get shortCircuited(): boolean {
    return this._shortCircuited;
  }

  /**
   * Short-circuit the execution: skip remaining middleware and the handler.
   * The given result will be passed through after hooks and returned.
   *
   * @example
   *   mw.before = (ctx) => {
   *     if (!isAuthorized(ctx)) ctx.shortCircuit({ error: 'unauthorized' });
   *   };
   */
  shortCircuit(result?: unknown): void {
    this._shortCircuited = true;
    this._shortCircuitResult = result;
  }

  /** Get the short-circuit result (if set). */
  get shortCircuitResult(): unknown {
    return this._shortCircuitResult;
  }
}

// ─── ToolMiddleware Interface ────────────────────────────────────────

/**
 * Result type for before() hook.
 * Allows both imperative (ctx.shortCircuit) and declarative short-circuit.
 */
export interface BeforeResult {
  /**
   * If true, skip remaining before hooks and the handler.
   * The provided value is used as the result (passed through after hooks).
   */
  shortCircuit?: unknown;
}

/**
 * A middleware interceptor for tool calls.
 *
 * Each middleware implements any combination of:
 *   - `before(ctx)`: inspect/modify input before handler runs
 *   - `after(ctx, result)`: inspect/modify result after handler succeeds
 *   - `onError(ctx, error)`: handle errors from handler or other middleware
 *
 * Middleware can be named for logging/diagnostics. Names must be unique
 * when registered (duplicate names overwrite).
 */
export interface ToolMiddleware {
  /** Middleware name (for logging, diagnostics, removal by name). */
  readonly name: string;

  /**
   * Pre-execution hook. Called in registration order.
   * Can modify ctx.input, call ctx.shortCircuit(), or throw ToolDeniedError.
   *
   * Return value:
   *   - `{ shortCircuit: value }` — skip handler, use value as result
   *   - `{}` or undefined — continue to next middleware / handler
   */
  before?(ctx: MiddlewareContext): BeforeResult | Promise<BeforeResult | undefined> | void | Promise<void>;

  /**
   * Post-execution hook. Called in REVERSE registration order after handler succeeds.
   * Can modify the result by returning a new value.
   *
   * @param ctx — middleware context with result set
   * @param result — the handler's return value (or short-circuit result)
   * @returns the (possibly modified) result to pass to the next after hook
   */
  after?(ctx: MiddlewareContext, result: unknown): unknown | Promise<unknown>;

  /**
   * Error handler. Called in REVERSE registration order when handler throws.
   * Can return a fallback result to swallow the error, or re-throw.
   *
   * @param ctx — middleware context with error set
   * @param error — the thrown error (or ToolDeniedError from short-circuit)
   * @returns fallback result (swallows error) or throws/re-throws
   */
  onError?(ctx: MiddlewareContext, error: unknown): unknown | Promise<unknown>;
}

// ─── MiddlewarePipeline ──────────────────────────────────────────────

/**
 * Manages an ordered chain of middleware for tool call interception.
 *
 * Pipeline execution:
 *   1. Run before() hooks in order
 *      - If any short-circuits: skip handler, go to step 3
 *      - If any throws ToolDeniedError: go to step 4 (onError) then re-throw
 *      - If any throws other error: log, skip that middleware, continue
 *   2. Run tool handler
 *      - If handler throws: set ctx.error, go to step 4
 *   3. Run after() hooks in reverse order, threading result through
 *   4. Return final result (or throw)
 *
 * Thread safety: pipeline is not thread-safe. Middleware should be added
 * before the first execution. Runtime addition/removal is supported but
 * callers must ensure no concurrent executions.
 */
export class MiddlewarePipeline {
  private middleware: ToolMiddleware[] = [];

  /**
   * Add a middleware to the end of the chain.
   * If a middleware with the same name exists, it is replaced.
   *
   * @returns true if the middleware was added, false if it replaced an existing one
   */
  use(middleware: ToolMiddleware): boolean {
    const existing = this.middleware.findIndex((mw) => mw.name === middleware.name);
    if (existing >= 0) {
      this.middleware[existing] = middleware;
      log.debug({ name: middleware.name }, 'middleware replaced');
      return false;
    }
    this.middleware.push(middleware);
    log.debug({ name: middleware.name, pos: this.middleware.length - 1 }, 'middleware added');
    return true;
  }

  /**
   * Remove a middleware by name or reference.
   *
   * @returns true if the middleware was found and removed
   */
  remove(nameOrMiddleware: string | ToolMiddleware): boolean {
    const name = typeof nameOrMiddleware === 'string' ? nameOrMiddleware : nameOrMiddleware.name;
    const idx = this.middleware.findIndex((mw) => mw.name === name);
    if (idx < 0) return false;
    this.middleware.splice(idx, 1);
    log.debug({ name }, 'middleware removed');
    return true;
  }

  /**
   * Get a middleware by name.
   */
  get(name: string): ToolMiddleware | undefined {
    return this.middleware.find((mw) => mw.name === name);
  }

  /**
   * Check if a middleware with the given name is registered.
   */
  has(name: string): boolean {
    return this.middleware.some((mw) => mw.name === name);
  }

  /**
   * Get ordered list of middleware names.
   */
  getNames(): string[] {
    return this.middleware.map((mw) => mw.name);
  }

  /** Number of registered middleware. */
  get size(): number {
    return this.middleware.length;
  }

  /**
   * Remove all middleware.
   */
  clear(): void {
    this.middleware = [];
    log.debug('all middleware removed');
  }

  /**
   * Execute the full middleware pipeline around a tool handler.
   *
   * @param ctx — middleware context (toolName, input, ToolContext)
   * @param handler — the actual tool handler to wrap
   * @returns the handler result (possibly modified by after hooks)
   * @throws ToolDeniedError if a before hook denies execution
   * @throws Error if handler throws and no onError swallows it
   */
  async run(
    ctx: MiddlewareContext,
    handler: () => Promise<unknown>,
  ): Promise<unknown> {
    // ── Phase 1: before hooks (forward order) ──
    for (let i = 0; i < this.middleware.length; i++) {
      const mw = this.middleware[i];
      if (!mw.before) continue;

      try {
        const result = await mw.before(ctx);

        // Declarative short-circuit via return value
        if (result && result.shortCircuit !== undefined) {
          log.debug(
            { middleware: mw.name, toolName: ctx.toolName },
            'middleware short-circuited (declarative)',
          );
          ctx.shortCircuit(result.shortCircuit);
          break;
        }

        // Imperative short-circuit via ctx.shortCircuit()
        if (ctx.shortCircuited) {
          log.debug(
            { middleware: mw.name, toolName: ctx.toolName },
            'middleware short-circuited (imperative)',
          );
          break;
        }
      } catch (err) {
        if (err instanceof ToolDeniedError) {
          // Let denial propagate through error hooks
          ctx.error = err;
          return this.runErrorHooks(ctx, err);
        }
        // Non-denial errors: log and skip this middleware
        log.error(
          { middleware: mw.name, toolName: ctx.toolName, err },
          'middleware before() error (skipping)',
        );
      }
    }

    // ── Phase 2: handler (skip if short-circuited) ──
    if (!ctx.shortCircuited) {
      try {
        ctx.result = await handler();
      } catch (err) {
        ctx.error = err;
        return this.runErrorHooks(ctx, err);
      }
    } else {
      ctx.result = ctx.shortCircuitResult;
    }

    ctx.durationMs = Date.now() - ctx.startTime;

    // ── Phase 3: after hooks (reverse order) ──
    return this.runAfterHooks(ctx);
  }

  /**
   * Run after() hooks in reverse order, threading result through.
   * Each hook receives the current result and can return a modified version.
   */
  private async runAfterHooks(ctx: MiddlewareContext): Promise<unknown> {
    let currentResult = ctx.result;

    for (let i = this.middleware.length - 1; i >= 0; i--) {
      const mw = this.middleware[i];
      if (!mw.after) continue;

      try {
        currentResult = await mw.after(ctx, currentResult);
      } catch (err) {
        log.error(
          { middleware: mw.name, toolName: ctx.toolName, err },
          'middleware after() error (skipping)',
        );
      }
    }

    return currentResult;
  }

  /**
   * Run onError() hooks in reverse order.
   * If any hook returns a value, the error is swallowed and that value is used.
   * Otherwise, the original error is re-thrown.
   */
  private async runErrorHooks(ctx: MiddlewareContext, originalError: unknown): Promise<never> {
    let fallbackResult: unknown = undefined;
    let swallowed = false;

    for (let i = this.middleware.length - 1; i >= 0; i--) {
      const mw = this.middleware[i];
      if (!mw.onError) continue;

      try {
        const result = await mw.onError(ctx, originalError);
        if (result !== undefined) {
          fallbackResult = result;
          swallowed = true;
          log.debug(
            { middleware: mw.name, toolName: ctx.toolName },
            'middleware onError swallowed error',
          );
          break; // first swallower wins
        }
      } catch (err) {
        log.error(
          { middleware: mw.name, toolName: ctx.toolName, err },
          'middleware onError() error (skipping)',
        );
      }
    }

    if (swallowed) {
      ctx.result = fallbackResult;
      ctx.error = undefined;
      ctx.durationMs = Date.now() - ctx.startTime;
      // Run after hooks with the fallback result
      return this.runAfterHooks(ctx) as never;
    }

    // No middleware swallowed — re-throw original
    if (originalError instanceof Error) throw originalError;
    throw new Error(String(originalError));
  }
}
