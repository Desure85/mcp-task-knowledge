// Unified helpers for MCP JSON responses
// Keep minimal types to avoid leaking MCP-specific types across modules
import { currentRequestStartedAt } from '../core/request-context.js';

export type OkEnvelope<T = unknown> = { ok: true; data: T };
export type ErrEnvelope = {
  ok: false;
  error: {
    message: string;
    /** Stable machine-readable code (e.g. TASK_CLAIMED). */
    code?: string;
    /** Suggested next step for the caller. */
    hint?: string;
    /** Structured context (holder, expiry, conflicts, ...). */
    details?: unknown;
    /** Flat transition context (V-02); also mirrored inside `details`. */
    from?: string;
    to?: string;
    allowed?: string[];
    taskIds?: string[];
  };
};

/**
 * AC-03: every envelope carries `meta.ms` — how long the tool call has been running.
 *
 * The start time comes from the request scope (`wrapToolHandler` records it), so the number
 * is measured at the same place the call was dispatched, not from a per-handler timer. Calls
 * outside a tool invocation (startup, direct unit calls) report `0`, which keeps the field
 * monotonic and non-negative instead of inventing a duration.
 */
function metaOf(): { ms: number } {
  const startedAt = currentRequestStartedAt();
  const ms = typeof startedAt === 'number' ? Math.max(0, Date.now() - startedAt) : 0;
  return { ms };
}

/** Wrap an envelope in an MCP tool result (isError marks failures). */
export function json(envelope: OkEnvelope | ErrEnvelope, isError = false) {
  const existingMeta = (envelope as { meta?: Record<string, unknown> }).meta ?? {};
  const withMeta = { ...envelope, meta: { ...existingMeta, ms: metaOf().ms } };
  if (isError) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(withMeta, null, 2) }], isError: true as const };
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(withMeta, null, 2) }] };
}

/** Success envelope: { ok: true, data }. */
export const ok = <T = unknown>(data: T) => json({ ok: true, data } as OkEnvelope<T>);

/** Success envelope with sibling fields kept next to `data` (e.g. pagination). */
export const okWith = <T = unknown>(data: T, extra: object) =>
  json({ ok: true, data, ...extra } as OkEnvelope<T> & Record<string, unknown>);

/** Error envelope: { ok: false, error: { message } } with isError. */
export const err = (message: string) => json({ ok: false, error: { message } } as ErrEnvelope, true);

/** Error envelope with a stable code and an actionable hint. */
export const errWith = (error: ErrEnvelope['error']) =>
  json({ ok: false, error } as ErrEnvelope, true);
