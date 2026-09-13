/**
 * Live integration test: web-ui api-client vs a real MCP HTTP server (PH-015d).
 *
 * Gated on MCP_LIVE_URL — skipped by default so `npm test` stays hermetic.
 * CI sets MCP_LIVE_URL to a spawned `node dist/index.js` http instance.
 *
 * Verifies the whole chain the browser relies on:
 * initialize → mcp-session-id reuse → tools/call → envelope parsing,
 * session visibility in session_list, and project scoping.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';

const LIVE = process.env.MCP_LIVE_URL;
const JWT_SECRET = process.env.MCP_LIVE_JWT_SECRET;
const maybe = LIVE ? describe : describe.skip;

/**
 * Mint an HS256 JWT for the live server (JwtValidator, sub claim).
 * AUD-04: session_list is admin-only — include roles claim so the
 * live tests exercise the same path a real admin UI session uses.
 */
function mintJwt(secret: string, sub = 'webui-e2e', roles: string[] = ['admin']): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const body = b64({ sub, iat: now, exp: now + 600, roles });
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

maybe('api-client vs live MCP server', () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_MCP_API_URL = LIVE;
    if (JWT_SECRET) {
      // env-token path — no window/sessionStorage needed in node
      process.env.NEXT_PUBLIC_MCP_TOKEN = mintJwt(JWT_SECRET);
    }
  });

  it('initialize + tools_list works end-to-end', async () => {
    const { api, resetClient } = await import('./api-client');
    resetClient();
    const tools = await api.system.toolsList(undefined, 100);
    const names = (tools?.data ?? []).map((t) => t.name);
    expect(names).toContain('tasks_create');
    expect(names).toContain('session_list');
    expect(tools?.pagination?.total).toBeGreaterThan(50);
  });

  it('this browser session appears in session_list', async () => {
    const { api } = await import('./api-client');
    const list = await api.system.sessionList();
    expect(list.available).toBe(true);
    expect(list.total).toBeGreaterThanOrEqual(1);
    // authenticated session carries userId in metadata (PH-002 wiring)
    const ours = list.sessions.find((s) => s.metadata?.userId === 'webui-e2e');
    expect(ours).toBeTruthy();
    expect(ours!.sessionId).toBeTruthy();
  });

  it('task CRUD + project scoping roundtrip', async () => {
    const { api } = await import('./api-client');
    const suffix = `live-${Date.now()}`;
    const created = await api.tasks.create({ title: `webui-${suffix}`, tags: ['e2e-live'] });
    expect(created.id).toBeTruthy();
    const got = await api.tasks.get(created.project ?? 'mcp', created.id);
    expect(got.title).toBe(`webui-${suffix}`);
    await api.tasks.close(created.project ?? 'mcp', created.id);
  });
});
