/**
 * core/streaming.ts — Streaming progress notifications for long-running tools (AI-013)
 *
 * Provides a helper that tool handlers can use to send progress updates
 * to the client while executing. Works with the MCP SDK's
 * StreamableHTTPServerTransport (SSE) and falls back to no-op on stdio.
 */

import type { ServerContext } from '../register/context.js';

export interface ProgressUpdate {
  /** Current progress (0..total). */
  current: number;
  /** Total items/steps (0 = indeterminate). */
  total: number;
  /** Human-readable status. */
  message?: string;
}

/**
 * Create a progress sender bound to the current request context.
 * Each call sends a `notifications/progress` message to the client.
 *
 * Usage in a tool handler:
 *   const progress = createProgressSender(ctx);
 *   for (let i = 0; i < items.length; i++) {
 *     await progress({ current: i + 1, total: items.length, message: `Processing ${i + 1}` });
 *     await processItem(items[i]);
 *   }
 */
export function createProgressSender(ctx: ServerContext): (update: ProgressUpdate) => Promise<void> {
  const server = ctx.server;

  return async (update: ProgressUpdate) => {
    try {
      // MCP SDK: server.sendNotification sends to the active transport
      // The SDK handles SSE framing automatically on HTTP transport
      await (server as unknown as {
        sendNotification?: (method: string, params: unknown) => Promise<void>;
      }).sendNotification?.('notifications/progress', {
        progress: update.current,
        total: update.total,
        message: update.message ?? '',
      });
    } catch {
      // Non-fatal: stdio transport may not support notifications mid-call
    }
  };
}

/**
 * Wrap an async operation with progress reporting.
 * Calls the sender before each item and returns the aggregated result.
 */
export async function withProgress<T>(
  items: T[],
  sender: (update: ProgressUpdate) => Promise<void>,
  fn: (item: T, index: number) => Promise<void>,
  messagePrefix = 'Processing',
): Promise<void> {
  const total = items.length;
  for (let i = 0; i < total; i++) {
    await sender({ current: i + 1, total, message: `${messagePrefix} ${i + 1}/${total}` });
    await fn(items[i], i);
  }
}
