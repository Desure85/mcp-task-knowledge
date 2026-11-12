import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { assertDistFresh } from './support/dist-guard.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function connect(): Promise<Client> {
  assertDistFresh();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-surface-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(process.cwd(), 'dist', 'index.js')],
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      CURRENT_PROJECT: 'surface',
      OBSIDIAN_VAULT_ROOT: path.join(dataDir, 'vault'),
      EMBEDDINGS_MODE: 'none',
      CATALOG_ENABLED: 'false',
    },
    stderr: 'ignore',
  });
  const client = new Client({ name: 'ph-014-surface', version: '0.0.1' });
  await client.connect(transport);
  cleanups.push(async () => {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return client;
}

describe('PH-014 protocol surface', () => {
  it('serves resources/list, resources/read and prompts/get over real stdio', async () => {
    const client = await connect();
    const created = await client.callTool({ name: 'tasks_create', arguments: { title: 'Surface task' } });
    const taskEnvelope = JSON.parse((created.content as Array<{ text?: string }>)[0]?.text ?? '{}');
    expect(taskEnvelope.ok, JSON.stringify(taskEnvelope)).toBe(true);

    const resources = await client.listResources();
    expect(resources.resources.map((r) => r.uri)).toContain('tasks://current');
    const read = await client.readResource({ uri: 'tasks://current' });
    const text = (read.contents[0] as { text?: string })?.text ?? '[]';
    expect(JSON.parse(text)).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Surface task' })]));

    const prompts = await client.listPrompts();
    expect(prompts.prompts.length).toBeGreaterThan(0);
    const prompt = prompts.prompts[0];
    const args = Object.fromEntries((prompt.arguments ?? []).map((a) => [a.name, 'demo']));
    const result = await client.getPrompt({ name: prompt.name, arguments: args });
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[0]).toHaveProperty('content');
  });
});
