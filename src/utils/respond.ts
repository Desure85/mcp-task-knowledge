// Unified helpers for MCP JSON responses
// Keep minimal types to avoid leaking MCP-specific types across modules
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
  };
};

/** Wrap an envelope in an MCP tool result (isError marks failures). */
export function json(envelope: OkEnvelope | ErrEnvelope, isError = false) {
  if (isError) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }], isError: true as const };
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }] };
}

/** Success envelope: { ok: true, data }. */
export const ok = <T = unknown>(data: T) => json({ ok: true, data } as OkEnvelope<T>);

/** Success envelope with sibling fields kept next to `data` (e.g. pagination). */
export const okWith = <T = unknown>(data: T, extra: Record<string, unknown>) =>
  json({ ok: true, data, ...extra } as OkEnvelope<T> & Record<string, unknown>);

/** Error envelope: { ok: false, error: { message } } with isError. */
export const err = (message: string) => json({ ok: false, error: { message } } as ErrEnvelope, true);

/** Error envelope with a stable code and an actionable hint. */
export const errWith = (error: ErrEnvelope['error']) =>
  json({ ok: false, error } as ErrEnvelope, true);
