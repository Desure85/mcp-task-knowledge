/**
 * tests/config-reload.test.ts — Hot config reload (DX-004)
 *
 * Verifies config_reload tool works end-to-end: with MCP_CONFIG_JSON set,
 * reload returns ok with the current embeddings mode.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const TMP = path.join(process.cwd(), '.tmp-cfg-reload');
const STORE = path.join(TMP, 'store');

describe('DX-004: config_reload', () => {
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
        // Config from JSON so reload has a source
        MCP_CONFIG_JSON: JSON.stringify({ dataDir: STORE, currentProject: 'reload-test' }),
      },
    });
    client = new Client({ name: 'dx004', version: '0.0.1' });
    await client.connect(transport);
  }, 60000);

  afterAll(async () => {
    try {
      if (client && typeof (client as any).close === 'function') await (client as any).close();
      if (transport && typeof (transport as any).close === 'function') await (transport as any).close();
    } catch {}
    await fsp.rm(TMP, { recursive: true, force: true });
  }, 60000);

  it('reloads config from MCP_CONFIG_JSON source', async () => {
    const res = await client.callTool({ name: 'config_reload', arguments: {} });
    const text = (res?.content as any)?.[0]?.text ?? '{}';
    const env = JSON.parse(text);
    expect(env.ok).toBe(true);
    expect(env.data.reloaded).toBe(true);
    expect(env.data.source).toBe('MCP_CONFIG_JSON');
    expect(env.data.embeddingsMode).toBe('none');
  });
});
