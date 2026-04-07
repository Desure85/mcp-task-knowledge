/**
 * AppContainer — Application lifecycle manager (T-001)
 *
 * Encapsulates the full MCP server lifecycle in a single class:
 *   idle → initializing → ready → running → stopping → stopped
 *
 * Responsibilities:
 *   - Initialize logger, metrics, server context
 *   - Register tools/resources via a pluggable callback
 *   - Create and connect transport adapter (stdio/http/custom)
 *   - Handle SIGTERM/SIGINT for graceful shutdown
 *   - Run cleanup callbacks on stop in reverse order
 *
 * Design goals:
 *   - Future-proof: sessions (S-001), auth (A-001), proxy (P-001) hook into lifecycle
 *   - Testable: all dependencies injectable via options
 *   - Idempotent: stop() and shutdown() are safe to call multiple times
 *
 * Usage:
 *   const app = new AppContainer();
 *   await app.run();           // init → start → wait for signals
 *   // OR with custom registration:
 *   const app = new AppContainer({ registerTools: myRegistrationFn });
 *   await app.init();
 *   await app.start();
 *   // ... later
 *   await app.shutdown();
 */

import type { ServerContext } from '../register/context.js';
import type { TransportAdapter, TransportConfig } from '../transport/types.js';
import { defaultTransportRegistry } from '../transport/index.js';
import { createLogger, childLogger } from './logger.js';
import { initMetrics, updateServerInfo, recordSessionCreated, recordSessionClosed } from './metrics.js';
import { SessionManager } from './session-manager.js';
import type { SessionManagerOptions } from './session-manager.js';
import { EventBus } from './event-bus.js';
import type { ServerStartedEvent, ServerStoppedEvent } from './event-bus.js';
import { createServerContext } from '../register/setup.js';
import { registerHelpers } from '../register/helpers.js';
import { registerCatalogTools } from '../register/catalog.js';
import { registerResources } from '../register/resources.js';
import { registerPromptsTools } from '../register/prompts.js';
import { registerObsidianTools } from '../register/obsidian.js';
import { registerProjectTools } from '../register/project.js';
import { registerBulkTools } from '../register/bulk.js';
import { registerTasksTools } from '../register/tasks.js';
import { registerKnowledgeTools } from '../register/knowledge.js';
import { registerSearchTools } from '../register/search.js';
import { registerProjectResources } from '../register/project-resources.js';
import { registerSearchResources } from '../register/search-resources.js';
import { registerAliases } from '../register/aliases.js';
import { registerToolsIntrospection } from '../register/tools-introspection.js';
import { registerDebugResources } from '../register/debug-resources.js';
import { registerDependencyTools } from '../register/dependencies.js';
import { registerDashboardTools } from '../register/dashboard.js';
import { registerMarkdownTools } from '../register/markdown.js';
import { registerSessionTools } from '../register/session.js';
import { RateLimiter } from './rate-limiter.js';

// ─── Types ────────────────────────────────────────────────────────────

/** Application lifecycle states. */
export type AppState =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error';

/** Callback that receives the ServerContext to register tools/resources. */
export type RegisterCallback = (ctx: ServerContext) => void;

/** Options for AppContainer construction. */
export interface AppContainerOptions {
  /** Override transport type (default: MCP_TRANSPORT env or 'stdio'). */
  transportType?: string;
  /** Override port for HTTP transport (default: MCP_PORT or 3001). */
  port?: number;
  /** Override host for HTTP transport (default: MCP_HOST or '0.0.0.0'). */
  host?: string;
  /**
   * Custom tool registration callback.
   * If not provided, uses `defaultRegistration` (all built-in tools).
   */
  registerTools?: RegisterCallback;
  /** Whether to install SIGTERM/SIGINT handlers. Default: auto (true for non-stdio). */
  handleSignals?: boolean | 'auto';
  /**
   * SessionManager options for multi-client transports.
   * If provided, a SessionManager is created during init() and exposed via getSessionManager().
   * Ignored for stdio transport (single client).
   */
  sessionManager?: SessionManagerOptions | false;
}

