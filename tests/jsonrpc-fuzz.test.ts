/**
 * TR-04c: property-based fuzzing of the REAL JSON-RPC ingest path (Q-008, rewritten).
 *
 * What was wrong before: the file fuzzed a `normalizeEnvelope` copy-pasted into the
 * test (`git grep normalizeEnvelope src/` is empty — no such function exists in the
 * product), and its property `threw || result !== undefined` was unconditionally
 * true. Nothing in `src/` could break it.
 *
 * What is exercised now — the path a hostile HTTP body actually takes:
 *   HttpTransportAdapter.handleRequest   src/transport/http-transport.ts:381-425
 *     readBodyWithCap -> JSON.parse (failure keeps the raw string) -> authorizeHttpCall
 *     -> SDK StreamableHTTP transport -> JSON-RPC error
 *   authorizeHttpCall / extractHttpCall / deniedJsonRpcBody
 *                                        src/core/auth-gate.ts:242-270, 330, 352
 *
 * Property: for an arbitrary body — with and without a live session — the server
 *   1. never answers 5xx,
 *   2. answers with a valid JSON-RPC 2.0 envelope (or an empty 202 for notifications),
 *   3. never leaks a stack frame or an absolute repo path,
 *   4. rejects with a protocol code from the declared set,
 *   5. keeps the SAME keep-alive connection usable for the next valid request.
 *
 * Observed contract on master (2026-11-07, see docs/dev-cycle/decisions/…-tr-04c.md):
 *   session + malformed JSON -> 400 / -32700 Parse error
 *   no session + malformed   -> 400 / -32000 "No valid session ID"  (spec would say -32700;
 *                               recorded as a deviation, not fixed here — src/ is out of scope)
 *   unknown method / nameless tools/call, no auth configured -> 401 / -32001 fail-closed
 *   empty batch []            -> 202 with an empty body
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import { Agent, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';

// config.ts resolves DATA_DIR at module load; must be set before the dynamic imports.
const TMP = path.join(os.tmpdir(), `tr04c-fuzz-${process.pid}-${Date.now()}`);
process.env.DATA_DIR = TMP;
process.env.EMBEDDINGS_MODE = 'none';
process.env.CATALOG_ENABLED = 'false';

/** Spec codes plus the two documented non-spec rejections this server emits. */
const ALLOWED_ERROR_CODES = [-32700, -32600, -32601, -32602, -32000, -32001];
const ALLOWED_STATUSES = [200, 202, 400, 401, 413];

const INIT_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'tr04c-fuzz', version: '0.0.0' },
  },
});
const PING_BODY = JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'ping' });

interface RawResponse {
  status: number;
  body: string;
  socketPort?: number;
  sessionId?: string;
}

function waitForListening(server: import('node:http').Server): Promise<void> {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
}

