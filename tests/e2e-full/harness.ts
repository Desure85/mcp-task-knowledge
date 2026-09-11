/**
 * tests/e2e-full/harness.ts — Shared hermetic harness for Q-014 full-server E2E.
 *
 * Each suite spawns a REAL server (dist/index.js) over stdio with an isolated
 * tmp DATA_DIR, so suites never share state and never touch the repo.
 * Deterministic by construction: fresh store per suite, EMBEDDINGS_MODE=none.
 */

import path from 'node:path';
import fsp from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = process.cwd();

export interface E2EServer {
  client: Client;
  transport: StdioClientTransport;
  store: string;
  tmp: string;
  callTool: (name: string, args: Record<string, unknown>) => Promise<{ isError: boolean; env: any }>;
  close: () => Promise<void>;
}

export async function spawnServer(tag: string, extraEnv: Record<string, string> = {}): Promise<E2EServer> {
  const tmp = path.join(ROOT, `.tmp-e2e-full-${tag}-${process.pid}`);
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
      ...extraEnv,
    },
  });
  const client = new Client({ name: `q014-${tag}`, version: '0.0.1' });
  await client.connect(transport);

  async function callTool(name: string, args: Record<string, unknown>) {
    const res = await client.callTool({ name, arguments: args });
    const text = (res?.content as any)?.[0]?.text ?? '';
    return { isError: (res as { isError?: boolean } | undefined)?.isError ?? false, env: JSON.parse(text) };
  }

  async function close() {
    try {
      await client.close();
    } catch {}
    try {
      await (transport as any).close?.();
    } catch {}
    // Prompt mutations spawn an async reindex chain (scripts/prompts.mjs) that
    // keeps writing into the store after the server exits — retry the cleanup
    // so ENOTEMPTY/EBUSY from in-flight writers can't fail the suite.
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

  return { client, transport, store, tmp, callTool, close };
}
