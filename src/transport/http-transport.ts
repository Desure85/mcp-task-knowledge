/**
 * HTTP (Streamable HTTP) Transport Adapter
 *
 * Serves MCP protocol over HTTP for Claude Desktop, Cursor, web clients.
 * Also exposes OpenAPI docs at `/api/*` routes.
 *
 * Configuration options (via TransportConfig.options or env vars):
 *   - port: number (default: 3001)
 *   - host: string (default: "0.0.0.0")
 */

import { StreamableHTTPServerTransport as SdkHttpTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { TransportConfig, TransportAdapter, TransportFactory, TransportHealth } from './types.js';
import type { ServerContext } from '../register/context.js';
import { createOpenAPIHandler } from '../register/openapi.js';
import { childLogger } from '../core/logger.js';
import { createMetricsHandler } from '../core/metrics.js';
import { createHealthHandlers, matchHealthEndpoint } from '../health/index.js';
import type { HealthChecker } from '../health/index.js';
import { getRealtimeServer } from './realtime.js';
import { decideToolCall, extractHttpCall, deniedJsonRpcBody } from '../core/auth-gate.js';

const log = childLogger('transport:http');

// ─── Adapter ──────────────────────────────────────────────────────────

export class HttpTransportAdapter implements TransportAdapter {
  readonly type = 'http';
  private transport?: SdkHttpTransport;
  private httpServer?: HttpServer;
  private _connected = false;
  private healthHandlers?: ReturnType<typeof createHealthHandlers>;
  private serverCtx?: ServerContext;
  private pendingInitRemotes: string[] = [];

  constructor(
    private readonly port: number = parseInt(process.env.MCP_PORT || '3001', 10),
    private readonly host: string = process.env.MCP_HOST || '0.0.0.0',
    private readonly healthChecker?: HealthChecker,
  ) {}

  get connected(): boolean {
    return this._connected;
  }

  /**
   * SEC-003 transport-level gate: deny unauthenticated tools/call before it
   * reaches the SDK. Reads ctx.authManager per request (lazy — AppContainer
   * attaches it during init). Non-tools/call traffic passes through.
   * Returns an HTTP status + JSON-RPC error body when denied, else undefined.
   */
  authorizeHttpCall(req: IncomingMessage, body: unknown): { status: number; body: string } | undefined {
    const bodies = Array.isArray(body) ? body : [body];
    for (const item of bodies) {
      const info = extractHttpCall(item);
      if (!info || info.method !== 'tools/call') continue;
      if (!info.toolName) {
        return { status: 401, body: deniedJsonRpcBody(info.id, 'missing tool name — fail-closed (SEC-003)') };
      }
      const headerSid = req.headers['mcp-session-id'];
      const sessionId = Array.isArray(headerSid) ? headerSid[0] : headerSid;
      const decision = decideToolCall(this.serverCtx?.authManager, 'http', {
        toolName: info.toolName,
        sessionId,
      });
      if (!decision.allowed) {
        return { status: 401, body: deniedJsonRpcBody(info.id, decision.reason) };
      }
    }
    return undefined;
  }

  async connect(ctx: ServerContext): Promise<void> {
    if (this._connected) {
      throw new Error('[http] already connected');
    }

    this.serverCtx = ctx;
    this.httpServer = createHttpServer();

    // PH-002: register SDK sessions in SessionManager under their own id
    // (== mcp-session-id header) so session_list/session_info, auth metadata
    // and JWT-expiry binding (A-003) all resolve against live sessions.
    // pendingInitRemotes is a FIFO: each initialize POST pushes one remote,
    // onsessioninitialized consumes one — correct under concurrent inits.
    this.transport = new SdkHttpTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId: string) => {
        const sm = this.serverCtx?.sessionManager;
        if (!sm) return;
        const remote = this.pendingInitRemotes.shift() ?? 'http';
        try {
          sm.create({ id: sessionId, remote, metadata: { transport: 'http' } });
        } catch (e) {
          log.warn({ sessionId, err: e }, 'session-manager rejected session create');
        }
      },
      onsessionclosed: (sessionId: string) => {
        void this.serverCtx?.sessionManager?.close(sessionId);
      },
    });

    const apiHandler = createOpenAPIHandler(ctx);

    // Create health handlers if a HealthChecker is provided
    if (this.healthChecker) {
      this.healthHandlers = createHealthHandlers(this.healthChecker);
    }

    this.httpServer.on('request', async (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url || '/';

      // Route /healthz, /readyz, /drainz to health handlers (SCALE-001)
      if (this.healthHandlers) {
        const healthEndpoint = matchHealthEndpoint(url);
        if (healthEndpoint) {
          await this.healthHandlers[healthEndpoint](req, res);
          return;
        }
      }

      // Route /metrics to Prometheus exporter
      if (url === '/metrics' || url === '/metrics/') {
        const metricsHandler = createMetricsHandler();
        if (metricsHandler) {
          await metricsHandler(req, res);
          return;
        }
      }

      // Route /api/* to OpenAPI handler
      if (url.startsWith('/api/')) {
        await apiHandler(req, res);
        return;
      }

      // MCP protocol requests
      if (req.method === 'POST') {
        const bodyChunks: Buffer[] = [];
        for await (const chunk of req) {
          bodyChunks.push(chunk);
        }
        const bodyStr = Buffer.concat(bodyChunks).toString('utf-8');
        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(bodyStr);
        } catch {
          parsedBody = bodyStr;
        }
        const denied = this.authorizeHttpCall(req, parsedBody);
        if (denied) {
          res.writeHead(denied.status, { 'Content-Type': 'application/json' });
          res.end(denied.body);
          return;
        }
        // PH-002: capture remote for the session being initialized so
        // onsessioninitialized can record it; consumed FIFO by the callback.
        const isInitialize = (Array.isArray(parsedBody) ? parsedBody : [parsedBody])
          .some((b) => (b as { method?: string } | null)?.method === 'initialize');
        if (isInitialize) {
          this.pendingInitRemotes.push(req.socket.remoteAddress ?? 'http');
        }
        await this.transport!.handleRequest(req, res, parsedBody);
        this.heartbeatSession(req);
      } else {
        await this.transport!.handleRequest(req, res);
        this.heartbeatSession(req);
      }
    });

    await ctx.server.connect(this.transport);
    this._connected = true;

    if (process.env.MCP_REALTIME !== '0') {
      getRealtimeServer().attach(this.httpServer, '/ws');
      log.info('Realtime WS: /ws');
    }

    this.httpServer.listen(this.port, this.host, () => {
      log.info('MCP Streamable HTTP listening on http://%s:%s', this.host, this.port);
      log.info('API docs: http://%s:%s/api/docs', this.host, this.port);
      if (createMetricsHandler()) {
        log.info('Prometheus metrics: http://%s:%s/metrics', this.host, this.port);
      }
    });
  }

  /** PH-002: reset idle timer for the session carried by mcp-session-id. */
  private heartbeatSession(req: IncomingMessage): void {
    const headerSid = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(headerSid) ? headerSid[0] : headerSid;
    if (sessionId) {
      this.serverCtx?.sessionManager?.heartbeat(sessionId);
    }
  }

  async close(): Promise<void> {
    if (!this._connected) {
      return;
    }

    try {
      if (this.transport) {
        await this.transport.close();
      }
      if (process.env.MCP_REALTIME !== '0') {
        const { resetRealtimeServer } = await import('./realtime.js');
        resetRealtimeServer();
      }
      if (this.httpServer) {
        await new Promise<void>((resolve) => {
          this.httpServer!.close(() => resolve());
        });
      }
    } finally {
      this._connected = false;
      this.transport = undefined;
      this.httpServer = undefined;
      this.serverCtx = undefined;
    }
  }

  health(): TransportHealth {
    const listening = this.httpServer?.listening ?? false;
    return {
      type: this.type,
      healthy: this._connected && listening,
      connected: this._connected,
      details: {
        port: this.port,
        host: this.host,
        listening,
      },
    };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────

export class HttpTransportFactory implements TransportFactory {
  readonly type = 'http';

  create(config: TransportConfig): TransportAdapter {
    const opts = config.options ?? {};
    const port = typeof opts.port === 'number'
      ? opts.port
      : parseInt(String(opts.port || process.env.MCP_PORT || '3001'), 10);
    const host = typeof opts.host === 'string'
      ? opts.host
      : String(opts.host || process.env.MCP_HOST || '0.0.0.0');
    const healthChecker = opts.healthChecker as HealthChecker | undefined;

    return new HttpTransportAdapter(port, host, healthChecker);
  }
}
