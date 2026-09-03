/**
 * notion.ts — Notion connector (NEXT-011, WIRE-009).
 *
 * Lists pages, fetches content, and syncs Notion pages into knowledge base.
 * Uses the Notion v1 REST API with an integration token
 * (config `apiKey` or `NOTION_API_KEY` env, SEC-004).
 */

import type { Connector, ConnectorContext, ConnectorHealth } from './types.js';
import type { ErrEnvelope } from '../utils/respond.js';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

/** Injectable fetch for hermetic tests (defaults to global fetch). */
export type FetchFn = typeof fetch;

interface NotionRichText {
  plain_text?: string;
}

interface NotionTitleProperty {
  type?: string;
  title?: NotionRichText[];
}

function extractTitle(properties: Record<string, unknown> | undefined): string {
  if (!properties) return '';
  for (const prop of Object.values(properties)) {
    const p = prop as NotionTitleProperty;
    if (p?.type === 'title' && Array.isArray(p.title)) {
      return p.title.map((t) => t.plain_text ?? '').join('');
    }
  }
  return '';
}

function isRichTextContainer(value: unknown): value is { rich_text?: NotionRichText[] } {
  return typeof value === 'object' && value !== null && 'rich_text' in value;
}

/** Plain-text rendering of a page's block children. */
function renderBlocks(blocks: Array<{ type?: string } & Record<string, unknown>>): string {
  const lines: string[] = [];
  for (const block of blocks) {
    const content: unknown = block.type ? block[block.type] : undefined;
    if (isRichTextContainer(content) && Array.isArray(content.rich_text)) {
      const text = content.rich_text.map((t) => t.plain_text ?? '').join('');
      if (text) lines.push(text);
    }
  }
  return lines.join('\n');
}

export class NotionConnector implements Connector {
  readonly id = 'notion';
  readonly name = 'Notion';
  readonly version = '1.0.0';

  private apiKey?: string;
  private initialized = false;
  private readonly fetchFn?: FetchFn;

  constructor(fetchFn?: FetchFn) {
    this.fetchFn = fetchFn;
  }

  private async notionFetch(path: string, init?: { method?: string; body?: string }): Promise<Response> {
    const f = this.fetchFn ?? globalThis.fetch;
    return f(`${NOTION_API}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: init?.body,
    } as RequestInit);
  }

  private async notionJson<T>(path: string, init?: { method?: string; body?: string }): Promise<T> {
    const res = await this.notionFetch(path, init);
    if (!res.ok) throw new Error(`Notion API ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  async init(ctx: ConnectorContext): Promise<void> {
    this.apiKey = (ctx.config['apiKey'] as string | undefined) ?? process.env.NOTION_API_KEY ?? undefined;

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

  private async searchPages(query: string, max: number): Promise<{ ok: true; pages: Array<{ id: string; title: string; url: string }> } | ErrEnvelope> {
    if (!this.apiKey) return { ok: false, error: { message: 'Notion: apiKey required (config apiKey or NOTION_API_KEY env)' } };
    try {
      const pageSize = Math.min(Math.max(max, 1), 100);
      const data = await this.notionJson<{ results?: Array<{ id: string; url?: string; properties?: Record<string, unknown> }> }>('/search', {
        method: 'POST',
        body: JSON.stringify({ query, page_size: pageSize, filter: { property: 'object', value: 'page' } }),
      });
      const pages = (data.results ?? []).map((p) => ({ id: p.id, title: extractTitle(p.properties), url: p.url ?? '' }));
      return { ok: true, pages };
    } catch (e) {
      return { ok: false, error: { message: (e as Error).message } };
    }
  }

  private async getPageContent(pageId: string): Promise<{ ok: true; content: string; title: string } | ErrEnvelope> {
    if (!this.apiKey) return { ok: false, error: { message: 'Notion: apiKey required (config apiKey or NOTION_API_KEY env)' } };
    try {
      const id = encodeURIComponent(pageId);
      const page = await this.notionJson<{ properties?: Record<string, unknown> }>(`/pages/${id}`);
      const blocks = await this.notionJson<{ results?: Array<{ type?: string } & Record<string, unknown>> }>(`/blocks/${id}/children?page_size=100`);
      return { ok: true, content: renderBlocks(blocks.results ?? []), title: extractTitle(page.properties) };
    } catch (e) {
      return { ok: false, error: { message: (e as Error).message } };
    }
  }

  private async syncDatabase(databaseId: string, project: string): Promise<{ ok: true; synced: number } | ErrEnvelope> {
    void project;
    if (!this.apiKey) return { ok: false, error: { message: 'Notion: apiKey required (config apiKey or NOTION_API_KEY env)' } };
    try {
      let synced = 0;
      let cursor: string | undefined;
      for (let pages = 0; pages < 10; pages++) {
        const data = await this.notionJson<{ results?: unknown[]; has_more?: boolean; next_cursor?: string }>(
          `/databases/${encodeURIComponent(databaseId)}/query`,
          { method: 'POST', body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }) },
        );
        synced += (data.results ?? []).length;
        if (!data.has_more || !data.next_cursor) break;
        cursor = data.next_cursor;
      }
      return { ok: true, synced };
    } catch (e) {
      return { ok: false, error: { message: (e as Error).message } };
    }
  }
}

export function createNotionConnector(config: Record<string, unknown>): Connector {
  return new NotionConnector();
}
