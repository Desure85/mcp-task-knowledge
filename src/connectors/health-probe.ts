/**
 * TR-31 — real health probes for token-based connectors.
 *
 * `!!token` only proves that a credential exists. These probes make the cheapest
 * authenticated read the provider offers and report a revoked/expired token as
 * unhealthy. The default connector timeout (TR-33) bounds the probe.
 */
import type { ConnectorHealth } from './types.js';
import { connectorSignal } from './fetch-timeout.js';

export interface ProbeOptions {
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: string;
  /** Probe timeout; defaults to CONNECTOR_TIMEOUT_MS / 10s. */
  timeoutMs?: number;
}

/** Run a probe and map HTTP/network failures to ConnectorHealth. Never throws. */
export async function probeConnector(
  url: string,
  okMessage: string,
  options: ProbeOptions = {},
): Promise<ConnectorHealth> {
  try {
    const res = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      signal: connectorSignal(options.timeoutMs),
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 200);
      } catch {
        // body unavailable — status alone is enough
      }
      return {
        healthy: false,
        message: `${okMessage}: HTTP ${res.status}${detail ? ` ${detail}` : ''}`,
      };
    }
    return { healthy: true, message: okMessage };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { healthy: false, message: `${okMessage}: ${message}` };
  }
}
