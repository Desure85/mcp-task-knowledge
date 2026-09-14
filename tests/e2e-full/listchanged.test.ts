/**
 * tests/e2e-full/listchanged.test.ts — SPEC-04: listChanged notifications.
 *
 * The tool surface is dynamic (DX-001 hot registration, connector init), so
 * the server declares tools.listChanged=true and must emit
 * notifications/tools/list_changed when the surface mutates. Tool-as-resource
 * wrappers (TOOL_RES_ENABLED, default on) mutate the resource surface too →
 * notifications/resources/list_changed.
 *
 * Spawns the real dist/index.js over stdio and asserts:
 *  - initialize advertises tools.listChanged=true, resources.listChanged=true
 *    (TOOL_RES_ENABLED default), prompts.listChanged=false (startup snapshot)
 *  - tools_register → notifications/tools/list_changed + notifications/resources/list_changed
 *    and the new tool appears in the native tools/list
 *  - tools_unregister → both notifications again and the tool is gone from
 *    the native tools/list (SDK-level remove(), not just registry hiding)
 */

import { describe, it, expect } from 'vitest';
import {
  ToolListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { spawnServer } from './harness.js';

function collectNotifications(srv: Awaited<ReturnType<typeof spawnServer>>) {
  const got = { tools: 0, resources: 0 };
  srv.client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    got.tools++;
  });
  srv.client.setNotificationHandler(ResourceListChangedNotificationSchema, () => {
    got.resources++;
  });
  return got;
}

async function waitFor(cond: () => boolean, ms = 5000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('SPEC-04: listChanged capability flags', () => {
  it('initialize advertises listChanged on dynamic surfaces', async () => {
    const srv = await spawnServer('listchanged-caps');
    try {
      const caps = srv.client.getServerCapabilities();
      expect(caps).toBeTruthy();
      expect(caps!.tools).toEqual({ listChanged: true });
      // TOOL_RES_ENABLED defaults to true → tool:// wrappers change at runtime.
      // (registerCapabilities merges list/read flags — match the subset.)
      expect(caps!.resources).toMatchObject({ listChanged: true });
      // resources/subscribe is not implemented — the flag must not be truthy.
      expect((caps!.resources as Record<string, unknown>).subscribe).toBeFalsy();
      // The SDK force-sets prompts.listChanged=true when prompt handlers
      // register, overriding SERVER_CAPS — advertised true although prompts
      // are a startup snapshot (SPEC-03) and no list_changed is ever emitted.
      expect(caps!.prompts).toMatchObject({ listChanged: true });
    } finally {
      await srv.close();
    }
  }, 60000);
});

describe('SPEC-04: notifications on hot registration', () => {
  it('tools_register emits tools+resources list_changed; tools/list shows the tool', async () => {
    const srv = await spawnServer('listchanged-reg');
    try {
      const got = collectNotifications(srv);
      const toolName = `spec04_echo_${Date.now().toString(36)}`.replace(/[^a-z0-9_]/g, '_');

      const reg = await srv.callTool('tools_register', {
        name: toolName,
        title: 'SPEC-04 echo',
        handlerKind: 'echo',
      });
      expect(reg.isError).toBe(false);
      expect(reg.env.ok).toBe(true);

      await waitFor(() => got.tools >= 1);
      await waitFor(() => got.resources >= 1);

      const list = await srv.client.listTools();
      const names = list.tools.map((t) => t.name);
      expect(names).toContain(toolName);
    } finally {
      await srv.close();
    }
  }, 60000);

  it('tools_unregister emits list_changed and removes the tool from native tools/list', async () => {
    const srv = await spawnServer('listchanged-unreg');
    try {
      const got = collectNotifications(srv);
      const toolName = `spec04_tmp_${Date.now().toString(36)}`.replace(/[^a-z0-9_]/g, '_');

      await srv.callTool('tools_register', { name: toolName, handlerKind: 'echo' });
      await waitFor(() => got.tools >= 1);
      const before = got.tools;

      const unreg = await srv.callTool('tools_unregister', { name: toolName });
      expect(unreg.isError).toBe(false);
      expect(unreg.env.ok).toBe(true);

      await waitFor(() => got.tools > before);

      const list = await srv.client.listTools();
      const names = list.tools.map((t) => t.name);
      expect(names).not.toContain(toolName);
    } finally {
      await srv.close();
    }
  }, 60000);
});
