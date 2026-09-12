/**
 * Stream Transport — TCP and Unix domain socket transports (T-002)
 *
 * Multi-client capable transport for TCP and Unix domain sockets.
 * Each accepted connection gets its own MCP session.
 * Uses Content-Length framing (same as stdio) for JSON-RPC messages
 * via the SDK's ReadBuffer.
 *
 * Architecture:
 *   - Single net.Server listens for connections
 *   - Each connection gets its own McpServer + Transport pair
 *   - Tools are registered per-session via the registration callback
 *   - Connections tracked for graceful shutdown and diagnostics
 *
 * Configuration (via TransportConfig.options or env vars):
 *   TCP:
 *     - port: number (default: 3002, env: MCP_TCP_PORT)
 *     - host: string (default: "0.0.0.0", env: MCP_TCP_HOST)
 *   Unix:
 *     - path: string (default: "/tmp/mcp-task-knowledge.sock", env: MCP_UNIX_PATH)
 *
 * Usage:
 *   MCP_TRANSPORT=tcp node dist/index.js
 *   MCP_TRANSPORT=unix MCP_UNIX_PATH=/run/mcp.sock node dist/index.js
 */

import net from 'node:net';
import fs from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js';
import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { TransportConfig, TransportAdapter, TransportFactory, TransportHealth } from './types.js';
import type { ServerContext } from '../register/context.js';
import { decideToolCall, decideMethodCall, type MethodGateCall } from '../core/auth-gate.js';
import type { AuthGateCall, AuthGateDecision } from '../core/auth-gate.js';
import { childLogger } from '../core/logger.js';

const log = childLogger('transport:stream');

// ─── Per-connection Transport ──────────────────────────────────────────

/**
 * Implements MCP SDK Transport over a single net.Socket.
 * Uses Content-Length framing for JSON-RPC messages (same protocol as stdio).
 */
class SocketTransport implements Transport {
  readonly sessionId: string;
  onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;
  setProtocolVersion?: (version: string) => void;

  private readonly readBuffer = new ReadBuffer();
  private _closed = false;

  constructor(
    private readonly socket: net.Socket,
    sessionId: string,
  ) {
    this.sessionId = sessionId;
  }

  async start(): Promise<void> {
    this.socket.on('data', (data: Buffer) => {
      if (this._closed) return;
      try {
        this.readBuffer.append(data);
        let message: JSONRPCMessage | null;
        while ((message = this.readBuffer.readMessage()) !== null) {
          this.onmessage?.(message);
        }
      } catch (err) {
        this.onerror?.(err instanceof Error ? err : new Error(String(err)));
      }
    });

    this.socket.on('error', (err) => {
      this.onerror?.(err);
    });

    this.socket.on('close', () => {
      if (!this._closed) {
        this._closed = true;
        this.onclose?.();
      }
    });
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (this._closed) {
      throw new Error(`[stream] cannot send on closed connection ${this.sessionId}`);
    }
    const serialized = serializeMessage(message);
    this.socket.write(serialized);
  }

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    this.socket.destroy();
  }
}

// ─── Session types ─────────────────────────────────────────────────────

interface ActiveSession {
  server: McpServer;
  transport: SocketTransport;
  socket: net.Socket;
  remote: string;
  connectedAt: number;
}

// ─── Base class ────────────────────────────────────────────────────────

/**
 * Base class for TCP and Unix transports.
 * Manages a net.Server that accepts connections and creates
 * independent MCP sessions for each one.
 */
/**
 * JSON-RPC methods routed to the MAIN server's request handlers (S-002).
 * The per-connection McpServer only handles the lifecycle handshake
 * (initialize/ping/notifications); everything below is served by the shared
 * registry — real schemas, gated handlers, single source of truth.
 */
const MAIN_DISPATCH_METHODS = new Set([
  'tools/list',
  'tools/call',
  'resources/list',
  'resources/read',
  'resources/templates/list',
  'prompts/list',
  'prompts/get',
  'completion/complete',
]);

type MainRequestHandler = (request: unknown, extra: unknown) => Promise<unknown>;

abstract class StreamTransportAdapter implements TransportAdapter {
  private server?: net.Server;
  private sessions = new Map<string, ActiveSession>();
  private nextId = 0;
  private _connected = false;
  private serverInfo?: { name: string; version: string };
  private registerTools?: (server: McpServer) => void;
  private serverCtx?: ServerContext;
  private mainHandlers?: Map<string, MainRequestHandler>;
  /**
   * SPEC-01: real AbortControllers for requests dispatched to main handlers.
   * Keyed by `${sessionId}:${requestId}` so a notifications/cancelled from
   * the client can abort in-flight work instead of the fabricated
   * never-aborting signal we used to pass.
   */
  private pendingRequests = new Map<string, AbortController>();

