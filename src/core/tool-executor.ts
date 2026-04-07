/**
 * ToolContext & ToolExecutor — Per-session tool execution context (S-002)
 *
 * ToolContext provides per-session metadata that is available during every
 * tool invocation. In single-client (stdio) mode, it wraps the global
 * ServerContext. In multi-client mode (TCP/HTTP), each session gets its own
 * ToolContext with session-specific data (sessionId, userId, ACL, rate limits).
 *
 * ToolExecutor is the central execution point for all tool calls:
 *   - Wraps the actual tool handler with pre/post hooks
 *   - Injects ToolContext into every call
 *   - Provides metrics and error handling
 *   - Foundation for middleware (MW-001), ACL (ACL-001), rate limiting (S-003)
 *
 * Architecture:
 *   Client → Transport → McpServer → ToolExecutor.execute() → tool handler
 *                                              ↓
 *                                        ToolContext (session-scoped)
 *
 * ToolContext carries:
 *   - sessionId: string — unique session identifier
 *   - userId?: string — authenticated user (from A-001)
 *   - roles?: string[] — user roles (from ACL-001)
 *   - remote: string — client address
 *   - createdAt: number — session start timestamp
 *   - metadata: Record<string, unknown> — extensible per-session data
 *   - ServerContext: shared server state (tools, config, registries)
 */

import type { ServerContext } from '../register/context.js';
import { childLogger } from './logger.js';
import { MiddlewarePipeline } from './middleware.js';
import type { ToolMiddleware, MiddlewareContext } from './middleware.js';

const log = childLogger('tool-executor');

// ─── ToolContext ──────────────────────────────────────────────────────

/**
 * Per-session context available during tool execution.
 * Extends the shared ServerContext with session-specific metadata.
 */
export interface ToolContext {
  /** Session identifier (from SessionManager). */
  sessionId: string;
  /** Authenticated user ID (from A-001 auth, undefined for unauthenticated). */
  userId?: string;
  /** User roles (from ACL-001, empty array for unrestricted). */
  roles: string[];
  /** Client remote address. */
  remote: string;
  /** Session creation timestamp (ms). */
  createdAt: number;
  /** Extensible per-session metadata. */
  metadata: Record<string, unknown>;
  /** Shared server context (tools, config, registries). */
  server: ServerContext;
}

/**
 * Options for creating a ToolContext.
 */
export interface ToolContextOptions {
  sessionId: string;
  remote: string;
  server: ServerContext;
  userId?: string;
  roles?: string[];
  metadata?: Record<string, unknown>;
  createdAt?: number;
}

/**
 * Create a new ToolContext for a session.
 */
export function createToolContext(opts: ToolContextOptions): ToolContext {
  return {
    sessionId: opts.sessionId,
    remote: opts.remote,
    server: opts.server,
    userId: opts.userId,
    roles: opts.roles ?? [],
    createdAt: opts.createdAt ?? Date.now(),
    metadata: opts.metadata ?? {},
  };
}

// ─── Tool handler types ──────────────────────────────────────────────

/** A tool handler function that receives the ToolContext. */
export type ContextAwareToolHandler<TInput = Record<string, unknown>, TOutput = unknown> = (
  input: TInput,
  context: ToolContext,
) => Promise<TOutput>;

/** Original MCP tool handler (no context awareness). */
export type RawToolHandler<TInput = Record<string, unknown>, TOutput = unknown> = (
  input: TInput,
) => Promise<TOutput>;

// ─── Pre/Post hooks ──────────────────────────────────────────────────

/**
 * Result of a pre-execution hook.
 * If `deny` is set, the tool call is rejected with the given reason.
 */
export interface PreHookResult {
  /** If true, deny the tool execution. */
  deny?: boolean;
  /** Reason for denial (used in error response). */
  reason?: string;
}

/**
 * Pre-execution hook: called before the tool handler.
 * Can deny execution (e.g. ACL check, rate limit).
 */
export type PreToolHook = (
  toolName: string,
  input: Record<string, unknown>,
  context: ToolContext,
) => PreHookResult | Promise<PreHookResult>;

