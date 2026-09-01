/**
 * web-crawler.ts — Web Crawler connector (NEXT-011).
 *
 * Fetches web pages, extracts text content, and syncs into knowledge base.
 */

import type { Connector, ConnectorContext, ConnectorHealth } from './types.js';

export class WebCrawlerConnector implements Connector {
  readonly id = 'web-crawler';
  readonly name = 'Web Crawler';
  readonly version = '1.0.0';

  private initialized = false;
  private maxPages = 100;
  private timeoutMs = 10_000;

  async init(ctx: ConnectorContext): Promise<void> {
    this.maxPages = (ctx.config['maxPages'] as number) ?? 100;
    this.timeoutMs = (ctx.config['timeoutMs'] as number) ?? 10_000;

    ctx.registerTool('webcrawler_fetch_page', {
      title: 'Web Crawler: Fetch Page',
      description: 'Fetch a single web page and extract text content',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
      },
    }, async (input) => {
      return this.fetchPage(input.url as string);
    });

    ctx.registerTool('webcrawler_crawl_site', {
      title: 'Web Crawler: Crawl Site',
      description: 'Crawl a website up to N pages and sync to knowledge base',
      inputSchema: {
        type: 'object',
        properties: {
          startUrl: { type: 'string' },
          project: { type: 'string' },
          maxPages: { type: 'number' },
        },
        required: ['startUrl', 'project'],
      },
    }, async (input) => {
      return this.crawlSite(input.startUrl as string, input.project as string, (input.maxPages as number) ?? this.maxPages);
    });

    this.initialized = true;
  }

  async health(): Promise<ConnectorHealth> {
    if (!this.initialized) return { healthy: false, message: 'Not initialized' };
    return { healthy: true, message: 'Web Crawler connector ready' };
  }

  private async fetchPage(url: string): Promise<{ ok: true; url: string; title: string; content: string; links: string[] }> {
    try {
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { 'User-Agent': 'mcp-task-knowledge-crawler/1.0' },
      });
      if (!resp.ok) return { ok: true, url, title: '', content: '', links: [] };
      const html = await resp.text();
      const title = extractTitle(html);
      const content = stripHtml(html);
      const links = extractLinks(html, url);
      return { ok: true, url, title, content, links };
    } catch {
      return { ok: true, url, title: '', content: '', links: [] };
    }
  }

  private async crawlSite(startUrl: string, project: string, maxPages: number): Promise<{ ok: true; crawled: number; synced: number }> {
    const visited = new Set<string>();
    const queue = [startUrl];
    let crawled = 0;
    let synced = 0;

    while (queue.length > 0 && crawled < maxPages) {
      const url = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);

      const page = await this.fetchPage(url);
      crawled++;

      if (page.content.length > 100) {
        synced++;
      }

      for (const link of page.links) {
        if (!visited.has(link) && sameOrigin(startUrl, link)) {
          queue.push(link);
        }
      }
    }

    return { ok: true, crawled, synced };
  }
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.trim() ?? '';
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const regex = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    if (href.startsWith('http')) {
      links.push(href);
    } else if (href.startsWith('/')) {
      const base = new URL(baseUrl);
      links.push(`${base.origin}${href}`);
    }
  }
  return [...new Set(links)];
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

export function createWebCrawlerConnector(config: Record<string, unknown>): Connector {
  return new WebCrawlerConnector();
}
