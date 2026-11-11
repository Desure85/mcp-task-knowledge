/**
 * core/streaming.ts — Streaming progress notifications for long-running tools (AI-013)
 *
 * SPEC-07: MCP only allows `notifications/progress` when the client supplied a
 * `progressToken` in the request `_meta`. Without a token the notification is
 * meaningless (the client cannot correlate it) and the spec forbids it.
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

export type ProgressToken = string | number;

/**
 * Extract `_meta.progressToken` from an MCP request-handler `extra` object.
 * Returns undefined when the client did not request progress.
 */
export function progressTokenFromExtra(extra: unknown): ProgressToken | undefined {
  if (!extra || typeof extra !== 'object') return undefined;
  const meta = (extra as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== 'object') return undefined;
  const token = (meta as { progressToken?: unknown }).progressToken;
  return typeof token === 'string' || typeof token === 'number' ? token : undefined;
}

/**
 * Create a progress sender bound to the current request context.
 * Each call sends a `notifications/progress` message to the client **only**
 * when a `progressToken` was supplied by the client.
 *
 * Usage in a tool handler:
 *   const progress = createProgressSender(ctx, progressTokenFromExtra(extra));
 *   for (let i = 0; i < items.length; i++) {
 *     await progress({ current: i + 1, total: items.length, message: `Processing ${i + 1}` });
 *     await processItem(items[i]);
 *   }
 */
export function createProgressSender(
  ctx: ServerContext,
  progressToken?: ProgressToken,
): (update: ProgressUpdate) => Promise<void> {
  const server = ctx.server;
  if (progressToken === undefined) {
    return async () => {};
  }

  if (progressToken === undefined) {
    return async () => {};
  }

  return async (update: ProgressUpdate) => {
    try {
      // MCP SDK: server.sendNotification sends to the active transport
      // The SDK handles SSE framing automatically on HTTP transport.
      await (server as unknown as {
        sendNotification?: (method: string, params: unknown) => Promise<void>;
      }).sendNotification?.('notifications/progress', {
        progressToken,
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
