/**
 * connectors/youtrack.ts — YouTrack connector, read-only (INT-007).
 *
 * YouTrack uses its own REST API (`/api/...`), not Jira's. The query language is
 * passed through as `query`; custom fields (`State`, `Priority`, `Assignee`,
 * `Type`) are flattened for MCP callers. Token comes from SecretManager first,
 * then config/env.
 */
import type { Connector, ConnectorContext, ConnectorHealth } from './types.js';
import { connectorSignal } from './fetch-timeout.js';
import { resolveCredential } from './credentials.js';

export interface YouTrackConfig {
  token?: string;
  baseUrl?: string;
  project?: string;
}

const ISSUE_FIELDS = [
  'id',
  'idReadable',
  'summary',
  'description',
  'resolved',
  'created',
  'updated',
  'customFields(name,value(name,login))',
  'comments(text,created,author(login,name))',
].join(',');

interface YouTrackCustomField {
  name?: string;
  value?: { name?: string; login?: string } | null;
}

interface YouTrackIssue {
  id?: string;
  idReadable?: string;
  summary?: string;
  description?: string;
  resolved?: number | null;
  created?: number;
  updated?: number;
  customFields?: YouTrackCustomField[];
  comments?: Array<{ text?: string; created?: number; author?: { login?: string; name?: string } }>;
}

interface YouTrackProject {
  id?: string;
  name?: string;
  shortName?: string;
  archived?: boolean;
}

function fieldValue(issue: YouTrackIssue, name: string): string | undefined {
  const field = (issue.customFields ?? []).find((f) => f.name === name);
  const value = field?.value;
  if (!value) return undefined;
  return value.name ?? value.login ?? undefined;
}

function mapIssue(issue: YouTrackIssue) {
  return {
    id: issue.id,
    readableId: issue.idReadable,
    title: issue.summary,
    state: fieldValue(issue, 'State'),
    priority: fieldValue(issue, 'Priority'),
    assignee: fieldValue(issue, 'Assignee'),
    type: fieldValue(issue, 'Type'),
    resolved: issue.resolved ?? null,
    created: issue.created,
    updated: issue.updated,
  };
}

export function createYouTrackConnector(config: Record<string, unknown>): Connector {
  const cfg = config as YouTrackConfig;
  const baseUrl = (cfg.baseUrl ?? process.env.YOUTRACK_URL ?? '').replace(/\/+$/, '');
  const project = cfg.project ?? process.env.YOUTRACK_PROJECT ?? '';
  let token = cfg.token ?? '';
  let initialized = false;

  async function api<T>(path: string): Promise<T> {
    if (!token || !baseUrl) throw new Error('YOUTRACK_TOKEN and YOUTRACK_URL required');
    const res = await fetch(`${baseUrl}${path}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      signal: connectorSignal(),
    });
    if (!res.ok) throw new Error(`YouTrack API ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  return {
    id: 'youtrack',
    name: 'YouTrack',
    version: '1.0.0',

    async init(ctx: ConnectorContext) {
      token = (await resolveCredential(ctx, 'token', 'YOUTRACK_TOKEN')) ?? cfg.token ?? '';
      if (!token || !baseUrl) throw new Error('YOUTRACK_TOKEN and YOUTRACK_URL required');
      initialized = true;

      ctx.registerTool('youtrack_issue_list', {
        title: 'YouTrack: List Issues',
        description: 'List YouTrack issues. The query is passed to YouTrack as-is (e.g. "project: DEMO #Unresolved").',
        inputSchema: {
          query: { type: 'string', description: 'YouTrack query language string' },
          project: { type: 'string', description: 'Short project name; prepended as "project: <name>"' },
          limit: { type: 'number', description: 'Max issues (1-100, default 50)' },
        },
      }, async (input) => {
        const limit = Math.min(Math.max(Number(input.limit ?? 50), 1), 100);
        const queryParts: string[] = [];
        const projectFilter = (input.project as string | undefined) ?? project;
        if (projectFilter) queryParts.push(`project: ${projectFilter}`);
        if (input.query) queryParts.push(String(input.query));
        const query = queryParts.join(' ');
        const params = new URLSearchParams({ fields: ISSUE_FIELDS, $top: String(limit) });
        if (query) params.set('query', query);
        const issues = await api<YouTrackIssue[]>(`/api/issues?${params.toString()}`);
        return { ok: true, data: { count: issues.length, query: query || null, issues: issues.map(mapIssue) } };
      });

      ctx.registerTool('youtrack_issue_get', {
        title: 'YouTrack: Get Issue',
        description: 'Get one issue by id/idReadable, including comments and custom fields.',
        inputSchema: {
          id: { type: 'string', description: 'Issue id or readable id (e.g. DEMO-12)' },
        },
      }, async (input) => {
        const id = String(input.id ?? '').trim();
        if (!id) throw new Error('issue id required');
        const params = new URLSearchParams({ fields: ISSUE_FIELDS });
        const issue = await api<YouTrackIssue>(`/api/issues/${encodeURIComponent(id)}?${params.toString()}`);
        return {
          ok: true,
          data: {
            ...mapIssue(issue),
            description: issue.description ?? '',
            comments: (issue.comments ?? []).map((c) => ({
              text: c.text ?? '',
              created: c.created,
              author: c.author?.name ?? c.author?.login,
            })),
          },
        };
      });

      ctx.registerTool('youtrack_project_list', {
        title: 'YouTrack: List Projects',
        description: 'List accessible YouTrack projects.',
        inputSchema: {},
      }, async () => {
        const params = new URLSearchParams({ fields: 'id,name,shortName,archived' });
        const projects = await api<YouTrackProject[]>(`/api/admin/projects?${params.toString()}`);
        return {
          ok: true,
          data: {
            count: projects.length,
            projects: projects.map((p) => ({ id: p.id, name: p.name, shortName: p.shortName, archived: p.archived ?? false })),
          },
        };
      });
    },

    async health(): Promise<ConnectorHealth> {
      if (!initialized) return { healthy: false, message: 'Not initialized' };
      if (!token || !baseUrl) return { healthy: false, message: 'YOUTRACK_TOKEN and YOUTRACK_URL not set' };
      try {
        const me = await api<{ login?: string; name?: string }>('/api/users/me?fields=id,login,name');
        return { healthy: true, message: `YouTrack reachable as ${me.login ?? me.name ?? 'unknown'}` };
      } catch (error) {
        return { healthy: false, message: (error as Error).message };
      }
    },
  };
}
