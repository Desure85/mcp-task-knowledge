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
  it('project statuses and transitions roundtrip with a custom workflow', async () => {
    const { api } = await import('./api-client');
    const project = `v01-live-${Date.now()}`;
    await api.projects.create(project, 'UI live workflow');

    try {
      const defaults = await api.projects.statuses.get(project);
      expect(defaults.statuses.map((s) => s.id)).toEqual(['pending', 'in_progress', 'completed', 'closed']);
      expect(defaults.closeStatus).toBe('closed');

      const custom = [
        { id: 'todo', label: 'Todo', category: 'todo' as const, color: 'st-todo', order: 0 },
        { id: 'doing', label: 'Doing', category: 'in_progress' as const, color: 'st-doing', order: 1 },
        { id: 'done', label: 'Done', category: 'done' as const, color: 'st-done', order: 2 },
      ];
      const saved = await api.projects.statuses.set(project, custom, {
        closeStatus: 'done',
        initialStatuses: ['todo'],
      });
      expect(saved.statuses.map((s) => s.id)).toEqual(['todo', 'doing', 'done']);

      const transitions = await api.projects.transitions.set(project, {
        todo: ['doing'],
        doing: ['done'],
        done: [],
      });
      expect(transitions.transitions).toEqual({ todo: ['doing'], doing: ['done'], done: [] });

      const task = await api.tasks.create({ project, title: 'live custom status', status: 'todo' });
      expect(task.status).toBe('todo');

      let code: string | undefined;
      try {
        await api.tasks.update(project, task.id, { status: 'done' });
      } catch (e) {
        code = (e as { code?: string }).code;
      }
      expect(code).toBe('TRANSITION_NOT_ALLOWED');
    } finally {
      await api.projects.remove(project, true).catch(() => undefined);
    }
  }, 30_000);

  it('project types: defaults, custom type, filter and TYPE_IN_USE move', async () => {
    const { api } = await import('./api-client');
    const project = `v03-live-${Date.now()}`;
    await api.projects.create(project, 'V-03 live types');

    try {
      const defaults = await api.projects.types.get(project);
      expect(defaults.types.map((type) => type.id)).toEqual(['task', 'bug', 'feature']);

      const custom = [
        { id: 'task', label: 'Task', color: 'ty-task', icon: 'task' },
        { id: 'bug', label: 'Bug', color: 'ty-bug', icon: 'bug' },
        { id: 'chore', label: 'Chore', color: 'ty-task', icon: 'tool' },
      ];
      const saved = await api.projects.types.set(project, custom);
      expect(saved.types.map((type) => type.id)).toEqual(['task', 'bug', 'chore']);

      const bug = await api.tasks.create({ project, title: 'live bug', type: 'bug' });
      expect(bug.type).toBe('bug');
      const chore = await api.tasks.create({ project, title: 'live chore', type: 'chore' });
      expect(chore.type).toBe('chore');

      const filtered = await api.tasks.list(project, 'bug');
      expect(filtered.map((task) => task.id)).toEqual([bug.id]);

      let inUseCode: string | undefined;
      try {
        await api.projects.types.set(project, [
          { id: 'task', label: 'Task', color: 'ty-task' },
          { id: 'bug', label: 'Bug', color: 'ty-bug' },
        ]);
      } catch (e) {
        inUseCode = (e as { code?: string }).code;
      }
      expect(inUseCode).toBe('TYPE_IN_USE');

      await api.projects.types.set(project, [
        { id: 'task', label: 'Task', color: 'ty-task' },
        { id: 'bug', label: 'Bug', color: 'ty-bug' },
      ], { moveTo: 'task' });
      const moved = await api.tasks.get(project, chore.id);
      expect(moved.type).toBe('task');
    } finally {
      await api.projects.remove(project, true).catch(() => undefined);
    }
  }, 30_000);

  it('prompt create → get → update → get → delete roundtrip', async () => {
    const { api } = await import('./api-client');
    const id = `webui-prompt-${Date.now()}`;
    const created = await api.prompts.bulkCreate([{
      type: 'prompt',
      id,
      version: '1.0.0',
      metadata: { title: 'Web UI prompt', domain: 'ui-live', status: 'draft', kind: 'prompt', tags: ['live'] },
      template: 'Original {{topic}}',
      variables: [{ name: 'topic', type: 'string', required: true }],
    }], 'mcp');
    expect(created).toBeTruthy();

    try {
      const first = await api.prompts.get(id, undefined, 'mcp');
      expect(first.prompt.id).toBe(id);
      expect(first.prompt.template).toBe('Original {{topic}}');
      expect(first.versions.map((v) => v.version)).toContain('1.0.0');
      expect(first.versions.find((v) => v.version === '1.0.0')?.latest).toBe(true);

      await api.prompts.update(
        { id, version: '1.0.0' },
        {
          template: 'Updated {{topic}}',
          metadata: { ...first.prompt.metadata, status: 'published' },
        },
        'mcp',
      );
      const second = await api.prompts.get(id, '1.0.0', 'mcp');
      expect(second.prompt.template).toBe('Updated {{topic}}');
      expect(second.prompt.metadata.status).toBe('published');

      await api.prompts.delete({ id, version: '1.0.0' }, 'mcp');
      let missing = false;
      try {
        await api.prompts.get(id, '1.0.0', 'mcp');
      } catch {
        missing = true;
      }
      expect(missing).toBe(true);
    } finally {
      await api.prompts.delete({ id, version: '1.0.0' }, 'mcp').catch(() => undefined);
    }
  }, 30_000);

});
