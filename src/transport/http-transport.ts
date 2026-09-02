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

const log = childLogger('transport:http');

// ─── Adapter ──────────────────────────────────────────────────────────

export class HttpTransportAdapter implements TransportAdapter {
  readonly type = 'http';
  private transport?: SdkHttpTransport;
  private httpServer?: HttpServer;
  private _connected = false;
  private healthHandlers?: ReturnType<typeof createHealthHandlers>;

  constructor(
    private readonly port: number = parseInt(process.env.MCP_PORT || '3001', 10),
    private readonly host: string = process.env.MCP_HOST || '0.0.0.0',
    private readonly healthChecker?: HealthChecker,
  ) {}

  get connected(): boolean {
    return this._connected;
  }

  async connect(ctx: ServerContext): Promise<void> {
    if (this._connected) {
      throw new Error('[http] already connected');
    }

    this.httpServer = createHttpServer();

    this.transport = new SdkHttpTransport({
      sessionIdGenerator: () => randomUUID(),
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
        await this.transport!.handleRequest(req, res, parsedBody);
      } else {
        await this.transport!.handleRequest(req, res);
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
