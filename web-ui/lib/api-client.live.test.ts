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

  /** Page through the whole catalog so the assertion never depends on page size. */
  async function listAllToolNames(api: typeof import('./api-client').api): Promise<{ names: string[]; total: number }> {
    const names: string[] = [];
    const PAGE_SIZE = 40; // deliberately smaller than the catalog to exercise pagination
    let offset = 0;
    let total = 0;

    for (let guard = 0; guard < 100; guard++) {
      const page = await api.system.toolsList(undefined, PAGE_SIZE, offset);
      const batch = page?.data ?? [];
      const pagination = page?.pagination as { total?: number; hasMore?: boolean } | undefined;
      total = pagination?.total ?? page?.total ?? total;
      names.push(...batch.map((t) => t.name));

      const hasMore = pagination?.hasMore ?? batch.length === PAGE_SIZE;
      if (!hasMore || batch.length === 0) break;
      offset += batch.length;
    }

    return { names, total };
  }

  it('initialize + tools_list works end-to-end', async () => {
    const { api, resetClient } = await import('./api-client');
    resetClient();
    const { names, total } = await listAllToolNames(api);

    // Every page was collected: no fixed page-size assumption.
    expect(total).toBeGreaterThan(50);
    expect(names.length).toBe(total);
    expect(new Set(names).size).toBe(names.length);

    for (const tool of ['tasks_create', 'tasks_claim', 'tasks_renew', 'tasks_release', 'session_list']) {
      expect(names).toContain(tool);
    }
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

  it('knowledge create → list → get keeps list content-free and returns the full doc', async () => {
    const { api } = await import('./api-client');
    const token = `ui13${Date.now()}`;
    const title = `UI13 live ${token}`;
    const created = await api.knowledge.bulkCreate('mcp', [
      { title, content: `# ${title}\n\nUnique body token ${token}.`, tags: ['ui13-live'] },
    ]);
    const id = created.created[0]?.id;
    expect(id).toBeTruthy();

    try {
      const list = await api.knowledge.list('mcp');
      const item = list.find((d) => d.id === id);
      expect(item, 'created doc is listed').toBeTruthy();
      expect(item).not.toHaveProperty('content');

      const full = await api.knowledge.get('mcp', id!);
      expect(full.content).toContain(token);

      const hits = await api.search.knowledge(token, 'mcp', 10);
      expect(hits.some((h) => h.id === id), 'server search finds the document').toBe(true);
      expect(hits[0]?.item).not.toHaveProperty('content');

      const miss = await api.search.knowledge('zzzqxjw' + token, 'mcp', 10);
      expect(miss).toEqual([]);
    } finally {
      await api.knowledge.bulkTrash('mcp', [id!]);
    }
  }, 30_000);

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
