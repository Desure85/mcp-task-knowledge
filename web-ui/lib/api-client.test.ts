/**
 * Unit tests for lib/api-client.ts (PH-015d).
 *
 * The SDK Client/Transport are mocked — tests verify envelope parsing,
 * session-singleton behavior, auth-token flow, and reconnect-after-failure
 * without a live MCP server. A live-server integration test lives in
 * tests/e2e-full/ on the repo side.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockSdkState as mocks } from './__mocks__/sdk-state';

// Mock the SDK surface. Factories use dynamic import of the shared state
// module — no outer-scope references, so no ESM/TDZ pitfalls.
vi.mock('@modelcontextprotocol/sdk/client/index.js', async () => {
  const { mockSdkState } = await import('./__mocks__/sdk-state');
  return {
    Client: class MockClient {
      constructor(public info: unknown) {}
      async connect() {
        mockSdkState.connectCount++;
        if (mockSdkState.connectShouldFail) throw new Error('connect failed');
      }
      async callTool(req: { name: string; arguments?: Record<string, unknown> }) {
        mockSdkState.calls.push(req);
        if (!mockSdkState.impl) throw new Error('mockSdkState.impl not set');
        return mockSdkState.impl(req);
      }
      async close() {}
    },
  };
});

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class MockTransport {
    constructor(public url: URL) {}
  },
}));

// Import after mocks are registered.
import {
  api,
  callTool,
  resetClient,
  setAuthToken,
  clearAuthToken,
  hasAuthToken,
} from './api-client';

function okResult(data: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }] };
}
function errResult(message: string) {
  return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: { message } }) }], isError: true };
}
const okAll = () => mocks.impl = () => okResult({});

// Minimal window/sessionStorage stub for token tests.
const store = new Map<string, string>();
const sessionStorageStub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

beforeEach(() => {
  mocks.reset();
  store.clear();
  delete process.env.NEXT_PUBLIC_MCP_TOKEN;
  process.env.NEXT_PUBLIC_MCP_API_URL = 'http://localhost:3001/mcp';
  (globalThis as { window?: unknown }).window = {
    location: { origin: 'http://localhost:3000', href: 'http://localhost:3000/' },
    sessionStorage: sessionStorageStub,
  };
  resetClient();
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  resetClient();
});

const callNames = () => mocks.calls.map((c) => c.name);

describe('callTool envelope', () => {
  it('returns data on ok envelope', async () => {
    mocks.impl = () => okResult([{ id: 't1' }]);
    const tasks = await api.tasks.list();
    expect(tasks).toEqual([{ id: 't1' }]);
    expect(mocks.calls[0]).toEqual({ name: 'tasks_list', arguments: { project: undefined } });
  });

  it('throws error.message on !ok envelope', async () => {
    mocks.impl = () => errResult('not confirmed');
    await expect(callTool('project_purge', { confirm: false }))
      .rejects.toThrow('not confirmed');
  });

  it('throws on non-JSON tool response', async () => {
    mocks.impl = () => ({ content: [{ type: 'text', text: 'not json' }] });
    await expect(callTool('tasks_list')).rejects.toThrow('non-JSON tool response');
  });

  it('throws when content is empty', async () => {
    mocks.impl = () => ({ content: [] });
    await expect(callTool('tasks_list')).rejects.toThrow();
  });
});

describe('session singleton', () => {
  it('connects once and reuses the session across calls', async () => {
    okAll();
    await api.tasks.list();
    await api.tasks.list();
    await api.knowledge.list();
    expect(mocks.connectCount).toBe(1);
  });

  it('resetClient forces a new session', async () => {
    okAll();
    await api.tasks.list();
    resetClient();
    await api.tasks.list();
    expect(mocks.connectCount).toBe(2);
  });

  it('failed connect does not poison the singleton — next call retries', async () => {
    mocks.connectShouldFail = true;
    await expect(api.tasks.list()).rejects.toThrow('connect failed');
    mocks.connectShouldFail = false;
    okAll();
    await expect(api.tasks.list()).resolves.toEqual({});
    expect(mocks.connectCount).toBe(2);
  });
});

describe('auth token', () => {
  it('no token → no mcp.authenticate call', async () => {
    okAll();
    await api.tasks.list();
    expect(callNames()).not.toContain('mcp.authenticate');
  });

  it('env token → mcp.authenticate before first tool call', async () => {
    process.env.NEXT_PUBLIC_MCP_TOKEN = 'env-jwt';
    okAll();
    await api.tasks.list();
    expect(callNames()[0]).toBe('mcp.authenticate');
    expect(mocks.calls[0]).toMatchObject({ arguments: { token: 'env-jwt' } });
  });

  it('setAuthToken stores token and re-authenticates on next call', async () => {
    okAll();
    await api.tasks.list();
    expect(hasAuthToken()).toBe(false);
    setAuthToken('session-jwt');
    expect(hasAuthToken()).toBe(true);
    await api.tasks.list();
    expect(callNames()[1]).toBe('mcp.authenticate');
    expect(mocks.connectCount).toBe(2);
  });

  it('clearAuthToken removes token and reconnects without auth', async () => {
    setAuthToken('session-jwt');
    okAll();
    await api.tasks.list();
    clearAuthToken();
    expect(hasAuthToken()).toBe(false);
    await api.tasks.list();
    expect(callNames().filter((n) => n === 'mcp.authenticate')).toHaveLength(1);
  });

  it('failed mcp.authenticate rejects the whole call', async () => {
    setAuthToken('bad-jwt');
    mocks.impl = () => errResult('invalid token');
    await expect(api.tasks.list()).rejects.toThrow('mcp.authenticate failed: invalid token');
  });
});

describe('tool name mapping', () => {
  beforeEach(okAll);

  it('maps methods to real tool names', async () => {
    await api.projects.list();
    await api.projects.setCurrent('p1');
    await api.system.sessionList();
    await api.system.toolsList('mem');
    await api.system.dashboardTrends({ days: 7 });
    await api.knowledge.bulkTrash('mcp', ['k1']);
    expect(callNames()).toEqual([
      'project_list',
      'project_set_current',
      'session_list',
      'tools_list',
      'dashboard_trends',
      'knowledge_bulk_trash',
    ]);
  });

  it('passes arguments through', async () => {
    await api.tasks.update('mcp', 't1', { status: 'completed' });
    expect(mocks.calls[0]).toEqual({
      name: 'tasks_update',
      arguments: { project: 'mcp', id: 't1', status: 'completed' },
    });
  });
});