describe('JSON-RPC ingest fuzzing (real transport)', () => {
  let adapter: { close: () => Promise<void> } | undefined;
  let port = 0;
  let sessionId = '';
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });

  function post(body: string, sid?: string): Promise<RawResponse> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/',
          method: 'POST',
          agent,
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'content-length': Buffer.byteLength(body),
            ...(sid ? { 'mcp-session-id': sid } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk as Buffer));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf-8'),
              socketPort: res.socket?.localPort,
              sessionId: res.headers['mcp-session-id'] as string | undefined,
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  }

  beforeAll(async () => {
    await fsp.mkdir(TMP, { recursive: true });
    const { createServerContext } = await import('../src/register/setup.js');
    const { defaultRegistration } = await import('../src/core/app-container.js');
    const { HttpTransportAdapter } = await import('../src/transport/http-transport.js');

    const ctx = await createServerContext();
    await defaultRegistration(ctx);

    const real = new HttpTransportAdapter(0, '127.0.0.1');
    await real.connect(ctx);
    adapter = real;

    const httpServer = (real as unknown as { httpServer: import('node:http').Server }).httpServer;
    await waitForListening(httpServer);
    port = (httpServer.address() as AddressInfo).port;

    const init = await post(INIT_BODY);
    expect(init.status).toBe(200);
    // The session id comes from the response header, not the body.
    sessionId = init.sessionId ?? '';
    expect(sessionId).not.toBe('');
  }, 120000);

  afterAll(async () => {
    agent.destroy();
    await adapter?.close().catch(() => undefined);
    await fsp.rm(TMP, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  });

  function assertEnvelope(res: RawResponse): void {
    expect(ALLOWED_STATUSES).toContain(res.status);
    expect(res.status).toBeLessThan(500);
    expect(res.body).not.toContain(process.cwd());
    expect(res.body).not.toContain('node_modules');
    expect(res.body).not.toMatch(/\n\s+at\s+\S+:\d+:\d+/);

    if (res.body.length === 0) {
      // Only a notification/empty-batch acknowledgement may have no body.
      expect(res.status).toBe(202);
      return;
    }

    const parsed = JSON.parse(res.body) as { jsonrpc?: unknown; error?: { code?: unknown } };
    expect(parsed.jsonrpc).toBe('2.0');
    if (parsed.error !== undefined) {
      expect(ALLOWED_ERROR_CODES).toContain(parsed.error.code);
    }
  }

  async function assertAlive(socketPort: number | undefined): Promise<void> {
    const alive = await post(PING_BODY, sessionId);
    expect(alive.status).toBe(200);
    expect(JSON.parse(alive.body).result).toBeDefined();
    // Same keep-alive socket: proves the hostile request did not kill the connection.
    expect(alive.socketPort).toBe(socketPort);
  }

  const HOSTILE = [
    '',
    'not json {',
    '{"jsonrpc":"2.0"}',
    '[]',
    '{}',
    'null',
    '{"jsonrpc":"2.0","id":1,"method":"nope"}',
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{}}',
    '{"jsonrpc":"2.0","id":{"a":1},"method":"ping"}',
    '{"__proto__":{"polluted":true}}',
  ];

  it('rejects the observed malformed payloads with a protocol error, not a crash', async () => {
    const expectations: Array<[string, string | undefined, number[]]> = [
      ['not json {', sessionId, [400]],
      ['not json {', undefined, [400]],
      ['', sessionId, [400]],
      ['[]', sessionId, [202, 400]],
      ['{"jsonrpc":"2.0"}', sessionId, [400]],
    ];
    for (const [body, sid, statuses] of expectations) {
      const res = await post(body, sid);
      assertEnvelope(res);
      expect(statuses, `body=${JSON.stringify(body)} sid=${sid ?? 'none'}`).toContain(res.status);
      if (res.body.length > 0) {
        const parsed = JSON.parse(res.body) as { result?: unknown; error?: { code?: number } };
        // A parse-class rejection: -32700 (spec) or -32000 (sessionless on this server).
        expect([-32700, -32000, -32600]).toContain(parsed.error?.code);
        expect(parsed.result).toBeUndefined();
      }
      await assertAlive(res.socketPort);
    }
  }, 60000);

  it('arbitrary bodies never crash, never leak, never kill the session', async () => {
    const payload = fc.oneof(
      { weight: 4, arbitrary: fc.string({ maxLength: 300 }) },
      { weight: 4, arbitrary: fc.jsonValue().map((v) => JSON.stringify(v) ?? '') },
      { weight: 2, arbitrary: fc.constantFrom(...HOSTILE) },
    );

    // Fixed seed keeps the mutation matrix reproducible; RED must also hold on
    // a different seed (verified in the matrix run), the seed is not a crutch.
    await fc.assert(
      fc.asyncProperty(payload, async (body) => {
        const withSession = await post(body, sessionId);
        assertEnvelope(withSession);
        await assertAlive(withSession.socketPort);

        const withoutSession = await post(body, undefined);
        assertEnvelope(withoutSession);
        await assertAlive(withoutSession.socketPort);
      }),
      { numRuns: 60, seed: 20261107, endOnFailure: true },
    );
  }, 180000);
});
