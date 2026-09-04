/**
 * connectors/real-apis.spec.ts — WIRE-009: real API calls for stub connectors.
 *
 * Hermetic: global fetch is mocked, no network. Per connector:
 * success-path mapping, auth-header correctness, missing-credential
 * fail-closed err(), HTTP-error mapping.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GDriveConnector } from './gdrive.js';
import { GmailConnector } from './gmail.js';
import { NotionConnector } from './notion.js';
import { OneDriveConnector } from './onedrive.js';
import { LinearConnector } from './linear.js';
import type { ConnectorContext } from './types.js';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

type Handler = (input: Record<string, unknown>) => Promise<unknown>;
type ErrRes = { ok: false; error: { message: string } };

function mockCtx(config: Record<string, unknown> = {}): { ctx: ConnectorContext; tools: Map<string, Handler> } {
  const tools = new Map<string, Handler>();
  const ctx: ConnectorContext = {
    config,
    registerTool: (name, _schema, handler) => { tools.set(name, handler); },
  };
  return { ctx, tools };
}

function jsonOk(data: unknown) {
  return { ok: true, status: 200, json: async () => data, text: async () => '' };
}

function httpErr(status: number, body: string) {
  return { ok: false, status, json: async () => ({}), text: async () => body };
}

function callHeaders(n = 0): Record<string, string> {
  return (mockFetch.mock.calls[n][1] as { headers: Record<string, string> }).headers;
}

function callUrl(n = 0): string {
  return mockFetch.mock.calls[n][0] as string;
}

function expectErr(result: unknown, contains: string): void {
  const res = result as { ok: boolean; error?: { message: string } };
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error('expected err envelope');
  expect((res as ErrRes).error.message).toContain(contains);
}

const ENVS = ['GDRIVE_ACCESS_TOKEN', 'GMAIL_ACCESS_TOKEN', 'NOTION_API_KEY', 'ONEDRIVE_ACCESS_TOKEN', 'LINEAR_API_KEY'];

beforeEach(() => {
  mockFetch.mockReset();
  for (const k of ENVS) delete process.env[k];
});

describe('WIRE-009: GDrive real API', () => {
  it('listFiles maps Drive v3 response and sends Bearer token', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({ files: [{ id: 'f1', name: 'a.txt', mimeType: 'text/plain' }] }));
    const c = new GDriveConnector();
    const { ctx, tools } = mockCtx({ accessToken: 'tok' });
    await c.init(ctx);
    const res = await tools.get('gdrive_list_files')!({ folderId: 'root' }) as { ok: boolean; files?: Array<{ id: string; name: string; mimeType: string }> };
    expect(res.ok).toBe(true);
    expect(res.files).toEqual([{ id: 'f1', name: 'a.txt', mimeType: 'text/plain' }]);
    expect(callUrl()).toContain('www.googleapis.com/drive/v3/files');
    expect(callHeaders().Authorization).toBe('Bearer tok');
  });

  it('getFileContent exports Google Workspace docs as text', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({ mimeType: 'application/vnd.google-apps.document' }));
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}), text: async () => 'doc text' });
    const c = new GDriveConnector();
    const { ctx, tools } = mockCtx({ accessToken: 'tok' });
    await c.init(ctx);
    const res = await tools.get('gdrive_get_file')!({ fileId: 'd1' }) as { ok: boolean; content?: string };
    expect(res.ok).toBe(true);
    expect(res.content).toBe('doc text');
    expect(callUrl(1)).toContain('/export?mimeType=text/plain');
  });

  it('fails closed without credentials (no network call)', async () => {
    const c = new GDriveConnector();
    const { ctx, tools } = mockCtx();
    await c.init(ctx);
    const res = await tools.get('gdrive_list_files')!({ folderId: 'root' });
    expectErr(res, 'accessToken required');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('maps HTTP errors to err envelope', async () => {
    mockFetch.mockResolvedValueOnce(httpErr(401, 'invalid credentials'));
    const c = new GDriveConnector();
    const { ctx, tools } = mockCtx({ accessToken: 'bad' });
    await c.init(ctx);
    const res = await tools.get('gdrive_list_files')!({ folderId: 'root' });
    expectErr(res, 'Google Drive API 401');
  });
});

describe('WIRE-009: Gmail real API', () => {
  it('listMessages maps ids to From/Subject via metadata fetch', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({ messages: [{ id: 'm1' }] }));
    mockFetch.mockResolvedValueOnce(jsonOk({
      snippet: 'snip',
      payload: { headers: [{ name: 'From', value: 'a@x.io' }, { name: 'Subject', value: 'Hi' }] },
    }));
    const c = new GmailConnector();
    const { ctx, tools } = mockCtx({ accessToken: 'tok' });
    await c.init(ctx);
    const res = await tools.get('gmail_list_messages')!({ maxResults: 5, query: 'in:inbox' }) as { ok: boolean; messages?: Array<{ id: string; from: string; subject: string }> };
    expect(res.ok).toBe(true);
    expect(res.messages).toEqual([{ id: 'm1', snippet: 'snip', from: 'a@x.io', subject: 'Hi' }]);
    expect(callUrl()).toContain('gmail.googleapis.com/gmail/v1/users/me/messages');
    expect(callHeaders().Authorization).toBe('Bearer tok');
  });

  it('getMessage decodes base64url body', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({
      snippet: 'hello',
      payload: {
        headers: [{ name: 'Subject', value: 'S' }],
        mimeType: 'multipart/alternative',
        parts: [{ mimeType: 'text/plain', body: { data: 'aGVsbG8=' } }],
      },
    }));
    const c = new GmailConnector();
    const { ctx, tools } = mockCtx({ accessToken: 'tok' });
    await c.init(ctx);
    const res = await tools.get('gmail_get_message')!({ messageId: 'm1' }) as { ok: boolean; content?: string; subject?: string };
    expect(res.ok).toBe(true);
    expect(res.content).toBe('hello');
    expect(res.subject).toBe('S');
  });

  it('fails closed without credentials (no network call)', async () => {
    const c = new GmailConnector();
    const { ctx, tools } = mockCtx();
    await c.init(ctx);
    const res = await tools.get('gmail_get_message')!({ messageId: 'm1' });
    expectErr(res, 'accessToken required');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('maps HTTP errors to err envelope', async () => {
    mockFetch.mockResolvedValueOnce(httpErr(403, 'quota exceeded'));
    const c = new GmailConnector();
    const { ctx, tools } = mockCtx({ accessToken: 'bad' });
    await c.init(ctx);
    const res = await tools.get('gmail_list_messages')!({});
    expectErr(res, 'Gmail API 403');
  });
});

describe('WIRE-009: Notion real API', () => {
  it('searchPages maps results and sends Notion-Version header', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({
      results: [{ id: 'p1', url: 'https://notion.so/p1', properties: { title: { type: 'title', title: [{ plain_text: 'My Page' }] } } }],
    }));
    const c = new NotionConnector();
    const { ctx, tools } = mockCtx({ apiKey: 'key' });
    await c.init(ctx);
    const res = await tools.get('notion_search_pages')!({ query: 'My' }) as { ok: boolean; pages?: Array<{ id: string; title: string; url: string }> };
    expect(res.ok).toBe(true);
    expect(res.pages).toEqual([{ id: 'p1', title: 'My Page', url: 'https://notion.so/p1' }]);
    expect(callUrl()).toContain('api.notion.com/v1/search');
    expect(callHeaders().Authorization).toBe('Bearer key');
    expect(callHeaders()['Notion-Version']).toBe('2022-06-28');
  });

  it('getPageContent renders block children to text', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({ properties: { title: { type: 'title', title: [{ plain_text: 'T' }] } } }));
    mockFetch.mockResolvedValueOnce(jsonOk({
      results: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Hello' }, { plain_text: ' world' }] } }],
    }));
    const c = new NotionConnector();
    const { ctx, tools } = mockCtx({ apiKey: 'key' });
    await c.init(ctx);
    const res = await tools.get('notion_get_page')!({ pageId: 'p1' }) as { ok: boolean; content?: string; title?: string };
    expect(res.ok).toBe(true);
    expect(res.content).toBe('Hello world');
    expect(res.title).toBe('T');
  });

  it('fails closed without credentials (no network call)', async () => {
    const c = new NotionConnector();
    const { ctx, tools } = mockCtx();
    await c.init(ctx);
    const res = await tools.get('notion_search_pages')!({ query: 'x' });
    expectErr(res, 'apiKey required');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('maps HTTP errors to err envelope', async () => {
    mockFetch.mockResolvedValueOnce(httpErr(401, 'unauthorized'));
    const c = new NotionConnector();
    const { ctx, tools } = mockCtx({ apiKey: 'bad' });
    await c.init(ctx);
    const res = await tools.get('notion_get_page')!({ pageId: 'p1' });
    expectErr(res, 'Notion API 401');
  });
});

describe('WIRE-009: OneDrive real API', () => {
  it('listFiles maps Graph children and sends Bearer token', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({ value: [{ id: 'f1', name: 'a.txt', size: 10 }] }));
    const c = new OneDriveConnector();
    const { ctx, tools } = mockCtx({ accessToken: 'tok' });
    await c.init(ctx);
    const res = await tools.get('onedrive_list_files')!({}) as { ok: boolean; files?: Array<{ id: string; name: string; size: number }> };
    expect(res.ok).toBe(true);
    expect(res.files).toEqual([{ id: 'f1', name: 'a.txt', size: 10 }]);
    expect(callUrl()).toContain('graph.microsoft.com/v1.0/me/drive/root/children');
    expect(callHeaders().Authorization).toBe('Bearer tok');
  });

  it('getFileContent fetches item content as text', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}), text: async () => 'file-bytes' });
    const c = new OneDriveConnector();
    const { ctx, tools } = mockCtx({ accessToken: 'tok' });
    await c.init(ctx);
    const res = await tools.get('onedrive_get_file')!({ fileId: 'f1' }) as { ok: boolean; content?: string };
    expect(res.ok).toBe(true);
    expect(res.content).toBe('file-bytes');
    expect(callUrl()).toContain('/content');
  });

  it('fails closed without credentials (no network call)', async () => {
    const c = new OneDriveConnector();
    const { ctx, tools } = mockCtx();
    await c.init(ctx);
    const res = await tools.get('onedrive_get_file')!({ fileId: 'f1' });
    expectErr(res, 'accessToken required');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('maps HTTP errors to err envelope', async () => {
    mockFetch.mockResolvedValueOnce(httpErr(401, 'invalid token'));
    const c = new OneDriveConnector();
    const { ctx, tools } = mockCtx({ accessToken: 'bad' });
    await c.init(ctx);
    const res = await tools.get('onedrive_list_files')!({ folderPath: '/root' });
    expectErr(res, 'OneDrive API 401');
  });
});

describe('WIRE-009: Linear real API', () => {
  it('listIssues maps GraphQL nodes and sends raw API key', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({
      data: { issues: { nodes: [{ id: 'i1', identifier: 'ENG-1', title: 'Bug', priority: 3, state: { name: 'Todo' } }] } },
    }));
    const c = new LinearConnector();
    const { ctx, tools } = mockCtx({ apiKey: 'test-key' });
    await c.init(ctx);
    const res = await tools.get('linear_list_issues')!({ status: 'all' }) as { ok: boolean; issues?: Array<{ id: string; title: string; status: string; priority: string }> };
    expect(res.ok).toBe(true);
    expect(res.issues).toEqual([{ id: 'i1', title: 'ENG-1 Bug', status: 'Todo', priority: 'High' }]);
    expect(callUrl()).toBe('https://api.linear.app/graphql');
    expect(callHeaders().Authorization).toBe('test-key');
  });

  it('maps GraphQL errors[] to err envelope', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({ errors: [{ message: 'Bad credentials' }] }));
    const c = new LinearConnector();
    const { ctx, tools } = mockCtx({ apiKey: 'bad' });
    await c.init(ctx);
    const res = await tools.get('linear_get_issue')!({ issueId: 'i1' });
    expectErr(res, 'Bad credentials');
  });

  it('fails closed without credentials (no network call)', async () => {
    const c = new LinearConnector();
    const { ctx, tools } = mockCtx();
    await c.init(ctx);
    const res = await tools.get('linear_list_issues')!({});
    expectErr(res, 'apiKey required');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('maps HTTP errors to err envelope', async () => {
    mockFetch.mockResolvedValueOnce(httpErr(429, 'rate limited'));
    const c = new LinearConnector();
    const { ctx, tools } = mockCtx({ apiKey: 'key' });
    await c.init(ctx);
    const res = await tools.get('linear_list_issues')!({ status: 'all' });
    expectErr(res, 'Linear API 429');
  });
});