/**
 * Post-execution hook: called after the tool handler.
 * Can modify the result or log metrics.
 */
export type PostToolHook = (
  toolName: string,
  input: Record<string, unknown>,
  result: unknown,
  context: ToolContext,
  durationMs: number,
) => void | Promise<void>;

/**
 * Error hook: called when a tool handler throws.
 */
export type ErrorToolHook = (
  toolName: string,
  input: Record<string, unknown>,
  error: unknown,
  context: ToolContext,
  durationMs: number,
) => void | Promise<void>;

// ─── ToolExecutor ────────────────────────────────────────────────────

/**
 * Central execution point for tool calls.
 *
 * Wraps tool handlers with:
 *   - ToolContext injection
 *   - Pre-execution hooks (ACL, rate limiting)
 *   - Post-execution hooks (logging, metrics)
 *   - Error hooks (error handling, reporting)
 *   - Timing/metrics
 *
 * Usage:
 *   const executor = new ToolExecutor();
 *   executor.addPreHook(myAclHook);
 *   executor.addPostHook(myMetricsHook);
 *
 *   // Execute a tool with context
 *   const result = await executor.execute('tasks_list', { project: 'default' }, toolContext, rawHandler);
 */
export class ToolExecutor {
  private preHooks: PreToolHook[] = [];
  private postHooks: PostToolHook[] = [];
  private errorHooks: ErrorToolHook[] = [];
  private pipeline = new MiddlewarePipeline();

  /**
   * Add a pre-execution hook.
   * Hooks are called in registration order. If any hook denies, execution stops.
   */
  addPreHook(hook: PreToolHook): void {
    this.preHooks.push(hook);
  }

  /**
   * Add a post-execution hook.
   * Hooks are called in registration order after successful execution.
   */
  addPostHook(hook: PostToolHook): void {
    this.postHooks.push(hook);
  }

  /**
   * Add an error hook.
   * Hooks are called in registration order when a handler throws.
   */
  addErrorHook(hook: ErrorToolHook): void {
    this.errorHooks.push(hook);
  }

  /**
   * Register a middleware in the execution pipeline (MW-001).
   * Middleware run BEFORE legacy hooks. If any middleware short-circuits,
   * the result goes through after hooks then returns — legacy hooks are skipped.
   *
   * @returns true if added, false if replaced existing middleware with same name
   */
  use(middleware: ToolMiddleware): boolean {
    return this.pipeline.use(middleware);
  }

  /**
   * Remove a middleware by name or reference.
   */
  removeMiddleware(nameOrMiddleware: string | ToolMiddleware): boolean {
    return this.pipeline.remove(nameOrMiddleware);
  }

  /**
   * Get the middleware pipeline (for advanced configuration).
   */
  getPipeline(): MiddlewarePipeline {
    return this.pipeline;
  }

  /**
   * Remove all hooks of a given type.
   * Does NOT affect middleware — use clearMiddleware() or pipeline.clear().
   */
  clearHooks(type?: 'pre' | 'post' | 'error'): void {
    if (!type || type === 'pre') this.preHooks = [];
    if (!type || type === 'post') this.postHooks = [];
    if (!type || type === 'error') this.errorHooks = [];
  }

  /**
   * Clear all middleware from the pipeline.
   */
  clearMiddleware(): void {
    this.pipeline.clear();
  }

  /**
   * Get hook counts for diagnostics.
   */
  getHookCounts(): { pre: number; post: number; error: number; middleware: number } {
    return {
      pre: this.preHooks.length,
      post: this.postHooks.length,
      error: this.errorHooks.length,
      middleware: this.pipeline.size,
    };
  }

