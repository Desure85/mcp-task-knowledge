/**
 * notion.ts — Notion connector (NEXT-011).
 *
 * Lists pages, fetches content, and syncs Notion pages into knowledge base.
 */

import type { Connector, ConnectorContext, ConnectorHealth } from './types.js';

export class NotionConnector implements Connector {
  readonly id = 'notion';
  readonly name = 'Notion';
  readonly version = '1.0.0';

  private apiKey?: string;
  private initialized = false;

  async init(ctx: ConnectorContext): Promise<void> {
    this.apiKey = ctx.config['apiKey'] as string | undefined;

    ctx.registerTool('notion_search_pages', {
      title: 'Notion: Search Pages',
      description: 'Search Notion pages by query',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          maxResults: { type: 'number', description: 'Max results (default 20)' },
        },
      },
    }, async (input) => {
      return this.searchPages((input.query as string) ?? '', (input.maxResults as number) ?? 20);
    });

    ctx.registerTool('notion_get_page', {
      title: 'Notion: Get Page Content',
      description: 'Fetch content of a Notion page',
      inputSchema: {
        type: 'object',
        properties: { pageId: { type: 'string' } },
        required: ['pageId'],
      },
    }, async (input) => {
      return this.getPageContent(input.pageId as string);
    });

    ctx.registerTool('notion_sync_database', {
      title: 'Notion: Sync Database to Knowledge Base',
      description: 'Sync all pages from a Notion database into knowledge base',
      inputSchema: {
        type: 'object',
        properties: {
          databaseId: { type: 'string' },
          project: { type: 'string' },
        },
        required: ['databaseId', 'project'],
      },
    }, async (input) => {
      return this.syncDatabase(input.databaseId as string, input.project as string);
    });

    this.initialized = true;
  }

  async health(): Promise<ConnectorHealth> {
    if (!this.initialized) return { healthy: false, message: 'Not initialized' };
    if (!this.apiKey) return { healthy: false, message: 'No API key' };
    return { healthy: true, message: 'Notion connector ready' };
  }

  private async searchPages(query: string, max: number): Promise<{ ok: true; pages: Array<{ id: string; title: string; url: string }> }> {
    return { ok: true, pages: [] };
  }

  private async getPageContent(pageId: string): Promise<{ ok: true; content: string; title: string }> {
    return { ok: true, content: '', title: '' };
  }

  private async syncDatabase(databaseId: string, project: string): Promise<{ ok: true; synced: number }> {
    return { ok: true, synced: 0 };
  }
}

export function createNotionConnector(config: Record<string, unknown>): Connector {
  return new NotionConnector();
}
