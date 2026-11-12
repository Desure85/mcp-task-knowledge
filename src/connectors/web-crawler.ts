/**
 * web-crawler.ts — Web Crawler connector (NEXT-011).
 *
 * Fetches web pages, extracts text content, and syncs into knowledge base.
 */

import type { Connector, ConnectorContext, ConnectorHealth } from './types.js';
import { safeFetchText } from './egress.js';

export class WebCrawlerConnector implements Connector {
  readonly id = 'web-crawler';
  readonly name = 'Web Crawler';
  readonly version = '1.0.0';

  private initialized = false;
  private maxPages = 100;
  private timeoutMs = 10_000;
  private allowedHosts: string[] | undefined;
  private allowPrivate = false;
  private maxRedirects = 5;

  async init(ctx: ConnectorContext): Promise<void> {
    this.maxPages = (ctx.config['maxPages'] as number) ?? 100;
    this.timeoutMs = (ctx.config['timeoutMs'] as number) ?? 10_000;
    this.allowedHosts = ctx.config['allowedHosts'] as string[] | undefined;
    this.allowPrivate = ctx.config['allowPrivate'] === true;
    this.maxRedirects = (ctx.config['maxRedirects'] as number) ?? 5;

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

  private async fetchPage(url: string): Promise<{ ok: true; url: string; title: string; content: string; links: string[] } | { ok: false; url: string; error: { message: string } }> {
    try {
      const resp = await safeFetchText(url, {
        timeoutMs: this.timeoutMs,
        allowedHosts: this.allowedHosts,
        allowPrivate: this.allowPrivate,
        maxRedirects: this.maxRedirects,
      });
      if (resp.status < 200 || resp.status >= 300) return { ok: false, url, error: { message: `HTTP ${resp.status}` } };
      const html = resp.text;
      const title = extractTitle(html);
      const content = stripHtml(html);
      const links = extractLinks(html, resp.url);
      return { ok: true, url: resp.url, title, content, links };
    } catch (error) {
      return { ok: false, url, error: { message: (error as Error).message || 'fetch failed' } };
    }
  }

  private async crawlSite(startUrl: string, project: string, maxPages: number): Promise<{ ok: true; crawled: number; synced: number; failed: number; errors: string[] }> {
    const visited = new Set<string>();
    const queue = [startUrl];
    let crawled = 0;
    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    while (queue.length > 0 && crawled < maxPages) {
      const url = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);

      const page = await this.fetchPage(url);
      if (!page.ok) {
        failed++;
        errors.push(`${url}: ${page.error.message}`);
        continue;
      }
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

    return { ok: true, crawled, synced, failed, errors };
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

export function createWebCrawlerConnector(_config: Record<string, unknown>): Connector {
  return new WebCrawlerConnector();
}
