/**
 * Request-scoped context — per-call data carried via AsyncLocalStorage (PH-004).
 *
 * wrapToolHandler() sets the caller's session id for the duration of every
 * tool invocation, so deep helpers (resolveProject and friends) can resolve
 * session-scoped state without threading `extra` through 100+ handlers.
 *
 * Empty store = no session context (stdio calls before authenticate, direct
 * in-process calls, tests).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestScope {
  /** Session id of the caller (SDK session id / per-connection id / 'local'). */
  sessionId?: string;
}

export const requestScope = new AsyncLocalStorage<RequestScope>();

/** Session id of the currently executing tool call, if any. */
export function currentSessionId(): string | undefined {
  return requestScope.getStore()?.sessionId;
}