// ─── Default registration ─────────────────────────────────────────────

/**
 * Default tool registration: all built-in tools and resources.
 * Order matters — helpers first, then tools, then resources, then aliases/introspection.
 * Extracted from the old main() so AppContainer stays decoupled from individual modules.
 */
export function defaultRegistration(ctx: ServerContext): void {
  registerHelpers(ctx);
  registerCatalogTools(ctx);
  registerResources(ctx);
  registerPromptsTools(ctx);
  registerObsidianTools(ctx);
  registerProjectTools(ctx);
  registerBulkTools(ctx);
  registerTasksTools(ctx);
  registerKnowledgeTools(ctx);
  registerSearchTools(ctx);
  registerProjectResources(ctx);
  registerSearchResources(ctx);
  registerDependencyTools(ctx);
  registerDashboardTools(ctx);
  registerMarkdownTools(ctx);
  registerSessionTools(ctx);
  registerAliases(ctx);
  registerToolsIntrospection(ctx);
  registerDebugResources(ctx);
}

// ─── Valid state transitions ──────────────────────────────────────────

const VALID_TRANSITIONS: Record<AppState, ReadonlySet<AppState>> = {
  idle: new Set(['initializing']),
  initializing: new Set(['ready', 'error']),
  ready: new Set(['running', 'stopping']),
  running: new Set(['stopping']),
  stopping: new Set(['stopped', 'error']),
  stopped: new Set(['initializing']), // allow restart
  error: new Set(['initializing']),  // allow restart after error
};

function assertTransition(from: AppState, to: AppState): void {
  if (!VALID_TRANSITIONS[from]?.has(to)) {
    throw new Error(`[app-container] invalid state transition: ${from} → ${to}`);
  }
}

// ─── AppContainer ─────────────────────────────────────────────────────

export class AppContainer {
  private _state: AppState = 'idle';
  private ctx?: ServerContext;
  private adapter?: TransportAdapter;
  private sessionMgr?: SessionManager;
  private readonly eventBus = new EventBus();
  private cleanupCallbacks: Array<() => Promise<void> | void> = [];
  private signalHandlersInstalled = false;
  private startedAt?: number;
  private readonly log = childLogger('app-container');
  private readonly opts: {
    transportType: string;
    port: number;
    host: string;
    handleSignals: boolean;
    registerTools: RegisterCallback | undefined;
    sessionManager: SessionManagerOptions | false | undefined;
  };

  constructor(options?: AppContainerOptions) {
    const transportType = options?.transportType
      ?? (process.env.MCP_TRANSPORT || 'stdio').toLowerCase();
    const port = options?.port
      ?? parseInt(process.env.MCP_PORT || '3001', 10);
    const host = options?.host
      ?? (process.env.MCP_HOST || '0.0.0.0');

    let handleSignals: boolean;
    if (options?.handleSignals === 'auto' || options?.handleSignals === undefined) {
      handleSignals = transportType !== 'stdio';
    } else {
      handleSignals = options.handleSignals;
    }

    this.opts = {
      transportType,
      port,
      host,
      handleSignals,
      registerTools: options?.registerTools,
      sessionManager: options?.sessionManager,
    };
  }

  // ─── Public getters ───────────────────────────────────────────────

  /** Current application state. */
  get state(): AppState {
    return this._state;
  }

  /** Server context (available after init()). Throws if not initialized. */
  getContext(): ServerContext {
    if (!this.ctx) {
      throw new Error('[app-container] context not available — call init() first');
    }
    return this.ctx;
  }

  /** Transport adapter (available after start()). Throws if not started. */
  getTransport(): TransportAdapter {
    if (!this.adapter) {
      throw new Error('[app-container] transport not available — call start() first');
    }
    return this.adapter;
  }

  /** SessionManager (available after init() for multi-client transports). Throws if not initialized or disabled. */
  getSessionManager(): SessionManager {
    if (!this.sessionMgr) {
      throw new Error('[app-container] session manager not available — call init() first or check sessionManager option');
    }
    return this.sessionMgr;
  }

