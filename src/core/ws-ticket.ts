/**
 * ws-ticket.ts — one-time, short-lived tickets for WebSocket authentication
 * (UI-22, F-29).
 *
 * Why a ticket instead of the JWT in the query string:
 *   - the JWT must never appear in a URL (proxy access logs, browser console
 *     error text, APM/log aggregators);
 *   - a ticket is random, single-use and expires in ~30 s, so if it leaks it
 *     cannot be replayed and is useless after the TTL;
 *   - the ticket is bound to the token subject and `jti`, so revoking the JWT
 *     (logout / `revokeByJti`) also invalidates tickets that were already
 *     issued for it.
 *
 * Storage is in-memory by design: a ticket only has to live for the duration
 * of a WS handshake between the HTTP request that issued it and the upgrade
 * on the same server process. Expired records are removed lazily on every
 * `issue()`/`redeem()` (plus a hard cap against unbounded growth).
 */

import { randomBytes } from 'node:crypto';

export const DEFAULT_WS_TICKET_TTL_MS = 30_000;
export const DEFAULT_WS_TICKET_MAX = 10_000;

export type WsTicketFailure = 'missing' | 'unknown' | 'expired' | 'revoked' | 'token_expired';

export interface WsTicketIssueInput {
  /** Authenticated subject (JWT `sub`). */
  userId: string;
  /** JWT id — used to re-check revocation at redemption. */
  jti?: string;
  /** JWT expiry in epoch seconds. */
  exp?: number;
}

export type WsTicketRedeemResult =
  | { ok: true; userId: string; jti?: string }
  | { ok: false; reason: WsTicketFailure };

interface TicketRecord extends WsTicketIssueInput {
  expiresAt: number;
}

export interface WsTicketStoreOptions {
  ttlMs?: number;
  /** Hard cap; oldest records are evicted first. */
  maxTickets?: number;
  /** Injectable clock (tests). */
  now?: () => number;
  /** Revocation probe for the ticket's jti (JwtValidator-backed deployments). */
  isRevoked?: (jti: string) => boolean;
}

export class WsTicketStore {
  private readonly ttlMs: number;
  private readonly maxTickets: number;
  private readonly now: () => number;
  private readonly isRevoked?: (jti: string) => boolean;
  private readonly tickets = new Map<string, TicketRecord>();

  constructor(options: WsTicketStoreOptions = {}) {
    this.ttlMs = Math.max(1_000, options.ttlMs ?? DEFAULT_WS_TICKET_TTL_MS);
    this.maxTickets = Math.max(1, options.maxTickets ?? DEFAULT_WS_TICKET_MAX);
    this.now = options.now ?? Date.now;
    this.isRevoked = options.isRevoked;
  }

  get size(): number {
    return this.tickets.size;
  }

  issue(input: WsTicketIssueInput): { ticket: string; expiresInSec: number } {
    this.sweep();
    while (this.tickets.size >= this.maxTickets) {
      const oldest = this.tickets.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.tickets.delete(oldest);
    }
    const ticket = randomBytes(32).toString('base64url');
    this.tickets.set(ticket, {
      userId: input.userId,
      ...(input.jti ? { jti: input.jti } : {}),
      ...(typeof input.exp === 'number' ? { exp: input.exp } : {}),
      expiresAt: this.now() + this.ttlMs,
    });
    return { ticket, expiresInSec: Math.ceil(this.ttlMs / 1000) };
  }

  /** Redeem exactly once. Every attempt burns the ticket, including failures. */
  redeem(ticket: string | null | undefined): WsTicketRedeemResult {
    if (!ticket) return { ok: false, reason: 'missing' };
    const record = this.tickets.get(ticket);
    if (!record) return { ok: false, reason: 'unknown' };
    this.tickets.delete(ticket);

    const nowMs = this.now();
    if (nowMs >= record.expiresAt) return { ok: false, reason: 'expired' };
    if (record.jti && this.isRevoked?.(record.jti)) return { ok: false, reason: 'revoked' };
    if (typeof record.exp === 'number' && record.exp * 1000 <= nowMs) {
      return { ok: false, reason: 'token_expired' };
    }
    return { ok: true, userId: record.userId, ...(record.jti ? { jti: record.jti } : {}) };
  }

  /** Drop expired records; returns how many were removed. */
  sweep(nowMs: number = this.now()): number {
    let removed = 0;
    for (const [ticket, record] of this.tickets) {
      if (record.expiresAt <= nowMs) {
        this.tickets.delete(ticket);
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.tickets.clear();
  }
}
