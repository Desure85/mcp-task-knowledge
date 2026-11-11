import { afterEach, describe, expect, it, vi } from 'vitest';
import { createYouTrackConnector } from '../src/connectors/youtrack.js';

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

const ISSUE = {
  id: '2-1',
  idReadable: 'DEMO-1',
  summary: 'Fix login',
  description: 'Login fails',
  resolved: null,
  created: 1700000000000,
  updated: 1700000001000,
  customFields: [
    { name: 'State', value: { name: 'In Progress' } },
    { name: 'Priority', value: { name: 'Critical' } },
    { name: 'Assignee', value: { login: 'alice', name: 'Alice' } },
    { name: 'Type', value: { name: 'Bug' } },
  ],
  comments: [{ text: 'Reproduced', created: 1700000002000, author: { login: 'bob', name: 'Bob' } }],
};

function response(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

function makeCtx() {
  const tools = new Map<string, Handler>();
  return {
    tools,
    ctx: {
      config: { token: 'tok', baseUrl: 'https://yt.test' },
      registerTool: (name: string, _schema: unknown, handler: Handler) => tools.set(name, handler),
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('INT-007 YouTrack connector', () => {
  it('lists issues with the YouTrack query and flattens custom fields', async () => {
    const calls: Array<[string, RequestInit]> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return response([ISSUE]);
    }));
    const { tools, ctx } = makeCtx();
    const connector = createYouTrackConnector({ baseUrl: 'https://yt.test', token: 'tok' });
    await connector.init(ctx as never);

    const result = await tools.get('youtrack_issue_list')!({ query: '#Unresolved', limit: 10 }) as { ok: boolean; data: any };
    expect(result.ok).toBe(true);
    expect(result.data.count).toBe(1);
    expect(result.data.issues[0]).toMatchObject({
      id: '2-1',
      readableId: 'DEMO-1',
      title: 'Fix login',
      state: 'In Progress',
      priority: 'Critical',
      assignee: 'Alice',
      type: 'Bug',
      resolved: null,
    });
    expect(calls[0][0]).toContain('https://yt.test/api/issues?');
    expect(calls[0][0]).toContain('query=%23Unresolved');
    expect(calls[0][0]).toContain('%24top=10');
    expect(calls[0][0]).toContain('customFields');
    expect((calls[0][1].headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('gets an issue with comments', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(ISSUE)));
    const { tools, ctx } = makeCtx();
    const connector = createYouTrackConnector({ baseUrl: 'https://yt.test', token: 'tok' });
    await connector.init(ctx as never);

    const result = await tools.get('youtrack_issue_get')!({ id: 'DEMO-1' }) as { ok: boolean; data: any };
    expect(result.ok).toBe(true);
    expect(result.data.description).toBe('Login fails');
    expect(result.data.comments).toEqual([{ text: 'Reproduced', created: 1700000002000, author: 'Bob' }]);
  });

  it('lists projects and reports health via /users/me', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes('/api/admin/projects')) {
        return response([{ id: 'p1', name: 'Demo', shortName: 'DEMO', archived: false }]);
      }
      return response({ login: 'alice', name: 'Alice' });
    }));
    const { tools, ctx } = makeCtx();
    const connector = createYouTrackConnector({ baseUrl: 'https://yt.test', token: 'tok' });
    await connector.init(ctx as never);

    const projects = await tools.get('youtrack_project_list')!({}) as { ok: boolean; data: any };
    expect(projects.data.projects).toEqual([{ id: 'p1', name: 'Demo', shortName: 'DEMO', archived: false }]);
    expect(await connector.health()).toMatchObject({ healthy: true });
    expect(urls.some((u) => u.includes('/api/users/me'))).toBe(true);
  });

  it('reports revoked token/network as unhealthy', async () => {
    const { ctx } = makeCtx();
    const connector = createYouTrackConnector({ baseUrl: 'https://yt.test', token: 'revoked' });
    await connector.init(ctx as never);

    vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'unauthorized' }, false, 401)));
    expect(await connector.health()).toMatchObject({ healthy: false });

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const health = await connector.health();
    expect(health.healthy).toBe(false);
    expect(health.message).toContain('ECONNREFUSED');
  });

  it('requires token and base URL at init', async () => {
    const { ctx } = makeCtx();
    const connector = createYouTrackConnector({ baseUrl: 'https://yt.test' });
    await expect(connector.init({ ...ctx, config: {} } as never)).rejects.toThrow('YOUTRACK_TOKEN and YOUTRACK_URL required');
    expect(await connector.health()).toMatchObject({ healthy: false, message: 'Not initialized' });
  });
});
