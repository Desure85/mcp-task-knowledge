// Unified helpers for MCP JSON responses
// Keep minimal types to avoid leaking MCP-specific types across modules
export type OkEnvelope<T = any> = { ok: true; data: T };
export type ErrEnvelope = { ok: false; error: { message: string } };

export function json(envelope: OkEnvelope | ErrEnvelope, isError = false) {
  const resp: any = { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
  if (isError) (resp as any).isError = true;
  return resp;
}

export const ok = <T = any>(data: T) => json({ ok: true, data } as OkEnvelope<T>);
export const err = (message: string) => json({ ok: false, error: { message } } as ErrEnvelope, true);
