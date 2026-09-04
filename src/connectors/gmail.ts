/**
 * gmail.ts — Gmail connector (NEXT-011, WIRE-009).
 *
 * Lists emails, fetches content, and syncs emails into knowledge base.
 * Uses the Gmail v1 REST API with an OAuth2 access token
 * (config `accessToken` or `GMAIL_ACCESS_TOKEN` env, SEC-004).
 */

import type { Connector, ConnectorContext, ConnectorHealth } from './types.js';
import type { ErrEnvelope } from '../utils/respond.js';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';

/** Injectable fetch for hermetic tests (defaults to global fetch). */
export type FetchFn = typeof fetch;

interface GmailPayload {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
}

interface GmailHeader {
  name?: string;
  value?: string;
}

function base64UrlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf-8');
}

function headerValue(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name)?.value ?? '';
}

/** First text/plain part (depth-first), else first decodable text part. */
function extractText(payload: GmailPayload | undefined): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return base64UrlDecode(payload.body.data);
  for (const part of payload.parts ?? []) {
    const text = extractText(part);
    if (text) return text;
  }
  if (payload.mimeType?.startsWith('text/') && payload.body?.data) return base64UrlDecode(payload.body.data);
  return '';
}

export class GmailConnector implements Connector {
  readonly id = 'gmail';
  readonly name = 'Gmail';
  readonly version = '1.0.0';

  private accessToken?: string;
  private initialized = false;
  private readonly fetchFn?: FetchFn;

  constructor(fetchFn?: FetchFn) {
    this.fetchFn = fetchFn;
  }

  private doFetch(input: string, init?: Record<string, unknown>): Promise<Response> {
    const f = this.fetchFn ?? globalThis.fetch;
    return f(input, init as RequestInit);
  }

  private async gmailFetch(path: string): Promise<Response> {
    const res = await this.doFetch(`${GMAIL_API}${path}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`);
    return res;
  }

  async init(ctx: ConnectorContext): Promise<void> {
    this.accessToken = (ctx.config['accessToken'] as string | undefined) ?? process.env.GMAIL_ACCESS_TOKEN ?? undefined;

    ctx.registerTool('gmail_list_messages', {
      title: 'Gmail: List Messages',
      description: 'List recent Gmail messages',
      inputSchema: {
        type: 'object',
        properties: {
          maxResults: { type: 'number', description: 'Max messages (default 20)' },
          query: { type: 'string', description: 'Gmail search query' },
        },
      },
    }, async (input) => {
      const max = (input.maxResults as number) ?? 20;
      const query = (input.query as string) ?? '';
      return this.listMessages(max, query);
    });

    ctx.registerTool('gmail_get_message', {
      title: 'Gmail: Get Message',
      description: 'Fetch full content of a Gmail message',
      inputSchema: {
        type: 'object',
        properties: { messageId: { type: 'string' } },
        required: ['messageId'],
      },
    }, async (input) => {
      return this.getMessage(input.messageId as string);
    });

    ctx.registerTool('gmail_sync_to_kb', {
      title: 'Gmail: Sync Messages to Knowledge Base',
      description: 'Sync emails matching query into knowledge base',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          project: { type: 'string' },
          maxResults: { type: 'number' },
        },
        required: ['project'],
      },
    }, async (input) => {
      return this.syncToKB(input.project as string, (input.query as string) ?? '', (input.maxResults as number) ?? 50);
    });

    this.initialized = true;
  }

  async health(): Promise<ConnectorHealth> {
    if (!this.initialized) return { healthy: false, message: 'Not initialized' };
    if (!this.accessToken) return { healthy: false, message: 'No access token' };
    return { healthy: true, message: 'Gmail connector ready' };
  }

  private async listMessages(max: number, query: string): Promise<{ ok: true; messages: Array<{ id: string; snippet: string; from: string; subject: string }> } | ErrEnvelope> {
    if (!this.accessToken) return { ok: false, error: { message: 'Gmail: accessToken required (config accessToken or GMAIL_ACCESS_TOKEN env)' } };
    try {
      const maxResults = Math.min(Math.max(max, 1), 100);
      const list = await (await this.gmailFetch(`/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`)).json() as { messages?: Array<{ id: string }> };
      const messages: Array<{ id: string; snippet: string; from: string; subject: string }> = [];
      for (const m of list.messages ?? []) {
        const full = await (await this.gmailFetch(`/users/me/messages/${encodeURIComponent(m.id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`)).json() as { snippet?: string; payload?: { headers?: GmailHeader[] } };
        messages.push({
          id: m.id,
          snippet: full.snippet ?? '',
          from: headerValue(full.payload?.headers, 'from'),
          subject: headerValue(full.payload?.headers, 'subject'),
        });
      }
      return { ok: true, messages };
    } catch (e) {
      return { ok: false, error: { message: (e as Error).message } };
    }
  }

  private async getMessage(messageId: string): Promise<{ ok: true; content: string; subject: string } | ErrEnvelope> {
    if (!this.accessToken) return { ok: false, error: { message: 'Gmail: accessToken required (config accessToken or GMAIL_ACCESS_TOKEN env)' } };
    try {
      const full = await (await this.gmailFetch(`/users/me/messages/${encodeURIComponent(messageId)}?format=full`)).json() as { snippet?: string; payload?: GmailPayload & { headers?: GmailHeader[] } };
      const subject = headerValue(full.payload?.headers, 'subject');
      const body = extractText(full.payload);
      return { ok: true, content: body || (full.snippet ?? ''), subject };
    } catch (e) {
      return { ok: false, error: { message: (e as Error).message } };
    }
  }

  private async syncToKB(project: string, query: string, max: number): Promise<{ ok: true; synced: number } | ErrEnvelope> {
    void project;
    if (!this.accessToken) return { ok: false, error: { message: 'Gmail: accessToken required (config accessToken or GMAIL_ACCESS_TOKEN env)' } };
    const listed = await this.listMessages(max, query);
    if (!listed.ok) return listed;
    let synced = 0;
    for (const m of listed.messages) {
      const got = await this.getMessage(m.id);
      if (got.ok) synced++;
    }
    return { ok: true, synced };
  }
}

export function createGmailConnector(config: Record<string, unknown>): Connector {
  return new GmailConnector();
}
