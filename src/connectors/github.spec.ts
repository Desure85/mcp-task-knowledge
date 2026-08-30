/**
 * connectors/github.spec.ts — Tests for GitHub connector (INT-001)
 */

import { describe, it, expect, vi } from 'vitest';
import { createGitHubConnector } from './github.js';
import type { ConnectorContext } from './types.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function mockCtx(): { ctx: ConnectorContext; tools: Map<string, Function> } {
  const tools = new Map<string, Function>();
  const ctx: ConnectorContext = {
    config: {},
    registerTool: (name, _schema, handler) => { tools.set(name, handler); },
  };
  return { ctx, tools };
}

describe('INT-001: GitHub connector', () => {
  it('throws on init without GITHUB_TOKEN', async () => {
    const connector = createGitHubConnector({});
    const { ctx } = mockCtx();
    await expect(connector.init(ctx)).rejects.toThrow('GITHUB_TOKEN');
  });

  it('registers 4 tools on init', async () => {
    const connector = createGitHubConnector({ token: 'fake-token', owner: 'test', repo: 'repo' });
    const { ctx, tools } = mockCtx();
    await connector.init(ctx);
    expect(tools.size).toBe(4);
    expect(tools.has('github_issue_list')).toBe(true);
    expect(tools.has('github_issue_get')).toBe(true);
    expect(tools.has('github_pr_list')).toBe(true);
    expect(tools.has('github_repo_info')).toBe(true);
  });

  it('github_issue_list fetches and maps issues', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { number: 1, title: 'Bug', state: 'open', html_url: 'https://github.com/test/repo/issues/1' },
        { number: 2, title: 'Feature', state: 'open', html_url: 'https://github.com/test/repo/issues/2' },
      ],
      text: async () => '',
    });
    const connector = createGitHubConnector({ token: 'fake', owner: 'test', repo: 'repo' });
    const { ctx, tools } = mockCtx();
    await connector.init(ctx);
    const result = await tools.get('github_issue_list')!({ state: 'open', limit: 10 });
    expect(result.ok).toBe(true);
    expect(result.data.count).toBe(2);
    expect(result.data.issues[0].number).toBe(1);
  });

  it('health returns unhealthy without token', async () => {
    const connector = createGitHubConnector({});
    const health = await connector.health();
    expect(health.healthy).toBe(false);
  });

  it('health returns healthy when API responds', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ login: 'test' }), text: async () => '' });
    const connector = createGitHubConnector({ token: 'fake' });
    const health = await connector.health();
    expect(health.healthy).toBe(true);
  });
});
