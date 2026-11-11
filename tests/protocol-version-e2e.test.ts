/**
 * SPEC-09 — protocol-version conformance e2e.
 *
 * Spawns the real server (dist/index.js) over stdio and inspects the raw
 * `initialize` result. A supported version must be echoed; an unsupported one
 * must negotiate down/up to the SDK's latest supported version. This is the
 * wire-level contract the Inspector checks only partially.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnTrackedServer, terminateServer } from './support/server-process.js';
import { assertDistFresh } from './support/dist-guard.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

assertDistFresh();

const DIST_ENTRY = path.join(process.cwd(), 'dist', 'index.js');

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

function initialize(requested: string): Promise<{ protocolVersion?: string; serverInfo?: { name?: string }; error?: unknown }> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-protocol-'));
  const child = spawnTrackedServer([DIST_ENTRY], {
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      EMBEDDINGS_MODE: 'none',
      CATALOG_ENABLED: 'false',
    },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  cleanups.push(async () => {
    await terminateServer(child);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`no initialize response for ${requested}`)), 10_000);
    child.stdout!.on('data', (chunk) => {
      buffer += chunk.toString();
      for (const line of buffer.split('\n')) {
        if (!line.trim()) continue;
        let message: { id?: number; result?: any; error?: unknown };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id !== 1) continue;
        clearTimeout(timer);
        resolve(message.result ?? { error: message.error });
      }
    });
    child.on('error', reject);
    child.stdin!.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: requested,
          capabilities: {},
          clientInfo: { name: 'spec-09', version: '0' },
        },
      }) + '\n',
    );
  });
}

describe('SPEC-09 protocol-version conformance', () => {
  it('echoes a supported protocol version', async () => {
    const result = await initialize('2024-11-05');
    expect(result.protocolVersion).toBe('2024-11-05');
    expect(result.serverInfo?.name).toBe('mcp-task-knowledge');
  });

  it('echoes the latest supported protocol version', async () => {
    const result = await initialize(LATEST_PROTOCOL_VERSION);
    expect(result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
  });

  it('negotiates an unknown version to the latest supported one', async () => {
    const result = await initialize('1900-01-01');
    expect(result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
  });
});
