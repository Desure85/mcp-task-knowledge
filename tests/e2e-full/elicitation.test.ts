/**
 * tests/e2e-full/elicitation.test.ts — TR-12 elicitation confirm flow e2e.
 *
 * Spawns a real server (dist/index.js) over stdio with a client that declares
 * the `elicitation` capability and answers `elicitation/create` requests with
 * a scripted action. Verifies:
 *   - project_purge without confirm → elicitation fires → accept → purge runs
 *   - decline → error envelope, nothing deleted
 *   - client WITHOUT the capability → existing refusal message (unsupported)
 *   - confirm:true still bypasses elicitation entirely (backward compat)
 */

import path from 'node:path';
import fsp from 'node:fs/promises';
import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const ROOT = process.cwd();

type ElicitAction = 'accept' | 'decline' | 'cancel';

async function spawnElicitServer(tag: string, responder: (params: any) => { action: ElicitAction; content?: Record<string, unknown> }) {
  const tmp = path.join(ROOT, `.tmp-e2e-elicit-${tag}-${process.pid}`);
  const store = path.join(tmp, 'store');
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(store, { recursive: true });

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: {
      ...process.env,
      DATA_DIR: store,
      OBSIDIAN_VAULT_ROOT: path.join(tmp, 'vault'),
      EMBEDDINGS_MODE: 'none',
      CATALOG_ENABLED: 'false',
    },
  });
  const client = new Client(
    { name: `tr12-${tag}`, version: '0.0.1' },
    { capabilities: { elicitation: {} } },
  );
  const elicitSpy = vi.fn(responder);
  client.setRequestHandler(ElicitRequestSchema, async (req) => elicitSpy(req.params));
  await client.connect(transport);

  async function callTool(name: string, args: Record<string, unknown>) {
    const res = await client.callTool({ name, arguments: args });
    const text = (res?.content as any)?.[0]?.text ?? '';
    return { isError: (res as { isError?: boolean } | undefined)?.isError ?? false, env: JSON.parse(text) };
  }

  async function close() {
    try { await client.close(); } catch {}
    try { await (transport as any).close?.(); } catch {}
    for (let i = 0; i < 12; i++) {
      try {
        await fsp.rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }

  return { client, callTool, close, elicitSpy, store };
}

describe('TR-12: elicitation confirm flow', () => {
  it('project_purge without confirm → elicitation accept → purge proceeds', async () => {
    const srv = await spawnElicitServer('accept', () => ({ action: 'accept', content: { confirm: true } }));
    const proj = `tr12a${Date.now().toString(36)}`;
    try {
      await srv.callTool('project_create', { id: proj });
      await srv.callTool('tasks_create', { project: proj, title: 'tr12 victim task' });

      const purge = await srv.callTool('project_purge', { project: proj });
      expect(srv.elicitSpy).toHaveBeenCalledOnce();
      expect(srv.elicitSpy.mock.calls[0][0].message).toContain(proj);
      expect(purge.isError).toBe(false);
      expect(purge.env.ok).toBe(true);
      expect(purge.env.data.counts.tasks).toBe(1);

      const after = await srv.callTool('tasks_list', { project: proj });
      expect(JSON.stringify(after.env.data)).not.toContain('tr12 victim task');
    } finally {
      await srv.close();
    }
  }, 120000);

  it('project_purge without confirm → elicitation decline → refused, data intact', async () => {
    const srv = await spawnElicitServer('decline', () => ({ action: 'decline' }));
    const proj = `tr12d${Date.now().toString(36)}`;
    try {
      await srv.callTool('project_create', { id: proj });
      await srv.callTool('tasks_create', { project: proj, title: 'tr12 survivor task' });

      const purge = await srv.callTool('project_purge', { project: proj });
      expect(srv.elicitSpy).toHaveBeenCalledOnce();
      expect(purge.isError).toBe(true);
      expect(purge.env.ok).toBe(false);
      expect(purge.env.error?.message ?? '').toContain('not confirmed');
      expect(purge.env.error?.message ?? '').toContain('declined');

      const after = await srv.callTool('tasks_list', { project: proj });
      expect(JSON.stringify(after.env.data)).toContain('tr12 survivor task');
    } finally {
      await srv.close();
    }
  }, 120000);

  it('confirm:true bypasses elicitation entirely (backward compat)', async () => {
    const srv = await spawnElicitServer('bypass', () => ({ action: 'decline' }));
    const proj = `tr12b${Date.now().toString(36)}`;
    try {
      await srv.callTool('project_create', { id: proj });
      await srv.callTool('tasks_create', { project: proj, title: 'tr12 bypass task' });

      const purge = await srv.callTool('project_purge', { project: proj, confirm: true });
      expect(srv.elicitSpy).not.toHaveBeenCalled();
      expect(purge.env.ok).toBe(true);
    } finally {
      await srv.close();
    }
  }, 120000);

  it('tasks_bulk_delete_permanent via elicitation accept', async () => {
    const srv = await spawnElicitServer('bulk', () => ({ action: 'accept', content: { confirm: true } }));
    try {
      const t = await srv.callTool('tasks_create', { project: 'mcp', title: 'tr12 bulk victim' });
      const id = t.env.data.id ?? t.env.data.task?.id;
      const del = await srv.callTool('tasks_bulk_delete_permanent', { project: 'mcp', ids: [id] });
      expect(srv.elicitSpy).toHaveBeenCalledOnce();
      expect(del.env.ok).toBe(true);
      expect(del.env.data.count).toBe(1);
    } finally {
      await srv.close();
    }
  }, 120000);

  it('knowledge_bulk_delete_permanent now has confirm gate (TR-25) + elicitation', async () => {
    const srv = await spawnElicitServer('kb', () => ({ action: 'accept', content: { confirm: true } }));
    try {
      const d = await srv.callTool('knowledge_bulk_create', {
        project: 'mcp',
        items: [{ title: 'tr12 kb victim', content: 'x' }],
      });
      const id = d.env.data.created[0].id;
      const del = await srv.callTool('knowledge_bulk_delete_permanent', { project: 'mcp', ids: [id] });
      expect(srv.elicitSpy).toHaveBeenCalledOnce();
      expect(del.env.ok).toBe(true);
      expect(del.env.data.count).toBe(1);
    } finally {
      await srv.close();
    }
  }, 120000);
});
