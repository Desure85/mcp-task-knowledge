// Unified helpers for MCP JSON responses
// Keep minimal types to avoid leaking MCP-specific types across modules
export type OkEnvelope<T = unknown> = { ok: true; data: T };
export type ErrEnvelope = { ok: false; error: { message: string } };

/** Wrap an envelope in an MCP tool result (isError marks failures). */
export function json(envelope: OkEnvelope | ErrEnvelope, isError = false) {
  if (isError) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }], isError: true as const };
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }] };
}

/** Success envelope: { ok: true, data }. */
export const ok = <T = unknown>(data: T) => json({ ok: true, data } as OkEnvelope<T>);

/** Error envelope: { ok: false, error: { message } } with isError. */
export const err = (message: string) => json({ ok: false, error: { message } } as ErrEnvelope, true);
