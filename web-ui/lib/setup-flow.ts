/**
 * UE-21: client helpers for the “connect an agent” flow.
 *
 * The setup link is redeemed by a same-origin server route so the browser
 * never needs CORS access to the MCP origin. The markdown document contains a
 * ready-to-copy config snippet; the token is only used for the connection
 * check.
 */

export interface SetupConfig {
  mcpServers: Record<string, { url?: string; headers?: Record<string, string>; command?: string; args?: string[] }>;
}

export interface SetupSnippet {
  markdown: string;
  config: SetupConfig;
  configText: string;
  token: string;
  url?: string;
  serverName: string;
}

export interface SetupCheck {
  ok: boolean;
  status?: number;
  server?: string;
  error?: string;
}

function firstServer(config: SetupConfig): { name: string; entry: SetupConfig['mcpServers'][string] } {
  const entries = Object.entries(config.mcpServers ?? {});
  if (entries.length === 0) throw new Error('The setup document has no mcpServers entry.');
  return { name: entries[0][0], entry: entries[0][1] };
}

/** Parse the fenced JSON client config from the setup markdown. */
export function parseSetupSnippet(markdown: string): SetupSnippet {
  const match = /```json\s*([\s\S]*?)```/i.exec(markdown);
  if (!match) throw new Error('The setup document has no JSON config snippet.');
  let config: SetupConfig;
  try {
    config = JSON.parse(match[1].trim()) as SetupConfig;
  } catch {
    throw new Error('The setup document contains invalid JSON.');
  }
  const { name, entry } = firstServer(config);
  const authorization = Object.entries(entry.headers ?? {}).find(([key]) => key.toLowerCase() === 'authorization')?.[1] ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('The setup document has no Bearer token.');
  return {
    markdown,
    config,
    configText: JSON.stringify(config, null, 2),
    token,
    url: entry.url,
    serverName: name,
  };
}

export async function redeemSetupLink(link: string): Promise<SetupSnippet> {
  const response = await fetch('/api/setup/redeem', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ link }),
    cache: 'no-store',
  });
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; markdown?: string; error?: string };
  if (!response.ok || !body.ok || typeof body.markdown !== 'string') {
    throw new Error(body.error || `Не удалось получить конфиг (${response.status}).`);
  }
  return parseSetupSnippet(body.markdown);
}

export async function checkSetupConnection(token: string): Promise<SetupCheck> {
  try {
    const response = await fetch('/api/setup/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      cache: 'no-store',
    });
    const body = (await response.json().catch(() => ({}))) as SetupCheck;
    if (!response.ok) return { ok: false, status: response.status, error: body.error || `HTTP ${response.status}` };
    return body;
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
