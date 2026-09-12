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
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
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
import { buildSetupMarkdown } from '../core/setup-link.js';
import { getCurrentProject } from '../config.js';
import { createTlsContext, type TlsContext } from './tls.js';

const log = childLogger('transport:http');

/**
 * AUD-08: max POST body size for MCP protocol requests.
 * Env: MCP_MAX_BODY_BYTES (default 10 MiB). Content-Length is checked first
 * (fast reject), then bytes are counted during streaming — Content-Length can
 * lie or be absent (chunked transfer).
 */
const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

function maxBodyBytes(): number {
  const raw = process.env.MCP_MAX_BODY_BYTES;
  if (!raw) return DEFAULT_MAX_BODY_BYTES;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BODY_BYTES;
}

class BodyTooLargeError extends Error {
  constructor(public readonly limit: number) {
    super(`request body exceeds ${limit} bytes`);
    this.name = 'BodyTooLargeError';
  }
}

/**
 * Read a POST body with a hard byte cap. Checks Content-Length up front,
 * then counts actual streamed bytes. On overflow throws BodyTooLargeError
 * and destroys the request stream so no further buffering happens.
 */
async function readBodyWithCap(req: IncomingMessage, limit: number): Promise<string> {
  const contentLength = req.headers['content-length'];
  if (contentLength) {
    const declared = parseInt(Array.isArray(contentLength) ? contentLength[0] : contentLength, 10);
    if (Number.isFinite(declared) && declared > limit) {
      throw new BodyTooLargeError(limit);
    }
  }
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    received += (chunk as Buffer).length;
    if (received > limit) {
      throw new BodyTooLargeError(limit);
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

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
  private httpServer?: HttpServer | HttpsServer;
  private _connected = false;
  private healthHandlers?: ReturnType<typeof createHealthHandlers>;
  private serverCtx?: ServerContext;
  private tlsContext?: TlsContext;
  /** Live SDK transports keyed by mcp-session-id (one transport per session). */
  private sessions = new Map<string, SdkHttpTransport>();
  private serverInfo?: { name: string; version: string };
  private mainHandlers?: Map<string, MainRequestHandler>;
  /**
   * SPEC-01: real AbortControllers for requests dispatched to main handlers.
   * Keyed by `${sessionId}:${requestId}` so a notifications/cancelled from
   * the client aborts in-flight work instead of the fabricated
   * never-aborting signal we used to pass.
   */
  private pendingRequests = new Map<string, AbortController>();

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
    // AUD-17: TLS is opt-in via TLS_CERT_PATH/TLS_KEY_PATH (see tls.ts).
    // When enabled the adapter serves HTTPS; otherwise plain HTTP.
    this.tlsContext = createTlsContext();
    this.httpServer = this.tlsContext.isEnabled && this.tlsContext.isReady
      ? createHttpsServer(this.tlsContext.createServerOptions())
      : createHttpServer();
    if (this.tlsContext.isEnabled && !this.tlsContext.isReady) {
      log.warn('TLS_CERT_PATH/TLS_KEY_PATH set but context failed to load — serving plain HTTP');
    }

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

      // DX-29: one-time setup links.
      // POST /admin/setup-links — admin-only (session metadata role 'admin').
      if (req.method === 'POST' && (url === '/admin/setup-links' || url === '/admin/setup-links/')) {
        await this.handleCreateSetupLink(req, res);
        return;
      }
      // GET /.well-known/mcp-setup/<otp> — public one-time reveal.
      if (req.method === 'GET' && url.startsWith('/.well-known/mcp-setup/')) {
        await this.handleRedeemSetupLink(req, res, url);
        return;
      }

      // MCP protocol requests — routed by mcp-session-id to that session's
      // transport; a sessionless initialize creates a new one (PH-002b).
      const sessionId = this.sessionIdOf(req);
      const existing = sessionId ? this.sessions.get(sessionId) : undefined;

      if (req.method === 'POST') {
        let bodyStr: string;
        try {
          bodyStr = await readBodyWithCap(req, maxBodyBytes());
        } catch (e) {
          if (e instanceof BodyTooLargeError) {
            // shouldKeepAlive=false: Node drains/closes the connection after
            // the response instead of leaving a half-read body on a kept-alive
            // socket. The request stream is abandoned — no further buffering.
            res.shouldKeepAlive = false;
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: `Payload Too Large: body exceeds ${e.limit} bytes` },
              id: null,
            }));
            req.destroy();
            return;
          }
          throw e;
        }
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
        // AUD-14: remote is passed per-request (was a shared FIFO queue —
        // parallel initialize POSTs could attribute the wrong remote IP to
        // a session, and a failed init leaked the queue entry forever).
        const transport = await this.createSessionTransport(req.socket.remoteAddress ?? 'http');
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
      const auth = this.serverCtx?.authManager;
      const tokenValidator = auth?.isAuthRequired()
        ? async (token: string | null): Promise<boolean> => {
            if (!token) return false;
            // AUD-15: validateToken, not authenticate — the WS path only needs
            // an allow/deny verdict. authenticate() would mark a phantom
            // 'ws:<token>' session in authenticatedSessions that no close
            // path ever revokes (unbounded growth).
            return (await auth.validateToken(token)) !== null;
          }
        : undefined;
      getRealtimeServer().attach(this.httpServer, '/ws', { tokenValidator });
      log.info('Realtime WS: /ws');
    }

    this.httpServer.listen(this.port, this.host, () => {
      const scheme = this.tlsContext?.isReady ? 'https' : 'http';
      log.info('MCP Streamable HTTP listening on %s://%s:%s', scheme, this.host, this.port);
      log.info('API docs: %s://%s:%s/api/docs', scheme, this.host, this.port);
      if (createMetricsHandler()) {
        log.info('Prometheus metrics: %s://%s:%s/metrics', scheme, this.host, this.port);
      }
    });
  }

  /** DX-29: create a setup link. Requires an authenticated admin session. */
  private async handleCreateSetupLink(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const store = this.serverCtx?.setupLinkStore;
    if (!store) {
      json(503, { ok: false, error: { message: 'setup links unavailable — no token issuer configured' } });
      return;
    }
    const sessionId = this.sessionIdOf(req);
    const auth = this.serverCtx?.authManager;
    if (auth?.isAuthRequired() && (!sessionId || !auth.isAuthenticated(sessionId))) {
      json(401, { ok: false, error: { message: 'authentication required' } });
      return;
    }
    const roles = sessionId
      ? (this.serverCtx?.sessionManager?.get(sessionId)?.metadata?.roles as string[] | undefined) ?? []
      : [];
    if (auth?.isAuthRequired() && !roles.includes('admin')) {
      json(403, { ok: false, error: { message: 'admin role required' } });
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}') as Record<string, unknown>;
    } catch { /* empty/invalid body → defaults */ }

    const project = typeof body.project === 'string' && body.project.trim()
      ? body.project.trim()
      : getCurrentProject();
    const role = typeof body.role === 'string' && body.role.trim() ? body.role.trim() : 'agent';
    const ttlMs = typeof body.ttlMs === 'number' && body.ttlMs > 0 ? Math.min(body.ttlMs, 60 * 60 * 1000) : undefined;

    const link = await store.create({ project, role, ttlMs, createdBy: sessionId ?? 'http' });
    const base = this.publicBaseUrl(req);
    json(201, {
      ok: true,
      data: {
        url: `${base}/.well-known/mcp-setup/${link.otp}`,
        expiresAt: new Date(link.expiresAt).toISOString(),
        otp: link.otp,
      },
    });
  }

  /** DX-29: one-time reveal of the setup markdown document. */
  private async handleRedeemSetupLink(req: IncomingMessage, res: ServerResponse, url: string): Promise<void> {
    const gone = (reason: string) => {
      res.writeHead(410, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: { message: `setup link unavailable: ${reason}` } }));
    };
    const store = this.serverCtx?.setupLinkStore;
    if (!store) {
      gone('disabled');
      return;
    }
    const otp = decodeURIComponent(url.slice('/.well-known/mcp-setup/'.length).replace(/\/+$/, ''));
    if (!/^[0-9a-fA-F-]{36}$/.test(otp)) {
      gone('not_found');
      return;
    }
    const clientIp = req.socket.remoteAddress;
    const result = store.redeem(otp, clientIp);
    if (result.status !== 'ok') {
      gone(result.reason);
      return;
    }
    const markdown = buildSetupMarkdown(result.link, {
      serverUrl: this.publicBaseUrl(req),
      transport: 'http',
      serverName: this.serverInfo?.name,
      serverVersion: this.serverInfo?.version,
      toolCount: this.serverCtx?.toolNames?.size,
    });
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(markdown);
  }

  private publicBaseUrl(req: IncomingMessage): string {
    const proto = (req.headers['x-forwarded-proto'] as string | undefined)
      ?? (this.tlsContext?.isReady ? 'https' : 'http');
    const host = req.headers.host ?? `${this.host}:${this.port}`;
    return `${proto}://${host}`;
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
  private async createSessionTransport(remote: string): Promise<SdkHttpTransport> {
    const transport = new SdkHttpTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: async (sessionId: string) => {
        this.sessions.set(sessionId, transport);
        const sm = this.serverCtx?.sessionManager;
        if (!sm) return;
        try {
          sm.create({
            id: sessionId,
            remote,
            metadata: { transport: 'http' },
            onClose: async (sid) => {
              this.serverCtx?.authManager?.revokeSession(sid);
              this.sessions.get(sid)?.close().catch(() => undefined);
              this.sessions.delete(sid);
            },
          });
        } catch (e) {
          log.warn({ sessionId, err: e }, 'session-manager rejected session create');
          // AUD-08: the transport was registered in this.sessions above, before
          // sm.create() ran — a rejected session would otherwise leak a live
          // transport that keeps serving requests past the cap. Remove it,
          // close it, then rethrow so the SDK answers the initialize POST
          // with a JSON-RPC error instead of a success for a session the
          // SessionManager never accepted.
          this.sessions.delete(sessionId);
          await transport.close().catch(() => undefined);
          throw e;
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

    // SPEC-01: client cancellation — abort the in-flight request's controller.
    if (method === 'notifications/cancelled') {
      const target = msg.params?.requestId;
      const sid = transport.sessionId;
      if (sid && (typeof target === 'string' || typeof target === 'number')) {
        this.pendingRequests.get(`${sid}:${String(target)}`)?.abort(msg.params?.reason);
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
    const controller = new AbortController();
    const pendingKey = `${transport.sessionId ?? ''}:${String(requestId)}`;
    this.pendingRequests.set(pendingKey, controller);

    const extraForHandler = {
      sessionId: transport.sessionId,
      requestId,
      signal: controller.signal,
    };

    void (async () => {
      try {
        const result = await handler(message, extraForHandler);
        await transport.send(
          { jsonrpc: '2.0', id: requestId, result: result as Record<string, unknown> },
          { relatedRequestId: requestId },
        );
      } catch (e) {
        // AUD-12: generic message to the client — handler errors can carry
        // internal paths/details. Full error goes to the server log.
        log.warn({ sessionId: transport.sessionId, requestId, err: e }, 'main handler threw — generic error to client');
        const anyErr = e as { code?: number };
        await transport.send(
          {
            jsonrpc: '2.0',
            id: requestId,
            error: {
              code: typeof anyErr?.code === 'number' ? anyErr.code : -32603,
              message: 'Internal error',
            },
          },
          { relatedRequestId: requestId },
        ).catch(() => {});
      } finally {
        this.pendingRequests.delete(pendingKey);
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
      this.tlsContext?.dispose();
      this.tlsContext = undefined;
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
