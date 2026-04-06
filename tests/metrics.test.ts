import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initMetrics, getMetricsRegistry, recordToolCall, recordResourceRead, updateServerInfo, createMetricsHandler, wrapToolHandler, _resetMetrics } from '../src/core/metrics.js';

describe('core/metrics', () => {
  beforeEach(() => {
    _resetMetrics();
    delete process.env.METRICS_ENABLED;
    delete process.env.MCP_TRANSPORT;
  });

  describe('initMetrics', () => {
    it('returns undefined when metrics are disabled (stdio default)', () => {
      process.env.MCP_TRANSPORT = 'stdio';
      delete process.env.METRICS_ENABLED;
      const reg = initMetrics();
      expect(reg).toBeUndefined();
    });

    it('returns undefined when METRICS_ENABLED=0', () => {
      process.env.METRICS_ENABLED = '0';
      const reg = initMetrics();
      expect(reg).toBeUndefined();
    });

    it('returns a registry when METRICS_ENABLED=1', () => {
      process.env.METRICS_ENABLED = '1';
      const reg = initMetrics({ version: '1.0.0', defaultMetrics: false });
      expect(reg).toBeDefined();
    });

    it('returns a registry when transport is http and METRICS_ENABLED not set', () => {
      process.env.MCP_TRANSPORT = 'http';
      const reg = initMetrics({ version: '1.0.0', defaultMetrics: false });
      expect(reg).toBeDefined();
    });

    it('is idempotent — returns same registry on repeated calls', () => {
      process.env.METRICS_ENABLED = '1';
      const a = initMetrics({ version: '1.0.0', defaultMetrics: false });
      const b = initMetrics({ version: '1.0.0', defaultMetrics: false });
      expect(a).toBe(b);
    });
  });

  describe('getMetricsRegistry', () => {
    it('returns undefined when not initialized', () => {
      expect(getMetricsRegistry()).toBeUndefined();
    });

    it('returns registry after init', () => {
      process.env.METRICS_ENABLED = '1';
      const reg = initMetrics({ version: '1.0.0', defaultMetrics: false });
      expect(getMetricsRegistry()).toBe(reg);
    });
  });

  describe('recordToolCall', () => {
    it('does not throw when metrics are disabled', () => {
      process.env.MCP_TRANSPORT = 'stdio';
      initMetrics();
      expect(() => recordToolCall('test_tool', 100)).not.toThrow();
      expect(() => recordToolCall('test_tool', 50, new Error('test'))).not.toThrow();
    });

    it('records successful calls when metrics are enabled', async () => {
      process.env.METRICS_ENABLED = '1';
      const reg = initMetrics({ version: '1.0.0', defaultMetrics: false });

      recordToolCall('task_create', 100);
      recordToolCall('task_create', 200);
      recordToolCall('task_create', 50, new Error('fail'));

      const metrics = await reg.metrics();
      expect(metrics).toContain('mcp_tool_calls_total{tool="task_create",status="success"} 2');
      expect(metrics).toContain('mcp_tool_calls_total{tool="task_create",status="error"} 1');
    });

    it('records duration in histogram', async () => {
      process.env.METRICS_ENABLED = '1';
      const reg = initMetrics({ version: '1.0.0', defaultMetrics: false });

      recordToolCall('search_tasks', 500);
      recordToolCall('search_tasks', 1000);

      const metrics = await reg.metrics();
      expect(metrics).toContain('mcp_tool_call_duration_seconds_bucket{le="0.5",tool="search_tasks"}');
      expect(metrics).toContain('mcp_tool_call_duration_seconds_count{tool="search_tasks"} 2');
    });
  });

  describe('recordResourceRead', () => {
    it('does not throw when metrics are disabled', () => {
      process.env.MCP_TRANSPORT = 'stdio';
      initMetrics();
      expect(() => recordResourceRead('tasks://')).not.toThrow();
    });

    it('records resource reads when enabled', async () => {
      process.env.METRICS_ENABLED = '1';
      const reg = initMetrics({ version: '1.0.0', defaultMetrics: false });

      recordResourceRead('tasks://current');
      recordResourceRead('knowledge://project', new Error('not found'));

      const metrics = await reg.metrics();
      expect(metrics).toContain('mcp_resource_reads_total{uri_prefix="tasks://current",status="success"} 1');
      expect(metrics).toContain('mcp_resource_reads_total{uri_prefix="knowledge://project",status="error"} 1');
    });
  });

  describe('updateServerInfo', () => {
    it('does not throw when metrics are disabled', () => {
      process.env.MCP_TRANSPORT = 'stdio';
      initMetrics();
      expect(() => updateServerInfo({ toolCount: 42 })).not.toThrow();
    });

    it('updates the gauge when enabled', async () => {
      process.env.METRICS_ENABLED = '1';
      process.env.MCP_TRANSPORT = 'http';
      const reg = initMetrics({ version: '2.0.0', defaultMetrics: false });

      updateServerInfo({ version: '2.0.0', toolCount: 30 });

      const metrics = await reg.metrics();
      expect(metrics).toContain('mcp_server_info{version="2.0.0",transport="http",tools_registered="30"} 1');
    });
  });

  describe('createMetricsHandler', () => {
    it('returns undefined when metrics are disabled', () => {
      process.env.MCP_TRANSPORT = 'stdio';
      initMetrics();
      expect(createMetricsHandler()).toBeUndefined();
    });

    it('returns a handler when enabled', () => {
      process.env.METRICS_ENABLED = '1';
      initMetrics({ version: '1.0.0', defaultMetrics: false });
      const handler = createMetricsHandler();
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });

    it('handler writes metrics to response', async () => {
      process.env.METRICS_ENABLED = '1';
      initMetrics({ version: '1.0.0', defaultMetrics: false });
      recordToolCall('test', 100);

      const handler = createMetricsHandler()!;
      const req = {};
      const headers: Record<string, string> = {};
      const res = {
        setHeader: (k: string, v: string) => { headers[k] = v; },
        statusCode: 200,
        end: vi.fn(),
      };

      await handler(req, res);

      expect(headers['Content-Type']).toContain('text/');
      expect(res.end).toHaveBeenCalledTimes(1);
      const output = (res.end as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(typeof output).toBe('string');
      expect(output).toContain('mcp_tool_calls_total');
    });
  });

  describe('wrapToolHandler', () => {
    it('wraps a handler and records metrics', async () => {
      process.env.METRICS_ENABLED = '1';
      const reg = initMetrics({ version: '1.0.0', defaultMetrics: false });

      const original = async (params: { x: number }) => ({ result: params.x * 2 });
      const wrapped = wrapToolHandler('double', original);

      const result = await wrapped({ x: 5 });
      expect(result).toEqual({ result: 10 });

      const metrics = await reg.metrics();
      expect(metrics).toContain('mcp_tool_calls_total{tool="double",status="success"} 1');
    });

    it('records error status when handler throws', async () => {
      process.env.METRICS_ENABLED = '1';
      const reg = initMetrics({ version: '1.0.0', defaultMetrics: false });

      const original = async () => { throw new Error('boom'); };
      const wrapped = wrapToolHandler('failing', original);

      await expect(wrapped({})).rejects.toThrow('boom');

      const metrics = await reg.metrics();
      expect(metrics).toContain('mcp_tool_calls_total{tool="failing",status="error"} 1');
    });

    it('does not affect behavior when metrics are disabled', async () => {
      process.env.MCP_TRANSPORT = 'stdio';
      initMetrics();

      const original = async (params: { x: number }) => ({ result: params.x * 2 });
      const wrapped = wrapToolHandler('double', original);

      const result = await wrapped({ x: 5 });
      expect(result).toEqual({ result: 10 });
    });
  });
});
