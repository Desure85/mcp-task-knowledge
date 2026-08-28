/**
 * health/endpoints.spec.ts — Tests for HTTP health endpoints (SCALE-001).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HealthChecker } from './checker.js';
import { createHealthHandlers, matchHealthEndpoint } from './endpoints.js';

function createMockReq(method = 'GET', url = '/'): IncomingMessage {
  return { method, url } as unknown as IncomingMessage;
}

function createMockRes(): ServerResponse & {
  _status: number;
  _body: string;
  _headers: Record<string, string>;
} {
  const mock = {
    _status: 0,
    _body: '',
    _headers: {} as Record<string, string>,
    writeHead(status: number, headers?: Record<string, string | number>) {
      this._status = status;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) this._headers[k] = String(v);
      }
    },
    end(body?: string) {
      if (body) this._body = body;
    },
  };
  return mock as any;
}

describe('SCALE-001: matchHealthEndpoint', () => {
  it('matches /healthz', () => {
    expect(matchHealthEndpoint('/healthz')).toBe('healthz');
    expect(matchHealthEndpoint('/healthz/')).toBe('healthz');
  });

  it('matches /readyz', () => {
    expect(matchHealthEndpoint('/readyz')).toBe('readyz');
    expect(matchHealthEndpoint('/readyz/')).toBe('readyz');
  });

  it('matches /drainz', () => {
    expect(matchHealthEndpoint('/drainz')).toBe('drainz');
    expect(matchHealthEndpoint('/drainz/')).toBe('drainz');
  });

  it('returns null for non-health URLs', () => {
    expect(matchHealthEndpoint('/api/docs')).toBeNull();
    expect(matchHealthEndpoint('/metrics')).toBeNull();
    expect(matchHealthEndpoint('/')).toBeNull();
  });

  it('strips query strings', () => {
    expect(matchHealthEndpoint('/healthz?verbose=1')).toBe('healthz');
    expect(matchHealthEndpoint('/readyz?check=all')).toBe('readyz');
  });
});

describe('SCALE-001: healthz endpoint', () => {
  let checker: HealthChecker;
  let handlers: ReturnType<typeof createHealthHandlers>;

  beforeEach(() => {
    checker = new HealthChecker();
    handlers = createHealthHandlers(checker);
  });

  it('returns 200 when healthy', async () => {
    const req = createMockReq('GET', '/healthz');
    const res = createMockRes();
    await handlers.healthz(req, res);
    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.status).toBe('healthy');
  });

  it('returns 503 when unhealthy', async () => {
    checker.register('db', () => ({ name: 'db', status: 'unhealthy', ready: false }));
    const req = createMockReq('GET', '/healthz');
    const res = createMockRes();
    await handlers.healthz(req, res);
    expect(res._status).toBe(503);
  });
});

describe('SCALE-001: readyz endpoint', () => {
  let checker: HealthChecker;
  let handlers: ReturnType<typeof createHealthHandlers>;

  beforeEach(() => {
    checker = new HealthChecker();
    handlers = createHealthHandlers(checker);
  });

  it('returns 200 when ready', async () => {
    checker.register('db', () => ({ name: 'db', status: 'healthy', ready: true }));
    const req = createMockReq('GET', '/readyz');
    const res = createMockRes();
    await handlers.readyz(req, res);
    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.ready).toBe(true);
    expect(body.components).toBeDefined();
  });

  it('returns 503 when not ready', async () => {
    checker.register('db', () => ({ name: 'db', status: 'healthy', ready: false }));
    const req = createMockReq('GET', '/readyz');
    const res = createMockRes();
    await handlers.readyz(req, res);
    expect(res._status).toBe(503);
  });

  it('returns 503 when draining', async () => {
    checker.register('db', () => ({ name: 'db', status: 'healthy', ready: true }));
    checker.startDraining();
    const req = createMockReq('GET', '/readyz');
    const res = createMockRes();
    await handlers.readyz(req, res);
    expect(res._status).toBe(503);
    const body = JSON.parse(res._body);
    expect(body.draining).toBe(true);
  });
});

describe('SCALE-001: drainz endpoint', () => {
  let checker: HealthChecker;
  let handlers: ReturnType<typeof createHealthHandlers>;

  beforeEach(() => {
    checker = new HealthChecker();
    handlers = createHealthHandlers(checker);
  });

  it('POST starts draining', async () => {
    const req = createMockReq('POST', '/drainz');
    const res = createMockRes();
    await handlers.drainz(req, res);
    expect(res._status).toBe(200);
    expect(checker.isDraining).toBe(true);
    const body = JSON.parse(res._body);
    expect(body.draining).toBe(true);
  });

  it('DELETE stops draining', async () => {
    checker.startDraining();
    const req = createMockReq('DELETE', '/drainz');
    const res = createMockRes();
    await handlers.drainz(req, res);
    expect(res._status).toBe(200);
    expect(checker.isDraining).toBe(false);
  });

  it('GET returns current drain status', async () => {
    const req = createMockReq('GET', '/drainz');
    const res = createMockRes();
    await handlers.drainz(req, res);
    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.draining).toBe(false);
  });
});
