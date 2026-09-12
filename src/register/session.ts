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
import { resolveExtraSessionId, type GateExtra } from '../core/auth-gate.js';

/** AUD-04: caller roles from session metadata (set by AuthManager.authenticate). */
function callerRoles(ctx: ServerContext, callerSessionId: string | undefined): string[] {
  if (!callerSessionId) return [];
  const meta = ctx.sessionManager?.get(callerSessionId)?.metadata;
  const roles = meta?.roles;
  return Array.isArray(roles) ? roles.filter((r): r is string => typeof r === 'string') : [];
}

function isAdmin(ctx: ServerContext, callerSessionId: string | undefined): boolean {
  return callerRoles(ctx, callerSessionId).includes('admin');
}

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
    async ({ sessionId }: { sessionId: string }, extra?: GateExtra) => {
      const sm = ctx.sessionManager;

      if (!sm) {
        return ok({
          available: false,
          reason: 'SessionManager not initialized — session management is only available for multi-client transports (TCP, HTTP).',
          sessionsEnabled: false,
        });
      }

      const callerId = resolveExtraSessionId(extra);
      const target = sm.get(sessionId);
      if (callerId !== sessionId && target && !isAdmin(ctx, callerId)) {
        return err('access denied — session_info is restricted to the calling session or admin role');
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
    async (_args: Record<string, never>, extra?: GateExtra) => {
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

      const callerId = resolveExtraSessionId(extra);
      if (!isAdmin(ctx, callerId)) {
        return err('access denied — session_list requires admin role');
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

  // ── admin_setup_link (DX-29) ──────────────────────
  // Create a one-time setup link for agent self-configuration.
  ctx.server.registerTool(
    "admin_setup_link",
    {
      title: "Create Setup Link",
      description: "Create a one-time setup link (TTL ~15min) that reveals a markdown document with server URL, transport, a scoped access token, and self-config instructions for an AI agent. Requires admin role. The link can be redeemed exactly once via GET /.well-known/mcp-setup/<otp>.",
      inputSchema: {
        project: z.string().min(1).optional().describe("Project scope for the issued token (default: current project)"),
        role: z.string().min(1).optional().describe("Role scope for the issued token (default: 'agent')"),
        ttlMs: z.number().int().positive().max(3_600_000).optional().describe("Link TTL in ms (default: 900000 = 15min, max 1h)"),
        baseUrl: z.string().url().optional().describe("Public base URL for the setup link (default: http://localhost:MCP_PORT)"),
      },
    },
    async (args: { project?: string; role?: string; ttlMs?: number; baseUrl?: string }, extra?: GateExtra) => {
      const store = ctx.setupLinkStore;
      if (!store) {
        return err('setup links unavailable — no token issuer configured (requires TokenManager or JWT_SECRET)');
      }
      const callerId = resolveExtraSessionId(extra);
      if (!isAdmin(ctx, callerId)) {
        return err('access denied — admin_setup_link requires admin role');
      }
      const { getCurrentProject } = await import('../config.js');
      const link = await store.create({
        project: args.project ?? getCurrentProject(),
        role: args.role ?? 'agent',
        ttlMs: args.ttlMs,
        createdBy: callerId ?? 'local',
      });
      const base = args.baseUrl ?? `http://localhost:${process.env.MCP_PORT || '3001'}`;
      return ok({
        url: `${base}/.well-known/mcp-setup/${link.otp}`,
        expiresAt: new Date(link.expiresAt).toISOString(),
        otp: link.otp,
        project: link.project,
        role: link.role,
      });
    }
  );
}