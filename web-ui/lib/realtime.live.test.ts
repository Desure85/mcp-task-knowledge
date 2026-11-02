/**
 * Live realtime smoke: requires a running MCP server with /ws and a JWT secret.
 * Skipped unless MCP_LIVE_WS_URL is set.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { RealtimeClient } from './realtime';

const WS_URL = process.env.MCP_LIVE_WS_URL;
const API_URL = process.env.MCP_LIVE_URL;
const JWT_SECRET = process.env.MCP_LIVE_JWT_SECRET;
const maybe = WS_URL ? describe : describe.skip;

function mintJwt(secret: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const body = b64({ sub: 'rt-live', iat: now, exp: now + 600, roles: ['admin'] });
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 10_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = fn();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for realtime state');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

maybe('realtime live smoke', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: { href: 'http://127.0.0.1:3470/' },
      dispatchEvent: vi.fn(),
      sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    if (API_URL) process.env.NEXT_PUBLIC_MCP_API_URL = API_URL;
    if (JWT_SECRET) process.env.NEXT_PUBLIC_MCP_TOKEN = mintJwt(JWT_SECRET);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_MCP_TOKEN;
    delete process.env.NEXT_PUBLIC_MCP_API_URL;
  });

  it('reaches Live with a configured realtime socket', async () => {
    const client = new RealtimeClient({ url: WS_URL, project: 'mcp' });
    try {
      client.connect();
      const phase = await waitFor(() => {
        const p = client.getState().phase;
        return p === 'live' || p === 'offline' ? p : undefined;
      });
      expect(phase).toBe('live');
      expect(client.getStatus()).toBe('connected');
    } finally {
      client.disconnect();
    }
  }, 20_000);

  it('reports Disabled when realtime is not configured and /ws is unreachable', async () => {
    const client = new RealtimeClient({ url: '/ws', configured: false });
    try {
      client.connect();
      const phase = await waitFor(() => {
        const p = client.getState().phase;
        return p === 'disabled' || p === 'offline' ? p : undefined;
      });
      expect(phase).toBe('disabled');
    } finally {
      client.disconnect();
    }
  }, 20_000);
});
