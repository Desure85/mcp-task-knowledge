/**
 * Auth gate — transport-aware fail-closed enforcement for tools/call (SEC-003, PROD-002).
 *
 * PROD-002 found: AuthManager existed but was never wired — http-transport
 * served tools/call with zero checks. This module is the single choke point:
 *
 *   - `decideToolCall()` — pure decision function (unit-testable, no I/O).
 *   - `wrapToolHandler()` — wraps an SDK tool callback with the gate.
 *   - `extractHttpCall()` — parses a JSON-RPC body into a gate input.
 *
 * Semantics (fail-closed):
 *   - Network transports (http/tcp) with NO AuthManager installed → DENY
 *     (misconfigured server must not serve tools to the network).
 *   - AuthManager with requireAuth=false (stdio/unix default) → ALLOW.
 *   - Pre-auth whitelist (`mcp.authenticate`, `tools/list`, `ping`) → ALLOW.
 *   - Authenticated session → ALLOW, everything else → DENY.
 *
 * Session identity comes from the SDK `extra.sessionId` (Streamable HTTP
 * populates it from the Mcp-Session-Id header) or the per-connection id
 * for TCP/Unix stream transports.
 */

import type { AuthManager } from './auth.js';

// ─── Types ──────────────────────────────────────────────────────────

/** Transports known to the gate. Unknown values normalize to 'stdio'. */
export type AuthGateTransport = 'stdio' | 'http' | 'tcp' | 'unix';

/** Input for a single gate decision. */
export interface AuthGateCall {
  /** Tool name for registerTool-gated calls (e.g. 'tasks_list', 'mcp.authenticate'). */
  toolName: string;
  /** SDK session id (Mcp-Session-Id header) or per-connection id. Undefined = unknown. */
  sessionId?: string;
}

/** Gate verdict. */
export type AuthGateDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

// ─── Transport helpers ──────────────────────────────────────────────

/**
 * Normalize a free-form transport string to a known gate transport.
 * Unknown/empty values fall back to 'stdio' (trusted local).
 */
export function normalizeGateTransport(value: string | undefined): AuthGateTransport {
  const v = (value ?? 'stdio').toLowerCase();
  if (v === 'http' || v === 'tcp' || v === 'unix') return v;
  return 'stdio';
}

/**
 * Whether the transport reaches the network (unauthenticated callers possible).
 * Only http/tcp are network transports; stdio/unix are trusted local pipes.
 */
export function isNetworkGateTransport(value: string | undefined): boolean {
  const t = normalizeGateTransport(value);
  return t === 'http' || t === 'tcp';
}

// ─── Decision ───────────────────────────────────────────────────────

/**
 * Decide whether a tool call is allowed.
 *
 * Pure function — no I/O, no logging side effects beyond the AuthManager
 * pre-hook path. Fail-closed: when in doubt, deny.
 *
 * @param auth — AuthManager installed on ServerContext (undefined = not wired).
 * @param transport — transport name (e.g. from MCP_TRANSPORT / AppContainer opts).
 * @param call — tool name + session id.
 */
export function decideToolCall(
  auth: AuthManager | undefined,
  transport: string | undefined,
  call: AuthGateCall,
): AuthGateDecision {
  const t = normalizeGateTransport(transport);

  // No gate installed: network transports fail closed, local pipes stay open.
  if (!auth) {
    if (t === 'http' || t === 'tcp') {
      return {
        allowed: false,
        reason: `authentication not configured for ${t} transport — fail-closed (SEC-003)`,
      };
    }
    return { allowed: true };
  }

  // Gate installed but auth not required (stdio/unix default) → allow all.
  if (!auth.isAuthRequired()) {
    return { allowed: true };
  }

  // Pre-auth window (A-001): mcp.authenticate must stay reachable.
  if (auth.isPreAuthMethod(call.toolName)) {
    return { allowed: true };
  }

  // Authenticated session → allow.
  if (call.sessionId !== undefined && auth.isAuthenticated(call.sessionId)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: 'authentication required — call mcp.authenticate first',
  };
}

// ─── Handler wrapper ────────────────────────────────────────────────

/** Minimal shape of the SDK request extra (we only need sessionId). */
export interface GateExtra {
  sessionId?: string;
  requestInfo?: { headers?: unknown };
}

/**
 * Resolve the session id from SDK extra: direct sessionId first, then the
 * Mcp-Session-Id request header (Streamable HTTP populates one or both
 * depending on SDK version). Undefined = unknown session (fail-closed).
 */
export function resolveExtraSessionId(extra?: GateExtra): string | undefined {
  if (extra?.sessionId) return extra.sessionId;
  const headers = extra?.requestInfo?.headers as
    | { get?: unknown; [key: string]: unknown }
    | undefined;
  if (!headers || typeof headers !== 'object') return undefined;
  if (typeof headers.get === 'function') {
    const v = (headers.get as (k: string) => string | string[] | null).call(headers, 'mcp-session-id');
    if (Array.isArray(v)) return v[0];
    return v ?? undefined;
  }
  const v = headers['mcp-session-id'] ?? headers['Mcp-Session-Id'];
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : undefined;
  return typeof v === 'string' ? v : undefined;
}

/**
 * Wrap an SDK tool callback with the auth gate.
 *
 * On deny, returns an MCP tool result with isError (same envelope style as
 * err() from utils/respond.ts, without importing it to keep core decoupled).
 * The gate decision is evaluated lazily per call so an AuthManager installed
 * after registration (AppContainer.init) still takes effect.
 */
export function wrapToolHandler<TArgs = unknown>(
  toolName: string,
  handler: (args: TArgs, extra?: GateExtra) => unknown,
  resolve: () => { auth: AuthManager | undefined; transport: string | undefined },
): (args: TArgs, extra?: GateExtra) => Promise<unknown> {
  return async (args: TArgs, extra?: GateExtra) => {
    const { auth, transport } = resolve();
    const decision = decideToolCall(auth, transport, {
      toolName,
      sessionId: resolveExtraSessionId(extra),
    });
    if (!decision.allowed) {
      const envelope = { ok: false as const, error: { message: decision.reason } };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(envelope) }],
        isError: true as const,
      };
    }
    return handler(args, extra);
  };
}

// ─── HTTP body parsing ──────────────────────────────────────────────

/** Parsed JSON-RPC call relevant to the gate. */
export interface HttpCallInfo {
  /** JSON-RPC method (e.g. 'tools/call', 'initialize', 'tools/list'). */
  method?: string;
  /** Tool name for tools/call (params.name). */
  toolName?: string;
  /** JSON-RPC id (for error responses). */
  id?: string | number | null;
}

/**
 * Extract gate-relevant info from a parsed Streamable-HTTP JSON-RPC body.
 * Returns null when the body is not a tools/call (no per-tool gate applies).
 */
export function extractHttpCall(body: unknown): HttpCallInfo | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  const rec = body as Record<string, unknown>;
  if (rec.method !== 'tools/call') {
    return { method: typeof rec.method === 'string' ? rec.method : undefined };
  }
  const params = rec.params as Record<string, unknown> | undefined;
  const toolName = params !== null && typeof params === 'object'
    ? (params as Record<string, unknown>).name
    : undefined;
  return {
    method: 'tools/call',
    toolName: typeof toolName === 'string' ? toolName : undefined,
    id: (rec.id as string | number | null) ?? null,
  };
}

/**
 * Build a JSON-RPC error payload for a denied tools/call.
 */
export function deniedJsonRpcBody(id: string | number | null | undefined, reason: string): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code: -32001, message: reason },
  });
}
