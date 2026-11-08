/**
 * AC-04a — diagnostics for nested tool calls (`tools_run`, `tools_batch`).
 *
 * Both tools used to reduce a failed inner call to `error.message`: the original envelope's
 * `code`, `hint` and `details` were dropped, so a validation refusal came back as the string
 * "error" and nothing pointed at a server log line. Every inner call now gets a `requestId`,
 * the failure keeps the original error object, and the same `requestId` is written to the
 * server log — so a client can report the id and the operator can find the line without
 * journal access.
 */

import { randomUUID } from 'node:crypto';
import { childLogger } from './logger.js';

// Exported so tests can assert that a failure actually reaches the server log with its id.
export const diagnosticsLog = childLogger('tools-run');

/** The error part of an envelope, as published by `src/utils/respond.ts`. */
export interface InnerError {
  code?: string;
  message: string;
  hint?: string;
  details?: unknown;
}

export interface InnerCallResult {
  name: string;
  ok: boolean;
  /** Correlates this inner call with a server log line. */
  requestId: string;
  data?: unknown;
  /**
   * Failure message as a plain string. Kept exactly as before AC-04a so existing callers
   * (and every `error.includes(...)` check in the wild) keep working.
   */
  error?: string;
  /** The full original error envelope: code, message, hint, details. */
  errorEnvelope?: InnerError;
}

/** Recognise the error object of an envelope, tolerating hand-built string errors. */
export function normalizeInnerError(raw: unknown): InnerError {
  if (typeof raw === 'string') return { message: raw };
  if (raw && typeof raw === 'object') {
    const value = raw as Record<string, unknown>;
    const message = typeof value.message === 'string' ? value.message : JSON.stringify(value);
    const error: InnerError = { message };
    if (typeof value.code === 'string') error.code = value.code;
    if (typeof value.hint === 'string') error.hint = value.hint;
    if (value.details !== undefined) error.details = value.details;
    return error;
  }
  return { message: String(raw ?? 'error') };
}

interface ParsedEnvelope {
  ok: boolean;
  data?: unknown;
  error?: unknown;
}

/** Parse the tool result a gated handler returned into a small envelope view. */
export function parseInnerEnvelope(res: unknown): ParsedEnvelope {
  let payload: any = res;
  try {
    const text = (res as any)?.content?.[0]?.text;
    if (typeof text === 'string' && text.trim().length > 0) payload = JSON.parse(text);
  } catch {
    // Not JSON: the raw result becomes `data`, as before.
  }
  if (payload && typeof payload === 'object') {
    let ok = true;
    if (typeof payload.ok === 'boolean') ok = payload.ok === true;
    if (payload.isError === true) ok = false;
    const data = Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
    const error = Object.prototype.hasOwnProperty.call(payload, 'error') ? payload.error : undefined;
    return { ok, data, error };
  }
  return { ok: true, data: payload };
}

/** Build the result entry for one inner call, logging failures with their request id. */
export function innerResult(name: string, res: unknown): InnerCallResult {
  const requestId = randomUUID();
  const parsed = parseInnerEnvelope(res);
  if (parsed.ok) return { name, ok: true, requestId, data: parsed.data };
  const errorEnvelope = normalizeInnerError(parsed.error);
  diagnosticsLog.warn({ requestId, tool: name, code: errorEnvelope.code }, 'nested tool call failed');
  return { name, ok: false, requestId, error: errorEnvelope.message, errorEnvelope };
}

/** Build the result entry for a nested call that could not run at all (denied, missing, threw). */
export function innerFailure(name: string, cause: unknown, requestId = randomUUID()): InnerCallResult {
  const errorEnvelope = normalizeInnerError(cause);
  diagnosticsLog.warn({ requestId, tool: name, code: errorEnvelope.code }, 'nested tool call failed');
  return { name, ok: false, requestId, error: errorEnvelope.message, errorEnvelope };
}
