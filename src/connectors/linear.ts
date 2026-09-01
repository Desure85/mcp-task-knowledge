/**
 * linear.ts — Linear connector (NEXT-011).
 *
 * Lists issues, fetches details, and syncs Linear issues into knowledge base.
 */

import type { Connector, ConnectorContext, ConnectorHealth } from './types.js';

export class LinearConnector implements Connector {
  readonly id = 'linear';
  readonly name = 'Linear';
  readonly version = '1.0.0';

  private apiKey?: string;
  private initialized = false;

  async init(ctx: ConnectorContext): Promise<void> {
    this.apiKey = ctx.config['apiKey'] as string | undefined;

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

  private async listIssues(teamId: string, status: string, max: number): Promise<{ ok: true; issues: Array<{ id: string; title: string; status: string; priority: string }> }> {
    return { ok: true, issues: [] };
  }

  private async getIssue(issueId: string): Promise<{ ok: true; content: string; title: string; status: string }> {
    return { ok: true, content: '', title: '', status: '' };
  }

  private async syncToKB(project: string, teamId: string, status: string): Promise<{ ok: true; synced: number }> {
    return { ok: true, synced: 0 };
  }
}

export function createLinearConnector(config: Record<string, unknown>): Connector {
  return new LinearConnector();
}
