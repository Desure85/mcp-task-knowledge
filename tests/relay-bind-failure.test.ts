/**
 * BM-012: the LAN relay is optional — a taken WebSocket port must disable it
 * instead of crashing the whole MCP server with an unhandled 'error' event.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import net from 'node:net';
import { RelayManager } from '../src/relay/relay-manager.js';

async function occupyPort(): Promise<{ port: number; release: () => Promise<void> }> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  expect(port).toBeGreaterThan(0);
  return {
    port,
    release: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
  };
}

describe('BM-012: relay port bind failure', () => {
  let relay: RelayManager | undefined;
  let occupied: { port: number; release: () => Promise<void> } | undefined;

  afterEach(async () => {
    relay?.stop();
    relay = undefined;
    await occupied?.release();
    occupied = undefined;
  });

  it('disables the relay instead of crashing when the port is taken', async () => {
    occupied = await occupyPort();
    relay = new RelayManager({ port: occupied.port, sharedKey: 'bind-test' });

    expect(() => relay!.start()).not.toThrow();
    await vi.waitFor(() => expect(relay!.enabled).toBe(false), { timeout: 5000 });

    const status = relay!.status();
    expect(status.enabled).toBe(false);
    expect(status.port).toBe(occupied.port);
    expect(status.connections).toBe(0);
    expect(relay!.shareBrief({ probe: true })).toEqual({ sent: 0 });
  });


});
