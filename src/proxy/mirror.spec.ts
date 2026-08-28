/**
 * proxy/mirror.spec.ts — Tests for ProxyMirror (P-002).
 *
 * Tests cover JSON Schema → Zod conversion, tool/resource/prompt mirroring,
 * and unregisterAll. Upstream client is mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { jsonSchemaToZod, jsonSchemaToShape } from './mirror.js';

// Mock the MCP SDK modules
const mockToolRemove = vi.fn();
const mockResourceRemove = vi.fn();
const mockPromptRemove = vi.fn();

const mockServer = {
  tool: vi.fn().mockReturnValue({ remove: mockToolRemove }),
  resource: vi.fn().mockReturnValue({ remove: mockResourceRemove }),
  prompt: vi.fn().mockReturnValue({ remove: mockPromptRemove }),
};

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(),
}));

// Import after mocks are set up
import { ProxyMirror } from './mirror.js';

function createMockClient(tools: any[] = [], resources: any[] = [], prompts: any[] = []) {
  return {
    listTools: vi.fn().mockResolvedValue({ tools }),
    listResources: vi.fn().mockResolvedValue({ resources }),
    listPrompts: vi.fn().mockResolvedValue({ prompts }),
    callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }] }),
    readResource: vi.fn().mockResolvedValue({ contents: [{ uri: 'test://1', text: 'data' }] }),
    getPrompt: vi.fn().mockResolvedValue({ messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }] }),
  } as any;
}

describe('P-002: jsonSchemaToZod', () => {
  it('converts string', () => {
    const zodType = jsonSchemaToZod({ type: 'string' });
    expect(zodType).toBeInstanceOf(z.ZodString);
  });

  it('converts number', () => {
    const zodType = jsonSchemaToZod({ type: 'number' });
    expect(zodType).toBeInstanceOf(z.ZodNumber);
  });

  it('converts integer', () => {
    const zodType = jsonSchemaToZod({ type: 'integer' });
    expect(zodType).toBeInstanceOf(z.ZodNumber);
  });

  it('converts boolean', () => {
    const zodType = jsonSchemaToZod({ type: 'boolean' });
    expect(zodType).toBeInstanceOf(z.ZodBoolean);
  });

  it('converts array with items', () => {
    const zodType = jsonSchemaToZod({ type: 'array', items: { type: 'string' } });
    expect(zodType).toBeInstanceOf(z.ZodArray);
  });

  it('converts object with properties', () => {
    const zodType = jsonSchemaToZod({
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'number' } },
    });
    expect(zodType).toBeInstanceOf(z.ZodObject);
  });

  it('falls back to z.any() for unknown type', () => {
    const zodType = jsonSchemaToZod({ type: 'unknown-type' });
    expect(zodType).toBeInstanceOf(z.ZodAny);
  });

  it('falls back to z.any() for non-object input', () => {
    const zodType = jsonSchemaToZod(null);
    expect(zodType).toBeInstanceOf(z.ZodAny);
  });
});

describe('P-002: jsonSchemaToShape', () => {
  it('converts full JSON Schema to ZodRawShape', () => {
    const shape = jsonSchemaToShape({
      type: 'object',
      properties: {
        name: { type: 'string' },
        count: { type: 'number' },
        active: { type: 'boolean' },
      },
      required: ['name'],
    });

    expect(Object.keys(shape)).toEqual(['name', 'count', 'active']);
    expect(shape.name).toBeInstanceOf(z.ZodString);
    expect(shape.count).toBeInstanceOf(z.ZodOptional);
    expect(shape.active).toBeInstanceOf(z.ZodOptional);
  });

  it('returns empty shape for non-object schema', () => {
    expect(jsonSchemaToShape(null)).toEqual({});
    expect(jsonSchemaToShape({})).toEqual({});
    expect(jsonSchemaToShape({ type: 'string' })).toEqual({});
  });

  it('handles missing required array', () => {
    const shape = jsonSchemaToShape({
      type: 'object',
      properties: { name: { type: 'string' } },
    });
    expect(shape.name).toBeInstanceOf(z.ZodOptional);
  });
});

describe('P-002: ProxyMirror', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('mirrorTools()', () => {
    it('mirrors tools from upstream', async () => {
      const client = createMockClient([
        { name: 'tool1', description: 'First tool', inputSchema: { type: 'object', properties: { x: { type: 'string' } } } },
        { name: 'tool2', description: 'Second tool', inputSchema: { type: 'object', properties: {} } },
      ]);
      const mirror = new ProxyMirror(client, mockServer as any);

      const count = await mirror.mirrorTools();
      expect(count).toBe(2);
      expect(mockServer.tool).toHaveBeenCalledTimes(2);
      expect(mockServer.tool).toHaveBeenCalledWith('tool1', 'First tool', expect.any(Object), expect.any(Function));
      expect(mockServer.tool).toHaveBeenCalledWith('tool2', 'Second tool', expect.any(Object), expect.any(Function));
    });

    it('handles empty tool list', async () => {
      const client = createMockClient([]);
      const mirror = new ProxyMirror(client, mockServer as any);
      const count = await mirror.mirrorTools();
      expect(count).toBe(0);
      expect(mockServer.tool).not.toHaveBeenCalled();
    });

    it('handles upstream listTools failure', async () => {
      const client = createMockClient();
      client.listTools = vi.fn().mockRejectedValue(new Error('upstream down'));
      const mirror = new ProxyMirror(client, mockServer as any);
      const count = await mirror.mirrorTools();
      expect(count).toBe(0);
      expect(mirror.stats.errors).toBe(1);
    });

    it('forwards tool calls to upstream', async () => {
      const client = createMockClient([
        { name: 'echo', description: 'Echo tool', inputSchema: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] } },
      ]);
      const mirror = new ProxyMirror(client, mockServer as any);
      await mirror.mirrorTools();

      // Get the callback passed to server.tool
      const cb = mockServer.tool.mock.calls[0][3] as (args: any) => Promise<any>;
      const result = await cb({ msg: 'hello' });

      expect(client.callTool).toHaveBeenCalledWith({ name: 'echo', arguments: { msg: 'hello' } });
      expect(result.content).toEqual([{ type: 'text', text: 'result' }]);
    });
  });

  describe('mirrorResources()', () => {
    it('mirrors resources from upstream', async () => {
      const client = createMockClient(
        [],
        [
          { uri: 'file:///1', name: 'File 1', description: 'First file' },
          { uri: 'file:///2', name: 'File 2', description: 'Second file' },
        ],
      );
      const mirror = new ProxyMirror(client, mockServer as any);

      const count = await mirror.mirrorResources();
      expect(count).toBe(2);
      expect(mockServer.resource).toHaveBeenCalledTimes(2);
    });

    it('handles empty resource list', async () => {
      const client = createMockClient();
      const mirror = new ProxyMirror(client, mockServer as any);
      const count = await mirror.mirrorResources();
      expect(count).toBe(0);
    });

    it('forwards resource reads to upstream', async () => {
      const client = createMockClient(
        [],
        [{ uri: 'file:///test', name: 'Test', description: 'Test resource' }],
      );
      const mirror = new ProxyMirror(client, mockServer as any);
      await mirror.mirrorResources();

      const cb = mockServer.resource.mock.calls[0][2] as (uri: any) => Promise<any>;
      const result = await cb({ href: 'file:///test' });

      expect(client.readResource).toHaveBeenCalledWith({ uri: 'file:///test' });
      expect(result.contents).toBeDefined();
    });
  });

  describe('mirrorPrompts()', () => {
    it('mirrors prompts from upstream', async () => {
      const client = createMockClient(
        [],
        [],
        [
          { name: 'greet', description: 'Greeting prompt', arguments: [{ name: 'name', required: true }] },
          { name: 'summarize', description: 'Summarize prompt', arguments: [] },
        ],
      );
      const mirror = new ProxyMirror(client, mockServer as any);

      const count = await mirror.mirrorPrompts();
      expect(count).toBe(2);
      expect(mockServer.prompt).toHaveBeenCalledTimes(2);
    });

    it('handles empty prompt list', async () => {
      const client = createMockClient();
      const mirror = new ProxyMirror(client, mockServer as any);
      const count = await mirror.mirrorPrompts();
      expect(count).toBe(0);
    });

    it('forwards prompt gets to upstream', async () => {
      const client = createMockClient(
        [],
        [],
        [{ name: 'greet', description: 'Greeting', arguments: [{ name: 'name' }] }],
      );
      const mirror = new ProxyMirror(client, mockServer as any);
      await mirror.mirrorPrompts();

      const cb = mockServer.prompt.mock.calls[0][3] as (args: any) => Promise<any>;
      const result = await cb({ name: 'World' });

      expect(client.getPrompt).toHaveBeenCalledWith({ name: 'greet', arguments: { name: 'World' } });
      expect(result.messages).toBeDefined();
    });
  });

  describe('mirrorAll()', () => {
    it('mirrors tools + resources + prompts', async () => {
      const client = createMockClient(
        [{ name: 'tool1', description: 'T1', inputSchema: {} }],
        [{ uri: 'file:///1', name: 'R1' }],
        [{ name: 'prompt1', description: 'P1' }],
      );
      const mirror = new ProxyMirror(client, mockServer as any);

      const stats = await mirror.mirrorAll();
      expect(stats.tools).toBe(1);
      expect(stats.resources).toBe(1);
      expect(stats.prompts).toBe(1);
      expect(stats.errors).toBe(0);
    });
  });

  describe('unregisterAll()', () => {
    it('removes all registered items', async () => {
      const client = createMockClient(
        [{ name: 'tool1', description: 'T1', inputSchema: {} }],
        [{ uri: 'file:///1', name: 'R1' }],
        [{ name: 'prompt1', description: 'P1' }],
      );
      const mirror = new ProxyMirror(client, mockServer as any);
      await mirror.mirrorAll();

      mirror.unregisterAll();

      expect(mockToolRemove).toHaveBeenCalledTimes(1);
      expect(mockResourceRemove).toHaveBeenCalledTimes(1);
      expect(mockPromptRemove).toHaveBeenCalledTimes(1);
      expect(mirror.stats.tools).toBe(0);
    });
  });
});