  /** EventBus for pub/sub event dispatch (MW-002). Available immediately after construction. */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────

  /**
   * Initialize the application: logger, metrics, context, tools/resources.
   * Transitions: idle → initializing → ready
   *
   * Steps:
   *   1. Create root logger (Pino singleton)
   *   2. Initialize Prometheus metrics (no-op for stdio)
   *   3. Create server context (McpServer, config, registries)
   *   4. Register all tools and resources (default or custom callback)
   *   5. Update server info gauge with tool count
   */
  async init(): Promise<void> {
    assertTransition(this._state, 'initializing');
    this._state = 'initializing';

    try {
      // 1. Logger
      createLogger();

      // 2. Metrics
      initMetrics();

      // 3. Server context (McpServer, config, registries)
      this.ctx = await createServerContext();

      // 4. Register tools and resources
      const registerFn = this.opts.registerTools ?? defaultRegistration;
      registerFn(this.ctx);

      // 5. Update metrics with tool count
      updateServerInfo({ toolCount: this.ctx.toolNames.size });

      // 6. SessionManager for multi-client transports (auto for non-stdio, unless explicitly disabled)
      if (this.opts.sessionManager !== false && this.opts.transportType !== 'stdio') {
        this.sessionMgr = new SessionManager({
          ...(this.opts.sessionManager === undefined ? {} : this.opts.sessionManager),
          // S-005: wire session metrics callbacks
          onSessionCreate: () => recordSessionCreated(),
          onSessionClose: (durationMs, idleMs, reason) => recordSessionClosed(durationMs, idleMs, reason),
        });
        this.sessionMgr.startPrune();
        this.addCleanup(() => this.sessionMgr!.closeAll());
        this.log.info('session manager initialized');

        // Attach sessionManager to context so session tools (S-004) can access it
        this.ctx.sessionManager = this.sessionMgr;

        // Create RateLimiter and attach to context for session tools (S-003/S-004)
        const rateLimiter = new RateLimiter();
        this.ctx.rateLimiter = rateLimiter;
        this.log.info('rate limiter initialized');
      }

      this._state = 'ready';
      this.log.info(
        { tools: this.ctx.toolNames.size, transport: this.opts.transportType },
        'app initialized',
      );
    } catch (err) {
      this._state = 'error';
      this.log.error({ err }, 'initialization failed');
      throw err;
    }
  }

  /**
   * Start the transport and begin serving requests.
   * Transitions: ready → running
   *
   * Creates a transport adapter from the registry, connects it to the
   * MCP server, and optionally installs SIGTERM/SIGINT handlers.
   */
  async start(): Promise<void> {
    assertTransition(this._state, 'running');

    if (!this.ctx) {
      throw new Error('[app-container] cannot start without context — call init() first');
    }

    try {
      // Create transport adapter via registry
      const config: TransportConfig = {
        type: this.opts.transportType,
        options: { port: this.opts.port, host: this.opts.host },
      };
      this.adapter = defaultTransportRegistry.createTransport(config);
      await this.adapter.connect(this.ctx);

      // Install signal handlers for graceful shutdown
      if (this.opts.handleSignals) {
        this.installSignalHandlers();
      }

      this._state = 'running';
      this.startedAt = Date.now();
      this.log.info(
        { transport: this.opts.transportType, port: this.opts.port },
        'app running',
      );

      // Emit server.started event
      const startedEvent: ServerStartedEvent = {
        type: 'server.started',
        timestamp: Date.now(),
        transport: this.opts.transportType,
        port: this.opts.port,
        toolCount: this.ctx?.toolNames.size ?? 0,
      };
      this.eventBus.emit(startedEvent).catch(() => {}); // fire-and-forget
    } catch (err) {
      this._state = 'error';
      this.log.error({ err }, 'start failed');
      throw err;
    }
  }

