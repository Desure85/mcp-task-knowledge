/**
 * SPEC-06 — resources/subscribe + notifications/resources/updated.
 *
 * Real stdio server, real SDK client: subscribe to tasks://current, mutate a
 * task, observe the notification; unsubscribe and verify the notification
 * stops. Also checks that initialize advertises resources.subscribe.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  ResourceUpdatedNotificationSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { assertDistFresh } from './support/dist-guard.js';

assertDistFresh();

const DIST_ENTRY = path.join(process.cwd(), 'dist', 'index.js');
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function connect(): Promise<{ client: Client; dataDir: string }> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-subscribe-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [DIST_ENTRY],
    env: { ...process.env, DATA_DIR: dataDir, OBSIDIAN_VAULT_ROOT: path.join(dataDir, 'vault'), EMBEDDINGS_MODE: 'none', CATALOG_ENABLED: 'false' },
    stderr: 'ignore',
  });
  const client = new Client({ name: 'spec-06-subscribe', version: '0.0.1' });
  await client.connect(transport);
  cleanups.push(async () => {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return { client, dataDir };
}

async function createTask(client: Client, title: string): Promise<void> {
  const result = await client.callTool({ name: 'tasks_create', arguments: { title } });
  const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
  const env = JSON.parse(text) as { ok: boolean; error?: unknown };
  expect(env.ok, JSON.stringify(env)).toBe(true);
}

function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('notification timeout'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

describe('SPEC-06 resources/subscribe', () => {
  it('advertises subscribe and emits resources/updated for a subscribed task resource', async () => {
    const { client } = await connect();
    const updates: string[] = [];
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
      updates.push(notification.params.uri);
    });

    expect(client.getServerCapabilities()?.resources?.subscribe).toBe(true);
    await client.subscribeResource({ uri: 'tasks://current' });
    await createTask(client, 'SPEC-06 subscribed task');
    await waitFor(() => updates.includes('tasks://current'));
  });

  it('stops notifying after resources/unsubscribe', async () => {
    const { client } = await connect();
    const updates: string[] = [];
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
      updates.push(notification.params.uri);
    });

    await client.subscribeResource({ uri: 'tasks://current' });
    await createTask(client, 'SPEC-06 before unsubscribe');
    await waitFor(() => updates.includes('tasks://current'));

    await client.unsubscribeResource({ uri: 'tasks://current' });
    updates.length = 0;
    await createTask(client, 'SPEC-06 after unsubscribe');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(updates).toEqual([]);
  });
});
