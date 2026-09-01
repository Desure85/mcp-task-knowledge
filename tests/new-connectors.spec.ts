/**
 * new-connectors.spec.ts — Tests for NEXT-011 connectors.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GDriveConnector } from '../src/connectors/gdrive.js';
import { GmailConnector } from '../src/connectors/gmail.js';
import { NotionConnector } from '../src/connectors/notion.js';
import { OneDriveConnector } from '../src/connectors/onedrive.js';
import { LinearConnector } from '../src/connectors/linear.js';
import { WebCrawlerConnector } from '../src/connectors/web-crawler.js';
import type { ConnectorContext } from '../src/connectors/types.js';

function createMockCtx(): ConnectorContext & { tools: Array<{ name: string }> } {
  const tools: Array<{ name: string }> = [];
  return {
    config: {},
    registerTool: (name: string) => { tools.push({ name }); },
    tools,
  };
}

describe('GDriveConnector', () => {
  it('creates with correct id and name', () => {
    const c = new GDriveConnector();
    expect(c.id).toBe('gdrive');
    expect(c.name).toBe('Google Drive');
    expect(c.version).toBe('1.0.0');
  });

  it('init registers 3 tools', async () => {
    const c = new GDriveConnector();
    const ctx = createMockCtx();
    await c.init(ctx);
    const tools = ctx.tools;
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toContain('gdrive_list_files');
    expect(tools.map((t) => t.name)).toContain('gdrive_get_file');
    expect(tools.map((t) => t.name)).toContain('gdrive_sync_folder');
  });

  it('health returns unhealthy without config', async () => {
    const c = new GDriveConnector();
    const h = await c.health();
    expect(h.healthy).toBe(false);
  });

  it('health returns healthy with credentials', async () => {
    const c = new GDriveConnector();
    await c.init({ ...createMockCtx(), config: { apiKey: 'test' } });
    const h = await c.health();
    expect(h.healthy).toBe(true);
  });
});

describe('GmailConnector', () => {
  it('creates with correct id', () => {
    const c = new GmailConnector();
    expect(c.id).toBe('gmail');
    expect(c.name).toBe('Gmail');
  });

  it('init registers 3 tools', async () => {
    const c = new GmailConnector();
    const ctx = createMockCtx();
    await c.init(ctx);
    const tools = ctx.tools;
    expect(tools).toHaveLength(3);
  });

  it('health returns unhealthy without token', async () => {
    const c = new GmailConnector();
    await c.init(createMockCtx());
    const h = await c.health();
    expect(h.healthy).toBe(false);
  });

  it('health returns healthy with token', async () => {
    const c = new GmailConnector();
    await c.init({ ...createMockCtx(), config: { accessToken: 'tok' } });
    const h = await c.health();
    expect(h.healthy).toBe(true);
  });
});

describe('NotionConnector', () => {
  it('creates with correct id', () => {
    const c = new NotionConnector();
    expect(c.id).toBe('notion');
    expect(c.name).toBe('Notion');
  });

  it('init registers 3 tools', async () => {
    const c = new NotionConnector();
    const ctx = createMockCtx();
    await c.init(ctx);
    const tools = ctx.tools;
    expect(tools).toHaveLength(3);
  });

  it('health returns healthy with apiKey', async () => {
    const c = new NotionConnector();
    await c.init({ ...createMockCtx(), config: { apiKey: 'key' } });
    const h = await c.health();
    expect(h.healthy).toBe(true);
  });
});

describe('OneDriveConnector', () => {
  it('creates with correct id', () => {
    const c = new OneDriveConnector();
    expect(c.id).toBe('onedrive');
    expect(c.name).toBe('OneDrive');
  });

  it('init registers 3 tools', async () => {
    const c = new OneDriveConnector();
    const ctx = createMockCtx();
    await c.init(ctx);
    const tools = ctx.tools;
    expect(tools).toHaveLength(3);
  });

  it('health returns healthy with token', async () => {
    const c = new OneDriveConnector();
    await c.init({ ...createMockCtx(), config: { accessToken: 'tok' } });
    const h = await c.health();
    expect(h.healthy).toBe(true);
  });
});

describe('LinearConnector', () => {
  it('creates with correct id', () => {
    const c = new LinearConnector();
    expect(c.id).toBe('linear');
    expect(c.name).toBe('Linear');
  });

  it('init registers 3 tools', async () => {
    const c = new LinearConnector();
    const ctx = createMockCtx();
    await c.init(ctx);
    const tools = ctx.tools;
    expect(tools).toHaveLength(3);
  });

  it('health returns healthy with apiKey', async () => {
    const c = new LinearConnector();
    await c.init({ ...createMockCtx(), config: { apiKey: 'key' } });
    const h = await c.health();
    expect(h.healthy).toBe(true);
  });
});

describe('WebCrawlerConnector', () => {
  it('creates with correct id', () => {
    const c = new WebCrawlerConnector();
    expect(c.id).toBe('web-crawler');
    expect(c.name).toBe('Web Crawler');
  });

  it('init registers 2 tools', async () => {
    const c = new WebCrawlerConnector();
    const ctx = createMockCtx();
    await c.init(ctx);
    const tools = ctx.tools;
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toContain('webcrawler_fetch_page');
    expect(tools.map((t) => t.name)).toContain('webcrawler_crawl_site');
  });

  it('health is always healthy after init', async () => {
    const c = new WebCrawlerConnector();
    await c.init(createMockCtx());
    const h = await c.health();
    expect(h.healthy).toBe(true);
  });

  it('fetchPage returns empty on invalid URL', async () => {
    const c = new WebCrawlerConnector();
    await c.init(createMockCtx());
    const result = await (c as unknown as { fetchPage: (u: string) => Promise<unknown> }).fetchPage('http://invalid.localhost.test/page');
    expect(result).toEqual({ ok: true, url: 'http://invalid.localhost.test/page', title: '', content: '', links: [] });
  });
});
