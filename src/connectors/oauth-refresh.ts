/** TR-29: Google OAuth2 refresh-token grant for connectors. */
export interface GoogleRefreshConfig {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  tokenUrl?: string;
  fetchImpl?: typeof fetch;
}

export class OAuthRefreshError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'OAuthRefreshError';
  }
}

export interface RefreshedToken { accessToken: string; expiresAt: number }

export async function refreshGoogleAccessToken(config: GoogleRefreshConfig): Promise<RefreshedToken> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: config.refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  const res = await fetchImpl(config.tokenUrl ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new OAuthRefreshError(res.status, `OAuth refresh failed: HTTP ${res.status} ${text.slice(0, 200)}`.trim());
  let data: { access_token?: string; expires_in?: number };
  try { data = JSON.parse(text) as typeof data; } catch { throw new OAuthRefreshError(0, 'OAuth refresh returned invalid JSON'); }
  if (!data.access_token) throw new OAuthRefreshError(0, 'OAuth refresh returned no access_token');
  const expiresIn = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600;
  return { accessToken: data.access_token, expiresAt: Date.now() + expiresIn * 1000 };
}
