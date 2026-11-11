/**
 * Shared connector HTTP timeout (TR-33).
 *
 * Connectors used bare fetch; a stalled remote could pin a tool call for the
 * undici headers timeout (~300 s). Every connector now passes this signal.
 */

export const DEFAULT_CONNECTOR_TIMEOUT_MS = 10_000;

export function connectorTimeoutFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.CONNECTOR_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CONNECTOR_TIMEOUT_MS;
}

export function connectorSignal(timeoutMs: number = connectorTimeoutFromEnv()): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}
