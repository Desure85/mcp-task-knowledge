import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { assertDistFresh } from './support/dist-guard.js';

const DIST_ENTRY = path.join(process.cwd(), 'dist', 'index.js');
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
  return JSON.parse(text);
}

describe('TR-13 upgrade path', () => {
  it('reads schema-0 tasks/docs and stamps schema 1 without a manifest', async () => {
    assertDistFresh();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-upgrade-'));
    fs.mkdirSync(path.join(dataDir, 'tasks', 'legacy'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'knowledge', 'legacy'), { recursive: true });

    // Version N=0: no .schema-version, no type field, flat task/doc shapes.
    fs.writeFileSync(
      path.join(dataDir, 'tasks', 'legacy', 'old-task.json'),
      JSON.stringify({
        id: 'old-task',
        project: 'legacy',
        title: 'Task from old version',
        description: 'legacy body',
        status: 'pending',
        priority: 'medium',
        tags: ['legacy'],
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-01-02T00:00:00.000Z',
      }),
    );
    fs.writeFileSync(
      path.join(dataDir, 'knowledge', 'legacy', 'old-doc.md'),
      [
        '---',
        'id: old-doc',
        'project: legacy',
        'title: Doc from old version',
        'createdAt: 2020-01-01T00:00:00.000Z',
        'updatedAt: 2020-01-02T00:00:00.000Z',
        '---',
        '',
        'legacy knowledge body',
        '',
      ].join('\n'),
    );
    expect(fs.existsSync(path.join(dataDir, '.schema-version'))).toBe(false);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [DIST_ENTRY],
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        CURRENT_PROJECT: 'legacy',
        OBSIDIAN_VAULT_ROOT: path.join(dataDir, 'vault'),
        EMBEDDINGS_MODE: 'none',
        CATALOG_ENABLED: 'false',
      },
      stderr: 'ignore',
    });
    const client = new Client({ name: 'tr-13-upgrade', version: '0.0.1' });
    await client.connect(transport);
    cleanups.push(async () => {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
      fs.rmSync(dataDir, { recursive: true, force: true });
    });

    const task = await call(client, 'tasks_get', { id: 'old-task' });
    expect(task.ok, JSON.stringify(task)).toBe(true);
    expect(task.data).toMatchObject({ id: 'old-task', title: 'Task from old version', description: 'legacy body' });
    expect(task.data.type ?? 'task').toBe('task');

    const doc = await call(client, 'knowledge_get', { id: 'old-doc' });
    expect(doc.ok, JSON.stringify(doc)).toBe(true);
    expect(doc.data).toMatchObject({ id: 'old-doc', title: 'Doc from old version' });
    expect(doc.data.content).toContain('legacy knowledge body');

    const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, '.schema-version'), 'utf8'));
    expect(manifest).toMatchObject({ schema: 1 });
    expect(typeof manifest.updatedBy).toBe('string');
  });
});
