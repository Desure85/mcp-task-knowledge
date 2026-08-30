/**
 * connectors/jira.spec.ts — Tests for Jira connector (INT-002)
 */

import { describe, it, expect, vi } from 'vitest';
import { createJiraConnector } from './jira.js';
import type { ConnectorContext } from './types.js';

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

describe('INT-002: Jira connector', () => {
  it('throws on init without token/host', async () => {
    const connector = createJiraConnector({});
    const { ctx } = mockCtx();
    await expect(connector.init(ctx)).rejects.toThrow('JIRA_TOKEN');
  });

  it('registers 3 tools on init', async () => {
    const connector = createJiraConnector({ token: 'fake', host: 'https://test.atlassian.net' });
    const { ctx, tools } = mockCtx();
    await connector.init(ctx);
    expect(tools.size).toBe(3);
    expect(tools.has('jira_issue_list')).toBe(true);
    expect(tools.has('jira_issue_get')).toBe(true);
    expect(tools.has('jira_project_list')).toBe(true);
  });

  it('jira_issue_list fetches and maps issues', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total: 2,
        issues: [
          { key: 'PROJ-1', fields: { summary: 'Bug fix', status: { name: 'Open' } } },
          { key: 'PROJ-2', fields: { summary: 'Feature', status: { name: 'In Progress' } } },
        ],
      }),
      text: async () => '',
    });
    const connector = createJiraConnector({ token: 'fake', host: 'https://test.atlassian.net', project: 'PROJ' });
    const { ctx, tools } = mockCtx();
    await connector.init(ctx);
    const result = await tools.get('jira_issue_list')!({ limit: 10 });
    expect(result.ok).toBe(true);
    expect(result.data.count).toBe(2);
    expect(result.data.issues[0].key).toBe('PROJ-1');
  });

  it('health returns unhealthy without config', async () => {
    const connector = createJiraConnector({});
    const health = await connector.health();
    expect(health.healthy).toBe(false);
  });

  it('health returns healthy when API responds', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ accountId: 'test' }), text: async () => '' });
    const connector = createJiraConnector({ token: 'fake', host: 'https://test.atlassian.net' });
    const health = await connector.health();
    expect(health.healthy).toBe(true);
  });
});
