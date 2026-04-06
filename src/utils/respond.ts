// Unified helpers for MCP JSON responses
// Keep minimal types to avoid leaking MCP-specific types across modules
export type OkEnvelope<T = unknown> = { ok: true; data: T };
export type ErrEnvelope = { ok: false; error: { message: string } };

export function json(envelope: OkEnvelope | ErrEnvelope, isError = false) {
  if (isError) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }], isError: true as const };
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }] };
}

export const ok = <T = unknown>(data: T) => json({ ok: true, data } as OkEnvelope<T>);
export const err = (message: string) => json({ ok: false, error: { message } } as ErrEnvelope, true);