  abstract readonly type: string;

  /** Create the net.Server and start listening. Returns the server. */
  protected abstract listen(): Promise<net.Server>;

  /** Extra cleanup after close (e.g., remove Unix socket file). */
  protected extraCleanup?(): Promise<void>;

  /**
   * SEC-003 enforcement primitive for TCP/Unix sessions: fail-closed gate
   * on every tools/call. Per-session McpServers gain full tool routing with
   * S-002; until then this is the single decision point covered by unit
   * tests for transport 'tcp' (same shared gate as HTTP).
   */
  authorizeToolCall(call: AuthGateCall): AuthGateDecision {
    return decideToolCall(this.serverCtx?.authManager, this.type, call);
  }

  /**
   * AUD-01: gate ANY dispatched protocol method, not only tools/call.
   * initialize/ping/notifications stay open; everything else requires an
   * authenticated session when requireAuth is on.
   */
  authorizeMethodCall(call: MethodGateCall): AuthGateDecision {
    return decideMethodCall(this.serverCtx?.authManager, this.type, call);
  }

  async connect(ctx: ServerContext): Promise<void> {
    if (this._connected) {
      throw new Error(`[${this.type}] already connected`);
    }

    this.serverCtx = ctx;
    // Extract server info from context
    const rawServer = ctx.server as unknown as Record<string, unknown>;
    const serverInfo = rawServer?.server as Record<string, unknown> | undefined;
    const implementation = serverInfo?._implementation as { name: string; version: string } | undefined;
    this.serverInfo = {
      name: implementation?.name ?? 'mcp-task-knowledge',
      version: implementation?.version ?? '0.0.0',
    };

    // S-002: capture the MAIN server's request handlers. The SDK stores them
    // as (rawRequest, extra) wrappers that parse the request themselves, so a
    // per-connection transport can dispatch tools/resources/prompts methods
    // straight into the shared registry — no per-session re-registration.
    const mainBase = (ctx.server as unknown as Record<string, unknown>)?.server as
      | { _requestHandlers?: Map<string, MainRequestHandler> }
      | undefined;
    this.mainHandlers = mainBase?._requestHandlers instanceof Map ? mainBase._requestHandlers : undefined;
    if (!this.mainHandlers) {
      log.warn('main server request handlers unavailable — sessions will expose no tools');
    }

    // Per-session McpServer keeps only the lifecycle handshake; real methods
    // are dispatched to the main handlers in handleConnection.
    this.registerTools = (_server: McpServer) => {};

    this.server = await this.listen();

    this.server.on('connection', (socket) => {
      this.handleConnection(socket);
    });

    this.server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log.fatal({ type: this.type, err }, 'address already in use');
      } else {
        log.error({ type: this.type, err }, 'server error');
      }
    });

    this._connected = true;
  }

  private async handleConnection(socket: net.Socket): Promise<void> {
    const id = `sess-${++this.nextId}`;
    const remote = socket.remoteAddress
      ? `${socket.remoteAddress}:${socket.remotePort}`
      : 'unknown';

    log.info({ sessionId: id, remote }, 'new connection');

    // Set socket options for better behavior
    socket.setNoDelay(true);
    // Allow half-open connections for cleaner shutdown
    socket.allowHalfOpen = true;

    const transport = new SocketTransport(socket, id);

    // Create a new McpServer for this session (lifecycle only — real methods
    // are dispatched to the main server's handlers, see S-002 below)
    const server = new McpServer(
      { name: this.serverInfo!.name, version: this.serverInfo!.version },
    );

    this.sessions.set(id, {
      server,
      transport,
      socket,
      remote,
      connectedAt: Date.now(),
    });

    // Register in SessionManager so session_list/session_info, per-session
    // TTL and auth metadata resolve for TCP/Unix connections too (PH-003).
    try {
      this.serverCtx?.sessionManager?.create({
        id,
        remote,
        metadata: { transport: this.type },
        onClose: async (sid) => {
          this.serverCtx?.authManager?.revokeSession(sid);
          const s = this.sessions.get(sid);
          try { await s?.server.close(); } catch { /* ignore */ }
          try { await s?.transport.close(); } catch { /* ignore */ }
          this.sessions.delete(sid);
        },
      });
    } catch (e) {
      log.warn({ sessionId: id, err: e }, 'session-manager rejected session create');
    }

    // Wire transport callbacks
    transport.onclose = () => {
      const duration = Date.now() - (this.sessions.get(id)?.connectedAt ?? Date.now());
      log.info({ sessionId: id, remote, durationMs: duration }, 'session closed');
      this.sessions.delete(id);
      void this.serverCtx?.sessionManager?.close(id);
    };

    transport.onerror = (err) => {
      log.warn({ sessionId: id, err: err.message }, 'session error');
    };

    // Register tools for this session
    this.registerTools!(server);

    try {
      await server.connect(transport);

      // S-002 dispatch: SDK Protocol owns transport.onmessage after connect —
      // wrap it so registry-backed methods go to the MAIN server's handlers
      // (real schemas + gated handlers) while lifecycle stays per-session.
      const sdkOnMessage = transport.onmessage;
      transport.onmessage = (message, extra) => {
        this.serverCtx?.sessionManager?.heartbeat(id);
        this.dispatchToMain(id, transport, message, extra, sdkOnMessage);
      };

      log.info({ sessionId: id, remote }, 'session ready');
    } catch (err) {
      log.error({ sessionId: id, err }, 'failed to create session');
      this.sessions.delete(id);
      socket.destroy();
    }
  }

  /**
   * Route a registry-backed method to the main server's request handler.
   * Everything else falls through to the per-session SDK protocol handler.
   */
  private dispatchToMain(
    sessionId: string,
    transport: SocketTransport,
    message: JSONRPCMessage,
    extra: MessageExtraInfo | undefined,
    sdkOnMessage: ((message: JSONRPCMessage, extra?: MessageExtraInfo) => void) | undefined,
  ): void {
    const msg = message as { id?: string | number; method?: string; params?: Record<string, unknown> };
    const method = msg.method;

    // SPEC-01: client cancellation — abort the in-flight request's controller.
    if (method === 'notifications/cancelled') {
      const target = msg.params?.requestId;
      if (typeof target === 'string' || typeof target === 'number') {
        this.pendingRequests.get(`${sessionId}:${String(target)}`)?.abort(msg.params?.reason);
      }
      sdkOnMessage?.(message, extra);
      return;
    }

    const isRequest = msg.id !== undefined && typeof method === 'string';

    if (!isRequest || !MAIN_DISPATCH_METHODS.has(method)) {
      sdkOnMessage?.(message, extra);
      return;
    }

    const handler = this.mainHandlers?.get(method);
    if (!handler) {
      sdkOnMessage?.(message, extra);
      return;
    }

    // SEC-003 + AUD-01 transport-level gate (fail-closed for tcp) on every
    // dispatched method — evaluated before dispatch, same contract as the
    // HTTP adapter. tools/call resolves per-tool (mcp.authenticate stays
    // reachable); resources/prompts/completion require an authenticated
    // session.
    const gateDecision = this.authorizeMethodCall({
      method,
      toolName: method === 'tools/call' && typeof msg.params?.name === 'string' ? msg.params.name : undefined,
      sessionId,
    });
    if (!gateDecision.allowed) {
      void transport.send({
        jsonrpc: '2.0',
        id: msg.id as string | number,
        error: { code: -32001, message: gateDecision.reason },
      });
      return;
    }

    const requestId = msg.id as string | number;
    const controller = new AbortController();
    const pendingKey = `${sessionId}:${String(requestId)}`;
    this.pendingRequests.set(pendingKey, controller);

    const extraForHandler = {
      sessionId,
      requestId,
      signal: controller.signal,
    };

    void (async () => {
      try {
        const result = await handler(message, extraForHandler);
        await transport.send({
          jsonrpc: '2.0',
          id: requestId,
          result: result as Record<string, unknown>,
        });
      } catch (e) {
        const anyErr = e as { code?: number; message?: string };
        await transport.send({
          jsonrpc: '2.0',
          id: requestId,
          error: {
            code: typeof anyErr?.code === 'number' ? anyErr.code : -32603,
            message: anyErr?.message ?? String(e),
          },
        }).catch(() => {});
      } finally {
        this.pendingRequests.delete(pendingKey);
      }
    })();
  }

  async close(): Promise<void> {
    if (!this._connected) return;

    try {
      // Close all sessions
      const entries = Array.from(this.sessions.entries());
      if (entries.length > 0) {
        log.info({ count: entries.length }, 'closing sessions');
        await Promise.allSettled(
          entries.map(async ([_id, session]) => {
            try { await session.server.close(); } catch { /* ignore */ }
            try { await session.transport.close(); } catch { /* ignore */ }
          }),
        );
        this.sessions.clear();
      }

      // Close server
      if (this.server) {
        await new Promise<void>((resolve) => {
          this.server!.close(() => resolve());
        });
      }

      await this.extraCleanup?.();
    } finally {
      this._connected = false;
      this.server = undefined;
      this.serverCtx = undefined;
    }
  }

  get connected(): boolean {
    return this._connected;
  }

  get activeConnections(): number {
    return this.sessions.size;
  }

  /**
   * Get info about active sessions (for diagnostics/monitoring).
   */
  getSessionInfo(): Array<{ id: string; remote: string; durationMs: number }> {
    return Array.from(this.sessions.entries()).map(([id, s]) => ({
      id,
      remote: s.remote,
      durationMs: Date.now() - s.connectedAt,
    }));
  }

  health(): TransportHealth {
    const listening = this.server?.listening ?? false;
    return {
      type: this.type,
      healthy: this._connected && listening,
      connected: this._connected,
      details: {
        listening,
        activeConnections: this.sessions.size,
      },
    };
  }
}

