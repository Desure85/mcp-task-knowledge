import { describe, expect, it, vi } from 'vitest';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ProxyPassthrough } from '../src/proxy/passthrough.js';

function harness(mode: 'full' | 'meta') {
  const tools = [
    { name: 'tasks_list', description: 'list', inputSchema: { type: 'object' } },
    { name: 'knowledge_get', description: 'get', inputSchema: { type: 'object' } },
    { name: 'tools_list', description: 'meta list', inputSchema: { type: 'object' } },
    { name: 'tool_schema', description: 'meta schema', inputSchema: { type: 'object' } },
    { name: 'tool_help', description: 'meta help', inputSchema: { type: 'object' } },
    { name: 'tools_run', description: 'meta run', inputSchema: { type: 'object' } },
  ];
  const handlers = new Map<unknown, (req: any) => any>();
  const client = {
    listTools: vi.fn(async () => ({ tools })),
    callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] })),
    listResources: vi.fn(async () => ({ resources: [] })),
    listResourceTemplates: vi.fn(async () => ({ resourceTemplates: [] })),
    listPrompts: vi.fn(async () => ({ prompts: [] })),
    setNotificationHandler: vi.fn(),
  };
  const server = {
    setRequestHandler: (schema: unknown, handler: (req: any) => any) => handlers.set(schema, handler),
    sendToolListChanged: vi.fn(async () => {}),
    sendResourceListChanged: vi.fn(async () => {}),
    sendPromptListChanged: vi.fn(async () => {}),
  };
  const passthrough = new ProxyPassthrough(client as any, server as any, { toolsMode: mode });
  passthrough.attach();
  return { client, handlers, passthrough };
}

describe('CM-04 bridge --tools mode', () => {
  it('meta filters tools/list to the discovery/run surface', async () => {
    const { handlers } = harness('meta');
    const result = await handlers.get(ListToolsRequestSchema)!({ params: {} });
    expect(result.tools.map((t: { name: string }) => t.name)).toEqual(['tools_list', 'tool_schema', 'tool_help', 'tools_run']);
  });

  it('meta rejects a direct call to a non-meta tool', () => {
    const { handlers, client } = harness('meta');
    const call = handlers.get(CallToolRequestSchema)!;
    expect(() => call({ params: { name: 'tasks_list', arguments: {} } })).toThrow(/meta mode/);
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it('full still mirrors and forwards every tool', async () => {
    const { handlers, client } = harness('full');
    const list = await handlers.get(ListToolsRequestSchema)!({ params: {} });
    expect(list.tools).toHaveLength(6);
    await handlers.get(CallToolRequestSchema)!({ params: { name: 'tasks_list', arguments: { project: 'x' } } });
    expect(client.callTool).toHaveBeenCalledWith({ name: 'tasks_list', arguments: { project: 'x' } });
  });

  it('probe counts the filtered meta surface', async () => {
    const meta = harness('meta').passthrough;
    await expect(meta.probe()).resolves.toMatchObject({ tools: 4 });
    const full = harness('full').passthrough;
    await expect(full.probe()).resolves.toMatchObject({ tools: 6 });
  });
});
