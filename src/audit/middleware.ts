/**
 * audit/middleware.ts — Audit middleware for tool calls (SEC-001).
 *
 * Integrates with MW-001 middleware pipeline to automatically record
 * audit events for every tool call: before (pending), after (success),
 * onError (error).
 *
 * Usage:
 *   const auditMiddleware = new AuditMiddleware(auditLogger);
 *   pipeline.use(auditMiddleware);
 */

import type { ToolMiddleware, MiddlewareContext } from '../core/middleware.js';
import type { AuditLogger } from './logger.js';
import type { AuditStatus } from './types.js';

/**
 * Middleware that records audit events for all tool calls.
 */
export class AuditMiddleware implements ToolMiddleware {
  readonly name = 'audit';

  constructor(private readonly logger: AuditLogger) {}

  async before(ctx: MiddlewareContext): Promise<void> {
    // Record the start of the tool call
    this.logger.record('tool.call', 'pending', ctx.toolName, {
      sessionId: ctx.context.sessionId,
      userId: ctx.context.userId,
      input: ctx.input,
      metadata: { phase: 'before' },
    });
  }

  async after(ctx: MiddlewareContext, result: unknown): Promise<unknown> {
    // Record successful completion
    const status: AuditStatus = ctx.shortCircuited ? 'denied' : 'success';
    this.logger.record('tool.result', status, ctx.toolName, {
      sessionId: ctx.context.sessionId,
      userId: ctx.context.userId,
      result,
      durationMs: ctx.durationMs,
      metadata: {
        phase: 'after',
        shortCircuited: ctx.shortCircuited,
      },
    });
    return result;
  }

  async onError(ctx: MiddlewareContext, error: unknown): Promise<unknown> {
    // Record error
    const errorMsg = error instanceof Error ? error.message : String(error);
    this.logger.record('tool.error', 'error', ctx.toolName, {
      sessionId: ctx.context.sessionId,
      userId: ctx.context.userId,
      error: errorMsg,
      durationMs: ctx.durationMs,
      metadata: { phase: 'error' },
    });
    throw error;
  }
}
