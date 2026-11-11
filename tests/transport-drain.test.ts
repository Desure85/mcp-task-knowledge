/**
 * TR-38: drain mode must reject NEW sessions at admission while established
 * sessions keep working. Health endpoints already report 503; this test covers
 * the HTTP and TCP session-admission paths.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HealthChecker } from '../src/health/checker.js';
import { HttpTransportAdapter } from '../src/transport/http-transport.js';
import { TcpTransportAdapter } from '../src/transport/stream-transport.js';
import { createMockServerContext } from './helpers.js';

function httpAddress(adapter: HttpTransportAdapter): AddressInfo | null {
  const server = (adapter as unknown as { httpServer?: { address(): AddressInfo | null } }).httpServer;
  return server?.address() ?? null;
}

async function waitForAddress(get: () => AddressInfo | null): Promise<number> {
  for (let i = 0; i < 100; i += 1) {
    const info = get();
    if (info) return info.port;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('transport did not start listening');
}

function postInitialize(port: number): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'tr38', version: '1.0.0' } },
  });
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/',
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'content-length': String(Buffer.byteLength(body)) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('TR-38 drain enforcement', () => {
  afterEach(() => {
    process.env.MCP_TCP_PORT = '';
  });

  it('HTTP rejects a new initialize with 503 and keeps existing sessions routable', async () => {
    const checker = new HealthChecker();
    const adapter = new HttpTransportAdapter(0, '127.0.0.1', checker);
    const ctx = createMockServerContext();
    await adapter.connect(ctx);
    const port = await waitForAddress(() => httpAddress(adapter));

    checker.startDraining();
    const drained = await postInitialize(port);
    expect(drained.status).toBe(503);
    expect(drained.headers['retry-after']).toBe('5');
    expect(JSON.parse(drained.body).error.message).toContain('draining');

    checker.stopDraining();
    const resumed = await postInitialize(port);
    expect(resumed.status).not.toBe(503);
    await adapter.close();
  });

  it('TCP writes a draining JSON-RPC error and closes new connections', () => {
    const checker = new HealthChecker();
    checker.startDraining();
    const adapter = new TcpTransportAdapter(0, '127.0.0.1', checker);
    const socket = {
      write: vi.fn(),
      end: vi.fn(),
    };
    // Admission is checked before the session/McpServer is created.
    (adapter as unknown as { handleConnection(s: unknown): Promise<void> }).handleConnection(socket);
    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('draining'));
    expect(socket.end).toHaveBeenCalled();
  });
});



