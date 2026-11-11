import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGitHubConnector } from '../src/connectors/github.js';
import { createJiraConnector } from '../src/connectors/jira.js';
import { createSlackConnector } from '../src/connectors/slack.js';

function capture(connector: { init: (ctx: any) => Promise<void> }) {
  const tools = new Map<string, (input: Record<string, unknown>) => Promise<any>>();
  const ctx = {
    config: {},
    registerTool: (name: string, _schema: unknown, handler: (input: Record<string, unknown>) => Promise<any>) =>
      tools.set(name, handler),
    getSecret: () => undefined,
  };
  return { init: () => connector.init(ctx), tools };
}

afterEach(() => vi.unstubAllGlobals());

describe('TR-36 connector error envelope', () => {
  it('github returns {ok:false,error} instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429, statusText: 'Too Many Requests' })));
    const { init, tools } = capture(createGitHubConnector({ token: 't', owner: 'o', repo: 'r' }));
    await init();
    const result = await tools.get('github_issue_list')!({});
    expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining('GitHub API 429') } });
  });

  it('jira returns {ok:false,error} on HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
    const { init, tools } = capture(createJiraConnector({ token: 't', host: 'https://jira.example', email: 'a@b.c', project: 'P' }));
    await init();
    const result = await tools.get('jira_issue_list')!({});
    expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining('Jira API 401') } });
  });

  it('slack returns {ok:false,error} for both API and validation failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }), { status: 200 })));
    const { init, tools } = capture(createSlackConnector({ token: 't' }));
    await init();
    const api = await tools.get('slack_post')!({ channel: 'C1', text: 'hi' });
    expect(api).toMatchObject({ ok: false, error: { message: 'Slack API error: channel_not_found' } });

    const missing = await tools.get('slack_post')!({ text: 'hi' });
    expect(missing).toMatchObject({ ok: false, error: { message: expect.stringContaining('channel required') } });
  });

  it('keeps successful envelopes unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ full_name: 'o/r', description: 'd', stargazers_count: 1, forks_count: 2, open_issues_count: 3, default_branch: 'main' }), { status: 200 })));
    const { init, tools } = capture(createGitHubConnector({ token: 't', owner: 'o', repo: 'r' }));
    await init();
    await expect(tools.get('github_repo_info')!({})).resolves.toMatchObject({ ok: true, data: { name: 'o/r' } });
  });
});
