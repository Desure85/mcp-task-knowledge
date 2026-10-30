/**
 * ws-ticket-route.ts — `POST /auth/ws-ticket` (UI-22, F-29).
 *
 * The browser authenticates with the usual `Authorization: Bearer <jwt>`
 * header (same token as MCP calls) and receives a random single-use ticket
 * for the WebSocket upgrade. The JWT never leaves the request body/header,
 * so it cannot leak into URL logs, proxy access logs or browser error text.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthManager } from '../core/auth.js';
import type { WsTicketStore } from '../core/ws-ticket.js';
import { childLogger } from '../core/logger.js';

const log = childLogger('transport:ws-ticket');

export const WS_TICKET_PATH = '/auth/ws-ticket';

export function isWsTicketPath(url: string): boolean {
  const path = url.split('?')[0];
  return path === WS_TICKET_PATH || path === `${WS_TICKET_PATH}/`;
}

export interface WsTicketRouteOptions {
  getAuth: () => AuthManager | undefined;
  store: WsTicketStore;
}

export type WsTicketHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
  });
  res.end(json);
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { ok: false, error: { code, message } });
}

function bearerToken(req: IncomingMessage): string {
  const header = String(req.headers.authorization ?? '');
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

export function createWsTicketHandler(options: WsTicketRouteOptions): WsTicketHandler {
  return async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } });
      return;
    }

    const auth = options.getAuth();
    const token = bearerToken(req);
    if (!auth || !token) {
      sendError(res, 401, 'UNAUTHENTICATED', 'Bearer token required');
      return;
    }

    // validateToken checks signature/expiry/blacklist but does not create a
    // session (AUD-15) — a ticket is a transport-level capability, not a login.
    const result = await auth.validateToken(token);
    if (!result) {
      sendError(res, 401, 'UNAUTHENTICATED', 'Invalid token');
      return;
    }

    const claims = (result.metadata?._jwt_claims ?? {}) as { jti?: unknown; exp?: unknown };
    const jti = typeof claims.jti === 'string' ? claims.jti : undefined;
    const exp = typeof claims.exp === 'number' ? claims.exp : undefined;
    const { ticket, expiresInSec } = options.store.issue({ userId: result.userId, jti, exp });

    log.info(
      { userId: result.userId, ip: req.socket.remoteAddress, expiresInSec, hasJti: Boolean(jti) },
      'ws ticket issued',
    );
    sendJson(res, 200, { ok: true, ticket, expiresInSec });
  };
}
