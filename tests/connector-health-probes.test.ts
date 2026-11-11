import { afterEach, describe, expect, it, vi } from 'vitest';
import { GDriveConnector } from '../src/connectors/gdrive.js';
import { GmailConnector } from '../src/connectors/gmail.js';
import { NotionConnector } from '../src/connectors/notion.js';
import { OneDriveConnector } from '../src/connectors/onedrive.js';
import { LinearConnector } from '../src/connectors/linear.js';

const noopCtx = (config: Record<string, unknown>) => ({
  config,
  registerTool: () => {},
});

function response(ok: boolean, status: number, body = '') {
  return { ok, status, text: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TR-31 real OAuth connector health probes', () => {
  it('probes GDrive/Gmail/OneDrive with the bearer token', async () => {
    const fetchMock = vi.fn(async () => response(true, 200));
    vi.stubGlobal('fetch', fetchMock);

    const gdrive = new GDriveConnector();
    await gdrive.init(noopCtx({ accessToken: 'g-token' }));
    expect(await gdrive.health()).toMatchObject({ healthy: true });

    const gmail = new GmailConnector();
    await gmail.init(noopCtx({ accessToken: 'mail-token' }));
    expect(await gmail.health()).toMatchObject({ healthy: true });

    const onedrive = new OneDriveConnector();
    await onedrive.init(noopCtx({ accessToken: 'od-token' }));
    expect(await onedrive.health()).toMatchObject({ healthy: true });

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map((c) => c[0])).toEqual([
      'https://www.googleapis.com/drive/v3/about?fields=user',
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      'https://graph.microsoft.com/v1.0/me/drive',
    ]);
    expect((calls[0][1].headers as Record<string, string>).Authorization).toBe('Bearer g-token');
  });

  it('probes Notion with its version header and Linear with GraphQL POST', async () => {
    const fetchMock = vi.fn(async () => response(true, 200));
    vi.stubGlobal('fetch', fetchMock);

    const notion = new NotionConnector();
    await notion.init(noopCtx({ apiKey: 'notion-key' }));
    expect(await notion.health()).toMatchObject({ healthy: true });

    const linear = new LinearConnector();
    await linear.init(noopCtx({ apiKey: 'lin-key' }));
    expect(await linear.health()).toMatchObject({ healthy: true });

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect((calls[0][1].headers as Record<string, string>)['Notion-Version']).toBe('2022-06-28');
    expect(calls[1][0]).toBe('https://api.linear.app/graphql');
    expect(calls[1][1].method).toBe('POST');
    expect(JSON.parse(String(calls[1][1].body))).toEqual({ query: '{ viewer { id } }' });
  });

  it('reports a revoked token (401) as unhealthy instead of healthy:true', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(false, 401, 'Unauthorized')));
    const gmail = new GmailConnector();
    await gmail.init(noopCtx({ accessToken: 'revoked' }));
    const health = await gmail.health();
    expect(health.healthy).toBe(false);
    expect(health.message).toContain('401');
  });

  it('reports network failure as unhealthy and does not throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    }));
    const notion = new NotionConnector();
    await notion.init(noopCtx({ apiKey: 'key' }));
    const health = await notion.health();
    expect(health.healthy).toBe(false);
    expect(health.message).toContain('ECONNREFUSED');
  });

  it('GDrive without an OAuth token is unhealthy even when apiKey/refreshToken exist', async () => {
    const gdrive = new GDriveConnector();
    await gdrive.init(noopCtx({ apiKey: 'key', refreshToken: 'refresh' }));
    expect(await gdrive.health()).toMatchObject({ healthy: false });
  });
});
