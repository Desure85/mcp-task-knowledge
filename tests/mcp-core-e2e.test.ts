/**
 * tests/mcp-core-e2e.test.ts — Core MCP tools end-to-end via stdio client (Q-004)
 *
 * Full lifecycle through the real MCP server (dist/index.js): tasks,
 * knowledge, search, projects, bulk operations, error envelopes.
 * Runs via `npm run e2e:cli` (scripts/e2e_cli.sh).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-e2e-core');
const STORE = path.join(TMP, 'store');
const PROJECT = 'mcp';

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

describe('Q-004: core MCP tools e2e via stdio client', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    await rmrf(TMP);
    await fsp.mkdir(STORE, { recursive: true });

    transport = new StdioClientTransport({
      command: 'node',
      args: ['dist/index.js'],
      env: {
        ...process.env,
        DATA_DIR: STORE,
        OBSIDIAN_VAULT_ROOT: path.join(TMP, 'vault'),
        EMBEDDINGS_MODE: 'none',
        CATALOG_ENABLED: 'false',
      },
    });
    client = new Client({ name: 'q004-e2e', version: '0.0.1' });
    await client.connect(transport);
  }, 60000);

  afterAll(async () => {
    try {
      if (client && typeof (client as any).close === 'function') await (client as any).close();
      if (transport && typeof (transport as any).close === 'function') await (transport as any).close();
    } catch {}
    await rmrf(TMP);
  }, 60000);

  async function callTool(name: string, args: Record<string, unknown>) {
    const res = await client.callTool({ name, arguments: args });
    const text = (res?.content as any)?.[0]?.text ?? '';
    return { isError: res?.isError ?? false, env: JSON.parse(text) };
  }

  it('tasks full lifecycle: create → list → update → close → get', async () => {
    const created = await callTool('tasks_create', {
      project: PROJECT,
      title: 'E2E task',
      priority: 'high',
      tags: ['e2e'],
    });
    expect(created.isError).toBe(false);
    expect(created.env.ok).toBe(true);
    const taskId = created.env.data.id;

    const listed = await callTool('tasks_list', { project: PROJECT });
    expect(Array.isArray(listed.env.data)).toBe(true);
    expect(listed.env.data.some((t: any) => t.id === taskId)).toBe(true);

    const updated = await callTool('tasks_update', { project: PROJECT, id: taskId, status: 'in_progress' });
    expect(updated.env.data.status).toBe('in_progress');

    const closed = await callTool('tasks_close', { project: PROJECT, id: taskId });
    expect(closed.env.data.closed.status).toBe('closed');

    const got = await callTool('tasks_get', { project: PROJECT, id: taskId });
    expect(got.env.data.id).toBe(taskId);
  });

  it('knowledge full lifecycle: bulk create → get → list → bulk archive/restore', async () => {
    const created = await callTool('knowledge_bulk_create', {
      project: PROJECT,
      items: [{ title: 'E2E doc', content: '# Hello', tags: ['e2e'], type: 'note' }],
    });
    expect(created.env.ok).toBe(true);
    const docId = created.env.data.created[0].id;

    const got = await callTool('knowledge_get', { project: PROJECT, id: docId });
    expect(got.env.data.title).toBe('E2E doc');

    const archived = await callTool('knowledge_bulk_archive', { project: PROJECT, ids: [docId] });
    expect(archived.env.ok).toBe(true);
    expect(archived.env.data.results.length).toBe(1);

    const restored = await callTool('knowledge_bulk_restore', { project: PROJECT, ids: [docId] });
    expect(restored.env.ok).toBe(true);
    expect(restored.env.data.results.length).toBe(1);
  });

  it('search finds created entities (BM25)', async () => {
    await callTool('tasks_create', { project: PROJECT, title: 'UniqueSearchableTerm42' });
    await callTool('knowledge_bulk_create', {
      project: PROJECT,
      items: [{ title: 'KnowledgeUniqueTerm42', content: 'content about UniqueSearchableTerm42' }],
    });

    const taskRes = await callTool('search_tasks', { project: PROJECT, query: 'UniqueSearchableTerm42' });
    expect(taskRes.env.ok).toBe(true);
    expect(taskRes.env.data.length).toBeGreaterThan(0);

    const kbRes = await callTool('search_knowledge', { project: PROJECT, query: 'UniqueSearchableTerm42' });
    expect(kbRes.env.ok).toBe(true);
    expect(kbRes.env.data.length).toBeGreaterThan(0);
  });

  it('bulk create + delete permanent works end-to-end', async () => {
    const bulk = await callTool('tasks_bulk_create', {
      project: PROJECT,
      items: [{ title: 'bulk-1' }, { title: 'bulk-2' }],
    });
    expect(bulk.env.ok).toBe(true);
    const ids = bulk.env.data.created.map((c: any) => c.id);
    expect(ids).toHaveLength(2);

    const del = await callTool('tasks_bulk_delete_permanent', {
      project: PROJECT,
      ids,
      confirm: true,
      dryRun: false,
    });
    expect(del.env.ok).toBe(true);
    expect(del.env.data.count).toBe(2);
  });

  it('project list/get_current works via MCP', async () => {
    const list = await callTool('project_list', {});
    expect(list.env.ok).toBe(true);
    expect(list.env.data.projects.some((p: any) => p.id === PROJECT)).toBe(true);

    const current = await callTool('project_get_current', {});
    expect(current.env.ok).toBe(true);
    expect(current.env.data.project).toBe(PROJECT);
  });

  it('errors return consistent isError envelope, not throw', async () => {
    const missing = await callTool('tasks_get', { project: PROJECT, id: 'nonexistent-id' });
    expect(missing.isError).toBe(true);
    expect(missing.env.ok).toBe(false);
    expect(missing.env.error.message).toContain('not found');
  });
});
