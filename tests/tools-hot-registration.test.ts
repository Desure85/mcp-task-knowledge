/**
 * tests/tools-hot-registration.test.ts — Hot tool registration (DX-001)
 *
 * Verifies tools_register / tools_unregister work end-to-end through the
 * real MCP server: register a dynamic tool, invoke it, list it, unregister.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const TMP = path.join(process.cwd(), '.tmp-hot-reg');
const STORE = path.join(TMP, 'store');

describe('DX-001: hot tool registration', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    await fsp.rm(TMP, { recursive: true, force: true });
    await fsp.mkdir(STORE, { recursive: true });
    transport = new StdioClientTransport({
      command: 'node',
      args: ['dist/index.js'],
      env: {
        ...process.env,
        DATA_DIR: STORE,
        EMBEDDINGS_MODE: 'none',
        CATALOG_ENABLED: 'false',
      },
    });
    client = new Client({ name: 'dx001', version: '0.0.1' });
    await client.connect(transport);
  }, 60000);

  afterAll(async () => {
    try {
      if (client && typeof (client as any).close === 'function') await (client as any).close();
      if (transport && typeof (transport as any).close === 'function') await (transport as any).close();
    } catch {}
    await fsp.rm(TMP, { recursive: true, force: true });
  }, 60000);

  async function callTool(name: string, args: Record<string, unknown>) {
    const res = await client.callTool({ name, arguments: args });
    const text = (res?.content as any)?.[0]?.text ?? '';
    return { isError: res?.isError ?? false, env: JSON.parse(text) };
  }

  it('registers a dynamic tool, invokes it, and lists it', async () => {
    const reg = await callTool('tools_register', {
      name: 'echo_hello',
      title: 'Echo Hello',
      description: 'Echoes input back',
      handlerKind: 'echo',
    });
    expect(reg.env.ok).toBe(true);
    expect(reg.env.data.registered).toBe(true);

    // The tool should now be invocable
    const echo = await callTool('echo_hello', { hello: 'world' });
    expect(echo.env.ok).toBe(true);

    // And appear in tools_list
    const list = await callTool('tools_list', { offset: 0, limit: 100, search: 'echo_hello' });
    const names = (list.env.data?.data ?? []).map((t: any) => t.name);
    expect(names).toContain('echo_hello');
  });

  it('unregisters a tool so it is no longer listed', async () => {
    await callTool('tools_register', { name: 'temp_tool', handlerKind: 'echo' });

    const unreg = await callTool('tools_unregister', { name: 'temp_tool' });
    expect(unreg.env.ok).toBe(true);
    expect(unreg.env.data.removed).toBe(true);

    const list = await callTool('tools_list', { offset: 0, limit: 100, search: 'temp_tool' });
    const names = (list.env.data?.data ?? []).map((t: any) => t.name);
    expect(names).not.toContain('temp_tool');
  });

  it('unregister of unknown tool returns error envelope', async () => {
    const res = await callTool('tools_unregister', { name: 'no_such_tool' });
    expect(res.isError).toBe(true);
    expect(res.env.ok).toBe(false);
  });
});