  /**
   * Execute a tool call with full middleware + hook pipeline.
   *
   * Pipeline (outer to inner):
   *   1. Middleware before() — forward order, can short-circuit
   *   2. Legacy pre-hooks → abort if any deny
   *   3. Call tool handler with ToolContext
   *   4. Legacy post-hooks with result
   *   5. Middleware after() — reverse order, can modify result
   *
   * On error:
   *   1. Middleware onError() — can swallow or re-throw
   *   2. Legacy error hooks (if not swallowed)
   *   3. Re-throw the error
   *
   * @param toolName — name of the tool being called
   * @param input — parsed input parameters
   * @param context — per-session ToolContext
   * @param handler — the actual tool handler (context-aware or raw)
   */
  async execute<TInput = Record<string, unknown>, TOutput = unknown>(
    toolName: string,
    input: TInput,
    context: ToolContext,
    handler: ContextAwareToolHandler<TInput, TOutput> | RawToolHandler<TInput, TOutput>,
  ): Promise<TOutput> {
    // ── Phase 1: Middleware pipeline (outer layer) ──
    if (this.pipeline.size > 0) {
      const mwCtx = new (await import('./middleware.js')).MiddlewareContext(
        toolName,
        input as Record<string, unknown>,
        context,
      );

      return this.pipeline.run(mwCtx, () => this.runWithHooks(toolName, mwCtx.input, context, handler)) as Promise<TOutput>;
    }

    // ── No middleware: run hooks + handler directly ──
    return this.runWithHooks(toolName, input as Record<string, unknown>, context, handler) as Promise<TOutput>;
  }

  /**
   * Internal: run legacy hooks + handler (without middleware).
   */
  private async runWithHooks<TInput, TOutput>(
    toolName: string,
    input: Record<string, unknown>,
    context: ToolContext,
    handler: ContextAwareToolHandler<TInput, TOutput> | RawToolHandler<TInput, TOutput>,
  ): Promise<TOutput> {
    const start = Date.now();

    // 1. Pre-hooks
    for (const hook of this.preHooks) {
      try {
        const result = await hook(toolName, input, context);
        if (result.deny) {
          log.warn({ toolName, sessionId: context.sessionId, reason: result.reason }, 'tool call denied by pre-hook');
          throw new ToolDeniedError(toolName, result.reason ?? 'denied by policy');
        }
      } catch (err) {
        if (err instanceof ToolDeniedError) throw err;
        // Hook error: log but don't block execution
        log.error({ toolName, sessionId: context.sessionId, err }, 'pre-hook error');
      }
    }

    // 2. Execute handler
    let result: TOutput;
    try {
      if (this.isContextAware(handler)) {
        result = await handler(input as TInput, context);
      } else {
        // Raw handler: call without context (backward compat)
        result = await (handler as RawToolHandler<TInput, TOutput>)(input as TInput);
      }
    } catch (err) {
      const duration = Date.now() - start;

      // 3. Error hooks
      for (const hook of this.errorHooks) {
        try {
          await hook(toolName, input, err, context, duration);
        } catch (hookErr) {
          log.error({ toolName, sessionId: context.sessionId, err: hookErr }, 'error-hook error');
        }
      }

      throw err;
    }

    // 4. Post-hooks
    const duration = Date.now() - start;
    for (const hook of this.postHooks) {
      try {
        await hook(toolName, input, result, context, duration);
      } catch (hookErr) {
        log.error({ toolName, sessionId: context.sessionId, err: hookErr }, 'post-hook error');
      }
    }

    return result;
  }

  /**
   * Type guard: check if a handler is context-aware (2 params) or raw (1 param).
   * Context-aware handlers receive ToolContext as the second argument.
   */
  private isContextAware<TInput, TOutput>(
    handler: ContextAwareToolHandler<TInput, TOutput> | RawToolHandler<TInput, TOutput>,
  ): handler is ContextAwareToolHandler<TInput, TOutput> {
    return handler.length >= 2;
  }
}

// ─── Errors ──────────────────────────────────────────────────────────

/**
 * Thrown when a pre-hook denies tool execution.
 * Used by ACL (ACL-001), rate limiting (S-003), and other policy hooks.
 */
export class ToolDeniedError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly reason: string,
  ) {
    super(`tool "${toolName}" denied: ${reason}`);
    this.name = 'ToolDeniedError';
  }
}
