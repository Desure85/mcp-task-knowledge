import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { DATA_DIR } from '../src/config.js';
import { runHealthGate, inspectClientConfigs } from '../src/cli/health.js';

function tempDir(): string {
  return fs.mkdtempSync(path.join(DATA_DIR, '.tmp-dx11-'));
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const validConfig = { ok: true, source: 'test' };

describe('DX-11: doctor health gate', () => {
  it('rejects Node older than 20 and accepts 20+', async () => {
    const dir = tempDir();
    const old = await runHealthGate({ nodeVersion: '18.19.0', dataDir: dir, reloadConfig: () => validConfig, clientConfigPaths: [] });
    expect(old.ok).toBe(false);
    expect(old.checks.find((check) => check.name === 'node')?.ok).toBe(false);

    const modern = await runHealthGate({ nodeVersion: '22.12.0', dataDir: dir, reloadConfig: () => validConfig, clientConfigPaths: [] });
    expect(modern.checks.find((check) => check.name === 'node')?.ok).toBe(true);
  });

  it('reports a missing unwritable DATA_DIR as an error', async () => {
    const missing = await runHealthGate({
      dataDir: path.join(tempDir(), 'missing'),
      reloadConfig: () => validConfig,
      clientConfigPaths: [],
    });
    expect(missing.ok).toBe(false);
    expect(missing.checks.find((check) => check.name === 'data-dir')?.detail).toMatch(/does not exist/);
  });

  it('treats no file config as valid defaults and a broken config as an error', async () => {
    const dir = tempDir();
    const defaults = await runHealthGate({
      dataDir: dir,
      reloadConfig: () => ({ ok: false, error: 'no config source', source: 'none' }),
      clientConfigPaths: [],
    });
    expect(defaults.checks.find((check) => check.name === 'config')?.ok).toBe(true);

    const broken = await runHealthGate({
      dataDir: dir,
      reloadConfig: () => ({ ok: false, error: 'bad JSON', source: 'file' }),
      clientConfigPaths: [],
    });
    expect(broken.checks.find((check) => check.name === 'config')?.ok).toBe(false);
  });

  it('checks the configured port and fails when it is busy', async () => {
    const dir = tempDir();
    const free = await freePort();
    const okReport = await runHealthGate({ dataDir: dir, reloadConfig: () => validConfig, clientConfigPaths: [], checkPort: true, port: free });
    expect(okReport.checks.find((check) => check.name === 'port')?.ok).toBe(true);

    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(free, '127.0.0.1', () => resolve()));
    try {
      const busy = await runHealthGate({ dataDir: dir, reloadConfig: () => validConfig, clientConfigPaths: [], checkPort: true, port: free });
      expect(busy.checks.find((check) => check.name === 'port')?.ok).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('treats a missing client config as a warning, not a failure', async () => {
    const dir = tempDir();
    const report = await runHealthGate({ dataDir: dir, reloadConfig: () => validConfig, clientConfigPaths: [path.join(dir, 'nope.json')] });
    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.name === 'clients')?.level).toBe('warn');
  });

  it('accepts a live mcp-task-knowledge client entry and flags a missing binary', async () => {
    const dir = tempDir();
    const script = path.join(dir, 'server.js');
    fs.writeFileSync(script, '// fake server\n', 'utf8');
    const liveConfig = path.join(dir, 'live.json');
    fs.writeFileSync(
      liveConfig,
      JSON.stringify({ mcpServers: { 'mcp-task-knowledge': { command: process.execPath, args: [script] } } }),
      'utf8',
    );
    expect(inspectClientConfigs([liveConfig]).ok).toBe(true);

    const brokenConfig = path.join(dir, 'broken.json');
    fs.writeFileSync(
      brokenConfig,
      JSON.stringify({ mcpServers: { 'mcp-task-knowledge': { command: path.join(dir, 'missing.js') } } }),
      'utf8',
    );
    expect(inspectClientConfigs([brokenConfig]).ok).toBe(false);
  });
});
