import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGitHubConnector } from '../src/connectors/github.js';
import { createJiraConnector } from '../src/connectors/jira.js';
import { createSlackConnector } from '../src/connectors/slack.js';

type Tool = (input: Record<string, unknown>) => Promise<any>;

function capture(connector: { init: (ctx: any) => Promise<void> }) {
  const tools = new Map<string, Tool>();
  const ctx = {
    config: {},
    registerTool: (name: string, _schema: unknown, handler: Tool) => tools.set(name, handler),
    getSecret: () => undefined,
  };
  return { init: () => connector.init(ctx), tools };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('PH-012 connector HTTP contracts', () => {
  it('maps GitHub issue list payload and sends expected request', async () => {
    const fetchMock = vi.fn(async () =>
      json([
        { number: 7, title: 'Crash', state: 'open', labels: [{ name: 'bug' }], html_url: 'https://github.com/o/r/issues/7', body: 'secret' },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { init, tools } = capture(createGitHubConnector({ token: 'gh-token', owner: 'o', repo: 'r' }));
    await init();

    const result = await tools.get('github_issue_list')!({ state: 'closed', limit: 250 });
    expect(result).toEqual({
      ok: true,
      data: { count: 1, issues: [{ number: 7, title: 'Crash', state: 'open', url: 'https://github.com/o/r/issues/7' }] },
    });
    const [url, reqInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/repos/o/r/issues?state=closed&per_page=100');
    expect((reqInit.headers as Record<string, string>).Authorization).toBe('Bearer gh-token');
    expect(result.data.issues[0]).not.toHaveProperty('body');
  });

  it('maps Jira search payload and encodes JQL filters', async () => {
    const fetchMock = vi.fn(async () =>
      json({ total: 2, issues: [{ key: 'P-1', fields: { summary: 'A', status: { name: 'Open' } } }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { init, tools } = capture(
      createJiraConnector({ token: 'jira-token', host: 'https://jira.example.test', email: 'a@b.test', project: 'P' }),
    );
    await init();

    const result = await tools.get('jira_issue_list')!({ status: 'In Progress', limit: 10 });
    expect(result).toEqual({ ok: true, data: { count: 2, issues: [{ key: 'P-1', title: 'A', status: 'Open' }] } });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain('/rest/api/2/search?jql=');
    expect(decodeURIComponent(url)).toContain('project = P AND status = "In Progress"');
    expect(url).toContain('maxResults=10');
  });

  it('maps Slack channels and post message payloads', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ ok: true, channels: [{ id: 'C1', name: 'general', num_members: 3 }] }))
      .mockResolvedValueOnce(json({ ok: true, channel: 'C1', ts: '1700000000.000100' }));
    vi.stubGlobal('fetch', fetchMock);
    const { init, tools } = capture(createSlackConnector({ token: 'xoxb-token' }));
    await init();

    const channels = await tools.get('slack_channels')!({});
    expect(channels).toEqual({ ok: true, data: { count: 1, channels: [{ id: 'C1', name: 'general', members: 3 }] } });

    const posted = await tools.get('slack_post')!({ channel: 'C1', text: 'hello' });
    expect(posted).toEqual({ ok: true, data: { channel: 'C1', ts: '1700000000.000100' } });
    const [url, reqInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toContain('/chat.postMessage');
    expect(JSON.parse(String(reqInit.body))).toMatchObject({ channel: 'C1', text: 'hello' });
    expect((reqInit.headers as Record<string, string>).Authorization).toBe('Bearer xoxb-token');
  });

  it('keeps connector error paths as envelopes, not throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })));
    const gh = capture(createGitHubConnector({ token: 't', owner: 'o', repo: 'r' }));
    await gh.init();
    await expect(gh.tools.get('github_pr_list')!({})).resolves.toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('GitHub API 403') },
    });

    vi.stubGlobal('fetch', vi.fn(async () => json({ ok: false, error: 'invalid_auth' })));
    const slack = capture(createSlackConnector({ token: 't' }));
    await slack.init();
    await expect(slack.tools.get('slack_search')!({ query: 'x' })).resolves.toMatchObject({
      ok: false,
      error: { message: 'Slack API error: invalid_auth' },
    });
  });
});
