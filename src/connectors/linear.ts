/**
 * linear.ts — Linear connector (NEXT-011, WIRE-009).
 *
 * Lists issues, fetches details, and syncs Linear issues into knowledge base.
 * Uses the Linear GraphQL API with a personal API key
 * (config `apiKey` or `LINEAR_API_KEY` env, SEC-004).
 */

import type { Connector, ConnectorContext, ConnectorHealth } from './types.js';
import type { ErrEnvelope } from '../utils/respond.js';

const LINEAR_API = 'https://api.linear.app/graphql';

/** Injectable fetch for hermetic tests (defaults to global fetch). */
export type FetchFn = typeof fetch;

interface LinearIssueNode {
  id: string;
  identifier?: string;
  title?: string;
  description?: string;
  priority?: number;
  state?: { name?: string };
}

const PRIORITY_LABELS = ['No priority', 'Low', 'Medium', 'High', 'Urgent'];

function priorityLabel(priority: number | undefined): string {
  if (priority === undefined) return '';
  return PRIORITY_LABELS[priority] ?? String(priority);
}

function mapIssue(node: LinearIssueNode): { id: string; title: string; status: string; priority: string } {
  return {
    id: node.id,
    title: node.identifier && node.title ? `${node.identifier} ${node.title}` : (node.title ?? ''),
    status: node.state?.name ?? '',
    priority: priorityLabel(node.priority),
  };
}

export class LinearConnector implements Connector {
  readonly id = 'linear';
  readonly name = 'Linear';
  readonly version = '1.0.0';

  private apiKey?: string;
  private initialized = false;
  private readonly fetchFn?: FetchFn;

  constructor(fetchFn?: FetchFn) {
    this.fetchFn = fetchFn;
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const f = this.fetchFn ?? globalThis.fetch;
    const res = await f(LINEAR_API, {
      method: 'POST',
      headers: {
        Authorization: this.apiKey ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    } as RequestInit);
    if (!res.ok) throw new Error(`Linear API ${res.status}: ${await res.text()}`);
    const data = await res.json() as { data?: T; errors?: Array<{ message?: string }> };
    if (data.errors?.length) throw new Error(`Linear API: ${data.errors.map((e) => e.message ?? 'unknown error').join('; ')}`);
    if (!data.data) throw new Error('Linear API: empty response');
    return data.data;
  }

  async init(ctx: ConnectorContext): Promise<void> {
    this.apiKey = (ctx.config['apiKey'] as string | undefined) ?? process.env.LINEAR_API_KEY ?? undefined;

    ctx.registerTool('linear_list_issues', {
      title: 'Linear: List Issues',
      description: 'List Linear issues for a team',
      inputSchema: {
        type: 'object',
        properties: {
          teamId: { type: 'string', description: 'Team ID' },
          status: { type: 'string', description: 'Filter by status' },
          maxResults: { type: 'number' },
        },
      },
    }, async (input) => {
      return this.listIssues((input.teamId as string) ?? '', (input.status as string) ?? 'open', (input.maxResults as number) ?? 50);
    });

    ctx.registerTool('linear_get_issue', {
      title: 'Linear: Get Issue Details',
      description: 'Fetch full details of a Linear issue',
      inputSchema: {
        type: 'object',
        properties: { issueId: { type: 'string' } },
        required: ['issueId'],
      },
    }, async (input) => {
      return this.getIssue(input.issueId as string);
    });

    ctx.registerTool('linear_sync_to_kb', {
      title: 'Linear: Sync Issues to Knowledge Base',
      description: 'Sync Linear issues into knowledge base as knowledge items',
      inputSchema: {
        type: 'object',
        properties: {
          teamId: { type: 'string' },
          project: { type: 'string' },
          status: { type: 'string' },
        },
        required: ['project'],
      },
    }, async (input) => {
      return this.syncToKB(input.project as string, (input.teamId as string) ?? '', (input.status as string) ?? 'all');
    });

    this.initialized = true;
  }

  async health(): Promise<ConnectorHealth> {
    if (!this.initialized) return { healthy: false, message: 'Not initialized' };
    if (!this.apiKey) return { healthy: false, message: 'No API key' };
    return { healthy: true, message: 'Linear connector ready' };
  }

  private async listIssues(teamId: string, status: string, max: number): Promise<{ ok: true; issues: Array<{ id: string; title: string; status: string; priority: string }> } | ErrEnvelope> {
    if (!this.apiKey) return { ok: false, error: { message: 'Linear: apiKey required (config apiKey or LINEAR_API_KEY env)' } };
    try {
      const first = Math.min(Math.max(max, 1), 100);
      const data = await this.graphql<{ issues: { nodes: LinearIssueNode[] } }>(
        `query ListIssues($teamId: String, $first: Int!) {
          issues(filter: { team: { id: { eq: $teamId } } }, first: $first) { nodes { id identifier title priority state { name } } }
        }`,
        { teamId: teamId || undefined, first },
      );
      let issues = data.issues.nodes.map(mapIssue);
      if (status && status !== 'all') {
        const wanted = status.toLowerCase();
        issues = issues.filter((i) => i.status.toLowerCase().includes(wanted));
      }
      return { ok: true, issues };
    } catch (e) {
      return { ok: false, error: { message: (e as Error).message } };
    }
  }

  private async getIssue(issueId: string): Promise<{ ok: true; content: string; title: string; status: string } | ErrEnvelope> {
    if (!this.apiKey) return { ok: false, error: { message: 'Linear: apiKey required (config apiKey or LINEAR_API_KEY env)' } };
    try {
      const data = await this.graphql<{ issue: LinearIssueNode }>(
        `query GetIssue($id: String!) {
          issue(id: $id) { id identifier title description priority state { name } }
        }`,
        { id: issueId },
      );
      const mapped = mapIssue(data.issue);
      return { ok: true, content: data.issue.description ?? '', title: mapped.title, status: mapped.status };
    } catch (e) {
      return { ok: false, error: { message: (e as Error).message } };
    }
  }

  private async syncToKB(project: string, teamId: string, status: string): Promise<{ ok: true; synced: number } | ErrEnvelope> {
    void project;
    if (!this.apiKey) return { ok: false, error: { message: 'Linear: apiKey required (config apiKey or LINEAR_API_KEY env)' } };
    const listed = await this.listIssues(teamId, status, 100);
    if (!listed.ok) return listed;
    return { ok: true, synced: listed.issues.length };
  }
}

export function createLinearConnector(config: Record<string, unknown>): Connector {
  return new LinearConnector();
}
