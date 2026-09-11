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
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js';
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
import { decideMethodCall, extractHttpCall, deniedJsonRpcBody } from '../core/auth-gate.js';

const log = childLogger('transport:http');

/**
 * PH-002b: JSON-RPC methods routed to the MAIN server's request handlers —
 * the same S-002 dispatch contract as the TCP/Unix adapter. One MCP SDK
 * StreamableHTTPServerTransport == one session == one pending-request
 * stream map, so each session gets its own transport + a lightweight
 * per-session McpServer for lifecycle; registry-backed methods dispatch
 * into the shared main handlers (real schemas + gated handlers).
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

// ─── CORS (browser MCP clients / web-ui) ─────────────────────────────
// Off by default. MCP_CORS_ORIGIN: comma-separated origins or '*'.
// Browsers must be able to READ mcp-session-id to keep the session, so it
// is always in Expose-Headers when CORS is enabled.
function corsAllowedOrigin(req: IncomingMessage): string | undefined {
  const cfg = process.env.MCP_CORS_ORIGIN?.trim();
  if (!cfg) return undefined;
  const origin = req.headers.origin;
  if (!origin) return undefined;
  if (cfg === '*') return '*';
  const allowed = cfg.split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : undefined;
}

function applyCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const allow = corsAllowedOrigin(req);
  if (!allow) return;
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
}

function handleCorsPreflight(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'OPTIONS') return false;
  const allow = corsAllowedOrigin(req);
  if (!allow) {
    res.writeHead(403);
    res.end();
    return true;
  }
  res.writeHead(204, {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization, mcp-session-id, mcp-protocol-version, last-event-id',
    'Access-Control-Expose-Headers': 'mcp-session-id',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  });
  res.end();
  return true;
}

// ─── Adapter ──────────────────────────────────────────────────────────

export class HttpTransportAdapter implements TransportAdapter {
  readonly type = 'http';
  private httpServer?: HttpServer;
  private _connected = false;
  private healthHandlers?: ReturnType<typeof createHealthHandlers>;
  private serverCtx?: ServerContext;
  /** Live SDK transports keyed by mcp-session-id (one transport per session). */
  private sessions = new Map<string, SdkHttpTransport>();
  private pendingInitRemotes: string[] = [];
  private serverInfo?: { name: string; version: string };
  private mainHandlers?: Map<string, MainRequestHandler>;

  constructor(
    private readonly port: number = parseInt(process.env.MCP_PORT || '3001', 10),
    private readonly host: string = process.env.MCP_HOST || '0.0.0.0',
    private readonly healthChecker?: HealthChecker,
  ) {}

  get connected(): boolean {
    return this._connected;
  }

  /**
   * SEC-003 + AUD-01 transport-level gate: deny unauthenticated MCP methods
   * before they reach the SDK. Previously only tools/call was checked —
   * resources/*, prompts/* and completion/* bypassed auth entirely.
   * Reads ctx.authManager per request (lazy — AppContainer attaches it
   * during init). Returns an HTTP status + JSON-RPC error body when denied,
   * else undefined.
   */
  authorizeHttpCall(req: IncomingMessage, body: unknown): { status: number; body: string } | undefined {
    const bodies = Array.isArray(body) ? body : [body];
    const headerSid = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(headerSid) ? headerSid[0] : headerSid;
    for (const item of bodies) {
      const info = extractHttpCall(item);
      if (!info || !info.method) continue;
      const decision = decideMethodCall(this.serverCtx?.authManager, 'http', {
        method: info.method,
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

    // Server info for per-session lifecycle servers.
    const rawServer = ctx.server as unknown as Record<string, unknown>;
    const implementation = (rawServer?.server as Record<string, unknown> | undefined)
      ?._implementation as { name: string; version: string } | undefined;
    this.serverInfo = {
      name: implementation?.name ?? 'mcp-task-knowledge',
      version: implementation?.version ?? '0.0.0',
    };

    // S-002: capture the MAIN server's request handlers (same as the
    // stream adapter) — SDK wrappers parse raw requests themselves.
    const mainBase = (ctx.server as unknown as Record<string, unknown>)?.server as
      | { _requestHandlers?: Map<string, MainRequestHandler> }
      | undefined;
    this.mainHandlers = mainBase?._requestHandlers instanceof Map ? mainBase._requestHandlers : undefined;
    if (!this.mainHandlers) {
      log.warn('main server request handlers unavailable — http sessions will expose no tools');
    }

    const apiHandler = createOpenAPIHandler(ctx);

    // Create health handlers if a HealthChecker is provided
    if (this.healthChecker) {
      this.healthHandlers = createHealthHandlers(this.healthChecker);
    }

    this.httpServer.on('request', async (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url || '/';

      // CORS: preflight short-circuit, then expose headers on real responses.
      if (handleCorsPreflight(req, res)) return;
      applyCorsHeaders(req, res);

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

      // MCP protocol requests — routed by mcp-session-id to that session's
      // transport; a sessionless initialize creates a new one (PH-002b).
      const sessionId = this.sessionIdOf(req);
      const existing = sessionId ? this.sessions.get(sessionId) : undefined;

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
        if (existing) {
          await existing.handleRequest(req, res, parsedBody);
          this.heartbeatSession(req);
          return;
        }
        const isInitialize = (Array.isArray(parsedBody) ? parsedBody : [parsedBody])
          .some((b) => (b as { method?: string } | null)?.method === 'initialize');
        if (!isInitialize) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
            id: null,
          }));
          return;
        }
        // New session: dedicated transport + lightweight lifecycle server.
        this.pendingInitRemotes.push(req.socket.remoteAddress ?? 'http');
        const transport = await this.createSessionTransport();
        await transport.handleRequest(req, res, parsedBody);
        return;
      }

      // GET (SSE stream) / DELETE (session close) route by session id.
      if (existing) {
        await existing.handleRequest(req, res);
        this.heartbeatSession(req);
        return;
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      }));
    });

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

  /** mcp-session-id header value, if present. */
  private sessionIdOf(req: IncomingMessage): string | undefined {
    const h = req.headers['mcp-session-id'];
    return Array.isArray(h) ? h[0] : h;
  }

  /** PH-002: reset idle timer for the session carried by mcp-session-id. */
  private heartbeatSession(req: IncomingMessage): void {
    const sessionId = this.sessionIdOf(req);
    if (sessionId) {
      this.serverCtx?.sessionManager?.heartbeat(sessionId);
    }
  }

  /**
   * PH-002b: dedicated SDK transport + lightweight per-session McpServer
   * (lifecycle only). Registry-backed methods are dispatched to the MAIN
   * server's handlers via the wrapped onmessage — same contract as the
   * TCP/Unix adapter (S-002).
   */
  private async createSessionTransport(): Promise<SdkHttpTransport> {
    const transport = new SdkHttpTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId: string) => {
        this.sessions.set(sessionId, transport);
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
        this.sessions.delete(sessionId);
        void this.serverCtx?.sessionManager?.close(sessionId);
      },
    });

    const sessionServer = new McpServer({
      name: this.serverInfo?.name ?? 'mcp-task-knowledge',
      version: this.serverInfo?.version ?? '0.0.0',
    });
    await sessionServer.connect(transport);

    // Dispatch registry-backed methods to main handlers; lifecycle stays
    // on the per-session server.
    const sdkOnMessage = transport.onmessage;
    transport.onmessage = (message, extra) => {
      const sid = transport.sessionId;
      if (sid) this.serverCtx?.sessionManager?.heartbeat(sid);
      this.dispatchToMain(transport, message, extra, sdkOnMessage);
    };

    // Defensive cleanup when the transport dies without a DELETE.
    const sdkOnClose = transport.onclose;
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        this.sessions.delete(sid);
        void this.serverCtx?.sessionManager?.close(sid);
      }
      sdkOnClose?.();
    };

    return transport;
  }

  /**
   * Route a registry-backed method to the main server's request handler.
   * Responses carry relatedRequestId so StreamableHTTP writes them back on
   * the POST's own response stream (the request→stream map is per-session).
   */
  private dispatchToMain(
    transport: SdkHttpTransport,
    message: JSONRPCMessage,
    extra: MessageExtraInfo | undefined,
    sdkOnMessage: ((message: JSONRPCMessage, extra?: MessageExtraInfo) => void) | undefined,
  ): void {
    const msg = message as { id?: string | number; method?: string; params?: Record<string, unknown> };
    const method = msg.method;
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

    // AUD-01: defense-in-depth — POSTs are already gated in
    // authorizeHttpCall, but gate again here so no dispatch path can serve
    // registry methods to an unauthenticated session.
    const gateDecision = decideMethodCall(this.serverCtx?.authManager, 'http', {
      method,
      toolName: method === 'tools/call' ? (msg.params?.name as string | undefined) : undefined,
      sessionId: transport.sessionId,
    });
    if (!gateDecision.allowed) {
      void transport.send(
        {
          jsonrpc: '2.0',
          id: msg.id as string | number,
          error: { code: -32001, message: gateDecision.reason },
        },
        { relatedRequestId: msg.id as string | number },
      ).catch(() => {});
      return;
    }

    const requestId = msg.id as string | number;
    const extraForHandler = {
      sessionId: transport.sessionId,
      requestId,
      signal: new AbortController().signal,
    };

    void (async () => {
      try {
        const result = await handler(message, extraForHandler);
        await transport.send(
          { jsonrpc: '2.0', id: requestId, result: result as Record<string, unknown> },
          { relatedRequestId: requestId },
        );
      } catch (e) {
        const anyErr = e as { code?: number; message?: string };
        await transport.send(
          {
            jsonrpc: '2.0',
            id: requestId,
            error: {
              code: typeof anyErr?.code === 'number' ? anyErr.code : -32603,
              message: anyErr?.message ?? String(e),
            },
          },
          { relatedRequestId: requestId },
        ).catch(() => {});
      }
    })();
  }

  async close(): Promise<void> {
    if (!this._connected) {
      return;
    }

    try {
      const transports = Array.from(this.sessions.values());
      this.sessions.clear();
      await Promise.allSettled(transports.map((t) => t.close()));
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
