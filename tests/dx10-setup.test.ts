import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { DATA_DIR } from '../src/config.js';
import {
  buildServerEntry,
  detectClients,
  mergeClientConfig,
  runSelfCheck,
  runSetupCli,
} from '../src/cli/setup.js';

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(DATA_DIR, `.tmp-dx10-${prefix}-`));
}

describe('DX-10: setup client config merge', () => {
  it('detects known clients and their servers key', () => {
    const home = tempDir('home');
    const cwd = tempDir('cwd');
    fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
    fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), '{}', 'utf8');
    fs.mkdirSync(path.join(cwd, '.vscode'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.vscode', 'mcp.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(home, '.claude.json'), '{}', 'utf8');

    const targets = detectClients({ home, cwd, env: { HOME: home, USERPROFILE: home } });
    const byKind = Object.fromEntries(targets.map((target) => [target.kind, target]));
    expect(byKind.cursor.exists).toBe(true);
    expect(byKind.vscode.exists).toBe(true);
    expect(byKind['claude-code'].exists).toBe(true);
    expect(byKind.cursor.serversKey).toBe('mcpServers');
    expect(byKind.vscode.serversKey).toBe('servers');
    expect(byKind.windsurf.file).toContain(path.join('.codeium', 'windsurf'));
  });

  it('merges idempotently, preserves other servers and backs up', () => {
    const dir = tempDir('merge');
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: 'x' } } }), 'utf8');
    const entry = buildServerEntry({ kind: 'cursor', transport: 'stdio', dataDir: './data' });
    const first = mergeClientConfig(file, 'mcpServers', entry);
    expect(first.action).toBe('updated');
    expect(first.backup).toBeTruthy();
    expect(fs.existsSync(first.backup!)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { mcpServers: Record<string, unknown> };
    expect(parsed.mcpServers.other).toEqual({ command: 'x' });
    expect(parsed.mcpServers['mcp-task-knowledge']).toEqual(entry);

    const second = mergeClientConfig(file, 'mcpServers', entry);
    expect(second.action).toBe('unchanged');
    expect(second.backup).toBeUndefined();
  });

  it('writes VS Code entries under servers with type stdio', () => {
    const dir = tempDir('vscode');
    const file = path.join(dir, 'mcp.json');
    const entry = buildServerEntry({ kind: 'vscode', transport: 'stdio', dataDir: './data' });
    const result = mergeClientConfig(file, 'servers', entry);
    expect(result.action).toBe('created');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { servers: Record<string, { type?: string }> };
    expect(parsed.servers['mcp-task-knowledge'].type).toBe('stdio');
  });

  it('builds http entries with a bearer token and requires a URL', () => {
    const entry = buildServerEntry({ kind: 'cursor', transport: 'http', dataDir: './data', serverUrl: 'http://x/mcp', token: 't' });
    expect(entry).toMatchObject({ url: 'http://x/mcp', headers: { Authorization: 'Bearer t' } });
    expect(() => buildServerEntry({ kind: 'cursor', transport: 'http', dataDir: './data' })).toThrow(/server-url/);
  });
});

describe('DX-10: setup CLI and self-check', () => {
  it('writes a client entry with --yes and health gate, and is idempotent', async () => {
    const home = tempDir('home');
    fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
    const file = path.join(home, '.cursor', 'mcp.json');
    fs.writeFileSync(file, JSON.stringify({ mcpServers: {} }), 'utf8');
    const health = {
      ok: true,
      checks: [{ name: 'node', level: 'error', ok: true, detail: 'Node 24' }],
    } as const;
    let healthCalls = 0;
    const options = {
      home,
      cwd: home,
      env: { HOME: home, USERPROFILE: home },
      skipSelfCheck: true,
      healthGate: async () => {
        healthCalls += 1;
        return health as never;
      },
      now: () => new Date('2026-11-10T10:00:00Z'),
    };
    const first = await runSetupCli(['--client', 'cursor', '--transport', 'stdio', '--data-dir', './data', '--yes'], options);
    expect(first.exitCode).toBe(0);
    expect(first.targets[0]).toMatchObject({ kind: 'cursor', action: 'updated' });
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { mcpServers: Record<string, { env: { DATA_DIR: string } }> };
    expect(parsed.mcpServers['mcp-task-knowledge'].env.DATA_DIR).toBe('./data');
    expect(healthCalls).toBe(1);

    const second = await runSetupCli(['--client', 'cursor', '--transport', 'stdio', '--data-dir', './data', '--yes'], options);
    expect(second.targets[0].action).toBe('unchanged');
    expect(second.targets[0].backup).toBeUndefined();
  });

  it('rejects http without server-url and unknown clients', async () => {
    const home = tempDir('errors');
    const http = await runSetupCli(['--client', 'cursor', '--transport', 'http', '--yes'], { home, env: { HOME: home, USERPROFILE: home } });
    expect(http.exitCode).toBe(2);
    expect(http.text).toMatch(/server-url/);
    const unknown = await runSetupCli(['--client', 'nope', '--yes'], { home, env: { HOME: home, USERPROFILE: home } });
    expect(unknown.exitCode).toBe(2);
    expect(unknown.text).toMatch(/unknown client/);
  });

  it('runs a stdio initialize/tools/list self-check', async () => {
    const script = `
      const readline = require('node:readline');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        let message; try { message = JSON.parse(line); } catch { return; }
        if (message.method === 'initialize') {
          process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:1,result:{protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'fake',version:'1'}}}) + '\\n');
        }
        if (message.method === 'tools/list') {
          process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:2,result:{tools:[{name:'a'},{name:'b'},{name:'c'}]}}) + '\\n');
        }
      });
    `;
    const result = await runSelfCheck({
      dataDir: tempDir('selfcheck'),
      command: process.execPath,
      args: ['-e', script],
      timeoutMs: 5000,
    });
    expect(result).toEqual({ ok: true, tools: 3 });
  });

  it('reports a self-check timeout honestly', async () => {
    const result = await runSelfCheck({
      dataDir: tempDir('timeout'),
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000);'],
      timeoutMs: 300,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timeout/);
  });
});
