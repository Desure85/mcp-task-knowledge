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
import type { TransportConfig, TransportAdapter, TransportFactory } from './types.js';
import type { ServerContext } from '../register/context.js';
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
abstract class StreamTransportAdapter implements TransportAdapter {
  private server?: net.Server;
  private sessions = new Map<string, ActiveSession>();
  private nextId = 0;
  private _connected = false;
  private serverInfo?: { name: string; version: string };
  private registerTools?: (server: McpServer) => void;

  abstract readonly type: string;

  /** Create the net.Server and start listening. Returns the server. */
  protected abstract listen(): Promise<net.Server>;

  /** Extra cleanup after close (e.g., remove Unix socket file). */
  protected extraCleanup?(): Promise<void>;

  async connect(ctx: ServerContext): Promise<void> {
    if (this._connected) {
      throw new Error(`[${this.type}] already connected`);
    }

    // Extract server info from context
    const rawServer = ctx.server as unknown as Record<string, unknown>;
    const serverInfo = rawServer?.server as Record<string, unknown> | undefined;
    const implementation = serverInfo?._implementation as { name: string; version: string } | undefined;
    this.serverInfo = {
      name: implementation?.name ?? 'mcp-task-knowledge',
      version: implementation?.version ?? '0.0.0',
    };

    // Store registration callback — will be used per-connection
    // We need to call defaultRegistration for each new McpServer
    // Since defaultRegistration operates on ServerContext (not McpServer directly),
    // we create a minimal wrapper that registers tools via the McpServer API
    this.registerTools = (_server: McpServer) => {
      // Per-session full tool registration requires S-002 (ToolExecutor).
      // For now, each session gets a clean McpServer connected to its socket.
      // The actual tool routing will be implemented when SessionManager (S-001)
      // provides per-session contexts.
      log.debug({ sessionId: 'new' }, 'session created — tool registration deferred to S-002');
    };

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

    // Create a new McpServer for this session
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

    // Wire transport callbacks
    transport.onclose = () => {
      const duration = Date.now() - (this.sessions.get(id)?.connectedAt ?? Date.now());
      log.info({ sessionId: id, remote, durationMs: duration }, 'session closed');
      this.sessions.delete(id);
    };

    transport.onerror = (err) => {
      log.warn({ sessionId: id, err: err.message }, 'session error');
    };

    // Register tools for this session
    this.registerTools!(server);

    try {
      await server.connect(transport);
      log.info({ sessionId: id, remote }, 'session ready');
    } catch (err) {
      log.error({ sessionId: id, err }, 'failed to create session');
      this.sessions.delete(id);
      socket.destroy();
    }
  }

  async close(): Promise<void> {
    if (!this._connected) return;

    try {
      // Close all sessions
      const entries = Array.from(this.sessions.entries());
      if (entries.length > 0) {
        log.info({ count: entries.length }, 'closing sessions');
        await Promise.allSettled(
          entries.map(async ([id, session]) => {
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
    // Remove stale socket file
    try {
      await fs.promises.unlink(this.socketPath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }

    const server = net.createServer();
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.socketPath, () => {
        log.info('MCP Unix socket listening on %s', this.socketPath);
        resolve(server);
      });
    });
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
