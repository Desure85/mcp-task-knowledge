import { describe, expect, it } from 'vitest';
import { refreshGoogleAccessToken, OAuthRefreshError } from '../src/connectors/oauth-refresh.js';
import { GDriveConnector } from '../src/connectors/gdrive.js';
import type { ConnectorContext } from '../src/connectors/types.js';

describe('TR-29 Google OAuth refresh', () => {
  it('exchanges a refresh token for an access token', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ access_token: 'new', expires_in: 120 }), { status: 200 })) as unknown as typeof fetch;
    const token = await refreshGoogleAccessToken({ refreshToken: 'r', clientId: 'c', clientSecret: 's', fetchImpl });
    expect(token.accessToken).toBe('new');
    expect(token.expiresAt).toBeGreaterThan(Date.now());
  });

  it('reports refresh failures with status', async () => {
    const fetchImpl = (async () => new Response('invalid_grant', { status: 400 })) as unknown as typeof fetch;
    await expect(refreshGoogleAccessToken({ refreshToken: 'r', clientId: 'c', clientSecret: 's', fetchImpl })).rejects.toBeInstanceOf(OAuthRefreshError);
  });

  it('refreshes on 401 and retries the Drive request', async () => {
    const auth: string[] = [];
    let calls = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls++;
      if (String(url).includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'fresh', expires_in: 3600 }), { status: 200 });
      auth.push((init?.headers as Record<string, string>).Authorization);
      if (calls === 1) return new Response('expired', { status: 401 });
      return new Response(JSON.stringify({ files: [{ id: 'f1', name: 'A', mimeType: 'text/plain' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const tools: Record<string, (input: Record<string, unknown>) => Promise<unknown>> = {};
    const ctx = {
      config: { accessToken: 'stale', refreshToken: 'r', clientId: 'c', clientSecret: 's' },
      registerTool: (name: string, _def: unknown, handler: (input: Record<string, unknown>) => Promise<unknown>) => { tools[name] = handler; },
    } as unknown as ConnectorContext;
    const c = new GDriveConnector(fetchImpl);
    await c.init(ctx);
    const result = await tools['gdrive_list_files']!({});
    expect(result).toMatchObject({ ok: true, files: [{ id: 'f1' }] });
    expect(auth).toEqual(['Bearer stale', 'Bearer fresh']);
  });
});
