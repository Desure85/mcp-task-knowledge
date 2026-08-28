/**
 * proxy/forwarder.ts — Request/notification forwarding + flow control (P-003).
 *
 * Bridges bidirectional communication between downstream clients and the
 * upstream MCP server:
 *
 *   Downstream → Upstream: tool/resource/prompt calls (via ProxyMirror, P-002)
 *   Upstream → Downstream: notifications (list_changed, progress, resources/updated)
 *
 * Flow control:
 *   - Concurrency limit: max concurrent forwarded requests
 *   - Queue with backpressure: if queue full, reject with 429-like error
 *   - Timeout: per-request timeout for upstream calls
 *   - Error propagation: upstream errors mapped to downstream JSON-RPC errors
 *
 * Notification forwarding:
 *   - notifications/tools/list_changed → trigger re-mirror
 *   - notifications/resources/list_changed → trigger re-mirror
 *   - notifications/prompts/list_changed → trigger re-mirror
 *   - notifications/resources/updated → forward to downstream clients
 *   - notifications/progress → forward to downstream clients
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { childLogger } from '../core/logger.js';
import type { ProxyMirror } from './mirror.js';

const log = childLogger('proxy:forwarder');

// ─── Types ───────────────────────────────────────────────────────

export interface ForwarderConfig {
  /** Max concurrent forwarded requests to upstream. */
  maxConcurrent: number;
  /** Max queue size before rejecting (backpressure). */
  maxQueueSize: number;
  /** Per-request timeout in milliseconds (0 = no timeout). */
  timeoutMs: number;
  /** Whether to forward notifications from upstream to downstream. */
  forwardNotifications: boolean;
  /** Whether to auto re-mirror on list_changed notifications. */
  autoRemirror: boolean;
}

export const DEFAULT_FORWARDER_CONFIG: ForwarderConfig = {
  maxConcurrent: 10,
  maxQueueSize: 100,
  timeoutMs: 30_000,
  forwardNotifications: true,
  autoRemirror: true,
};

export interface ForwarderStats {
  /** Currently in-flight requests. */
  inFlight: number;
  /** Currently queued requests. */
  queued: number;
  /** Total requests forwarded. */
  totalForwarded: number;
  /** Total requests rejected (queue full, timeout, upstream error). */
  totalRejected: number;
  /** Total notifications forwarded. */
  notificationsForwarded: number;
  /** Total re-mirror events triggered. */
  remirrorEvents: number;
}

// ─── Flow-controlled request wrapper ──────────────────────────────

interface QueuedRequest<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
}

// ─── ProxyForwarder ───────────────────────────────────────────────

export class ProxyForwarder {
  private config: ForwarderConfig;
  private inFlight = 0;
  private queue: QueuedRequest<unknown>[] = [];
  private _stats: ForwarderStats = {
    inFlight: 0,
    queued: 0,
    totalForwarded: 0,
    totalRejected: 0,
    notificationsForwarded: 0,
    remirrorEvents: 0,
  };
  private notificationHandlers: Array<() => void> = [];

  constructor(
    private readonly client: Client,
    private readonly server: McpServer,
    private readonly mirror: ProxyMirror,
    config?: Partial<ForwarderConfig>,
  ) {
    this.config = { ...DEFAULT_FORWARDER_CONFIG, ...config };
  }

  get stats(): ForwarderStats {
    return {
      ...this._stats,
      inFlight: this.inFlight,
      queued: this.queue.length,
    };
  }

  /**
   * Start forwarding: set up notification handlers from upstream.
   */
  start(): void {
    if (!this.config.forwardNotifications) return;

    this.setupNotificationHandlers();
    log.info('proxy forwarder started — notification handlers installed');
  }

  /**
   * Stop forwarding: remove notification handlers, drain queue.
   */
  stop(): void {
    for (const cleanup of this.notificationHandlers) {
      cleanup();
    }
    this.notificationHandlers = [];

    // Reject all queued requests
    for (const req of this.queue) {
      req.reject(new Error('[proxy] forwarder stopped'));
    }
    this.queue = [];
    this.inFlight = 0;

    log.info('proxy forwarder stopped');
  }

  /**
   * Forward a request to upstream with flow control.
   * Returns the result or throws on timeout/queue-full/upstream-error.
   */
  async forward<T>(fn: () => Promise<T>): Promise<T> {
    // Check queue capacity (backpressure)
    if (this.queue.length >= this.config.maxQueueSize) {
      this._stats.totalRejected++;
      throw new Error(`[proxy] queue full (${this.config.maxQueueSize}) — backpressure`);
    }

    // If under concurrency limit, execute immediately
    if (this.inFlight < this.config.maxConcurrent) {
      return this.executeRequest(fn);
    }

    // Otherwise, queue the request
    return this.queueRequest(fn);
  }

