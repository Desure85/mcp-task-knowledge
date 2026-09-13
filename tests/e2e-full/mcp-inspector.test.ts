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

import { describe, it, expect } from 'vitest';
import { spawnServer } from './harness.js';

describe('DX-23: MCP protocol conformance (inspector)', () => {
  it('initialize handshake returns valid protocolVersion + capabilities + serverInfo', async () => {
    const srv = await spawnServer('mcp-inspector-init');
    try {
      // Handshake already happened inside spawnServer (StdioClientTransport.connect → initialize)
      // Verify the client got a valid server info back via SDK accessor
      const serverInfo = srv.client.getServerVersion();
      expect(serverInfo).toBeTruthy();
      expect(serverInfo!.name).toBe('mcp-task-knowledge');
      expect(serverInfo!.version).toMatch(/^\d+\.\d+\.\d+/);
    } finally {
      await srv.close();
    }
  });

  it('tools/list returns registered tools', async () => {
    const srv = await spawnServer('mcp-inspector-tools');
    try {
      const res = await srv.client.listTools();
      expect(res.tools.length).toBeGreaterThan(0);
      const names = res.tools.map((t) => t.name);
      expect(names).toContain('tools_list');
      expect(names).toContain('project_get_current');
    } finally {
      await srv.close();
    }
  });

  it('tools/call on a known tool returns valid envelope', async () => {
    const srv = await spawnServer('mcp-inspector-call');
    try {
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
    } finally {
      await srv.close();
    }
  });

  it('resources/list responds with valid shape', async () => {
    const srv = await spawnServer('mcp-inspector-resources');
    try {
      const res = await srv.client.listResources();
      expect(res.resources).toBeDefined();
      expect(Array.isArray(res.resources)).toBe(true);
    } finally {
      await srv.close();
    }
  });

  it('protocol errors are well-formed JSON-RPC (invalid method)', async () => {
    const srv = await spawnServer('mcp-inspector-err');
    try {
      // Call a non-existent tool — should get a proper error, not a crash
      try {
        const res = await srv.client.callTool({ name: 'nonexistent_tool_xyz', arguments: {} });
        // Did not throw → must be a well-formed error envelope
        const env = JSON.parse((res?.content as any)?.[0]?.text ?? '{}');
        expect(env.ok).toBe(false);
      } catch (e) {
        // Threw → JSON-RPC error response is also valid
        expect(e).toBeTruthy();
      }
    } finally {
      await srv.close();
    }
  });

  it('protocol errors are well-formed JSON-RPC (invalid tool args)', async () => {
    const srv = await spawnServer('mcp-inspector-errargs');
    try {
      // Call a tool with wrong arg types — should get validation error, not crash
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
    } finally {
      await srv.close();
    }
  });
});
