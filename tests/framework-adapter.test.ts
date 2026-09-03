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

describe('memory_framework_adapter tool', () => {
  it('returns descriptor with operations and snippet per framework', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);

    const handler = getHandler('memory_framework_adapter');
    expect(handler).toBeDefined();

    const result = parseResponse(
      await handler!({ framework: 'langgraph', serverUrl: 'http://localhost:3001/mcp', project: 'mcp' }),
    );
    expect(result.ok).toBe(true);
    expect(result.data.framework).toBe('langgraph');
    expect(result.data.operations).toContain('getCheckpoint');
    expect(result.data.snippet).toContain('createAdapter');
    expect(result.data.snippet).toContain('http://localhost:3001/mcp');
  });

  it('covers all four frameworks', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);

    for (const fw of ['langgraph', 'autogen', 'crewai', 'langchain']) {
      const result = parseResponse(await getHandler('memory_framework_adapter')!({ framework: fw, serverUrl: 'http://x/mcp' }));
      expect(result.ok).toBe(true);
      expect(result.data.operations.length).toBeGreaterThan(0);
    }
  });
});
