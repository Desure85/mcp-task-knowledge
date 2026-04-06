/**
 * Prometheus metrics module (F-005)
 *
 * Exports a /metrics endpoint compatible with Prometheus scraping.
 * Tracks:
 *   - mcp_tool_calls_total — counter per tool name + status (success/error)
 *   - mcp_tool_call_duration_seconds — histogram per tool name
 *   - mcp_resource_reads_total — counter per resource URI prefix
 *   - mcp_server_info — gauge with version, uptime, transport, tool count
 *
 * Enable/disable via METRICS_ENABLED env var (default: true for http, false for stdio).
 */

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics, register as globalRegistry } from 'prom-client';

// ---------- singleton ----------

let _registry: Registry | undefined;
let _counters: {
  toolCalls: Counter<string>;
  resourceReads: Counter<string>;
} | undefined;
let _histograms: {
  toolDuration: Histogram<string>;
} | undefined;
let _gauges: {
  serverInfo: Gauge<string>;
} | undefined;

/**
 * Reset all internal state. For testing only.
 */
export function _resetMetrics(): void {
  _registry = undefined;
  _counters = undefined;
  _histograms = undefined;
  _gauges = undefined;
  // Clear any metrics registered in the global prom-client registry
  try {
    globalRegistry.clear();
  } catch {}
}

function ensureMetricsEnabled(): boolean {
  const env = process.env.METRICS_ENABLED;
  if (env !== undefined) {
    return ['1', 'true', 'yes'].includes(env.toLowerCase());
  }
  // Default: enabled for http transport, disabled for stdio
  const transport = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase();
  return transport !== 'stdio';
}

/**
 * Initialize metrics. Call once during startup.
 * No-op if metrics are disabled.
 */
export function initMetrics(opts?: { version?: string; defaultMetrics?: boolean }): Registry | undefined {
  if (!ensureMetricsEnabled()) return undefined;
  if (_registry) return _registry;

  _registry = new Registry();

  // Optional: Node.js default metrics (process CPU, memory, GC, event loop lag)
  if (opts?.defaultMetrics !== false) {
    collectDefaultMetrics({ register: _registry, prefix: 'mcp_' });
  }

  // mcp_tool_calls_total{tool="name",status="success|error"}
  _counters = {
    toolCalls: new Counter({
      name: 'mcp_tool_calls_total',
      help: 'Total MCP tool invocations',
      labelNames: ['tool', 'status'] as const,
      registers: [_registry],
    }),
    resourceReads: new Counter({
      name: 'mcp_resource_reads_total',
      help: 'Total MCP resource reads',
      labelNames: ['uri_prefix', 'status'] as const,
      registers: [_registry],
    }),
  };

  // mcp_tool_call_duration_seconds{tool="name"}
  _histograms = {
    toolDuration: new Histogram({
      name: 'mcp_tool_call_duration_seconds',
      help: 'MCP tool call duration in seconds',
      labelNames: ['tool'] as const,
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [_registry],
    }),
  };

  // mcp_server_info{version="...",transport="..."} = 1 (uptime via process_start_time_seconds from default metrics)
  _gauges = {
    serverInfo: new Gauge({
      name: 'mcp_server_info',
      help: 'MCP server metadata (always 1)',
      labelNames: ['version', 'transport', 'tools_registered'] as const,
      registers: [_registry],
    }),
  };

  // Set initial server info gauge
  const version = opts?.version || '0.0.0';
  const transport = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase();
  _gauges.serverInfo.set({ version, transport, tools_registered: '0' }, 1);

  return _registry;
}

/**
 * Get the metrics registry (undefined if not initialized or disabled).
 */
export function getMetricsRegistry(): Registry | undefined {
  return _registry;
}

/**
 * Record a tool call. Call after tool execution completes.
 */
export function recordToolCall(toolName: string, durationMs: number, error?: Error): void {
  if (!_counters || !_histograms) return;
  const status = error ? 'error' : 'success';
  _counters.toolCalls.labels({ tool: toolName, status }).inc();
  _histograms.toolDuration.labels({ tool: toolName }).observe(durationMs / 1000);
}

/**
 * Record a resource read.
 */
export function recordResourceRead(uriPrefix: string, error?: Error): void {
  if (!_counters) return;
  const status = error ? 'error' : 'success';
  _counters.resourceReads.labels({ uri_prefix: uriPrefix, status }).inc();
}

/**
 * Update server info gauge (e.g. after tools are registered).
 */
export function updateServerInfo(opts: { version?: string; toolCount?: number }): void {
  if (!_gauges) return;
  const version = opts.version || '0.0.0';
  const transport = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase();
  _gauges.serverInfo.set(
    { version, transport, tools_registered: String(opts.toolCount ?? 0) },
    1,
  );
}

/**
 * Return async handler suitable for HTTP /metrics endpoint.
 * Returns undefined if metrics are disabled.
 */
/** Minimal interface for HTTP ServerResponse (Node.js IncomingMessage/ServerResponse). */
export interface MetricsHttpResponse {
  setHeader(name: string, value: string | string[]): void;
  end(data?: string): void;
  statusCode?: number;
}

export function createMetricsHandler(): ((req: unknown, res: MetricsHttpResponse) => Promise<void>) | undefined {
  const registry = _registry;
  if (!registry) return undefined;
  return async (_req: unknown, res: MetricsHttpResponse) => {
    try {
      res.setHeader('Content-Type', registry.contentType);
      res.end(await registry.metrics());
    } catch (err) {
      res.statusCode = 500;
      res.end('# ERROR: failed to collect metrics\n');
    }
  };
}

/**
 * Wrap a tool handler with metrics collection.
 * Usage: wrapToolHandler('tool_name', originalHandler)
 */
export function wrapToolHandler<TParams = Record<string, unknown>, TResult = unknown>(
  toolName: string,
  handler: (params: TParams) => Promise<TResult>,
): (params: TParams) => Promise<TResult> {
  return async (params: TParams): Promise<TResult> => {
    const start = Date.now();
    try {
      const result = await handler(params);
      recordToolCall(toolName, Date.now() - start);
      return result;
    } catch (err) {
      recordToolCall(toolName, Date.now() - start, err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  };
}
