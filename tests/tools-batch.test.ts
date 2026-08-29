/**
 * tests/tools-batch.test.ts — Parallel tool batch execution (AI-015)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const TMP = path.join(process.cwd(), '.tmp-batch');
const STORE = path.join(TMP, 'store');

describe('AI-015: tools_batch (parallel)', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    await fsp.rm(TMP, { recursive: true, force: true });
    await fsp.mkdir(STORE, { recursive: true });
    transport = new StdioClientTransport({
      command: 'node', args: ['dist/index.js'],
      env: { ...process.env, DATA_DIR: STORE, EMBEDDINGS_MODE: 'none', CATALOG_ENABLED: 'false' },
    });
    client = new Client({ name: 'batch-test', version: '0.0.1' });
    await client.connect(transport);
  }, 60000);

  afterAll(async () => {
    try { if (client) await (client as any).close(); if (transport) await (transport as any).close(); } catch {}
    await fsp.rm(TMP, { recursive: true, force: true });
  }, 60000);

  async function call(name: string, args: Record<string, unknown>) {
    const res = await client.callTool({ name, arguments: args });
    return JSON.parse((res?.content as any)?.[0]?.text ?? '{}');
  }

  it('executes multiple tools in parallel and returns aggregated results', async () => {
    // Seed data first
    await call('tasks_create', { project: 'mcp', title: 'Batch task 1' });
    await call('tasks_create', { project: 'mcp', title: 'Batch task 2' });

    const res = await call('tools_batch', {
      items: [
        { name: 'tasks_list', params: { project: 'mcp' } },
        { name: 'project_get_current', params: {} },
        { name: 'embeddings_status', params: {} },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.data.count).toBe(3);
    expect(res.data.parallel).toBe(true);
    expect(res.data.results).toHaveLength(3);
    // All should succeed
    for (const r of res.data.results) {
      expect(r.ok).toBe(true);
    }
  });

  it('handles mixed success/failure in batch', async () => {
    const res = await call('tools_batch', {
      items: [
        { name: 'tasks_list', params: { project: 'mcp' } },
        { name: 'nonexistent_tool', params: {} },
      ],
    });
    expect(res.data.count).toBe(2);
    expect(res.data.results[0].ok).toBe(true);
    expect(res.data.results[1].ok).toBe(false);
    expect(res.data.results[1].error).toContain('not found');
  });

  it('rejects empty items array (zod validation)', async () => {
    await expect(client.callTool({ name: 'tools_batch', arguments: { items: [] } })).rejects.toThrow();
  });
});
