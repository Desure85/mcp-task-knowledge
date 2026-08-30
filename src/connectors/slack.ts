/**
 * connectors/slack.ts — Slack/Discord connector (INT-003)
 *
 * Sends notifications and searches messages from AI agents via Slack API.
 * Zero-dep: uses built-in fetch (Node 20+).
 * Requires SLACK_BOT_TOKEN env var.
 */

import type { Connector, ConnectorContext, ConnectorHealth } from './types.js';

const SLACK_API = 'https://slack.com/api';

export interface SlackConfig {
  token?: string;
  defaultChannel?: string;
}

async function slackFetch(path: string, token: string, body?: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${SLACK_API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Slack API ${res.status}: ${await res.text()}`);
  const data = await res.json() as { ok: boolean; error?: string };
  if (!data.ok) throw new Error(`Slack API error: ${data.error ?? 'unknown'}`);
  return data;
}

export function createSlackConnector(config: Record<string, unknown>): Connector {
  const cfg = config as SlackConfig;
  const token = cfg.token ?? process.env.SLACK_BOT_TOKEN ?? '';
  const defaultChannel = cfg.defaultChannel ?? process.env.SLACK_DEFAULT_CHANNEL ?? '';

  return {
    id: 'slack',
    name: 'Slack Connector',
    version: '1.0.0',

    async init(ctx: ConnectorContext) {
      if (!token) throw new Error('SLACK_BOT_TOKEN required');

      ctx.registerTool('slack_post', {
        title: 'Slack Post Message',
        description: 'Send a message to a Slack channel',
        inputSchema: {
          channel: { type: 'string' },
          text: { type: 'string' },
        },
      }, async (input) => {
        const channel = (input.channel as string) || defaultChannel;
        if (!channel) throw new Error('channel required (or set SLACK_DEFAULT_CHANNEL)');
        const result = await slackFetch('/chat.postMessage', token, {
          channel,
          text: input.text as string,
        }) as { channel: string; ts: string };
        return { ok: true, data: { channel: result.channel, ts: result.ts } };
      });

      ctx.registerTool('slack_search', {
        title: 'Slack Search',
        description: 'Search messages in Slack',
        inputSchema: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
      }, async (input) => {
        const query = input.query as string;
        const count = (input.limit as number) ?? 20;
        const data = await slackFetch(`/search.messages?query=${encodeURIComponent(query)}&count=${count}`, token) as {
          messages: { total: number; matches: Array<{ text: string; user: string; channel: { name: string }; ts: string }> };
        };
        return { ok: true, data: { total: data.messages.total, messages: data.messages.matches.map((m) => ({ text: m.text, user: m.user, channel: m.channel.name, ts: m.ts })) } };
      });

      ctx.registerTool('slack_channels', {
        title: 'Slack Channels',
        description: 'List public channels in the workspace',
        inputSchema: {},
      }, async () => {
        const data = await slackFetch('/conversations.list?types=public_channel&limit=200', token) as {
          channels: Array<{ id: string; name: string; num_members: number }>;
        };
        return { ok: true, data: { count: data.channels.length, channels: data.channels.map((c) => ({ id: c.id, name: c.name, members: c.num_members })) } };
      });
    },

    async health(): Promise<ConnectorHealth> {
      if (!token) return { healthy: false, message: 'SLACK_BOT_TOKEN not set' };
      try {
        await slackFetch('/auth.test', token);
        return { healthy: true, message: 'Slack API reachable' };
      } catch (e) {
        return { healthy: false, message: (e as Error).message };
      }
    },
  };
}
