import { describe, it, expect, vi } from 'vitest';
import { registerMemoryTools } from '../src/register/memory.js';
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

describe('graph_visualize tool', () => {
  it('requires nodeId or query', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);

    const handler = getHandler('graph_visualize');
    expect(handler).toBeDefined();

    const result = parseResponse(await handler!({}));
    expect(result.ok).toBe(false);
  });

  it('errors on unknown nodeId', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);

    const result = parseResponse(await getHandler('graph_visualize')!({ nodeId: 'nope' }));
    expect(result.ok).toBe(false);
  });

  it('returns empty graph html for unmatched query (read-only, no storage writes)', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);

    const result = parseResponse(
      await getHandler('graph_visualize')!({ query: 'zzz-no-such-node-xyz' }),
    );
    expect(result.ok).toBe(true);
    expect(result.data.nodeCount).toBe(0);
    expect(result.data.edgeCount).toBe(0);
    expect(result.data.htmlLength).toBeGreaterThan(0);
    expect(result.data.html).toContain('<!DOCTYPE html>');
  });
});
