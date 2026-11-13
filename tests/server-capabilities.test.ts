import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerContext } from '../src/register/context.js';

type Handler = () => Promise<{ content: Array<{ text: string }> }>;
const tools: Record<string, Handler> = {};
const ctx = {
  server: { registerTool: (name: string, _def: unknown, handler: Handler) => { tools[name] = handler; } },
  toolRegistry: { size: 208, version: 11 },
  SERVER_CAPS: { tools: { listChanged: true }, resources: { subscribe: true } },
} as unknown as ServerContext;

const saved = { CATALOG_ENABLED: process.env.CATALOG_ENABLED, CATALOG_READ_ENABLED: process.env.CATALOG_READ_ENABLED, HISTORY_ENABLED: process.env.HISTORY_ENABLED, NODE_ENV: process.env.NODE_ENV };
beforeAll(async () => {
  const { registerServerCapabilitiesTools } = await import('../src/register/capabilities.js');
  registerServerCapabilitiesTools(ctx);
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

async function manifest(): Promise<{
  ok: boolean; data: {
    server: { version: string; toolCount: number }; capabilities: unknown;
    features: Array<{ id: string; enabled: boolean; readEnabled?: boolean; writeEnabled?: boolean; execEnabled?: boolean }>;
    limits: { maxPageLimit: number; toolsListMax: number; agentBootstrapTextMaxChars: number };
  };
}> {
  const raw = await tools['server_capabilities']!();
  return JSON.parse(raw.content[0]!.text);
}

describe('DX-15 server_capabilities', () => {
  it('reports version, caps and static limits', async () => {
    const body = await manifest();
    expect(body.ok).toBe(true);
    expect(body.data.server.toolCount).toBe(208);
    expect(body.data.server.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.data.capabilities).toEqual(ctx.SERVER_CAPS);
    expect(body.data.limits).toEqual({ maxPageLimit: 500, toolsListMax: 300, agentBootstrapTextMaxChars: 4096 });
    expect(body.data.features.find((f) => f.id === 'catalog')!.enabled).toBe(false);
  });

  it('reflects catalog flags and keeps disabled domains explicit', async () => {
    process.env.CATALOG_ENABLED = '1';
    process.env.CATALOG_READ_ENABLED = '0';
    process.env.CATALOG_WRITE_ENABLED = '1';
    process.env.HISTORY_ENABLED = '0';
    const body = await manifest();
    const catalog = body.data.features.find((f) => f.id === 'catalog')!;
    expect(catalog).toMatchObject({ enabled: true, readEnabled: false, writeEnabled: true });
    expect(body.data.features.find((f) => f.id === 'git_history')!.enabled).toBe(false);
    expect(body.data.features.find((f) => f.id === 'tools')!.enabled).toBe(true);
  });
});
