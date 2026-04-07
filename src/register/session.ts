/**
 * Session tools registration — S-004
 *
 * Registers MCP tools for inspecting session state:
 *   - session_info: query session details (rate limit, TTL, idle, age)
 *   - session_list: list all active sessions (admin/debug utility)
 *
 * Both tools read SessionManager and RateLimiter from ServerContext
 * (set lazily by AppContainer after init). Tools gracefully degrade when
 * sessionManager is not available (e.g. stdio single-client mode).
 */

import { z } from "zod";
import type { ServerContext } from './context.js';
import type { SessionInfo } from '../core/session-manager.js';
import type { RateLimitInfo } from '../core/rate-limiter.js';
import { ok, err } from '../utils/respond.js';

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Build a session detail payload by combining SessionManager and RateLimiter data.
 */
function buildSessionDetail(
  session: SessionInfo,
  rateLimitInfo: RateLimitInfo | undefined,
): Record<string, unknown> {
  const detail: Record<string, unknown> = {
    sessionId: session.id,
    remote: session.remote,
    createdAt: session.createdAt,
    lastActivityAt: session.lastActivityAt,
    ageMs: session.ageMs,
    idleMs: session.idleMs,
    ttlRemainingMs: session.ttlRemainingMs ?? null,
    expiresAt: session.expiresAt ?? null,
  };

  if (rateLimitInfo) {
    detail.rateLimit = {
      remaining: rateLimitInfo.remaining,
      maxTokens: rateLimitInfo.maxTokens,
      refillPerSec: rateLimitInfo.refillPerSec,
      retryAfterSec: rateLimitInfo.retryAfterSec,
    };
  } else {
    detail.rateLimit = null;
  }

  if (session.metadata && Object.keys(session.metadata).length > 0) {
    detail.metadata = session.metadata;
  }

  return detail;
}

// ─── Registration ─────────────────────────────────────────────────────

export function registerSessionTools(ctx: ServerContext): void {
  // ── session_info ────────────────────────────────────
  // Query session details: rate limit, TTL, idle, age, etc.
  ctx.server.registerTool(
    "session_info",
    {
      title: "Session Info",
      description: "Query session state for a specific session ID. Returns rate limit info, TTL, idle timeout, session age, and creation time. If SessionManager is not available (e.g. stdio mode), returns availability status only.",
      inputSchema: {
        sessionId: z.string().min(1).describe("Session ID to query (UUID v4)"),
      },
    },
    async ({ sessionId }: { sessionId: string }) => {
      const sm = ctx.sessionManager;

      if (!sm) {
        return ok({
          available: false,
          reason: 'SessionManager not initialized — session management is only available for multi-client transports (TCP, HTTP).',
          sessionsEnabled: false,
        });
      }

      const session = sm.get(sessionId);
      if (!session) {
        return err(`Session not found: ${sessionId}`);
      }

      const rateLimitInfo = ctx.rateLimiter?.getInfo(sessionId);

      return ok({
        available: true,
        sessionsEnabled: true,
        rateLimitingEnabled: ctx.rateLimiter != null,
        ...buildSessionDetail(session, rateLimitInfo),
      });
    }
  );

  // ── session_list ────────────────────────────────────
  // List all active sessions (admin/debug utility)
  ctx.server.registerTool(
    "session_list",
    {
      title: "Session List",
      description: "List all active sessions with their state. Returns session count, rate limiting status, and per-session details (rate limit, TTL, idle, age). If SessionManager is not available, returns availability status only.",
      inputSchema: {},
    },
    async () => {
      const sm = ctx.sessionManager;

      if (!sm) {
        return ok({
          available: false,
          reason: 'SessionManager not initialized — session management is only available for multi-client transports (TCP, HTTP).',
          sessionsEnabled: false,
          total: 0,
          sessions: [],
        });
      }

      const sessions = sm.getAll();

      // Build enriched session list with rate limit info
      const enriched = sessions.map((session) => {
        const rateLimitInfo = ctx.rateLimiter?.getInfo(session.id);
        return buildSessionDetail(session, rateLimitInfo);
      });

      return ok({
        available: true,
        sessionsEnabled: true,
        rateLimitingEnabled: ctx.rateLimiter != null,
        total: sessions.length,
        sessions: enriched,
      });
    }
  );
}
