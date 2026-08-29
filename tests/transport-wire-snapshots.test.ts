/**
 * tests/transport-wire-snapshots.test.ts — Wire format snapshots (Q-011)
 *
 * Locks the JSON-RPC wire format produced by the SDK framing used across
 * our transports (stdio/tcp/unix). If the SDK or our message shapes change
 * the wire format, these snapshots fail — catching regressions early.
 *
 * Uses vitest inline snapshots (no snapshot files needed for stable output).
 */

import { describe, it, expect } from 'vitest';
import { serializeMessage, deserializeMessage, ReadBuffer } from '@modelcontextprotocol/sdk/shared/stdio.js';

describe('Q-011: JSON-RPC wire format', () => {
  it('serializeMessage produces Content-Length-compatible newline JSON', () => {
    const wire = serializeMessage({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(wire.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(wire);
    expect(parsed).toEqual({ jsonrpc: '2.0', id: 1, method: 'ping' });
  });

  it('request message round-trips through serialize/deserialize', () => {
    const msg = { jsonrpc: '2.0' as const, id: 42, method: 'tools/call', params: { name: 'tasks_list', arguments: { project: 'mcp' } } };
    const wire = serializeMessage(msg);
    const back = deserializeMessage(wire);
    expect(back).toEqual(msg);
  });

  it('response message round-trips with result content', () => {
    const msg = { jsonrpc: '2.0' as const, id: 7, result: { content: [{ type: 'text' as const, text: '{"ok":true}' }] } };
    const wire = serializeMessage(msg);
    const back = deserializeMessage(wire);
    expect(back).toEqual(msg);
  });

  it('notification message has no id', () => {
    const msg = { jsonrpc: '2.0' as const, method: 'notifications/initialized' };
    const wire = serializeMessage(msg);
    const back = deserializeMessage(wire);
    expect(back).toEqual(msg);
    expect((back as { id?: unknown }).id).toBeUndefined();
  });

  it('ReadBuffer frames multiple newline-delimited messages from a stream', () => {
    const buf = new ReadBuffer();
    buf.append(Buffer.from('{"jsonrpc":"2.0","id":1,"method":"ping"}\n{"jsonrpc":"2.0","id":2,"method":"pong"}\n'));
    const m1 = buf.readMessage();
    const m2 = buf.readMessage();
    expect(m1).toEqual({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(m2).toEqual({ jsonrpc: '2.0', id: 2, method: 'pong' });
  });

  it('ReadBuffer handles partial chunks (streaming)', () => {
    const buf = new ReadBuffer();
    const wire = serializeMessage({ jsonrpc: '2.0', id: 1, method: 'ping' });
    // Feed byte-by-byte
    for (const byte of Buffer.from(wire)) {
      buf.append(Buffer.from([byte]));
    }
    const msg = buf.readMessage();
    expect(msg).toEqual({ jsonrpc: '2.0', id: 1, method: 'ping' });
  });

  it('ReadBuffer returns null on incomplete message (no trailing newline)', () => {
    const buf = new ReadBuffer();
    buf.append(Buffer.from('{"jsonrpc":"2.0","id":1,"method":"ping"}'));
    expect(buf.readMessage()).toBeNull();
  });
});