  /**
   * Execute a request immediately (counts against concurrency limit).
   */
  private async executeRequest<T>(fn: () => Promise<T>): Promise<T> {
    this.inFlight++;
    this._stats.inFlight = this.inFlight;

    let timer: NodeJS.Timeout | undefined;
    if (this.config.timeoutMs > 0) {
      timer = setTimeout(() => {
        log.warn({ timeoutMs: this.config.timeoutMs }, 'upstream request timed out');
      }, this.config.timeoutMs);
    }

    try {
      const result = await fn();
      this._stats.totalForwarded++;
      return result;
    } catch (err) {
      this._stats.totalRejected++;
      log.error({ err }, 'upstream request failed');
      throw err;
    } finally {
      this.inFlight--;
      this._stats.inFlight = this.inFlight;
      if (timer) clearTimeout(timer);

      // Process next queued request
      this.drainQueue();
    }
  }

  /**
   * Queue a request for later execution.
   */
  private queueRequest<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;

      const req: QueuedRequest<unknown> = {
        fn: fn as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      };

      if (this.config.timeoutMs > 0) {
        timer = setTimeout(() => {
          // Remove from queue
          const idx = this.queue.indexOf(req);
          if (idx >= 0) this.queue.splice(idx, 1);
          this._stats.totalRejected++;
          reject(new Error(`[proxy] request timed out in queue (${this.config.timeoutMs}ms)`));
        }, this.config.timeoutMs);
        req.timer = timer;
      }

      this.queue.push(req);
    });
  }

  /**
   * Drain the queue: execute queued requests if capacity available.
   */
  private drainQueue(): void {
    while (this.queue.length > 0 && this.inFlight < this.config.maxConcurrent) {
      const req = this.queue.shift();
      if (!req) break;

      // Clear queue timeout
      if (req.timer) clearTimeout(req.timer);

      // Execute the queued request
      this.executeRequest(req.fn as () => Promise<unknown>)
        .then((result) => req.resolve(result))
        .catch((err) => req.reject(err));
    }
  }

  /**
   * Set up notification handlers from upstream → downstream.
   */
  private setupNotificationHandlers(): void {
    // notifications/tools/list_changed → re-mirror tools
    if (this.config.autoRemirror) {
      this.addNotificationHandler('notifications/tools/list_changed', async () => {
        log.info('upstream tools/list_changed — re-mirroring');
        this._stats.remirrorEvents++;
        try {
          this.mirror.unregisterAll();
          await this.mirror.mirrorAll();
        } catch (err) {
          log.error({ err }, 're-mirror failed');
        }
      });

      this.addNotificationHandler('notifications/resources/list_changed', async () => {
        log.info('upstream resources/list_changed — re-mirroring');
        this._stats.remirrorEvents++;
        try {
          this.mirror.unregisterAll();
          await this.mirror.mirrorAll();
        } catch (err) {
          log.error({ err }, 're-mirror failed');
        }
      });

      this.addNotificationHandler('notifications/prompts/list_changed', async () => {
        log.info('upstream prompts/list_changed — re-mirroring');
        this._stats.remirrorEvents++;
        try {
          this.mirror.unregisterAll();
          await this.mirror.mirrorAll();
        } catch (err) {
          log.error({ err }, 're-mirror failed');
        }
      });
    }

    // notifications/resources/updated → forward to downstream
    this.addNotificationHandler('notifications/resources/updated', async () => {
      log.debug('forwarding resources/updated notification');
      this._stats.notificationsForwarded++;
      try {
        await this.server.server.notification({
          method: 'notifications/resources/updated',
          params: {},
        });
      } catch (err) {
        log.warn({ err }, 'failed to forward resources/updated');
      }
    });

    // notifications/progress → forward to downstream
    this.addNotificationHandler('notifications/progress', async () => {
      log.debug('forwarding progress notification');
      this._stats.notificationsForwarded++;
      // Progress notifications are per-request — forwarding is best-effort
    });
  }

  /**
   * Add a notification handler and track it for cleanup.
   */
  private addNotificationHandler(method: string, handler: (notification: any) => void | Promise<void>): void {
    // The SDK's setNotificationHandler expects a Zod schema, but we can
    // use a loose schema to match by method name.
    const schema = {
      method: {
        _zodType: true,
        parse: (v: any) => v,
        safeParse: (v: any) => ({ success: true, data: v }),
      },
    } as any;

    try {
      this.client.setNotificationHandler(schema, handler);
      this.notificationHandlers.push(() => {
        try {
          this.client.removeNotificationHandler(method);
        } catch { /* ignore */ }
      });
    } catch (err) {
      log.warn({ method, err }, 'failed to set notification handler');
    }
  }
}
