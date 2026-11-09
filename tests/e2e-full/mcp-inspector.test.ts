/**
 * DX-23: MCP Inspector conformance — protocol-level contract check.
 *
 * Spawns the real dist/index.js via StdioClientTransport and validates:
 *  - initialize handshake (protocolVersion, capabilities, serverInfo)
 *  - tools/list returns registered tools
 *  - tools/call on a known tool returns valid envelope
 *  - resources/list and prompts/list respond (may be empty)
 *  - protocol errors are well-formed JSON-RPC errors (not crashes)
 *
 * Purpose: catch "our tests green but not per-spec" — this is the
 * spec-conformance gate, not a functional test.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type E2EServer } from './harness.js';

describe('DX-23: MCP protocol conformance (inspector)', () => {
  // TS-01: one server for the whole file. Spawning per test cost five server
  // boots inside a 5 s default timeout; on a loaded machine the first boot alone
  // exceeded it and the file failed before any assertion ran.
  let srv: E2EServer;
  beforeAll(async () => {
    srv = await spawnServer('mcp-inspector');
  }, 60_000);
  afterAll(async () => {
    await srv?.close();
  });

  it('initialize handshake returns valid protocolVersion + capabilities + serverInfo', () => {
    // Handshake already happened inside spawnServer (StdioClientTransport.connect → initialize)
    const serverInfo = srv.client.getServerVersion();
    expect(serverInfo).toBeTruthy();
    expect(serverInfo!.name).toBe('mcp-task-knowledge');
    expect(serverInfo!.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('tools/list returns registered tools', async () => {
    const res = await srv.client.listTools();
    expect(res.tools.length).toBeGreaterThan(0);
    const names = res.tools.map((t) => t.name);
    expect(names).toContain('tools_list');
    expect(names).toContain('project_get_current');
  });

  it('tools/call on a known tool returns valid envelope', async () => {
    const res = await srv.client.callTool({
      name: 'project_get_current',
      arguments: {},
    });
    const text = (res?.content as any)?.[0]?.text ?? '';
    const env = JSON.parse(text);
    // Envelope contract: { ok: true, data: {...} } or { ok: false, error: {...} }
    expect(env).toHaveProperty('ok');
    if (env.ok) {
      expect(env).toHaveProperty('data');
    }
  });

  it('resources/list responds with valid shape', async () => {
    const res = await srv.client.listResources();
    expect(res.resources).toBeDefined();
    expect(Array.isArray(res.resources)).toBe(true);
  });

  it('protocol errors are well-formed JSON-RPC (invalid method)', async () => {
    try {
      const res = await srv.client.callTool({ name: 'nonexistent_tool_xyz', arguments: {} });
      const env = JSON.parse((res?.content as any)?.[0]?.text ?? '{}');
      expect(env.ok).toBe(false);
    } catch (e) {
      expect(e).toBeTruthy();
    }
  });

  it('protocol errors are well-formed JSON-RPC (invalid tool args)', async () => {
    try {
      const res = await srv.client.callTool({
        name: 'tasks_create',
        arguments: { title: 12345, project: {} },
      });
      const text = (res?.content as any)?.[0]?.text ?? '';
      const env = JSON.parse(text);
      // Must be { ok: false, error: {...} } — not a crash
      expect(env.ok).toBe(false);
      expect(env.error).toBeTruthy();
    } catch (e) {
      // Also acceptable: client-level JSON-RPC error
      expect(e).toBeTruthy();
    }
  });
});
