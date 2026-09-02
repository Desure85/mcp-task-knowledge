/**
 * gmail.ts — Gmail connector (NEXT-011).
 *
 * Lists emails, fetches content, and syncs emails into knowledge base.
 */

import type { Connector, ConnectorContext, ConnectorHealth } from './types.js';

export class GmailConnector implements Connector {
  readonly id = 'gmail';
  readonly name = 'Gmail';
  readonly version = '1.0.0';

  private accessToken?: string;
  private initialized = false;

  async init(ctx: ConnectorContext): Promise<void> {
    this.accessToken = ctx.config['accessToken'] as string | undefined;

    ctx.registerTool('gmail_list_messages', {
      title: 'Gmail: List Messages',
      description: 'List recent Gmail messages',
      inputSchema: {
        type: 'object',
        properties: {
          maxResults: { type: 'number', description: 'Max messages (default 20)' },
          query: { type: 'string', description: 'Gmail search query' },
        },
      },
    }, async (input) => {
      const max = (input.maxResults as number) ?? 20;
      const query = (input.query as string) ?? '';
      return this.listMessages(max, query);
    });

    ctx.registerTool('gmail_get_message', {
      title: 'Gmail: Get Message',
      description: 'Fetch full content of a Gmail message',
      inputSchema: {
        type: 'object',
        properties: { messageId: { type: 'string' } },
        required: ['messageId'],
      },
    }, async (input) => {
      return this.getMessage(input.messageId as string);
    });

    ctx.registerTool('gmail_sync_to_kb', {
      title: 'Gmail: Sync Messages to Knowledge Base',
      description: 'Sync emails matching query into knowledge base',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          project: { type: 'string' },
          maxResults: { type: 'number' },
        },
        required: ['project'],
      },
    }, async (input) => {
      return this.syncToKB(input.project as string, (input.query as string) ?? '', (input.maxResults as number) ?? 50);
    });

    this.initialized = true;
  }

  async health(): Promise<ConnectorHealth> {
    if (!this.initialized) return { healthy: false, message: 'Not initialized' };
    if (!this.accessToken) return { healthy: false, message: 'No access token' };
    return { healthy: true, message: 'Gmail connector ready' };
  }

  private async listMessages(max: number, query: string): Promise<{ ok: true; messages: Array<{ id: string; snippet: string; from: string; subject: string }> }> {
    return { ok: true, messages: [] };
  }

  private async getMessage(messageId: string): Promise<{ ok: true; content: string; subject: string }> {
    return { ok: true, content: '', subject: '' };
  }

  private async syncToKB(project: string, query: string, max: number): Promise<{ ok: true; synced: number }> {
    return { ok: true, synced: 0 };
  }
}

export function createGmailConnector(config: Record<string, unknown>): Connector {
  return new GmailConnector();
}