// ─── TCP Transport ─────────────────────────────────────────────────────

export class TcpTransportAdapter extends StreamTransportAdapter {
  readonly type = 'tcp';
  private readonly port: number;
  private readonly host: string;

  constructor(
    port?: number,
    host?: string,
  ) {
    super();
    this.port = port ?? parseInt(process.env.MCP_TCP_PORT || '3002', 10);
    this.host = host ?? (process.env.MCP_TCP_HOST || '0.0.0.0');
  }

  protected async listen(): Promise<net.Server> {
    const server = net.createServer();
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, this.host, () => {
        log.info('MCP TCP listening on %s:%s', this.host, this.port);
        resolve(server);
      });
    });
  }
}

// ─── Unix Socket Transport ─────────────────────────────────────────────

export class UnixTransportAdapter extends StreamTransportAdapter {
  readonly type = 'unix';
  private readonly socketPath: string;

  constructor(
    socketPath?: string,
  ) {
    super();
    this.socketPath = socketPath ?? (process.env.MCP_UNIX_PATH || '/tmp/mcp-task-knowledge.sock');
  }

  protected async listen(): Promise<net.Server> {
    // AUD-09: stale socket cleanup — if the file exists, probe whether a live
    // listener is still bound to it. A live listener means another process
    // owns the socket → fail with a clear error instead of unlinking it out
    // from under the owner. A dead file (ENOENT on connect) is stale → remove.
    await this.removeStaleSocket();

    const server = net.createServer();
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.socketPath, () => {
        // AUD-09: restrict socket to owner-only. Without chmod the socket is
        // created with the process umask (typically 022 → srwxr-xr-x), so any
        // local user could connect and get full MCP access.
        try {
          fs.chmodSync(this.socketPath, 0o600);
        } catch (err) {
          log.warn({ err }, 'failed to chmod 600 unix socket %s', this.socketPath);
        }
        log.info('MCP Unix socket listening on %s', this.socketPath);
        resolve(server);
      });
    });
  }

  /**
   * AUD-09: remove the socket file only when it is stale (no live listener).
   * If a listener is still bound, throw a clear error — unlinking an active
   * socket would orphan the running server and let clients connect to a
   * socket path that no longer accepts connections.
   */
  private async removeStaleSocket(): Promise<void> {
    try {
      await fs.promises.stat(this.socketPath);
    } catch (err: any) {
      if (err.code === 'ENOENT') return; // nothing to clean
      throw err;
    }

    // File exists — probe for a live listener.
    const alive = await new Promise<boolean>((resolve) => {
      const probe = net.createConnection(this.socketPath);
      probe.once('connect', () => {
        probe.destroy();
        resolve(true);
      });
      probe.once('error', (err: any) => {
        // ECONNREFUSED/ENOENT → stale file, safe to remove.
        resolve(!(err.code === 'ECONNREFUSED' || err.code === 'ENOENT'));
      });
    });

    if (alive) {
      throw new Error(
        `[stream] unix socket ${this.socketPath} is already in use by a live listener — refusing to remove it`,
      );
    }

    await fs.promises.unlink(this.socketPath);
  }

  protected async extraCleanup(): Promise<void> {
    try {
      await fs.promises.unlink(this.socketPath);
    } catch {
      // Already removed
    }
  }

  get path(): string {
    return this.socketPath;
  }
}

// ─── Factories ─────────────────────────────────────────────────────────

export class TcpTransportFactory implements TransportFactory {
  readonly type = 'tcp';

  create(config: TransportConfig): TransportAdapter {
    const opts = config.options ?? {};
    const port = typeof opts.port === 'number'
      ? opts.port
      : parseInt(String(opts.port || process.env.MCP_TCP_PORT || '3002'), 10);
    const host = typeof opts.host === 'string'
      ? opts.host
      : String(opts.host || process.env.MCP_TCP_HOST || '0.0.0.0');

    return new TcpTransportAdapter(port, host);
  }
}

export class UnixTransportFactory implements TransportFactory {
  readonly type = 'unix';

  create(config: TransportConfig): TransportAdapter {
    const opts = config.options ?? {};
    const socketPath = typeof opts.path === 'string'
      ? opts.path
      : process.env.MCP_UNIX_PATH || '/tmp/mcp-task-knowledge.sock';

    return new UnixTransportAdapter(socketPath);
  }
}
