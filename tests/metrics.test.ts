import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initMetrics, getMetricsRegistry, recordToolCall, recordResourceRead, updateServerInfo, createMetricsHandler, wrapToolHandler, recordSessionCreated, recordSessionClosed, setSessionsActive, _resetMetrics } from '../src/core/metrics.js';

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

  // ─── S-005: Session metrics ───────────────────────────────────────

  describe('recordSessionCreated (S-005)', () => {
    it('does not throw when metrics are disabled', () => {
      process.env.MCP_TRANSPORT = 'stdio';
      initMetrics();
      expect(() => recordSessionCreated()).not.toThrow();
    });

    it('increments sessions_total{status="opened"} and sessions_active gauge', async () => {
      process.env.METRICS_ENABLED = '1';
      const reg = initMetrics({ version: '1.0.0', defaultMetrics: false });

      recordSessionCreated();
      recordSessionCreated();
      recordSessionCreated();

      const metrics = await reg.metrics();
      expect(metrics).toContain('mcp_sessions_total{status="opened"} 3');
      expect(metrics).toContain('mcp_sessions_active 3');
    });
  });

  describe('recordSessionClosed (S-005)', () => {
    it('does not throw when metrics are disabled', () => {
      process.env.MCP_TRANSPORT = 'stdio';
      initMetrics();
      expect(() => recordSessionClosed(5000, 1000, 'manual')).not.toThrow();
      expect(() => recordSessionClosed(3000, 500, 'expired')).not.toThrow();
      expect(() => recordSessionClosed(2000, 2000, 'idle_timeout')).not.toThrow();
    });

    it('decrements sessions_active and records counter + histograms for manual close', async () => {
      process.env.METRICS_ENABLED = '1';
      const reg = initMetrics({ version: '1.0.0', defaultMetrics: false });

      // Create 3 sessions then close 1
      recordSessionCreated();
      recordSessionCreated();
      recordSessionCreated();
      recordSessionClosed(60_000, 5_000, 'manual');

      const metrics = await reg.metrics();
      // Counter: 3 opened + 1 closed
      expect(metrics).toContain('mcp_sessions_total{status="opened"} 3');
      expect(metrics).toContain('mcp_sessions_total{status="closed"} 1');
      // Gauge: 3 created - 1 closed = 2
      expect(metrics).toContain('mcp_sessions_active 2');
      // Duration histogram: 60s
      expect(metrics).toContain('mcp_session_duration_seconds_count 1');
      // Idle histogram: 5s, reason=manual
      expect(metrics).toContain('mcp_session_idle_seconds_count{reason="manual"} 1');
    });

    it('records expired status for expired close reason', async () => {
      process.env.METRICS_ENABLED = '1';
      const reg = initMetrics({ version: '1.0.0', defaultMetrics: false });

      recordSessionCreated();
      recordSessionClosed(120_000, 30_000, 'expired');

      const metrics = await reg.metrics();
      expect(metrics).toContain('mcp_sessions_total{status="expired"} 1');
      expect(metrics).toContain('mcp_sessions_active 0');
      expect(metrics).toContain('mcp_session_idle_seconds_count{reason="expired"} 1');
    });

    it('records idle_timeout status for idle_timeout close reason', async () => {
      process.env.METRICS_ENABLED = '1';
      const reg = initMetrics({ version: '1.0.0', defaultMetrics: false });

      recordSessionCreated();
      recordSessionClosed(60_000, 60_000, 'idle_timeout');

      const metrics = await reg.metrics();
      expect(metrics).toContain('mcp_sessions_total{status="idle_timeout"} 1');
      expect(metrics).toContain('mcp_sessions_active 0');
      expect(metrics).toContain('mcp_session_idle_seconds_count{reason="idle_timeout"} 1');
    });

    it('records duration in seconds (not ms)', async () => {
      process.env.METRICS_ENABLED = '1';
      const reg = initMetrics({ version: '1.0.0', defaultMetrics: false });

      // 5000ms = 5s
      recordSessionCreated();
      recordSessionClosed(5000, 1000, 'manual');

      const metrics = await reg.metrics();
      // 5s falls in bucket le=10
      expect(metrics).toContain('mcp_session_duration_seconds_bucket{le="10"} 1');
    });
  });

  describe('setSessionsActive (S-005)', () => {
    it('does not throw when metrics are disabled', () => {
      process.env.MCP_TRANSPORT = 'stdio';
      initMetrics();
      expect(() => setSessionsActive(42)).not.toThrow();
    });

    it('sets sessions_active gauge to exact value', async () => {
      process.env.METRICS_ENABLED = '1';
      const reg = initMetrics({ version: '1.0.0', defaultMetrics: false });

      setSessionsActive(10);
      const metrics = await reg.metrics();
      expect(metrics).toContain('mcp_sessions_active 10');

      // Overwrite
      setSessionsActive(25);
      const metrics2 = await reg.metrics();
      expect(metrics2).toContain('mcp_sessions_active 25');
    });
  });

  describe('session metrics full lifecycle (S-005)', () => {
    it('tracks create → active → close correctly across multiple sessions', async () => {
      process.env.METRICS_ENABLED = '1';
      const reg = initMetrics({ version: '1.0.0', defaultMetrics: false });

      // Session A created
      recordSessionCreated();
      const m1 = await reg.metrics();
      expect(m1).toContain('mcp_sessions_active 1');
      expect(m1).toContain('mcp_sessions_total{status="opened"} 1');

      // Session B created
      recordSessionCreated();
      const m2 = await reg.metrics();
      expect(m2).toContain('mcp_sessions_active 2');
      expect(m2).toContain('mcp_sessions_total{status="opened"} 2');

      // Session A closed manually
      recordSessionClosed(30_000, 5_000, 'manual');
      const m3 = await reg.metrics();
      expect(m3).toContain('mcp_sessions_active 1');
      expect(m3).toContain('mcp_sessions_total{status="closed"} 1');

      // Session B closed by idle timeout
      recordSessionClosed(60_000, 30_000, 'idle_timeout');
      const m4 = await reg.metrics();
      expect(m4).toContain('mcp_sessions_active 0');
      expect(m4).toContain('mcp_sessions_total{status="idle_timeout"} 1');

      // Verify histogram counts
      expect(m4).toContain('mcp_session_duration_seconds_count 2');
      expect(m4).toContain('mcp_session_idle_seconds_count{reason="manual"} 1');
      expect(m4).toContain('mcp_session_idle_seconds_count{reason="idle_timeout"} 1');
    });
  });
});
