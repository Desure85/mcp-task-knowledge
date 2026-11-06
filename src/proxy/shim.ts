/**
 * proxy/shim.ts — stdio ⇄ http-core bridge (MU-08).
 *
 * The downstream side is a plain McpServer on stdio; every mirrored item
 * forwards to the single http core through ProxyBootstrap. The shim owns no
 * storage, no embeddings and no `DATA_DIR/.server.lock`.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ProxyConfig } from './types.js';
import { ProxyBootstrap } from './bootstrap.js';
import { ProxyMirror } from './mirror.js';
import { CircuitBreaker, DEFAULT_CIRCUIT_CONFIG } from '../core/circuit-breaker.js';
import type { CircuitBreakerConfig } from '../core/circuit-breaker.js';
import { childLogger } from '../core/logger.js';

const log = childLogger('proxy:shim');

const UPSTREAM_LOSS =
  /ECONNREFUSED|ECONNRESET|EPIPE|fetch failed|socket hang up|other side closed|StreamableHTTPError|Error POSTing|401|404|502|503|504/i;

export interface StdioBridgeOptions {
  name?: string;
  version?: string;
  circuit?: Partial<CircuitBreakerConfig>;
}

export class StdioBridge {
  private readonly bootstrap: ProxyBootstrap;
  private readonly breaker: CircuitBreaker;
  private server?: McpServer;
  private mirror?: ProxyMirror;
  private transport?: StdioServerTransport;
  private reconnectInFlight?: Promise<boolean>;
  private failureCount = 0;
  private nextAttemptAt = 0;
  private _running = false;

  constructor(
    private readonly config: ProxyConfig,
    private readonly options: StdioBridgeOptions = {},
  ) {
    this.bootstrap = new ProxyBootstrap(config);
    this.breaker = new CircuitBreaker({ ...DEFAULT_CIRCUIT_CONFIG, ...options.circuit });
  }

  get running(): boolean {
    return this._running;
  }

  /**
   * Connect upstream, mirror its surface into a fresh stdio server and start
   * listening. Throws when the upstream is unreachable, rejects the token, or
   * exposes no tools.
   */
  async start(): Promise<void> {
    if (this._running) throw new Error('[bridge] already running');

    await this.bootstrap.start();

    this.server = new McpServer(
      { name: this.options.name ?? 'mcp-task-knowledge-bridge', version: this.options.version ?? '1.0.0' },
      { capabilities: { tools: {}, resources: {}, prompts: {} } },
    );
    this.mirror = new ProxyMirror(this.bootstrap.getClient(), this.server);
    this.mirror.setRecovery((err) => this.recover(err));

    const stats = await this.mirror.mirrorAll();
    if (stats.tools === 0) {
      throw new Error('[bridge] upstream exposed no tools — is a token required?');
    }

    this.transport = new StdioServerTransport();
    await this.server.connect(this.transport);
    this._running = true;
    log.info({ tools: stats.tools, resources: stats.resources, prompts: stats.prompts }, 'bridge started');
  }

  /** Close downstream, upstream and timers. Idempotent. */
  async stop(): Promise<void> {
    this._running = false;
    try {
      await this.server?.close();
    } catch (err) {
      log.warn({ err }, 'error closing downstream server');
    }
    this.mirror?.unregisterAll();
    await this.bootstrap.stop().catch((err) => log.warn({ err }, 'error stopping upstream'));
    this.server = undefined;
    this.mirror = undefined;
    this.transport = undefined;
  }

  private recover(err: unknown): Promise<boolean> {
    if (!this.isUpstreamLoss(err)) return Promise.resolve(false);
    if (!this.reconnectInFlight) {
      this.reconnectInFlight = this.reconnect().finally(() => {
        this.reconnectInFlight = undefined;
      });
    }
    return this.reconnectInFlight;
  }

  private isUpstreamLoss(err: unknown): boolean {
    const text = `${(err as { code?: string })?.code ?? ''} ${(err as Error)?.message ?? String(err)}`;
    return UPSTREAM_LOSS.test(text);
  }

  /**
   * Re-create the upstream session. The core drops authentication together
   * with the session, so ProxyBootstrap.start() re-runs `mcp.authenticate`;
   * the mirrored callbacks then point at the new Client.
   */
  private async reconnect(): Promise<boolean> {
    if (!this.breaker.canExecute()) {
      log.warn({ state: this.breaker.currentState }, 'reconnect skipped — circuit open');
      return false;
    }
    if (Date.now() < this.nextAttemptAt) return false;
    try {
      await this.bootstrap.stop();
      await this.bootstrap.start();
      this.mirror?.setClient(this.bootstrap.getClient());
      this.breaker.reset();
      this.failureCount = 0;
      this.nextAttemptAt = 0;
      log.info('reconnected to upstream');
      return true;
    } catch (err) {
      this.failureCount++;
      this.nextAttemptAt = Date.now() + Math.min(500 * 2 ** Math.min(this.failureCount, 4), 8000);
      this.breaker.recordFailure();
      log.warn({ err, retryInMs: this.nextAttemptAt - Date.now() }, 'reconnect failed');
      return false;
    }
  }
}
