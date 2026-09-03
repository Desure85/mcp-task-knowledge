import { describe, it, expect, vi } from 'vitest';
import { ClusterManager } from '../src/core/cluster.js';
import { registerClusterTools } from '../src/register/cluster.js';
import type { ServerContext } from '../src/register/context.js';
import type { ToolMetaHandler } from '../src/register/setup.js';

function createMockContext(overrides?: Partial<ServerContext>): {
  ctx: ServerContext;
  getHandler: (name: string) => ToolMetaHandler | undefined;
} {
  const handlers = new Map<string, ToolMetaHandler>();

  const ctx: ServerContext = {
    server: {
      registerTool(name: string, _def: unknown, handler: unknown) {
        handlers.set(name, handler as ToolMetaHandler);
      },
    } as any,
    cfg: {} as any,
    catalogCfg: {} as any,
    catalogProvider: {} as any,
    vectorAdapter: undefined,
    vectorInitAttempted: false,
    ensureVectorAdapter: async () => undefined,
    toolRegistry: {
      has: () => false,
      set: vi.fn(),
    } as any,
    resourceRegistry: [],
    toolNames: new Set(),
    STRICT_TOOL_DEDUP: false,
    TOOLS_ENABLED: true,
    TOOL_RES_ENABLED: false,
    TOOL_RES_EXEC: false,
    REPO_ROOT: '/tmp',
    SERVER_CAPS: { resources: { list: true, read: true }, tools: { call: true } },
    normalizeBase64: (s: string) => s,
    makeResourceTemplate: (p: string) => p as any,
    registerToolAsResource: vi.fn(),
    ...overrides,
  };

  return {
    ctx,
    getHandler: (name: string) => handlers.get(name),
  };
}

function parseResponse(result: any): any {
  try {
    const text = result?.content?.[0]?.text;
    return typeof text === 'string' ? JSON.parse(text) : result;
  } catch {
    return result;
  }
}

describe('cluster_status tool', () => {
  it('returns available=false when ClusterManager is not set', async () => {
    const { ctx, getHandler } = createMockContext();
    registerClusterTools(ctx);

    const handler = getHandler('cluster_status');
    expect(handler).toBeDefined();

    const result = parseResponse(await handler!({}));
    expect(result.ok).toBe(true);
    expect(result.data.available).toBe(false);
    expect(result.data.clusteringEnabled).toBe(false);
  });

  it('returns self id and counts when ClusterManager is set', async () => {
    const cm = new ClusterManager({ selfId: 'node-test' });
    cm.registerNode({ id: 'node-test', host: '127.0.0.1', port: 3001, status: 'active' });
    const { ctx, getHandler } = createMockContext({ clusterManager: cm });
    registerClusterTools(ctx);

    const result = parseResponse(await getHandler('cluster_status')!({}));
    expect(result.ok).toBe(true);
    expect(result.data.selfId).toBe('node-test');
    expect(result.data.nodeCount).toBe(1);
    expect(result.data.activeNodeCount).toBe(1);
    cm.stopHeartbeat();
  });
});

describe('cluster_nodes tool', () => {
  it('lists registered nodes', async () => {
    const cm = new ClusterManager({ selfId: 'node-test' });
    cm.registerNode({ id: 'node-test', host: '127.0.0.1', port: 3001, status: 'active' });
    const { ctx, getHandler } = createMockContext({ clusterManager: cm });
    registerClusterTools(ctx);

    const result = parseResponse(await getHandler('cluster_nodes')!({}));
    expect(result.ok).toBe(true);
    expect(result.data.nodes).toHaveLength(1);
    expect(result.data.nodes[0].id).toBe('node-test');
    cm.stopHeartbeat();
  });
});

describe('cluster_assign tool', () => {
  it('assigns session and returns routing headers', async () => {
    const cm = new ClusterManager({ selfId: 'node-test' });
    cm.registerNode({ id: 'node-test', host: '127.0.0.1', port: 3001, status: 'active' });
    const { ctx, getHandler } = createMockContext({ clusterManager: cm });
    registerClusterTools(ctx);

    const result = parseResponse(await getHandler('cluster_assign')!({ sessionId: 'sess-1' }));
    expect(result.ok).toBe(true);
    expect(result.data.nodeId).toBe('node-test');
    expect(result.data.headers['X-Node-Id']).toBe('node-test');
    cm.stopHeartbeat();
  });

  it('errors when ClusterManager is not set', async () => {
    const { ctx, getHandler } = createMockContext();
    registerClusterTools(ctx);

    const result = parseResponse(await getHandler('cluster_assign')!({ sessionId: 'sess-1' }));
    expect(result.ok).toBe(false);
  });
});
