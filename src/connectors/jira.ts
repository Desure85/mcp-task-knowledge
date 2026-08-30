/**
 * connectors/jira.ts — Jira/YouTrack connector (INT-002)
 *
 * Integrates Jira issues as MCP tools via REST API (zero-dep fetch).
 * Supports both Jira Cloud (api.atlassian.com) and YouTrack (jetbrains.space).
 * Requires JIRA_TOKEN + JIRA_HOST env vars.
 */

import type { Connector, ConnectorContext, ConnectorHealth } from './types.js';

export interface JiraConfig {
  token?: string;
  host?: string;
  email?: string;
  project?: string;
}

async function jiraFetch(path: string, host: string, token: string, email?: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (email) {
    headers.Authorization = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  }
  const res = await fetch(`${host}${path}`, { headers });
  if (!res.ok) throw new Error(`Jira API ${res.status}: ${await res.text()}`);
  return res.json();
}

export function createJiraConnector(config: Record<string, unknown>): Connector {
  const cfg = config as JiraConfig;
  const token = cfg.token ?? process.env.JIRA_TOKEN ?? '';
  const host = cfg.host ?? process.env.JIRA_HOST ?? '';
  const email = cfg.email ?? process.env.JIRA_EMAIL ?? '';
  const project = cfg.project ?? process.env.JIRA_PROJECT ?? '';

  return {
    id: 'jira',
    name: 'Jira/YouTrack Connector',
    version: '1.0.0',

    async init(ctx: ConnectorContext) {
      if (!token || !host) throw new Error('JIRA_TOKEN and JIRA_HOST required');

      ctx.registerTool('jira_issue_list', {
        title: 'Jira Issues',
        description: 'List issues in the configured Jira project',
        inputSchema: {
          status: { type: 'string' },
          limit: { type: 'number' },
        },
      }, async (input) => {
        const limit = (input.limit as number) ?? 50;
        const jql = project ? `project = ${project}` : '';
        const statusFilter = input.status ? ` AND status = "${input.status}"` : '';
        const data = await jiraFetch(`/rest/api/2/search?jql=${encodeURIComponent(jql + statusFilter)}&maxResults=${limit}`, host, token, email) as { total: number; issues: Array<{ key: string; fields: { summary: string; status: { name: string } } }> };
        return { ok: true, data: { count: data.total, issues: data.issues.map((i) => ({ key: i.key, title: i.fields.summary, status: i.fields.status?.name })) } };
      });

      ctx.registerTool('jira_issue_get', {
        title: 'Jira Issue Detail',
        description: 'Get a single Jira issue by key',
        inputSchema: { key: { type: 'string' } },
      }, async (input) => {
        const key = input.key as string;
        const issue = await jiraFetch(`/rest/api/2/issue/${key}`, host, token, email) as Record<string, unknown>;
        const fields = issue.fields as Record<string, unknown>;
        return { ok: true, data: { key: issue.key, title: fields.summary, status: (fields.status as { name: string })?.name, description: fields.description, priority: (fields.priority as { name: string })?.name, assignee: (fields.assignee as { displayName: string })?.displayName } };
      });

      ctx.registerTool('jira_project_list', {
        title: 'Jira Projects',
        description: 'List accessible Jira projects',
        inputSchema: {},
      }, async () => {
        const data = await jiraFetch('/rest/api/2/project', host, token, email) as Array<{ key: string; name: string; projectTypeKey: string }>;
        return { ok: true, data: { count: data.length, projects: data.map((p) => ({ key: p.key, name: p.name, type: p.projectTypeKey })) } };
      });
    },

    async health(): Promise<ConnectorHealth> {
      if (!token || !host) return { healthy: false, message: 'JIRA_TOKEN and JIRA_HOST not set' };
      try {
        await jiraFetch('/rest/api/2/myself', host, token, email);
        return { healthy: true, message: 'Jira API reachable' };
      } catch (e) {
        return { healthy: false, message: (e as Error).message };
      }
    },
  };
}
