/**
 * AUD-10 — tools_run / tools_batch must not bypass the auth gate.
 *
 * Before the fix, toolRegistry stored the RAW handler and tools_run /
 * tools_batch invoked it directly — skipping wrapToolHandler entirely:
 * no auth-gate, no SecurityStack, no requestScope (session project),
 * no egress scan, and no TOOLS_ENABLED=0 enforcement.
 *
 * Covers:
 *   - registry stores the GATED handler (auth deny propagates through
 *     tools_run / tools_batch dispatch)
 *   - requestScope (sessionId) propagates into batch-invoked handlers
 *   - TOOLS_ENABLED=0 → tools_run refuses non-whitelist tools
 *   - legitimate use still works (stdio / authenticated session)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServerContext } from '../src/register/setup.js';
import { registerToolsIntrospection } from '../src/register/tools-introspection.js';
import { AuthManager, createStaticValidator } from '../src/core/auth.js';
import { currentSessionId } from '../src/core/request-context.js';
import { ok } from '../src/utils/respond.js';
import type { ServerContext } from '../src/register/context.js';

const TMP = path.join(process.cwd(), '.tmp-aud10');

async function makeCtx(toolsEnabled = true): Promise<ServerContext> {
  process.env.DATA_DIR = TMP;
  process.env.EMBEDDINGS_MODE = 'none';
  process.env.CATALOG_ENABLED = 'false';
  if (!toolsEnabled) {
    // Fully-off state: classic tools AND resource-based execution both off.
    // (TOOL_RES_ENABLED=true alone is the resources-only mode where tools_run
    // is the intended execution surface — covered by a separate test.)
    process.env.MCP_TOOLS_ENABLED = '0';
    process.env.MCP_TOOL_RESOURCES_ENABLED = '0';
  } else {
    delete process.env.MCP_TOOLS_ENABLED;
    delete process.env.MCP_TOOL_RESOURCES_ENABLED;
  }
  const ctx = await createServerContext();
  registerToolsIntrospection(ctx);
  return ctx;
}

async function connectClient(ctx: ServerContext): Promise<Client> {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await ctx.server.connect(st);
  const client = new Client({ name: 'aud10', version: '0.0.1' });
  await client.connect(ct);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  return JSON.parse((res?.content as any)?.[0]?.text ?? '{}');
}

describe('AUD-10: tools_run/tools_batch gate', () => {
  beforeAll(async () => {
    await fsp.rm(TMP, { recursive: true, force: true });
    await fsp.mkdir(TMP, { recursive: true });
  });
  afterAll(async () => {
    delete process.env.MCP_TOOLS_ENABLED;
    await fsp.rm(TMP, { recursive: true, force: true });
  });

  it('registry stores the gated handler — auth deny reaches tools_run dispatch', async () => {
    const ctx = await makeCtx();
    // Simulate http transport with required auth.
    ctx.transportType = 'http';
    ctx.authManager = new AuthManager({
      transport: 'http',
      tokenValidator: createStaticValidator({ 'good-token': { userId: 'u1', roles: [] } }),
    });

    // Register a probe tool through the gated registerTool path.
    ctx.server.registerTool('probe_secret', { inputSchema: {} }, async () => ok({ secret: 42 }));

    const meta = ctx.toolRegistry.get('probe_secret');
    expect(meta?.handler).toBeDefined();

    // Direct registry dispatch (what tools_run does) with an
    // unauthenticated session → gate must deny.
    const denied = (await meta!.handler!({}, { sessionId: 'anon' })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(denied.isError).toBe(true);
    expect(JSON.parse(denied.content[0].text)).toMatchObject({ ok: false });

    // Authenticated session → allowed.
    await ctx.authManager.authenticate('s-auth', 'good-token');
    const res = await meta!.handler!({}, { sessionId: 's-auth' });
    const payload = JSON.parse((res as any).content[0].text);
    expect(payload).toMatchObject({ ok: true, data: { secret: 42 } });
  });

  it('requestScope propagates sessionId into batch-invoked handlers', async () => {
    const ctx = await makeCtx();
    ctx.transportType = 'stdio'; // local — gate open, scope still set

    let seen: string | undefined;
    ctx.server.registerTool('probe_scope', { inputSchema: {} }, async () => {
      seen = currentSessionId();
      return ok({ seen });
    });

    const meta = ctx.toolRegistry.get('probe_scope')!;
    await meta.handler!({}, { sessionId: 'sess-xyz' });
    expect(seen).toBe('sess-xyz');
  });

  it('tools_run executes a real tool end-to-end (legitimate use works)', async () => {
    const ctx = await makeCtx();
    ctx.server.registerTool('probe_echo', { inputSchema: {} }, async (a: any) => ok({ echo: a }));
    const client = await connectClient(ctx);
    try {
      const res = await call(client, 'tools_run', { name: 'probe_echo', params: { x: 1 } });
      expect(res.ok).toBe(true);
      expect(res.data.results[0]).toMatchObject({ name: 'probe_echo', ok: true });
      expect(res.data.results[0].data).toMatchObject({ echo: { x: 1 } });
    } finally {
      await client.close();
    }
  });

  it('tools_batch executes in parallel through the gated path', async () => {
    const ctx = await makeCtx();
    ctx.server.registerTool('probe_a', { inputSchema: {} }, async () => ok('A'));
    ctx.server.registerTool('probe_b', { inputSchema: {} }, async () => ok('B'));
    const client = await connectClient(ctx);
    try {
      const res = await call(client, 'tools_batch', {
        items: [{ name: 'probe_a' }, { name: 'probe_b' }, { name: 'missing_tool' }],
      });
      expect(res.ok).toBe(true);
      expect(res.data.results).toHaveLength(3);
      expect(res.data.results[0].ok).toBe(true);
      expect(res.data.results[1].ok).toBe(true);
      expect(res.data.results[2].ok).toBe(false);
    } finally {
      await client.close();
    }
  });

  it('TOOLS_ENABLED=0 → tools_run refuses non-whitelist tools but runs whitelist', async () => {
    const ctx = await makeCtx(false);
    expect(ctx.TOOLS_ENABLED).toBe(false);
    // probe_off is NOT registered with the SDK (tools disabled) but IS in
    // the registry — the bypass this task closes.
    ctx.server.registerTool('probe_off', { inputSchema: {} }, async () => ok('should-not-run'));
    expect(ctx.toolRegistry.has('probe_off')).toBe(true);

    const client = await connectClient(ctx);
    try {
      const res = await call(client, 'tools_run', {
        items: [
          { name: 'probe_off', params: {} },
          { name: 'tools_list', params: {} },
        ],
      });
      expect(res.ok).toBe(true);
      const [off, list] = res.data.results;
      expect(off.ok).toBe(false);
      expect(off.error).toMatch(/disabled/i);
      expect(list.ok).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('TOOLS_ENABLED=0 → tools_batch refuses non-whitelist tools', async () => {
    const ctx = await makeCtx(false);
    ctx.server.registerTool('probe_off2', { inputSchema: {} }, async () => ok('nope'));
    const client = await connectClient(ctx);
    try {
      // tools_batch itself is not SDK-registered when tools are disabled,
      // so invoke its registry handler directly (defense-in-depth check).
      const meta = ctx.toolRegistry.get('tools_batch');
      if (meta?.handler) {
        const res = (await meta.handler({ items: [{ name: 'probe_off2' }] }, {})) as any;
        const payload = JSON.parse(res.content[0].text);
        expect(payload.data.results[0].ok).toBe(false);
        expect(payload.data.results[0].error).toMatch(/disabled/i);
      } else {
        // Not registered at all — also acceptable (whitelist excludes it).
        expect(meta).toBeUndefined();
      }
    } finally {
      await client.close();
    }
  });
});
