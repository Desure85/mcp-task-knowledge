/**
 * tests/e2e-full/mcp-prompts.test.ts — SPEC-03: MCP-native prompts surface.
 *
 * Verifies that the prompt library is exposed via the MCP prompts capability
 * (prompts/list + prompts/get), not only as prompts_* tools:
 *   - first boot seeds the library (DX-14) and builds the catalog;
 *   - second boot on the SAME store registers cataloged prompts at startup;
 *   - client.listPrompts() returns them with titles/descriptions/arguments;
 *   - client.getPrompt(name, args) renders {{var}} placeholders.
 *
 * Uses a local spawn helper instead of tests/e2e-full/harness.ts: the harness
 * close() deletes the store dir, but this suite needs the store to survive
 * between the two boots.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = process.cwd();

interface Boot {
  client: Client;
  store: string;
  tmp: string;
  callTool: (name: string, args: Record<string, unknown>) => Promise<{ isError: boolean; env: any }>;
  close: () => Promise<void>;
}

/** Spawn a server on an existing store dir; close() keeps the store intact. */
async function spawnOnStore(store: string, tmp: string, tag: string): Promise<Boot> {
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
  const client = new Client({ name: `spec03-${tag}`, version: '0.0.1' });
  await client.connect(transport);

  async function callTool(name: string, args: Record<string, unknown>) {
    const res = await client.callTool({ name, arguments: args });
    const text = (res?.content as any)?.[0]?.text ?? '';
    return { isError: (res as { isError?: boolean } | undefined)?.isError ?? false, env: JSON.parse(text) };
  }

  async function close() {
    try { await client.close(); } catch {}
    try { await (transport as any).close?.(); } catch {}
  }

  return { client, store, tmp, callTool, close };
}

async function cleanupTmp(tmp: string): Promise<void> {
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

describe('SPEC-03: MCP prompts surface (prompts/list + prompts/get)', () => {
  it('listPrompts returns seeded library; getPrompt renders {{vars}}', async () => {
    const tmp = path.join(ROOT, `.tmp-e2e-spec03-${process.pid}`);
    const store = path.join(tmp, 'store');
    await fsp.rm(tmp, { recursive: true, force: true });
    await fsp.mkdir(store, { recursive: true });

    // Boot 1: fresh store → DX-14 seeds 7 prompts + reindex builds the catalog.
    const first = await spawnOnStore(store, tmp, 'seed');
    try {
      const deadline = Date.now() + 30000;
      let catalogOk = false;
      while (Date.now() < deadline) {
        const catalog = await first.callTool('prompts_catalog_get', { project: 'mcp' });
        if (catalog.env.ok) { catalogOk = true; break; }
        await new Promise((r) => setTimeout(r, 300));
      }
      expect(catalogOk).toBe(true);
    } finally {
      await first.close();
    }

    // Boot 2: same store → catalog exists at startup → prompts registered.
    const second = await spawnOnStore(store, tmp, 'serve');
    try {
      const list = await second.client.listPrompts();
      const names = list.prompts.map((p) => p.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'plan_sprint', 'capture_decision', 'standup',
          'postmortem', 'daily_review', 'code_review', 'bug_triage',
        ]),
      );

      const triage = list.prompts.find((p) => p.name === 'bug_triage');
      expect(triage).toBeDefined();
      expect(triage!.title).toBe('Bug Triage');
      expect(triage!.description).toContain('Triage a bug report');
      expect(triage!.arguments).toEqual([
        expect.objectContaining({ name: 'bug_description', required: true }),
      ]);

      const rendered = await second.client.getPrompt({
        name: 'bug_triage',
        arguments: { bug_description: 'Login button does nothing on mobile' },
      });
      expect(rendered.messages).toHaveLength(1);
      expect(rendered.messages[0].role).toBe('user');
      const text = (rendered.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain('Login button does nothing on mobile');
      expect(text).not.toContain('{{bug_description}}');
      expect(text).toContain('Severity');
    } finally {
      await second.close();
      await cleanupTmp(tmp);
    }
  }, 120000);

  it('prompts/list answers cleanly when no catalog exists (empty list, not -32601)', async () => {
    const tmp = path.join(ROOT, `.tmp-e2e-spec03-empty-${process.pid}`);
    const store = path.join(tmp, 'store');
    await fsp.rm(tmp, { recursive: true, force: true });
    await fsp.mkdir(store, { recursive: true });

    // First boot: registration runs BEFORE seeding, so the catalog is absent
    // at registration time — prompts/list must still answer { prompts: [] }.
    const srv = await spawnOnStore(store, tmp, 'empty');
    try {
      const list = await srv.client.listPrompts();
      expect(list.prompts).toEqual([]);
    } finally {
      await srv.close();
      await cleanupTmp(tmp);
    }
  }, 120000);
});
