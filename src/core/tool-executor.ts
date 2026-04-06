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
   * Remove all hooks of a given type.
   */
  clearHooks(type?: 'pre' | 'post' | 'error'): void {
    if (!type || type === 'pre') this.preHooks = [];
    if (!type || type === 'post') this.postHooks = [];
    if (!type || type === 'error') this.errorHooks = [];
  }

  /**
   * Get hook counts for diagnostics.
   */
  getHookCounts(): { pre: number; post: number; error: number } {
    return {
      pre: this.preHooks.length,
      post: this.postHooks.length,
      error: this.errorHooks.length,
    };
  }

  /**
   * Execute a tool call with full hook pipeline.
   *
   * Pipeline:
   *   1. Run pre-hooks → abort if any deny
   *   2. Call tool handler with ToolContext
   *   3. Run post-hooks with result
   *   4. Return result
   *
   * On error:
   *   1. Run error hooks
   *   2. Re-throw the error
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
    const start = Date.now();

    // 1. Pre-hooks
    for (const hook of this.preHooks) {
      try {
        const result = await hook(toolName, input as Record<string, unknown>, context);
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
        result = await handler(input, context);
      } else {
        // Raw handler: call without context (backward compat)
        result = await (handler as RawToolHandler<TInput, TOutput>)(input);
      }
    } catch (err) {
      const duration = Date.now() - start;

      // 3. Error hooks
      for (const hook of this.errorHooks) {
        try {
          await hook(toolName, input as Record<string, unknown>, err, context, duration);
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
        await hook(toolName, input as Record<string, unknown>, result, context, duration);
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
