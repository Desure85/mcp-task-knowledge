/**
 * health/endpoints.ts — HTTP health endpoint handlers (SCALE-001).
 *
 * Provides HTTP handlers for Kubernetes probes:
 *   GET /healthz — liveness probe (200 if alive, 503 if unhealthy)
 *   GET /readyz  — readiness probe (200 if ready, 503 if not ready)
 *   POST /drainz — start draining (stop accepting new sessions)
 *   DELETE /drainz — stop draining (resume accepting new sessions)
 *
 * Usage:
 *   const checker = new HealthChecker();
 *   const handlers = createHealthHandlers(checker);
 *   // In HTTP server:
 *   if (url === '/healthz') return handlers.healthz(req, res);
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HealthChecker } from './checker.js';
import type { HealthCheckResult } from './types.js';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

export interface HealthHandlers {
  /** GET /healthz — liveness probe. */
  healthz: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  /** GET /readyz — readiness probe. */
  readyz: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  /** POST /drainz — start draining. */
  drainz: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}

export function createHealthHandlers(checker: HealthChecker): HealthHandlers {
  return {
    async healthz(_req, res) {
      try {
        const alive = await checker.liveness();
        const result: Pick<HealthCheckResult, 'status' | 'uptimeMs' | 'timestamp'> = {
          status: alive ? 'healthy' : 'unhealthy',
          uptimeMs: Date.now() - (checker as any).startedAt,
          timestamp: new Date().toISOString(),
        };
        sendJson(res, alive ? 200 : 503, result);
      } catch (err) {
        sendJson(res, 503, { status: 'unhealthy', error: String(err) });
      }
    },

    async readyz(_req, res) {
      try {
        const result = await checker.check();
        sendJson(res, result.ready ? 200 : 503, result);
      } catch (err) {
        sendJson(res, 503, { status: 'unhealthy', error: String(err) });
      }
    },

    async drainz(req, res) {
      if (req.method === 'POST') {
        checker.startDraining();
        sendJson(res, 200, {
          draining: true,
          message: 'drain mode activated — no new sessions will be accepted',
        });
      } else if (req.method === 'DELETE') {
        checker.stopDraining();
        sendJson(res, 200, {
          draining: false,
          message: 'drain mode deactivated — accepting new sessions',
        });
      } else {
        // GET — return current drain status
        sendJson(res, 200, {
          draining: checker.isDraining,
        });
      }
    },
  };
}

/**
 * Check if a URL matches a health endpoint.
 * Returns the endpoint name or null.
 */
export function matchHealthEndpoint(url: string): 'healthz' | 'readyz' | 'drainz' | null {
  // Strip query string
  const path = url.split('?')[0];
  if (path === '/healthz' || path === '/healthz/') return 'healthz';
  if (path === '/readyz' || path === '/readyz/') return 'readyz';
  if (path === '/drainz' || path === '/drainz/') return 'drainz';
  return null;
}
