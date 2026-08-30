/**
 * connectors/slack.spec.ts — Tests for Slack connector (INT-003)
 */

import { describe, it, expect, vi } from 'vitest';
import { createSlackConnector } from './slack.js';
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

describe('INT-003: Slack connector', () => {
  it('throws on init without token', async () => {
    const connector = createSlackConnector({});
    const { ctx } = mockCtx();
    await expect(connector.init(ctx)).rejects.toThrow('SLACK_BOT_TOKEN');
  });

  it('registers 3 tools on init', async () => {
    const connector = createSlackConnector({ token: 'xoxb-fake' });
    const { ctx, tools } = mockCtx();
    await connector.init(ctx);
    expect(tools.size).toBe(3);
    expect(tools.has('slack_post')).toBe(true);
    expect(tools.has('slack_search')).toBe(true);
    expect(tools.has('slack_channels')).toBe(true);
  });

  it('slack_post sends message', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, channel: 'C123', ts: '1234567890.123' }),
      text: async () => '',
    });
    const connector = createSlackConnector({ token: 'xoxb-fake', defaultChannel: 'general' });
    const { ctx, tools } = mockCtx();
    await connector.init(ctx);
    const result = await tools.get('slack_post')!({ text: 'Hello from MCP!' });
    expect(result.ok).toBe(true);
    expect(result.data.channel).toBe('C123');
  });

  it('slack_search returns messages', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        messages: {
          total: 1,
          matches: [{ text: 'deploy ready', user: 'U123', channel: { name: 'dev' }, ts: '123.456' }],
        },
      }),
      text: async () => '',
    });
    const connector = createSlackConnector({ token: 'xoxb-fake' });
    const { ctx, tools } = mockCtx();
    await connector.init(ctx);
    const result = await tools.get('slack_search')!({ query: 'deploy' });
    expect(result.ok).toBe(true);
    expect(result.data.total).toBe(1);
    expect(result.data.messages[0].text).toBe('deploy ready');
  });

  it('health returns unhealthy without token', async () => {
    const connector = createSlackConnector({});
    const health = await connector.health();
    expect(health.healthy).toBe(false);
  });

  it('health returns healthy when API responds', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, url: 'https://team.slack.com' }), text: async () => '' });
    const connector = createSlackConnector({ token: 'xoxb-fake' });
    const health = await connector.health();
    expect(health.healthy).toBe(true);
  });
});
