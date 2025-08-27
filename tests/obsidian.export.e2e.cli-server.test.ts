import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-e2e-export-server');
const VAULT = path.join(TMP, 'vault');
const STORE = path.join(TMP, 'store');
const PROJECT = 'mcp';

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

async function mkdirp(p: string) {
  await fsp.mkdir(p, { recursive: true });
}

async function exists(p: string) {
  try { await fsp.stat(p); return true; } catch { return false; }
}

describe('obsidian_export_project — full e2e via MCP server (stdio client)', () => {
  let client: Client | null = null;
  let transport: StdioClientTransport | null = null;

  beforeAll(async () => {
    await rmrf(TMP);
    await mkdirp(VAULT);
    await mkdirp(STORE);

    // seed minimal store data (knowledge + task)
    process.env.DATA_DIR = STORE;
    const kb = await import('../src/storage/knowledge.js');
    const tasks = await import('../src/storage/tasks.js');
    await kb.createDoc({ project: PROJECT, title: 'E2E_EXPORT_DOC', content: 'x', type: 'overview' });
    await tasks.createTask({ project: PROJECT, title: 'E2E_EXPORT_TASK' });

    // start server
    transport = new StdioClientTransport({
      command: 'node',
      args: ['dist/index.js'],
      env: {
        ...process.env,
        DATA_DIR: STORE,
        OBSIDIAN_VAULT_ROOT: VAULT,
        EMBEDDINGS_MODE: 'none',
      },
    });
    client = new Client({ name: 'e2e-client', version: '0.0.1' });
    await client.connect(transport);
  }, 60000);

  afterAll(async () => {
    try {
      // @ts-ignore
      if (client && typeof client.close === 'function') await (client as any).close();
      // @ts-ignore
      if (transport && typeof transport.close === 'function') await (transport as any).close();
    } catch {}
    await rmrf(TMP);
  }, 60000);

  it('dryRun envelope matches CLI contract (willWrite/willDeleteDirs present)', async () => {
    const res = await client!.callTool({
      name: 'obsidian_export_project',
      arguments: {
        project: PROJECT,
        knowledge: true,
        tasks: true,
        strategy: 'merge',
        dryRun: true,
      },
    });
    const text = res?.content?.[0]?.text ?? '';
    const env = JSON.parse(text);
    expect(env.ok).toBe(true);
    expect(env.data?.project).toBe(PROJECT);
    expect(['merge', 'replace']).toContain(env.data?.strategy);
    expect(typeof env.data?.plan?.willWrite?.knowledgeCount).toBe('number');
    expect(typeof env.data?.plan?.willWrite?.tasksCount).toBe('number');
    expect(Array.isArray(env.data?.plan?.willDeleteDirs)).toBe(true);
  }, 40000);

  it('replace not confirmed: expected error envelope', async () => {
    const res = await client!.callTool({
      name: 'obsidian_export_project',
      arguments: {
        project: PROJECT,
        knowledge: true,
        tasks: true,
        strategy: 'replace',
        // confirm omitted intentionally
      },
    });
    const text = res?.content?.[0]?.text ?? '';
    const env = JSON.parse(text);
    expect(env.ok).toBe(false);
    expect(String(env.error?.message || '')).toContain('not confirmed');
  }, 40000);

  it('replace confirmed: expected ok envelope and INDEX.md present', async () => {
    const res = await client!.callTool({
      name: 'obsidian_export_project',
      arguments: {
        project: PROJECT,
        knowledge: true,
        tasks: true,
        strategy: 'replace',
        confirm: true,
      },
    });
    const text = res?.content?.[0]?.text ?? '';
    const env = JSON.parse(text);
    expect(env.ok).toBe(true);
    const projRoot = path.join(VAULT, PROJECT);
    const idx = path.join(projRoot, 'INDEX.md');
    expect(await exists(idx)).toBe(true);
  }, 40000);
});
