import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createLogger, getRootLogger, mapMcpLogLevel, setLogLevel } from '../src/core/logger.js';
import { assertDistFresh } from './support/dist-guard.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

describe('SPEC-08 logging levels', () => {
  it('maps all MCP levels to pino and mutates the root logger', () => {
    createLogger();
    expect(mapMcpLogLevel('debug')).toBe('debug');
    expect(mapMcpLogLevel('notice')).toBe('info');
    expect(mapMcpLogLevel('warning')).toBe('warn');
    expect(mapMcpLogLevel('critical')).toBe('fatal');
    expect(mapMcpLogLevel('emergency')).toBe('fatal');
    expect(setLogLevel('warning')).toBe('warn');
    expect(getRootLogger()?.level).toBe('warn');
    expect(() => mapMcpLogLevel('verbose')).toThrow(/unsupported/);
  });

  it('advertises logging and accepts logging/setLevel over stdio', async () => {
    assertDistFresh();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-loglevel-'));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(process.cwd(), 'dist', 'index.js')],
      env: { ...process.env, DATA_DIR: dataDir, OBSIDIAN_VAULT_ROOT: path.join(dataDir, 'vault'), EMBEDDINGS_MODE: 'none', CATALOG_ENABLED: 'false' },
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (d) => process.stderr.write(`[spec08-server] ${String(d)}`));
    const client = new Client({ name: 'spec-08-logging', version: '0.0.1' });
    await client.connect(transport);
    cleanups.push(async () => {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
      fs.rmSync(dataDir, { recursive: true, force: true });
    });

    expect(client.getServerCapabilities()?.logging).toBeTruthy();
    await expect(client.setLoggingLevel('debug')).resolves.toBeDefined();
    await expect(client.setLoggingLevel('error')).resolves.toBeDefined();
  });
});
