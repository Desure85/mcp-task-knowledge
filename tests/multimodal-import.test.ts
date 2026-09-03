import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
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

describe('knowledge_import_multimodal tool', () => {
  afterAll(async () => {
    try {
      await fs.unlink(path.join(process.env.DATA_DIR!, 'sample.txt'));
    } catch {
      // already cleaned
    }
  });  it('extracts text chunks from a file inside DATA_DIR', async () => {
    const dir = process.env.DATA_DIR!;
    await fs.writeFile(path.join(dir, 'sample.txt'), 'First paragraph.\n\nSecond paragraph.');
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);

    const handler = getHandler('knowledge_import_multimodal');
    expect(handler).toBeDefined();

    const result = parseResponse(await handler!({ filePath: 'sample.txt', type: 'text' }));
    expect(result.ok).toBe(true);
    expect(result.data.modality).toBe('text');
    expect(result.data.returnedChunks).toBeGreaterThan(0);
    expect(result.data.chunks[0].text).toContain('First paragraph');
  });

  it('rejects paths outside DATA_DIR', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);

    const result = parseResponse(await getHandler('knowledge_import_multimodal')!({ filePath: '../evil.txt', type: 'text' }));
    expect(result.ok).toBe(false);
  });

  it('errors on missing file', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);

    const result = parseResponse(await getHandler('knowledge_import_multimodal')!({ filePath: 'nope.txt', type: 'text' }));
    expect(result.ok).toBe(false);
  });

  it('persists chunks via the knowledge pipeline when persist:true', async () => {
    const dir = process.env.DATA_DIR!;
    await fs.writeFile(path.join(dir, 'persist-me.txt'), 'Persist alpha.\n\nPersist beta.');
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);

    const result = parseResponse(
      await getHandler('knowledge_import_multimodal')!({ filePath: 'persist-me.txt', type: 'text', persist: true, title: 'mm-persist-test' }),
    );
    expect(result.ok).toBe(true);
    expect(result.data.persisted).toBe(true);
    expect(typeof result.data.docId).toBe('string');
    // stored doc is readable via the knowledge pipeline
    const { readDoc } = await import('../src/storage/knowledge.js');
    const { resolveProject } = await import('../src/config.js');
    const doc = await readDoc(resolveProject(undefined), result.data.docId as string);
    expect(doc).not.toBeNull();
    expect(doc!.content).toContain('Persist alpha');
    try {
      await fs.unlink(path.join(dir, 'persist-me.txt'));
    } catch { /* already cleaned */ }
  });

  it('blocks absolute path traversal outside DATA_DIR', async () => {
    const { ctx, getHandler } = createMockContext();
    registerMemoryTools(ctx);

    const result = parseResponse(await getHandler('knowledge_import_multimodal')!({ filePath: '/etc/passwd', type: 'text' }));
    expect(result.ok).toBe(false);
  });
});
