/**
 * Auth tools registration — SEC-003 (pre-auth window from A-001).
 *
 * Registers the `mcp.authenticate` MCP tool. It is whitelisted in the
 * AuthManager pre-auth set, so it stays reachable on http/tcp transports
 * while every other tool is gated. The handler resolves the SDK session id
 * from the tool-call extra (Streamable HTTP populates it from the
 * Mcp-Session-Id header); stdio/unix callers fall back to 'local'.
 */

import { z } from 'zod';
import type { ServerContext } from './context.js';
import { ok, err } from '../utils/respond.js';
import type { GateExtra } from '../core/auth-gate.js';

export const AUTHENTICATE_TOOL = 'mcp.authenticate';

export const LOCAL_SESSION_FALLBACK = 'local';

export function resolveGateSessionId(sessionId: string | undefined): string {
  return sessionId ?? LOCAL_SESSION_FALLBACK;
}

export function registerAuthTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    AUTHENTICATE_TOOL,
    {
      title: 'Authenticate',
      description:
        'Authenticate this session with a token. Required before calling any other tool on http/tcp transports. Returns the authenticated userId and roles.',
      inputSchema: {
        token: z.string().min(1).describe('Authentication token (JWT or server-issued access token)'),
      },
    },
    async ({ token }: { token: string }, extra?: GateExtra) => {
      const auth = ctx.authManager;
      if (!auth) {
        return err('authentication not configured on this transport');
      }
      const sessionId = resolveGateSessionId(extra?.sessionId);
      try {
        const result = await auth.authenticate(sessionId, token);
        return ok({
          authenticated: true,
          userId: result.userId,
          roles: result.roles ?? [],
          sessionId,
        });
      } catch (e) {
        return err(e instanceof Error ? e.message : 'authentication failed');
      }
    },
  );
}
