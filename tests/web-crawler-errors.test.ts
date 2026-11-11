import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebCrawlerConnector } from '../src/connectors/web-crawler.js';

type ToolHandler = (input: Record<string, unknown>) => Promise<any>;

function harness() {
  const connector = new WebCrawlerConnector();
  const tools = new Map<string, ToolHandler>();
  const ctx = {
    config: { maxPages: 10, timeoutMs: 1000 },
    registerTool: (name: string, _spec: unknown, handler: ToolHandler) => tools.set(name, handler),
  } as any;
  return { connector, tools, init: () => connector.init(ctx) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TR-35 web-crawler errors', () => {
  it('returns ok:false with the HTTP status instead of an empty success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404, statusText: 'Not Found' })));
    const { tools, init } = harness();
    await init();
    const result = await tools.get('webcrawler_fetch_page')!({ url: 'https://example.com/missing' });
    expect(result).toMatchObject({ ok: false, url: 'https://example.com/missing' });
    expect(result.error.message).toContain('HTTP 404');
    expect(result).not.toHaveProperty('content');
  });

  it('surfaces network errors and keeps crawl failures visible', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const { tools, init } = harness();
    await init();
    const page = await tools.get('webcrawler_fetch_page')!({ url: 'https://example.com/' });
    expect(page).toMatchObject({ ok: false, error: { message: 'ECONNREFUSED' } });

    const crawl = await tools.get('webcrawler_crawl_site')!({
      startUrl: 'https://example.com/',
      project: 'demo',
      maxPages: 1,
    });
    expect(crawl).toMatchObject({ ok: true, crawled: 0, synced: 0, failed: 1 });
    expect(crawl.errors[0]).toContain('ECONNREFUSED');
  });

  it('counts only successful pages and still syncs content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '<html><head><title>Doc</title></head><body><p>' + 'useful text '.repeat(20) + '</p></body></html>',
      { status: 200 },
    )));
    const { tools, init } = harness();
    await init();
    const crawl = await tools.get('webcrawler_crawl_site')!({
      startUrl: 'https://example.com/',
      project: 'demo',
      maxPages: 1,
    });
    expect(crawl).toMatchObject({ ok: true, crawled: 1, synced: 1, failed: 0, errors: [] });
  });
});