  /**
   * Stop the application gracefully.
   * Transitions: running → stopping → stopped
   * Idempotent — safe to call multiple times from any state.
   *
   * Cleanup order:
   *   1. Remove signal handlers (prevent re-entry)
   *   2. Close transport adapter
   *   3. Run registered cleanup callbacks in LIFO order
   */
  async stop(): Promise<void> {
    // Already stopped or stopping — no-op
    if (this._state === 'stopped' || this._state === 'stopping') {
      return;
    }

    // Never started — just mark as stopped
    if (this._state === 'idle' || this._state === 'initializing') {
      this._state = 'stopped';
      return;
    }

    this._state = 'stopping';
    this.log.info('stopping...');

    try {
      // 1. Remove signal handlers first (prevent re-entry)
      this.removeSignalHandlers();

      // 2. Close transport adapter
      if (this.adapter) {
        try {
          await this.adapter.close();
        } catch (err) {
          this.log.warn({ err }, 'transport close error (non-fatal)');
        }
        this.adapter = undefined;
      }

      // 3. Run cleanup callbacks in reverse order (LIFO)
      for (let i = this.cleanupCallbacks.length - 1; i >= 0; i--) {
        try {
          await this.cleanupCallbacks[i]();
        } catch (err) {
          this.log.warn({ err, index: i }, 'cleanup callback error (non-fatal)');
        }
      }
      this.cleanupCallbacks = [];

      this._state = 'stopped';
      this.log.info('stopped');

      // Emit server.stopped event
      const uptimeMs = this.startedAt ? Date.now() - this.startedAt : 0;
      const stoppedEvent: ServerStoppedEvent = {
        type: 'server.stopped',
        timestamp: Date.now(),
        reason: 'explicit',
        uptimeMs,
      };
      this.eventBus.emit(stoppedEvent).catch(() => {}); // fire-and-forget
    } catch (err) {
      this._state = 'error';
      this.log.error({ err }, 'stop failed');
      throw err;
    }
  }

  /**
   * Convenience: init → start.
   * For stdio transport, the process stays alive as long as stdin is open.
   * For http/tcp, signal handlers are installed automatically.
   */
  async run(): Promise<void> {
    await this.init();
    await this.start();
    this.log.info('app is running — press Ctrl+C to stop');
  }

  /**
   * Convenience: stop → process.exit(0).
   * Used by signal handlers and external shutdown triggers.
   */
  async shutdown(): Promise<void> {
    await this.stop();
    process.exit(0);
  }

  // ─── Cleanup registration ────────────────────────────────────────

  /**
   * Register a cleanup callback to run on stop().
   * Callbacks run in LIFO order (last registered = first cleaned up).
   * Useful for sessions (S-001), timers, temp files, etc.
   *
   * @example
   *   app.addCleanup(() => clearInterval(myTimer));
   *   app.addCleanup(async () => await sessionManager.closeAll());
   */
  addCleanup(fn: () => Promise<void> | void): void {
    this.cleanupCallbacks.push(fn);
  }

  // ─── Signal handling (internal) ──────────────────────────────────

  private installSignalHandlers(): void {
    if (this.signalHandlersInstalled) return;
    this.signalHandlersInstalled = true;

    const handleSignal = async (signal: string) => {
      this.log.info({ signal }, 'signal received, shutting down...');
      await this.shutdown();
    };

    process.on('SIGTERM', () => handleSignal('SIGTERM'));
    process.on('SIGINT', () => handleSignal('SIGINT'));
  }

  private removeSignalHandlers(): void {
    if (!this.signalHandlersInstalled) return;
    this.signalHandlersInstalled = false;

    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  }

  // ─── Testing helpers ─────────────────────────────────────────────

  /**
   * Force-set internal state (for testing only).
   * Bypasses normal transition validation.
   */
  _setState(state: AppState): void {
    this._state = state;
  }

  /**
   * Get registered cleanup callbacks (for testing only).
   */
  _getCleanupCallbacks(): ReadonlyArray<() => Promise<void> | void> {
    return this.cleanupCallbacks;
  }

  /**
   * Check if signal handlers are installed (for testing only).
   */
  _hasSignalHandlers(): boolean {
    return this.signalHandlersInstalled;
  }
}
